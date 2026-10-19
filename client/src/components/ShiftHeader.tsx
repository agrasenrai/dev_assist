import React from 'react';
import type { ProviderHealth } from '../types.js';
import { Activity, ShieldCheck, Database, RefreshCw, Clock, ArrowRight } from 'lucide-react';

interface Props {
  health: ProviderHealth | null;
  onRefresh: () => void;
  onToggleProvider: () => void;
  loading: boolean;
}

export const ShiftHeader: React.FC<Props> = ({ health, onRefresh, onToggleProvider, loading }) => {
  const isEdge = health?.provider?.isEdgeCache ?? true;

  return (
    <header className="glass-panel p-4 mb-6">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        {/* Left: Ward & Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(6, 182, 212, 0.4)'
          }}>
            <Activity size={24} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>ShiftWeave</h1>
              <span className="badge badge-routine" style={{ fontSize: '0.65rem' }}>Alexa+ MCP</span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.72rem',
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.1)',
                padding: '2px 8px',
                borderRadius: '9999px',
                fontWeight: 600
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                ICU-B Live
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Autonomous Shift Handoff, Clinical Discrepancy Isolation & Zero-Loss Recovery
            </p>
          </div>
        </div>

        {/* Center: Nurse Handoff Handover */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(15, 23, 42, 0.6)',
          padding: '8px 16px',
          borderRadius: '10px',
          border: '1px solid rgba(56, 189, 248, 0.2)'
        }}>
          <div>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Outgoing (Night)</div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>Seema Patel, RN</div>
          </div>
          <ArrowRight size={16} color="#06b6d4" />
          <div>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Incoming (Morning)</div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#38bdf8' }}>Reema Roy, RN</div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(148, 163, 184, 0.2)', paddingLeft: '12px', marginLeft: '4px' }}>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Shift Window</div>
            <div style={{ fontSize: '0.82rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} color="#06b6d4" /> 07:00 AM Handover
            </div>
          </div>
        </div>

        {/* Right: Hybrid Provider & Sync */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={onToggleProvider}
            title="Click to toggle between SQLite Microsecond Edge Cache and Live FHIR REST API"
            className="btn btn-outline"
            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
          >
            <Database size={14} color={isEdge ? "#06b6d4" : "#10b981"} />
            <span>
              {isEdge ? 'SQLite Edge Cache (~0.1ms)' : 'Live FHIR API (Epic R4)'}
            </span>
          </button>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="btn btn-outline"
            style={{ padding: '6px 10px' }}
            title="Refresh Hospital State"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
    </header>
  );
};
