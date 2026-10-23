import React, { useState } from 'react';
import { Zap, ShieldCheck, RefreshCw, AlertTriangle, Cpu, CheckCircle } from 'lucide-react';
import { savedChaosRunId, triggerChaos } from '../api.js';

interface Props {
  onRefreshAll: () => Promise<void>;
}

export const ChaosControlBar: React.FC<Props> = ({ onRefreshAll }) => {
  const [chaosStatus, setChaosStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canResume, setCanResume] = useState(()=>Boolean(savedChaosRunId()));
  const [outcome, setOutcome] = useState<'WORKING'|'INTERRUPTED'|'RECOVERED'|'ERROR'>('WORKING');
  const feedback={WORKING:{background:'rgba(56, 189, 248, 0.12)',border:'#38bdf866',color:'#bae6fd'},
    INTERRUPTED:{background:'rgba(245, 158, 11, 0.12)',border:'#f59e0b66',color:'#fde68a'},
    RECOVERED:{background:'rgba(16, 185, 129, 0.15)',border:'#10b98166',color:'#a7f3d0'},
    ERROR:{background:'rgba(244, 63, 94, 0.15)',border:'#f43f5e66',color:'#fecdd3'}}[outcome];

  const handleCrash = async () => {
    setLoading(true);
    setOutcome('WORKING');
    setChaosStatus("💥 Triggering simulated network drop / tablet crash mid-handoff...");
    try {
      const res = await triggerChaos('crash');
      setCanResume(Boolean(res.workflowRunId));setOutcome(res.status);
      setChaosStatus(res.message);
      await onRefreshAll();
    } catch (err: any) {
      setOutcome('ERROR');
      setChaosStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async () => {
    setLoading(true);
    setOutcome('WORKING');
    setChaosStatus("🔄 Reconciling SQLite state and recovering from checkpoint...");
    try {
      const res = await triggerChaos('recover');
      setCanResume(Boolean(res.workflowRunId));setOutcome(res.status);
      setChaosStatus(res.message);
      await onRefreshAll();
    } catch (err: any) {
      setOutcome('ERROR');
      setChaosStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel p-4 mb-6" style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={18} color="#f59e0b" />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
              Hackathon Evaluation & Chaos Recovery Panel
            </h3>
            <span className="badge badge-stat" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fde68a', borderColor: '#f59e0b' }}>
              Judge Demo Controls
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>
            First simulate an interruption to save progress, then resume the saved workflow. Your actual Wi-Fi connection stays on.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={handleCrash}
            disabled={loading}
            className="btn btn-danger"
            style={{ fontSize: '0.8rem', padding: '8px 14px' }}
          >
            <AlertTriangle size={15} />
            <span>Simulate Wi-Fi Drop / Crash</span>
          </button>

          <button
            onClick={handleRecover}
            disabled={loading || !canResume}
            className="btn btn-cyan"
            style={{ fontSize: '0.8rem', padding: '8px 14px' }}
          >
            <ShieldCheck size={15} />
            <span>Resume Saved Workflow</span>
          </button>
        </div>
      </div>

      {chaosStatus && (
        <div className="chaos-feedback" data-outcome={outcome} role={outcome==='ERROR'?'alert':'status'} style={{
          marginTop: '12px',
          background: feedback.background,
          border: `1px solid ${feedback.border}`,
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '0.78rem',
          color: feedback.color,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {outcome==='RECOVERED' ? <CheckCircle size={15} /> : outcome==='ERROR' ? <AlertTriangle size={15} /> : outcome==='WORKING' ? <RefreshCw size={15} /> : <ShieldCheck size={15} />}
          <span>{chaosStatus}</span>
        </div>
      )}
    </div>
  );
};
