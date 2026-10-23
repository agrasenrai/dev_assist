import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

const root=realpathSync(tmpdir()),directory=mkdtempSync(path.join(root,'shiftweave-review-test-'));
Object.assign(process.env,{SQLITE_DB_PATH:path.join(directory,'test.db'),HOSPITAL_SIMULATION_ENABLED:'false',SIMULATION_MODE:'true',NODE_ENV:'test',HOST:'127.0.0.1',PORT:'0',SHIFTWEAVE_TEST:'1',STAFF_AUTH_REQUIRED:'false',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false',LLM_PROVIDER:'mock',MCP_AUTH_TOKEN:'',PUBLIC_ORIGIN:''});
let resources:{server?:import('node:http').Server;db?:import('better-sqlite3').Database}={};
try {
 const seeded=spawnSync(process.execPath,['--import','tsx','scripts/setup-simulations.ts',process.env.SQLITE_DB_PATH!],{env:process.env,encoding:'utf8'});
 assert.equal(seeded.status,0,seeded.stderr);
 const {db}=await import('../src/db/connection.js');resources.db=db;
 const {appServer}=await import('../src/server.js');resources.server=appServer;
 if(!appServer.listening)await once(appServer,'listening');const address=appServer.address();assert(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}/api/simulations`;
 async function post(input:Record<string,unknown>){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
 const catalog=await post({action:'list'});assert.equal(catalog.scenarios.length,6);
 console.log('PASS catalog is served through HTTP and MCP from SQLite');
 for(const scenario of catalog.scenarios){
  const start={action:'start',scenario_id:scenario.id,idempotency_key:randomUUID()};let run=await post(start);assert.deepEqual(await post(start),run);
  for(let i=0;i<run.scenario.steps.length;i++){
   const before=db.prepare('SELECT status FROM tasks WHERE id=?').get('review:task:1') as {status:string};
   const step={action:'step',run_id:run.id,expected_cursor:i,idempotency_key:randomUUID()};run=await post(step);
   assert.equal(run.cursor,i+1);assert.deepEqual(await post(step),run);
   if(scenario.id==='patient'&&i===2)assert.match(run.last.output.speech,/Latex/);
   if(scenario.id==='status'&&i===2){assert(run.last.output.pending?.ready);assert.deepEqual(db.prepare('SELECT status FROM tasks WHERE id=?').get('review:task:1'),before);}
   if(scenario.id==='status'&&i===3)assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get('review:task:1') as any).status,'COMPLETED');
   if(scenario.id==='missing'&&i===1)assert.match(run.last.output.speech,/unavailable|not available|not recorded|don.t have allergy information/i);
   if(scenario.id==='missing'&&i===3)assert.match(run.last.output.speech,/clinical team|workflow coordination|treatment/i);
   if(scenario.id==='recovery'&&i===0){assert.equal(run.last.outcome,'INTERRUPTED');assert(run.last.output.checkpoint.id);}
   if(scenario.id==='recovery'&&i===1)assert(run.last.output.toolsExecuted.some((t:any)=>t.name==='resume_workflow'));
   if(scenario.id==='unavailable'&&i===0){assert.equal(run.last.outcome,'EXPECTED_SERVICE_ERROR');assert.equal(run.last.output.externalCallsPerformed,false);}
  }
  const restored=await post({action:'read',run_id:run.id});assert.equal(restored.cursor,run.scenario.steps.length);
  if(scenario.id==='handoff') {
    const handoff=db.prepare("SELECT status,external_sync_status FROM handoffs WHERE outgoing_nurse_id='review:ava' AND incoming_nurse_id='review:zoe' ORDER BY rowid DESC LIMIT 1").get() as any;
    assert.equal(handoff.status,'FINALIZED',JSON.stringify(run.last));assert.equal(handoff.external_sync_status,'NOT_REQUESTED');
    assert.equal((db.prepare("SELECT nurse_id FROM task_assignments WHERE task_id='review:task:2' AND transfer_status='ACTIVE'").get() as any).nurse_id,'review:zoe');
  }
  assert.equal(restored.results.length,run.cursor);
  assert.deepEqual(restored.last,run.last);
  if(scenario.id==='patient'){
   db.prepare("UPDATE patients SET allergies='Synthetic revised allergy field' WHERE id='review:patient:1'").run();
   const followup=await post({action:'ask',run_id:run.id,utterance:'What are their allergies?',idempotency_key:randomUUID()});
   assert.match(followup.last.output.speech,/Synthetic revised allergy field/);
   db.prepare("UPDATE patients SET allergies='Latex' WHERE id='review:patient:1'").run();
  }
  console.log(`PASS ${scenario.id}: real tool outputs, durable progress and exact retries`);
 }
 const recoveryRun=await post({action:'start',scenario_id:'patient',idempotency_key:randomUUID()});
 const {MCPClientBridge}=await import('../src/agent/mcp-client-bridge.js');
 const original=MCPClientBridge.prototype.callTool;let injected=false;
 const retryInput={action:'step',run_id:recoveryRun.id,expected_cursor:0,idempotency_key:randomUUID()};
 try {
  MCPClientBridge.prototype.callTool=async function(name,args){const result=await original.call(this,name,args);if(name==='voice_turn'&&!injected){injected=true;throw new Error('Simulated lost voice response after commit');}return result;};
  const failed=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(retryInput)});assert.equal(failed.status,409);assert(injected);
 }finally{MCPClientBridge.prototype.callTool=original;}
 const reconciled=await post(retryInput);assert.equal(reconciled.cursor,1);assert.equal(reconciled.last.output.revision,1);
 const stale=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...retryInput,idempotency_key:randomUUID()})});assert.equal(stale.status,409);
 const oldTitle=reconciled.scenario.title;db.prepare("UPDATE simulation_catalog SET title='Edited catalog title' WHERE id='patient'").run();
 assert.equal((await post({action:'read',run_id:recoveryRun.id})).scenario.title,oldTitle);
 assert.equal((await post({action:'list'})).scenarios.find((s:any)=>s.id==='patient').title,'Edited catalog title');
 console.log('PASS lost-response reconciliation, stale-step rejection, persisted latest response and dynamic catalog with frozen run definitions');
 const bad=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',scenario_id:'absent',idempotency_key:randomUUID()})});assert.equal(bad.status,409);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 console.log('PASS missing scenario and database integrity; all 6 simulations verified');
} finally {
 if(resources.server?.listening){resources.server.closeAllConnections();await new Promise<void>(resolve=>resources.server!.close(()=>resolve()));}
 resources.db?.close();
 const resolved=realpathSync(directory);if(path.dirname(resolved)===root&&path.basename(resolved).startsWith('shiftweave-review-test-'))rmSync(resolved,{recursive:true,force:true});
}
