import { createHash } from 'node:crypto';
import { db } from '../db/connection.js';
import { EpicOAuthService } from '../providers/epic-oauth.service.js';
import { EpicWorkflowService, type EpicRecord } from './epic-workflow.service.js';
import { MutationService } from './mutation.service.js';
import type { PublishNoteInput, PublishNoteResult } from './epic-writeback.service.js';

/** Sandbox note publication. A persisted sending intent is never automatically replayed. */
export class EpicNoteService {
  static preview(handoffId: string, nurseId: string) {
    const handoff = db.prepare('SELECT * FROM handoffs WHERE id=? AND incoming_nurse_id=?').get(handoffId, nurseId) as any;
    if (!handoff || handoff.status !== 'FINALIZED') throw new Error('Finalize the reviewed handoff as its incoming nurse before previewing publication');
    const snapshot = JSON.parse(handoff.data_snapshot);
    const records = snapshot.epicRecords as EpicRecord[] | undefined;
    const patientIds = new Set((snapshot.tasks || []).map((t: any) => t.patient_id));
    if (patientIds.size !== 1 || records?.length !== 1 || !patientIds.has(records[0]!.patientId)) {
      throw new Error('Epic publication requires a single-patient Epic handoff; mixed-patient notes must never enter one patient chart');
    }
    const record = records[0]!;
    const endpoint = EpicOAuthService.getConfig().fhirBaseUrl.replace(/\/$/, '');
    if (record.snapshot.endpoint.replace(/\/$/, '') !== endpoint) throw new Error('Handoff source belongs to another Epic endpoint');
    if (!(process.env.EPIC_TEST_PATIENT_IDS || '').split(',').map(s => s.trim()).includes(record.epicPatientId)) throw new Error('Patient is not allowlisted');
    if (record.status !== 'READY') throw new Error('Incomplete Epic source snapshot requires review and a new handoff');
    for (const task of snapshot.tasks) {
      if (db.prepare("SELECT id FROM conflicts WHERE task_id=? AND status='UNRESOLVED'").get(task.id)) throw new Error('Unresolved discrepancies block publication');
    }
    for (const id of snapshot.carriedForwardIds || []) {
      if (!db.prepare("SELECT id FROM task_assignments WHERE task_id=? AND nurse_id=? AND shift_id=? AND transfer_status='ACTIVE'").get(id, nurseId, handoff.shift_id)) throw new Error('Accepted custody is required');
    }
    const encounters = record.snapshot.sections.Encounter?.resources || [];
    const eligible = encounters.filter((e: any) => ['in-progress', 'finished'].includes(e.status) && e.subject?.reference === `Patient/${record.epicPatientId}` && e.participant?.some((p: any) => /^Practitioner\/[A-Za-z0-9.-]+$/.test(p.individual?.reference || '')));
    // Prefer the latest open encounter without an end timestamp. Configuration can pin a reviewed alternative.
    eligible.sort((a: any, b: any) => Number(b.status === 'in-progress' && !b.period?.end) - Number(a.status === 'in-progress' && !a.period?.end) || String(b.period?.start || '').localeCompare(String(a.period?.start || '')) || String(a.id).localeCompare(String(b.id)));
    const encounter = process.env.EPIC_NOTE_ENCOUNTER_ID ? eligible.find((e: any) => e.id === process.env.EPIC_NOTE_ENCOUNTER_ID) : eligible[0];
    if (!encounter) throw new Error('No eligible patient-linked encounter with a practitioner participant is available');
    const authors = [...new Set<string>(encounter.participant.map((p: any) => p.individual?.reference).filter((r: any) => /^Practitioner\/[A-Za-z0-9.-]+$/.test(r || '')))];
    const author = process.env.EPIC_NOTE_AUTHOR_REFERENCE || authors[0]!;
    if (!authors.includes(author)) throw new Error('Configured sandbox author is not linked to the selected encounter');
    const note = `SHIFTWEAVE SYNTHETIC SANDBOX DEMONSTRATION — NOT FOR PATIENT CARE\nNursing workflow coordination only. No order or administration changes.\nHandoff: ${handoffId}\nLocal custody was accepted and this handoff finalized.\nLocal nurse identity is simulated and is not an Epic practitioner login.\nSandbox author reference selected from the encounter participant list: ${author}.\n` +
      snapshot.tasks.map((t: any) => `Local coordination task: ${t.title}; recorded draft status: ${t.status}`).join('\n') + EpicWorkflowService.narrative(records);
    const payload = { resourceType: 'DocumentReference', status: 'current', docStatus: 'final',
      type: { coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }], text: 'Progress note' },
      subject: { reference: `Patient/${record.epicPatientId}` }, author: [{ reference: author }],
      description: `ShiftWeave sandbox handoff ${handoffId}`, context: { encounter: [{ reference: `Encounter/${encounter.id}` }] },
      content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(note).toString('base64') } }] };
    const reviewHash = createHash('sha256').update(JSON.stringify({ endpoint, payload })).digest('hex');
    return { handoffId, patientId: record.epicPatientId, encounterReference: `Encounter/${encounter.id}`, authorReference: author,
      authorVerification: 'Reference supplied by Epic Encounter; separate Practitioner.Read access may be unavailable. Not an authenticated nurse identity.',
      note, payload, reviewHash, externalSync: handoff.external_sync_status, writesEnabled: process.env.EPIC_WRITES_ENABLED === 'true' };
  }

  static async publish(input: PublishNoteInput & { reviewHash?: string | undefined }): Promise<PublishNoteResult> {
    if (!input.humanConfirmed || !input.reviewHash) throw new Error('Explicit review of the exact note preview and its review_hash is required');
    if (process.env.EPIC_WRITES_ENABLED !== 'true') throw new Error('Live Epic writes are disabled');
    const preview = this.preview(input.handoffId, input.nurseId);
    if (preview.reviewHash !== input.reviewHash) throw new Error('Note preview changed; review it again before publishing');
    if (input.patientId && input.patientId !== preview.patientId) throw new Error('Requested patient differs from the reviewed note');
    // Refresh the actual encounter linkage immediately before sending; errors stop the write.
    const encounter = await EpicOAuthService.authorizedFetch<any>(preview.encounterReference);
    if (encounter.resourceType !== 'Encounter' || encounter.subject?.reference !== `Patient/${preview.patientId}` || !['in-progress', 'finished'].includes(encounter.status) || !encounter.participant?.some((p: any) => p.individual?.reference === preview.authorReference)) throw new Error('Epic encounter or author linkage changed; publication stopped');
    const request = { handoffId: input.handoffId, nurseId: input.nurseId, reviewHash: input.reviewHash };
    let claimed = false;
    MutationService.execute('EPIC_NOTE_INTENT', `epic-note:${input.idempotencyKey}`, request, input.nurseId, () => {
      const current = db.prepare('SELECT external_sync_status FROM handoffs WHERE id=?').get(input.handoffId) as any;
      if (!['NOT_REQUESTED', 'FAILED'].includes(current.external_sync_status)) throw new Error('A publication attempt already exists. Inspect its outcome; do not automatically resend');
      db.prepare("UPDATE handoffs SET external_sync_status='PENDING', external_sync_payload=?, external_sync_error=NULL WHERE id=?").run(JSON.stringify(preview.payload), input.handoffId);
      claimed = true;
      return { handoffId: input.handoffId, reviewHash: preview.reviewHash };
    });
    if (!claimed) {
      const row = db.prepare('SELECT external_sync_status,external_resource_id,external_sync_error FROM handoffs WHERE id=?').get(input.handoffId) as any;
      return { handoffId: input.handoffId, externalSync: row.external_sync_status === 'PENDING' ? 'UNCERTAIN' : row.external_sync_status, externalResourceId: row.external_resource_id || undefined,
        warning: 'Existing durable attempt returned without resending. PENDING/UNCERTAIN requires remote verification.', error: row.external_sync_error || undefined };
    }
    let result: PublishNoteResult;
    try {
      const response = await EpicOAuthService.authorizedFetchResponse('DocumentReference', { method: 'POST',
        headers: { 'Content-Type': 'application/fhir+json', Prefer: 'return=representation' }, body: JSON.stringify(preview.payload), signal: AbortSignal.timeout(20000) });
      if (response.status === 201) {
        let body: any; try { body = await response.json(); } catch { body = undefined; }
        const location = response.headers.get('location');
        const locationId = location?.match(/DocumentReference\/([A-Za-z0-9.-]+)(?:\/_history\/[^/?]+)?(?:\?.*)?$/)?.[1];
        const id = body?.resourceType === 'DocumentReference' ? body.id : locationId;
        if (typeof id !== 'string' || !/^[A-Za-z0-9.-]+$/.test(id)) throw new Error('Epic returned 201 without a usable DocumentReference identifier');
        result = { handoffId: input.handoffId, externalSync: 'SYNCED', externalResourceId: id, docUrl: EpicOAuthService.resolveResourceUrl(`DocumentReference/${id}`) };
      } else {
        result = { handoffId: input.handoffId, externalSync: response.status >= 500 || [408, 429].includes(response.status) ? 'UNCERTAIN' : 'FAILED', error: `Epic DocumentReference.Create returned HTTP ${response.status}. No success claimed; verify API authorization and target encounter configuration.` };
      }
    } catch (error) {
      result = { handoffId: input.handoffId, externalSync: 'UNCERTAIN', error: error instanceof Error ? error.message : String(error), warning: 'A remote commit cannot be excluded. Automatic replay is blocked.' };
    }
    return MutationService.execute('EPIC_NOTE_OUTCOME', `epic-note-outcome:${input.idempotencyKey}`, { request, result }, input.nurseId, () => {
      db.prepare('UPDATE handoffs SET external_sync_status=?,external_resource_id=?,external_sync_error=?,external_synced_at=? WHERE id=?').run(result.externalSync, result.externalResourceId || null, result.error || null, result.externalSync === 'SYNCED' ? new Date().toISOString() : null, input.handoffId);
      return result;
    });
  }
}
