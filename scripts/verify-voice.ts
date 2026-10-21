import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db/connection.js';
import { MCPClientBridge } from '../src/agent/mcp-client-bridge.js';
import { VoiceService } from '../src/services/voice.service.js';
import { CheckpointService } from '../src/services/checkpoint.service.js';

export async function verifyVoice(base: string, check: (name: string, action: () => unknown) => void) {
  // Dedicated synthetic unit so the pre-existing recovery tests keep their fixtures.
  db.prepare(`INSERT INTO nurses (id, badge_number, full_name, email, department) VALUES
    ('voice_nora', 'VOICE-1', 'Nora Test, RN', 'nora@example.test', 'VOICE'),
    ('voice_maya', 'VOICE-2', 'Maya Test, RN', 'maya@example.test', 'VOICE'),
    ('voice_other', 'VOICE-3', 'Nora Other, RN', 'other@example.test', 'OTHER')`).run();
  db.prepare(`INSERT INTO shifts (id, unit_id, shift_type, start_time, end_time) VALUES
    ('voice_shift', 'VOICE', 'DAY', '2026-10-20T07:00:00Z', '2026-10-20T19:00:00Z')`).run();
  db.prepare(`INSERT INTO patients (id, mrn, full_name, room_number, admission_date, acuity_level, primary_diagnosis)
    VALUES ('voice_patient', 'VOICE-MRN', 'Demo Patient', 'Room 901', '2026-10-20', 2, 'Synthetic record')`).run();
  db.prepare(`INSERT INTO tasks (id, patient_id, title, category, status, priority, scheduled_time) VALUES
    ('voice_task', 'voice_patient', 'Review documented shift checklist', 'CONSULT', 'FLAGGED_CONFLICT', 'ROUTINE', '2026-10-20')`).run();
  db.prepare(`INSERT INTO task_assignments (id, task_id, nurse_id, shift_id, assigned_by)
    VALUES ('voice_assignment', 'voice_task', 'voice_nora', 'voice_shift', 'DEMO')`).run();
  db.prepare(`INSERT INTO conflicts (id, task_id, conflict_type, system_a_name, system_a_val, system_b_name, system_b_val)
    VALUES ('voice_conflict', 'voice_task', 'STATUS_MISMATCH', 'Demo checklist', 'Completed', 'Demo shift note', 'Pending')`).run();
  const session = randomUUID();
  let revision = 0;
  const post = async (body: unknown) => {
    const res = await fetch(base + '/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const say = async (utterance: string) => {
    const result = await post({ session_id: session, utterance, expected_revision: revision, idempotency_key: randomUUID() });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    revision = result.data.revision;
    return result.data;
  };
  let result = await say('Show my tasks');
  check('voice requires introduction before revealing records', () => { assert.equal(result.nurse, null); assert.equal(result.tasks.length, 0); });
  result = await say('Hi, I am Nora');
  check('ambiguous nurse names require clarification without selecting a profile', () => { assert.equal(result.nurse, null); assert.match(result.speech, /More than one/); });
  const intro = { session_id: session, utterance: 'Hi, I am Nora Test. Let me know my tasks', expected_revision: revision, idempotency_key: randomUUID() };
  const original = await post(intro); assert.equal(original.status, 200);
  revision = original.data.revision;
  check('voice introduction scopes tasks and speech to the nurse', () => {
    assert.equal(original.data.nurse.id, 'voice_nora'); assert.equal(original.data.tasks.length, 1);
    assert.match(original.data.speech, /1 assigned tasks/); assert.equal(original.data.tasks[0].id, 'voice_task');
  });
  const retry = await post(intro);
  check('lost voice response retry returns exact saved response', () => assert.deepEqual(retry.data, original.data));
  const changed = await post({ ...intro, utterance: 'I am Maya' });
  check('voice retry key cannot be reused for another identity', () => assert.equal(changed.status, 409));
  const assistantInput = { session_id: session, utterance: 'Ask assistant, summarize my shift',
    expected_revision: revision, idempotency_key: randomUUID() };
  const assistant = await post(assistantInput);
  check('voice assistant uses MCP planning with nurse-scoped facts', () => {
    assert.equal(assistant.status, 200, JSON.stringify(assistant.data));
    assert.match(assistant.data.speech, /Demo Patient/);
    assert.equal(assistant.data.nurse.id, 'voice_nora');
  });
  revision = assistant.data.revision;
  check('voice assistant commits a display checkpoint', () => assert.equal(
    CheckpointService.getLatestCheckpoint(`voice:${session}`)?.stepName, 'VOICE_AGENT_RESULT'));
  const assistantRetry = await post(assistantInput);
  check('voice assistant retry returns the committed display', () => assert.deepEqual(assistantRetry.data, assistant.data));
  const epicFailure = await post({ session_id: session, utterance: 'Read Epic patient not-allowed',
    expected_revision: revision, idempotency_key: randomUUID() });
  check('unconfigured Epic voice read is an explicit error without advancing display', () => {
    assert.equal(epicFailure.status, 409);
    assert.equal(VoiceService.read(session).revision, revision);
  });
  const bridge = new MCPClientBridge(base + '/mcp');
  try {
    await bridge.initialize();
    const restored = await bridge.callTool('get_voice_display', { session_id: session });
    check('fresh MCP session restores durable voice state', () => {
      assert.equal(JSON.parse(restored.content[0]!.text).nurse.id, 'voice_nora');
      assert(CheckpointService.getLatestCheckpoint(`voice:${session}`)?.statePayload.voice);
    });
  } finally { await bridge.close(); }
  result = await say('Explain the discrepancy in room 901');
  check('spoken discrepancy and display preserve both source values', () => {
    assert.match(result.speech, /Demo checklist says Completed/);
    assert.equal(result.focus, 'conflicts'); assert.equal(result.selectedTaskId, 'voice_task');
  });
  result = await say('Resolve discrepancy in room 901');
  check('voice review collects status and note before confirmation', () => assert.equal(result.pending.ready, false));
  result = await say('In progress because I reviewed the source records');
  check('spoken review is staged without changing the task', () => {
    assert.equal(result.pending.ready, true);
    assert.equal((db.prepare('SELECT status FROM tasks WHERE id = ?').get('voice_task') as any).status, 'FLAGGED_CONFLICT');
  });
  result = await say('No');
  check('spoken cancellation discards the pending mutation', () => assert.equal(result.pending, null));
  await say('Resolve discrepancy in room 901 as in progress because records reviewed');
  result = await say('I am Unknown Person');
  check('unknown speaker clears identity, display, and pending confirmation', () => {
    assert.equal(result.nurse, null); assert.equal(result.pending, null); assert.deepEqual(result.tasks, []);
  });
  await say('I am Nora Test');
  result = await say('Confirm');
  check('switching identity cannot confirm the previous action', () => assert.match(result.speech, /no complete action/));
  await say('Resolve discrepancy in room 901 as in progress because records reviewed');
  db.prepare("UPDATE tasks SET priority = 'URGENT' WHERE id = 'voice_task'").run();
  result = await say('Confirm');
  check('changed records invalidate voice confirmation', () => { assert.match(result.speech, /records changed/); assert.equal(result.pending, null); });
  await say('Resolve discrepancy in room 901 as in progress because records reviewed again');
  const confirmation = { session_id: session, utterance: 'Confirm', expected_revision: revision, idempotency_key: randomUUID() };
  const confirmed = await post(confirmation); revision = confirmed.data.revision;
  const confirmedRetry = await post(confirmation);
  check('spoken confirmation commits once with an atomic checkpoint', () => {
    assert.deepEqual(confirmedRetry.data, confirmed.data);
    assert.equal((db.prepare("SELECT count(*) AS n FROM task_events WHERE task_id = 'voice_task'").get() as any).n, 1);
    assert.equal((db.prepare("SELECT status FROM tasks WHERE id = 'voice_task'").get() as any).status, 'IN_PROGRESS');
  });
  result = await say('Do not prepare my handoff for Maya');
  check('negated request does not create a draft', () => assert.match(result.speech, /No action taken/));
  result = await say('Prepare my handoff for Maya');
  const handoffId = result.selectedHandoffId;
  check('spoken draft uses the active outgoing nurse and named receiver', () => {
    assert.equal(result.handoffs[0].outgoingId, 'voice_nora'); assert.equal(result.handoffs[0].incomingId, 'voice_maya');
    assert.equal(result.handoffs[0].status, 'DRAFT');
  });
  result = await say('Hi, I am Maya. What are my tasks?');
  check('incoming candidate tasks are distinct from assigned tasks', () => {
    assert.equal(result.tasks.length, 0); assert.equal(result.candidates.length, 1);
    assert(!result.messages.some((m: any) => m.text === intro.utterance));
  });
  await say('Accept all handoff tasks');
  result = await say('Confirm');
  check('explicit spoken acceptance transfers custody while preserving task status', () => {
    assert.equal(result.tasks.length, 1); assert.equal(result.tasks[0].status, 'IN_PROGRESS');
    assert.equal(result.candidates.length, 0);
  });
  await say('Finalize my handoff');
  result = await say('Yes');
  check('spoken sign-off persists local finalization', () => assert.equal(result.handoffs.find((h: any) => h.id === handoffId).status, 'FINALIZED'));
  result = await say('Increase the dose');
  check('voice clinical recommendation request is refused', () => assert.match(result.speech, /clinical team/));
  const stale = await post({ session_id: session, utterance: 'Confirm', expected_revision: 0, idempotency_key: randomUUID() });
  check('stale voice turns are rejected', () => assert.equal(stale.status, 409));
  await say('End my session');
  const ended = await fetch(base + `/api/voice/${session}`).then(r => r.json());
  check('ending the voice session clears the persistent display', () => {
    assert.equal(ended.nurse, null); assert.equal(ended.handoffs.length, 0); assert.equal(ended.tasks.length, 0);
  });
  check('independent display sessions do not inherit another nurse', () => assert.equal(VoiceService.read(randomUUID()).nurse, null));
}
