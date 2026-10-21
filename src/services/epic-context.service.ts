import { fetchEpicWorkflowSnapshot } from '../providers/epic-workflow-source.js';
import { MutationService } from './mutation.service.js';
import { db } from '../db/connection.js';
import { canonicalJson } from './canonical-json.js';

/** Supplemental, explicitly requested Epic context. Never converts orders into assigned nursing work. */
export async function readEpicContext(input: { patient_id: string; idempotency_key: string }) {
  if (process.env.EPIC_READS_ENABLED !== 'true') throw new Error('Epic reads are disabled. Configure and verify backend access first.');
  const allowed = (process.env.EPIC_TEST_PATIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(input.patient_id)) throw new Error('Patient is not in EPIC_TEST_PATIENT_IDS; no implicit identity mapping is allowed');
  const key = `epic-context:${input.idempotency_key}`;
  const prior = db.prepare('SELECT request_json, response_json FROM operation_receipts WHERE idempotency_key = ?')
    .get(key) as { request_json: string; response_json: string } | undefined;
  if (prior) {
    if (prior.request_json !== canonicalJson(input)) throw new Error('Idempotency key was already used for a different request');
    return JSON.parse(prior.response_json);
  }
  const snapshot = await fetchEpicWorkflowSnapshot(input.patient_id);
  const failure = Object.entries(snapshot.sections).find(([, section]) => section.status === 'ERROR');
  if (failure) throw new Error(`Epic ${failure[0]} read failed: ${failure[1].error}`);
  const p = snapshot.patient;
  const name = p.name?.find((n: any) => n.use === 'official') || p.name?.[0];
  const context = { patient: { id: p.id, fullName: name?.text || [...(name?.given || []), name?.family].filter(Boolean).join(' ') },
    retrievedAt: snapshot.retrievedAt, encounters: snapshot.sections.Encounter!.resources,
    medicationOrders: snapshot.sections.MedicationRequest!.resources, documents: snapshot.sections.DocumentReference!.resources,
    snapshot };
  return MutationService.execute('EPIC_CONTEXT_READ', key, input, 'epic-reader', () => ({
    context, source: 'EPIC_FHIR_R4', assignments: 'LOCAL_ONLY',
    documentContents: snapshot.documents,
    warning: 'Supplemental source records only. No local patient identity crosswalk, medication administration verification, or custody transfer is implied.'
  }));
}
