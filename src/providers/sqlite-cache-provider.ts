import { db } from "../db/connection.js";
import type { IEHRProvider, Patient, Task, TaskEvent, TaskStatus } from "./types.js";
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
    if (rows.length === 0) {
      // Fallback: return all patients in database if not joined
      return db.prepare(`
        SELECT id, mrn, full_name AS fullName, room_number AS roomNumber,
               bed_number AS bedNumber, admission_date AS admissionDate,
               acuity_level AS acuityLevel, allergies, primary_diagnosis AS primaryDiagnosis,
               created_at AS createdAt
        FROM patients
        ORDER BY room_number ASC
      `).all() as Patient[];
    }
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
      WHERE ta.nurse_id = ? AND ta.shift_id = ?
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

    return { task, patient, recentEvents: events };
  }

  async getRecentEvents(since: Date): Promise<TaskEvent[]> {
    const query = `
      SELECT id, task_id AS taskId, event_type AS eventType, previous_value AS previousValue,
             new_value AS newValue, source, actor_id AS actorId,
             idempotency_key AS idempotencyKey, timestamp, metadata
      FROM task_events
      WHERE timestamp >= ?
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
    // 1. Idempotency Check: Did this operation already commit?
    const existingEvent = db.prepare(`
      SELECT id, timestamp FROM task_events WHERE idempotency_key = ?
    `).get(idempotencyKey) as { id: string; timestamp: string } | undefined;

    if (existingEvent) {
      return { success: true, committedVersion: existingEvent.id };
    }

    // 2. Fetch current task state
    const currentTask = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
    if (!currentTask) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const previousStatus = currentTask.status;
    const completedTime = newStatus === "COMPLETED" ? new Date().toISOString() : null;
    const eventId = `evt_${randomUUID().slice(0, 8)}`;

    // 3. Atomic Transaction for State Mutation + Event Audit
    const mutationTx = db.transaction(() => {
      db.prepare(`
        UPDATE tasks
        SET status = ?, completed_time = COALESCE(?, completed_time), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newStatus, completedTime, taskId);

      db.prepare(`
        INSERT INTO task_events (id, task_id, event_type, previous_value, new_value, source, actor_id, idempotency_key, metadata)
        VALUES (?, ?, 'STATUS_TRANSITION', ?, ?, 'NURSE_OVERRIDE', ?, ?, ?)
      `).run(
        eventId,
        taskId,
        previousStatus,
        newStatus,
        actorId,
        idempotencyKey,
        note ? JSON.stringify({ note }) : null
      );
    });

    mutationTx();
    return { success: true, committedVersion: eventId };
  }
}
