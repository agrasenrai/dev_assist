import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';
import { MutationService } from './mutation.service.js';
import type { EpicClinicalContext } from '../providers/epic-mapping.service.js';
import { FieldAuthorityService, FIELD_AUTHORITY_MATRIX } from './field-authority.service.js';

export interface HandoffDraftInput {
  outgoing_nurse_id: string; incoming_nurse_id: string; shift_id: string;
  summary_markdown: string; carried_forward_task_ids: string[]; idempotency_key: string;
  epic_clinical_context?: EpicClinicalContext[] | undefined;
}
export class HandoffService {
  static finalize(handoffId: string, nurseId: string, key: string, humanConfirmed: boolean) {
    if (!humanConfirmed) throw new Error('Human review confirmation is required');
    return MutationService.execute('FINALIZE_HANDOFF', key, { handoffId, nurseId }, nurseId, () => {
      const handoff = db.prepare('SELECT * FROM handoffs WHERE id = ? AND incoming_nurse_id = ?').get(handoffId, nurseId) as
        { data_snapshot: string; shift_id: string; status: string } | undefined;
      if (!handoff || handoff.status === 'FINALIZED') throw new Error('Reviewable handoff for this nurse is required');
      const snapshot = JSON.parse(handoff.data_snapshot) as { carriedForwardIds: string[]; tasks: Array<{ id: string }> };
      for (const task of snapshot.tasks) {
        if (db.prepare("SELECT id FROM conflicts WHERE task_id = ? AND status = 'UNRESOLVED'").get(task.id)) {
          throw new Error('Unresolved discrepancies prevent final sign-off');
        }
      }
      for (const taskId of snapshot.carriedForwardIds) {
        if (!db.prepare(`SELECT id FROM task_assignments WHERE task_id = ? AND nurse_id = ? AND shift_id = ?
          AND transfer_status = 'ACTIVE'`).get(taskId, nurseId, handoff.shift_id)) throw new Error('Accept candidate task custody before sign-off');
      }
      db.prepare("UPDATE handoffs SET status = 'FINALIZED', acknowledged_at = CURRENT_TIMESTAMP WHERE id = ?").run(handoffId);
      return { handoffId, status: 'FINALIZED', externalSync: 'NOT_REQUESTED' };
    });
  }

  static createDraft(args: HandoffDraftInput) {
    return MutationService.execute('CREATE_HANDOFF_DRAFT', args.idempotency_key,
      { ...args, idempotency_key: undefined }, args.incoming_nurse_id, () => {
        for (const id of [args.outgoing_nurse_id, args.incoming_nurse_id]) {
          if (!db.prepare('SELECT id FROM nurses WHERE id = ?').get(id)) throw new Error('Unknown nurse');
        }
        const tasks = db.prepare(`SELECT t.*, p.full_name AS patientName, p.room_number AS roomNumber FROM tasks t
          JOIN patients p ON p.id = t.patient_id JOIN task_assignments a ON a.task_id = t.id
          WHERE a.nurse_id = ? AND a.shift_id = ? AND a.transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')`)
          .all(args.outgoing_nurse_id, args.shift_id) as Array<{ id: string; status: string; title: string; patientName: string; roomNumber: string }>;
        for (const id of args.carried_forward_task_ids) {
          if (!tasks.some(t => t.id === id && !['COMPLETED', 'CANCELLED'].includes(t.status))) {
            throw new Error('Carry-forward candidate is not unfinished work assigned to this nurse/shift');
          }
        }
        const ids = tasks.map(t => t.id);
        const conflicts = db.prepare("SELECT task_id FROM conflicts WHERE status = 'UNRESOLVED'").all() as Array<{ task_id: string }>;
        const unresolved = conflicts.filter(c => ids.includes(c.task_id)).length;
        const id = `handoff_${randomUUID()}`;
        const outgoingNurse = db.prepare('SELECT full_name, department FROM nurses WHERE id = ?').get(args.outgoing_nurse_id) as { full_name: string; department: string } | undefined;
        const incomingNurse = db.prepare('SELECT full_name FROM nurses WHERE id = ?').get(args.incoming_nurse_id) as { full_name: string } | undefined;

        let summary = args.summary_markdown;
        if (!summary || (args.epic_clinical_context && args.epic_clinical_context.length > 0)) {
          if (args.epic_clinical_context && args.epic_clinical_context.length > 0) {
            summary = FieldAuthorityService.buildIntegratedHandoffNarrative({
              outgoingNurseName: outgoingNurse?.full_name || args.outgoing_nurse_id,
              incomingNurseName: incomingNurse?.full_name || args.incoming_nurse_id,
              shiftUnit: outgoingNurse?.department || 'Clinical Unit',
              tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, priority: 'ROUTINE', patientName: t.patientName, roomNumber: t.roomNumber })),
              carriedForwardIds: args.carried_forward_task_ids,
              unresolvedConflictsCount: unresolved,
              epicContext: args.epic_clinical_context,
            });
          } else {
            summary = `## Situation\n${tasks.length} assigned workflow tasks.\n\n## Background\nSource: local recorded task/assignment data.\n\n## Recorded workflow state\n` +
              tasks.map(task => `- ${task.patientName} (${task.roomNumber}): ${task.title} — ${task.status}`).join('\n') +
              `\n\n## Workflow follow-up\n${unresolved} unresolved documentation discrepancies. Human review and explicit custody acceptance required. No clinical recommendations generated.`;
          }
        }

