import { db } from "../db/connection.js";
import { CheckpointService, type CheckpointRecord } from "./checkpoint.service.js";
import { AuditService } from "./audit.service.js";

export interface RecoveryPlan {
  workflowRunId: string;
  recoveryStatus: 'RECOVERED' | 'ALREADY_COMPLETED' | 'CANNOT_RECOVER';
  resumedFromStepIndex: number;
  resumedStepName: string;
  alreadyCommittedSteps: string[];
  remainingStepsToExecute: string[];
  reconciledState: Record<string, unknown>;
  avoidedDuplicateStepsCount: number;
  message: string;
}

const STANDARD_HANDOFF_STEPS = [
  "FETCH_ASSIGNED_TASKS",
  "DETECT_DISCREPANCIES",
  "CALCULATE_HANDOFF_METRICS",
  "CREATE_HANDOFF_DRAFT",
  "NOTIFY_DASHBOARD"
];

export class RecoveryService {
  static reconcileAndResume(workflowRunId: string, idempotencyKey: string): RecoveryPlan {
    const startTime = Date.now();

    // 1. Fetch Workflow Run status
    const run = db.prepare(`
      SELECT id, workflow_type, initiated_by, status, error_message
      FROM workflow_runs
      WHERE id = ?
    `).get(workflowRunId) as { id: string; workflow_type: string; initiated_by: string; status: string; error_message?: string } | undefined;

    if (!run) {
      return {
        workflowRunId,
        recoveryStatus: 'CANNOT_RECOVER',
        resumedFromStepIndex: 0,
        resumedStepName: 'UNKNOWN',
        alreadyCommittedSteps: [],
        remainingStepsToExecute: STANDARD_HANDOFF_STEPS,
        reconciledState: {},
        avoidedDuplicateStepsCount: 0,
        message: `Workflow run ${workflowRunId} not found in database.`
      };
    }

    if (run.status === 'COMPLETED') {
      return {
        workflowRunId,
        recoveryStatus: 'ALREADY_COMPLETED',
        resumedFromStepIndex: STANDARD_HANDOFF_STEPS.length,
        resumedStepName: 'FINISHED',
        alreadyCommittedSteps: STANDARD_HANDOFF_STEPS,
        remainingStepsToExecute: [],
        reconciledState: {},
        avoidedDuplicateStepsCount: STANDARD_HANDOFF_STEPS.length,
        message: `Workflow run ${workflowRunId} is already fully completed.`
      };
    }

    // 2. Fetch all saved checkpoints for this run
    const checkpoints: CheckpointRecord[] = CheckpointService.getAllCheckpoints(workflowRunId);
    const committedStepNames = checkpoints.map(c => c.stepName);
    const lastCheckpoint = checkpoints[checkpoints.length - 1];

    // 3. Determine remaining steps to execute
    const remainingSteps = STANDARD_HANDOFF_STEPS.filter(step => !committedStepNames.includes(step));
    const nextStepIndex = lastCheckpoint ? lastCheckpoint.stepIndex + 1 : 1;
    const nextStepName = remainingSteps[0] || "FINALIZE";

    // 4. Merge state payloads up to the last confirmed checkpoint
    const reconciledState: Record<string, unknown> = {};
    for (const chk of checkpoints) {
      Object.assign(reconciledState, chk.statePayload);
    }

    // 5. Update workflow status to IN_PROGRESS (Reconnected & Resumed)
    db.prepare(`
      UPDATE workflow_runs
      SET status = 'IN_PROGRESS', error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(workflowRunId);

    // 6. Log Recovery Event to Audit Log
    AuditService.log({
      actorType: 'SYSTEM',
      actorId: run.initiated_by,
      action: 'WORKFLOW_INTERRUPTION_RECOVERED',
      targetResource: `workflow_run/${workflowRunId}`,
      outcome: 'RECOVERED',
      details: {
        idempotencyKey,
        resumedFromStep: nextStepName,
        avoidedSteps: committedStepNames,
        remainingSteps
      },
      latencyMs: Date.now() - startTime
    });

    return {
      workflowRunId,
      recoveryStatus: 'RECOVERED',
      resumedFromStepIndex: nextStepIndex,
      resumedStepName: nextStepName,
      alreadyCommittedSteps: committedStepNames,
      remainingStepsToExecute: remainingSteps,
      reconciledState,
      avoidedDuplicateStepsCount: committedStepNames.length,
      message: `Successfully recovered state from Checkpoint #${checkpoints.length} (${lastCheckpoint?.stepName || 'INITIAL'}). Steps [${committedStepNames.join(', ')}] are verified and will NOT be repeated.`
    };
  }
}
