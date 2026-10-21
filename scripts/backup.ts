import { db } from '../src/db/connection.js';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const destination = path.resolve(process.argv[2] || `./backups/shiftweave-${new Date().toISOString().replaceAll(':', '-')}.db`);
if (existsSync(destination)) throw new Error('Backup destination already exists; choose a new filename');
mkdirSync(path.dirname(destination), { recursive: true });
try {
  await db.backup(destination);
  console.log(`Consistent SQLite backup saved: ${destination}`);
} finally { db.close(); }
