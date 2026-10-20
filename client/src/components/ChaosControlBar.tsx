import React, { useState } from 'react';
import { Zap, ShieldCheck, RefreshCw, AlertTriangle, Cpu, CheckCircle } from 'lucide-react';
import { triggerChaos } from '../api.js';

interface Props {
  onRefreshAll: () => Promise<void>;
}

export const ChaosControlBar: React.FC<Props> = ({ onRefreshAll }) => {
  const [chaosStatus, setChaosStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCrash = async () => {
    setLoading(true);
    setChaosStatus("💥 Triggering simulated network drop / tablet crash mid-handoff...");
    try {
      const res = await triggerChaos('crash');
      setChaosStatus(res.message);
      await onRefreshAll();
    } catch (err: any) {
      setChaosStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async () => {
    setLoading(true);
    setChaosStatus("🔄 Reconciling SQLite state and recovering from checkpoint...");
    try {
      const res = await triggerChaos('recover');
      setChaosStatus(res.message);
      await onRefreshAll();
    } catch (err: any) {
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
            Test non-trivial agentic recovery: inject an exception after saved tool results, then restore the durable workflow.
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
            disabled={loading}
            className="btn btn-cyan"
            style={{ fontSize: '0.8rem', padding: '8px 14px' }}
          >
            <ShieldCheck size={15} />
            <span>Resume Saved Workflow</span>
          </button>
        </div>
      </div>

      {chaosStatus && (
        <div style={{
          marginTop: '12px',
          background: chaosStatus.startsWith('Recovered') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
          border: chaosStatus.startsWith('Recovered') ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(244, 63, 94, 0.4)',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '0.78rem',
          color: chaosStatus.startsWith('Recovered') ? '#a7f3d0' : '#fecdd3',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {chaosStatus.startsWith('Recovered') ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
          <span>{chaosStatus}</span>
        </div>
      )}
    </div>
  );
};
