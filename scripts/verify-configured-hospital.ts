import 'dotenv/config';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

assert(process.env.SQLITE_DB_PATH,'Configure SQLITE_DB_PATH');
const database=new Database(process.env.SQLITE_DB_PATH,{readonly:true,fileMustExist:true});
try {
  for(const [table,count] of [['hospital_patients',3],['hospital_fhir_resources',17]] as const)
    assert.equal((database.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n,count);
  assert.equal((database.prepare("SELECT count(*) n FROM nurses WHERE id LIKE 'hospital:%'").get() as any).n,3);
  assert.equal((database.prepare("SELECT count(*) n FROM tasks WHERE id LIKE 'hospital:%'").get() as any).n,9);
  assert.equal((database.prepare("SELECT count(*) n FROM simulation_catalog WHERE id LIKE 'hospital-%'").get() as any).n,6);
  assert.equal((database.prepare("SELECT count(*) n FROM handoffs WHERE outgoing_nurse_id='hospital:reema' AND incoming_nurse_id='hospital:seema'").get() as any).n,1);
  assert.deepEqual(database.pragma('foreign_key_check'),[]);assert.deepEqual(database.pragma('integrity_check'),[{integrity_check:'ok'}]);
  const backupArgument=process.argv[2];
  if(backupArgument) {
    const backupPath=path.resolve(backupArgument);assert(fs.existsSync(backupPath));
    const backup=new Database(backupPath,{readonly:true,fileMustExist:true});
    try {
      for(const table of ['nurses','patients','tasks','task_assignments','handoffs','staff_accounts','epic_patient_snapshots']) {
        const columns=(backup.pragma(`table_info(${table})`) as {name:string}[]).map(c=>`"${c.name}"`).join(',');
        const before=backup.prepare(`SELECT rowid AS original_row,${columns} FROM ${table} ORDER BY rowid`).all() as any[];
        for(const row of before)assert.deepEqual(database.prepare(`SELECT rowid AS original_row,${columns} FROM ${table} WHERE rowid=?`).get(row.original_row),row,`${table}: original record changed`);
      }
    }finally{backup.close();}
    console.log('PASS original nurse, patient, task, assignment, handoff, staff account and Epic snapshot rows are unchanged from the pre-import backup.');
  }
  console.log('PASS configured database: 3 synthetic nurses, 3 patients, 17 FHIR resources, 9 tasks, saved handoff, 6 scenarios; SQLite integrity and foreign keys valid. Read-only verification.');
} finally {database.close();}
