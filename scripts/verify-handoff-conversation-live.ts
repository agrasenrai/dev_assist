import 'dotenv/config';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

assert.equal(process.env.LLM_PROVIDER,'bedrock');assert(process.env.SQLITE_DB_PATH);
const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-handoff-live-'));
const target=path.join(directory,'copy.db');
const source=new Database(process.env.SQLITE_DB_PATH,{readonly:true,fileMustExist:true});
try{await source.backup(target);}finally{source.close();}
Object.assign(process.env,{SQLITE_DB_PATH:target,PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',SHIFTWEAVE_TEST:'1',STAFF_AUTH_REQUIRED:'false',SIMULATION_MODE:'false',MCP_AUTH_TOKEN:'',PUBLIC_ORIGIN:'',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false'});
let server:import('node:http').Server|undefined,db:Database.Database|undefined;
try{
 db=(await import('../src/db/connection.js')).db;
 server=(await import('../src/server.js')).appServer;
 const {BedrockLLMProvider}=await import('../src/agent/llm-provider.js');
 const decide=BedrockLLMProvider.prototype.decideNextStep;
 BedrockLLMProvider.prototype.decideNextStep=async function(...args){
  try{return await decide.apply(this,args);}catch(error){
   const failure=error as {name?:string;$metadata?:{httpStatusCode?:number}};
   console.log(JSON.stringify({providerErrorType:failure.name,httpStatus:failure.$metadata?.httpStatusCode}));throw error;
  }
 };
 if(!server.listening)await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');
 let session_id:string=randomUUID(),revision=0;
 const resuming=process.argv.includes('--resume-existing');
 if(resuming){
  const saved=(db.prepare("SELECT workflow_run_id,state_payload FROM workflow_checkpoints WHERE step_name='VOICE_AGENT_RESULT' ORDER BY rowid DESC").all() as {workflow_run_id:string;state_payload:string}[]).find(row=>{
   const voice=JSON.parse(row.state_payload).voice;
   return voice?.nurse?.id==='staff:jordan'&&voice.messages.some((m:any)=>m.text.includes('Patel has already left of I am Jordan re'));
  });
  assert(saved,'No matching persisted conversation to resume');
  session_id=saved.workflow_run_id.replace(/^voice:/,'');revision=JSON.parse(saved.state_payload).voice.revision;
 }
 const assignments=db.prepare('SELECT * FROM task_assignments ORDER BY id').all();
 const handoffs=db.prepare('SELECT * FROM handoffs ORDER BY id').all();
 const utterances=resuming?['Seema Patel','Patel']:[
  'Patel has already left of I am Jordan re so I want to know what where she left I want to continue from there',
  'why there is no hand of available for me Reema already left in between',
  'Patel','Seema Patel','Patel'
 ];
 for(const [index,utterance] of utterances.entries()){
  const input={session_id,utterance,expected_revision:revision,idempotency_key:randomUUID()};
  const beforeModel=(db.prepare("SELECT count(*) n FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=?").get(`voice:${session_id}`) as any).n;
  const response:Response=await fetch(`http://127.0.0.1:${address.port}/api/voice`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(125000)});
  const result=await response.json();assert.equal(response.status,200);revision=result.revision;
  const audit=db.prepare("SELECT outcome,details FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=? ORDER BY rowid DESC LIMIT 1").get(`voice:${session_id}`) as any;
  const afterModel=(db.prepare("SELECT count(*) n FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=?").get(`voice:${session_id}`) as any).n;
  if(afterModel>beforeModel&&audit?.outcome!=='SUCCESS'){
   const saved=db.prepare("SELECT state_payload FROM workflow_checkpoints WHERE workflow_run_id=? ORDER BY step_index DESC LIMIT 1").get(`voice-model:${input.idempotency_key}`) as any;
   const semantic=JSON.parse(saved.state_payload).semantic;
   console.log(JSON.stringify({failureCode:semantic.failureCode,pendingTool:semantic.pendingTool?.name,decisions:semantic.messages.filter((m:any)=>m.toolCall).map((m:any)=>({tool:m.toolCall.toolName,intent:m.toolCall.arguments?.intent}))}));
  }
  if(afterModel>beforeModel)assert.equal(audit?.outcome,'SUCCESS',`Turn ${index+1}: ${audit?.details}; ${result.speech}`);
  assert.equal(result.nurse?.id,'staff:jordan','A colleague reference must not switch the current speaker');
  assert.match(result.speech,/saved handoff/);
  assert.doesNotMatch(result.speech,/Please give the nurse|couldn.t generate|Bedrock right now|say .prepare/i);
  assert.equal(result.pending,null);
  if(index>=2||resuming)assert.match(result.speech,/Seema Patel/);
  assert.deepEqual(db.prepare('SELECT * FROM task_assignments ORDER BY id').all(),assignments);
  assert.deepEqual(db.prepare('SELECT * FROM handoffs ORDER BY id').all(),handoffs);
  console.log(JSON.stringify({check:'LIVE_MISSING_HANDOFF_CONVERSATION',turn:index+1,resumedPersistedConversation:resuming,interpretation:afterModel>beforeModel?'BEDROCK':'DURABLE_HANDOFF_REFERENCE',status:'SUCCESS',speakerPreserved:true,custodyUnchanged:true}));
 }
}finally{
 if(server?.listening){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
 db?.close();rmSync(directory,{recursive:true,force:true});
}
