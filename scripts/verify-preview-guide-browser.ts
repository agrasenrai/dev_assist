import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import Database from 'better-sqlite3';

const directory=mkdtempSync(path.join(tmpdir(),'shiftweave-guide-'));
Object.assign(process.env,{SQLITE_DB_PATH:path.join(directory,'test.db'),PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',SHIFTWEAVE_TEST:'1',
  STAFF_AUTH_REQUIRED:'false',SIMULATION_MODE:'false',HOSPITAL_SIMULATION_ENABLED:'true',HOSPITAL_DATA_SOURCE:'sqlite',
  EPIC_READS_ENABLED:'false',EPIC_WRITES_ENABLED:'false',LLM_PROVIDER:'mock',MCP_AUTH_TOKEN:'',PUBLIC_ORIGIN:'',ELEVENLABS_API_KEY:''});
new Database(process.env.SQLITE_DB_PATH!).close();
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
let app:import('node:http').Server|undefined,db:Database.Database|undefined,browser:any;
try{
  const child=spawn(process.execPath,['--import','tsx','scripts/setup-hospital.ts'],{env:process.env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const [code]=await once(child,'close');assert.equal(code,0,output);
  app=(await import('../src/server.js')).appServer;db=(await import('../src/db/connection.js')).db;
  if(!app.listening)await once(app,'listening');const address=app.address();assert(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  (await import('../src/runtime-config.js')).allowedOrigins.add(base);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1536,height:864}});
  let requests=0;page.on('request',(r:any)=>{if(r.method()==='POST'&&r.url().endsWith('/api/voice'))requests++;});
  await page.goto(base);await page.getByRole('complementary',{name:'What you can ask'}).waitFor();
  const example=page.getByRole('button',{name:'My name is Seema Patel. What are my tasks?',exact:true});
  await example.click();assert.equal(await page.locator('#in').inputValue(),'My name is Seema Patel. What are my tasks?');
  assert.equal(requests,0,'Choosing an example must not send a voice request');
  const transcriptSize=await page.locator('#usr').evaluate((el:Element)=>getComputedStyle(el).fontSize);
  assert.equal(transcriptSize,'30px');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#cnt')?.textContent?.includes('unfinished'));
  await page.getByRole('button',{name:'Tell me about patient Rowan Morgan',exact:true}).waitFor();
  const guide=await page.locator('#preview-guide').boundingBox(),transcript=await page.locator('#usr').boundingBox();
  assert(guide&&transcript);assert(guide.y+guide.height<transcript.y,'Guide must not overlap the transcript');
  mkdirSync('.sandbox',{recursive:true});await page.screenshot({path:'.sandbox/preview-guide-desktop.png'});
  await page.setViewportSize({width:1280,height:720});await page.screenshot({path:'.sandbox/preview-guide-laptop.png'});
  assert.equal(await page.locator('.ops-app').count(),0);
  console.log('PASS preview guide uses returned nurses/patients, examples only populate input, transcript is enlarged, desktop guide does not overlap transcript; screenshots captured at 1536x864 and 1280x720.');
}finally{
  await browser?.close();if(app?.listening){app.closeAllConnections();await new Promise<void>(resolve=>app!.close(()=>resolve()));}db?.close();
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('shiftweave-guide-'));rmSync(directory,{recursive:true,force:true});
}
