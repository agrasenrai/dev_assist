import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appServer } from '../src/server.js';
import { db } from '../src/db/connection.js';
import { importIncomingData } from '../src/db/ingest.js';
import { MCPClientBridge } from '../src/agent/mcp-client-bridge.js';
import { ShiftWeaveOrchestrator } from '../src/agent/orchestrator.js';
import { toBedrockMessages, getLLMProvider, type AgentMessage } from '../src/agent/llm-provider.js';
import { CheckpointService } from '../src/services/checkpoint.service.js';
import { HandoffService } from '../src/services/handoff.service.js';
import { ConflictService } from '../src/services/conflict.service.js';
import { RecoveryService } from '../src/services/recovery.service.js';
import { SQLiteCacheProvider } from '../src/providers/sqlite-cache-provider.js';

if (process.env.SHIFTWEAVE_TEST !== '1') throw new Error('Use npm test; tests must run against a temporary database');
const mode = process.argv[2] || 'all';
const bridges: MCPClientBridge[] = [];
let checks = 0;
function check(name: string, action: () => unknown) { action(); checks++; console.log(`PASS ${name}`); }
async function worker(action: string, runId: string, endpoint: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/restart-worker.ts', action, runId], {
    env: { ...process.env, MCP_SERVER_URL: endpoint }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const [code] = await once(child, 'exit');
  return { code, output };
}

