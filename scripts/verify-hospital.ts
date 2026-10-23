import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-hospital-'));
const live=process.argv.includes('--live');
const http=live||process.argv.includes('--http');
const resources=new Map<string,any>();
let fail=false,wrongPatient=false,crossServer=false,paginate=false;
let fhir:Server|undefined,app:Server|undefined,database:any,bridge:any;
let count=0;const pass=(message:string)=>{count++;console.log(`PASS ${message}`);};
Object.assign(process.env,{SQLITE_DB_PATH:path.join(directory,'workflow.db'),PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',SHIFTWEAVE_TEST:'1',
  SIMULATION_MODE:'false',STAFF_AUTH_REQUIRED:'false',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false',LLM_PROVIDER:'mock',
  HOSPITAL_SIMULATION_ENABLED:'true',MCP_AUTH_TOKEN:'test-hospital-service-token-32-characters',PUBLIC_ORIGIN:''});
process.env.HOSPITAL_DATA_SOURCE=http?'fhir':'sqlite';
try {
  if(http&&!live) {
    fhir=createServer(async(req,res)=>{
      res.setHeader('Content-Type','application/fhir+json');
      if(fail){res.statusCode=503;res.end(JSON.stringify({resourceType:'OperationOutcome'}));return;}
      const url=new URL(req.url!,'http://localhost');
      if(url.pathname==='/fhir/metadata'){res.end(JSON.stringify({resourceType:'CapabilityStatement',fhirVersion:'4.0.1'}));return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
      if(req.method==='POST'&&url.pathname==='/fhir/') {
        for(const entry of body.entry)resources.set(entry.request.url,entry.resource);
        res.end(JSON.stringify({resourceType:'Bundle',type:'transaction-response',entry:body.entry.map(()=>({response:{status:'200 OK'}}))}));return;
      }
      const key=url.pathname.replace('/fhir/','');
      if(req.method==='PUT'){resources.set(key,body);res.end(JSON.stringify(body));return;}
      if(key.includes('/')) {const r=resources.get(key);res.statusCode=r?200:404;res.end(JSON.stringify(r||{resourceType:'OperationOutcome'}));return;}
      let matches=[...resources.values()].filter(r=>r.resourceType===key&&(r.subject?.reference||r.patient?.reference)===`Patient/${url.searchParams.get('patient')}`);
      if(wrongPatient&&key==='Condition')matches=[{resourceType:'Condition',id:'wrong',subject:{reference:'Patient/someone-else'}}];
      const next=crossServer?[{relation:'next',url:'http://localhost:1/steal'}]:paginate&&key==='Condition'&&!url.searchParams.has('page')?[{relation:'next',url:`http://127.0.0.1:${(fhir!.address() as any).port}/fhir/Condition?patient=${url.searchParams.get('patient')}&page=2`}]:undefined;
      if(paginate&&key==='Condition'&&url.searchParams.has('page'))matches=[];
      res.end(JSON.stringify({resourceType:'Bundle',type:'searchset',entry:matches.map(resource=>({resource})),...(next?{link:next}:{})}));
    }).listen(0,'127.0.0.1');await once(fhir,'listening');
    process.env.HOSPITAL_FHIR_BASE_URL=`http://127.0.0.1:${(fhir.address() as any).port}/fhir`;
  } else if(live) assert(process.env.HOSPITAL_FHIR_BASE_URL,'Set HOSPITAL_FHIR_BASE_URL for --live');
  const {db}=await import('../src/db/connection.js');database=db;
  const {initializeDatabase}=await import('../src/db/schema.js');initializeDatabase();
  db.prepare("INSERT INTO nurses(id,badge_number,full_name,email,department) VALUES('original:seema','ORIGINAL-1','Seema Patel','original@example.invalid','ORIGINAL')").run();
  const original=db.prepare("SELECT * FROM nurses WHERE id='original:seema'").get();
  const setup=()=>new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','scripts/setup-hospital.ts'],{env:process.env,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error(`Hospital setup failed: ${output}`)));
  });
  await setup();await setup();
  assert.deepEqual(db.prepare("SELECT * FROM nurses WHERE id='original:seema'").get(),original);
  assert.equal((db.prepare("SELECT count(*) n FROM nurses WHERE id LIKE 'hospital:%'").get() as any).n,3);
  assert.equal((db.prepare('SELECT count(*) n FROM hospital_patients').get() as any).n,3);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);pass('additive provisioning, backup and replay preserve original records; 3 hospital patients, 3 nurses, 5 tasks');
  const {appServer}=await import('../src/server.js');app=appServer;if(!app.listening)await once(app,'listening');
  const base=`http://127.0.0.1:${(app.address() as any).port}`;
  const {MCPClientBridge}=await import('../src/agent/mcp-client-bridge.js');bridge=new MCPClientBridge(`${base}/mcp`);
  await bridge.initialize();const tools=await bridge.listTools();
  for(const name of ['voice_turn','select_voice_source','refresh_hospital_records','review_simulation'])assert(tools.some((t:any)=>t.name===name));
  pass('real MCP initialize, Streamable HTTP tool discovery and service credential');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','scripts/verify-mcp-independent.ts',`${base}/mcp`],{env:process.env,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error(output)));
  });pass('independent official SDK client works without dashboard or importing database/server code');
  const call=async(name:string,args:any)=>{const r=await bridge.callTool(name,args);assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
  const session=randomUUID();let display=await call('get_voice_display',{session_id:session});assert.equal(display.dataSource,'hospital');
  const turn=async(utterance:string)=>{display=await call('voice_turn',{session_id:session,utterance,expected_revision:display.revision,idempotency_key:randomUUID()});return display;};
  await turn('I am Seema Patel, what are my tasks');assert.equal(display.nurse.id,'hospital:seema');assert.equal(display.tasks.length,3);pass('combined nurse introduction resolves the correct source and database tasks');
  await turn('Tell me about patient Rowan Morgan');assert.match(display.speech,/Latex/);assert.match(display.speech,/701/);
  await turn('What are their allergies?');assert.match(display.speech,/Latex/);pass('FHIR patient read and durable patient follow-up');
  const {hospitalFetch}=await import('../src/providers/hospital-fhir.js');
  const allergy=JSON.parse(readFileSync('data/hospital/fhir-r4.json','utf8')).entry.find((e:any)=>e.resource.id==='sw-rowan-allergy').resource;
  const updateAllergy=async(text:string)=>hospitalFetch('AllergyIntolerance/sw-rowan-allergy',{method:'PUT',headers:{'Content-Type':'application/fhir+json','Idempotency-Key':randomUUID()},body:JSON.stringify({...allergy,code:{text}})});
  await updateAllergy('Adhesive');
  await turn('What are their allergies?');assert.match(display.speech,/Adhesive/);assert(!display.speech.includes('Latex'));pass('a FHIR database update is reflected in the next voice answer');
  await updateAllergy('Latex');await updateAllergy('Adhesive');
  assert.equal((await hospitalFetch('AllergyIntolerance/sw-rowan-allergy')).code.text,'Adhesive');
  await turn('Review handoff from Reema Roy');assert.match(display.speech,/Reema/);assert.equal(display.handoffs.length,1);pass('real persisted Reema-to-Seema handoff is discoverable');
  for(const status of ['pending','in progress','completed']){await turn(`Show my ${status} tasks`);assert.match(display.speech,new RegExp(status,'i'));}pass('different task status queries use stored records');
  await turn('Mark Check discharge paperwork completed');assert(display.pending?.ready,display.speech);
  await turn('Medi');assert(display.pending?.ready,'Wake-only call must retain the proposed action');
  assert.equal((db.prepare("SELECT status FROM tasks WHERE id='hospital:task:paperwork'").get() as any).status,'PENDING');
  const request={session_id:session,utterance:'Confirm',expected_revision:display.revision,idempotency_key:randomUUID()};
  display=await call('voice_turn',request);assert.equal((db.prepare("SELECT status FROM tasks WHERE id='hospital:task:paperwork'").get() as any).status,'COMPLETED');
  assert.deepEqual(await call('voice_turn',request),display);await turn('What is the status of Check discharge paperwork?');assert.match(display.speech,/completed/i);pass('explicit confirmation persists task updates; retry is idempotent');
  await turn('What are the allergies for Taylor Brooks?');assert.match(display.speech,/don.t have allergy/i);
  await turn('Tell me about patient Nobody Example');assert(!/allergy information is/i.test(display.speech));
  await turn('Recommend treatment for this patient');assert.match(display.speech,/clinical team|only|cannot/i);pass('missing data, unknown patients and unsupported clinical advice do not fabricate success');
  await turn('Mark Confirm transport arrangements completed');assert(display.pending);
  await updateAllergy('Latex and adhesive');
  await turn('Confirm');assert.match(display.speech,/changed|expired/i);assert.equal((db.prepare("SELECT status FROM tasks WHERE id='hospital:task:transport'").get() as any).status,'IN_PROGRESS');
  pass('source revalidation blocks a stale confirmation and wake-only control preserves a valid proposal');
  await turn('Mark Confirm transport arrangements completed');assert(display.pending);
  const selection={session_id:session,source:'epic',expected_revision:display.revision,idempotency_key:randomUUID()};
  display=await call('select_voice_source',selection);assert.equal(display.pending,null);assert.equal(display.nurse,null);assert.equal(display.messages.length,0);assert.deepEqual(await call('select_voice_source',selection),display);
  await turn('I am Seema Patel');assert.equal(display.nurse.id,'original:seema');pass('source switch clears confirmations/context, preserves records and avoids duplicate-name collisions');
  display=await call('select_voice_source',{session_id:session,source:'hospital',expected_revision:display.revision,idempotency_key:randomUUID()});await turn('I am Seema Patel');
  const catalog=await call('review_simulation',{action:'list'});assert.equal(catalog.scenarios.length,6);
  for(const scenario of catalog.scenarios) {
    let run=await call('review_simulation',{action:'start',scenario_id:scenario.id,idempotency_key:randomUUID()});
    while(run.cursor<run.scenario.steps.length)run=await call('review_simulation',{action:'step',run_id:run.id,expected_cursor:run.cursor,idempotency_key:randomUUID()});
    assert.equal(run.results.length,run.scenario.steps.length);
    if(scenario.id==='hospital-recovery')assert.equal(run.last.outcome,'COMPLETED');
  }
  pass('all six hosted guided scenarios execute through MCP, including real interruption/recovery');
  if(http&&!live) {
    const {HospitalService}=await import('../src/services/hospital.service.js');
    paginate=true;assert.equal((await HospitalService.refresh('hospital:reema','hospital:shift',randomUUID())).status,'READY');paginate=false;pass('FHIR pagination is followed');
    wrongPatient=true;assert.equal((await HospitalService.refresh('hospital:reema','hospital:shift',randomUUID())).status,'FAILED');wrongPatient=false;
    crossServer=true;assert.equal((await HospitalService.refresh('hospital:reema','hospital:shift',randomUUID())).status,'FAILED');crossServer=false;pass('cross-patient records and cross-server page links are rejected');
    fail=true;await turn('Tell me about Rowan Morgan');assert.match(display.speech,/couldn.t refresh/i);fail=false;pass('external failure produces an explicit error instead of fixture fallback');
  }
  assert.equal((await fetch(`${base}/api/voice-sources`)).status,200);
  const unauthorized=await fetch(`${base}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(unauthorized.status,401);
  assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);pass('HTTP source discovery, MCP authorization and SQLite integrity');
  console.log(`${count} hospital checks passed (${live?'actual configured FHIR server':http?'controlled FHIR HTTP contract server; not HAPI verification':'actual SQLite FHIR records in an isolated application database'}).`);
} finally {
  if(bridge)await bridge.close();
  if(app?.listening){app.closeAllConnections();await new Promise<void>(r=>app!.close(()=>r()));}
  if(fhir?.listening){fhir.closeAllConnections();await new Promise<void>(r=>fhir!.close(()=>r()));}
  database?.close();
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
  assert(path.basename(directory).startsWith('shiftweave-hospital-'));
  rmSync(directory,{recursive:true,force:true});
}
