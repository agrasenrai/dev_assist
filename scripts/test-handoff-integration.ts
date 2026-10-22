import dotenv from 'dotenv';
dotenv.config();

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every invocation gets its own isolated database. Never mutate the shared demo DB.
const root = realpathSync(tmpdir());
const tempDir = mkdtempSync(path.join(root, 'shiftweave-handoff-test-'));
process.env.SQLITE_DB_PATH = path.join(tempDir, 'test.db');
process.env.PORT = '0';
process.env.SHIFTWEAVE_TEST = '1';
process.env.NODE_ENV = 'test';

const { db } = await import('../src/db/connection.js');
const { initializeDatabase } = await import('../src/db/schema.js');
const { importIncomingData } = await import('../src/db/ingest.js');
const { HandoffService } = await import('../src/services/handoff.service.js');
const { ConflictService } = await import('../src/services/conflict.service.js');
const { FieldAuthorityService, FIELD_AUTHORITY_MATRIX } = await import('../src/services/field-authority.service.js');
const { EpicMappingService } = await import('../src/providers/epic-mapping.service.js');

async function runHandoffIntegrationVerification() {
  console.log('======================================================');
  console.log('🏥 ShiftWeave — Step 4: Handoff Integration & Field Authority');
  console.log('======================================================\n');

  // Setup isolated test records
  initializeDatabase();
  importIncomingData();

  // Test 1: Field Authority Matrix Definition
  console.log('Test 1: Validating Field Authority Matrix boundaries...');
  assert.equal(FIELD_AUTHORITY_MATRIX['patient.demographics']?.authoritativeSystem, 'EPIC_FHIR_R4');
  assert.equal(FIELD_AUTHORITY_MATRIX['patient.primaryDiagnosis']?.authoritativeSystem, 'EPIC_FHIR_R4');
  assert.equal(FIELD_AUTHORITY_MATRIX['patient.allergies']?.authoritativeSystem, 'EPIC_FHIR_R4');
  assert.equal(FIELD_AUTHORITY_MATRIX['task.medicationOrder']?.authoritativeSystem, 'EPIC_FHIR_R4');
  assert.equal(FIELD_AUTHORITY_MATRIX['task.nursingCustody']?.authoritativeSystem, 'LOCAL_SHIFTWEAVE');
  assert.equal(FIELD_AUTHORITY_MATRIX['task.workflowStatus']?.authoritativeSystem, 'LOCAL_SHIFTWEAVE');
  assert.equal(FIELD_AUTHORITY_MATRIX['task.acknowledgementAndEvents']?.authoritativeSystem, 'LOCAL_SHIFTWEAVE');
  assert.equal(FIELD_AUTHORITY_MATRIX['handoff.custodyTransfer']?.authoritativeSystem, 'LOCAL_SHIFTWEAVE');
  console.log('  Field Authority Matrix defines 8 authoritative clinical and bedside boundaries.');
  console.log('  ✅ Test 1 PASSED: Field Authority boundaries verified.\n');

  // Test 2: External Identifier Namespacing & Parsing
  console.log('Test 2: Validating external identifier namespacing and parsing...');
  const patientNs = FieldAuthorityService.namespaceId('epic', 'Patient', 'erXuFYUfucBZaryVksYEcMg3');
  assert.equal(patientNs, 'epic:Patient:erXuFYUfucBZaryVksYEcMg3');
  assert(FieldAuthorityService.isExternalId(patientNs));
  assert(!FieldAuthorityService.isExternalId('pt_101'));

  const parsed = FieldAuthorityService.parseNamespacedId('epic:MedicationRequest:ePDJ.zsf3Jfg2.MKkAMgW9EcIbsaiB.y-OTrPS5v2h8Q3');
  assert.deepEqual(parsed, {
    system: 'epic',
    resourceType: 'MedicationRequest',
    rawId: 'ePDJ.zsf3Jfg2.MKkAMgW9EcIbsaiB.y-OTrPS5v2h8Q3',
  });
  console.log('  Namespaced identifier:', patientNs);
  console.log('  Parsed resource:', parsed?.resourceType, 'ID:', parsed?.rawId);
  console.log('  ✅ Test 2 PASSED: External identifier namespacing verified.\n');

  // Test 3: Grounded Integrated Handoff Synthesis with Live Epic Clinical Context
  console.log('Test 3: Fetching live Epic clinical context and synthesizing grounded handoff...');
  const testPatientId = 'erXuFYUfucBZaryVksYEcMg3'; // Camila Lopez
  const camilaContext = await EpicMappingService.getPatientClinicalContext(testPatientId);
  console.log(`  Retrieved live context for ${camilaContext.patient.fullName}: ${camilaContext.medicationOrders.length} med order(s), ${camilaContext.conditions.length} condition(s).`);

  // Ensure unfinished candidate task is assigned to outgoing nurse and baseline state is reset
  const outgoingNurseId = 'nurse_seema_01';
  const incomingNurseId = 'nurse_reema_02';
  const shiftId = 'shift_20261019_night';
  const candidateTaskId = 'task_med_102_03';

  db.prepare("UPDATE task_assignments SET nurse_id = ?, transfer_status = 'ACTIVE' WHERE task_id = ?").run(outgoingNurseId, candidateTaskId);
  db.prepare("UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = ?").run(candidateTaskId);
  db.prepare("UPDATE conflicts SET status = 'UNRESOLVED' WHERE task_id = ?").run(candidateTaskId);

  const draftKey = randomUUID();
  const draftResult = HandoffService.createDraft({
    outgoing_nurse_id: outgoingNurseId,
    incoming_nurse_id: incomingNurseId,
    shift_id: shiftId,
    summary_markdown: '', // will be populated via FieldAuthorityService
    carried_forward_task_ids: [candidateTaskId],
    idempotency_key: draftKey,
    epic_clinical_context: [camilaContext],
  });

  assert(draftResult.handoff_id.startsWith('handoff_'));
  assert.equal(draftResult.status, 'DRAFT');
  assert.equal(draftResult.carried_forward_count, 1);
  assert.equal(draftResult.requires_review, true);
  console.log(`  Draft created: ID=${draftResult.handoff_id}, carried=${draftResult.carried_forward_count}`);
  console.log('  ✅ Test 3 PASSED: Grounded handoff draft created.\n');

  // Test 4: Verify Grounded SBAR Narrative and Snapshot Structure
  console.log('Test 4: Inspecting grounded handoff narrative and snapshot contents...');
  const handoffRecord = db.prepare('SELECT summary_markdown, data_snapshot FROM handoffs WHERE id = ?').get(draftResult.handoff_id) as { summary_markdown: string; data_snapshot: string };
  const narrative = handoffRecord.summary_markdown;
  const snapshot = JSON.parse(handoffRecord.data_snapshot);

  assert(narrative.includes('## Situation'), 'Missing ## Situation');
  assert(narrative.includes('## Clinical Context (Epic on FHIR R4)'), 'Missing Clinical Context');
  assert(narrative.includes('epic:Patient:erXuFYUfucBZaryVksYEcMg3'), 'Missing namespaced patient ID');
  assert(narrative.includes('Camila Maria Lopez'), 'Missing patient name');
  assert(narrative.includes('PCOS'), 'Missing primary diagnosis');
  assert(narrative.includes('## Recorded Bedside Workflow State (ShiftWeave Local Authority)'), 'Missing Bedside Workflow');
  assert(narrative.includes('## Workflow Follow-up & Custody'), 'Missing Follow-up');

  // Verify snapshot contains both local tasks and external clinical context
  assert(Array.isArray(snapshot.tasks));
  assert.deepEqual(snapshot.carriedForwardIds, [candidateTaskId]);
  assert(Array.isArray(snapshot.epicClinicalContext));
  assert(snapshot.fieldAuthority !== undefined);
  console.log('  Narrative contains grounded SBAR sections with both local and Epic provenance.');
  console.log('  Snapshot preserves both local tasks and Epic clinical context.');
  console.log('  ✅ Test 4 PASSED: Grounded narrative and snapshot verified.\n');

  // Test 5: Verify Custody Boundary (Drafting does NOT transfer custody)
  console.log('Test 5: Verifying custody boundary on draft creation...');
  const currentAssignment = db.prepare("SELECT nurse_id, transfer_status FROM task_assignments WHERE task_id = ? AND transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')").get(candidateTaskId) as { nurse_id: string; transfer_status: string };
  assert.equal(currentAssignment.nurse_id, outgoingNurseId, 'Drafting must not change assigned nurse');
  console.log(`  Current assignment: nurse=${currentAssignment.nurse_id}, status=${currentAssignment.transfer_status}`);
  console.log('  ✅ Test 5 PASSED: Draft creation preserves outgoing nurse custody.\n');

  // Test 6: Verify Discrepancy Gate (Unresolved conflict blocks acceptance)
  console.log('Test 6: Verifying discrepancy gate blocks custody acceptance...');
  const conflict = db.prepare("SELECT id FROM conflicts WHERE task_id = ? AND status = 'UNRESOLVED'").get(candidateTaskId);
  if (conflict) {
    assert.throws(
      () => {
        HandoffService.acknowledge({
          task_id: candidateTaskId,
          nurse_id: incomingNurseId,
          action: 'ACCEPT_HANDOFF',
          handoff_id: draftResult.handoff_id,
          human_confirmed: true,
          idempotency_key: randomUUID(),
        });
      },
      /Resolve discrepancy before accepting custody/,
      'Expected unresolved discrepancy to block acceptance'
    );
    console.log('  Discrepancy gate successfully blocked custody acceptance until resolved.');

    // Now resolve the conflict as human nurse
    ConflictService.resolveConflict(
      'conf_task_med_102_03',
      incomingNurseId,
      'IN_PROGRESS',
      'Verified with pharmacy that infusion is scheduled and prepared.',
      randomUUID()
    );
    console.log('  Human nurse resolved the documentation discrepancy.');
  }
  console.log('  ✅ Test 6 PASSED: Discrepancy gate enforced.\n');

  // Test 7: Explicit Spoken / Interactive Custody Acceptance
  console.log('Test 7: Executing explicit custody acceptance by incoming nurse...');
  const acceptKey = randomUUID();
  const acceptResult = HandoffService.acknowledge({
    task_id: candidateTaskId,
    nurse_id: incomingNurseId,
    action: 'ACCEPT_HANDOFF',
    handoff_id: draftResult.handoff_id,
    human_confirmed: true,
    idempotency_key: acceptKey,
  });

  assert.equal(acceptResult.action, 'ACCEPT_HANDOFF');
  assert.equal(acceptResult.status, 'IN_PROGRESS'); // Preserves task status!

  // Check updated assignments in database
  const previousAssignment = db.prepare('SELECT transfer_status FROM task_assignments WHERE task_id = ? AND nurse_id = ?').get(candidateTaskId, outgoingNurseId) as { transfer_status: string };
  assert.equal(previousAssignment.transfer_status, 'TRANSFERRED');

  const newAssignment = db.prepare('SELECT transfer_status FROM task_assignments WHERE task_id = ? AND nurse_id = ?').get(candidateTaskId, incomingNurseId) as { transfer_status: string };
  assert.equal(newAssignment.transfer_status, 'ACTIVE');

  // Check handoff moved to UNDER_REVIEW
  const handoffStatus = (db.prepare('SELECT status FROM handoffs WHERE id = ?').get(draftResult.handoff_id) as any).status;
  assert.equal(handoffStatus, 'UNDER_REVIEW');
  console.log('  Previous assignment marked TRANSFERRED; new assignment active for incoming nurse.');
  console.log('  Handoff status moved to UNDER_REVIEW.');
  console.log('  ✅ Test 7 PASSED: Custody transfer executed cleanly.\n');

  // Test 8: Finalize Reviewed Handoff
  console.log('Test 8: Finalizing reviewed handoff...');
  const finalizeKey = randomUUID();
  const finalResult = HandoffService.finalize(draftResult.handoff_id, incomingNurseId, finalizeKey, true);
  assert.equal(finalResult.status, 'FINALIZED');
  assert.equal(finalResult.externalSync, 'NOT_REQUESTED');

  const finalRecord = db.prepare('SELECT status, acknowledged_at FROM handoffs WHERE id = ?').get(draftResult.handoff_id) as { status: string; acknowledged_at: string };
  assert.equal(finalRecord.status, 'FINALIZED');
  assert(finalRecord.acknowledged_at !== null);
  console.log('  Handoff finalized locally with human sign-off timestamp.');
  console.log('  ✅ Test 8 PASSED: Local handoff sign-off finalized.\n');

  // Test 9: Retaining Local History & Provenance
  console.log('Test 9: Verifying local history and provenance retention in SQLite...');
  const events = db.prepare('SELECT event_type, previous_value, new_value, actor_id FROM task_events WHERE task_id = ? ORDER BY rowid ASC').all(candidateTaskId) as Array<{ event_type: string; previous_value: string; new_value: string; actor_id: string }>;
  console.log(`  Found ${events.length} immutable task event(s):`);
  for (const e of events) {
    console.log(`    - Event: ${e.event_type} | ${e.previous_value} -> ${e.new_value} | Actor: ${e.actor_id}`);
  }
  assert(events.some(e => e.event_type === 'REASSIGNMENT' && e.new_value === incomingNurseId));
  console.log('  All historical task events and previous assignment records preserved.');
  console.log('  ✅ Test 9 PASSED: Local history and provenance retention verified.\n');

  console.log('======================================================');
  console.log('🎉 ALL 9 HANDOFF INTEGRATION TESTS PASSED!');
  console.log('======================================================\n');
}

try {
  await runHandoffIntegrationVerification();
} catch (err) {
  console.error('❌ Integration verification failed:', err);
  process.exitCode = 1;
} finally {
  try {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