try {
  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const endpoint = base + '/mcp';
  check('readiness probe responds', () => assert(appServer.listening));
  const badOrigin = await fetch(base + '/mcp', { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
  check('MCP rejects untrusted origins', () => assert.equal(badOrigin.status, 403));
  importIncomingData();
  const countBeforeImport = db.prepare('SELECT count(*) AS n FROM operation_receipts').get() as { n: number };
  importIncomingData();
  check('identical ingestion is idempotent', () => assert.deepEqual(db.prepare('SELECT count(*) AS n FROM operation_receipts').get(), countBeforeImport));
  const bridge = new MCPClientBridge(endpoint); bridges.push(bridge);
  const handshake = await bridge.initialize();
  check('stateful MCP protocol negotiation', () => assert.equal(handshake.version, '2025-11-25'));
  const discovered = await bridge.listTools();
  check('runtime discovery exposes workflow and voice tools', () => {
    assert.equal(discovered.length, 16);
    assert(discovered.some(t => t.name === 'voice_turn'));
    assert(discovered.some(t => t.name === 'get_voice_display'));
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await bridge.callTool(name, args);
    assert(!result.isError, result.content[0]?.text || 'MCP tool failed');
    return JSON.parse(result.content[0]!.text);
  };
  const tasks = await rpc('get_assigned_tasks', { nurse_id: 'nurse_seema_01', shift_id: 'shift_20261019_night' });
  check('assigned task count is real', () => assert.equal(tasks.tasks_count, 2));
  for (const route of ['/api/tasks', '/api/handoffs', '/api/conflicts', '/api/execution-trace']) {
    const response = await fetch(base + route);
    check(`dashboard route ${route}`, () => assert.equal(response.status, 200));
    const json = await response.json();
    if (route.endsWith('execution-trace')) check('trace is mapped to frontend fields', () => assert.equal(typeof json.logs[0].actorType, 'string'));
    if (route.endsWith('tasks')) check('carried-forward assignment remains visible', () => assert.equal(json.tasks.find((t: any) => t.id === 'task_med_102_03').assignedNurseId, 'nurse_seema_01'));
  }
  const unknownRecovery = await bridge.callTool('resume_workflow', { workflow_run_id: 'missing', idempotency_key: randomUUID() });
  check('missing recovery is a tool error', () => assert.equal(unknownRecovery.isError, true));
  const switchResponse = await fetch(base + '/api/provider/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: 'live-fhir-api' }) });
  check('unconfigured FHIR never silently returns local data', () => assert.equal(switchResponse.status, 400));
  const unknownPatients = await new SQLiteCacheProvider().getPatientsByUnit('UNKNOWN');
  check('unknown unit never leaks all patients', () => assert.deepEqual(unknownPatients, []));

  if (mode !== 'mcp') {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const invalid = await post('/api/chat', { utterance: '' });
    check('invalid chat input is a 400 response', () => assert.equal(invalid.status, 400));
    const chatInput = { utterance: 'Prepare a handoff draft', workflowRunId: randomUUID(), idempotency_key: randomUUID() };
    const chat = await post('/api/chat', chatInput);
    check('HTTP chat uses the actual ephemeral MCP port', () => assert.equal(chat.status, 200, JSON.stringify(chat.data)));
    const handoffCount = () => (db.prepare('SELECT count(*) AS n FROM handoffs').get() as { n: number }).n;
    const afterChat = handoffCount();
    const chatRetry = await post('/api/chat', chatInput);
    check('HTTP chat retry returns original persisted result', () => assert.deepEqual(chatRetry.data, chat.data));
    check('HTTP retry does not create another draft', () => assert.equal(handoffCount(), afterChat));
    const changedChat = await post('/api/chat', { ...chatInput, utterance: 'Different request' });
    check('HTTP chat retry key rejects changed input', () => assert.equal(changedChat.status, 409));
    const conversation = await fetch(base + `/api/conversations/${chatInput.workflowRunId}?nurseId=nurse_reema_02`);
    check('persisted conversation is retrievable after HTTP orchestrator cleanup', () => assert.equal(conversation.status, 200));
    const forbidden = await fetch(base + `/api/conversations/${chatInput.workflowRunId}?nurseId=nurse_seema_01`);
    check('HTTP conversation enforces its demo nurse binding', () => assert.equal(forbidden.status, 403));
    const crashApi = await post('/api/chaos/simulate', { action: 'crash' });
    check('chaos API returns a real checkpoint', () => assert.equal(crashApi.data.checkpointId,
      CheckpointService.getLatestCheckpoint(crashApi.data.workflowRunId)?.id));
    const recoverApi = await post('/api/chaos/simulate', { action: 'recover', workflowRunId: crashApi.data.workflowRunId });
    check('chaos API restores actual committed result count', () => assert.equal(recoverApi.data.result.avoidedDuplicateStepsCount, 2));

    const runId = randomUUID();
    const agent = new ShiftWeaveOrchestrator(endpoint, 'mock', runId);
    await agent.initialize();
    const first = await agent.processUtterance('nurse_reema_02', 'Prepare my handoff draft');
    await agent.close();
    check('draft narrative uses current task metrics', () => assert.match(first.speech, /2 assigned tasks/));
    const draftCount = (db.prepare('SELECT count(*) AS n FROM handoffs').get() as { n: number }).n;
    const fresh = new ShiftWeaveOrchestrator(endpoint, 'mock', runId); await fresh.initialize();
    const done = await fresh.processUtterance('nurse_reema_02', 'Resume handoff');
    check('completed workflow resume does not create another draft', () => assert.deepEqual(done.toolsExecuted.map(t => t.name), ['resume_workflow']));
    check('history is restored in a fresh orchestrator', () => assert(fresh.getConversationHistory().length > 2));
    const followup = await fresh.processUtterance('nurse_reema_02', 'What are Elena allergies?');
    check('patient response is grounded in retrieved details', () => assert.match(followup.speech, /Latex, Sulfa/));
    await fresh.close();
    const interruptedId = randomUUID();
    const interrupt = new ShiftWeaveOrchestrator(endpoint, 'mock', interruptedId); await interrupt.initialize();
    await assert.rejects(interrupt.processUtterance('nurse_reema_02', 'Prepare handoff', { simulateInterruptionAtStep: 3 }), /CHAOS SIMULATION/);
    await interrupt.close();
    const checkpoint = CheckpointService.getLatestCheckpoint(interruptedId)!;
    check('interruption saves an actual checkpoint', () => assert(checkpoint.statePayload.messages));
    const restart = new ShiftWeaveOrchestrator(endpoint, 'mock', interruptedId); await restart.initialize();
    const recovered = await restart.processUtterance('nurse_reema_02', 'Resume handoff'); await restart.close();
    check('recovery skips committed reads', () => assert.deepEqual(recovered.toolsExecuted.map(t => t.name), ['resume_workflow', 'create_handoff_draft']));
    check('completion is recorded', () => assert.equal((db.prepare('SELECT status FROM workflow_runs WHERE id = ?').get(interruptedId) as any).status, 'COMPLETED'));
    const changedRun = randomUUID();
    const beforeChange = new ShiftWeaveOrchestrator(endpoint, 'mock', changedRun); await beforeChange.initialize();
    await assert.rejects(beforeChange.processUtterance('nurse_reema_02', 'Prepare handoff', { simulateInterruptionAtStep: 3 }), /CHAOS/);
    await beforeChange.close();
    db.prepare("UPDATE tasks SET title = 'Updated recorded task' WHERE id = 'task_vital_101_01'").run();
    const afterChange = new ShiftWeaveOrchestrator(endpoint, 'mock', changedRun); await afterChange.initialize();
    const refreshed = await afterChange.processUtterance('nurse_reema_02', 'Resume handoff'); await afterChange.close();
    check('recovery refreshes reads when source records changed', () => assert(refreshed.toolsExecuted.some(tool => tool.name === 'get_assigned_tasks')));
    check('recovered response reflects changed source values', () => assert.match(refreshed.speech, /Updated recorded task/));
    const oldStatus = (db.prepare("SELECT status FROM tasks WHERE id = 'task_med_102_03'").get() as any).status;
    const flag = { task_id: 'task_med_102_03', nurse_id: 'nurse_reema_02', action: 'FLAG_FOR_SUPERVISOR',
      resolution_note: 'Please review conflicting documentation', human_confirmed: true, idempotency_key: randomUUID() };
    await rpc('acknowledge_task', flag); await rpc('acknowledge_task', flag);
    check('escalation does not complete medication workflow', () => assert.equal((db.prepare("SELECT status FROM tasks WHERE id = 'task_med_102_03'").get() as any).status, oldStatus));
    check('acknowledgement retry writes one event', () => assert.equal((db.prepare('SELECT count(*) AS n FROM task_events WHERE idempotency_key = ?').get(flag.idempotency_key) as any).n, 1));
    const collision = await bridge.callTool('acknowledge_task', { ...flag, resolution_note: 'different' });
    check('same key with changed payload is rejected', () => assert.equal(collision.isError, true));
    const draft = db.prepare('SELECT id FROM handoffs ORDER BY rowid ASC LIMIT 1').get() as { id: string };
    check('draft creation does not transfer custody', () => assert.equal((db.prepare("SELECT nurse_id FROM task_assignments WHERE task_id = 'task_med_102_03' AND transfer_status IN ('ACTIVE','CARRIED_FORWARD')").get() as any).nurse_id, 'nurse_seema_01'));
    const acceptance = { ...flag, action: 'ACCEPT_HANDOFF', handoff_id: draft.id, idempotency_key: randomUUID() };
    check('unresolved conflict blocks acceptance', () => assert.throws(() => HandoffService.acknowledge(acceptance), /Resolve discrepancy/));
    const key = randomUUID();
    assert(ConflictService.resolveConflict('conf_task_med_102_03', 'nurse_reema_02', 'IN_PROGRESS', 'Human verified work still pending', key));
    assert(ConflictService.resolveConflict('conf_task_med_102_03', 'nurse_reema_02', 'IN_PROGRESS', 'Human verified work still pending', key));
    check('conflict resolution retry writes one transition', () => assert.equal((db.prepare('SELECT count(*) AS n FROM task_events WHERE idempotency_key = ?').get(key) as any).n, 1));
    HandoffService.acknowledge(acceptance);
    HandoffService.acknowledge(acceptance);
    check('explicit acceptance transfers custody exactly once', () => assert.equal((db.prepare("SELECT count(*) AS n FROM task_assignments WHERE task_id = 'task_med_102_03' AND nurse_id = 'nurse_reema_02'").get() as any).n, 1));
    const finalizeKey = randomUUID();
    HandoffService.finalize(draft.id, 'nurse_reema_02', finalizeKey, true);
    HandoffService.finalize(draft.id, 'nurse_reema_02', finalizeKey, true);
    check('reviewed handoff sign-off persists once', () => assert.equal((db.prepare('SELECT status FROM handoffs WHERE id = ?').get(draft.id) as any).status, 'FINALIZED'));
    check('acceptance preserves task status', () => assert.equal((db.prepare("SELECT status FROM tasks WHERE id = 'task_med_102_03'").get() as any).status, 'IN_PROGRESS'));

    check('drafts remain persisted', () => assert(draftCount > 0));
    const denied = new ShiftWeaveOrchestrator(endpoint, 'mock', runId); await denied.initialize();
    await assert.rejects(denied.processUtterance('nurse_seema_01', 'Resume'), /another nurse/); await denied.close();
    check('cross-nurse rejection preserves the original owner', () => assert.equal((db.prepare('SELECT initiated_by FROM workflow_runs WHERE id = ?').get(runId) as any).initiated_by, 'nurse_reema_02'));
    const clinical = new ShiftWeaveOrchestrator(endpoint, 'mock'); await clinical.initialize();
    const refusal = await clinical.processUtterance('nurse_reema_02', 'Prescribe a new medication'); await clinical.close();
    check('clinical recommendation request is refused', () => assert.equal(refusal.toolsExecuted.length, 0));
    const messages: AgentMessage[] = [{ role: 'user', content: 'status' }, { role: 'assistant', content: '',
      toolCallId: 'abc', toolCall: { toolName: 'get_assigned_tasks', arguments: {} } },
      { role: 'tool', toolName: 'get_assigned_tasks', toolCallId: 'abc', content: '{"tasks":[]}' }];
    check('Bedrock keeps matching toolUse/toolResult IDs', () => assert.equal(toBedrockMessages(messages)[2]?.content?.[0]?.toolResult?.toolUseId, 'abc'));
    check('unknown LLM mode is not silently mocked', () => assert.throws(() => getLLMProvider('invalid'), /Unknown/));
    check('removed Gemini mode is rejected explicitly',()=>assert.throws(()=>getLLMProvider('gemini'),/Unknown/));
  }

  if (mode === 'all' || mode === 'chaos') {
    const runId = randomUUID();
    const count = () => (db.prepare('SELECT count(*) AS n FROM handoffs').get() as { n: number }).n;
    const before = count();
    const crash = await worker('crash', runId, endpoint);
    check('worker exits after committed draft before result checkpoint', () => assert.equal(crash.code, 77, crash.output));
    assert.equal(count(), before + 1);
    assert.equal(CheckpointService.getLatestCheckpoint(runId)?.stepName, 'INTENT:create_handoff_draft');
    const recovery = await worker('recover', runId, endpoint);
    check('fresh process recovers ambiguous committed mutation', () => assert.equal(recovery.code, 0, recovery.output));
    check('lost mutation response does not duplicate draft', () => assert.equal(count(), before + 1));
    const plan = RecoveryService.reconcileAndResume(runId, randomUUID());
    check('completed process restart is recognized', () => assert.equal(plan.recoveryStatus, 'ALREADY_COMPLETED'));
  }
  if (mode === 'all') {
    const { verifyVoice } = await import('./verify-voice.js');
    await verifyVoice(base, check);
    const { verifyVoiceConversation } = await import('./verify-voice-conversation.js');
    await verifyVoiceConversation(base,check);
  }
  console.log(`\n${checks} meaningful checks passed (${mode}); isolated database only.`);
} finally {
  for (const bridge of bridges) await bridge.close();
  await new Promise<void>(resolve => appServer.close(() => resolve()));
  db.close();
}
