import { createHash } from 'node:crypto';
import { db } from '../db/connection.js';
import { MutationService } from './mutation.service.js';
import { canonicalJson } from './canonical-json.js';
import { fetchEpicWorkflowSnapshot, type EpicWorkflowSnapshot } from '../providers/epic-workflow-source.js';
import { EpicOAuthService } from '../providers/epic-oauth.service.js';

type SyncInput = { nurse_id: string; shift_id: string; idempotency_key: string };
export type EpicRecord = { patientId: string; epicPatientId: string; name: string; retrievedAt: string;
  status: string; error: string | null; snapshot: EpicWorkflowSnapshot };

export class EpicWorkflowService {
  static recordsForPatients(patientIds: string[]): EpicRecord[] {
    if (!patientIds.length) return [];
    return (db.prepare(`SELECT s.*, p.full_name FROM epic_patient_snapshots s JOIN patients p ON p.id = s.patient_id
      WHERE s.patient_id IN (${patientIds.map(() => '?').join(',')}) ORDER BY s.patient_id`).all(...patientIds) as any[])
      .map(row => ({ patientId: row.patient_id, epicPatientId: row.epic_patient_id, name: row.full_name,
        retrievedAt: row.retrieved_at, status: row.sync_status, error: row.last_error, snapshot: JSON.parse(row.snapshot_json) }));
  }

  static recordsForNurse(nurseId: string, shiftId: string) {
    const patients = db.prepare(`SELECT DISTINCT t.patient_id AS id FROM tasks t JOIN task_assignments a ON a.task_id = t.id
      WHERE a.nurse_id = ? AND a.shift_id = ? AND a.transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')`).all(nurseId, shiftId) as Array<{ id: string }>;
    return this.recordsForPatients(patients.map(p => p.id));
  }

