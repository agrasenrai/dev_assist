import {useEffect,useRef,useState} from 'react';
import {useVoiceConversation} from '../useVoiceConversation.js';
import '../simulation.css';
type Step={title:string;input:string;processing:string;expected:string;kind:string};
type Run={id:string;cursor:number;scenario:{title:string;description:string;steps:Step[]};records:Array<{id:string;title:string;status:string;patient:string;allergies:string|null}>;results:Array<{step:number;outcome:string;output:any}>;last?:{outcome:string;output:any}};
export function SimulationWorkspace(){
 const [catalog,setCatalog]=useState<{id:string;title:string;description:string}[]>([]),[mode,setMode]=useState('');
 const [run,setRun]=useState<Run|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[question,setQuestion]=useState('');
 const pending=useRef<Record<string,unknown>|null>(null),locked=useRef(false);
 async function request(body:Record<string,unknown>){const r=await fetch('/api/simulations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(125000)});const result=await r.json();if(!r.ok)throw new Error(result.error||`HTTP ${r.status}`);return result;}
 async function perform(body:Record<string,unknown>,retry=false){
  if(locked.current)return '';locked.current=true;setBusy(true);setError('');
  const input=retry&&pending.current?pending.current:{...body,idempotency_key:crypto.randomUUID()};pending.current=input;localStorage.setItem("shiftweave:review-pending",JSON.stringify(input));
  try {const result=await request(input);setRun(result);localStorage.setItem('shiftweave:review-run',result.id);pending.current=null;localStorage.removeItem("shiftweave:review-pending");return result.last?.output?.speech||result.last?.output?.message||'Step finished. Review the result on screen.';}
  catch(e){const message=e instanceof Error?e.message:String(e);setError(message);return `The request failed. ${message}`;}
  finally{locked.current=false;setBusy(false);}
 }
 const voice=useVoiceConversation(text=>run?perform({action:'ask',run_id:run.id,utterance:text}):Promise.resolve('Choose a simulation first.'));
 useEffect(()=>{void request({action:'list'}).then(c=>{setCatalog(c.scenarios);setMode(c.mode);}).catch(e=>setError(e.message));
  try{const retry=localStorage.getItem('shiftweave:review-pending');if(retry){pending.current=JSON.parse(retry);setError('A previous request may have been interrupted. Retry the same request to reconcile its saved result.');}}catch{localStorage.removeItem('shiftweave:review-pending');} const saved=localStorage.getItem('shiftweave:review-run');if(saved)void request({action:'read',run_id:saved}).then(setRun).catch(()=>localStorage.removeItem('shiftweave:review-run'));
 },[]);
 const step=run?.scenario.steps[run.cursor];
 return <main className="simulation"><header><h1>Explore ShiftWeave</h1><p>Guided scenarios use clearly labeled synthetic records in the configured application database. The selected source is labeled explicitly; synthetic FHIR records and workflow updates are separate from Epic.</p><p>Voice interpretation: <strong>{mode==='mock'?'Local deterministic mode — use the suggested wording':mode}</strong>. Recovery scenario uses the deterministic orchestrator.</p><a href="/?workspace=voice">Open the voice workspace</a></header>
 <section aria-label="Choose simulation" className="scenario-grid">{catalog.map(s=><button key={s.id} disabled={busy||voice.enabled} onClick={()=>void perform({action:'start',scenario_id:s.id})}><strong>{s.title}</strong><span>{s.description}</span></button>)}</section>
 {error&&<div role="alert"><p>{error}</p>{pending.current&&<button disabled={busy} onClick={()=>void perform({},true)}>Retry the same request</button>}</div>}
 {run&&<><h2>{run.scenario.title}</h2><p>{run.scenario.description}</p><p>Saved progress: {run.cursor} / {run.scenario.steps.length}. Scenario records share the application database; starting another scenario does not reset them.</p>
 {step?<section className="simulation-step"><h3>{run.cursor+1}. {step.title}</h3><dl><dt>Input</dt><dd>{step.input}</dd><dt>Processing</dt><dd>{step.processing}</dd><dt>Expected outcome (not a test result)</dt><dd>{step.expected}</dd></dl><button disabled={busy||voice.enabled} onClick={()=>void perform({action:'step',run_id:run.id,expected_cursor:run.cursor})}>{busy?'Processing…':step.input.toLowerCase()==='confirm'?'Confirm the proposed update':'Run this step'}</button></section>:<p>All guided steps executed. Inspect their actual results below or ask a follow-up.</p>}
 <form onSubmit={e=>{e.preventDefault();if(question.trim()){void perform({action:'ask',run_id:run.id,utterance:question});setQuestion('');}}}><label htmlFor="review-question">Ask a follow-up</label><input id="review-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={2000}/><button disabled={busy||!question.trim()||voice.enabled}>Ask</button><button type="button" disabled={busy||!voice.supported} onClick={voice.enabled?voice.stop:voice.start}>{voice.enabled?'Pause microphone':'Use microphone'}</button><p role="status">{busy?'Processing request…':voice.status} {voice.transcript}</p>{voice.error&&<p role="alert">{voice.error}</p>}</form>
 {run.last&&<section aria-label="Latest response"><h3>Latest result: {run.last.outcome}</h3><p>{run.last.output?.speech||run.last.output?.error||run.last.output?.message}</p><details><summary>Actual response and checkpoint evidence</summary><pre>{JSON.stringify(run.last.output,null,2)}</pre></details></section>}
 <section><h3>Current database records</h3><table><thead><tr><th>Patient</th><th>Coordination task</th><th>Status</th><th>Recorded allergies</th></tr></thead><tbody>{run.records.map(r=><tr key={r.id}><td>{r.patient}</td><td>{r.title}</td><td>{r.status}</td><td>{r.allergies||'Unavailable'}</td></tr>)}</tbody></table><button disabled={busy} onClick={()=>void request({action:'read',run_id:run.id}).then(setRun).catch(e=>setError(e.message))}>Refresh stored records</button></section>
 <section><h3>Saved step results</h3>{run.results.map(r=><details key={r.step}><summary>{r.step+1}. {run.scenario.steps[r.step]?.title} — {r.outcome}</summary><pre>{JSON.stringify(r.output,null,2)}</pre></details>)}</section></>}
 </main>;
}
