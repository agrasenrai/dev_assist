import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';

if(!process.env.SQLITE_DB_PATH)throw new Error('Set SQLITE_DB_PATH');
const db=new Database(process.env.SQLITE_DB_PATH,{readonly:true,fileMustExist:true});
const scopes:Record<string,string>={nurses:"id LIKE 'hospital:%'",shifts:"id LIKE 'hospital:%'",patients:"id LIKE 'hospital:%'",tasks:"id LIKE 'hospital:%'",
  task_assignments:"task_id LIKE 'hospital:%'",task_events:"task_id LIKE 'hospital:%'",conflicts:"task_id LIKE 'hospital:%'",handoffs:"outgoing_nurse_id LIKE 'hospital:%'",
  workflow_runs:"initiated_by LIKE 'hospital:%' OR id LIKE 'review-recovery:%'",
  workflow_checkpoints:"workflow_run_id IN (SELECT id FROM workflow_runs WHERE initiated_by LIKE 'hospital:%' OR id LIKE 'review-recovery:%')",
  operation_receipts:"operation LIKE 'HOSPITAL_%'",audit_log:"actor_id LIKE 'hospital:%' OR action LIKE 'HOSPITAL_%'",
  hospital_patients:'1=1',hospital_fhir_resources:'1=1',simulation_catalog:"id LIKE 'hospital-%'",simulation_runs:"scenario_id LIKE 'hospital-%'",
  simulation_results:"run_id IN (SELECT id FROM simulation_runs WHERE scenario_id LIKE 'hospital-%')"};
try {
  const lines=['# Synthetic hospital database population report','',`Generated ${new Date().toISOString()} by a read-only query of the configured application database.`,
    '', 'Counts below concern synthetic hospital records. Population is not proof that every field is read by every tool. Event, resolution and recovery fields fill when those workflows execute; unrelated staff-auth and Epic tables are intentionally preserved.',
    '', '| Table | Hospital rows | Columns with values | Columns currently empty |','|---|---:|---|---|'];
  for(const [table,where] of Object.entries(scopes)) {
    const columns=db.pragma(`table_info(${table})`) as {name:string}[];
    if(!columns.length){lines.push(`| ${table} | absent | — | — |`);continue;}
    const rowCount=(db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get() as any).n;
    const populated:string[]=[],empty:string[]=[];
    for(const column of columns) {
      const col=`"${column.name.replaceAll('"','""')}"`;
      const n=(db.prepare(`SELECT count(*) n FROM ${table} WHERE (${where}) AND ${col} IS NOT NULL AND CAST(${col} AS TEXT)!=''`).get() as any).n;
      (n?populated:empty).push(column.name);
    }
    lines.push(`| ${table} | ${rowCount} | ${populated.join(', ')||'—'} | ${empty.join(', ')||'—'} |`);
  }
  lines.push('','Expected empty fields include unknown patient acuity, unrecorded historical completion times, unresolved-conflict resolution fields, successful-run error messages and external publication IDs/errors when no Epic publication was requested. No placeholder values are inserted to make coverage appear complete.',
    '', 'MCP execution coverage is tested separately by `npm run test:hospital`: all discovered tools must be exercised, with expected Epic/auth failures recorded as boundary rejections rather than successful hospital capabilities.');
  const text=lines.join('\n')+'\n';
  if(process.argv[2]){fs.writeFileSync(process.argv[2],text);console.log(`Read-only population report written to ${process.argv[2]}`);}else console.log(text);
}finally{db.close();}
