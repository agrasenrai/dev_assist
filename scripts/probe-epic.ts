import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Read-only live probe. Never prints a token, private key, passphrase or patient narrative.
const root = fs.realpathSync(os.tmpdir());
const directory = fs.mkdtempSync(path.join(root, 'shiftweave-epic-probe-'));
process.env.SQLITE_DB_PATH = path.join(directory, 'probe.db');
const { db } = await import('../src/db/connection.js');
const { initializeDatabase } = await import('../src/db/schema.js');
const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
initializeDatabase();
try {
  const config = EpicOAuthService.getConfig();
  const privateKey = crypto.createPrivateKey({ key: fs.readFileSync(config.privateKeyPath), format: 'pem', passphrase: config.privateKeyPassphrase });
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  const jwksResponse = await fetch(process.env.EPIC_JWKS_URL || 'https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json', { signal: AbortSignal.timeout(15000) });
  if (!jwksResponse.ok) throw new Error(`Public JWKS HTTP ${jwksResponse.status}`);
  const jwks = await jwksResponse.json() as { keys: Array<{ n: string; e: string; kid: string }> };
  const match = jwks.keys.find(k => k.n === publicKey.n && k.e === publicKey.e);
  if (!match) throw new Error('Registered public JWKS does not match the local private key');
  process.env.EPIC_KID = match.kid;
  console.log('Public JWKS matches the decryptable local signing key.');
  await EpicOAuthService.getAccessToken();
  console.log('Live Epic backend OAuth succeeded; token not displayed.');
  const patient = (process.env.EPIC_TEST_PATIENT_IDS || 'erXuFYUfucBZaryVksYEcMg3').split(',')[0]!.trim();
  const paths = ['metadata', `Patient/${patient}`, ...['Encounter', 'Condition', 'AllergyIntolerance', 'MedicationRequest', 'MedicationAdministration', 'DocumentReference'].map(type => `${type}?patient=${patient}`)];
  const checks: unknown[] = [];
  for (const resourcePath of paths) {
    try {
      const response = await EpicOAuthService.authorizedFetchResponse(resourcePath);
      const body = await response.json() as any;
      if (process.argv.includes('--write-context') && resourcePath.startsWith('Encounter?')) {
        for (const { resource: encounter } of body.entry || []) {
          if (encounter?.resourceType !== 'Encounter') continue;
          const practitioners = (encounter.participant || []).map((p: any) => p.individual?.reference).filter((r: any) => typeof r === 'string' && r.startsWith('Practitioner/'));
          console.log(JSON.stringify({ encounter: encounter.id, status: encounter.status, subject: encounter.subject?.reference, period: encounter.period, practitioners }));
          for (const reference of [...new Set<string>(practitioners)]) {
            try {
              const practitioner = await EpicOAuthService.authorizedFetch<any>(reference);
              console.log(JSON.stringify({ practitioner: reference, verified: practitioner.resourceType === 'Practitioner', active: practitioner.active, name: practitioner.name }));
            } catch (error) { console.log(JSON.stringify({ practitioner: reference, error: error instanceof Error ? error.message : String(error) })); }
          }
        }
      }
      const item = { resource: resourcePath.split(/[/?]/)[0], httpStatus: response.status, resourceType: body.resourceType,
        count: body.entry?.length, nextPage: Boolean(body.link?.some((l: any) => l.relation === 'next')),
        entryTypes: body.entry?.map((e: any) => e.resource?.resourceType),
        entryIssues: body.entry?.flatMap((e: any) => e.resource?.issue || []).map((i: any) => ({ severity: i.severity, code: i.code, details: i.details?.text })),
        attachments: body.entry?.flatMap((e: any) => e.resource?.content || []).map((c: any) => ({ contentType: c.attachment?.contentType, hasUrl: Boolean(c.attachment?.url), hasInline: Boolean(c.attachment?.data) })),
        issues: body.issue?.map((i: any) => ({ severity: i.severity, code: i.code, details: i.details?.text })) };
      checks.push(item); console.log(JSON.stringify(item));
    } catch (error) { const item = { resource: resourcePath.split(/[/?]/)[0], error: error instanceof Error ? error.message : String(error) }; checks.push(item); console.log(JSON.stringify(item)); }
  }
  fs.writeFileSync('deploy/epic-live-report.json', JSON.stringify({ checkedAt: new Date().toISOString(), environment: 'Epic configured non-production endpoint', jwksMatch: true, oauth: 'VERIFIED', checks }, null, 2) + '\n');
} finally {
  db.close();
  const resolved = fs.realpathSync(directory);
  if (path.dirname(resolved) === root && path.basename(resolved).startsWith('shiftweave-epic-probe-')) fs.rmSync(resolved, { recursive: true });
}
