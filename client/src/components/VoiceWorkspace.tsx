import React, { useCallback, useEffect, useRef, useState } from 'react';
import { readVoiceDisplay, sendVoiceTurn, pendingVoiceRequest } from '../voice-api.js';
import type { VoiceDisplay, VoiceTask } from '../voice-types.js';
import type { AuditLogItem } from '../types.js';
import { useVoiceConversation } from '../useVoiceConversation.js';
import { ExecutionTracePanel } from './ExecutionTracePanel.js';
import { ChaosControlBar } from './ChaosControlBar.js';
import { fetchExecutionTrace } from '../api.js';
import { EpicNoteReview } from './EpicNoteReview.js';

export function VoiceWorkspace() {
  const [display, setDisplay] = useState<VoiceDisplay | null>(null);
  const displayRef = useRef<VoiceDisplay | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [fallback, setFallback] = useState('');
  const [lastHeard, setLastHeard] = useState('');
  const [activeTab, setActiveTab] = useState<'workspace' | 'trace'>('workspace');
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const focusRef = useRef<HTMLElement>(null);

  const apply = useCallback((value: VoiceDisplay) => {
    displayRef.current = value;
    setDisplay(value);
  }, []);

  const refreshTrace = useCallback(async () => {
    try {
      const logs = await fetchExecutionTrace();
      setAuditLogs(logs);
    } catch {
      // Telemetry fetch error is non-fatal to clinical view
    }
  }, []);

  const turn = useCallback(async (transcript: string) => {
    if (busyRef.current) return 'Please wait for the current request to finish.';
    busyRef.current = true;
    setBusy(true);
    setError('');
    setLastHeard(transcript);

    // Hide previous nurse details before a switch/end request reaches the server.
    if (/\b(i am|i['’]?m|this is|my name is|switch to|end.*session|sign out|log out|goodbye)\b/i.test(transcript)) {
      setDisplay(null);
    }

    try {
      const current = await readVoiceDisplay();
      const text = /^retry last request[.! ]*$/i.test(transcript) ? pendingVoiceRequest() : transcript;
      if (!text) {
        apply(current);
        return 'There is no uncertain request to retry.';
      }
      const result = await sendVoiceTurn(text, current.revision);
      const latest = await readVoiceDisplay();
      apply(latest);
      void refreshTrace();
      return latest.revision === result.revision ? result.speech : latest.speech;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setDisplay(null);
      return `I could not complete that request. ${message}`;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply, refreshTrace]);

  const voice = useVoiceConversation(turn);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (busyRef.current) return;
      try {
        const next = await readVoiceDisplay();
        if (alive && !busyRef.current) {
          apply(next);
          setError('');
        }
      } catch (e) {
        if (alive && !busyRef.current) {
          setError(e instanceof Error ? e.message : String(e));
          setDisplay(null);
        }
      }
    };
    void refresh();
    void refreshTrace();
    const displayTimer = setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 2500);
    const traceTimer = setInterval(() => {
      void refreshTrace();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(displayTimer);
      clearInterval(traceTimer);
    };
  }, [apply, refreshTrace]);

  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [display?.focus, display?.selectedTaskId, display?.selectedHandoffId]);

  const handleChipClick = (utterance: string) => {
    if (busy || voice.status === 'Speaking') return;
    void voice.submit(utterance);
  };

  const handleRefreshAll = async () => {
    try {
      const current = await readVoiceDisplay();
      apply(current);
      await refreshTrace();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const taskCards = (tasks: VoiceTask[]) => tasks.map(t => (
    <article
      key={t.id}
      className={`voice-task ${display?.selectedTaskId === t.id ? 'voice-selected' : ''}`}
    >
      <div className="voice-task-top">
        <strong>{t.patientName}</strong>
        <span>{t.roomNumber}</span>
      </div>
      <h3>{t.title}</h3>
      <p>
        <span className={`voice-status ${t.status === 'FLAGGED_CONFLICT' ? 'voice-alert' : ''}`}>
          {t.status.replaceAll('_', ' ')}
        </span>{' '}
        · {t.priority}
      </p>
      <small>Recorded source: {t.source}</small>
      <div className="voice-card-actions">
        <button
          type="button"
          className="btn btn-outline voice-btn-sm"
          onClick={() => handleChipClick(`Explain ${t.roomNumber}`)}
          disabled={busy}
        >
          Explain Room
        </button>
      </div>
    </article>
  ));

  return (
    <main className="voice-workspace">
      <header className="voice-header">
        <div>
          <span className="voice-eyebrow">SHIFTWEAVE · AMBIENT NURSE ASSISTANT</span>
          <h1>Your shift, in conversation.</h1>
          <p>Spoken coordination over Streamable HTTP MCP (Spec 2025-11-25). Screen tracks active dialogue.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <span className="badge badge-routine">Synthetic demo · Alexa+ voice simulation</span>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Protocol 2025-11-25 · $0 Local Edge Cache</span>
        </div>
      </header>

      {/* Voice Assistant Speech Panel */}
      <section className="glass-panel voice-assistant" aria-label="Voice assistant">
        <div className={`voice-orb ${voice.enabled ? 'voice-active' : ''}`} aria-hidden="true">
          ◉
        </div>
        <div className="voice-speech">
          <span className="voice-eyebrow">{busy ? 'WORKING' : voice.status.toUpperCase()}</span>
          <p aria-live="polite">
            {display?.speech || (busy ? 'Opening your voice session…' : 'Say “Hi, I am Seema. What are my tasks?”')}
          </p>
          {lastHeard && <small>You said: “{lastHeard}”</small>}
        </div>
        <button
          className="btn btn-primary"
          onClick={voice.enabled ? voice.stop : voice.start}
          disabled={!voice.supported}
        >
          {voice.enabled ? 'Pause microphone' : 'Start voice'}
        </button>
        <p className="voice-permission">
          Start once to allow the browser microphone. Listening pauses automatically while the assistant speaks.
        </p>
      </section>

      {/* Quick Action Suggestion Chips for Fast Testing & Demo Walkthrough */}
      <div className="voice-chips-container">
        <span className="voice-chips-label">Demo Walkthrough & Quick Voice Prompts (Click to Speak):</span>
        <div className="voice-chips">
          <button type="button" className="voice-chip" disabled={busy || !display?.nurse}
            onClick={() => handleChipClick('Sync Epic patients')}>Sync Epic patients</button>
          <button type="button" className="voice-chip" disabled={busy}
            onClick={() => handleChipClick('Ask assistant, summarize my shift')}>
            Ask assistant to summarize
          </button>
          <button
            type="button"
            className="voice-chip voice-chip-primary"
            onClick={() => handleChipClick('Hi, I am Seema. What are my tasks?')}
            disabled={busy}
          >
            1. 👋 "Hi, I am Seema. What are my tasks?"
          </button>
          <button
            type="button"
            className="voice-chip"
            onClick={() => handleChipClick('Explain room 305')}
            disabled={busy}
          >
            2. 🔍 "Explain room 305"
          </button>
          <button
            type="button"
            className="voice-chip"
            onClick={() => handleChipClick('Review discrepancies')}
            disabled={busy}
          >
            3. ⚠️ "Review discrepancies"
          </button>
          <button
            type="button"
            className="voice-chip"
            onClick={() => handleChipClick('Prepare my handoff for Reema')}
            disabled={busy}
          >
            4. 📋 "Prepare my handoff for Reema"
          </button>
          <button
            type="button"
            className="voice-chip voice-chip-primary"
            onClick={() => handleChipClick('Hi, I am Reema')}
            disabled={busy}
          >
            5. 🔄 "Hi, I am Reema" (Switch Nurse)
          </button>
          <button
            type="button"
            className="voice-chip"
            onClick={() => handleChipClick('Accept all handoff tasks')}
            disabled={busy}
          >
            6. 🤝 "Accept all handoff tasks"
          </button>
          <button
            type="button"
            className="voice-chip"
            onClick={() => handleChipClick('Yes, confirm')}
            disabled={busy}
          >
            7. ✅ "Yes, confirm"
          </button>
          <button
            type="button"
            className="voice-chip"
            onClick={() => handleChipClick('Finalize handoff')}
            disabled={busy}
          >
            8. ✍️ "Finalize handoff"
          </button>
          <button
            type="button"
            className="voice-chip voice-chip-danger"
            onClick={() => handleChipClick('Cancel')}
            disabled={busy}
          >
            ✕ "Cancel"
          </button>
          <button
            type="button"
            className="voice-chip voice-chip-danger"
            onClick={() => handleChipClick('End my session')}
            disabled={busy}
          >
            🚪 "End my session"
          </button>
        </div>
      </div>

      {(error || voice.error) && <p className="voice-error" role="alert">{error || voice.error}</p>}
      {!voice.supported && (
        <p role="status">
          Speech recognition is unavailable in this browser. Use the quick chips above, text fallback below, or a supported browser.
        </p>
      )}

      {/* Text fallback input */}
      <details className="voice-fallback">
        <summary>Manual text transcript input / fallback</summary>
        <form
          onSubmit={e => {
            e.preventDefault();
            const text = fallback.trim();
            if (text) {
              setFallback('');
              void voice.submit(text);
            }
          }}
        >
          <input
            aria-label="Voice transcript fallback"
            value={fallback}
            onChange={e => setFallback(e.target.value)}
            placeholder="Type utterance e.g. Hi, I am Seema. What are my tasks?"
          />
          <button className="btn btn-outline" disabled={busy || voice.status === 'Speaking'}>
            Send Turn
          </button>
        </form>
      </details>

      {/* View Toggle Tabs */}
      <div className="voice-view-toggle">
        <button
          type="button"
          className={`voice-tab-btn ${activeTab === 'workspace' ? 'active' : ''}`}
          onClick={() => setActiveTab('workspace')}
        >
          🏥 Clinical Shift Workspace
        </button>
        <button
          type="button"
          className={`voice-tab-btn ${activeTab === 'trace' ? 'active' : ''}`}
          onClick={() => setActiveTab('trace')}
        >
          ⚡ Observable MCP Telemetry & Chaos Recovery ({auditLogs.length} events)
        </button>
      </div>

      {activeTab === 'trace' ? (
        <div className="voice-telemetry-container">
          <ChaosControlBar onRefreshAll={handleRefreshAll} />
          <ExecutionTracePanel logs={auditLogs} />
        </div>
      ) : (
        <>
          {display?.nurse ? (
            <>
              {/* Nurse Identity Header */}
              <section className="voice-identity">
                <div>
                  <h2>{display.nurse.name}</h2>
                  <p>
                    {display.shift
                      ? `${display.shift.unit} · ${display.shift.type} · ${display.shift.id}`
                      : 'No active shift'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p>
                    Demo profile selected by voice intro
                    <br />
                    <small>Say “end my session” when finished.</small>
                  </p>
                </div>
              </section>

              {/* Pending Human Confirmation Drawer */}
              {Boolean(display.epicRecords?.length) && <section className="glass-panel" aria-label="Epic source records">
                <h2>Epic source records</h2>
                <p>Local review tasks use these retrieved records. Orders do not establish administration or transfer custody.</p>
                {display.epicRecords!.map(record => <article key={record.patientId}>
                  <h3>{record.name} · {record.status}</h3>
                  <p>Epic Patient/{record.epicPatientId} · Retrieved {record.retrievedAt}</p>
                  {record.error && <p role="alert">Refresh failed; retained data may be stale: {record.error}</p>}
                  <ul>{Object.entries(record.snapshot.sections).map(([name, section]) => <li key={name}>
                    {name}: {section.status} · {section.resources.length} records
                    {section.error && <span role="alert"> — {section.error}</span>}
                    {section.warnings.length > 0 && <span> — {section.warnings.join('; ')}</span>}
                  </li>)}</ul>
                  {record.snapshot.documents.map((document, index) => <details key={`${document.id}:${index}`}>
                    <summary>Document {document.id} · {document.status} · {document.contentType}</summary>
                    {document.text ? <pre style={{ whiteSpace: 'pre-wrap' }}>{document.text}</pre> : <p>{document.error || 'Content format is not supported for display.'}</p>}
                  </details>)}
                </article>)}
              </section>}
              {display.handoffs.filter(h => h.id === display.selectedHandoffId && h.status === 'FINALIZED').map(h =>
                <EpicNoteReview key={`${h.id}:${display.nurse!.id}`} handoffId={h.id} nurseId={display.nurse!.id} />)}
              {display.pending && (
                <aside className="voice-confirmation" aria-live="polite">
                  <h2>
                    {display.pending.ready
                      ? '⚠️ Awaiting Spoken Human Confirmation'
                      : 'ℹ️ Additional Details Needed'}
                  </h2>
                  <p>{display.pending.prompt}</p>
                  <small>
                    Say “confirm” to execute, or “cancel” to discard. Confirmations expire in 5 minutes or if records change.
                  </small>
                  <div className="voice-confirm-actions">
                    <button
                      type="button"
                      className="btn btn-cyan"
                      onClick={() => handleChipClick('Yes, confirm')}
                      disabled={busy}
                    >
                      ✅ Speak "Confirm"
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => handleChipClick('Cancel')}
                      disabled={busy}
                    >
                      ✕ Speak "Cancel"
                    </button>
                  </div>
                </aside>
              )}

              {/* Assigned Tasks Grid */}
              <section ref={display.focus === 'tasks' ? focusRef : undefined} className="voice-section">
                <h2>
                  Your assigned tasks <span>{display.tasks.length}</span>
                </h2>
                <div className="voice-grid">{taskCards(display.tasks)}</div>
                {!display.tasks.length && (
                  <p>No assigned tasks were returned for this nurse and shift.</p>
                )}
              </section>

              {/* Incoming Candidates Grid */}
              {display.candidates.length > 0 && (
                <section className="voice-section">
                  <h2>
                    Incoming tasks awaiting custody acceptance <span>{display.candidates.length}</span>
                  </h2>
                  <div className="voice-grid">{taskCards(display.candidates)}</div>
                  <div style={{ marginTop: '14px' }}>
                    <button
                      type="button"
                      className="btn btn-cyan voice-btn-sm"
                      onClick={() => handleChipClick('Accept all handoff tasks')}
                      disabled={busy}
                    >
                      🤝 Accept All Incoming Tasks
                    </button>
                  </div>
                </section>
              )}

              {/* Documentation Discrepancies Grid */}
              <section
                ref={display.focus === 'conflicts' ? focusRef : undefined}
                className={`voice-section ${display.focus === 'conflicts' ? 'voice-focused' : ''}`}
              >
                <h2>
                  Documentation discrepancies <span>{display.conflicts.length}</span>
                </h2>
                {display.conflicts.map(c => (
                  <article
                    key={c.id}
                    className={`voice-discrepancy ${display.selectedTaskId === c.taskId ? 'voice-selected' : ''}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3>
                        {c.patientName} · {c.patientRoom}
                      </h3>
                      <span className="badge badge-conflict">Cross-System Discrepancy</span>
                    </div>
                    <div className="voice-grid">
                      <p>
                        <strong>{c.systemAName}</strong>
                        <br />
                        {c.systemAVal}
                      </p>
                      <p>
                        <strong>{c.systemBName}</strong>
                        <br />
                        {c.systemBVal}
                      </p>
                    </div>
                    <small>Requires human review. Say “resolve discrepancy in room…” to begin.</small>
                    <div className="voice-card-actions">
                      <button
                        type="button"
                        className="btn btn-outline voice-btn-sm"
                        onClick={() => {
                          const room = (c.patientRoom || '').replace(/\D/g, '') || '305';
                          handleChipClick(
                            `Resolve discrepancy in room ${room} completed because nurse verified bedside`
                          );
                        }}
                        disabled={busy}
                      >
                        ⚡ Stage Verified Resolution
                      </button>
                    </div>
                  </article>
                ))}
                {!display.conflicts.length && (
                  <p>No unresolved discrepancies returned for this view.</p>
                )}
              </section>

              {/* Handoff Summaries Section */}
              <section
                ref={display.focus === 'handoff' ? focusRef : undefined}
                className={`voice-section ${display.focus === 'handoff' ? 'voice-focused' : ''}`}
              >
                <h2>
                  Shift Handoffs <span>{display.handoffs.length}</span>
                </h2>
                {display.handoffs.map(h => (
                  <article
                    key={h.id}
                    className={`voice-task ${display.selectedHandoffId === h.id ? 'voice-selected' : ''}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3>
                        {h.outgoingName} → {h.incomingName}
                      </h3>
                      <span
                        className={`badge ${h.status === 'FINALIZED' ? 'badge-completed' : 'badge-pending'}`}
                      >
                        {h.status}
                      </span>
                    </div>
                    <small>ID: {h.id}</small>
                    {display.selectedHandoffId === h.id && (
                      <pre className="voice-draft">{h.summary}</pre>
                    )}
                    <div className="voice-card-actions">
                      {h.status !== 'FINALIZED' && (
                        <button
                          type="button"
                          className="btn btn-cyan voice-btn-sm"
                          onClick={() => handleChipClick('Finalize handoff')}
                          disabled={busy}
                        >
                          ✍️ Finalize Handoff
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!display.handoffs.length && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <p>No handoff draft created yet.</p>
                    <button
                      type="button"
                      className="btn btn-outline voice-btn-sm"
                      onClick={() => handleChipClick('Prepare my handoff for Reema')}
                      disabled={busy}
                    >
                      📋 Prepare Handoff for Reema
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="voice-welcome">
              <h2>Ready when you are.</h2>
              <p>Introduce yourself by your nurse name to open your shift display.</p>
              <div style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-cyan"
                  onClick={() => handleChipClick('Hi, I am Seema. What are my tasks?')}
                  disabled={busy}
                >
                  👋 Introduce as Seema Patel, RN
                </button>
              </div>
            </section>
          )}
        </>
      )}

      <footer className="voice-footer">
        Local synthetic data · Workflow coordination only ·{' '}
        {display ? `Saved turn ${display.revision}` : 'Display unavailable'}
        <p>
          Try: “show my tasks” · “explain room 305” · “review discrepancies” · “prepare my handoff for Reema” · “end my session”
        </p>
      </footer>
    </main>
  );
}
