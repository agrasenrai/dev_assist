import 'dotenv/config';
import fs from 'node:fs';
import { once } from 'node:events';

const approvedHash = process.argv[2];
const attempt = process.argv[3];
const preview = JSON.parse(fs.readFileSync('deploy/epic-note-preview.json', 'utf8'));
if (!approvedHash || approvedHash !== preview.reviewHash) throw new Error('Pass the exact human-approved preview hash. No write attempted.');
if (!fs.existsSync('backups/epic-reviewed-note-demo.db')) throw new Error('Prepared demonstration database is missing');
Object.assign(process.env, { SQLITE_DB_PATH: './backups/epic-reviewed-note-demo.db', EPIC_WRITES_ENABLED: 'true',
  PORT: '0', HOST: '127.0.0.1', SHIFTWEAVE_TEST: '1', LLM_PROVIDER: 'mock' });
const { appServer } = await import('../src/server.js');
const { db } = await import('../src/db/connection.js');
const { MCPClientBridge } = await import('../src/agent/mcp-client-bridge.js');
const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
let bridge: InstanceType<typeof MCPClientBridge> | undefined;
try {
  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address(); if (!address || typeof address === 'string') throw new Error('Local server unavailable');
  bridge = new MCPClientBridge(`http://127.0.0.1:${address.port}/mcp`); await bridge.initialize();
  const result = await bridge.callTool('publish_reviewed_handoff_note', { handoff_id: preview.handoffId, nurse_id: 'nurse_reema_02',
    review_hash: approvedHash, human_confirmed: true, idempotency_key: `approved-sandbox-${approvedHash}${attempt ? `-${attempt}` : ''}`, execution_mode: 'live' });
  if (result.isError) throw new Error(result.content[0]?.text || 'Publication failed');
  const outcome = JSON.parse(result.content[0]!.text);
  let readback: Record<string, unknown> = { status: 'NOT_ATTEMPTED' };
  if (outcome.externalSync === 'SYNCED') {
    try {
      const remote = await EpicOAuthService.authorizedFetch<any>(`DocumentReference/${outcome.externalResourceId}`);
      if (remote.resourceType !== 'DocumentReference' || remote.id !== outcome.externalResourceId || remote.subject?.reference !== `Patient/${preview.patientId}`) throw new Error('Returned document identity does not match the approved patient');
      readback = { status: 'VERIFIED', resourceId: remote.id, patientReference: remote.subject.reference };
    } catch (error) { readback = { status: 'FAILED', error: error instanceof Error ? error.message : String(error) }; }
  }
  const report = { verifiedAt: new Date().toISOString(), source: 'LIVE_EPIC_SANDBOX', outcome, readback };
  fs.writeFileSync('deploy/epic-write-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fs.writeFileSync('deploy/epic-write-report.json', JSON.stringify({ checkedAt: new Date().toISOString(), source: 'LIVE_EPIC_SANDBOX', error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n');
  throw error;
} finally {
  await bridge?.close(); await new Promise<void>(resolve => appServer.close(() => resolve())); db.close();
}
