import { createHash } from 'crypto';
import { db } from '../db/connection.js';
import { canonicalJson } from './canonical-json.js';

/** Local source reconciliation token, independent of second-resolution timestamps. */
export function sourceVersion(): string {
  return createHash('sha256').update(canonicalJson({
    tasks: db.prepare('SELECT * FROM tasks ORDER BY id').all(),
    assignments: db.prepare('SELECT * FROM task_assignments ORDER BY id').all(),
    conflicts: db.prepare('SELECT * FROM conflicts ORDER BY id').all(),
    patients: db.prepare('SELECT * FROM patients ORDER BY id').all()
  })).digest('hex');
}
