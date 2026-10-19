import { db } from "../db/connection.js";
import { randomUUID } from "crypto";

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
      WHERE c.status = 'UNRESOLVED'
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
      WHERE c.task_id = ?
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
    resolutionNote?: string
  ): string {
    const conflictId = `conf_${randomUUID().slice(0, 8)}`;
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
  }

  static resolveConflict(
    conflictId: string,
    resolvedByNurseId: string,
    finalStatus: 'COMPLETED' | 'IN_PROGRESS' | 'CANCELLED',
    resolutionNote: string
  ): boolean {
    const conflict = db.prepare("SELECT task_id FROM conflicts WHERE id = ?").get(conflictId) as { task_id: string } | undefined;
    if (!conflict) return false;

    db.transaction(() => {
      db.prepare(`
        UPDATE conflicts
        SET status = 'VERIFIED_RESOLVED', resolution_note = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(resolutionNote, resolvedByNurseId, conflictId);

      db.prepare(`
        UPDATE tasks
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(finalStatus, conflict.task_id);

      db.prepare(`
        INSERT INTO task_events (id, task_id, event_type, previous_value, new_value, source, actor_id, metadata)
        VALUES (?, ?, 'CONFLICT_DETECTED', 'FLAGGED_CONFLICT', ?, 'NURSE_OVERRIDE', ?, ?)
      `).run(`evt_res_${randomUUID().slice(0, 6)}`, conflict.task_id, finalStatus, resolvedByNurseId, JSON.stringify({ resolutionNote, resolvedConflictId: conflictId }));
    })();

    return true;
  }
}
