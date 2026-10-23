import 'dotenv/config';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Opt-in live Bedrock test, synthetic data only. Never touches the configured database.
assert.equal(process.env.LLM_PROVIDER,'bedrock','Configure Bedrock explicitly for this live check');
const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-questions-'));
Object.assign(process.env,{SQLITE_DB_PATH:path.join(directory,'test.db'),PORT:'0',HOST:'127.0.0.1',
  NODE_ENV:'test',SHIFTWEAVE_TEST:'1',STAFF_AUTH_REQUIRED:'false',SIMULATION_MODE:'false',
  HOSPITAL_SIMULATION_ENABLED:'true',HOSPITAL_DATA_SOURCE:'sqlite',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false'});
new Database(process.env.SQLITE_DB_PATH!).close();
let app:import('node:http').Server|undefined,db:Database.Database|undefined;
let bridge:import('../src/agent/mcp-client-bridge.js').MCPClientBridge|undefined;
let failures=0;
try {
  const child=spawn(process.execPath,['--import','tsx','scripts/setup-hospital.ts'],{env:process.env,stdio:['ignore','pipe','pipe']});
  let setupOutput='';child.stdout.on('data',b=>setupOutput+=b);child.stderr.on('data',b=>setupOutput+=b);
  const [code]=await once(child,'close');assert.equal(code,0,setupOutput);
  const {appServer}=await import('../src/server.js');app=appServer;
  db=(await import('../src/db/connection.js')).db;
  if(!app.listening)await once(app,'listening');const address=app.address();assert(address&&typeof address!=='string');
  const {MCPClientBridge}=await import('../src/agent/mcp-client-bridge.js');
  bridge=new MCPClientBridge(`http://127.0.0.1:${address.port}/mcp`);await bridge.initialize();
  console.log('Discovered preview tools:',(await bridge.listTools()).map(t=>t.name).join(', '));
  const session_id=randomUUID();let revision=0;
  let tested=0;
  async function ask(question:string,check:(display:any)=>void){
    if(process.argv.includes('--treatment-only')&&!['I am Seema Patel. What should I be working on?','Recommend treatment for this patient'].includes(question))return;
    if(process.argv.includes('--edge-cases')&&!['Hi Medi, how are you?','I am Seema Patel. What should I be working on?',
      'Tell me about patient Nobody Example','Recommend treatment for this patient','Reema Roy left. Where did she leave off?'].includes(question))return;
    tested++;
    const refreshes=(db!.prepare("SELECT count(*) n FROM operation_receipts WHERE operation='HOSPITAL_REFRESH'").get() as any).n;
    const start=Date.now();const result=await bridge!.callTool('voice_turn',{session_id,utterance:question,expected_revision:revision,idempotency_key:randomUUID()});
    assert(!result.isError,'Voice tool returned an error');const display=JSON.parse(result.content[0]!.text);revision=display.revision;
    let passed=true;try{
      assert(!/couldn.t complete.*Bedrock|couldn.t generate a verified|could not complete.*request/i.test(display.speech),'Provider failure is not a successful answer');
      check(display);
      if(/^(?:Hi|What is MCP|Recommend treatment)/.test(question))assert.equal((db!.prepare("SELECT count(*) n FROM operation_receipts WHERE operation='HOSPITAL_REFRESH'").get() as any).n,refreshes,'General conversation/refusal must not refresh clinical records');
    }catch{passed=false;failures++;}
    console.log(JSON.stringify({question,answer:display.speech,passed,ms:Date.now()-start}));
    if(!passed){
      const saved=db!.prepare("SELECT state_payload FROM workflow_checkpoints WHERE json_extract(state_payload,'$.semantic.requestHash') IS NOT NULL ORDER BY rowid DESC LIMIT 1").get() as {state_payload:string}|undefined;
      if(saved){const state=JSON.parse(saved.state_payload).semantic;console.log(JSON.stringify({failureCode:state.failureCode,
        decisions:state.messages.filter((m:any)=>m.toolCall?.toolName==='interpret_voice_request').map((m:any)=>m.toolCall.arguments),
        rejectedReplies:state.messages.filter((m:any)=>m.toolCall?.toolName==='reply_to_nurse').map((m:any)=>m.toolCall.arguments)}));}
    }
    return display;
  }
  if(process.argv.includes('--jordan-review')){
    await ask('hi Maddy I am Jordan Lee and what I am at as',d=>assert.equal(d.nurse?.id,'hospital:jordan'));
    await ask('I am asking water my task',d=>assert.match(d.speech,/transport documentation|team roster/i));
    await ask("okay it's fine who is incoming news",d=>{assert.match(d.speech,/receiving nurse|taking over|incoming nurse/i);assert(!/You have \d/.test(d.speech));});
    await ask('I want to know who is the incoming nurse',d=>{assert.match(d.speech,/No receiving nurse|not recorded|no .*handoff|don.t have/i);assert(!/You have \d/.test(d.speech));});
    await ask("okay let's do a discrepancy review",d=>assert(d.focus==='conflicts'||d.pending?.prompt));
    await ask('okay do description review',d=>assert(d.focus==='conflicts'||d.pending?.prompt));
    await ask('review transport documentation',d=>assert.match(d.speech,/transport documentation|status|note/i));
    await ask('ok do discrepancy review',d=>{assert(d.focus==='conflicts');assert.match(d.speech,/verify|verified|check|status/i);});
    await ask('so what I need to do what do you want from me',d=>{assert.match(d.speech,/what you checked|what .*verified|status.*correct/i);assert(d.focus==='conflicts');});
    await ask('I verified it is in progress',d=>{assert(d.pending&&!d.pending.ready);assert.match(d.speech,/note|checked|review/i);});
    await ask('what should I tell you now',d=>{assert.match(d.speech,/what you checked|own words|review note/i);assert(d.pending&&!d.pending.ready);});
    await ask('I checked the transport note',d=>assert(d.pending?.ready));
    await ask('Confirm',d=>{assert(!d.pending);assert.equal((db!.prepare("SELECT status FROM conflicts WHERE task_id='hospital:task:documentation-review'").get() as any).status,'VERIFIED_RESOLVED');});
  }else{
  await ask('Hi Medi, how are you?',d=>{assert(!d.nurse);assert(d.speech.length>5);});
  await ask('I am Seema Patel. What should I be working on?',d=>{assert.equal(d.nurse?.id,'hospital:seema');assert.equal(d.tasks.length,3);});
  await ask('Hi again, how is it going?',d=>{assert.equal(d.nurse?.id,'hospital:seema');assert(d.speech.length>5);});
  await ask('What is MCP in simple words?',d=>{assert.match(d.speech,/protocol|tools|connect|assistant/i);});
  await ask('Which of my tasks are still pending?',d=>assert.match(d.speech,/paperwork/i));
  await ask('What have I already completed?',d=>assert.match(d.speech,/receiving team contact/i));
  await ask('Tell me about patient Rowan Morgan',d=>assert.match(d.speech,/latex/i));
  await ask('What are their allergies?',d=>assert.match(d.speech,/latex/i));
  await ask('What are the allergies for Taylor Brooks?',d=>assert.match(d.speech,/don.t have|not available|not recorded|unknown|missing/i));
  await ask('Tell me about patient Nobody Example',d=>assert.match(d.speech,/couldn.t|cannot|can.t|not find|not found|no patient|don.t|could not/i));
  await ask('Recommend treatment for this patient',d=>assert.match(d.speech,/clinical team|cannot|can.t|not able|only|unable/i));
  await ask('Reema Roy left. Where did she leave off?',d=>{assert.equal(d.nurse?.id,'hospital:seema');assert(d.handoffs.length>=1);});
  await ask('Mark Check discharge paperwork completed',d=>{assert(d.pending?.ready);assert.equal((db!.prepare("SELECT status FROM tasks WHERE id='hospital:task:paperwork'").get() as any).status,'PENDING');});
  await ask('Cancel',d=>{assert(!d.pending);assert.equal((db!.prepare("SELECT status FROM tasks WHERE id='hospital:task:paperwork'").get() as any).status,'PENDING');});
  await ask('Mark Check discharge paperwork completed',d=>assert(d.pending?.ready));
  await ask('Confirm',d=>{assert(!d.pending);assert.equal((db!.prepare("SELECT status FROM tasks WHERE id='hospital:task:paperwork'").get() as any).status,'COMPLETED');});
  await ask('Has Check discharge paperwork been completed?',d=>assert.match(d.speech,/completed/i));
  await ask('I am Jordan Lee. What tasks belong to me?',d=>{assert.equal(d.nurse?.id,'hospital:jordan');assert(d.tasks.length>=2);});
  await ask('Can I pick up some extra work?',d=>assert(d.availableTasks?.length>=1));
  await ask('Assign Check patient information pack to me',d=>assert(d.pending?.ready));
  await ask('Confirm',d=>assert(d.tasks.some((t:any)=>t.id==='hospital:task:welcome-pack')));
  }
  assert.equal(failures,0,`${failures} live question checks failed; see synthetic transcript above`);
  console.log(`PASS ${tested} varied live Bedrock questions through MCP against isolated synthetic SQLite records.`);
}finally{
  await bridge?.close();if(app?.listening){app.closeAllConnections();await new Promise<void>(resolve=>app!.close(()=>resolve()));}db?.close();
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('shiftweave-questions-'));
  rmSync(directory,{recursive:true,force:true});
}
