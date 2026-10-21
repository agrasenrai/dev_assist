import { createHash } from 'node:crypto';
import { db } from '../db/connection.js';
import { CheckpointService } from './checkpoint.service.js';
import { MutationService } from './mutation.service.js';
import { HandoffService } from './handoff.service.js';
import { ConflictService, type ConflictRecord } from './conflict.service.js';
import { canonicalJson } from './canonical-json.js';
import { getActiveProvider } from '../providers/index.js';

type Nurse = { id: string; name: string; department: string };
type Shift = { id: string; unit: string; type: string; start: string; end: string };
type Task = { id: string; patientName: string; roomNumber: string; title: string; status: string; priority: string; source: string };
type Handoff = { id: string; incomingId: string; outgoingId: string; incomingName: string; outgoingName: string;
  status: string; summary: string; snapshot: string; shiftId: string };
type Pending = { kind: 'RESOLVE' | 'ACCEPT' | 'FINALIZE' | 'ESCALATE'; taskIds: string[];
  handoffId: string | null; conflictId: string | null; finalStatus: 'COMPLETED' | 'IN_PROGRESS' | 'CANCELLED' | null;
  note: string | null; prompt: string; version: string; expiresAt: number; ready: boolean };
type Message = { role: 'nurse' | 'assistant'; text: string };
type State = { revision: number; nurse: Nurse | null; shift: Shift | null; pending: Pending | null;
  selectedTaskId: string | null; selectedHandoffId: string | null; focus: 'tasks' | 'conflicts' | 'handoff';
  messages: Message[]; speech: string };
export type VoiceInput = { session_id: string; utterance: string; expected_revision: number; idempotency_key: string };

const greeting = 'Hello. Say, “Hi, I am Seema. What are my tasks?” to begin your demo session.';
const initial = (): State => ({ revision: 0, nurse: null, shift: null, pending: null, selectedTaskId: null,
  selectedHandoffId: null, focus: 'tasks', messages: [], speech: greeting });
const normal = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const runId = (id: string) => `voice:${id}`;

/** Local demo identity selection, not nurse authentication. All turn writes commit atomically. */
export class VoiceService {
  private static load(id: string): State {
    const state = (CheckpointService.getLatestCheckpoint(runId(id))?.statePayload.voice as State | undefined) || initial();
    // Clear expired confirmations on load so the display is never stale
    if (state.pending && state.pending.expiresAt < Date.now()) {
      state.pending = null;
    }
    return state;
  }

  private static handoffs(state: State): Handoff[] {
    if (!state.nurse || !state.shift) return [];
    return db.prepare(`SELECT h.id, h.incoming_nurse_id AS incomingId, h.outgoing_nurse_id AS outgoingId,
      ni.full_name AS incomingName, no.full_name AS outgoingName, h.status, h.summary_markdown AS summary,
      h.data_snapshot AS snapshot, h.shift_id AS shiftId FROM handoffs h
      JOIN nurses ni ON ni.id = h.incoming_nurse_id JOIN nurses no ON no.id = h.outgoing_nurse_id
      WHERE h.shift_id = ? AND (h.incoming_nurse_id = ? OR h.outgoing_nurse_id = ?) ORDER BY h.rowid DESC`)
      .all(state.shift.id, state.nurse.id, state.nurse.id) as Handoff[];
  }

  private static records(state: State) {
    if (!state.nurse || !state.shift) return { tasks: [] as Task[], candidates: [] as Task[], handoffs: [] as Handoff[], conflicts: [] as ConflictRecord[] };
    const all = db.prepare(`SELECT t.id, p.full_name AS patientName, p.room_number AS roomNumber, t.title,
      t.status, t.priority, t.source_system AS source FROM tasks t JOIN patients p ON p.id = t.patient_id`).all() as Task[];
    const assigned = db.prepare(`SELECT task_id AS id FROM task_assignments WHERE nurse_id = ? AND shift_id = ?
      AND transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')`).all(state.nurse.id, state.shift.id) as Array<{ id: string }>;
    const tasks = all.filter(t => assigned.some(a => a.id === t.id));
    const handoffs = this.handoffs(state);
    const candidateIds = new Set(handoffs.filter(h => h.incomingId === state.nurse!.id && h.status !== 'FINALIZED')
      .flatMap(h => (JSON.parse(h.snapshot).carriedForwardIds as string[]).filter(id =>
        db.prepare(`SELECT id FROM task_assignments WHERE task_id = ? AND nurse_id = ? AND shift_id = ?
          AND transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')`).get(id, h.outgoingId, h.shiftId))));
    const candidates = all.filter(t => candidateIds.has(t.id) && !tasks.some(own => own.id === t.id));
    const visible = new Set([...tasks, ...candidates].map(t => t.id));
    return { tasks, candidates, handoffs, conflicts: ConflictService.getUnresolvedConflicts().filter(c => visible.has(c.taskId)) };
  }

