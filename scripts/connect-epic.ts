import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { once } from 'node:events';

// Explicit administrator setup. Uses existing credentials without displaying them.
const { db } = await import('../src/db/connection.js');
let appServer: import('node:http').Server | undefined;
try {
  fs.mkdirSync('backups', { recursive: true });
  await db.backup(`backups/before-epic-${Date.now()}.db`);
  const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
  const config = EpicOAuthService.getConfig();
  const privateKey = crypto.createPrivateKey({ key: fs.readFileSync(config.privateKeyPath), format: 'pem', passphrase: config.privateKeyPassphrase });
  const pub = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  const response = await fetch(process.env.EPIC_JWKS_URL || 'https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`JWKS HTTP ${response.status}`);
  const keys = (await response.json() as any).keys;
  const match = keys.find((key: any) => key.n === pub.n && key.e === pub.e);
  if (!match) throw new Error('Public JWKS does not match the private key');
  const settings: Record<string, string> = { EPIC_KID: match.kid, EPIC_READS_ENABLED: 'true',
    EPIC_TEST_PATIENT_IDS: process.env.EPIC_TEST_PATIENT_IDS || 'erXuFYUfucBZaryVksYEcMg3', EPIC_WRITES_ENABLED: 'false' };
  Object.assign(process.env, settings, { PORT: '0', HOST: '127.0.0.1', SHIFTWEAVE_TEST: '1' });
  ({ appServer } = await import('../src/server.js'));
  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address(); if (!address || typeof address === 'string') throw new Error('Server unavailable');
  const { MCPClientBridge } = await import('../src/agent/mcp-client-bridge.js');
  const bridge = new MCPClientBridge(`http://127.0.0.1:${address.port}/mcp`);
  try {
    await bridge.initialize();
    const result = await bridge.callTool('sync_epic_workspace', { nurse_id: process.env.EPIC_DEMO_NURSE_ID || 'nurse_seema_01',
      shift_id: process.env.EPIC_DEMO_SHIFT_ID || 'shift_20261019_night', idempotency_key: crypto.randomUUID() });
    if (result.isError) throw new Error(result.content[0]?.text);
    const sync = JSON.parse(result.content[0]!.text);
    console.log(JSON.stringify({ status: sync.status, patientCount: sync.results.length, results: sync.results }, null, 2));
    if (sync.status === 'FAILED') throw new Error('Live Epic sync failed; configuration was not enabled');
    let env = fs.readFileSync('.env', 'utf8');
    for (const [name, value] of Object.entries(settings)) {
      const pattern = new RegExp(`^${name}=.*$`, 'm');
      env = pattern.test(env) ? env.replace(pattern, `${name}=${value}`) : env.trimEnd() + `\n${name}=${value}\n`;
    }
    fs.writeFileSync('.env', env);
    console.log('Epic reads enabled in local .env. Existing secrets preserved. Backup saved. Live writes remain disabled.');
  } finally { await bridge.close(); }
} finally {
  if (appServer) await new Promise<void>(resolve => appServer!.close(() => resolve()));
  db.close();
}
