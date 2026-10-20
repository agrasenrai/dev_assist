import React, { useCallback, useEffect, useRef, useState } from 'react';
import { readVoiceDisplay, sendVoiceTurn, pendingVoiceRequest } from '../voice-api.js';
import type { VoiceDisplay, VoiceTask } from '../voice-types.js';
import { useVoiceConversation } from '../useVoiceConversation.js';

export function VoiceWorkspace() {
  const [display, setDisplay] = useState<VoiceDisplay | null>(null);
  const displayRef = useRef<VoiceDisplay | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [fallback, setFallback] = useState('');
  const [lastHeard, setLastHeard] = useState('');
  const focusRef = useRef<HTMLElement>(null);
  const apply = useCallback((value: VoiceDisplay) => {
    displayRef.current = value; setDisplay(value);
  }, []);
  const turn = useCallback(async (transcript: string) => {
    if (busyRef.current) return 'Please wait for the current request to finish.';
    busyRef.current = true; setBusy(true); setError(''); setLastHeard(transcript);
    // Hide previous nurse details before a switch/end request reaches the server.
    if (/\b(i am|i['’]?m|this is|my name is|switch to|end.*session|sign out|log out|goodbye)\b/i.test(transcript)) setDisplay(null);
    try {
      const current = await readVoiceDisplay();
      const text = /^retry last request[.! ]*$/i.test(transcript) ? pendingVoiceRequest() : transcript;
      if (!text) { apply(current); return 'There is no uncertain request to retry.'; }
      const result = await sendVoiceTurn(text, current.revision);
      // A retried receipt may be older than a later turn from another voice host.
      const latest = await readVoiceDisplay();
      apply(latest);
      return latest.revision === result.revision ? result.speech : latest.speech;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message); setDisplay(null);
      return `I could not complete that request. ${message}`;
    } finally { busyRef.current = false; setBusy(false); }
  }, [apply]);
  const voice = useVoiceConversation(turn);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (busyRef.current) return;
      try {
        const next = await readVoiceDisplay();
        if (alive && !busyRef.current) { apply(next); setError(''); }
      } catch (e) {
        if (alive && !busyRef.current) { setError(e instanceof Error ? e.message : String(e)); setDisplay(null); }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => { alive = false; clearInterval(timer); };
  }, [apply]);
  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [display?.focus, display?.selectedTaskId, display?.selectedHandoffId]);

  const taskCards = (tasks: VoiceTask[]) => tasks.map(t => <article key={t.id}
    className={`voice-task ${display?.selectedTaskId === t.id ? 'voice-selected' : ''}`}>
    <div className="voice-task-top"><strong>{t.patientName}</strong><span>{t.roomNumber}</span></div>
    <h3>{t.title}</h3>
    <p><span className={`voice-status ${t.status === 'FLAGGED_CONFLICT' ? 'voice-alert' : ''}`}>{t.status.replaceAll('_', ' ')}</span> · {t.priority}</p>
    <small>Recorded source: {t.source}</small>
  </article>);

  return <main className="voice-workspace">
    <header className="voice-header">
      <div><span className="voice-eyebrow">SHIFTWEAVE · VOICE WORKSPACE</span><h1>Your shift, in conversation.</h1>
        <p>Speak to the assistant. Your screen follows the conversation.</p></div>
      <span className="badge badge-routine">Synthetic demo · Alexa+ voice simulation</span>
    </header>
    <section className="glass-panel voice-assistant" aria-label="Voice assistant">
      <div className={`voice-orb ${voice.enabled ? 'voice-active' : ''}`} aria-hidden="true">◉</div>
      <div className="voice-speech">
        <span className="voice-eyebrow">{busy ? 'WORKING' : voice.status.toUpperCase()}</span>
        <p aria-live="polite">{display?.speech || (busy ? 'Opening your voice session…' : 'Say “Hi, I am Seema. What are my tasks?”')}</p>
        {lastHeard && <small>You said: “{lastHeard}”</small>}
      </div>
      <button className="btn btn-primary" onClick={voice.enabled ? voice.stop : voice.start} disabled={!voice.supported}>
        {voice.enabled ? 'Pause microphone' : 'Start voice'}
      </button>
      <p className="voice-permission">Start once to allow the browser microphone. Listening pauses while the assistant speaks.</p>
    </section>
    {(error || voice.error) && <p className="voice-error" role="alert">{error || voice.error}</p>}
    {!voice.supported && <p role="status">Speech recognition is unavailable in this browser. Use the text fallback below or a supported browser.</p>}
    <details className="voice-fallback"><summary>Text fallback / demo testing</summary>
      <form onSubmit={e => { e.preventDefault(); const text = fallback.trim(); if (text) { setFallback(''); void voice.submit(text); } }}>
        <input aria-label="Voice transcript fallback" value={fallback} onChange={e => setFallback(e.target.value)} placeholder="Hi, I am Seema. What are my tasks?" />
        <button className="btn btn-outline" disabled={busy || voice.status === 'Speaking'}>Send</button>
      </form>
    </details>
    {display?.nurse ? <>
      <section className="voice-identity">
        <div><h2>{display.nurse.name}</h2><p>{display.shift ? `${display.shift.unit} · ${display.shift.type} · ${display.shift.id}` : 'No active shift'}</p></div>
        <p>Demo profile selected by name<br /><small>Say “end my session” when finished.</small></p>
      </section>
      {display.pending && <aside className="voice-confirmation" aria-live="polite">
        <h2>{display.pending.ready ? 'Awaiting your spoken confirmation' : 'A little more detail is needed'}</h2>
        <p>{display.pending.prompt}</p>
        <small>Say “cancel” to discard this action. Confirmations expire after five minutes or when records change.</small>
      </aside>}
      <section ref={display.focus === 'tasks' ? focusRef : undefined} className="voice-section">
        <h2>Your assigned tasks <span>{display.tasks.length}</span></h2>
        <div className="voice-grid">{taskCards(display.tasks)}</div>
        {!display.tasks.length && <p>No assigned tasks were returned for this nurse and shift.</p>}
      </section>
      {display.candidates.length > 0 && <section className="voice-section">
        <h2>Incoming tasks awaiting custody acceptance <span>{display.candidates.length}</span></h2>
        <div className="voice-grid">{taskCards(display.candidates)}</div>
      </section>}
      <section ref={display.focus === 'conflicts' ? focusRef : undefined} className={`voice-section ${display.focus === 'conflicts' ? 'voice-focused' : ''}`}>
        <h2>Documentation discrepancies <span>{display.conflicts.length}</span></h2>
        {display.conflicts.map(c => <article key={c.id} className={`voice-discrepancy ${display.selectedTaskId === c.taskId ? 'voice-selected' : ''}`}>
          <h3>{c.patientName} · {c.patientRoom}</h3><div className="voice-grid">
            <p><strong>{c.systemAName}</strong><br />{c.systemAVal}</p><p><strong>{c.systemBName}</strong><br />{c.systemBVal}</p>
          </div><small>Requires human review. Say “resolve discrepancy in room…” to begin.</small>
        </article>)}
        {!display.conflicts.length && <p>No unresolved discrepancies returned for this view.</p>}
      </section>
      <section ref={display.focus === 'handoff' ? focusRef : undefined} className={`voice-section ${display.focus === 'handoff' ? 'voice-focused' : ''}`}>
        <h2>Handoffs <span>{display.handoffs.length}</span></h2>
        {display.handoffs.map(h => <article key={h.id} className={`voice-task ${display.selectedHandoffId === h.id ? 'voice-selected' : ''}`}>
          <h3>{h.outgoingName} → {h.incomingName}</h3><p>{h.status} · Local record</p><small>{h.id}</small>
          {display.selectedHandoffId === h.id && <pre className="voice-draft">{h.summary}</pre>}
        </article>)}
        {!display.handoffs.length && <p>Say “prepare my handoff for Reema” to create a local draft.</p>}
      </section>
    </> : <section className="voice-welcome"><h2>Ready when you are.</h2><p>Introduce yourself by your nurse name to open your shift display.</p></section>}
    <footer className="voice-footer">Local synthetic data · Workflow coordination only · {display ? `Saved turn ${display.revision}` : 'Display unavailable'}
      <p>Try: “show my tasks” · “explain room 305” · “review discrepancies” · “prepare my handoff for Reema” · “end my session”</p>
    </footer>
  </main>;
}
