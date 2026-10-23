import { db } from "../db/connection.js";
import { randomUUID } from "crypto";
import { MutationService } from './mutation.service.js';
import { taskScope, scopeToolArguments } from './source-policy.js';

export interface ConflictRecord {
  id: string;
  taskId: string;
  taskTitle?: string;
  patientRoom?: string;
  patientName?: string;
  conflictType: 'STATUS_MISMATCH' | 'DUPLICATE_ORDER' | 'STALE_DATA' | 'UNASSIGNED_CARRIED_FORWARD';
  systemAName: string;
  systemAVal: string;
  systemBName: string;
  systemBVal: string;
  status: 'UNRESOLVED' | 'VERIFIED_RESOLVED' | 'DISMISSED';
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  detectedAt: string;
}

export class ConflictService {
  static getUnresolvedConflicts(): ConflictRecord[] {
    const query = `
      SELECT c.id, c.task_id AS taskId, t.title AS taskTitle,
             p.room_number AS patientRoom, p.full_name AS patientName,
             c.conflict_type AS conflictType, c.system_a_name AS systemAName,
             c.system_a_val AS systemAVal, c.system_b_name AS systemBName,
             c.system_b_val AS systemBVal, c.status, c.resolution_note AS resolutionNote,
             c.resolved_by AS resolvedBy, c.resolved_at AS resolvedAt,
             c.detected_at AS detectedAt
      FROM conflicts c
      JOIN tasks t ON t.id = c.task_id
      JOIN patients p ON p.id = t.patient_id
      WHERE c.status = 'UNRESOLVED' AND ${taskScope('t')}
      ORDER BY c.detected_at DESC
    `;
    return db.prepare(query).all() as ConflictRecord[];
  }

  static getConflictByTaskId(taskId: string): ConflictRecord | null {
    const query = `
      SELECT c.id, c.task_id AS taskId, t.title AS taskTitle,
             p.room_number AS patientRoom, p.full_name AS patientName,
             c.conflict_type AS conflictType, c.system_a_name AS systemAName,
             c.system_a_val AS systemAVal, c.system_b_name AS systemBName,
             c.system_b_val AS systemBVal, c.status, c.resolution_note AS resolutionNote,
             c.resolved_by AS resolvedBy, c.resolved_at AS resolvedAt,
             c.detected_at AS detectedAt
      FROM conflicts c
      JOIN tasks t ON t.id = c.task_id
      JOIN patients p ON p.id = t.patient_id
      WHERE c.task_id = ? AND c.status = 'UNRESOLVED' AND ${taskScope('t')}
      LIMIT 1
    `;
    const row = db.prepare(query).get(taskId) as ConflictRecord | undefined;
    return row || null;
  }

  static flagConflict(
    taskId: string,
    conflictType: 'STATUS_MISMATCH' | 'DUPLICATE_ORDER' | 'STALE_DATA' | 'UNASSIGNED_CARRIED_FORWARD',
    systemAName: string,
    systemAVal: string,
    systemBName: string,
    systemBVal: string,
    resolutionNote: string | undefined,
    idempotencyKey: string
  ): string {
    return MutationService.execute('FLAG_CONFLICT', idempotencyKey,
      { taskId, conflictType, systemAName, systemAVal, systemBName, systemBVal, resolutionNote }, 'SYSTEM', () => {
    const conflictId = `conf_${randomUUID()}`;
    db.transaction(() => {
      db.prepare(`
        INSERT INTO conflicts (id, task_id, conflict_type, system_a_name, system_a_val, system_b_name, system_b_val, status, resolution_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'UNRESOLVED', ?)
      `).run(conflictId, taskId, conflictType, systemAName, systemAVal, systemBName, systemBVal, resolutionNote || null);

      db.prepare(`
        UPDATE tasks SET status = 'FLAGGED_CONFLICT', updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(taskId);
    })();
    return conflictId;
    });
  }

  static resolveConflict(
    conflictId: string,
    resolvedByNurseId: string,
    finalStatus: 'COMPLETED' | 'IN_PROGRESS' | 'CANCELLED',
    resolutionNote: string,
    idempotencyKey: string
  ): boolean {
    if (!resolutionNote?.trim()) throw new Error('A bedside verification note is required');
    if (!['COMPLETED', 'IN_PROGRESS', 'CANCELLED'].includes(finalStatus)) throw new Error('Invalid final status');
    scopeToolArguments('resolve_conflict',{nurse_id:resolvedByNurseId});
    return MutationService.execute('RESOLVE_CONFLICT', idempotencyKey,
      { conflictId, resolvedByNurseId, finalStatus, resolutionNote }, resolvedByNurseId, () => {
    const conflict = db.prepare(`SELECT c.task_id, c.status FROM conflicts c JOIN tasks t ON t.id=c.task_id WHERE c.id = ? AND ${taskScope('t')}`).get(conflictId) as { task_id: string; status: string } | undefined;
    if (!conflict) return false;
    if (conflict.status !== 'UNRESOLVED') throw new Error('Conflict is already resolved; refresh current state');
    const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(conflict.task_id) as { status: string };

    db.transaction(() => {
      db.prepare(`
        UPDATE conflicts
        SET status = 'VERIFIED_RESOLVED', resolution_note = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(resolutionNote, resolvedByNurseId, conflictId);

      db.prepare(`
        UPDATE tasks
        SET status = ?, completed_time = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(finalStatus, finalStatus === 'COMPLETED' ? new Date().toISOString() : null, conflict.task_id);

      db.prepare(`
        INSERT INTO task_events (id, task_id, event_type, previous_value, new_value, source, actor_id, idempotency_key, metadata)
        VALUES (?, ?, 'STATUS_TRANSITION', ?, ?, 'NURSE_OVERRIDE', ?, ?, ?)
      `).run(randomUUID(), conflict.task_id, task.status, finalStatus, resolvedByNurseId, idempotencyKey, JSON.stringify({ resolutionNote, resolvedConflictId: conflictId }));
    })();

    return true;
    });
  }
}
