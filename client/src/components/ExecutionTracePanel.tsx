import React from 'react';
import type { AuditLogItem } from '../types.js';
import { Terminal, Check, X, ShieldAlert, Cpu, Server, User } from 'lucide-react';

interface Props {
  logs: AuditLogItem[];
}

export const ExecutionTracePanel: React.FC<Props> = ({ logs }) => {
  const getActorIcon = (actorType: string) => {
    switch (actorType) {
      case 'AGENT':
        return <Cpu size={13} color="#38bdf8" />;
      case 'MCP_SERVER':
        return <Server size={13} color="#06b6d4" />;
      case 'NURSE':
        return <User size={13} color="#10b981" />;
      default:
        return <Terminal size={13} color="#94a3b8" />;
    }
  };

  const getOutcomeBadge = (outcome: string) => {
    if (outcome === 'SUCCESS') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          color: '#34d399',
          fontSize: '0.68rem',
          fontWeight: 700
        }}>
          <Check size={11} /> SUCCESS
        </span>
      );
    }
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        color: '#f87171',
        fontSize: '0.68rem',
        fontWeight: 700
      }}>
        <X size={11} /> {outcome}
      </span>
    );
  };

  return (
    <div className="glass-panel p-4" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(148, 163, 184, 0.15)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={18} color="#06b6d4" />
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
            Observable Execution Trace
          </h3>
          <span style={{
            fontSize: '0.68rem',
            background: 'rgba(6, 182, 212, 0.15)',
            color: '#38bdf8',
            padding: '2px 6px',
            borderRadius: '6px',
            fontWeight: 600
          }}>
            MCP Telemetry
          </span>
        </div>
        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
          Real-time Audit Log
        </span>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        maxHeight: '380px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        paddingRight: '4px'
      }}>
        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.8rem', padding: '24px 0' }}>
            Awaiting MCP tool invocation...
          </div>
        ) : (
          logs.map(log => (
            <div
              key={log.id}
              style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '0.75rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {getActorIcon(log.actorType)}
                  <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{log.actorType}</span>
                  <span style={{ color: '#64748b' }}>•</span>
                  <span className="code-font" style={{ color: '#38bdf8', fontWeight: 600 }}>{log.action}</span>
                </div>
                {getOutcomeBadge(log.outcome)}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.7rem' }}>
                <span className="code-font" style={{ color: '#94a3b8' }}>
                  {log.targetResource}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    color: log.latencyMs < 10 ? '#34d399' : '#f59e0b',
                    fontWeight: 700
                  }}>
                    {log.latencyMs}ms
                  </span>
                  <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