        const snapshotData = {
          tasks,
          carriedForwardIds: args.carried_forward_task_ids,
          ...(args.epic_clinical_context && args.epic_clinical_context.length > 0 ? {
            epicClinicalContext: args.epic_clinical_context,
            fieldAuthority: FIELD_AUTHORITY_MATRIX,
          } : {})
        };

        // Drafting proposes candidates only. Human acceptance performs the actual custody transfer.
        db.prepare(`INSERT INTO handoffs (id, shift_id, outgoing_nurse_id, incoming_nurse_id,
          summary_markdown, data_snapshot, unresolved_conflicts_count) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, args.shift_id, args.outgoing_nurse_id, args.incoming_nurse_id, summary,
            JSON.stringify(snapshotData), unresolved);
        return { handoff_id: id, status: 'DRAFT', carried_forward_count: args.carried_forward_task_ids.length,
          unresolved_conflicts_count: unresolved, requires_review: true, external_sync: 'NOT_REQUESTED' };
      });
  }

  static acknowledge(args: { task_id: string; nurse_id: string; action: string; resolution_note?: string | undefined;
    idempotency_key: string; handoff_id?: string | undefined; human_confirmed: boolean }) {
    if (!args.human_confirmed) throw new Error('Explicit human confirmation is required');
    return MutationService.execute('ACKNOWLEDGE_TASK', args.idempotency_key, args, args.nurse_id, () => {
      const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(args.task_id) as { status: string } | undefined;
      if (!task) throw new Error('Task not found');
      if (!db.prepare('SELECT id FROM nurses WHERE id = ?').get(args.nurse_id)) throw new Error('Unknown nurse');
      if (args.action === 'RESOLVE_CONFLICT') throw new Error('Use conflict review with an explicit final status and verification note');
      if (args.action === 'ACCEPT_HANDOFF') {
        const handoff = db.prepare('SELECT * FROM handoffs WHERE id = ? AND incoming_nurse_id = ?').get(args.handoff_id, args.nurse_id) as
          { shift_id: string; outgoing_nurse_id: string; data_snapshot: string; status: string } | undefined;
        if (!handoff || handoff.status === 'FINALIZED') throw new Error('Reviewable handoff for this nurse is required');
        if (!(JSON.parse(handoff.data_snapshot).carriedForwardIds as string[]).includes(args.task_id)) throw new Error('Task is not a handoff candidate');
        if (db.prepare("SELECT id FROM conflicts WHERE task_id = ? AND status = 'UNRESOLVED'").get(args.task_id)) throw new Error('Resolve discrepancy before accepting custody');
        const source = db.prepare(`SELECT id FROM task_assignments WHERE task_id = ? AND nurse_id = ? AND shift_id = ?
          AND transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')`).get(args.task_id, handoff.outgoing_nurse_id, handoff.shift_id) as { id: string } | undefined;
        if (!source) throw new Error('Task custody has changed; refresh the handoff');
        db.prepare("UPDATE task_assignments SET transfer_status = 'TRANSFERRED' WHERE task_id = ? AND nurse_id = ? AND shift_id = ? AND transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')").run(args.task_id, handoff.outgoing_nurse_id, handoff.shift_id);
        db.prepare(`INSERT INTO task_assignments (id, task_id, nurse_id, shift_id, assigned_by)
          VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), args.task_id, args.nurse_id, handoff.shift_id, args.nurse_id);
        db.prepare("UPDATE handoffs SET status = 'UNDER_REVIEW' WHERE id = ?").run(args.handoff_id);
      } else if (args.action !== 'FLAG_FOR_SUPERVISOR') throw new Error('Unsupported acknowledgement');
      else if (!args.resolution_note?.trim()) throw new Error('Escalation requires a note');
      db.prepare(`INSERT INTO task_events (id, task_id, event_type, previous_value, new_value, source, actor_id, idempotency_key, metadata)
        VALUES (?, ?, ?, ?, ?, 'HUMAN_WORKFLOW', ?, ?, ?)`)
        .run(randomUUID(), args.task_id, args.action === 'ACCEPT_HANDOFF' ? 'REASSIGNMENT' : 'NOTE_ADDED',
          task.status, args.action === 'ACCEPT_HANDOFF' ? args.nurse_id : 'FLAGGED_FOR_SUPERVISOR',
          args.nurse_id, args.idempotency_key, JSON.stringify({ note: args.resolution_note }));
      return { task_id: args.task_id, action: args.action, status: task.status, external_sync: 'NOT_REQUESTED' };
    });
  }
}
