import dotenv from 'dotenv';
dotenv.config();

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Use isolated temporary database for test execution
const root = realpathSync(tmpdir());
const tempDir = mkdtempSync(path.join(root, 'shiftweave-writeback-test-'));
process.env.SQLITE_DB_PATH = path.join(tempDir, 'test.db');
process.env.PORT = '0';
process.env.SHIFTWEAVE_TEST = '1';

const { db } = await import('../src/db/connection.js');
const { initializeDatabase } = await import('../src/db/schema.js');
const { importIncomingData } = await import('../src/db/ingest.js');
const { HandoffService } = await import('../src/services/handoff.service.js');
const { ConflictService } = await import('../src/services/conflict.service.js');
const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
const { EpicWriteBackService } = await import('../src/services/epic-writeback.service.js');

async function runWriteBackVerification() {
  console.log('======================================================');
  console.log('🏥 ShiftWeave — Step 7: Reviewed Write-Back Verification');
  console.log('======================================================\n');

  // Initialize DB and synthetic baseline
  initializeDatabase();
  importIncomingData();

  // Reset any mock remote store
  EpicWriteBackService.resetMockRemoteStore();

  const outgoingNurseId = 'nurse_seema_01';
  const incomingNurseId = 'nurse_reema_02';
  const shiftId = 'shift_20261019_night';
  const taskId = 'task_med_102_03';

  // Ensure task assignment is active for outgoing nurse
  db.prepare("UPDATE task_assignments SET nurse_id = ?, shift_id = ?, transfer_status = 'ACTIVE' WHERE task_id = ?").run(outgoingNurseId, shiftId, taskId);
  db.prepare("UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = ?").run(taskId);
  db.prepare("UPDATE conflicts SET status = 'UNRESOLVED' WHERE task_id = ?").run(taskId);

  // -------------------------------------------------------------------------
  // Test 1: Production rejects simulated publication before reading or writing records.
  console.log('Test 1: Production simulation boundary (no external network calls)...');
  const previousEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(EpicWriteBackService.publishReviewedNote({
      handoffId: 'not-a-handoff', nurseId: incomingNurseId, idempotencyKey: randomUUID(),
      humanConfirmed: true, executionMode: 'mock'
    }), /disabled in production/);
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
  console.log('PASS production simulation boundary; live Epic permissions were not tested.');

  // -------------------------------------------------------------------------
  // Test 2: US Core FHIR R4 Clinical Note Payload Construction & Validation
  // -------------------------------------------------------------------------
  console.log('\nTest 2: Validating US Core FHIR R4 DocumentReference payload construction...');
  const payload = EpicWriteBackService.buildDocumentReferencePayload({
    patientId: 'epic:Patient:erXuFYUfucBZaryVksYEcMg3',
    patientName: 'Camila Maria Lopez',
    nurseName: 'Reema Roy, RN',
    summaryMarkdown: '## Situation\nPatient Camila Lopez post-op recovery in Room 305.\n\n## Assessment\nClinically stable.',
  });

  assert.equal(payload.resourceType, 'DocumentReference');
  assert.equal(payload.status, 'current');
  assert.equal(payload.docStatus, 'final');
  assert.equal(payload.category[0]?.coding[0]?.code, 'clinical-note');
  assert.equal(payload.type.coding[0]?.code, '11506-3'); // LOINC Progress Note
  assert.equal(payload.subject.reference, 'Patient/erXuFYUfucBZaryVksYEcMg3');
  assert.equal(payload.author[0]?.display, 'Reema Roy, RN');
  assert(payload.content[0]?.attachment.data, 'Missing base64 data attachment');
  
  const decodedContent = Buffer.from(payload.content[0].attachment.data, 'base64').toString('utf8');
  assert(decodedContent.includes('Camila Lopez post-op recovery'));
  console.log('  Payload conforms to US Core FHIR R4 DocumentReference (Clinical Notes) schema.');
  console.log('  Decoded content excerpt:', decodedContent.split('\n')[0]);
  console.log('  ✅ Test 2 PASSED: Clinical Note payload construction verified.');

  // -------------------------------------------------------------------------
  // Test 3: Explicit Human Review Gate
  // -------------------------------------------------------------------------
  console.log('\nTest 3: Testing Explicit Human Review Gate (human_confirmed: false rejection)...');
  
  // Setup baseline handoff
  const draftRes = HandoffService.createDraft({
    outgoing_nurse_id: outgoingNurseId,
    incoming_nurse_id: incomingNurseId,
    shift_id: shiftId,
    summary_markdown: '## Situation\nDraft handoff for human review.',
    carried_forward_task_ids: [taskId],
    idempotency_key: randomUUID(),
  });
  const handoffId = draftRes.handoff_id;

  await assert.rejects(
    async () => {
      await EpicWriteBackService.publishReviewedNote({
        handoffId,
        nurseId: incomingNurseId,
        idempotencyKey: randomUUID(),
        humanConfirmed: false, // Rejected!
      });
    },
    /Explicit human review and confirmation is required/,
    'Should reject unconfirmed write-back attempt'
  );
  console.log('  Rejected unconfirmed publication attempt with explicit human approval requirement.');
  console.log('  ✅ Test 3 PASSED: Human review gate enforced.');

  // -------------------------------------------------------------------------
  // Test 4: Discrepancy Gate Enforcement
  // -------------------------------------------------------------------------
  console.log('\nTest 4: Testing Discrepancy Gate Enforcement (unresolved conflict blocks publishing)...');
  await assert.rejects(
    async () => {
      await EpicWriteBackService.publishReviewedNote({
        handoffId,
        nurseId: incomingNurseId,
        idempotencyKey: randomUUID(),
        humanConfirmed: true,
      });
    },
    /unresolved documentation discrepancies/,
    'Should block publication when unresolved discrepancies exist'
  );
  console.log('  Publication blocked by active unresolved conflict.');

  // Now resolve the conflict legitimately with human review note
  const conflict = db.prepare("SELECT id FROM conflicts WHERE task_id = ?").get(taskId) as { id: string };
  ConflictService.resolveConflict(conflict.id, incomingNurseId, 'IN_PROGRESS', 'Verified with pharmacy', randomUUID());
  
  // Re-create clean handoff with 0 conflicts
  const cleanDraft = HandoffService.createDraft({
    outgoing_nurse_id: outgoingNurseId,
    incoming_nurse_id: incomingNurseId,
    shift_id: shiftId,
    summary_markdown: '## Situation\nClean reviewed handoff ready for custody and sign-off.',
    carried_forward_task_ids: [taskId],
    idempotency_key: randomUUID(),
  });
  const cleanHandoffId = cleanDraft.handoff_id;
  assert.equal(cleanDraft.unresolved_conflicts_count, 0);
  console.log('  Discrepancy resolved; clean handoff created with 0 conflicts.');
  console.log('  ✅ Test 4 PASSED: Discrepancy gate enforced.');

  // -------------------------------------------------------------------------
  // Test 5: Custody Acceptance Gate
  // -------------------------------------------------------------------------
  console.log('\nTest 5: Testing Custody Acceptance Gate (custody required before write-back)...');
  await assert.rejects(
    async () => {
      await EpicWriteBackService.publishReviewedNote({
        handoffId: cleanHandoffId,
        nurseId: incomingNurseId,
        idempotencyKey: randomUUID(),
        humanConfirmed: true,
      });
    },
    /Custody must be accepted by incoming nurse/,
    'Should block publication until custody is accepted'
  );
  console.log('  Publication blocked until custody accepted.');

  // Incoming nurse accepts custody
  HandoffService.acknowledge({
    task_id: taskId,
    nurse_id: incomingNurseId,
    action: 'ACCEPT_HANDOFF',
    handoff_id: cleanHandoffId,
    human_confirmed: true,
    idempotency_key: randomUUID(),
  });
  console.log('  Incoming nurse explicitly accepted custody of task.');
  console.log('  ✅ Test 5 PASSED: Custody gate enforced.');

  // -------------------------------------------------------------------------
  // Test 6: Local Finalization Invariant
  // -------------------------------------------------------------------------
  console.log('\nTest 6: Testing Local Finalization Invariant (local sign-off is not external publication)...');
  const finalResult = HandoffService.finalize(cleanHandoffId, incomingNurseId, randomUUID(), true);
  assert.equal(finalResult.status, 'FINALIZED');
  assert.equal(finalResult.externalSync, 'NOT_REQUESTED');

  const handoffRecord = db.prepare('SELECT status, external_sync_status, external_resource_id FROM handoffs WHERE id = ?')
    .get(cleanHandoffId) as { status: string; external_sync_status: string; external_resource_id: string | null };
  assert.equal(handoffRecord.status, 'FINALIZED');
  assert.equal(handoffRecord.external_sync_status, 'NOT_REQUESTED');
  assert.equal(handoffRecord.external_resource_id, null);
  console.log('  Handoff finalized locally in SQLite with status = FINALIZED and external_sync_status = NOT_REQUESTED.');
  console.log('  ✅ Test 6 PASSED: Local finalization preserved without false external sync claim.');

  // -------------------------------------------------------------------------
  // Test 7: Ambiguous Network Outcome & Durable Uncertainty State
  // -------------------------------------------------------------------------
  console.log('\nTest 7: Testing Ambiguous Network Outcome & Durable UNCERTAIN State...');
  const uncertainResult = await EpicWriteBackService.publishReviewedNote({
    handoffId: cleanHandoffId,
    nurseId: incomingNurseId,
    idempotencyKey: randomUUID(),
    humanConfirmed: true,
    executionMode: 'simulate_uncertain', // Simulates timeout / network drop mid-commit
  });

  assert.equal(uncertainResult.externalSync, 'UNCERTAIN');
  assert(uncertainResult.warning?.includes('ambiguous'), 'Warning must explain ambiguity');

  const uncertainRecord = db.prepare('SELECT external_sync_status, external_sync_error FROM handoffs WHERE id = ?')
    .get(cleanHandoffId) as { external_sync_status: string; external_sync_error: string };
  assert.equal(uncertainRecord.external_sync_status, 'UNCERTAIN');
  assert(uncertainRecord.external_sync_error.includes('timeout'));
  console.log('  Network timeout resulted in durable external_sync_status = UNCERTAIN.');
  console.log('  ✅ Test 7 PASSED: Ambiguous network outcome handled with visible uncertainty.');

  // -------------------------------------------------------------------------
  // Test 8: Remote Reconciliation Before Retry (Idempotency & Duplicate Prevention)
  // -------------------------------------------------------------------------
  console.log('\nTest 8: Testing Remote Reconciliation Before Retry (preventing duplicate note creation)...');
  
  // Nurse retries or system resumes
  const retryResult = await EpicWriteBackService.publishReviewedNote({
    handoffId: cleanHandoffId,
    nurseId: incomingNurseId,
    idempotencyKey: randomUUID(),
    humanConfirmed: true,
    executionMode: 'mock',
  });

  assert.equal(retryResult.externalSync, 'SYNCED');
  assert.equal(retryResult.reconciled, true, 'Must indicate state was recovered via remote reconciliation');
  assert(retryResult.externalResourceId?.startsWith('doc_reconciled_'), 'Must retain the remotely reconciled resource ID');

  const reconciledRecord = db.prepare('SELECT external_sync_status, external_resource_id, external_synced_at FROM handoffs WHERE id = ?')
    .get(cleanHandoffId) as { external_sync_status: string; external_resource_id: string; external_synced_at: string };
  assert.equal(reconciledRecord.external_sync_status, 'SYNCED');
  assert.equal(reconciledRecord.external_resource_id, retryResult.externalResourceId);
  assert(reconciledRecord.external_synced_at, 'Must have timestamp of remote synchronization');

  console.log(`  Remote reconciliation succeeded: matched existing remote note (${retryResult.externalResourceId}).`);
  console.log('  Local status transitioned UNCERTAIN -> SYNCED without duplicate remote creation.');
  console.log('  ✅ Test 8 PASSED: Remote reconciliation before retry verified.');

  // Clean up temporary database
  try {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================');
  console.log('🎉 ALL 8 REVIEWED WRITE-BACK VERIFICATION TESTS PASSED!');
  console.log('======================================================\n');
}

runWriteBackVerification().catch(err => {
  console.error('❌ Write-back verification failed:', err);
  process.exit(1);
});
