import 'dotenv/config';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

assert.equal(process.env.LLM_PROVIDER,'bedrock','Configure Bedrock for this live check');
assert(process.env.SQLITE_DB_PATH,'Configure the source application database');
const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-bedrock-reply-'));
const file=path.join(directory,'copy.db');
const source=new Database(process.env.SQLITE_DB_PATH,{readonly:true,fileMustExist:true});
try{await source.backup(file);}finally{source.close();}
Object.assign(process.env,{SQLITE_DB_PATH:file,NODE_ENV:'test',HOST:'127.0.0.1',PORT:'0',SHIFTWEAVE_TEST:'1',SIMULATION_MODE:'false',STAFF_AUTH_REQUIRED:'false',MCP_AUTH_TOKEN:'',PUBLIC_ORIGIN:'',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false'});
let server:import('node:http').Server|undefined,db:Database.Database|undefined;
try{
 const connection=await import('../src/db/connection.js');db=connection.db;
 const application=await import('../src/server.js');server=application.appServer;
 const {BedrockLLMProvider}=await import('../src/agent/llm-provider.js');
 const decide=BedrockLLMProvider.prototype.decideNextStep;let decisions=0;
 BedrockLLMProvider.prototype.decideNextStep=async function(...args){decisions++;try{return await decide.apply(this,args);}catch(error){
  const failure=error as {name?:string;message?:string;$metadata?:{httpStatusCode?:number}};
  console.log(JSON.stringify({providerErrorType:failure.name,httpStatus:failure.$metadata?.httpStatusCode,validationFields:failure.message?.match(/toolUseId|tool_use\.id|tool_result|tool_use|toolResult|toolConfig|length|rate|throttl|timeout|timed out|credentials/gi)}));throw error;
 }};
 if(!server.listening)await once(server,'listening');
 const address=server.address();assert(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}/api/voice`,session_id=randomUUID();
 const input={session_id,utterance:'I am seema patel , whats my tasks',expected_revision:0,idempotency_key:randomUUID()};
 const post=async(body:unknown)=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(125000)});assert.equal(response.status,200);return response.json();};
 const before=(db.prepare('SELECT count(*) n FROM task_events').get() as any).n;
 const started=Date.now(),result=await post(input);const elapsedMs=Date.now()-started;
 assert.equal(result.nurse?.id,'staff:seema');assert(result.tasks.length>0);
 const execution=db.prepare("SELECT outcome,details FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=? ORDER BY rowid DESC LIMIT 1").get(`voice:${session_id}`) as any;
 const details=JSON.parse(execution.details);
 assert.equal(execution.outcome,'SUCCESS',`Bedrock record reply rejected: ${details.failureCode}`);
 assert.doesNotMatch(result.speech,/couldn.t generate a verified|couldn.t verify|Bedrock right now/);
 const ids=db.prepare("SELECT task_id FROM task_assignments WHERE nurse_id=? AND shift_id=? AND transfer_status IN ('ACTIVE','CARRIED_FORWARD') ORDER BY task_id").all(result.nurse.id,result.shift.id) as {task_id:string}[];
 assert.deepEqual(result.tasks.map((t:any)=>t.id).sort(),ids.map(t=>t.task_id));
 assert.equal((db.prepare('SELECT count(*) n FROM task_events').get() as any).n,before);
 assert.deepEqual(await post(input),result);
 console.log(JSON.stringify({check:'LIVE_BEDROCK_SEEMA_RECORD_REPLY',provider:details.provider,status:execution.outcome,matchedTasks:ids.length,elapsedMs,modelDecisions:decisions,exactRetry:'SAVED_RESPONSE',taskMutations:0}));
 if(process.argv.includes('--measure-followup')){
  const beforeDecisions=decisions,start=Date.now();
  const followup=await post({session_id,utterance:'What tasks are pending?',expected_revision:result.revision,idempotency_key:randomUUID()});
  const audit=db.prepare("SELECT outcome,details FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=? ORDER BY rowid DESC LIMIT 1").get(`voice:${session_id}`) as any;
  assert.equal(audit.outcome,'SUCCESS',audit.details);assert.match(followup.speech,/pending|no .*task/i);
  console.log(JSON.stringify({check:'LIVE_BEDROCK_FOLLOWUP_LATENCY',status:audit.outcome,elapsedMs:Date.now()-start,modelDecisions:decisions-beforeDecisions}));
 }
}finally{
 if(server?.listening){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
 db?.close();rmSync(directory,{recursive:true,force:true});
}
