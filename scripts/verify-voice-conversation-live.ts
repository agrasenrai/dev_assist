import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Uses the configured real model, an isolated database and synthetic conversation only.
assert(['bedrock','aws','gemini','google'].includes(process.env.LLM_PROVIDER || ''),'Select an existing cloud LLM adapter to run this live check');
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
  for(const utterance of ['can you do that one thing for me I am just not feeling well',"okay I don't like to talk to you"]){
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
