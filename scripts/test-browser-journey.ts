import dotenv from 'dotenv';
dotenv.config();

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

// Every invocation gets its own isolated database. Never mutate the shared demo DB.
const root = realpathSync(tmpdir());
const tempDir = mkdtempSync(path.join(root, 'shiftweave-browser-test-'));
process.env.SQLITE_DB_PATH = path.join(tempDir, 'test.db');
process.env.PORT = '0';
process.env.LLM_PROVIDER = 'mock';
process.env.SHIFTWEAVE_TEST = '1';

const { db } = await import('../src/db/connection.js');
const { initializeDatabase } = await import('../src/db/schema.js');
const { importIncomingData } = await import('../src/db/ingest.js');
const { appServer } = await import('../src/server.js');

async function runBrowserVerification() {
  console.log('======================================================');
  console.log('🌐 ShiftWeave — Step 6: Browser & Voice Journey Verification');
  console.log('======================================================\n');

  // Initialize DB and synthetic baseline
  initializeDatabase();
  importIncomingData();
  db.prepare("DELETE FROM handoffs").run();
  db.prepare("DELETE FROM task_assignments WHERE id NOT IN ('asgn_8812', 'asgn_8813')").run();
  db.prepare("UPDATE task_assignments SET transfer_status = 'ACTIVE', nurse_id = 'nurse_seema_01'").run();
  db.prepare("UPDATE conflicts SET status = 'UNRESOLVED' WHERE task_id = 'task_med_102_03'").run();
  db.prepare("UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = 'task_med_102_03'").run();

  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  console.log(`  Connected to running ShiftWeave Express server at ${base}`);

  // Test 1: Static Asset Delivery
  console.log('\nTest 1: Verifying frontend static distribution serving (index.html)...');
  const indexRes = await fetch(`${base}/`);
  assert.equal(indexRes.status, 200);
  const indexHtml = await indexRes.text();
  assert(indexHtml.includes('<div id="root">') || indexHtml.includes('<!DOCTYPE html>'), 'Missing index.html shell');
  console.log('  Frontend index.html served successfully with HTTP 200.');
  console.log('  ✅ Test 1 PASSED: Browser asset distribution verified.');

  const sessionId = randomUUID();
  let currentRevision = 0;

  const readDisplay = async () => {
    const res = await fetch(`${base}/api/voice/${sessionId}`);
    assert.equal(res.status, 200);
    return res.json();
  };

  const sendTurn = async (utterance: string, expectedRevision: number, key = randomUUID()) => {
    const res = await fetch(`${base}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        utterance,
        expected_revision: expectedRevision,
        idempotency_key: key,
      }),
    });
    const data = await res.json();
    return { status: res.status, data };
  };

  // Test 2: Initial Display State
  console.log('\nTest 2: Verifying initial display state (GET /api/voice/:sessionId)...');
  const initial = await readDisplay();
  assert.equal(initial.revision, 0);
  assert.equal(initial.nurse, null);
  assert(initial.speech.includes('Hello. Say'));
  console.log('  Initial display received with prompt greeting.');
  console.log('  ✅ Test 2 PASSED: Initial display verified.');

  // Test 3: Seema Patel Introduction
  console.log('\nTest 3: Browser Voice Turn — "Hi, I am Seema"...');
  const turn1 = await sendTurn('Hi, I am Seema', currentRevision);
  assert.equal(turn1.status, 200);
  currentRevision = turn1.data.revision;
  assert.equal(turn1.data.nurse?.name, 'Seema Patel, RN');
  assert.equal(turn1.data.tasks.length, 2);
  console.log(`  Nurse recognized: ${turn1.data.nurse.name} (Assigned tasks: ${turn1.data.tasks.length})`);
  console.log(`  Speech: "${turn1.data.speech}"`);
  console.log('  ✅ Test 3 PASSED: Seema introduction verified.');

  // Test 4: Task Inspection
  console.log('\nTest 4: Browser Voice Turn — "Explain room 305"...');
  const turn2 = await sendTurn('Explain room 305', currentRevision);
  assert.equal(turn2.status, 200);
  currentRevision = turn2.data.revision;
  assert(turn2.data.speech.includes('Elena Rostova') || turn2.data.speech.includes('305'));
  assert.equal(turn2.data.selectedTaskId, 'task_med_102_03');
  console.log(`  Task details resolved: ${turn2.data.speech}`);
  console.log('  ✅ Test 4 PASSED: Room task explanation verified.');

  // Test 5: Discrepancy Review
  console.log('\nTest 5: Browser Voice Turn — "Review discrepancies"...');
  const turn3 = await sendTurn('Review discrepancies', currentRevision);
  assert.equal(turn3.status, 200);
  currentRevision = turn3.data.revision;
  assert.equal(turn3.data.focus, 'conflicts');
  assert(turn3.data.speech.includes('says'));
  console.log(`  Discrepancy review: ${turn3.data.speech}`);
  console.log('  ✅ Test 5 PASSED: Discrepancy review verified.');

  // Test 6: Staging & Confirming Discrepancy Resolution
  console.log('\nTest 6: Browser Voice Turn — Staging resolution: "Resolve discrepancy in room 305 in progress because verified with pharmacy"...');
  const turn4 = await sendTurn('Resolve discrepancy in room 305 in progress because verified with pharmacy', currentRevision);
  assert.equal(turn4.status, 200);
  currentRevision = turn4.data.revision;
  assert(turn4.data.pending !== null, 'Expected pending confirmation');
  assert(turn4.data.pending.prompt.includes('Say “confirm” or “cancel”'));
  console.log(`  Pending confirmation staged: "${turn4.data.pending.prompt}"`);

  console.log('  Confirming action via "Yes confirm"...');
  const turn5 = await sendTurn('Yes confirm', currentRevision);
  assert.equal(turn5.status, 200);
  currentRevision = turn5.data.revision;
  assert(turn5.data.speech.includes('review was saved'));
  console.log(`  Confirmed: ${turn5.data.speech}`);
  console.log('  ✅ Test 6 PASSED: Discrepancy staged and confirmed.');

  // Test 7: Handoff Preparation for Named Recipient (Reema)
  console.log('\nTest 7: Browser Voice Turn — "Prepare my handoff for Reema"...');
  // Mark task as IN_PROGRESS to have a carry-forward candidate
  db.prepare("UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = 'task_med_102_03'").run();
  db.prepare("UPDATE task_assignments SET nurse_id = 'nurse_seema_01', transfer_status = 'ACTIVE' WHERE task_id = 'task_med_102_03'").run();

  const turn6 = await sendTurn('Prepare my handoff for Reema', currentRevision);
  assert.equal(turn6.status, 200);
  currentRevision = turn6.data.revision;
  assert(turn6.data.speech.includes('handoff draft for Reema Roy, RN is ready'));
  assert.equal(turn6.data.focus, 'handoff');

  // Verify custody invariant: Seema remains custodian
  const seemaCustody = db.prepare("SELECT nurse_id FROM task_assignments WHERE task_id = 'task_med_102_03' AND transfer_status = 'ACTIVE'").get() as { nurse_id: string };
  assert.equal(seemaCustody.nurse_id, 'nurse_seema_01');
  console.log('  Custody invariant preserved: Seema remains assigned nurse after draft creation.');
  console.log('  ✅ Test 7 PASSED: Handoff draft created with custody intact.');

  // Test 8: Nurse Profile Switch (Incoming Nurse Reema)
  console.log('\nTest 8: Browser Voice Turn — "Hi, I am Reema"...');
  const turn7 = await sendTurn('Hi, I am Reema', currentRevision);
  assert.equal(turn7.status, 200);
  currentRevision = turn7.data.revision;
  assert.equal(turn7.data.nurse?.name, 'Reema Roy, RN');
  assert(turn7.data.candidates.length > 0, 'Expected incoming handoff candidates for Reema');
  console.log(`  Switched identity to: ${turn7.data.nurse.name} (Incoming candidate tasks: ${turn7.data.candidates.length})`);
  console.log('  ✅ Test 8 PASSED: Nurse switch and incoming handoff candidate display verified.');

  // Test 9: Spoken Custody Acceptance
  console.log('\nTest 9: Browser Voice Turn — Staging custody acceptance: "Accept all handoff tasks"...');
  const turn8 = await sendTurn('Accept all handoff tasks', currentRevision);
  assert.equal(turn8.status, 200);
  currentRevision = turn8.data.revision;
  assert(turn8.data.pending !== null);
  assert(turn8.data.pending.prompt.includes('Accept custody'));

  console.log('  Confirming custody acceptance: "Yes confirm"...');
  const turn9 = await sendTurn('Yes confirm', currentRevision);
  assert.equal(turn9.status, 200);
  currentRevision = turn9.data.revision;
  assert(turn9.data.speech.includes('accepted custody'));

  // Verify custody transferred in database
  const reemaCustody = db.prepare("SELECT nurse_id, transfer_status FROM task_assignments WHERE task_id = 'task_med_102_03' AND nurse_id = 'nurse_reema_02'").get() as { nurse_id: string; transfer_status: string };
  assert.equal(reemaCustody.transfer_status, 'ACTIVE');
  console.log('  Custody verified transferred to Reema in SQLite database.');
  console.log('  ✅ Test 9 PASSED: Explicit two-party custody acceptance confirmed.');

  // Test 10: Finalization
  console.log('\nTest 10: Browser Voice Turn — "Finalize handoff"...');
  const turn10 = await sendTurn('Finalize handoff', currentRevision);
  assert.equal(turn10.status, 200);
  currentRevision = turn10.data.revision;
  assert(turn10.data.pending !== null);

  console.log('  Confirming finalization: "Yes confirm"...');
  const turn11 = await sendTurn('Yes confirm', currentRevision);
  assert.equal(turn11.status, 200);
  currentRevision = turn11.data.revision;
  assert(turn11.data.speech.includes('finalized locally'));
  console.log('  ✅ Test 10 PASSED: Handoff local sign-off finalized.');

  // Test 11: End Session & Identity Clearing
  console.log('\nTest 11: Browser Voice Turn — "End my session"...');
  const turn12 = await sendTurn('End my session', currentRevision);
  assert.equal(turn12.status, 200);
  currentRevision = turn12.data.revision;
  assert.equal(turn12.data.nurse, null);
  assert(turn12.data.speech.includes('session has ended'));
  console.log('  Identity cleared, display reset.');
  console.log('  ✅ Test 11 PASSED: Session termination and security clearing verified.');

  // Test 12: Recovery & Error States in Browser API
  console.log('\nTest 12: Testing browser error and recovery states...');
  // A: Stale revision rejection
  const staleTurn = await sendTurn('What are my tasks?', 0); // wrong revision
  assert(staleTurn.status === 409 || staleTurn.status === 400, 'Expected 409 or 400 for stale revision');
  assert(staleTurn.data.error.includes('Voice session changed'));
  console.log('  Stale revision rejection: caught expected 409 Conflict with revision refresh prompt.');

  // B: Clinical boundary refusal (re-introduce nurse to test during active shift)
  const intro = await sendTurn('Hi, I am Seema', currentRevision);
  currentRevision = intro.data.revision;

  const boundaryTurn = await sendTurn('Prescribe 500mg amoxicillin and recommend diagnosis', currentRevision);
  assert.equal(boundaryTurn.status, 200);
  currentRevision = boundaryTurn.data.revision;
  assert(boundaryTurn.data.speech.includes('Diagnosis, treatment, medication administration and order changes require the clinical team'));
  console.log('  Clinical safety guard: autonomous diagnosis/prescription request refused.');

  // C: Idempotent turn retry
  const retryKey = randomUUID();
  const resA = await sendTurn('Explain room 305', currentRevision, retryKey);
  const resB = await sendTurn('Explain room 305', currentRevision, retryKey);
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
  assert.equal(resA.data.revision, resB.data.revision);
  assert.equal(resA.data.speech, resB.data.speech);
  console.log('  Idempotent turn retry returned exact saved response.');
  console.log('  ✅ Test 12 PASSED: Browser error, safety boundaries, and retry states verified.\n');

  appServer.close();

  // Clean up temporary isolated test directory
  try {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  console.log('======================================================');
  console.log('🎉 ALL 12 BROWSER JOURNEY VERIFICATION TESTS PASSED!');
  console.log('======================================================\n');
}

runBrowserVerification().catch((err) => {
  console.error('❌ Browser verification failed:', err);
  process.exit(1);
});
