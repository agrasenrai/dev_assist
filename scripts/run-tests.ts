import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Every invocation gets its own database. Never use the user's configured clinical demo DB.
const root = realpathSync(tmpdir());
const directory = mkdtempSync(path.join(root, 'shiftweave-tests-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/verify-workflows.ts', process.argv[2] || 'all'], {
  stdio: 'inherit', env: { ...process.env, SQLITE_DB_PATH: path.join(directory, 'test.db'),
    PORT: '0',HOST:'127.0.0.1',NODE_ENV:'test',MCP_AUTH_TOKEN:'',PUBLIC_ORIGIN:'', LLM_PROVIDER: 'mock', SHIFTWEAVE_TEST: '1',STAFF_AUTH_REQUIRED:'false',EPIC_CREATE_REVIEW_TASKS:'true' }
});
child.on('exit', code => {
  const resolved = realpathSync(directory);
  if (path.dirname(resolved) === root && path.basename(resolved).startsWith('shiftweave-tests-')) {
    rmSync(resolved, { recursive: true, force: true });
  }
  process.exitCode = code || 0;
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
