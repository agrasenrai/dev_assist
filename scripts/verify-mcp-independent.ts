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
  const session_id=randomUUID();const display=await call('get_voice_display',{session_id});
  assert.equal(display.dataSource,'epic','An ordinary external MCP client must default to Epic');
  assert(!display.availableNurses?.some((n:any)=>n.id.startsWith('hospital:')));
  for(const name of ['claim_hospital_task','review_simulation','refresh_hospital_records','select_voice_source'])assert(!tools.tools.some(t=>t.name===name));
  const synthetic=await client.callTool({name:'get_task_details',arguments:{task_id:'hospital:task:paperwork'}});assert(synthetic.isError);
  assert(client.getServerCapabilities()?.tools);
  console.log('PASS independent official MCP SDK client defaults to Epic, cannot discover preview controls and cannot read a synthetic task. No dashboard/database/server imports.');
} finally {await client.close();}
