import React from 'react';
import type { ClinicalTask, TaskStatus } from '../types.js';
import { AlertTriangle, CheckCircle2, Clock, AlertCircle, User, Bed } from 'lucide-react';

interface Props {
  tasks: ClinicalTask[];
  onSelectConflictTask?: (taskId: string) => void;
}

export const TaskBoard: React.FC<Props> = ({ tasks, onSelectConflictTask }) => {
  const columns: Array<{ status: TaskStatus; title: string; color: string; icon: any }> = [
    { status: 'FLAGGED_CONFLICT', title: 'Flagged Discrepancy', color: '#f43f5e', icon: AlertTriangle },
    { status: 'PENDING', title: 'Pending Handover', color: '#f59e0b', icon: Clock },
    { status: 'IN_PROGRESS', title: 'In Progress', color: '#38bdf8', icon: AlertCircle },
    { status: 'COMPLETED', title: 'Completed Tasks', color: '#10b981', icon: CheckCircle2 }
  ];

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'STAT':
        return <span className="badge badge-stat">STAT Emergency</span>;
      case 'URGENT':
        return <span className="badge badge-urgent">Urgent</span>;
      default:
        return <span className="badge badge-routine">Routine</span>;
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
      {columns.map(col => {
        const colTasks = tasks.filter(t => t.status === col.status);
        const Icon = col.icon;

        return (
          <div
            key={col.status}
            className={`glass-panel ${col.status === 'FLAGGED_CONFLICT' && colTasks.length > 0 ? 'glass-panel-danger' : ''}`}
            style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}
          >
            {/* Column Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px',
              paddingBottom: '10px',
              borderBottom: '1px solid rgba(148, 163, 184, 0.15)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon size={18} color={col.color} />
                <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: col.color }}>{col.title}</h3>
              </div>
              <span style={{
                background: 'rgba(15, 23, 42, 0.8)',
                color: '#cbd5e1',
                padding: '2px 8px',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                border: '1px solid rgba(148, 163, 184, 0.2)'
              }}>
                {colTasks.length}
              </span>
            </div>

            {/* Task Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: '120px' }}>
              {colTasks.length === 0 ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#64748b',
                  fontSize: '0.8rem',
                  fontStyle: 'italic',
                  padding: '24px 0'
                }}>
                  No tasks in this state
                </div>
              ) : (
                colTasks.map(t => (
                  <div
                    key={t.id}
                    onClick={() => t.status === 'FLAGGED_CONFLICT' && onSelectConflictTask?.(t.id)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.85)',
                      padding: '12px',
                      borderRadius: '10px',
                      border: t.status === 'FLAGGED_CONFLICT' ? '1px solid rgba(244, 63, 94, 0.5)' : '1px solid rgba(148, 163, 184, 0.15)',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                      cursor: t.status === 'FLAGGED_CONFLICT' ? 'pointer' : 'default',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {/* Card Top: Priority & Room */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      {getPriorityBadge(t.priority)}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: '#38bdf8', fontWeight: 600 }}>
                        <Bed size={13} /> {t.roomNumber}
                      </div>
                    </div>

                    {/* Card Title & Desc */}
                    <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>
                      {t.title}
                    </h4>
                    <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '10px', lineHeight: 1.4 }}>
                      {t.description}
                    </p>

                    {/* Card Patient & Assigned Nurse */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.72rem',
                      color: '#64748b',
                      borderTop: '1px solid rgba(148, 163, 184, 0.1)',
                      paddingTop: '8px'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#cbd5e1' }}>
                        <User size={12} /> {t.patientName}
                      </span>
                      <span>
                        {t.status === 'FLAGGED_CONFLICT' ? (
                          <span style={{ color: '#fda4af', fontWeight: 700 }}>Review in Drawer ➔</span>
                        ) : (
                          t.assignedNurseName || 'Unassigned'
                        )}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
