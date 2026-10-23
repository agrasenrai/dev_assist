import { createHash } from 'crypto';
import { db } from '../db/connection.js';
import { canonicalJson } from './canonical-json.js';
import { patientScope,taskScope } from './source-policy.js';
import { sourceRealm } from './source-context.js';

/** Local source reconciliation token, independent of second-resolution timestamps. */
export function sourceVersion(): string {
  return createHash('sha256').update(canonicalJson({
    realm:sourceRealm(),
    tasks: db.prepare(`SELECT * FROM tasks t WHERE ${taskScope('t')} ORDER BY id`).all(),
    assignments: db.prepare(`SELECT * FROM task_assignments a WHERE EXISTS(SELECT 1 FROM tasks t WHERE t.id=a.task_id AND ${taskScope('t')}) ORDER BY id`).all(),
    conflicts: db.prepare(`SELECT * FROM conflicts c WHERE EXISTS(SELECT 1 FROM tasks t WHERE t.id=c.task_id AND ${taskScope('t')}) ORDER BY id`).all(),
    patients: db.prepare(`SELECT * FROM patients p WHERE ${patientScope('p')} ORDER BY id`).all()
    ,epic:sourceRealm()==='preview'?[]:db.prepare(`SELECT es.* FROM epic_patient_snapshots es JOIN patients p ON p.id=es.patient_id WHERE ${patientScope('p')} ORDER BY patient_id`).all()
  })).digest('hex');
}
