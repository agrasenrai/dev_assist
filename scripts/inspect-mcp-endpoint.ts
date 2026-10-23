import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

const endpoint=process.argv[2];if(!endpoint)throw new Error('Provide the HTTPS /mcp endpoint');
const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('Remote inspection requires HTTPS');
const client=new Client({name:'shiftweave-read-only-inspection',version:'1.0.0'});
const token=process.env.MCP_REMOTE_AUTH_TOKEN||process.env.MCP_AUTH_TOKEN;
try {
  const transport=new StreamableHTTPClientTransport(url,{requestInit:{redirect:'error',headers:token?{Authorization:`Bearer ${token}`}:{}}});
  await client.connect(transport as Transport);
  const result=await client.listTools();const names=result.tools.map(t=>t.name).sort();
  const latest=['claim_hospital_task','refresh_hospital_records','select_voice_source','review_simulation'];
  console.log(JSON.stringify({endpoint,connected:true,server:client.getServerVersion(),toolCount:names.length,tools:names,
    missingHospitalTools:latest.filter(t=>!names.includes(t)),inspection:'initialize and tools/list only; no tool execution or database mutations'},null,2));
}catch(error){
  const message=error instanceof Error?error.message:'Connection failed';
  console.log(JSON.stringify({endpoint,connected:false,error:message,inspection:'No tool execution or deployment performed'}));process.exitCode=1;
}finally{await client.close();}
