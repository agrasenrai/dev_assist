import { db } from "../db/connection.js";
import type { IEHRProvider, Patient, Task, TaskEvent, TaskStatus } from "./types.js";
import { MutationService } from "../services/mutation.service.js";
import { randomUUID } from "crypto";

export class SQLiteCacheProvider implements IEHRProvider {
  readonly providerId = "sqlite-edge-cache";
  readonly providerName = "ShiftWeave Local SQLite Edge Cache";
  readonly isEdgeCache = true;

  async ping(): Promise<boolean> {
    try {
      const result = db.prepare("SELECT 1 AS alive").get() as { alive: number };
      return result?.alive === 1;
    } catch {
      return false;
    }
  }

  async getPatientsByUnit(unitId: string): Promise<Patient[]> {
    const query = `
      SELECT DISTINCT p.id, p.mrn, p.full_name AS fullName, p.room_number AS roomNumber,
             p.bed_number AS bedNumber, p.admission_date AS admissionDate,
             p.acuity_level AS acuityLevel, p.allergies, p.primary_diagnosis AS primaryDiagnosis,
             p.created_at AS createdAt
      FROM patients p
      JOIN tasks t ON t.patient_id = p.id
      JOIN task_assignments ta ON ta.task_id = t.id
      JOIN shifts s ON s.id = ta.shift_id
      WHERE s.unit_id = ?
      ORDER BY p.room_number ASC
    `;
    const rows = db.prepare(query).all(unitId) as Patient[];
    return rows;
  }

  async getTasksForNurse(nurseId: string, shiftId: string): Promise<Task[]> {
    const query = `
      SELECT t.id, t.patient_id AS patientId, p.full_name AS patientName, p.room_number AS roomNumber,
             t.title, t.description, t.category, t.status, t.priority,
             t.scheduled_time AS scheduledTime, t.completed_time AS completedTime,
             t.source_system AS sourceSystem, ta.transfer_status AS transferStatus,
             ta.nurse_id AS assignedNurseId, t.created_at AS createdAt, t.updated_at AS updatedAt
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
      JOIN patients p ON p.id = t.patient_id
      WHERE ta.nurse_id = ? AND ta.shift_id = ? AND ta.transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')
      ORDER BY t.scheduled_time ASC
    `;
    return db.prepare(query).all(nurseId, shiftId) as Task[];
  }

  async getTaskDetails(taskId: string): Promise<{ task: Task; patient?: Patient; recentEvents: TaskEvent[] } | null> {
    const taskQuery = `
      SELECT t.id, t.patient_id AS patientId, p.full_name AS patientName, p.room_number AS roomNumber,
             t.title, t.description, t.category, t.status, t.priority,
             t.scheduled_time AS scheduledTime, t.completed_time AS completedTime,
             t.source_system AS sourceSystem, ta.transfer_status AS transferStatus,
             ta.nurse_id AS assignedNurseId, t.created_at AS createdAt, t.updated_at AS updatedAt
      FROM tasks t
      JOIN patients p ON p.id = t.patient_id
      LEFT JOIN task_assignments ta ON ta.task_id = t.id
      WHERE t.id = ?
      LIMIT 1
    `;
    const task = db.prepare(taskQuery).get(taskId) as Task | undefined;
    if (!task) return null;

    const patient = db.prepare(`
      SELECT id, mrn, full_name AS fullName, room_number AS roomNumber,
             bed_number AS bedNumber, admission_date AS admissionDate,
             acuity_level AS acuityLevel, allergies, primary_diagnosis AS primaryDiagnosis
      FROM patients WHERE id = ?
    `).get(task.patientId) as Patient | undefined;

    const events = db.prepare(`
      SELECT id, task_id AS taskId, event_type AS eventType, previous_value AS previousValue,
             new_value AS newValue, source, actor_id AS actorId,
             idempotency_key AS idempotencyKey, timestamp, metadata
      FROM task_events
      WHERE task_id = ?
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(taskId) as TaskEvent[];

    return { task, ...(patient ? { patient } : {}), recentEvents: events };
  }

  async getRecentEvents(since: Date): Promise<TaskEvent[]> {
    const query = `
      SELECT id, task_id AS taskId, event_type AS eventType, previous_value AS previousValue,
             new_value AS newValue, source, actor_id AS actorId,
             idempotency_key AS idempotencyKey, timestamp, metadata
      FROM task_events
      WHERE datetime(timestamp) >= datetime(?)
      ORDER BY timestamp DESC
    `;
    return db.prepare(query).all(since.toISOString()) as TaskEvent[];
  }

  async updateTaskStatus(
    taskId: string,
    newStatus: TaskStatus,
    actorId: string,
    idempotencyKey: string,
    note?: string
  ): Promise<{ success: boolean; committedVersion: string }> {
    return MutationService.execute('UPDATE_LOCAL_TASK', idempotencyKey,
      { taskId, newStatus, actorId, note }, actorId, () => {
        const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string } | undefined;
        if (!task) throw new Error('Task not found');
        if (!db.prepare('SELECT id FROM nurses WHERE id = ?').get(actorId)) throw new Error('Unknown nurse');
        if (!['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(newStatus)) throw new Error('Invalid local task transition');
        if (db.prepare("SELECT id FROM conflicts WHERE task_id = ? AND status = 'UNRESOLVED'").get(taskId)) {
          throw new Error('Resolve conflicting documentation through human review first');
        }
        const id = randomUUID();
        db.prepare('UPDATE tasks SET status = ?, completed_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(newStatus, newStatus === 'COMPLETED' ? new Date().toISOString() : null, taskId);
        db.prepare(`INSERT INTO task_events (id, task_id, event_type, previous_value, new_value, source, actor_id, idempotency_key, metadata)
          VALUES (?, ?, 'STATUS_TRANSITION', ?, ?, 'HUMAN_LOCAL_WORKFLOW', ?, ?, ?)`)
          .run(id, taskId, task.status, newStatus, actorId, idempotencyKey, JSON.stringify({ note }));
        return { success: true, committedVersion: id };
      });
  }
}
