import { db } from "../db/connection.js";
import { randomUUID } from "crypto";

export interface CheckpointRecord {
  id: string;
  workflowRunId: string;
  stepIndex: number;
  stepName: string;
  statePayload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
}

export class CheckpointService {
  static initWorkflowRun(
    workflowType: 'GENERATE_HANDOFF' | 'RECOVER_INTERRUPTED_SHIFT' | 'VERIFY_CONFLICTS',
    initiatedBy: string
  ): string {
    const runId = `wf_run_${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO workflow_runs (id, workflow_type, initiated_by, status)
      VALUES (?, ?, ?, 'IN_PROGRESS')
    `).run(runId, workflowType, initiatedBy);
    return runId;
  }

  static saveCheckpoint(
    workflowRunId: string,
    stepIndex: number,
    stepName: string,
    statePayload: Record<string, unknown>,
    idempotencyKey: string
  ): CheckpointRecord {
    // 1. Idempotency Check: Did this checkpoint already commit?
    const existing = db.prepare(`
      SELECT id, workflow_run_id AS workflowRunId, step_index AS stepIndex,
             step_name AS stepName, state_payload AS statePayload,
             idempotency_key AS idempotencyKey, created_at AS createdAt
      FROM workflow_checkpoints
      WHERE idempotency_key = ?
    `).get(idempotencyKey) as { id: string; workflowRunId: string; stepIndex: number; stepName: string; statePayload: string; idempotencyKey: string; createdAt: string } | undefined;

    if (existing) {
      return {
        ...existing,
        statePayload: JSON.parse(existing.statePayload)
      };
    }

    const checkpointId = `chk_${randomUUID().slice(0, 8)}`;
    const payloadStr = JSON.stringify(statePayload);

    db.transaction(() => {
      // Ensure workflow_runs record exists to satisfy foreign key constraint
      db.prepare(`
        INSERT OR IGNORE INTO workflow_runs (id, workflow_type, initiated_by, status)
        VALUES (?, 'GENERATE_HANDOFF', 'SYSTEM', 'IN_PROGRESS')
      `).run(workflowRunId);

      db.prepare(`
        INSERT INTO workflow_checkpoints (id, workflow_run_id, step_index, step_name, state_payload, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(checkpointId, workflowRunId, stepIndex, stepName, payloadStr, idempotencyKey);

      db.prepare(`
        UPDATE workflow_runs
        SET status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(workflowRunId);
    })();

    const created = db.prepare(`
      SELECT id, workflow_run_id AS workflowRunId, step_index AS stepIndex,
             step_name AS stepName, state_payload AS statePayload,
             idempotency_key AS idempotencyKey, created_at AS createdAt
      FROM workflow_checkpoints
      WHERE id = ?
    `).get(checkpointId) as { id: string; workflowRunId: string; stepIndex: number; stepName: string; statePayload: string; idempotencyKey: string; createdAt: string };

    return {
      ...created,
      statePayload: JSON.parse(created.statePayload)
    };
  }

  static getLatestCheckpoint(workflowRunId: string): CheckpointRecord | null {
    const row = db.prepare(`
      SELECT id, workflow_run_id AS workflowRunId, step_index AS stepIndex,
             step_name AS stepName, state_payload AS statePayload,
             idempotency_key AS idempotencyKey, created_at AS createdAt
      FROM workflow_checkpoints
      WHERE workflow_run_id = ?
      ORDER BY step_index DESC
      LIMIT 1
    `).get(workflowRunId) as { id: string; workflowRunId: string; stepIndex: number; stepName: string; statePayload: string; idempotencyKey: string; createdAt: string } | undefined;

    if (!row) return null;
    return {
      ...row,
      statePayload: JSON.parse(row.statePayload)
    };
  }

  static getAllCheckpoints(workflowRunId: string): CheckpointRecord[] {
    const rows = db.prepare(`
      SELECT id, workflow_run_id AS workflowRunId, step_index AS stepIndex,
             step_name AS stepName, state_payload AS statePayload,
             idempotency_key AS idempotencyKey, created_at AS createdAt
      FROM workflow_checkpoints
      WHERE workflow_run_id = ?
      ORDER BY step_index ASC
    `).all(workflowRunId) as Array<{ id: string; workflowRunId: string; stepIndex: number; stepName: string; statePayload: string; idempotencyKey: string; createdAt: string }>;

    return rows.map(r => ({
      ...r,
      statePayload: JSON.parse(r.statePayload)
    }));
  }

  static markInterrupted(workflowRunId: string, errorMessage = "Process interrupted unexpectedly"): void {
    db.prepare(`
      UPDATE workflow_runs
      SET status = 'INTERRUPTED', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(errorMessage, workflowRunId);
  }

  static completeWorkflowRun(workflowRunId: string): void {
    db.prepare(`
      UPDATE workflow_runs
      SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(workflowRunId);
  }
}
