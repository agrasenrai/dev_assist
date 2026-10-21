import { useCallback, useEffect, useRef, useState } from 'react';
import { readVoiceDisplay, sendVoiceTurn, pendingVoiceRequest } from '../voice-api.js';
import { fetchExecutionTrace } from '../api.js';
import { useVoiceConversation } from '../useVoiceConversation.js';
import type { VoiceDisplay, VoiceTask } from '../voice-types.js';
import type { AuditLogItem } from '../types.js';
import { EpicNoteReview } from './EpicNoteReview.js';
import { ChaosControlBar } from './ChaosControlBar.js';
import '../one-thread.css';

type Drawer = 'records' | 'tasks' | 'handoffs' | 'history' | 'recovery' | null;
const short = (text: string, length = 34) => text.length > length ? text.slice(0, length - 1) + '…' : text;

function Thread({ display, onTask, onHandoff }: { display: VoiceDisplay | null; onTask: (task: VoiceTask) => void; onHandoff: () => void }) {
  const handoff = display?.handoffs.find(h => h.id === display.selectedHandoffId) || (display?.handoffs.length === 1 ? display.handoffs[0] : undefined);
  const tasks = [...(display?.tasks || []), ...(display?.candidates || [])].filter((t, i, all) => all.findIndex(x => x.id === t.id) === i);
  const finalized = handoff?.status === 'FINALIZED';
  const path = 'M700 330C1000 350 1400 310 1860 330';
  const incoming = handoff?.incomingName === display?.nurse?.name;
  const accepted = Boolean(handoff && incoming && display?.tasks.length && !display.candidates.length);
  const knot = display?.focus === 'conflicts' && display.conflicts.length > 0;
  const label = (x: number, y: number, a: string, b: string, color?: string) => <><text x={x} y={y} className="lb" fill={color} textAnchor="middle">{short(a)}</text><text x={x} y={y + 26} className="sb" textAnchor="middle">{short(b, 48)}</text></>;
  return <svg viewBox={knot ? '320 0 1280 470' : '0 0 1920 470'} role="group" aria-label="Shift thread timeline from saved workflow state">
    <path d="M60 170C500 150 800 190 1180 170" className="th" stroke="var(--nt)" opacity={display?.nurse ? 1 : .25} />
    <text x="60" y="100" className="lb">{handoff?.outgoingName || display?.nurse?.name || 'Your shift'}{display?.shift ? ` · ${display.shift.type.toLowerCase()}` : ''}</text>
    <line x1="960" y1="36" x2="960" y2="385" className={`gt ${display?.conflicts.length ? 'bk' : ''}`} />
    <text x="976" y="60" className="lb">{display?.conflicts.length ? 'Human review required' : 'Handover'}</text>
    <path d={path} className="th" stroke="var(--dy)" opacity=".45" strokeDasharray="1 24" />
    <text x="680" y="342" className="lb" textAnchor="end">{handoff?.incomingName || 'Incoming nurse'}{accepted ? ' · custody accepted' : ''}</text>
    {handoff && <path d={path} className="th dw" stroke="var(--dy)" pathLength="100" strokeDasharray={`${finalized ? 100 : accepted ? 65 : 30} 200`} />}
    {!tasks.length && label(400, 232, display?.nurse ? 'No assigned tasks returned' : 'Introduce yourself to begin', 'Records appear after your saved session loads')}
    {tasks.slice(0, 3).map((t, i) => {
      const x = [210, 620, 960][i]!;
      const conflict = display?.conflicts.find(c => c.taskId === t.id);
      const color = conflict ? 'var(--ro)' : t.status === 'COMPLETED' ? 'var(--ok)' : 'var(--nt)';
      return <g key={t.id} role="button" tabIndex={0} aria-label={`Inspect ${t.patientName}: ${t.title}`} onClick={() => onTask(t)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTask(t); } }} className="thread-target">
        <title>{t.patientName} · {t.title} · {t.status}</title>
        <rect x={x - 160} y="108" width="320" height="175" fill="transparent" />
        {conflict ? <>
          <path d={`M${x - 100} 170C${x - 40} 100 ${x + 40} 240 ${x + 100} 170`} className="th2" stroke="var(--nt)" />
          <path d={`M${x - 100} 170C${x - 40} 240 ${x + 40} 100 ${x + 100} 170`} className="th2" stroke="var(--ro)" />
          <circle cx={x} cy="170" r="56" fill="none" stroke="var(--ro)" strokeWidth="3" strokeDasharray="3 9" className="pl" />
        </> : <><circle cx={x} cy="170" r="22" fill="var(--bg)" stroke={color} strokeWidth="4" strokeDasharray={t.status === 'COMPLETED' ? undefined : '6 6'} />
          {t.status === 'COMPLETED' && <path d={`M${x - 9} 171l7 7 13-15`} stroke={color} strokeWidth="4.5" fill="none" />}</>}
        {label(x, conflict ? 258 : 222, t.patientName, conflict ? 'Records disagree · human review needed' : t.status.replaceAll('_', ' '))}
      </g>;
    })}
    {tasks.length > 3 && <text x="1190" y="225" className="sb">+{tasks.length - 3} more in task records</text>}
    {accepted && <g><circle cx="1300" cy="330" r="22" fill="var(--bg)" stroke="var(--dy)" strokeWidth="5" />{label(1300, 262, 'Local custody', 'Accepted by incoming nurse')}</g>}
    {finalized && <><path d="M1180 170C1400 170 1500 250 1660 260" className="th dw" stroke="var(--nt)" /><path d="M1500 322C1560 310 1600 280 1660 264" className="th" stroke="var(--dy)" />
      <g role="button" tabIndex={0} aria-label="Review finalized handoff" onClick={onHandoff} onKeyDown={e => { if (e.key === 'Enter') onHandoff(); }}><circle cx="1710" cy="262" r="48" fill="var(--bg)" stroke="var(--ok)" strokeWidth="6" /><path d="M1688 264l15 15 29-34" stroke="var(--ok)" strokeWidth="6" fill="none" /></g><text x="1710" y="186" className="lb ok" textAnchor="middle">Finalized locally</text></>}
    <line x1="60" y1="400" x2="1860" y2="400" stroke="#ffffff1c" />
    {[[Boolean(display?.nurse), 210, 'context'], [Boolean(handoff), 1040, 'draft'], [accepted, 1300, 'custody'], [finalized, 1620, 'signed off']].map(([done, x, text]) => done ? <g key={String(text)}><path d={`M${x} 380l10 10-10 10-10-10z`} fill="var(--ok)" /><text x={Number(x)} y="432" className="sb" textAnchor="middle">{text}</text></g> : null)}
  </svg>;
}

