import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftweave-operations-audit-'));
process.env.SQLITE_DB_PATH = path.join(directory, 'audit.db');
const { db } = await import('../src/db/connection.js');
const { initializeDatabase } = await import('../src/db/schema.js');
const { EpicOAuthService } = await import('../src/providers/epic-oauth.service.js');
const { epicSearch } = await import('../src/providers/epic-workflow-source.js');
initializeDatabase();
try {
  const checks = [
    ['PractitionerRole', 'PractitionerRole?practitioner=Practitioner%2FelpRiy0AYgjhdjAhTBJ3Aiw3'],
    ['List', 'List?patient=erXuFYUfucBZaryVksYEcMg3'],
    ['Task', 'Task?patient=erXuFYUfucBZaryVksYEcMg3'],
    ['Observation', 'Observation?patient=eAB3mDIBBcyUKviyzrxsnAw3&category=vital-signs'],
    ['Observation', 'Observation?patient=erXuFYUfucBZaryVksYEcMg3&category=laboratory'],
  ];
  const results: any[] = [];
  for (const [type, query] of checks) {
    try { const s = await epicSearch(query!, type!); results.push({ query, status: s.status, count: s.resources.length, warnings: s.warnings }); }
    catch (error) { results.push({ query, status: 'ERROR', error: (error instanceof Error ? error.message : String(error)).slice(0, 1500) }); }
    console.log(JSON.stringify(results.at(-1)));
  }
  const report = JSON.parse(fs.readFileSync('deploy/epic-dataset-audit.json', 'utf8'));
  report.operationalChecks = results;
  report.operationalCheckedAt = new Date().toISOString();
  report.grantedScope = EpicOAuthService.getCachedToken()?.scope || 'NOT_RETURNED';
  fs.writeFileSync('deploy/epic-dataset-audit.json', JSON.stringify(report, null, 2) + '\n');
} finally {
  db.close();
  const resolved = fs.realpathSync(directory);
  if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith('shiftweave-operations-audit-')) fs.rmSync(resolved, { recursive: true });
}
