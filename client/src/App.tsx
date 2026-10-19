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
  sendChatMessage
} from './api.js';
import { ShiftHeader } from './components/ShiftHeader.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ConflictReviewDrawer } from './components/ConflictReviewDrawer.js';
import { ExecutionTracePanel } from './components/ExecutionTracePanel.js';
import { AlexaVoiceSim } from './components/AlexaVoiceSim.js';
import { ChaosControlBar } from './components/ChaosControlBar.js';

export const App: React.FC = () => {
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [tasks, setTasks] = useState<ClinicalTask[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);

  // Initial greeting from Alexa+
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_welcome',
      role: 'alexa',
      text: "Good morning, Nurse Reema. ICU-B shift coordination is active over Streamable HTTP. I have prepared your handover summary from Nurse Seema. Notice there is 1 active discrepancy flagged in your Review Drawer.",
      timestamp: new Date().toISOString()
    }
  ]);

  const loadAllData = useCallback(async () => {
    try {
      const [h, t, c, l, hd] = await Promise.all([
        fetchHealth().catch(() => null),
        fetchTasks().catch(() => []),
        fetchConflicts().catch(() => []),
        fetchExecutionTrace().catch(() => []),
        fetchHandoffs().catch(() => [])
      ]);
      if (h) setHealth(h);
      setTasks(t);
      setConflicts(c);
      setLogs(l);
      setHandoffs(hd);
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    }
  }, []);

  useEffect(() => {
    loadAllData();
    // Poll telemetry trace every 3 seconds for live dashboard updates
    const timer = setInterval(() => {
      fetchExecutionTrace().then(setLogs).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [loadAllData]);

  const handleToggleProvider = async () => {
    if (!health) return;
    setLoading(true);
    const target = health.provider.id === 'sqlite-edge-cache' ? 'live-fhir-api' : 'sqlite-edge-cache';
    try {
      await switchProvider(target);
      await loadAllData();
    } catch (err) {
      console.error("Provider switch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveConflict = async (conflictId: string, status: string, note: string) => {
    setLoading(true);
    try {
      await resolveConflict(conflictId, 'nurse_reema_02', status, note);
      await loadAllData();
    } catch (err) {
      console.error("Conflict resolution failed:", err);
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
    setLoading(true);

    try {
      const res = await sendChatMessage(text);
      const alexaMsg: ChatMessage = {
        id: `alexa_${Date.now()}`,
        role: 'alexa',
        text: res.speech,
        timestamp: new Date().toISOString(),
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
      <ConflictReviewDrawer
        conflicts={conflicts}
        onResolve={handleResolveConflict}
        loading={loading}
      />

      {/* 4. Task Board (4 Kanban Columns) */}
      <TaskBoard tasks={tasks} />

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
