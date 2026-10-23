import 'dotenv/config';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

// Clone the configured DB with SQLite's backup API. No test writes touch the source.
assert(process.env.SQLITE_DB_PATH,'Set SQLITE_DB_PATH to the application database');
const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-shared-test-'));
const target=path.join(directory,'test.db');
const source=new Database(process.env.SQLITE_DB_PATH,{readonly:true,fileMustExist:true});
try {await source.backup(target);}finally{source.close();}
Object.assign(process.env,{SQLITE_DB_PATH:target,PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',SHIFTWEAVE_TEST:'1',HOSPITAL_SIMULATION_ENABLED:'false',SIMULATION_MODE:'true',LLM_PROVIDER:'mock',STAFF_AUTH_REQUIRED:'false',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false',MCP_AUTH_TOKEN:'',PUBLIC_ORIGIN:''});
const copy=new Database(target);
const tables=['nurses','patients','tasks','task_assignments','handoffs','staff_accounts','epic_patient_snapshots'];
const before=new Map(tables.map(t=>[t,copy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
copy.close();
let server:import('node:http').Server|undefined;
let database:Database.Database|undefined;
try {
 for(let attempt=0;attempt<2;attempt++){
  const seeded=spawnSync(process.execPath,['--import','tsx','scripts/setup-simulations.ts','--configured'],{env:process.env,encoding:'utf8'});
  assert.equal(seeded.status,0,seeded.stderr);
 }
 const {db}=await import('../src/db/connection.js');database=db;
 for(const [table,rows] of before){
  const after=db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  assert.deepEqual(after.slice(0,rows.length),rows,`${table}: existing rows changed`);
 }
 assert.equal((db.prepare('SELECT count(*) n FROM simulation_catalog').get() as any).n,6);
 assert.equal((db.prepare("SELECT count(*) n FROM nurses WHERE id LIKE 'review:%'").get() as any).n,2);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 console.log('PASS additive import and replay preserve existing domain records, with six scenarios and no duplicate review nurses');
 const {appServer}=await import('../src/server.js');server=appServer;
 if(!server.listening)await once(server,'listening');
 const address=server.address();assert(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}`;
 const list=await fetch(`${base}/api/simulations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list'})});
 assert.equal(list.status,200);assert.equal((await list.json()).scenarios.length,6);
 const response=await fetch(`${base}/api/voice`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:randomUUID(),utterance:'I am Seema Patel, whats my tasks',expected_revision:0,idempotency_key:randomUUID()})});
 const voice=await response.json();assert.equal(response.status,200);assert.equal(voice.nurse?.id,'staff:seema',JSON.stringify(voice));
 const tasks=db.prepare("SELECT task_id FROM task_assignments WHERE nurse_id=? AND shift_id=? AND transfer_status IN ('ACTIVE','CARRIED_FORWARD') ORDER BY task_id").all(voice.nurse.id,voice.shift.id) as {task_id:string}[];
 assert.deepEqual(voice.tasks.map((t:any)=>t.id).sort(),tasks.map(t=>t.task_id));
 assert(tasks.length>0);assert.match(voice.speech,/task/i);
 console.log(`PASS original Seema identity and combined task question through HTTP → MCP → SQLite (${tasks.length} matching assignments)`);
}finally{
 if(server?.listening){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
 database?.close();
 rmSync(directory,{recursive:true,force:true});
}
