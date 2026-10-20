import { db } from "../db/connection.js";
import { CheckpointService } from "./checkpoint.service.js";
import { MutationService } from "./mutation.service.js";
import { sourceVersion } from './source-version.js';

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

export class RecoveryService {
  static reconcileAndResume(workflowRunId: string, idempotencyKey: string): RecoveryPlan {
    const run = db.prepare('SELECT status, initiated_by FROM workflow_runs WHERE id = ?').get(workflowRunId) as
      { status: string; initiated_by: string } | undefined;
    const checkpoint = CheckpointService.getLatestCheckpoint(workflowRunId);
    const empty: RecoveryPlan = { workflowRunId, recoveryStatus: 'CANNOT_RECOVER', resumedFromStepIndex: 0,
      resumedStepName: 'UNKNOWN', alreadyCommittedSteps: [], remainingStepsToExecute: [],
      reconciledState: {}, avoidedDuplicateStepsCount: 0, message: 'No durable checkpoint found. Start a new workflow.' };
    if (!run || !checkpoint) return empty;
    // Reconcile the actual checkpoint and persisted mutation receipts. Do not invent a fixed list of completed steps.
    const checkpoints = CheckpointService.getAllCheckpoints(workflowRunId);
    const state = checkpoint.statePayload;
    const committed = checkpoints.filter(c => c.stepName.startsWith('RESULT:')).map(c => c.stepName.slice(7));
    const pending = state.pendingTool as { toolName?: string; arguments?: Record<string, unknown> } | undefined;
    const key = pending?.arguments?.idempotency_key;
    const receipt = typeof key === 'string'
      ? db.prepare('SELECT response_json FROM operation_receipts WHERE idempotency_key = ?').get(key) : undefined;
    const completed = run.status === 'COMPLETED';
    const next = completed ? 'FINISHED' : pending?.toolName || 'CONTINUE_FROM_SAVED_HISTORY';
    return MutationService.execute('RESUME_WORKFLOW', idempotencyKey, { workflowRunId }, run.initiated_by, () => {
      if (!completed) db.prepare("UPDATE workflow_runs SET status = 'IN_PROGRESS', error_message = NULL WHERE id = ?").run(workflowRunId);
      return { workflowRunId, recoveryStatus: completed ? 'ALREADY_COMPLETED' : 'RECOVERED',
        resumedFromStepIndex: checkpoint.stepIndex + 1, resumedStepName: next,
        alreadyCommittedSteps: committed, remainingStepsToExecute: completed ? [] : [next],
        reconciledState: { ...state, pendingMutationCommitted: Boolean(receipt),
          sourceChanged: typeof state.sourceVersion === 'string' && state.sourceVersion !== sourceVersion() },
        avoidedDuplicateStepsCount: committed.length,
        message: completed ? 'Workflow was already completed; no actions repeated.'
          : `Recovered checkpoint ${checkpoint.id}; ${committed.length} committed tool results restored.` } as RecoveryPlan;
    });
  }
}
