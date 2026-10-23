import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Deliberately imports no server, database, fixtures, dashboard or custom client bridge.
const endpoint=process.argv[2]||process.env.MCP_SERVER_URL;
if(!endpoint)throw new Error('Pass the server /mcp URL or set MCP_SERVER_URL. The tester needs no database files.');
const client=new Client({name:'independent-reviewer',version:'1.0.0'});
const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:process.env.MCP_AUTH_TOKEN?{Authorization:`Bearer ${process.env.MCP_AUTH_TOKEN}`}:{}}});
try {
  // SDK optional sessionId declaration differs under exactOptionalPropertyTypes.
  await client.connect(transport as Transport);
  const tools=await client.listTools();for(const name of ['voice_turn','get_voice_display'])assert(tools.tools.some(t=>t.name===name));
  const call=async(name:string,args:any)=>{
    const result=await client.callTool({name,arguments:args});assert(!result.isError,JSON.stringify(result));
    const content=result.content as {type:string;text?:string}[];const block=content.find(c=>c.type==='text');assert(block?.text);return JSON.parse(block.text);
  };
  const session_id=randomUUID();let display=await call('get_voice_display',{session_id});
  const nurse=display.availableNurses?.find((n:any)=>n.name===process.env.MCP_TEST_NURSE_NAME)||display.availableNurses?.find((n:any)=>n.assignedTasks>0)||display.availableNurses?.[0];
  assert(nurse,'Select/provision the synthetic hospital source; no nurse ID is hardcoded in this client');
  display=await call('voice_turn',{session_id,utterance:`I am ${nurse.name}, what tasks are assigned to me?`,expected_revision:display.revision,idempotency_key:randomUUID()});
  assert.equal(display.nurse?.id,nurse.id);assert(Array.isArray(display.tasks));assert(display.speech);
  display=await call('voice_turn',{session_id,utterance:'What tasks are still unfinished?',expected_revision:display.revision,idempotency_key:randomUUID()});
  assert(display.speech);assert.equal(display.nurse?.id,nurse.id);
  assert((await client.getServerCapabilities())?.tools);
  console.log('PASS official MCP SDK client: connection, discovery, database nurse lookup, natural-language task request and persistent follow-up. No dashboard or local database imported.');
} finally {await client.close();}
