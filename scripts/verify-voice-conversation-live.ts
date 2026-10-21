import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Uses the configured real model, an isolated database and synthetic conversation only.
assert(['bedrock','aws'].includes(process.env.LLM_PROVIDER || ''),'Select Bedrock to run this live check');
const root = realpathSync(tmpdir());
const directory = mkdtempSync(path.join(root,'shiftweave-voice-live-'));
Object.assign(process.env,{SQLITE_DB_PATH:path.join(directory,'test.db'),PORT:'0',HOST:'127.0.0.1',
  NODE_ENV:'test',SHIFTWEAVE_TEST:'1',STAFF_AUTH_REQUIRED:'false',DEMO_USER:'',DEMO_PASSWORD:'',
  MCP_AUTH_TOKEN:'',PUBLIC_ORIGIN:'',EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false'});
const { appServer } = await import('../src/server.js');
const { db } = await import('../src/db/connection.js');
const { MCPClientBridge } = await import('../src/agent/mcp-client-bridge.js');
let bridge: InstanceType<typeof MCPClientBridge> | undefined;
try {
  if(!appServer.listening) await once(appServer,'listening');
  const address=appServer.address();assert(address && typeof address!=='string');
  bridge=new MCPClientBridge(`http://127.0.0.1:${address.port}/mcp`);await bridge.initialize();
  const session=randomUUID();let revision=0;
  const patientOnly=process.argv.includes('--patient-only');
  for(const utterance of patientOnly?[]:['can you do that one thing for me I am just not feeling well',"okay I don't like to talk to you"]){
    const input={session_id:session,utterance,expected_revision:revision,idempotency_key:randomUUID()};
    const start=Date.now();
    const result=await bridge.callTool('voice_turn',input);assert(!result.isError,'Voice tool returned an error');
    const display=JSON.parse(result.content[0]!.text);revision=display.revision;
    const execution=db.prepare("SELECT outcome,details FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=? ORDER BY rowid DESC LIMIT 1").get(`voice:${session}`) as {outcome:string;details:string}|undefined;
    assert.equal(execution?.outcome,'SUCCESS','Configured conversation model was unavailable; the voice response reports that failure');
    assert.equal(display.nurse,null);assert.doesNotMatch(display.speech,/could not match that name|what is your registered nurse name/i);
    const before=(db.prepare("SELECT count(*) n FROM audit_log WHERE action='LLM:VOICE_CONVERSATION'").get() as {n:number}).n;
    const retry=await bridge.callTool('voice_turn',input);assert.deepEqual(retry,result);
    assert.equal((db.prepare("SELECT count(*) n FROM audit_log WHERE action='LLM:VOICE_CONVERSATION'").get() as {n:number}).n,before);
    console.log(JSON.stringify({check:'LIVE_VOICE_CONVERSATION',provider:JSON.parse(execution!.details).provider,
      turn:revision,status:'PASSED',elapsedMs:Date.now()-start,retry:'SAVED_RESPONSE',speech:display.speech}));
  }
  if(process.argv.includes('--workflow')) {
    const {importIncomingData}=await import('../src/db/ingest.js');importIncomingData();
    const task=db.prepare(`SELECT t.id,t.title,p.full_name FROM tasks t JOIN patients p ON p.id=t.patient_id
      WHERE NOT EXISTS(SELECT 1 FROM conflicts c WHERE c.task_id=t.id AND c.status='UNRESOLVED') LIMIT 1`).get() as any;
    assert(task);db.prepare("UPDATE tasks SET status='PENDING',completed_time=NULL WHERE id=?").run(task.id);
    const say=async(utterance:string,control=false)=>{
      const result=await bridge!.callTool('voice_turn',{session_id:session,utterance,expected_revision:revision,idempotency_key:randomUUID()});
      assert(!result.isError,'Live semantic voice tool failed');const display=JSON.parse(result.content[0]!.text);revision=display.revision;
      if(!control){const latest=db.prepare("SELECT outcome,details FROM audit_log WHERE action='LLM:VOICE_CONVERSATION' AND target_resource=? ORDER BY rowid DESC LIMIT 1").get(`voice:${session}`)as any;
        if(latest?.outcome!=='SUCCESS'){
          const saved=db.prepare("SELECT state_payload FROM workflow_checkpoints WHERE step_name='VOICE_LLM_RESULT' ORDER BY rowid DESC LIMIT 1").get()as any;
          const semantic=saved?JSON.parse(saved.state_payload).semantic:undefined;
          console.log(JSON.stringify({syntheticFixtureReplyDiagnostic:semantic?.pendingTool?.args}));
        }
        assert.equal(latest?.outcome,'SUCCESS',`Live semantic turn was not verified (${latest?.details}): ${display.speech}`);}
      const trace=db.prepare("SELECT state_payload FROM workflow_checkpoints WHERE step_name='VOICE_LLM_RESULT' ORDER BY rowid DESC LIMIT 1").get()as any;
      const semantic=trace?JSON.parse(trace.state_payload).semantic:undefined;
      console.log(JSON.stringify({check:'LIVE_SEMANTIC_WORKFLOW',utterance,speech:display.speech,status:'PASSED',intent:semantic?.action?.intent,
        toolSequence:semantic?.messages.filter((m:any)=>m.toolCall).map((m:any)=>m.toolCall.toolName)}));return display;
    };
    assert.equal((await say('Seema here, ready to get started')).nurse.id,'nurse_seema_01');
    if(!patientOnly){const focus=await say('What should I focus on today?');assert.match(focus.speech,/pending|review|unfinished/i);}
    const patient=await say(`Catch me up on ${task.full_name}`);assert(patient.speech.includes(task.full_name));
    if(!patientOnly){
    const details=await say(`How is ${task.title} for ${task.full_name} coming along?`);assert.match(details.speech,/pending/i);assert.equal(details.selectedTaskId,task.id);
    const proposed=await say('I’ve finished that one');assert.equal(proposed.pending?.ready,true);
    assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id)as any).status,'PENDING');
    await say('Confirm',true);assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id)as any).status,'COMPLETED');
    const completed=await say('Did that get done?');assert.match(completed.speech,/completed/i);
    const before=(db.prepare('SELECT count(*) n FROM task_events').get()as any).n;
    assert.equal((await say('Don’t change anything, just tell me how that one stands')).pending,null);
    assert.equal((db.prepare('SELECT count(*) n FROM task_events').get()as any).n,before);
    assert.equal((await say('I am confused')).nurse.id,'nurse_seema_01');
    }
  }
} catch(error) {
  // Do not print raw external SDK errors or credentials.
  console.error(error instanceof assert.AssertionError ? error.message : 'Live voice conversation check failed; inspect sanitized execution status.');
  process.exitCode=1;
} finally {
  await bridge?.close();
  appServer.closeAllConnections();
  await new Promise<void>(resolve=>appServer.close(()=>resolve()));db.close();
  const resolved=realpathSync(directory);
  if(path.dirname(resolved)===root && path.basename(resolved).startsWith('shiftweave-voice-live-'))rmSync(resolved,{recursive:true,force:true});
}
