import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import 'dotenv/config';

const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-tts-'));
Object.assign(process.env,{SQLITE_DB_PATH:path.join(directory,'test.db'),HOST:'127.0.0.1',PORT:'0',
  NODE_ENV:'test',SHIFTWEAVE_TEST:'1',LLM_PROVIDER:'mock',STAFF_AUTH_REQUIRED:'false',
  HOSPITAL_SIMULATION_ENABLED:'false',SIMULATION_MODE:'false',EPIC_READS_ENABLED:'false',
  EPIC_WRITES_ENABLED:'false',PUBLIC_ORIGIN:'',MCP_AUTH_TOKEN:'',ELEVENLABS_API_KEY:'synthetic-test-key'});
const {appServer}=await import('../src/server.js');
const {db}=await import('../src/db/connection.js');
const originalFetch=globalThis.fetch;
const originalError=console.error;
const logs:unknown[][]=[];
const marker='PRIVATE_UPSTREAM_DETAIL_DO_NOT_EXPOSE';
let mode:'http'|'network'|'success'|'stream-error'='http';
globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://api.elevenlabs.io/')) {
    if(mode==='network')throw new Error(marker);
    if(mode==='http')return new Response(marker,{status:429});
    if(mode==='stream-error')return new Response(new ReadableStream({start(controller){
      controller.enqueue(new Uint8Array([1,2,3]));
      setTimeout(()=>controller.error(new Error(marker)),30);
    }}),{headers:{'Content-Type':'audio/mpeg'}});
    return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});
  }
  return originalFetch(input,init);
};
console.error=(...args)=>{logs.push(args);};
try {
  if(!appServer.listening)await once(appServer,'listening');
  const address=appServer.address();assert(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  const requests=[['/api/tts','POST'],['/api/tts/stream','POST'],['/api/tts/stream?text=Hello','GET']] as const;
  for(const failure of ['http','network'] as const){
    mode=failure;
    for(const [route,method] of requests){
      const response=await originalFetch(base+route,{method,...(method==='POST'?{
        headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Hello'})}: {})});
      assert.equal(response.status,502);
      const body=await response.json() as {error:string;fallback:boolean};
      assert(!JSON.stringify(body).includes(marker),'TTS response exposed upstream details');
      assert.equal(body.fallback,true);assert.equal(body.error,'Speech is temporarily unavailable. Please try again.');
    }
  }
  assert(!JSON.stringify(logs).includes(marker),'TTS logs exposed upstream details');
  assert(logs.some(args=>JSON.stringify(args).includes('429')),'HTTP status missing from sanitized diagnostics');
  console.log('PASS HTTP and network failures are sanitized in responses and logs for buffered and streaming TTS');
  mode='success';
  for(const [route,method] of requests){
    const response=await originalFetch(base+route,{method,...(method==='POST'?{
      headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Hello'})}: {})});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/audio\/mpeg/);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);
  }
  mode='stream-error';
  try{const response=await originalFetch(base+'/api/tts/stream?text=Hello');await response.arrayBuffer();assert.fail('Expected interrupted audio');}
  catch(error){assert(!(error instanceof assert.AssertionError));}
  assert.equal((await originalFetch(base+'/readyz')).status,200);
  assert(!JSON.stringify(logs).includes(marker),'Stream failure logs exposed upstream details');
  process.env.ELEVENLABS_API_KEY='';
  const fallback=await originalFetch(base+'/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Hello'})});
  assert.equal((await fallback.json() as {enabled:boolean}).enabled,false);
  console.log('PASS audio bytes, unconfigured fallback and recovery after an interrupted audio stream');
}finally{
  globalThis.fetch=originalFetch;console.error=originalError;
  await new Promise<void>((resolve,reject)=>appServer.close(error=>error?reject(error):resolve()));
  db.close();
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
  assert(path.basename(directory).startsWith('shiftweave-tts-'));rmSync(directory,{recursive:true,force:true});
}