  private static version(state: State) {
    return createHash('sha256').update(canonicalJson(this.records(state))).digest('hex');
  }

  private static display(state: State) {
    const records = this.records(state);
    return { revision: state.revision, nurse: state.nurse, shift: state.shift, speech: state.speech,
      focus: state.focus, selectedTaskId: state.selectedTaskId, selectedHandoffId: state.selectedHandoffId,
      pending: state.pending ? { prompt: state.pending.prompt, ready: state.pending.ready,
        expiresAt: state.pending.expiresAt } : null,
      messages: state.messages, ...records,
      source: 'Local synthetic demo records', identityMode: 'DEMO_NAME_SELECTION',
      updatedAt: new Date().toISOString() };
  }

  static read(sessionId: string) { return this.display(this.load(sessionId)); }

  static turn(input: VoiceInput) {
    if (getActiveProvider().providerId !== 'sqlite-edge-cache') throw new Error('Voice demo requires the local provider; live voice mappings are not configured.');
    // The receipt is checked before revision validation, so a lost response can be retried exactly.
    return MutationService.execute('VOICE_TURN', `voice-turn:${input.idempotency_key}`, input, 'voice-demo', () => {
      const state = this.load(input.session_id);
      if (state.revision !== input.expected_revision) throw new Error('Voice session changed. Refresh before speaking again.');
      const text = input.utterance.trim();
      const normalized = normal(text);
      let speech: string;
      const introduction = text.match(/\b(?:i am|i['’]?m|this is|my name is|switch to)\s+(.+)/i);
      if (introduction) {
        // Never retain an old identity or confirmation after an unknown/ambiguous introduction.
        Object.assign(state, initial(), { revision: state.revision });
        const claimed = normal(introduction[1]!.split(/[,.;!?]|\b(?:and|please|let me|show|tell|what|mere)\b/i)[0]!);
        const matches = this.resolveNurse(claimed);
        if (matches.length !== 1) {
          speech = matches.length ? 'More than one nurse matches. Please say “I am” followed by your full name or badge number.'
            : 'I could not match that name. Please say “I am” followed by your full registered name or badge number.';
        } else {
          state.nurse = matches[0]!;
          state.shift = db.prepare(`SELECT id, unit_id AS unit, shift_type AS type, start_time AS start, end_time AS end
            FROM shifts WHERE unit_id = ? AND status IN ('ACTIVE', 'HANDOFF_IN_PROGRESS')
            ORDER BY start_time DESC LIMIT 1`).get(state.nurse.department) as Shift || null;
          speech = `Hello ${state.nurse.name}. ${state.shift ? this.summary(state) : 'No active demo shift is configured for your unit.'}`;
        }
      } else if (/^(?:alexa )?(?:end (?:my )?session|sign out|log out|goodbye|bye)[.! ]*$/.test(normalized)) {
        Object.assign(state, initial(), { revision: state.revision });
        speech = 'Your session has ended. The display is cleared. Introduce yourself to begin another session.';
      } else if (!state.nurse) {
        speech = greeting;
      } else if (!state.shift) {
        speech = 'No active demo shift is configured for your unit. Ask the demo administrator to configure a shift.';
      } else {
        speech = this.interpret(state, text, input.idempotency_key);
      }
      state.revision++;
      state.speech = speech;
      state.messages = [...state.messages, { role: 'nurse' as const, text }, { role: 'assistant' as const, text: speech }].slice(-30);
      db.prepare(`INSERT OR IGNORE INTO workflow_runs (id, workflow_type, initiated_by, status)
        VALUES (?, 'GENERATE_HANDOFF', ?, 'IN_PROGRESS')`).run(runId(input.session_id), state.nurse?.id || 'voice-demo');
      db.prepare('UPDATE workflow_runs SET initiated_by = ? WHERE id = ?').run(state.nurse?.id || 'voice-demo', runId(input.session_id));
      CheckpointService.saveCheckpoint(runId(input.session_id), state.revision, 'VOICE_TURN', { voice: state }, `voice-state:${input.idempotency_key}`);
      return this.display(state);
    });
  }

  private static resolveNurse(claimed: string): Nurse[] {
    const nurses = db.prepare('SELECT id, full_name AS name, department, badge_number AS badge FROM nurses')
      .all() as Array<Nurse & { badge: string }>;
    return nurses.filter(n => {
      const name = normal(n.name.replace(/,\s*RN$/i, ''));
      return claimed === name || claimed === name.split(' ')[0] || claimed === normal(n.badge);
    }).map(({ id, name, department }) => ({ id, name, department }));
  }

  private static summary(state: State) {
    const r = this.records(state);
    const unfinished = r.tasks.filter(t => !['COMPLETED', 'CANCELLED'].includes(t.status)).length;
    return `You have ${r.tasks.length} assigned tasks, ${unfinished} unfinished, and ${r.conflicts.length} unresolved discrepancies in your current view. ` +
      (r.candidates.length ? `${r.candidates.length} incoming handoff tasks await your explicit acceptance. ` : '') +
      'Your tasks are on the screen. You can ask about a room, review discrepancies, or prepare a handoff.';
  }

  private static selectTask(state: State, text: string, tasks: Task[]): Task | null {
    const normalized = normal(text);
    const matches = tasks.filter(t => {
      const room = normal(t.roomNumber).replace(/^room /, '');
      return normalized.includes(normal(t.id)) || new RegExp(`\\b${room}\\b`).test(normalized) ||
        t.patientName.split(/\s+/).some(n => n.length > 2 && new RegExp(`\\b${normal(n)}\\b`).test(normalized)) ||
        normalized.includes(normal(t.title));
    });
    if (matches.length === 1) return matches[0]!;
    if (!matches.length && /\b(that|this|it|selected)\b/.test(normalized)) return tasks.find(t => t.id === state.selectedTaskId) || null;
    if (!matches.length && tasks.length === 1 && !/\broom\s+\d+/.test(normalized)) return tasks[0]!;
    return null;
  }

  private static stage(state: State, pending: Pending): string {
    state.pending = pending;
    pending.version = this.version(state);
    pending.expiresAt = Date.now() + 5 * 60_000;
    return pending.prompt;
  }

  private static interpret(state: State, raw: string, key: string): string {
    const text = normal(raw);
    if (/^(?:alexa )?(?:cancel|never mind|no|no cancel|stop)$/.test(text)) {
      state.pending = null;
      return 'Cancelled. No pending action will be performed.';
    }
    if (/^(?:alexa )?(?:yes|confirm|yes confirm|confirm it|yes please)$/.test(text)) {
      const pending = state.pending;
      state.pending = null;
      if (!pending?.ready) return 'There is no complete action awaiting confirmation. Please state the action you want.';
      if (pending.expiresAt < Date.now() || pending.version !== this.version(state)) {
        return 'The confirmation expired or the records changed. Please review the current details and request the action again.';
      }
      try {
        // One transaction for multi-task acceptance; failure cannot leave a partially accepted batch.
        return db.transaction(() => {
          const nurseId = state.nurse!.id;
          if (pending.kind === 'RESOLVE') {
            if (!ConflictService.resolveConflict(pending.conflictId!, nurseId, pending.finalStatus!, pending.note!, `${key}:resolve`))
              throw new Error('Discrepancy no longer exists');
            return 'Your review was saved and the local workflow status was updated. This does not record medication administration or publish to Epic.';
          }
          if (pending.kind === 'FINALIZE') {
            HandoffService.finalize(pending.handoffId!, nurseId, `${key}:finalize`, true);
            return 'The reviewed handoff is finalized locally. No external clinical record was published.';
          }
          for (const id of pending.taskIds) HandoffService.acknowledge({ task_id: id, nurse_id: nurseId,
            action: pending.kind === 'ACCEPT' ? 'ACCEPT_HANDOFF' : 'FLAG_FOR_SUPERVISOR', handoff_id: pending.handoffId || undefined,
            resolution_note: pending.note || 'Explicit spoken custody acceptance', human_confirmed: true, idempotency_key: `${key}:${id}` });
          return pending.kind === 'ACCEPT' ? `You accepted custody of ${pending.taskIds.length} task(s). Their completion status is unchanged.`
            : 'Your escalation note was saved locally. No external supervisor notification was sent.';
        })();
      } catch (error) {
        return `The action was not completed: ${error instanceof Error ? error.message : String(error)}. Review the records and request it again.`;
      }
    }
    if (/\b(diagnos\w*|prescrib\w*|recommend.*treatment|change.*dose|increase.*dose|administer)\b/.test(text)) {
      state.pending = null;
      return 'I coordinate nursing workflows only. Diagnosis, treatment, medication administration and order changes require the clinical team.';
    }
    const r = this.records(state);
    const visibleTasks = [...r.tasks, ...r.candidates];
    const selected = this.selectTask(state, raw, visibleTasks);
    const collecting = state.pending && !state.pending.ready ? state.pending : null;
    state.pending = null; // An unrelated turn invalidates a previous confirmation.
    if (/\b(dont|do not|not yet|never)\b/.test(text)) {
      return 'No action taken. Please state the request you want to perform, or say “cancel”.';
    }
    if (/\broom\s+\d+/.test(text) && !selected) {
      return 'That room did not identify exactly one task in your current view. Please specify the patient and full task title shown on screen.';
    }

    if (/\b(resolve|verify)\b/.test(text) || (collecting?.kind === 'RESOLVE' && /\b(completed|in progress|cancelled|canceled|because|note)\b/.test(text))) {
      const task = selected || (collecting ? visibleTasks.find(t => t.id === collecting.taskIds[0]) : null);
      if (!task) return 'Please specify the room or patient whose discrepancy you want to review.';
      state.selectedTaskId = task.id; state.focus = 'conflicts';
      const conflict = r.conflicts.find(c => c.taskId === task.id);
      if (!conflict) return 'No unresolved discrepancy is available for that task.';
      const finalStatus = /\bin progress\b/.test(text) ? 'IN_PROGRESS' : /\bcompleted\b/.test(text) ? 'COMPLETED'
        : /\bcancelled\b|\bcanceled\b/.test(text) ? 'CANCELLED' : collecting?.finalStatus || null;
      const note = raw.match(/\b(?:because|note(?: is)?)[,: ]+(.+)/i)?.[1]?.trim() || collecting?.note || null;
      const ready = Boolean(finalStatus && note);
      return this.stage(state, { kind: 'RESOLVE', taskIds: [task.id], handoffId: null, conflictId: conflict.id,
        finalStatus, note, ready, version: '', expiresAt: 0,
        prompt: ready ? `For ${task.patientName}, ${task.roomNumber}, set local workflow status to ${finalStatus!.replaceAll('_', ' ')} and save your note: “${note}”. Say “confirm” or “cancel”.`
          : `${conflict.systemAName} says ${conflict.systemAVal}; ${conflict.systemBName} says ${conflict.systemBVal}. State your verified local workflow status and note, for example “in progress because I reviewed the source records”.` });
    }
    if (/\b(escalate|supervisor)\b/.test(text) || collecting?.kind === 'ESCALATE') {
      const task = selected || visibleTasks.find(t => t.id === collecting?.taskIds[0]);
      if (!task) return 'Please specify the room or patient to flag for supervisor review.';
      const note = raw.match(/\b(?:because|note(?: is)?)[,: ]+(.+)/i)?.[1]?.trim() || null;
      return this.stage(state, { kind: 'ESCALATE', taskIds: [task.id], handoffId: null, conflictId: null, finalStatus: null,
        note, ready: Boolean(note), version: '', expiresAt: 0, prompt: note
          ? `Save a local escalation for ${task.patientName}, ${task.roomNumber}: “${note}”? Say “confirm” or “cancel”.`
          : 'Please give your escalation reason, beginning with “because”.' });
    }
    if (/\b(prepare|create|generate|draft)\b/.test(text) && /\bhandoff\b/.test(text)) {
      const target = raw.match(/\b(?:for|to)\s+(.+?)[.!?]*$/i)?.[1]?.trim();
      const nurses = target ? this.resolveNurse(normal(target)) : [];
      if (nurses.length !== 1 || nurses[0]!.id === state.nurse!.id) return 'Who should receive the handoff? Say “prepare my handoff for” followed by another nurse’s full name.';
      const receiver = nurses[0]!;
      if (receiver.department !== state.nurse!.department) return 'The receiving nurse must belong to this demo unit.';
      const draft = HandoffService.createDraft({ outgoing_nurse_id: state.nurse!.id, incoming_nurse_id: receiver.id,
        shift_id: state.shift!.id, summary_markdown: '', carried_forward_task_ids: r.tasks.filter(t => !['COMPLETED', 'CANCELLED'].includes(t.status)).map(t => t.id),
        idempotency_key: `${key}:draft` });
      state.selectedHandoffId = draft.handoff_id; state.focus = 'handoff';
      return `Your local handoff draft for ${receiver.name} is ready on the screen. It contains ${draft.carried_forward_count} carry-forward candidates and ${draft.unresolved_conflicts_count} unresolved discrepancies. Custody has not transferred.`;
    }
    if (/\b(accept|finalize|finalise|sign off)\b/.test(text)) {
      const incoming = r.handoffs.filter(h => h.incomingId === state.nurse!.id && h.status !== 'FINALIZED');
      const explicit = incoming.filter(h => text.includes(normal(h.id)));
      const handoff = explicit.length === 1 ? explicit[0] : incoming.find(h => h.id === state.selectedHandoffId) || (incoming.length === 1 ? incoming[0] : undefined);
      if (!handoff) return incoming.length ? 'Several handoffs await review. Say “review handoff” followed by its full ID on the screen.'
        : 'There is no reviewable incoming handoff for you.';
      state.selectedHandoffId = handoff.id; state.focus = 'handoff';
      const finalizing = /\b(finalize|finalise|sign off)\b/.test(text);
      const candidates = r.candidates.filter(t => (JSON.parse(handoff.snapshot).carriedForwardIds as string[]).includes(t.id));
      const taskIds = finalizing ? [] : (selected && candidates.some(t => t.id === selected.id) ? [selected.id] :
        /\b(all|handoff)\b/.test(text) ? candidates.map(t => t.id) : []);
      if (!finalizing && !taskIds.length) return 'Specify an incoming candidate task, or say “accept all handoff tasks”.';
      const labels = taskIds.map(id => candidates.find(t => t.id === id)!).map(t => `${t.title} for ${t.patientName}, ${t.roomNumber}`).join('; ');
      return this.stage(state, { kind: finalizing ? 'FINALIZE' : 'ACCEPT', taskIds, handoffId: handoff.id, conflictId: null,
        finalStatus: null, note: null, ready: true, version: '', expiresAt: 0,
        prompt: finalizing ? `Confirm you reviewed handoff ${handoff.id} from ${handoff.outgoingName} and want to finalize it locally. Say “confirm” or “cancel”.`
          : `Accept custody of ${taskIds.length} task(s) from ${handoff.outgoingName}: ${labels}? Say “confirm” or “cancel”.` });
    }
    if (/\b(handoff|draft)\b/.test(text)) {
      const explicit = r.handoffs.filter(h => text.includes(normal(h.id)));
      const handoff = explicit[0] || r.handoffs.find(h => h.id === state.selectedHandoffId) || (r.handoffs.length === 1 ? r.handoffs[0] : undefined);
      state.focus = 'handoff';
      if (!handoff) return r.handoffs.length ? 'Several handoffs are displayed. Say “review handoff” followed by the full ID.'
        : 'No handoff is available for your session. To create one, say “prepare my handoff for” and the receiving nurse’s name.';
      state.selectedHandoffId = handoff.id;
      return `Handoff from ${handoff.outgoingName} to ${handoff.incomingName} is ${handoff.status}. ${handoff.summary.replace(/#+/g, '').replace(/\n+/g, ' ')}`;
    }
    if (/\b(conflict|conflicts|discrepancy|discrepancies)\b/.test(text)) {
      state.focus = 'conflicts';
      const conflicts = selected ? r.conflicts.filter(c => c.taskId === selected.id) : r.conflicts;
      if (selected) state.selectedTaskId = selected.id;
      return conflicts.length ? conflicts.map(c => `${c.patientName}, ${c.patientRoom}: ${c.systemAName} says ${c.systemAVal}; ${c.systemBName} says ${c.systemBVal}.`).join(' ') +
        ' Human review is required. You can say “resolve discrepancy in room” followed by the room number.'
        : 'No unresolved discrepancy was returned for the requested tasks.';
    }
    if (selected && /\b(room|patient|show|explain|details|that|this|it)\b/.test(text)) {
      state.focus = 'tasks'; state.selectedTaskId = selected.id;
      return `${selected.patientName}, ${selected.roomNumber}: ${selected.title}. Recorded workflow status: ${selected.status.replaceAll('_', ' ')}. Priority: ${selected.priority}.`;
    }
    if (/\b(task|tasks|pending|shift|resume|continue)\b/.test(text)) { state.focus = 'tasks'; return this.summary(state); }
    return 'You can ask for your tasks, explain a room’s task, review discrepancies, prepare a handoff for another nurse, or end your session. Please state one request at a time.';
  }
}