export function OneThreadWorkspace() {
  const [display, setDisplay] = useState<VoiceDisplay | null>(null);
  const [error, setError] = useState(''); const [traceError, setTraceError] = useState('');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [lastHeard, setLastHeard] = useState(''); const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false); const inputRef = useRef<HTMLInputElement>(null);
  const [tools, setTools] = useState(false); const [trace, setTrace] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null); const [note, setNote] = useState('');
  const [mute, setMute] = useState(false); const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const refreshTrace = useCallback(async () => { try { setLogs(await fetchExecutionTrace()); setTraceError(''); } catch (e) { setTraceError(String(e)); } }, []);
  const refresh = useCallback(async () => { if (busyRef.current) return; try { const next = await readVoiceDisplay(); if (!busyRef.current) { setDisplay(next); setError(''); } } catch (e) { if (!busyRef.current) { setError(e instanceof Error ? e.message : String(e)); setDisplay(null); } } }, []);
  const turn = useCallback(async (utterance: string) => {
    if (busyRef.current) return 'Please wait for the current request to finish.';
    busyRef.current = true; setBusy(true); setError(''); setLastHeard(utterance); setNote('');
    if (/\b(i am|i['’]?m|switch to|end.*session|sign out)\b/i.test(utterance)) { setDisplay(null); setDrawer(null); }
    try {
      const current = await readVoiceDisplay();
      const text = /^retry last request[.! ]*$/i.test(utterance) ? pendingVoiceRequest() : utterance;
      if (!text) { setDisplay(current); return 'There is no uncertain request to retry.'; }
      const result = await sendVoiceTurn(text, current.revision); const latest = await readVoiceDisplay();
      setDisplay(latest); void refreshTrace(); return latest.revision === result.revision ? result.speech : latest.speech;
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); setError(msg); setDisplay(null); return `I could not complete that request. ${msg}`; }
    finally { busyRef.current = false; setBusy(false); }
  }, [refreshTrace]);
  const voice = useVoiceConversation(turn);
  useEffect(() => {
    void refresh(); void refreshTrace();
    const a = setInterval(() => void refresh(), 2500); const b = setInterval(() => void refreshTrace(), 5000);
    const resize = () => setSize({ w: innerWidth, h: innerHeight }); window.addEventListener('resize', resize);
    return () => { clearInterval(a); clearInterval(b); window.removeEventListener('resize', resize); };
  }, [refresh, refreshTrace]);
  useEffect(() => { if (typing) inputRef.current?.focus(); }, [typing]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDrawer(null); setTools(false); setTrace(false); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  const submit = (text: string) => { if (!text.trim() || busy) return; voice.stop(); setTools(false); if (mute) void turn(text); else void voice.submit(text); };
  const handoff = display?.handoffs.find(h => h.id === display.selectedHandoffId) || (display?.handoffs.length === 1 ? display.handoffs[0] : undefined);
  const tasks = [...(display?.tasks || []), ...(display?.candidates || [])];
  const selected = tasks.find(t => t.id === display?.selectedTaskId);
  const conflict = display?.conflicts.find(c => c.taskId === display.selectedTaskId) || display?.conflicts[0];
  const incoming = handoff?.incomingName === display?.nurse?.name;
  const next = !display?.nurse ? 'Hi, I am Seema. What are my tasks?' : display.pending?.ready ? 'Confirm' : display.pending ? '' : display.conflicts.length ? 'Review discrepancies' : !handoff ? 'Prepare my handoff for Reema' : handoff.status === 'FINALIZED' ? 'Ask assistant, summarize my shift' : !incoming ? `I am ${handoff.incomingName}` : display.candidates.length ? 'Accept all handoff tasks' : 'Finalize handoff';
  const mode = busy ? 'processing' : voice.status === 'Listening' ? 'listening' : voice.status === 'Speaking' ? 'speaking' : 'idle';
  const scale = Math.min(size.w / 1920, size.h / 1080);
  const speech = error || display?.speech || 'Good morning. Tap the suggested phrase below, speak, or type to begin your handoff.';
  const title = display?.pending ? 'Human confirmation' : display?.focus === 'conflicts' ? 'Documentation review' : handoff ? 'Shift handoff' : 'Your shift context';
  const hasPanel = Boolean(display?.nurse || error);
  const inspect = (task: VoiceTask) => { submit(`Explain task ${task.id}`); };
  return <main id="st" data-m={mode} data-np={!hasPanel ? '' : undefined} data-s={error ? 'int' : undefined} style={{ transform: `translate(${(size.w - 1920 * scale) / 2}px,${(size.h - 1080 * scale) / 2}px) scale(${scale})` }}>
    <header><div className="brand"><svg viewBox="0 0 40 34" fill="none" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M3 9c10 0 10 16 17 16s9-16 17-16" stroke="#8EA0FF" /><path d="M3 25c10 0 10-16 17-16s9 16 17 16" stroke="#FFB86B" /></svg>ShiftWeave</div>
      <div id="cnt">{display?.nurse && `${display.tasks.filter(t => t.status === 'COMPLETED').length} completed · ${display.tasks.filter(t => ['PENDING', 'IN_PROGRESS'].includes(t.status)).length} unfinished · ${display.conflicts.length} flagged`}</div><span className="pill">Alexa+ Voice Simulation</span></header>
    <div id="lm"><Thread display={display} onTask={inspect} onHandoff={() => setDrawer('handoffs')} /></div>
    {hasPanel && <section id="pn" className="in" data-t={error || display?.conflicts.length ? 'ro' : handoff?.status === 'FINALIZED' ? 'ok' : 'dy'} aria-label="Current workflow context">
      <div className="t">{error ? 'Request unavailable' : title}</div>
      <h1 className="h">{error ? 'No success claimed' : display?.pending ? (display.pending.ready ? 'Review, then confirm' : 'Your verification is needed') : display?.focus === 'conflicts' ? (conflict ? `${conflict.patientName || 'Patient'} · records disagree` : 'No unresolved discrepancies') : handoff ? `${handoff.outgoingName} → ${handoff.incomingName}` : selected ? selected.patientName : `${display?.nurse?.name} · ${display?.shift?.unit || 'No active shift'}`}</h1>
      <div className="m">{error || display?.pending?.prompt || (display?.focus === 'conflicts' && conflict ? `${conflict.systemAName}: ${conflict.systemAVal} / ${conflict.systemBName}: ${conflict.systemBVal}` : handoff ? `${handoff.status.replaceAll('_', ' ')} · ${display?.candidates.length || 0} incoming tasks awaiting acceptance` : selected ? `${selected.title} · ${selected.status}` : `${display?.tasks.length || 0} assigned tasks · ${display?.epicRecords?.length || 0} Epic patient snapshots`)}</div>
      <div className="bt">
        {display?.pending ? <><button className="btn p" disabled={busy || !display.pending.ready} onClick={() => submit('Confirm')}>Confirm reviewed action</button><button className="btn g" disabled={busy} onClick={() => submit('Cancel')}>Cancel</button>{!display.pending.ready && <button className="btn" onClick={() => { setTyping(true); setDrawer('tasks'); }}>Enter verification</button>}</> : error ? <button className="btn" onClick={() => submit('Retry last request')}>Retry saved request</button> : <>
          <button className="btn" onClick={() => setDrawer(display?.focus === 'conflicts' ? 'tasks' : handoff ? 'handoffs' : 'tasks')}>{handoff ? 'Review handoff' : 'Inspect records'}</button>
          {display?.focus === 'conflicts' && conflict && <button className="btn p" disabled={busy} onClick={() => setDrawer('tasks')}>Review discrepancy</button>}
          <button className="btn g" onClick={() => setDrawer('records')}>Source details</button>
        </>}
      </div>
    </section>}
    <section id="talk" aria-label="Voice assistant"><button id="orb" aria-label={voice.enabled ? 'Stop voice input' : 'Start voice input'} disabled={busy} onClick={() => voice.enabled || voice.status === 'Speaking' ? voice.stop() : voice.start()}><i /><i /><b /></button>
      <div id="usr">{lastHeard ? `You: ${lastHeard}` : voice.enabled ? 'Listening…' : ''}</div><div id="ast" role="status" style={{ fontSize: speech.length > 360 ? 29 : speech.length > 240 ? 32 : 36 }}>{speech}</div>
      {voice.error && <p className="voice-error" role="alert">{voice.error}</p>}
    </section>
    <aside id="tr" className={trace ? 'on' : ''} aria-label="MCP telemetry"><p>Live server audit records · Streamable HTTP MCP 2025-11-25 · {logs.length} recent events</p>{traceError && <p role="alert">Telemetry unavailable: {traceError}</p>}<div id="tl">{logs.slice(0, 12).reverse().map(log => <div className="ev" key={log.id} title={`${log.targetResource} · ${log.timestamp}`}><i>{log.actorType}</i><span>{log.action}</span><u className={log.outcome === 'FAILURE' ? 'F' : ''}>{log.outcome}</u></div>)}</div></aside>
    <nav id="tools" className={tools ? 'on' : ''} aria-label="Workspace tools">
      <button className="btn" disabled={busy || !display?.nurse} onClick={() => submit('Ask assistant, summarize my shift')}>Ask assistant</button>
      <button className="btn" disabled={busy || !display?.nurse} onClick={() => submit('Sync Epic patients')}>Sync Epic patients</button>
      <button className="btn" onClick={() => { setDrawer('tasks'); setTools(false); }}>Tasks & discrepancies</button>
      <button className="btn" onClick={() => { setDrawer('handoffs'); setTools(false); }}>Handoffs & note review</button>
      <button className="btn" onClick={() => { setDrawer('records'); setTools(false); }}>Epic source records</button>
      <button className="btn" onClick={() => { setDrawer('history'); setTools(false); }}>Conversation history</button>
      <button className="btn" onClick={() => { setDrawer('recovery'); setTools(false); }}>Recovery controls</button>
      <button className="btn" onClick={() => { voice.stop(); setMute(!mute); }}>{mute ? 'Enable voice replies' : 'Mute voice replies'}</button>
      <button className="btn" disabled={busy} onClick={() => submit(display?.nurse?.name.toLowerCase().includes('reema') ? 'I am Seema' : 'I am Reema')}>Switch demo nurse</button>
      <button className="btn g" disabled={busy} onClick={() => submit('End my session')}>End my session</button>
    </nav>
    <form id="dock" className={typing ? 'ty' : ''} onSubmit={e => { e.preventDefault(); if (input.trim()) { submit(input); setInput(''); } }}>
      <button type="button" className="btn ic" aria-label="Type instead" onClick={() => setTyping(!typing)}>⌨</button>
      <button type="button" className="btn p" id="chip" disabled={busy || !next} onClick={() => submit(next)}>{next ? `Say: “${next}”` : 'Type your verified status and note below'}</button>
      <input id="in" ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder="Type to Alexa+ (text fallback)" aria-label="Type to Alexa+" autoComplete="off" />
      <button className="btn" id="sd" type="submit" disabled={busy || !input.trim()}>Send</button>
      <button type="button" className="btn ic" aria-label="MCP Telemetry" aria-expanded={trace} onClick={() => { setTrace(!trace); setTools(false); }}>≡</button>
      <button type="button" className="btn ic" aria-label="Workspace tools" aria-expanded={tools} onClick={() => { setTools(!tools); setTrace(false); }}>⋯</button>
    </form>
    <footer>{display?.epicRecords?.length ? 'Epic sandbox records + local workflow state' : 'Local workflow data'} · Alexa+ voice simulation · Demo nurse identity · Human review required · {display ? `Saved turn ${display.revision}` : 'Connecting to saved session'}</footer>
    {drawer && <div className="detail-scrim" onClick={() => setDrawer(null)}><section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`${drawer} details`} onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'));
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <div className="sheet-top"><h2>{({ records: 'Epic source records', tasks: 'Tasks & discrepancies', handoffs: 'Handoff review', history: 'Your conversation', recovery: 'Checkpoint recovery' })[drawer]}</h2><button className="btn g" autoFocus onClick={() => setDrawer(null)} aria-label="Close details">Close ×</button></div>
      {drawer === 'tasks' && <>{!tasks.length && <p>No tasks returned for the current nurse.</p>}{tasks.map(t => <article key={t.id}><h3>{t.patientName} · {t.roomNumber}</h3><p>{t.title}</p><p>{t.status} · {t.priority}{display?.candidates.some(c => c.id === t.id) ? ' · Awaiting custody acceptance' : ''}</p><small>Source: {t.source}</small><div className="bt"><button className="btn" disabled={busy} onClick={() => { inspect(t); setDrawer(null); }}>Explain task</button></div></article>)}
        {display?.conflicts.map(c => { const task = tasks.find(t => t.id === c.taskId); return <article key={c.id}><h3>{c.patientName} · documentation discrepancy</h3><p>{c.systemAName}: {c.systemAVal}</p><p>{c.systemBName}: {c.systemBVal}</p>
          <label>Human verification note<textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Enter what you actually verified; no note is prefilled" /></label>
          <div className="bt">{['in progress', 'completed', 'cancelled'].map(status => <button className="btn" key={status} disabled={busy || !note.trim() || !task} onClick={() => { submit(`Resolve discrepancy for task ${task!.id} ${status} because ${note}`); setDrawer(null); }}>Stage {status}</button>)}</div><small>Stages a proposal; explicit confirmation is still required.</small></article>; })}
        {Boolean(display?.candidates.length) && <button className="btn p" disabled={busy} onClick={() => { submit('Accept all handoff tasks'); setDrawer(null); }}>Review custody acceptance</button>}</>}
      {drawer === 'records' && <>{!display?.epicRecords?.length && <p>No Epic snapshots returned for this view. Sync after introducing yourself.</p>}{display?.epicRecords?.map(r => <article key={r.patientId}><h3>{r.name} · {r.status}</h3><p>Patient/{r.epicPatientId} · Retrieved {r.retrievedAt}</p>{r.error && <p className="err">Refresh error: {r.error}. Retained data may be stale.</p>}
        {Object.entries(r.snapshot.sections).map(([name, section]) => <p key={name}>{name}: {section.status} · {section.resources.length} records {section.error || section.warnings.join('; ')}</p>)}
        {r.snapshot.documents.map((d, i) => <details key={`${d.id}:${i}`}><summary>{d.id} · {d.status}</summary><pre>{d.text || d.error || `Unsupported format: ${d.contentType}`}</pre></details>)}<small>Orders do not establish administration. Missing data is not a verified negative history.</small></article>)}</>}
      {drawer === 'handoffs' && <>{!display?.handoffs.length && <p>No saved handoff in this view.</p>}{display?.handoffs.map(h => <article key={h.id}><h3>{h.outgoingName} → {h.incomingName}</h3><p>{h.status} · {h.id}</p><pre>{h.summary}</pre><div className="bt"><button className="btn" disabled={busy} onClick={() => { submit(`Review handoff ${h.id}`); setDrawer(null); }}>Select handoff</button>{h.status !== 'FINALIZED' && <button className="btn" disabled={busy} onClick={() => { submit(`Finalize handoff ${h.id}`); setDrawer(null); }}>Review finalization</button>}</div>{h.status === 'FINALIZED' && display.nurse && <EpicNoteReview key={`${h.id}:${display.nurse.id}`} handoffId={h.id} nurseId={display.nurse.id} />}</article>)}{display?.nurse && <button className="btn" disabled={busy} onClick={() => { submit('Prepare my handoff for Reema'); setDrawer(null); }}>Prepare handoff for Reema</button>}</>}
      {drawer === 'history' && <>{!display?.messages.length && <p>No conversation in this session.</p>}{display?.messages.map((m, i) => <article key={i}><small>{m.role === 'nurse' ? 'You' : 'Assistant'}</small><p>{m.text}</p></article>)}</>}
      {drawer === 'recovery' && <ChaosControlBar onRefreshAll={async () => { await refresh(); await refreshTrace(); }} />}
    </section></div>}
  </main>;
}
