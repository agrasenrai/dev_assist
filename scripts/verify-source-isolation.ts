import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';

const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-source-test-'));
Object.assign(process.env,{SQLITE_DB_PATH:path.join(directory,'test.db'),HOST:'127.0.0.1',PORT:'0',NODE_ENV:'test',SHIFTWEAVE_TEST:'1',
  LLM_PROVIDER:'mock',HOSPITAL_SIMULATION_ENABLED:'true',HOSPITAL_DATA_SOURCE:'sqlite',STAFF_AUTH_REQUIRED:'false',SIMULATION_MODE:'false',
  MCP_AUTH_TOKEN:'source-test-service-token-at-least-32-characters',PUBLIC_ORIGIN:'',EPIC_READS_ENABLED:'true',EPIC_WRITES_ENABLED:'false',EPIC_TEST_PATIENT_IDS:'contract-patient'});
let app:Server|undefined,fhir:Server|undefined,database:any,preview:any,client:Client|undefined;
let networkReads=0,fail=false,count=0;
const pass=(message:string)=>{count++;console.log(`PASS ${message}`);};
try {
  const {db}=await import('../src/db/connection.js');database=db;
  const {initializeDatabase}=await import('../src/db/schema.js');initializeDatabase();
  await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','scripts/setup-hospital.ts'],{env:process.env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(output)));});
  const patient={resourceType:'Patient',id:'contract-patient',name:[{given:['Contract'],family:'Patient'}]};
  fhir=createServer((req,res)=>{
    networkReads++;assert.equal(req.headers.authorization,'Bearer isolation-contract-token');res.setHeader('Content-Type','application/fhir+json');
    if(fail){res.statusCode=503;res.end(JSON.stringify({resourceType:'OperationOutcome'}));return;}
    if(req.url==='/fhir/Patient/contract-patient'){res.end(JSON.stringify(patient));return;}
    res.end(JSON.stringify({resourceType:'Bundle',type:'searchset',entry:[]}));
  }).listen(0,'127.0.0.1');await once(fhir,'listening');
  const fhirBase=`http://127.0.0.1:${(fhir.address() as any).port}/fhir`;
  const {EpicOAuthService}=await import('../src/providers/epic-oauth.service.js');
  // Only OAuth credentials are stubbed. The Epic adapter makes actual HTTP reads
  // against this controlled contract server; this does not claim live Epic access.
  EpicOAuthService.getConfig=()=>({clientId:'contract-client',tokenUrl:fhirBase+'/token',fhirBaseUrl:fhirBase,privateKeyPath:'unused',privateKeyPassphrase:undefined,keyId:'contract-key'});
  EpicOAuthService.getAccessToken=async()=> 'isolation-contract-token';
  db.prepare("INSERT INTO nurses(id,badge_number,full_name,email,department) VALUES('ehr:nurse','EHR-001','Local EHR Nurse','ehr@example.invalid','EHR-UNIT')").run();
  db.prepare("INSERT INTO shifts(id,unit_id,shift_type,start_time,end_time,status) VALUES('ehr:shift','EHR-UNIT','DAY',?,?,'ACTIVE')").run(new Date().toISOString(),new Date(Date.now()+43200000).toISOString());
  db.prepare("INSERT INTO patients(id,mrn,full_name,room_number,admission_date,primary_diagnosis) VALUES('ehr:patient','EHR-P001','Contract Patient','EHR room',?,'Recorded condition unavailable')").run(new Date().toISOString());
  db.prepare("INSERT INTO epic_patient_snapshots(patient_id,epic_patient_id,endpoint,snapshot_json,retrieved_at,sync_status) VALUES('ehr:patient','contract-patient',?,?,?,'READY')")
    .run(fhirBase,JSON.stringify({source:'EPIC_FHIR_R4',patientId:'contract-patient',endpoint:fhirBase,retrievedAt:new Date().toISOString(),patient,sections:{},documents:[]}),new Date().toISOString());
  db.prepare("INSERT INTO tasks(id,patient_id,title,status,category,priority,scheduled_time,source_system) VALUES('ehr:task','ehr:patient','Recorded hospital coordination task','PENDING','CONSULT','ROUTINE',?,'LOCAL_WORKFLOW_WITH_EPIC_CONTEXT')").run(new Date().toISOString());
  db.prepare("INSERT INTO task_assignments(id,task_id,nurse_id,shift_id,assigned_by) VALUES('ehr:assignment','ehr:task','ehr:nurse','ehr:shift','ehr:nurse')").run();
  db.prepare("INSERT INTO task_events(id,task_id,event_type,new_value,source,actor_id) VALUES('ehr:event','ehr:task','NOTE_ADDED','Recorded coordination note','LOCAL_WORKFLOW','ehr:nurse')").run();
  const {appServer}=await import('../src/server.js');app=appServer;if(!app.listening)await once(app,'listening');
  const base=`http://127.0.0.1:${(app.address() as any).port}`,endpoint=base+'/mcp';
  const headers={Authorization:`Bearer ${process.env.MCP_AUTH_TOKEN}`};
  const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers}});
  client=new Client({name:'ShiftWeave-Agent-Orchestrator',version:'1.0.0'});await client.connect(transport as Transport);
  const {MCPClientBridge}=await import('../src/agent/mcp-client-bridge.js');preview=new MCPClientBridge(endpoint);await preview.initialize();
  const invoke=async(c:any,name:string,args:any,error=false)=>{const r=c instanceof Client?await c.callTool({name,arguments:args}):await c.callTool(name,args);if(error){assert(r.isError,`${name} should reject`);return r;}assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
  const externalTools=(await client.listTools()).tools.map(t=>t.name),previewTools=(await preview.listTools()).map((t:any)=>t.name);
  assert(!externalTools.includes('claim_hospital_task'));assert(!externalTools.includes('select_voice_source'));assert(externalTools.includes('get_epic_patient_context'));
  assert(previewTools.includes('claim_hospital_task'));assert(!previewTools.includes('get_epic_patient_context'));pass('ordinary official-SDK clients default Epic regardless of client name; preview/Epic tool discovery is separated');
  const session=randomUUID(),key=randomUUID();
  const p=await invoke(preview,'voice_turn',{session_id:session,utterance:'I am Seema Patel, show my tasks',expected_revision:0,idempotency_key:key});assert.equal(p.nurse.id,'hospital:seema');
  const e=await invoke(client,'get_voice_display',{session_id:session});assert.equal(e.dataSource,'epic');assert.equal(e.nurse,null);assert.equal(e.messages.length,0);
  const eRequest={session_id:session,utterance:'I am Local EHR Nurse, show my tasks',expected_revision:0,idempotency_key:key};
  const eTurn=await invoke(client,'voice_turn',eRequest);assert.equal(eTurn.nurse.id,'ehr:nurse');assert.deepEqual(eTurn.tasks.map((t:any)=>t.id),['ehr:task']);assert.deepEqual(await invoke(client,'voice_turn',eRequest),eTurn);
  assert.deepEqual(await invoke(preview,'voice_turn',{session_id:session,utterance:'I am Seema Patel, show my tasks',expected_revision:0,idempotency_key:key}),p);
  pass('same caller session UUID and retry UUID remain isolated, persisted and idempotent across realms');
  await invoke(client,'get_task_details',{task_id:'hospital:task:paperwork'},true);await invoke(preview,'get_task_details',{task_id:'ehr:task'},true);
  const events=await invoke(client,'get_task_changes',{since_timestamp:'2000-01-01T00:00:00Z'});assert.deepEqual(events.events.map((r:any)=>r.taskId),['ehr:task']);
  pass('direct task IDs and unfiltered event queries cannot cross the source boundary');
  const request={patient_id:'contract-patient',idempotency_key:randomUUID()};
  const result=await invoke(client,'get_epic_patient_context',request);assert.equal(result.source,'EPIC_FHIR_R4');assert.equal(result.context.patient.id,'contract-patient');assert(networkReads>=7);
  const reads=networkReads;assert.deepEqual(await invoke(client,'get_epic_patient_context',request),result);assert.equal(networkReads,reads);
  fail=true;await invoke(client,'get_epic_patient_context',{...request,idempotency_key:randomUUID()},true);fail=false;
  pass('Epic tool performs authorized HTTP reads; exact retry avoids another fetch; external failure never returns synthetic records');
  const previewSession=preview.getSessionId();
  for(const method of ['POST','GET','DELETE']){
    const r=await fetch(endpoint,{method,headers:{...headers,'mcp-session-id':previewSession,'MCP-Protocol-Version':'2025-11-25','x-shiftweave-source':'preview','Content-Type':'application/json',Accept:'application/json, text/event-stream'},...(method==='POST'?{body:JSON.stringify({jsonrpc:'2.0',id:900,method:'tools/list'})}:{})});assert.equal(r.status,403);
  }pass('a stolen preview transport ID or spoofed source header cannot authorize POST, GET or DELETE');
  const {sourceContext}=await import('../src/services/source-context.js');const {sourceVersion}=await import('../src/services/source-version.js');
  const epicVersion=sourceContext.run('epic',()=>sourceVersion()),previewVersion=sourceContext.run('preview',()=>sourceVersion());
  db.prepare("UPDATE tasks SET description='Preview-only change' WHERE id='hospital:task:paperwork'").run();
  assert.equal(sourceContext.run('epic',()=>sourceVersion()),epicVersion);assert.notEqual(sourceContext.run('preview',()=>sourceVersion()),previewVersion);
  const previewVersion2=sourceContext.run('preview',()=>sourceVersion());db.prepare("UPDATE tasks SET description='EHR-only change' WHERE id='ehr:task'").run();assert.equal(sourceContext.run('preview',()=>sourceVersion()),previewVersion2);
  pass('preview changes do not invalidate Epic recovery fingerprints, and Epic changes do not invalidate preview');
  const flow='shared-reviewer-flow';
  const save=(value:string)=>({workflow_run_id:flow,step_index:1,step_name:'REVIEWED',state_payload:{value},idempotency_key:randomUUID()});
  const pc=await invoke(preview,'save_workflow_checkpoint',save('preview'));const ec=await invoke(client,'save_workflow_checkpoint',save('epic'));
  assert.notEqual(pc.checkpoint.workflowRunId,ec.checkpoint.workflowRunId);
  await invoke(client,'get_workflow_checkpoint',{workflow_run_id:pc.checkpoint.workflowRunId},true);
  await invoke(preview,'resume_workflow',{workflow_run_id:ec.checkpoint.workflowRunId,idempotency_key:randomUUID()},true);
  pass('workflow identifiers and checkpoints cannot be read or resumed from another realm');
  await invoke(client,'publish_reviewed_handoff_note',{handoff_id:'not-a-real-handoff',nurse_id:'ehr:nurse',human_confirmed:true,execution_mode:'mock',idempotency_key:randomUUID()},true);
  await invoke(client,'claim_hospital_task',{nurse_id:'hospital:seema',shift_id:'hospital:shift',task_id:'hospital:task:welcome-pack',human_confirmed:true,idempotency_key:randomUUID()},true);
  pass('Epic clients cannot execute preview claims or mock write-back');
  const dashboard=await (await fetch(base+'/api/voice/'+randomUUID())).json() as any;assert.equal(dashboard.dataSource,'hospital');
  const taskList=await (await fetch(base+'/api/tasks')).json() as any;assert(taskList.tasks.every((t:any)=>t.id.startsWith('hospital:')));
  const handoffList=await (await fetch(base+'/api/handoffs')).json() as any;assert(handoffList.handoffs.length>0);assert(handoffList.handoffs.every((h:any)=>JSON.parse(h.structuredSnapshot).tasks.every((t:any)=>t.id.startsWith('hospital:'))));
  for(const url of ['/api/provider/switch','/api/handoffs/not-real/publish-note'])assert.equal((await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const traces=await (await fetch(base+'/api/execution-trace')).json() as any;assert(traces.logs.every((l:any)=>l.details?._sourceRealm==='preview'));
  pass('dashboard defaults preview; task, handoff and trace routes stay scoped; preview cannot publish Epic notes or change the global provider');
  const {scopedIdentifier}=await import('../src/services/source-policy.js');
  const voiceId=sourceContext.run('preview',()=>scopedIdentifier('session_id',session));
  await invoke(preview,'save_workflow_checkpoint',{workflow_run_id:`voice:${voiceId}`,step_index:999,step_name:'OVERWRITE',state_payload:{},idempotency_key:randomUUID()},true);
  const {ConflictService}=await import('../src/services/conflict.service.js');
  assert.throws(()=>sourceContext.run('preview',()=>ConflictService.resolveConflict('not-real','ehr:nurse','COMPLETED','Verified',randomUUID())),/outside this data source/);
  pass('generic checkpoint writes cannot overwrite managed voice state and preview conflict resolution rejects an Epic actor');
  const previousSession=randomUUID();db.prepare('INSERT INTO dashboard_voice_sources(session_id,realm) VALUES(?,?)').run(previousSession,'epic');
  process.env.NODE_ENV='production';
  try {
    assert.equal((await fetch(base+'/api/voice/'+previousSession)).status,403);
    assert.equal((await fetch(base+'/api/voice-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:randomUUID(),source:'epic',expected_revision:0,idempotency_key:randomUUID()})})).status,403);
  } finally {process.env.NODE_ENV='test';}
  pass('public production preview cannot select Epic or restore an old local Epic session');
  assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  console.log(`${count} source-isolation checks passed. Epic networking used a controlled HTTP contract server; no live Epic or application database was modified.`);
}finally {
  await client?.close();await preview?.close();
  for(const server of [app,fhir])if(server?.listening){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  database?.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('shiftweave-source-test-'));rmSync(directory,{recursive:true,force:true});
}
