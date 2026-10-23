import 'dotenv/config';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

assert.equal(process.env.LLM_PROVIDER,'bedrock','This verification requires explicitly configured Bedrock');
assert.notEqual(process.env.STAFF_AUTH_REQUIRED,'true','Do not bypass authenticated staff mode');
assert(process.env.SQLITE_DB_PATH);
const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-hospital-live-')),target=path.join(directory,'test.db');
const source=new Database(process.env.SQLITE_DB_PATH,{readonly:true,fileMustExist:true});
try{await source.backup(target);}finally{source.close();}
Object.assign(process.env,{SQLITE_DB_PATH:target,HOST:'127.0.0.1',PORT:'0',NODE_ENV:'test',SHIFTWEAVE_TEST:'1',HOSPITAL_SIMULATION_ENABLED:'true',HOSPITAL_DATA_SOURCE:'sqlite',SIMULATION_MODE:'false',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false'});
let server:import('node:http').Server|undefined,database:Database.Database|undefined,bridge:import('../src/agent/mcp-client-bridge.js').MCPClientBridge|undefined;
try {
  const {appServer}=await import('../src/server.js');server=appServer;if(!server.listening)await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');
  const {db}=await import('../src/db/connection.js');database=db;
  const {MCPClientBridge}=await import('../src/agent/mcp-client-bridge.js');bridge=new MCPClientBridge(`http://127.0.0.1:${address.port}/mcp`);await bridge.initialize();
  const session_id=randomUUID();let revision=0;
  const internalId=(kind:string,id:string)=>(db.prepare('SELECT internal_id FROM source_identifiers WHERE realm=? AND kind=? AND external_id=?').get('preview',kind,id) as any)?.internal_id||id;
  const turn=async(utterance:string,model=true)=>{
    const started=Date.now();
    const auditCursor=(db.prepare('SELECT coalesce(max(rowid),0) AS n FROM audit_log').get() as any).n;
    const idempotency_key=randomUUID();
    const result=await bridge!.callTool('voice_turn',{session_id,utterance,expected_revision:revision,idempotency_key});assert(!result.isError,JSON.stringify(result));
    const display=JSON.parse(result.content[0]!.text);revision=display.revision;
    const decisions=db.prepare("SELECT latency_ms,details FROM audit_log WHERE action='LLM:VOICE_DECISION' AND target_resource=? AND rowid>? ORDER BY rowid").all(`voice:${internalId('session_id',session_id)}`,auditCursor) as any[];
    console.log(JSON.stringify({turn:revision,totalMs:Date.now()-started,decisions:decisions.map(r=>({ms:r.latency_ms,...JSON.parse(r.details)}))}));
    assert.equal(decisions.length,model?1:0,'Normal voice workflow must not require another model call');
    if(model){const audit=db.prepare("SELECT outcome FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=? ORDER BY rowid DESC LIMIT 1").get(`voice:${internalId('session_id',session_id)}`) as any;
      if(audit?.outcome!=='SUCCESS'){
        const checkpoint=db.prepare('SELECT state_payload FROM workflow_checkpoints WHERE workflow_run_id=? ORDER BY step_index DESC LIMIT 1').get(`voice-model:${internalId('idempotency_key',idempotency_key)}`) as any;
        const state=JSON.parse(checkpoint.state_payload).semantic;
        console.log(JSON.stringify({failureCode:state.failureCode,replies:state.messages.filter((m:any)=>m.toolCall?.toolName==='reply_to_nurse').map((m:any)=>m.toolCall.arguments),pending:state.pendingTool?.args}));
      }
      assert.equal(audit?.outcome,'SUCCESS',display.speech);}
    return display;
  };
  let display=await turn('Medi, my name is Jordan Lee. What is waiting for me today?');assert.equal(display.nurse.id,'hospital:jordan');assert(display.tasks.length>=2);
  display=await turn('Can I pick up some extra work?');assert(display.availableTasks.length>=1);
  display=await turn('Please assign Check patient information pack to me');assert(display.pending?.ready,display.speech);
  assert(!db.prepare("SELECT id FROM task_assignments WHERE task_id='hospital:task:welcome-pack' AND transfer_status='ACTIVE'").get());
  display=await turn('Confirm',false);assert(display.tasks.some((t:any)=>t.id==='hospital:task:welcome-pack'));
  display=await turn('What work belongs to me now?');assert(display.tasks.some((t:any)=>t.id==='hospital:task:welcome-pack'));
  if(process.argv.includes('--speech')){
    const {ElevenLabsService}=await import('../src/services/elevenlabs.service.js');
    assert(ElevenLabsService.isConfigured(),'Configure ElevenLabs explicitly for --speech');
    const audioStarted=Date.now();let received=false;
    try {
      const result=await ElevenLabsService.streamSpeech({text:display.speech});assert(result);
      for await(const chunk of result.stream as any){assert(chunk.length>0);received=true;break;}
      assert(received,'Speech service returned no audio');
      console.log(JSON.stringify({speechFirstChunkMs:Date.now()-audioStarted,note:'Real ElevenLabs streaming bytes; physical playback not measured'}));
    } catch {throw new Error('Configured ElevenLabs streaming check failed; check provider quota, permissions and connectivity');}
  }
  console.log('PASS configured live Bedrock → MCP → SQLite: natural Jordan introduction, extra-work request, explicit self-assignment proposal, human confirmation and persisted follow-up. Only a temporary database copy was changed.');
}finally{
  await bridge?.close();if(server?.listening){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}database?.close();
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('shiftweave-hospital-live-'));rmSync(directory,{recursive:true,force:true});
}
