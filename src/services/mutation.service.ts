import { db } from '../db/connection.js';
import { CheckpointService } from './checkpoint.service.js';
import { AuditService } from './audit.service.js';

import { canonicalJson } from './canonical-json.js';

/** Receipt, domain write, checkpoint and audit entry commit in one SQLite transaction. */
export class MutationService {
  static execute<T>(operation: string, key: string, request: unknown, actorId: string, action: () => T): T {
    if (!key?.trim()) throw new Error('idempotency_key is required');
    const requestJson = canonicalJson(request);
    return db.transaction(() => {
      const prior = db.prepare('SELECT * FROM operation_receipts WHERE idempotency_key = ?').get(key) as
        { operation: string; request_json: string; response_json: string } | undefined;
      if (prior) {
        if (prior.operation !== operation || prior.request_json !== requestJson) {
          throw new Error('Idempotency key was already used for a different request');
        }
        return JSON.parse(prior.response_json) as T;
      }
      const response = action();
      const runId = `mutation:${key}`;
      db.prepare(`INSERT INTO workflow_runs (id, workflow_type, initiated_by, status)
        VALUES (?, 'VERIFY_CONFLICTS', ?, 'IN_PROGRESS')`).run(runId, actorId);
      CheckpointService.saveCheckpoint(runId, 1, operation, { request, response }, `mutation-checkpoint:${key}`);
      CheckpointService.completeWorkflowRun(runId);
      db.prepare('INSERT INTO operation_receipts (idempotency_key, operation, request_json, response_json) VALUES (?, ?, ?, ?)')
        .run(key, operation, requestJson, JSON.stringify(response));
      AuditService.log({ actorType: 'NURSE', actorId, action: operation, targetResource: runId,
        outcome: 'SUCCESS', details: { request, response } });
      return response;
    }).immediate();
  }
}
