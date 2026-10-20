import React, { useEffect, useState, useCallback } from 'react';
import type { ClinicalTask, ConflictItem, AuditLogItem, HandoffItem, ProviderHealth, ChatMessage } from './types.js';
import {
  fetchHealth,
  fetchTasks,
  fetchConflicts,
  fetchExecutionTrace,
  fetchHandoffs,
  resolveConflict,
  switchProvider,
  sendChatMessage, fetchConversation, startNewConversation, acknowledgeTask, finalizeHandoff
} from './api.js';
import { ShiftHeader } from './components/ShiftHeader.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ConflictReviewDrawer } from './components/ConflictReviewDrawer.js';
import { ExecutionTracePanel } from './components/ExecutionTracePanel.js';
import { AlexaVoiceSim } from './components/AlexaVoiceSim.js';
import { ChaosControlBar } from './components/ChaosControlBar.js';

export const App: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [dataError, setDataError] = useState(false);
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [tasks, setTasks] = useState<ClinicalTask[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const loadAllData = useCallback(async () => {
    try {
      const [h, t, c, l, hd] = await Promise.all([
        fetchHealth(),
        fetchTasks(),
        fetchConflicts(),
        fetchExecutionTrace(),
        fetchHandoffs()
      ]);
      setDataError(false);
      if (h) setHealth(h);
      setTasks(t);
      setConflicts(c);
      setLogs(l);
      setHandoffs(hd);
    } catch (err) {
      setDataError(true);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadAllData();
    fetchConversation().then(({ messages }) => setChatMessages(messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.toolCall && m.content)
      .map((m, i) => ({ id: `restored_${i}`, role: m.role === 'user' ? 'nurse' : 'alexa',
        text: m.content, timestamp: new Date().toISOString() })))).catch(err => setError(err.message));
    // Poll telemetry trace every 3 seconds for live dashboard updates
    const timer = setInterval(() => {
      fetchExecutionTrace().then(setLogs).catch(err => setError(`Trace unavailable: ${err.message}`));
    }, 3000);
    return () => clearInterval(timer);
  }, [loadAllData]);

  const handleToggleProvider = async () => {
    if (!health) return;
    setError(null);
    setLoading(true);
    const target = health.provider.id === 'sqlite-edge-cache' ? 'live-fhir-api' : 'sqlite-edge-cache';
    try {
      await switchProvider(target);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResolveConflict = async (conflictId: string, status: string, note: string) => {
    setError(null);
    setLoading(true);
    try {
      await resolveConflict(conflictId, 'nurse_reema_02', status, note);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'nurse',
      text,
      timestamp: new Date().toISOString()
    };
    setChatMessages(prev => [...prev, userMsg]);
    setError(null);
    setLoading(true);

    try {
      const res = await sendChatMessage(text);
      const alexaMsg: ChatMessage = {
        id: `alexa_${Date.now()}`,
        role: 'alexa',
        text: res.speech,
        timestamp: new Date().toISOString(),
        provider: res.provider,
        card: res.dashboardCard,
        toolsExecuted: res.toolsExecuted
      };
      setChatMessages(prev => [...prev, alexaMsg]);

      // Play aloud via Browser TTS if supported and enabled
      if (speechEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(res.speech);
        utterance.rate = 1.05;
        window.speechSynthesis.speak(utterance);
      }

      await loadAllData();
    } catch (err: any) {
      setChatMessages(prev => [
        ...prev,
        {
          id: `alexa_err_${Date.now()}`,
          role: 'alexa',
          text: `Error processing request: ${err.message}`,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '20px 24px' }}>
      {error && <div role="alert" className="glass-panel glass-panel-danger" style={{ padding: 12, marginBottom: 16 }}>
        {error}<button className="btn btn-outline" onClick={() => { setError(null); void loadAllData(); }}>Retry refresh</button>
      </div>}
      <div style={{ marginBottom: 12, color: '#94a3b8' }}>Local demo: synthetic records; no production authentication or verified Epic sync.</div>
      {/* 1. Shift & Nurse Header */}
      <ShiftHeader
        health={health}
        onRefresh={loadAllData}
        onToggleProvider={handleToggleProvider}
        loading={loading}
      />

      {/* 2. Chaos Interruption & Recovery Demonstration Controls */}
      <ChaosControlBar onRefreshAll={loadAllData} />

      {/* 3. Clinical Conflict Review Drawer (Safety Boundary Highlight) */}
      {!dataError && <ConflictReviewDrawer
        conflicts={conflicts}
        onResolve={handleResolveConflict}
        loading={loading}
      />}

      {/* 4. Task Board (4 Kanban Columns) */}
      {!dataError && <TaskBoard tasks={tasks} />}
      {!dataError && handoffs.map(handoff => {
        let ids: string[] = [];
        try { ids = JSON.parse(handoff.structuredSnapshot || '{}').carriedForwardIds || []; }
        catch { return <div role="alert" key={handoff.id}>Invalid handoff snapshot; refresh required.</div>; }
        return <section className="glass-panel" style={{ padding: 16, marginBottom: 20 }} key={handoff.id}>
          <h3>Local handoff for review — {handoff.status}</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.85rem', margin: '12px 0' }}>{handoff.summaryMarkdown}</pre>
          {handoff.status !== 'FINALIZED' && <button className="btn btn-cyan" disabled={loading} onClick={async () => {
            setLoading(true); setError(null);
            try { await finalizeHandoff(handoff.id); await loadAllData(); }
            catch (err) { setError(err instanceof Error ? err.message : String(err)); }
            finally { setLoading(false); }
          }}>Confirm reviewed handoff &amp; sign off locally</button>}
          {ids.map(id => {
            const task = tasks.find(t => t.id === id);
            if (!task || task.assignedNurseId === 'nurse_reema_02') return null;
            return <button key={id} className="btn btn-outline" disabled={loading || task.status === 'FLAGGED_CONFLICT'} onClick={async () => {
              setLoading(true); setError(null);
              try { await acknowledgeTask(id, 'ACCEPT_HANDOFF', 'Explicit incoming nurse custody acceptance', handoff.id); await loadAllData(); }
              catch (err) { setError(err instanceof Error ? err.message : String(err)); }
              finally { setLoading(false); }
            }}>Accept custody: {task.title}</button>;
          })}
        </section>;
      })}
      <button className="btn btn-outline" disabled={loading} onClick={() => { startNewConversation(); setChatMessages([]); }}>Start new conversation</button>

      {/* 5. Split Panel: Alexa+ Conversational Assistant & Observable Execution Trace */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px', minHeight: '440px' }}>
        <AlexaVoiceSim
          messages={chatMessages}
          onSendMessage={handleSendMessage}
          loading={loading}
          speechEnabled={speechEnabled}
          onToggleSpeech={() => setSpeechEnabled(prev => !prev)}
        />

        <ExecutionTracePanel logs={logs} />
      </div>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        marginTop: '36px',
        paddingTop: '16px',
        borderTop: '1px solid rgba(148, 163, 184, 0.15)',
        fontSize: '0.75rem',
        color: '#64748b'
      }}>
        <p>
          ShiftWeave • Amazon Developer Hackathon (Alexa+ Track) • MCP Protocol Spec 2025-11-25 over Streamable HTTP (/mcp) • Zero-Cost Local-First Architecture ($0.00)
        </p>
      </footer>
    </div>
  );
};
export default App;
