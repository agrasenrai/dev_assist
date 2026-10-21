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
  NODE_ENV: 'test', STAFF_AUTH_REQUIRED: 'false', LLM_PROVIDER: 'mock', DEMO_USER: '', DEMO_PASSWORD: '',
  MCP_AUTH_TOKEN: '', PUBLIC_ORIGIN: '', SHIFTWEAVE_TEST: '1' });
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
  const page = await browser.newPage();
  page.on('pageerror', (error: Error) => console.error('Browser error:', error.message));
  page.on('console', (message: any) => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  page.on('requestfailed', (request: any) => console.error('Browser request failed:', request.url(), request.failure()?.errorText));
  page.on('response', (response: any) => { if(response.status() >= 400) console.error('Browser HTTP error:', response.status(),response.url()); });
  await page.addInitScript('globalThis.__name = (target) => target');
  await page.addInitScript(() => {
    const w = window as any;
    w.spoken = []; w.recognitionStarts = 0; w.probeStopped = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value:async () => {
      if(w.denyMicrophone) throw new DOMException('Blocked by test','NotAllowedError');
      return {getTracks:() => [{stop:() => {w.probeStopped++;}}]};
    }});
    class Recognition {
      onstart: any; onresult: any; onend: any; onerror: any;
      start() { w.recognition = this; w.recognitionStarts++; this.onstart?.(); }
      abort() { this.onend?.(); }
    }
    w.SpeechRecognition = Recognition;
    w.SpeechSynthesisUtterance = class { constructor(public text: string) {} };
    Object.defineProperty(window, 'speechSynthesis', { value: {
      speak(utterance: any) {
        w.spoken.push(utterance.text);
        setTimeout(() => w.failSpeech ? utterance.onerror?.() : utterance.onend?.(), 10);
      },
      cancel() {}
    } });
    w.say = (text: string, isFinal = true) => {
      const result: any = [{transcript:text}]; result.isFinal = isFinal;
      w.recognition.onresult({results:[result],resultIndex:0});
    };
  });
  await page.goto(base);
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
  assert.equal(await page.getByRole('textbox',{name:'Type to Alexa+'}).inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Start microphone',exact:true}).evaluate((button:HTMLElement)=>Boolean(button.closest('#st'))),false);
  await page.evaluate(()=>{(window as any).denyMicrophone=true;});
  await page.getByRole('button', {name:'Start microphone', exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Microphone permission is blocked'}).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).recognitionStarts),0);
  await page.evaluate(()=>{(window as any).denyMicrophone=false;});
  await page.getByRole('button', {name:'Start microphone', exact:true}).click();
  await page.waitForFunction(()=>(window as any).recognitionStarts===1);
  assert.equal(await page.evaluate(()=>(window as any).probeStopped),1);
  let voiceRequests=0;
  page.on('request',(request:any)=>{if(request.url()===base+'/api/voice' && request.method()==='POST')voiceRequests++;});
  await page.evaluate(()=>(window as any).say('Seema',false));
  await page.getByRole('log',{name:'Your transcript'}).filter({hasText:'Seema'}).waitFor();
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
    console.log(`PASS transcript → HTTP/MCP → stored data → speech → listening: ${text}`);
  };
  await say('Seema', /assigned tasks/);
  await say('What tasks are assigned to me?', /Recorded local workflow status/);
  await say('What tasks are pending?', /pending|PENDING/);
  const task = db.prepare(`SELECT t.*,p.full_name FROM tasks t JOIN patients p ON p.id=t.patient_id
    WHERE NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.task_id=t.id AND c.status='UNRESOLVED') LIMIT 1`).get() as any;
  await say(`Show the latest information about patient ${task.full_name}`, new RegExp(task.full_name));
  await say(`Explain task ${task.id}`, /Recorded local workflow status/);
  await say('Set this task to completed', /Say “confirm”/);
  await say('Confirm', /saved as COMPLETED/);
  await say('Has this task been completed?', /COMPLETED/);
  assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id) as any).status,'COMPLETED');
  await say('Show patient Missing Person', /could not identify one patient/);
  await say('Assign this task to the appropriate person', /cannot choose an assignee/);
  await page.route('**/api/voice', (route: any) => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test backend unavailable'})}));
  await say('Show my tasks', /could not complete.*backend unavailable/i);
  await page.unroute('**/api/voice');
  await say('Retry last request', /Recorded local workflow status/);
  const starts = await page.evaluate(() => (window as any).recognitionStarts);
  await page.evaluate(() => (window as any).recognition.onerror({error:'no-speech'}));
  await page.evaluate(() => (window as any).recognition.onend());
  await page.waitForFunction((starts: number) => (window as any).recognitionStarts > starts, starts);
  await say('What tasks are completed?', /COMPLETED/);
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
  assert.equal(await page.locator('#ast').innerText(),'Ready for your question.');
  assert.equal(await page.getByRole('log',{name:'Your transcript'}).innerText(),'');
  assert.equal(await page.getByRole('textbox',{name:'Type to Alexa+'}).inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Start microphone',exact:true}).getAttribute('aria-pressed'),'false');
  assert.equal(await page.getByRole('group',{name:'Shift thread timeline from saved workflow state'}).count(),0);
  assert.equal(await page.evaluate((session:string)=>localStorage.getItem(`shiftweave:voice:pending:${session}`),oldSession),retainedRequest);
  const previous = await fetch(base + `/api/voice/${oldSession}`).then(response => response.json());
  assert.equal(previous.nurse.id,'nurse_seema_01');
  assert.equal((db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id)as any).status,'COMPLETED');
  console.log('PASS reopening starts blank without deleting prior recovery state or committed task updates');
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  await say('Seema', /assigned tasks/);
  await page.evaluate(() => (window as any).recognition.onerror({error:'not-allowed'}));
  await page.getByRole('alert').filter({hasText:'Microphone permission is blocked'}).waitFor();
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  await page.waitForFunction(()=>(window as any).recognitionStarts>0 && (window as any).recognition);
  await say('Show my tasks', /Recorded local workflow status/);
  await page.evaluate(() => { (window as any).failSpeech = true; });
  await say('Show my tasks', /Recorded local workflow status/);
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
  await say('What tasks are completed?', /COMPLETED/);
} finally {
  await browser?.close();
  await new Promise<void>(resolve => appServer.close(() => resolve()));
  db.close();
  // The target is the exact temporary directory created above, never the configured data directory.
  rmSync(directory, { recursive:true, force:true });
}
