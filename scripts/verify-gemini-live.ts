import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftweave-gemini-'));
Object.assign(process.env, { SQLITE_DB_PATH: path.join(directory, 'test.db'), LLM_PROVIDER: 'gemini', PORT: '0', HOST: '127.0.0.1', SHIFTWEAVE_TEST: '1', NODE_ENV: 'test',STAFF_AUTH_REQUIRED:'false',DEMO_USER:'',DEMO_PASSWORD:'', EPIC_READS_ENABLED: 'false', EPIC_WRITES_ENABLED: 'false' });
const { appServer } = await import('../src/server.js');
const { db } = await import('../src/db/connection.js');
const { importIncomingData } = await import('../src/db/ingest.js');
const { MCPClientBridge } = await import('../src/agent/mcp-client-bridge.js');
let bridge: InstanceType<typeof MCPClientBridge> | undefined;
try {
  importIncomingData();
  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address(); assert(address && typeof address !== 'string');
  bridge = new MCPClientBridge(`http://127.0.0.1:${address.port}/mcp`); await bridge.initialize();
  const session = randomUUID();
  const intro = await bridge.callTool('voice_turn', { session_id: session, utterance: 'I am Seema', expected_revision: 0, idempotency_key: randomUUID() });
  assert(!intro.isError, intro.content[0]?.text || 'Introduction failed');
  const revision = JSON.parse(intro.content[0]!.text).revision;
  const input = { session_id: session, utterance: 'Ask assistant, summarize my assigned tasks for this shift', expected_revision: revision, idempotency_key: randomUUID() };
  const start = Date.now();
  const result = await bridge.callTool('voice_turn', input);
  assert(!result.isError, result.content[0]?.text || 'Assistant turn failed');
  const elapsedMs = Date.now() - start;
  const display = JSON.parse(result.content[0]!.text);
  const decisions = db.prepare("SELECT outcome,latency_ms,details FROM audit_log WHERE action='LLM:DECISION'").all();
  assert(decisions.length > 0, 'No real model decision was recorded');
  const retry = await bridge.callTool('voice_turn', input); assert.deepEqual(retry, result);
  const evidence = { verifiedAt: new Date().toISOString(), provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', status: 'PASSED', elapsedMs, speech: display.speech, decisions, retry: 'IDENTICAL_SAVED_RESPONSE', data: 'ISOLATED_SYNTHETIC_FIXTURES' };
  fs.writeFileSync('deploy/gemini-live-report.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const message = (error instanceof Error ? error.message : String(error)).split(process.env.GEMINI_API_KEY || 'NO_KEY_PRESENT').join('[REDACTED]');
  const evidence = { checkedAt: new Date().toISOString(), provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', status: 'FAILED', error: message };
  fs.writeFileSync('deploy/gemini-live-report.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2)); process.exitCode = 1;
} finally {
  await bridge?.close(); await new Promise<void>(resolve => appServer.close(() => resolve())); db.close();
  const resolved = fs.realpathSync(directory);
  if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith('shiftweave-gemini-')) fs.rmSync(resolved, { recursive: true });
}