  static async sync(input: SyncInput) {
    if (process.env.EPIC_READS_ENABLED !== 'true') throw new Error('Epic workflow sync is disabled');
    const patientIds = [...new Set((process.env.EPIC_TEST_PATIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean))];
    if (!patientIds.length) throw new Error('Configure EPIC_TEST_PATIENT_IDS before syncing');
    if (!db.prepare(`SELECT n.id FROM nurses n JOIN shifts s ON s.unit_id = n.department
      WHERE n.id = ? AND s.id = ? AND s.status IN ('ACTIVE', 'HANDOFF_IN_PROGRESS')`).get(input.nurse_id, input.shift_id)) {
      throw new Error('Nurse must belong to the active shift unit');
    }
    const endpoint = EpicOAuthService.getConfig().fhirBaseUrl.replace(/\/$/, '');
    const request = { ...input, patientIds, endpoint };
    const key = `epic-sync:${input.idempotency_key}`;
    const prior = db.prepare('SELECT request_json, response_json FROM operation_receipts WHERE idempotency_key = ?').get(key) as any;
    if (prior) {
      if (prior.request_json !== canonicalJson(request)) throw new Error('Epic sync key reused for a different request');
      return JSON.parse(prior.response_json);
    }
    const results: Array<{ patientId: string; status: string; error?: string }> = [];
    for (const patientId of patientIds) {
      const localId = `epic:${createHash('sha256').update(endpoint).digest('hex').slice(0, 12)}:Patient:${patientId}`;
      const patientKey = `${key}:${patientId}`;
      const committed = db.prepare('SELECT response_json FROM operation_receipts WHERE idempotency_key = ?').get(patientKey) as any;
      if (committed) { results.push(JSON.parse(committed.response_json)); continue; }
      try {
        const snapshot = await fetchEpicWorkflowSnapshot(patientId);
        const result = MutationService.execute('IMPORT_EPIC_PATIENT', patientKey, request, input.nurse_id, () => {
          const p = snapshot.patient;
          const official = p.name?.find((n: any) => n.use === 'official') || p.name?.[0];
          const name = official?.text || [...(official?.given || []), official?.family].filter(Boolean).join(' ') || 'Name not returned by Epic';
          const active = snapshot.sections.Encounter!.resources.filter(e => e.status === 'in-progress');
          const encounter = active.length === 1 ? active[0] : undefined;
          const location = encounter?.location?.find((l: any) => l.status === 'active')?.location?.display || 'Location not verified';
          const allergies = snapshot.sections.AllergyIntolerance!;
          const allergyText = allergies.status === 'ERROR' ? 'Epic allergy retrieval failed' : allergies.resources.length
            ? allergies.resources.map(a => a.code?.text || a.code?.coding?.[0]?.display || 'Unspecified recorded allergy').join('; ')
            : 'No allergy records returned; negative allergy history not verified';
          db.prepare(`INSERT INTO patients (id, mrn, full_name, room_number, bed_number, admission_date, acuity_level, allergies, primary_diagnosis)
            VALUES (?, ?, ?, ?, 'Not verified', ?, NULL, ?, 'See sourced conditions; primary diagnosis not inferred')
            ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name, room_number=excluded.room_number,
            admission_date=excluded.admission_date, allergies=excluded.allergies`).run(localId, localId, name, location, encounter?.period?.start || 'Not verified', allergyText);
          const status = Object.values(snapshot.sections).some(s => s.status === 'ERROR') || snapshot.documents.some(d => d.status === 'ERROR') ? 'PARTIAL' : 'READY';
          db.prepare('INSERT OR IGNORE INTO epic_snapshot_versions (id, patient_id, snapshot_json, retrieved_at) VALUES (?, ?, ?, ?)')
            .run(patientKey, localId, JSON.stringify(snapshot), snapshot.retrievedAt);
          db.prepare(`INSERT INTO epic_patient_snapshots (patient_id, epic_patient_id, endpoint, snapshot_json, retrieved_at, sync_status)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(patient_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,
            retrieved_at=excluded.retrieved_at, sync_status=excluded.sync_status, last_error=NULL`).run(localId, patientId, endpoint, JSON.stringify(snapshot), snapshot.retrievedAt, status);
          const taskId = `${localId}:review:${input.shift_id}`;
          if (process.env.EPIC_CREATE_REVIEW_TASKS !== 'false') {
          db.prepare(`INSERT OR IGNORE INTO tasks (id, patient_id, title, description, category, status, priority, scheduled_time, source_system)
            VALUES (?, ?, 'Review Epic source records for handoff', 'Local coordination task. Not an Epic medication order or administration.',
            'CONSULT', 'PENDING', 'ROUTINE', ?, 'SHIFTWEAVE_COORDINATION_WITH_EPIC_CONTEXT')`).run(taskId, localId, snapshot.retrievedAt);
          // Existing ownership survives resync, including custody already accepted by another nurse.
          if (!db.prepare('SELECT id FROM task_assignments WHERE task_id = ? AND shift_id = ?').get(taskId, input.shift_id)) {
            db.prepare('INSERT INTO task_assignments (id, task_id, nurse_id, shift_id, assigned_by) VALUES (?, ?, ?, ?, ?)')
              .run(`${taskId}:initial`, taskId, input.nurse_id, input.shift_id, 'EPIC_WORKSPACE_SETUP');
          }
          }
          return { patientId: localId, status };
        });
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        MutationService.execute('EPIC_SYNC_FAILURE', `${patientKey}:failure`, request, input.nurse_id, () => {
          db.prepare("UPDATE epic_patient_snapshots SET sync_status='FAILED', last_error=? WHERE patient_id=?").run(message, localId);
          return { patientId: localId, status: 'FAILED', error: message };
        });
        results.push({ patientId: localId, status: 'FAILED', error: message });
      }
    }
    return MutationService.execute('EPIC_WORKSPACE_SYNC', key, request, input.nurse_id, () => ({ results,
      status: results.every(r => r.status === 'READY') ? 'READY' : results.every(r => r.status === 'FAILED') ? 'FAILED' : 'PARTIAL',
      source: 'LIVE_EPIC_READS_WITH_LOCAL_COORDINATION', nurseId: input.nurse_id, shiftId: input.shift_id }));
  }

  static narrative(records: EpicRecord[]) {
    if (!records.length) return '';
    return '\n\n## Patient source context (retrieved records, not clinical recommendations)\n' + records.map(record => {
      const s = record.snapshot;
      const lines = [`### ${record.name}`, `Source: ${s.source}; patient ${s.patientId}; retrieved ${s.retrievedAt}; sync ${record.status}.`];
      if (record.error) lines.push(`Latest refresh failed: ${record.error}. Retained snapshot may be stale.`);
      for (const [name, section] of Object.entries(s.sections)) {
        lines.push(`${name}: ${section.status}; ${section.resources.length} records.${section.error ? ` ${section.error}` : ''}`);
        for (const warning of section.warnings) lines.push(`Source notice: ${warning}`);
      }
      for (const condition of s.sections.Condition?.resources || []) lines.push(`Recorded condition: ${condition.code?.text || condition.code?.coding?.[0]?.display || 'unspecified'}; source Condition/${condition.id}.`);
      for (const allergy of s.sections.AllergyIntolerance?.resources || []) lines.push(`Recorded allergy: ${allergy.code?.text || allergy.code?.coding?.[0]?.display || 'unspecified'}; source AllergyIntolerance/${allergy.id}.`);
      for (const med of s.sections.MedicationRequest?.resources || []) lines.push(`Medication order: ${med.medicationReference?.display || med.medicationCodeableConcept?.text || 'unnamed'}; status ${med.status || 'unknown'}; source MedicationRequest/${med.id}. Order does not establish administration.`);
      lines.push('Missing administration or document records do not establish completion, a negative history, or a discrepancy. Local review tasks and custody remain ShiftWeave records.');
      return lines.join('\n');
    }).join('\n\n');
  }
}
