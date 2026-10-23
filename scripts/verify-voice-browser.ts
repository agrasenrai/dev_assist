import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Real browser + HTTP + MCP + isolated existing fixture. Browser speech adapters are simulated;
// this verifies wiring and recovery, not microphone acoustics or a remote recognition service.
const directory = mkdtempSync(path.join(tmpdir(), 'shiftweave-voice-browser-'));
Object.assign(process.env, { SQLITE_DB_PATH: path.join(directory, 'test.db'), PORT: '0', HOST: '127.0.0.1',
  HOSPITAL_SIMULATION_ENABLED:'false', NODE_ENV: 'test', STAFF_AUTH_REQUIRED: 'false', LLM_PROVIDER: 'mock',
  MCP_AUTH_TOKEN: '', PUBLIC_ORIGIN: '', SHIFTWEAVE_TEST: '1',ELEVENLABS_API_KEY:'',SIMULATION_MODE:'false' });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { appServer } = await import('../src/server.js');
const { db } = await import('../src/db/connection.js');
const { importIncomingData } = await import('../src/db/ingest.js');
const { allowedOrigins } = await import('../src/runtime-config.js');
let browser: any;
try {
  importIncomingData();
  if (!appServer.listening) await once(appServer, 'listening');
  const address = appServer.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  allowedOrigins.add(base); // The test server's random loopback port, never a wildcard.
  browser = await chromium.launch({ channel: process.env.VOICE_TEST_BROWSER || 'msedge', headless: true });
  console.log('Browser launched');
  const page = await browser.newPage();
  let cloudMode=false;
  await page.route('**/api/tts/config',(route:any)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:cloudMode})}));
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error: Error) => console.error('Browser error:', error.message));
  page.on('console', (message: any) => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  page.on('requestfailed', (request: any) => console.error('Browser request failed:', request.url(), request.failure()?.errorText));
  page.on('response', (response: any) => { if(response.status() >= 400) console.error('Browser HTTP error:', response.status(),response.url()); });
  await page.addInitScript('globalThis.__name = (target) => target');
  await page.addInitScript(() => {
    const w = window as any;
    w.spoken = []; w.recognitionStarts = 0; w.probeStopped = 0;w.speechCancellations=0;w.cloudPlays=0;w.cloudPauses=0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value:async (constraints:any) => {
      w.captureConstraints=constraints;
      if(w.denyMicrophone) throw new DOMException('Blocked by test','NotAllowedError');
      return {getTracks:() => [{stop:() => {w.probeStopped++;}}]};
    }});
    class Recognition {
      onstart: any; onresult: any; onend: any; onerror: any;
      results: any[] = [];
      start() { w.recognition = this; w.recognitionStarts++; this.onstart?.(); }
      abort() { this.onend?.(); }
    }
    w.SpeechRecognition = Recognition;
    w.SpeechSynthesisUtterance = class { constructor(public text: string) {} };
    Object.defineProperty(window, 'speechSynthesis', { value: {
      speak(utterance: any) {
        w.spoken.push(utterance.text);
        w.currentUtterance=utterance;
        if(!w.holdSpeech)setTimeout(() => w.failSpeech ? utterance.onerror?.() : utterance.onend?.(), 10);
      },
      cancel() {w.speechCancellations++;}
    } });
    w.Audio=class {
      onplay:any;onended:any;onerror:any;
      constructor(public src:string){w.cloudAudio=this;}
      play(){w.cloudPlays++;if(w.hangCloud)return new Promise(()=>{});this.onplay?.();return Promise.resolve();}
      pause(){w.cloudPauses++;}removeAttribute(){}load(){}
    };
    w.say = (text: string, isFinal = true) => {
      const result: any = [{transcript:text}]; result.isFinal = isFinal;
      const results = w.recognition.results;
      if(results.length && !results.at(-1).isFinal) results[results.length-1]=result;
      else results.push(result);
      w.recognition.onspeechstart?.();
      w.recognition.onresult({results,resultIndex:results.length-1});
    };
  });
  await page.goto(base,{timeout:15000});
  console.log('Browser loaded:', await page.title());
  await page.getByRole('button', {name:'Start microphone', exact:true}).waitFor();
  const microphone = await page.getByRole('button',{name:'Start microphone',exact:true}).boundingBox();
  const viewport = page.viewportSize();
  assert(microphone && viewport);
  assert(Math.abs(microphone.x + microphone.width / 2 - viewport.width / 2) < 2);
  assert(microphone.y > viewport.height * .7);
  assert.equal(await page.locator('.ops-app').count(),0);
  if(process.env.VOICE_TEST_SCREENSHOT) await page.screenshot({path:process.env.VOICE_TEST_SCREENSHOT});
  console.log('PASS default voice workspace and lower-center microphone placement');
  assert.equal(await page.locator('#chip').count(),0);
  assert.equal(await page.getByRole('button',{name:/Say:/}).count(),0);
  assert.equal(await page.locator('#in').inputValue(),'');
  assert.equal(await page.locator('#in').isVisible(),false);
  await page.getByRole('button',{name:'Show keyboard',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Type to Medi'}).isVisible(),true);
  await page.getByRole('button',{name:'Hide keyboard',exact:true}).click();
  assert.equal(await page.locator('#in').isVisible(),false);
  assert.equal(await page.getByRole('button',{name:'Start microphone',exact:true}).evaluate((button:HTMLElement)=>Boolean(button.closest('#st'))),false);
  await page.evaluate(()=>{(window as any).denyMicrophone=true;});
  await page.getByRole('button', {name:'Start microphone', exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Microphone permission is blocked'}).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).recognitionStarts),0);
  await page.evaluate(()=>{(window as any).denyMicrophone=false;});
  await page.getByRole('button', {name:'Start microphone', exact:true}).click();
  await page.waitForFunction(()=>(window as any).recognitionStarts===1);
  assert.equal(await page.evaluate(()=>(window as any).probeStopped),0,'The echo-cancelled capture track stays alive until pause');
  assert.equal(await page.evaluate(()=>(window as any).captureConstraints.audio.echoCancellation),true);
  let voiceRequests=0;
  page.on('request',(request:any)=>{if(request.url()===base+'/api/voice' && request.method()==='POST')voiceRequests++;});
  await page.evaluate(()=>(window as any).say('Seema',false));
  await page.getByRole('log',{name:'Your transcript'}).filter({hasText:'Seema'}).waitFor();
  assert.equal(await page.locator('.voice-microphone').getAttribute('data-activity'),'hearing');
  assert.equal(await page.locator('.voice-band').first().evaluate((el:Element)=>getComputedStyle(el).animationName),'assistant-wave');
  assert.equal(voiceRequests,0,'Interim speech must be displayed without executing a request');
  assert.equal(await page.evaluate(()=>(window as any).recognition.interimResults),true);
  console.log('PASS external microphone button, permission recovery, live transcription, and no suggested phrases');
  const say = async (text: string, expected: RegExp) => {
    const count = await page.evaluate(() => (window as any).spoken.length);
    const starts = await page.evaluate(() => (window as any).recognitionStarts);
    await page.evaluate((text: string) => (window as any).say(text), text);
    await page.waitForFunction((count: number) => (window as any).spoken.length > count, count);
    const speech = await page.evaluate(() => (window as any).spoken.at(-1));
    assert.match(speech, expected);
    await page.waitForFunction((starts: number) => (window as any).recognitionStarts > starts, starts);
    if(!await page.evaluate(()=>(window as any).holdSpeech))await page.waitForFunction(()=>document.querySelector('#st')?.getAttribute('data-m')==='listening');
    console.log(`PASS transcript → HTTP/MCP → stored data → speech → listening: ${text}`);
  };
  await say('Medi', /Medi.*listening/);
  await say('Hii', /Hey.*here/);
  await say('Medi, what is your name?', /Medi.*nursing workflow assistant/);
  await say('Seema', /Hi Seema/);
  const beforePauseRequests = voiceRequests;
  const beforePauseSpeech = await page.evaluate(() => (window as any).spoken.length);
  await page.evaluate(() => (window as any).say('Medi, what tasks'));
  await page.waitForTimeout(1100);
  assert.equal(voiceRequests,beforePauseRequests,'A one-second pause must not submit an unfinished sentence');
  assert.equal(await page.evaluate(() => (window as any).spoken.length),beforePauseSpeech);
  const previousStarts = await page.evaluate(() => (window as any).recognitionStarts);
  await page.evaluate(() => (window as any).recognition.onend());
  await page.waitForFunction((count:number)=>(window as any).recognitionStarts>count,previousStarts);
  await page.evaluate(() => (window as any).say('are pending?'));
  await page.waitForFunction((count:number)=>(window as any).spoken.length>count,beforePauseSpeech);
  const joinedRequest = (db.prepare('SELECT request_json FROM operation_receipts WHERE operation=? ORDER BY rowid DESC LIMIT 1').get('VOICE_TURN')as any);
  assert.equal(JSON.parse(joinedRequest.request_json).utterance,'Medi, what tasks are pending?');
  assert.equal(voiceRequests,beforePauseRequests+1);
  await page.waitForFunction((count:number)=>(window as any).recognitionStarts>count,previousStarts+1);
  console.log('PASS short pauses and browser recognition restarts preserve one complete sentence without early execution');
  await say('What tasks are assigned to me?', /is (?:completed|in progress|pending|waiting for a discrepancy review)/);
  await say('What tasks are pending?', /pending|PENDING/);
  const task = db.prepare(`SELECT t.*,p.full_name FROM tasks t JOIN patients p ON p.id=t.patient_id
    WHERE NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.task_id=t.id AND c.status='UNRESOLVED') LIMIT 1`).get() as any;
  await say(`Show the latest information about patient ${task.full_name}`, new RegExp(task.full_name));
  await say(`Explain task ${task.id}`, /is (?:completed|in progress|pending|waiting for a discrepancy review)/);
  await say('Set this task to completed', /Say “confirm”/);
  await say('Confirm', /now completed/);
  await say('Has this task been completed?', /completed/);
  assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id) as any).status,'COMPLETED');
  await say('Show patient Missing Person', /Which patient do you mean/);
  await say('Assign this task to the appropriate person', /cannot choose an assignee/);
  await page.route('**/api/voice', (route: any) => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test backend unavailable'})}));
  await say('Show my tasks', /could not complete.*backend unavailable/i);
  await page.unroute('**/api/voice');
  await say('Retry last request', /is (?:completed|in progress|pending|waiting for a discrepancy review)/);
  const starts = await page.evaluate(() => (window as any).recognitionStarts);
  await page.evaluate(() => (window as any).recognition.onerror({error:'no-speech'}));
  await page.evaluate(() => (window as any).recognition.onend());
  await page.waitForFunction((starts: number) => (window as any).recognitionStarts > starts, starts);
  await say('What tasks are completed?', /completed/);
  await page.evaluate(()=>{(window as any).holdSpeech=true;});
  await say('Show my tasks',/assigned task/);
  await page.getByRole('button',{name:'Interrupt and listen',exact:true}).waitFor();
  const beforeBarge=voiceRequests;
  const beforeCancel=await page.evaluate(()=>(window as any).speechCancellations);
  await page.evaluate(()=>(window as any).say((window as any).spoken.at(-1)));
  await page.waitForTimeout(200);
  assert.equal(voiceRequests,beforeBarge,'Assistant echo must not create another turn');
  assert.equal(await page.evaluate(()=>(window as any).speechCancellations),beforeCancel,'Assistant echo must not interrupt itself');
  await page.evaluate(()=>(window as any).say('What tasks are pending',false));
  await page.waitForFunction((n:number)=>(window as any).speechCancellations>n,beforeCancel);
  assert.equal(voiceRequests,beforeBarge,'An interim interruption must not execute a task request');
  await page.evaluate(()=>{(window as any).holdSpeech=false;});
  await say('What tasks are pending?',/pending/);
  await page.waitForTimeout(100);
  assert.equal(voiceRequests,beforeBarge+1);
  await page.evaluate(()=>{(window as any).holdSpeech=true;});
  await say('Show my tasks',/assigned task/);
  const beforeStopSpeech=voiceRequests;
  await page.evaluate(()=>(window as any).say('Stop'));
  await page.getByRole('button',{name:'Stop microphone',exact:true}).waitFor();
  await page.waitForTimeout(1600);assert.equal(voiceRequests,beforeStopSpeech,'Stop during playback is local, not a backend mutation');
  await page.evaluate(()=>{(window as any).holdSpeech=false;});
  console.log('PASS browser barge-in, live capture during speech, echo rejection, interim safety and local stop');
  const beforeStoppedDraft = voiceRequests;
  await page.evaluate(() => (window as any).say('Set this task to pending'));
  await page.getByRole('button',{name:'Stop microphone',exact:true}).click();
  await page.waitForTimeout(2800);
  assert.equal(voiceRequests,beforeStoppedDraft,'Stopping must cancel the buffered sentence before it reaches the backend');
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  const oldSession = await page.evaluate(() => localStorage.getItem('shiftweave:voice:display-session'));
  const retainedRequest = JSON.stringify({session_id:oldSession,utterance:'Show my tasks',expected_revision:0,idempotency_key:'saved-uncertain-request'});
  await page.evaluate(({session,request}:{session:string;request:string}) => {
    localStorage.setItem(`shiftweave:voice:pending:${session}`,request);
  },{session:oldSession,request:retainedRequest});
  await page.reload();
  await page.getByRole('button',{name:'Start microphone',exact:true}).waitFor();
  const newSession = await page.evaluate(() => localStorage.getItem('shiftweave:voice:display-session'));
  assert.notEqual(newSession,oldSession);
  const blank = await fetch(base + `/api/voice/${newSession}`).then(response => response.json());
  assert.equal(blank.nurse,null); assert.equal(blank.pending,null); assert.equal(blank.revision,0);
  assert.deepEqual(blank.messages,[]); assert.deepEqual(blank.tasks,[]); assert.deepEqual(blank.handoffs,[]);
  assert.equal(await page.locator('#ast').innerText(),'Your shift, a little clearer.');
  assert.equal(await page.getByRole('log',{name:'Your transcript'}).innerText(),'');
  assert.equal(await page.locator('#in').inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Start microphone',exact:true}).getAttribute('aria-pressed'),'false');
  assert.equal(await page.getByRole('group',{name:'Shift thread timeline from saved workflow state'}).count(),0);
  assert.equal(await page.evaluate((session:string)=>localStorage.getItem(`shiftweave:voice:pending:${session}`),oldSession),retainedRequest);
  const previous = await fetch(base + `/api/voice/${oldSession}`).then(response => response.json());
  assert.equal(previous.nurse.id,'nurse_seema_01');
  assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id)as any).status,'COMPLETED');
  console.log('PASS reopening starts blank without deleting prior recovery state or committed task updates');
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  await say('Seema', /Hi Seema/);
  await page.evaluate(() => (window as any).recognition.onerror({error:'not-allowed'}));
  await page.getByRole('alert').filter({hasText:'Microphone permission is blocked'}).waitFor();
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  await page.waitForFunction(()=>(window as any).recognitionStarts>0 && (window as any).recognition);
  await say('Show my tasks', /is (?:completed|in progress|pending|waiting for a discrepancy review)/);
  await page.evaluate(() => { (window as any).failSpeech = true; });
  await say('Show my tasks', /is (?:completed|in progress|pending|waiting for a discrepancy review)/);
  await page.getByRole('alert').filter({hasText:'Speech playback stopped'}).waitFor();
  await page.evaluate(() => { (window as any).failSpeech = false; });
  let release: () => void = () => {};
  const paused = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/voice', async (route: any) => { await paused; await route.continue(); });
  const count = await page.evaluate(() => (window as any).spoken.length);
  await page.evaluate(() => (window as any).say('Show my tasks'));
  await page.waitForFunction(() => document.querySelector('#st')?.getAttribute('data-m') === 'processing');
  await page.getByRole('button',{name:'Stop microphone',exact:true}).click();
  release();
  await page.waitForFunction(() => document.querySelector('#st')?.getAttribute('data-m') === 'idle');
  assert.equal(await page.evaluate(() => (window as any).spoken.length),count);
  console.log('PASS paused voice session does not play a late backend response');
  await page.unroute('**/api/voice');
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  let releaseQueued:()=>void=()=>{},gatedRequests=0;
  const gate=new Promise<void>(resolve=>{releaseQueued=resolve;});
  await page.route('**/api/voice',async(route:any)=>{if(++gatedRequests===1)await gate;await route.continue();});
  const beforeQueued=voiceRequests,beforeQueuedSpeech=await page.evaluate(()=>(window as any).spoken.length);
  await page.evaluate(()=>(window as any).say('Show my tasks'));
  await page.waitForFunction(()=>document.querySelector('#st')?.getAttribute('data-m')==='processing');
  await page.evaluate(()=>(window as any).say('What tasks are pending?'));
  await page.waitForTimeout(1550);
  assert.equal(voiceRequests,beforeQueued+1,'A follow-up must wait for the first operation to finish');
  releaseQueued();
  await page.waitForFunction((n:number)=>(window as any).spoken.length>n,beforeQueuedSpeech);
  await page.waitForFunction(()=>document.querySelector('#st')?.getAttribute('data-m')==='listening');
  assert.equal(voiceRequests,beforeQueued+2);assert.equal(await page.evaluate(()=>(window as any).spoken.length),beforeQueuedSpeech+1);
  assert.match(await page.evaluate(()=>(window as any).spoken.at(-1)),/pending/);
  await page.unroute('**/api/voice');
  console.log('PASS speech during processing queues one follow-up and suppresses the superseded spoken answer');
  await say('What tasks are completed?', /completed/);
  const {BedrockLLMProvider}=await import('../src/agent/llm-provider.js');
  const originalDecision=BedrockLLMProvider.prototype.decideNextStep;
  process.env.LLM_PROVIDER='bedrock';
  let semanticCalls=0;
  BedrockLLMProvider.prototype.decideNextStep=async(messages,tools,context)=>{
    semanticCalls++;assert.equal(context?.voiceWorkflow,true);assert(tools.some(t=>t.name==='read_voice_context'));
    assert(!messages.some(m=>m.toolName==='read_voice_context'),'Model must select an intent before clinical context is loaded');
    return{toolCall:{toolName:'interpret_voice_request',arguments:{intent:'TASKS',status:'ALL',render_backend:true,introduction:"Here's what I found."}}};
  };
  try{
    await say('Give me a picture of where things stand',/Here's what I found.*assigned task/);
    assert.equal(semanticCalls,1);console.log('PASS simulated speech → one semantic model call → scoped MCP → grounded backend answer → playback → listening');
  }finally{BedrockLLMProvider.prototype.decideNextStep=originalDecision;process.env.LLM_PROVIDER='mock';}
  cloudMode=true;await page.reload();
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  await page.waitForFunction(()=>(window as any).recognitionStarts>0);
  await page.evaluate(()=>(window as any).say('Medi'));
  await page.waitForFunction(()=>(window as any).cloudPlays>0);
  const cloudRequests=voiceRequests;
  await page.evaluate(()=>{const w=window as any;w.delayedCloudError=w.cloudAudio.onerror;});
  await page.getByRole('button',{name:'Interrupt and listen',exact:true}).click();
  assert((await page.evaluate(()=>(window as any).cloudPauses))>0);
  await page.evaluate(()=>(window as any).delayedCloudError?.());
  assert.equal(await page.evaluate(()=>(window as any).spoken.length),0,'A cancelled cloud stream must not start a late browser fallback');
  assert.equal(voiceRequests,cloudRequests);
  await page.evaluate(()=>{(window as any).hangCloud=true;});
  await page.evaluate(()=>(window as any).say('Medi'));
  await page.waitForFunction(()=>(window as any).spoken.length===1);
  assert.match(await page.evaluate(()=>(window as any).spoken[0]),/Medi.*listening/);
  console.log('PASS immediate manual cloud-audio interruption, stale-event suppression and bounded browser fallback');
} finally {
  await browser?.close();
  appServer.closeAllConnections();
  await new Promise<void>(resolve => appServer.close(() => resolve()));
  db.close();
  // The target is the exact temporary directory created above, never the configured data directory.
  rmSync(directory, { recursive:true, force:true });
}
