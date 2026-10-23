import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import 'dotenv/config';
import Database from 'better-sqlite3';

const root = realpathSync(tmpdir());
const directory = mkdtempSync(path.join(root, 'shiftweave-deploy-'));
Object.assign(process.env, { SQLITE_DB_PATH: path.join(directory, 'test.db'), HOST: '127.0.0.1', PORT: '0',
  NODE_ENV: 'production', SHIFTWEAVE_TEST: '1', LLM_PROVIDER: 'bedrock', EPIC_CLIENT_ID: '', EPIC_READS_ENABLED: 'false',
  EPIC_WRITES_ENABLED: 'false',STAFF_AUTH_REQUIRED:'false',EPIC_CREATE_REVIEW_TASKS:'true',
  HOSPITAL_SIMULATION_ENABLED:'false',HOSPITAL_DATA_SOURCE:'sqlite',SIMULATION_MODE:'false',
  PUBLIC_ORIGIN: 'https://demo.shiftweave.test',
  MCP_AUTH_TOKEN: randomBytes(32).toString('hex') });
// Provision the isolated database explicitly; production must not invent a missing database.
new Database(process.env.SQLITE_DB_PATH!).close();
const { appServer } = await import('../src/server.js');
const { db } = await import('../src/db/connection.js');
const { MCPClientBridge } = await import('../src/agent/mcp-client-bridge.js');
const bridge = new MCPClientBridge();
try {
  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(base + '/readyz')).status, 200);
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://evil.test' } })).status, 403);
  const authenticated = new MCPClientBridge(base + '/mcp');
  for (const method of ['POST', 'GET', 'DELETE']) {
    assert.equal((await fetch(base + '/mcp', { method })).status, 401);
    assert.equal((await fetch(base + '/mcp', { method, headers: { Authorization: 'Bearer incorrect' } })).status, 401);
  }
  const oldProtocol = await fetch(base + '/mcp', { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) });
  assert.equal(oldProtocol.status, 400);
  try {
    assert.equal((await authenticated.initialize()).version, '2025-11-25');
    assert((await authenticated.listTools()).some(t => t.name === 'get_epic_patient_context'));
    const deniedWrite = await authenticated.callTool('publish_reviewed_handoff_note', {
      handoff_id: 'not-a-handoff', nurse_id: 'demo', idempotency_key: randomUUID(), human_confirmed: true, execution_mode: 'live' });
    assert.equal(deniedWrite.isError, true);
    assert.match(deniedWrite.content[0]!.text, /publication is disabled/);
    const simulatedWrite = await authenticated.callTool('publish_reviewed_handoff_note', {
      handoff_id: 'not-a-handoff', nurse_id: 'demo', idempotency_key: randomUUID(), human_confirmed: true, execution_mode: 'mock' });
    assert.equal(simulatedWrite.isError, true);
    assert.match(simulatedWrite.content[0]!.text, /disabled in production/);
  } finally { await authenticated.close(); }
  console.log('PASS hosted configuration, origin validation, readiness and authenticated MCP discovery');

  const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
  const { readEpicContext } = await import('../src/services/epic-context.service.js');
  const originalFetch = EpicOAuthService.authorizedFetch;
  const originalRead = EpicOAuthService.readPatient;
  process.env.EPIC_READS_ENABLED = 'true'; process.env.EPIC_TEST_PATIENT_IDS = 'allowed';
  writeFileSync(path.join(directory, 'fixture.pem'), 'not-a-real-key');
  Object.assign(process.env, { EPIC_CLIENT_ID: 'fixture', PRIVATE_KEY_PATH: path.join(directory, 'fixture.pem'), EPIC_FHIR_BASE_URL: 'https://epic.test/FHIR/R4' });
  try {
    let reads = 0;
    EpicOAuthService.readPatient = async () => { reads++; return { resourceType: 'Patient', id: 'allowed', name: [{ text: 'Synthetic Epic Fixture' }] }; };
    EpicOAuthService.authorizedFetch = async <T>() => ({ resourceType: 'Bundle', entry: [] }) as T;
    const input = { patient_id: 'allowed', idempotency_key: randomUUID() };
    const context = await readEpicContext(input);
    assert.equal(context.context.patient.fullName, 'Synthetic Epic Fixture');
    assert(!('acuityLevel' in context.context.patient));
    assert.deepEqual(await readEpicContext(input), context); assert.equal(reads, 1);
    await assert.rejects(readEpicContext({ ...input, patient_id: 'other' }), /not in/);
    EpicOAuthService.authorizedFetch = async () => { throw new Error('synthetic permission denial'); };
    await assert.rejects(readEpicContext({ ...input, idempotency_key: randomUUID() }), /read failed/);
    EpicOAuthService.authorizedFetch = async <T>() => ({ resourceType: 'Bundle', link: [{ relation: 'next' }] }) as T;
    await assert.rejects(readEpicContext({ ...input, idempotency_key: randomUUID() }), /paginated/);
    console.log('PASS mocked Epic allowlist, snapshot receipts, visible errors and partial-page rejection (no live calls)');
  } finally { EpicOAuthService.authorizedFetch = originalFetch; EpicOAuthService.readPatient = originalRead; }
  const backup = path.join(directory, 'backup.db');
  await db.backup(backup);
  const { default: Database } = await import('better-sqlite3');
  const restored = new Database(backup);
  try { assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(restored.prepare('SELECT count(*) AS n FROM operation_receipts').get(), db.prepare('SELECT count(*) AS n FROM operation_receipts').get());
  } finally { restored.close(); }
  console.log('PASS consistent backup preserves committed receipts');
} finally {
  await bridge.close();
  await new Promise<void>(resolve => appServer.close(() => resolve()));
  db.close();
  const resolved = realpathSync(directory);
  if (path.dirname(resolved) === root && path.basename(resolved).startsWith('shiftweave-deploy-')) rmSync(resolved, { recursive: true });
}
