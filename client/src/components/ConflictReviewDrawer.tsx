import React, { useState } from 'react';
import type { ConflictItem } from '../types.js';
import { ShieldAlert, CheckCircle, AlertOctagon, UserCheck, MessageSquare, ShieldCheck } from 'lucide-react';

interface Props {
  conflicts: ConflictItem[];
  onResolve: (conflictId: string, status: string, note: string) => Promise<void>;
  loading: boolean;
}

export const ConflictReviewDrawer: React.FC<Props> = ({ conflicts, onResolve, loading }) => {
  const [resolutionNote, setResolutionNote] = useState('');
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);

  const unresolved = conflicts.filter(c => c.status === 'UNRESOLVED');

  if (unresolved.length === 0) {
    return (
      <div className="glass-panel p-4 mb-6" style={{ borderLeft: '4px solid #10b981' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShieldCheck size={20} color="#10b981" />
          <div>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#a7f3d0' }}>
              Zero Active Discrepancies in ICU-B
            </h4>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              All EHR feeds and nurse shift notes are reconciled. Clinical custody transferred cleanly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeConflict = unresolved[0];

  return (
    <div className="glass-panel glass-panel-danger p-5 mb-6" style={{ borderLeft: '4px solid #f43f5e' }}>
      {/* Header with Safety Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: 'rgba(244, 63, 94, 0.2)',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid rgba(244, 63, 94, 0.4)'
          }}>
            <ShieldAlert size={26} color="#f43f5e" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fecdd3' }}>
                Clinical Discrepancy Review Drawer
              </h3>
              <span className="badge badge-stat">Requires Human RN Sign-off</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#fda4af', marginTop: '2px' }}>
              ⚠️ ShiftWeave Safety Boundary: Autonomous clinical changes are strictly prohibited. Nurse verification is mandatory.
            </p>
          </div>
        </div>

        <div style={{
          background: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          padding: '6px 12px',
          borderRadius: '8px',
          fontSize: '0.75rem',
          color: '#cbd5e1'
        }}>
          Detected: <span className="code-font">{new Date(activeConflict.detectedAt).toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Discrepancy Comparison Grid */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.9)',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid rgba(244, 63, 94, 0.2)',
        marginBottom: '16px'
      }}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Flagged Clinical Order</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {activeConflict.taskTitle}
            <span style={{ fontSize: '0.8rem', color: '#38bdf8', fontWeight: 600 }}>({activeConflict.patientRoom} — {activeConflict.patientName})</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          {/* System A Card */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid rgba(56, 189, 248, 0.2)'
          }}>
            <div style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
              System A: {activeConflict.systemAName}
            </div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc', marginTop: '4px' }}>
              {activeConflict.systemAVal}
            </div>
          </div>

          {/* System B Card */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid rgba(245, 158, 11, 0.3)'
          }}>
            <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase' }}>
              System B: {activeConflict.systemBName}
            </div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc', marginTop: '4px' }}>
              {activeConflict.systemBVal}
            </div>
          </div>
        </div>
      </div>

      {/* Human Resolution Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Enter bedside verification note (e.g. 'Physically inspected Room 305 IV line; infusion complete')"
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            style={{
              flex: 1,
              minWidth: '280px',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '8px',
              padding: '8px 14px',
              color: '#f8fafc',
              fontSize: '0.85rem'
            }}
          />

          <button
            onClick={() => onResolve(
              activeConflict.id,
              'COMPLETED',
              resolutionNote || 'Bedside verification confirmed: Infusion completed and verified by RN'
            )}
            disabled={loading}
            className="btn btn-cyan"
            style={{ fontSize: '0.82rem' }}
          >
            <UserCheck size={16} />
            <span>Verify Bedside & Mark Completed</span>
          </button>

          <button
            onClick={() => onResolve(
              activeConflict.id,
              'IN_PROGRESS',
              resolutionNote || 'Verified pending pharmacy delivery. Carried forward to morning shift.'
            )}
            disabled={loading}
            className="btn btn-outline"
            style={{ fontSize: '0.82rem', borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fde68a' }}
          >
            <AlertOctagon size={16} />
            <span>Confirm Pending (Carry Forward)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
