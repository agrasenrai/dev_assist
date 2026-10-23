import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import Database from 'better-sqlite3';

// Exercises the compiled production entry points with plain Node, never tsx,
// and never the configured application database or real cloud integrations.
const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-runtime-'));
const databasePath=path.join(directory,'runtime.db');
const env={...process.env,SQLITE_DB_PATH:databasePath,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',
  SHIFTWEAVE_TEST:'1',LLM_PROVIDER:'bedrock',BEDROCK_MODEL_ID:'us.anthropic.claude-sonnet-4-6',
  PUBLIC_ORIGIN:'https://runtime.shiftweave.test',MCP_AUTH_TOKEN:randomBytes(32).toString('hex'),
  STAFF_AUTH_REQUIRED:'false',SIMULATION_MODE:'false',HOSPITAL_SIMULATION_ENABLED:'true',HOSPITAL_DATA_SOURCE:'sqlite',
  EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false'};
let server:ChildProcess|undefined;
async function run(file:string,args:string[]=[]) {
  assert(existsSync(file),`Missing compiled runtime file: ${file}`);
  const child=spawn(process.execPath,[file,...args],{env,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout!.on('data',b=>output+=b);child.stderr!.on('data',b=>output+=b);
  const [code]=await once(child,'close');assert.equal(code,0,output);return output;
}
try {
  new Database(databasePath).close();
  await run('build/scripts/setup-hospital.js');
  const database=new Database(databasePath);
  try {
    assert.equal((database.prepare("SELECT count(*) n FROM tasks WHERE id LIKE 'hospital:%'").get() as any).n,9);
    database.prepare("UPDATE tasks SET status='COMPLETED' WHERE id='hospital:task:paperwork'").run();
    // A real deployment can contain additional records; health verification must allow growth.
    database.prepare("INSERT INTO tasks(id,patient_id,title,status,category,priority,scheduled_time,source_system) VALUES('hospital:task:additional','hospital:sw-rowan','Additional coordination work','PENDING','CONSULT','ROUTINE',CURRENT_TIMESTAMP,'SYNTHETIC_HOSPITAL_WORKFLOW')").run();
  }finally{database.close();}
  await run('build/scripts/setup-hospital.js');
  await run('build/scripts/verify-configured-hospital.js');
  const checked=new Database(databasePath,{readonly:true});
  try {
    assert.equal((checked.prepare("SELECT count(*) n FROM tasks WHERE id LIKE 'hospital:%'").get() as any).n,10);
    assert.equal((checked.prepare("SELECT status FROM tasks WHERE id='hospital:task:paperwork'").get() as any).status,'COMPLETED');
    assert.equal((checked.prepare('SELECT count(*) n FROM handoffs').get() as any).n,1);
  }finally{checked.close();}
  console.log('PASS compiled hospital provisioning, rerun without task/handoff duplication, preserved updates and dynamic record growth');
  await run('build/scripts/preflight.js');
  server=spawn(process.execPath,['build/src/server.js'],{env,stdio:['ignore','pipe','pipe']});
  const endpoint=await new Promise<string>((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Compiled server did not become ready')),15000);
    server!.once('error',error=>{clearTimeout(timer);reject(error);});
    server!.once('exit',()=>{clearTimeout(timer);reject(new Error('Compiled server exited before startup'));});
    server!.stdout!.on('data',b=>{output+=b;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)\/mcp/);if(match){clearTimeout(timer);resolve(match[0]);}});
    server!.stderr!.on('data',()=>{});
  });
  assert.equal((await fetch(new URL('/readyz',endpoint))).status,200);
  assert.equal((await fetch(new URL('/',endpoint))).status,200);
  await run('build/scripts/verify-mcp-independent.js',[endpoint]);
  console.log('PASS compiled production server, readiness, dashboard and external Epic-default MCP isolation; no Docker/cloud deployment performed');
}finally {
  if(server&&server.exitCode===null&&server.signalCode===null){server.kill();await once(server,'close');}
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('shiftweave-runtime-'));
  rmSync(directory,{recursive:true,force:true});
}
