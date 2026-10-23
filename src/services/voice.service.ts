import { createHash } from 'node:crypto';
import { db } from '../db/connection.js';
import { CheckpointService } from './checkpoint.service.js';
import { MutationService } from './mutation.service.js';
import { HandoffService } from './handoff.service.js';
import { ConflictService, type ConflictRecord } from './conflict.service.js';
import { canonicalJson } from './canonical-json.js';
import { getActiveProvider } from '../providers/index.js';
import { EpicWorkflowService } from './epic-workflow.service.js';
import { HospitalService, hospitalEnabled } from './hospital.service.js';
import { sourceRealm } from './source-context.js';
import { taskScope,nurseScope,handoffScope } from './source-policy.js';
import { StaffAuthService } from './staff-auth.service.js';
import { currentStaff, staffAuthRequired } from './staff-context.js';
import { SQLiteCacheProvider } from '../providers/sqlite-cache-provider.js';
import { OperationalSandboxService } from './operational-sandbox.service.js';
import { z } from 'zod';

type Nurse = { id: string; name: string; department: string };
type Shift = { id: string; unit: string; type: string; start: string; end: string };
type Task = { id: string; patientId: string; patientName: string; roomNumber: string; title: string; status: string; priority: string; source: string };
type Handoff = { id: string; incomingId: string; outgoingId: string; incomingName: string; outgoingName: string;
  status: string; summary: string; snapshot: string; shiftId: string };
type Pending = { kind: 'RESOLVE' | 'ACCEPT' | 'FINALIZE' | 'ESCALATE' | 'STATUS' | 'CLAIM'; taskIds: string[];
  handoffId: string | null; conflictId: string | null; finalStatus: 'PENDING' | 'COMPLETED' | 'IN_PROGRESS' | 'CANCELLED' | null;
  taskRevision?: number;
  note: string | null; prompt: string; version: string; expiresAt: number; ready: boolean };
type Message = { role: 'nurse' | 'assistant'; text: string };
type VoiceSource = 'existing' | 'hospital' | 'epic';
type State = { dataSource?: VoiceSource; revision: number; nurse: Nurse | null; shift: Shift | null; pending: Pending | null;
  selectedPatientId?: string | null;
  handoffSourceNurseId?: string | null;
  selectedTaskId: string | null; selectedHandoffId: string | null; focus: 'tasks' | 'conflicts' | 'handoff';
  messages: Message[]; speech: string };
export type VoiceInput = { session_id: string; utterance: string; expected_revision: number; idempotency_key: string };
export const voiceIntentSchema = z.object({
  intent: z.enum(['IDENTIFY','TASKS','TASK','PATIENT','STATUS','CONFLICTS','RESOLVE','ESCALATE','DRAFT','HANDOFF','ACCEPT','FINALIZE','END','SYNC_EPIC','READ_EPIC','AVAILABLE_TASKS','ASSIGN_SELF']),
  nurse_name: z.string().trim().min(1).max(150).optional(),
  recipient_name: z.string().trim().min(1).max(150).optional(),
  source_nurse_name: z.string().trim().min(1).max(150).optional().describe('HANDOFF only: the nurse whose saved handoff is requested, distinct from the current speaker'),
  task_id: z.string().min(1).max(250).optional(),
  task_name: z.string().trim().min(1).max(250).optional().describe('Task title spoken by the user; backend resolves it within the current nurse scope'),
  patient_id: z.string().min(1).max(250).optional(),
  patient_name: z.string().trim().min(1).max(150).optional().describe('Patient name or room spoken by the user; never guess an ID'),
  handoff_id: z.string().min(1).max(250).optional(),
  epic_patient_id: z.string().regex(/^[A-Za-z0-9.-]+$/).max(250).optional(),
  status: z.enum(['PENDING','IN_PROGRESS','COMPLETED','CANCELLED','UNFINISHED','ALL']).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
  detail: z.enum(['SUMMARY','DETAILS','ALLERGIES','DIAGNOSIS','ADMISSION']).optional(),
  all_tasks: z.boolean().optional(),
  continue_request: z.boolean().optional().describe('IDENTIFY only: true when the SAME utterance also contains a workflow/patient request to handle after identification.')
}).strict();
export type VoiceIntent = z.infer<typeof voiceIntentSchema>;

const greeting = 'Before I look up your records, what name should I look for?';
const spokenStatus = (status: string) => status === 'FLAGGED_CONFLICT' ? 'waiting for a discrepancy review' : status.toLowerCase().replaceAll('_', ' ');
const firstName = (name: string) => name.replace(/,\s*RN$/i, '').split(/\s+/)[0];
const initial = (dataSource:VoiceSource = sourceRealm()==='epic'?'epic':!staffAuthRequired() && hospitalEnabled() ? 'hospital' : 'existing'): State => ({ dataSource, revision: 0, nurse: null, shift: null, pending: null, selectedTaskId: null,
  selectedPatientId: null, handoffSourceNurseId: null,
  selectedHandoffId: null, focus: 'tasks', messages: [], speech: staffAuthRequired() && currentStaff()
    ? `Signed in as ${currentStaff()!.name}. Ready for your question.` : 'Ready for your question.' });
const normal = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const hasPhrase = (text: string, value: string) => Boolean(normal(value)) && new RegExp(`(?:^| )${normal(value)}(?: |$)`).test(text);
const runId = (id: string) => `voice:${id}`;

/** Uses authenticated staff identity when enabled; legacy demo selection remains explicit. */
export class VoiceService {
  private static load(id: string): State {
    if (staffAuthRequired()) StaffAuthService.bindVoiceSession(id);
    let state = (CheckpointService.getLatestCheckpoint(runId(id))?.statePayload.voice as State | undefined) || initial();
    if(sourceRealm()==='epic'&&state.dataSource==='hospital')throw new Error('Saved session belongs to the preview source');
    if(staffAuthRequired()&&state.nurse&&state.nurse.id!==currentStaff()?.id)state={...initial(),revision:state.revision};
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
      WHERE h.shift_id = ? AND (h.incoming_nurse_id = ? OR h.outgoing_nurse_id = ?) AND ${handoffScope('h')} ORDER BY h.rowid DESC`)
      .all(state.shift.id, state.nurse.id, state.nurse.id) as Handoff[];
  }

  private static records(state: State) {
    if (!state.nurse || !state.shift) return { tasks: [] as Task[], candidates: [] as Task[], availableTasks: [] as Task[], handoffs: [] as Handoff[], conflicts: [] as ConflictRecord[], epicRecords: [] as ReturnType<typeof EpicWorkflowService.recordsForPatients> };
    const assigned = db.prepare(`SELECT task_id AS id FROM task_assignments WHERE nurse_id = ? AND shift_id = ?
      AND transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')`).all(state.nurse.id, state.shift.id) as Array<{ id: string }>;
    const handoffs = this.handoffs(state);
    const candidateIds = new Set(handoffs.filter(h => h.incomingId === state.nurse!.id && h.status !== 'FINALIZED')
      .flatMap(h => (JSON.parse(h.snapshot).carriedForwardIds as string[]).filter(id =>
        db.prepare(`SELECT id FROM task_assignments WHERE task_id = ? AND nurse_id = ? AND shift_id = ?
          AND transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')`).get(id, h.outgoingId, h.shiftId))));
    const ids=[...new Set([...assigned.map(a=>a.id),...candidateIds])];
    const all = ids.length ? db.prepare(`SELECT t.id, t.patient_id AS patientId, p.full_name AS patientName, p.room_number AS roomNumber, t.title,
      t.status, t.priority, t.source_system AS source FROM tasks t JOIN patients p ON p.id = t.patient_id
      WHERE ${taskScope('t')} AND t.id IN (${ids.map(()=>'?').join(',')})`).all(...ids) as Task[] : [];
    const tasks = all.filter(t => assigned.some(a => a.id === t.id));
    const candidates = all.filter(t => candidateIds.has(t.id) && !tasks.some(own => own.id === t.id));
    const visible = new Set([...tasks, ...candidates].map(t => t.id));
    return { tasks, candidates, availableTasks:state.dataSource==='hospital'?HospitalService.availableTasks(state.nurse.id,state.shift.id):[] as Task[], handoffs, conflicts: ConflictService.getUnresolvedConflicts().filter(c => visible.has(c.taskId)),
      epicRecords: state.dataSource === 'hospital' ? HospitalService.recordsForPatients([...tasks, ...candidates].map(t => t.patientId)) : EpicWorkflowService.recordsForPatients([...tasks, ...candidates].map(t => t.patientId)) };
  }

  private static version(state: State) {
    const records=this.records(state);
    // A successful reread timestamp is not a clinical change. Preserve all actual
    // resource values/versions and failure status for confirmation revalidation.
    const versionRecords=state.dataSource==='hospital'?{...records,epicRecords:records.epicRecords.map(record=>({
      ...record,retrievedAt:undefined,snapshot:{...record.snapshot,retrievedAt:undefined}}))}:records;
    return createHash('sha256').update(canonicalJson({records:versionRecords,notes:staffAuthRequired()?db.prepare('SELECT id,text,recorded_status FROM operational_notes WHERE shift_id=? ORDER BY id').all(state.shift?.id||''):[]})).digest('hex');
  }

  private static display(state: State) {
    const records = this.records(state);
    return { dataSource:state.dataSource || 'existing', revision: state.revision, nurse: state.nurse, shift: state.shift, speech: state.speech,
      availableNurses: !staffAuthRequired()&&state.dataSource==='hospital' ? db.prepare(`SELECT n.id,n.full_name AS name,n.badge_number AS badge,n.department AS unit,
        (SELECT count(*) FROM task_assignments a WHERE a.nurse_id=n.id AND a.transfer_status IN ('ACTIVE','CARRIED_FORWARD')) AS assignedTasks
        FROM nurses n WHERE n.id LIKE 'hospital:%' ORDER BY n.full_name`).all() : [],
      focus: state.focus, selectedTaskId: state.selectedTaskId, selectedHandoffId: state.selectedHandoffId,
      pending: state.pending ? { prompt: state.pending.prompt, ready: state.pending.ready,
        expiresAt: state.pending.expiresAt } : null,
      messages: state.messages, ...records,
      source: state.dataSource === 'hospital' ? 'Synthetic hospital · FHIR R4 records + saved nursing workflow' : state.dataSource === 'epic' ? 'Configured Epic source + saved nursing coordination' : 'Local synthetic demo records', identityMode: staffAuthRequired() ? 'AUTHENTICATED_OPERATIONAL_SANDBOX' : 'DEMO_NAME_SELECTION',
      updatedAt: new Date().toISOString() };
  }

  static read(sessionId: string) { return this.display(this.load(sessionId)); }

  static selectSource(input:{session_id:string;source:VoiceSource;expected_revision:number;idempotency_key:string}) {
    if(sourceRealm()==='preview'&&input.source!=='hospital'||sourceRealm()==='epic'&&input.source==='hospital')throw new Error('Source changes require a new scoped dashboard connection');
    if(staffAuthRequired())throw new Error('Source selection is unavailable in the authenticated staff workspace');
    if(input.source==='hospital'&&(!hospitalEnabled()||!HospitalService.provisioned()))throw new Error('Simulation hospital is not provisioned');
    return MutationService.execute('VOICE_SOURCE',`voice-source:${input.idempotency_key}`,input,'voice-demo',()=>{
      const old=this.load(input.session_id);
      if(old.revision!==input.expected_revision)throw new Error('Voice session changed. Refresh before switching sources.');
      const state=initial(input.source);state.revision=old.revision+1;
      state.speech='Source selected. Ready for your question.';
      db.prepare("INSERT OR IGNORE INTO workflow_runs(id,workflow_type,initiated_by,status) VALUES(?,'GENERATE_HANDOFF','voice-demo','IN_PROGRESS')").run(runId(input.session_id));
      CheckpointService.saveCheckpoint(runId(input.session_id),state.revision,'VOICE_SOURCE_SELECTED',{voice:state},`voice-source-state:${input.idempotency_key}`);
      return this.display(state);
    });
  }

  /** A directory name supplied while reviewing a handoff refers to its source,
   * not a new speaker. Resolve that follow-up against durable context, even if
   * an earlier model reply repeatedly asked the wrong identification question. */
  static handoffNameFollowup(input: VoiceInput) {
    const state=this.load(input.session_id);
    if(!state.nurse||state.focus!=='handoff')return undefined;
    const claimed=normal(this.commandText(input.utterance).replace(/,\s*RN$/i,''));
    const matches=this.resolveNurse(claimed,state);
    if(!matches.length)return undefined;
    if(matches.length>1)return this.saveAssistantTurn(input,'More than one nurse has that name. What’s their full name or badge number?');
    return this.turn(input,`Review handoff from nurse ${matches[0]!.id}`);
  }

  static agentContext(sessionId: string, includeDirectory=true) {
    const state = this.load(sessionId);
    const staff = currentStaff();
    const directory = !includeDirectory ? [] : staffAuthRequired() && staff ? [{name:staff.name}] :
      db.prepare(`SELECT full_name AS name FROM nurses n WHERE ${nurseScope('n')} AND role IN ('STAFF_NURSE','CHARGE_NURSE') AND (CASE WHEN ?='hospital' THEN id LIKE 'hospital:%' ELSE id NOT LIKE 'hospital:%' END) ORDER BY full_name`).all(state.dataSource || 'existing');
    return {dataSource:state.dataSource,revision:state.revision,nurse:state.nurse,shift:state.shift,selectedTaskId:state.selectedTaskId,
      selectedPatientId:state.selectedPatientId,selectedHandoffId:state.selectedHandoffId,handoffSourceNurseId:state.handoffSourceNurseId,pending:state.pending,
      directory,messages:state.messages};
  }

  static agentVersion(sessionId: string) {
    const state=this.load(sessionId),records=this.records(state);
    const ids=[...new Set([...records.tasks,...records.candidates].map(t=>t.patientId).concat(state.selectedPatientId?[state.selectedPatientId]:[]))];
    const patients=ids.length?db.prepare(`SELECT * FROM patients WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).all(...ids):[];
    return createHash('sha256').update(canonicalJson({version:this.version(state),patients})).digest('hex');
  }

  /** The model supplies structured meaning; only the server constructs an executable command. */
  static commandForIntent(input: VoiceInput, value: unknown) {
    const intent = voiceIntentSchema.parse(value);
    const state = this.load(input.session_id);
    const readIntent=['TASKS','TASK','PATIENT','HANDOFF','CONFLICTS','READ_EPIC','AVAILABLE_TASKS'].includes(intent.intent);
    const request=normal(input.utterance.split(/\b(?:because|note is)\b/i)[0]!);
    if(!readIntent&&/\b(?:dont|do not|not yet|never)\b/.test(request)) throw new Error('No changes were made. Could you clarify what you want me to do?');
    if (intent.intent === 'END') return 'End my session';
    const name = (value: string | undefined) => {
      if (!value || /[\n\r,.;!?]/.test(value.replace(/,\s*RN$/i,''))) throw new Error('Please give the nurse’s name or badge number.');
      return value.replace(/,\s*RN$/i,'');
    };
    if (intent.intent === 'IDENTIFY') {
      const claimed=name(intent.nurse_name);
      const spoken=normal(input.utterance);
      const self=spoken.match(/\b(?:i am|im|my name is|this is|switch to) (.+)/)?.[1]?.replace(/^(?:registered )?nurse /,'');
      const candidates=this.resolveNurse(normal(claimed),state);
      const bareSurname=candidates.length===1&&spoken===normal(candidates[0]!.name.replace(/,\s*RN$/i,'')).split(' ').at(-1);
      const matchesSelf=self ? [normal(claimed),normal(firstName(claimed)!)].some(value=>self===value||self.startsWith(`${value} `))
        : hasPhrase(spoken,claimed)||hasPhrase(spoken,firstName(claimed)!)||bareSurname;
      if(!matchesSelf) throw new Error('Please give the nurse’s name or badge number.');
      return `I am ${claimed}`;
    }
    if (!state.nurse) return 'Show my tasks'; // Existing identity gate; never expose records before selection.
    if (!state.shift) return 'Show my tasks';
    const records = this.records(state), visible = [...records.tasks,...records.candidates,...(intent.intent==='ASSIGN_SELF'?records.availableTasks:[])];
    if(intent.task_name&&!intent.task_id){
      const matches=visible.filter(t=>normal(t.title)===normal(intent.task_name!));
      if(matches.length!==1)throw new Error('Which task do you mean? Please give the patient and task title.');
      intent.task_id=matches[0]!.id;
    }
    if(intent.patient_name&&!intent.patient_id){
      const matches=[...new Map(visible.filter(t=>normal(t.patientName)===normal(intent.patient_name!)||normal(t.roomNumber)===normal(intent.patient_name!.replace(/^room\s+/i,'')))
        .map(t=>[t.patientId,t])).values()];
      if(matches.length!==1)throw new Error('I couldn’t find that patient uniquely in your current view. Which patient do you mean?');
      intent.patient_id=matches[0]!.patientId;
    }
    const requestedTask = intent.task_id || (!state.pending?.ready ? state.pending?.taskIds[0] : undefined) || state.selectedTaskId;
    const task = requestedTask ? visible.find(t => t.id === requestedTask) : visible.length === 1 ? visible[0] : undefined;
    if (intent.task_id && !task) throw new Error('That task is outside your current view. Which assigned task do you mean?');
    const requireTask = () => { if (!task) throw new Error('Which task do you mean? Please give the patient and task title.'); return `task ${task.id}`; };
    let patientId = intent.patient_id;
    if (intent.intent === 'PATIENT') patientId ||= state.selectedPatientId || task?.patientId;
    if (patientId && !visible.some(t => t.patientId === patientId)) {
      if (!staffAuthRequired()) throw new Error('I couldn’t find that patient in your current view. Which patient do you mean?');
      OperationalSandboxService.assertPatient(patientId,state.shift.id);
    }
    const patient = patientId ? ` patient ${patientId}` : '';
    const handoffId = intent.handoff_id || state.selectedHandoffId || (records.handoffs.length === 1 ? records.handoffs[0]!.id : undefined);
    if (intent.handoff_id && !records.handoffs.some(h => h.id === handoffId)) throw new Error('That handoff is outside your current view.');
    const handoff = handoffId ? ` handoff ${handoffId}` : ' handoff';
    const status = intent.status && !['ALL','UNFINISHED'].includes(intent.status) ? spokenStatus(intent.status) : '';
    if (intent.note && !normal(input.utterance).includes(normal(intent.note))) throw new Error('What should I write in the review note? I need your own words.');
    const note = intent.note ? ` because ${intent.note}` : '';
    switch (intent.intent) {
      case 'SYNC_EPIC': { if(state.dataSource==='hospital')throw new Error('Use Refresh hospital records for this source. Epic remains separate.'); return 'Sync Epic patients'; }
      case 'READ_EPIC': {
        if(state.dataSource==='hospital')throw new Error('These are synthetic hospital records, not Epic records. Ask about your patient instead.');
        if(!intent.epic_patient_id || !records.epicRecords.some(r=>r.epicPatientId===intent.epic_patient_id)) throw new Error('I couldn’t find that patient in your current view. Which patient do you mean?');
        return `Read Epic patient ${intent.epic_patient_id}`;
      }
      case 'AVAILABLE_TASKS': return 'Show available tasks';
      case 'ASSIGN_SELF': { if(state.dataSource!=='hospital')throw new Error('Self-assignment is supported only for available simulation hospital tasks.'); return task?`Assign task ${task.id} to me`:'Assign an available task to me'; }
      case 'TASKS': return `Show my ${intent.status === 'UNFINISHED' ? 'unfinished' : status} tasks${patient}`;
      case 'TASK': return `${intent.detail === 'DETAILS' ? 'Explain' : 'Show status of'} ${requireTask()}`;
      case 'CONFLICTS': return intent.task_id ? `Explain discrepancy for ${requireTask()}` : 'Show discrepancies';
      case 'PATIENT': return `${intent.detail === 'ALLERGIES' ? 'Show allergies for' : intent.detail === 'DIAGNOSIS' ? 'Show diagnosis for' : intent.detail === 'ADMISSION' ? 'Show admission for' : intent.detail === 'DETAILS' ? 'Show details for' : 'Show latest information about'}${patient || ' my patient'}`;
      case 'STATUS': return `Set ${requireTask()} ${status}${note}`;
      case 'RESOLVE': return `Resolve discrepancy for ${requireTask()} ${status}${note}`;
      case 'ESCALATE': return `Escalate ${requireTask()}${note}`;
      case 'DRAFT': return `Prepare my handoff for ${name(intent.recipient_name)}`;
      case 'HANDOFF': {
        if(intent.source_nurse_name){
          const sources=this.resolveNurse(normal(name(intent.source_nurse_name)),state);
          if(sources.length!==1)throw new Error(sources.length?'More than one nurse has that name. What’s their full name or badge number?':'I couldn’t find that nurse. What’s their full name or badge number?');
          return `Review${handoff} from nurse ${sources[0]!.id}`;
        }
        return `Review${handoff}`;
      }
      case 'ACCEPT': return intent.all_tasks ? `Accept all${handoff} tasks` : `Accept ${requireTask()}${handoff}`;
      case 'FINALIZE': return `Finalize${handoff}`;
    }
  }

  static commandText(utterance: string) {
    return utterance.trim().replace(/^(?:(?:hey|hi+|hello)[\s,.:!?-]+)?medi\b[\s,.:!?-]*/i, '').trim();
  }

  private static introduction(text: string, state: State): string[] | RegExpMatchArray | null {
    const explicit = text.match(/\b(?:my name is|switch to)\s+(.+)/i);
    if (explicit) return explicit;
    const casual = text.match(/^(?:(?:hi+|hello|hey)[,\s.!]+)?(?:i am|i['’]?m|this is)\s+(.+)/i);
    if (casual && !/^(?:just|not|feeling|really|very|so|a|an|the|doing|going|sorry|tired|unwell|sick|upset|sad|happy|fine|okay|ok|here|back|ready|worried|stressed|exhausted)\b/i.test(casual[1]!)) return casual;
    return !state.nurse && this.resolveNurse(normal(text),state).length ? [text,text] : null;
  }

  private static conversationText(state: State, text: string) {
    const normalized = normal(text);
    if (!normalized || this.introduction(text,state)) return false;
    if (/^(?:yes|confirm|yes confirm|confirm it|yes please|cancel|no|stop|never mind|no cancel|end (?:my )?session|sign out|log out|goodbye|bye)$/.test(normalized)) return false;
    if (state.pending && /\b(completed|in progress|cancelled|canceled|pending|because|note)\b/.test(normalized)) return false;
    if (this.reviewNote(text,state.pending)) return false;
    if (/\b(tasks?|patients?|shift|handoff|room|records?|discrepanc\w*|conflicts?|assigned|pending|completed|unfinished|remaining|status|accept|finalize|finalise|escalate|supervisor|resolve|allerg\w*|diagnos\w*|prescrib\w*|dose|treatment|administer)\b/.test(normalized)) return false;
    return true;
  }

  private static reviewNote(text: string, pending: Pending | null) {
    if (!pending || pending.ready || !['RESOLVE','ESCALATE'].includes(pending.kind)) return null;
    // A direct answer to a requested note need not use a scripted "because" prefix.
    if (/^(?:show|what|which|who|how|explain|tell|list|read|sync|prepare|create|accept|finalize|cancel|stop|no|yes|confirm)\b/i.test(text.trim())) return null;
    const note = text.replace(/^\s*(?:in progress|completed|cancelled|canceled)[\s,.:;-]*/i,'').trim();
    return note || null;
  }

  static saveAssistantTurn(input: VoiceInput, speech: string, conversationModel?: {provider: string; status: 'SUCCESS' | 'FAILED'},
    completion?: {fromRevision:number; replaceLast:boolean; preservePending:boolean; replaceTurns?:number}) {
    return MutationService.execute('VOICE_TURN', `voice-turn:${input.idempotency_key}`, input, 'voice-demo', () => {
      const state = this.load(input.session_id);
      if (state.revision !== (completion?.fromRevision ?? input.expected_revision)) throw new Error('Voice session changed. Refresh before speaking again.');
      if (!completion?.preservePending) state.pending = null;
      state.revision++;
      state.speech = speech;
      state.messages = [...(completion?.replaceLast ? state.messages.slice(0,-2*(completion.replaceTurns??1)) : state.messages), { role: 'nurse' as const, text: input.utterance },
        { role: 'assistant' as const, text: speech }].slice(-30);
      CheckpointService.saveCheckpoint(runId(input.session_id), state.revision, 'VOICE_AGENT_RESULT',
        { voice: state, ...(conversationModel ? {conversationModel} : {}) }, `voice-state:${input.idempotency_key}`);
      return this.display(state);
    });
  }

  static turn(input: VoiceInput, interpretedCommand?: string) {
    if (getActiveProvider().providerId !== 'sqlite-edge-cache') throw new Error('Voice demo requires the local provider; live voice mappings are not configured.');
    // The receipt is checked before revision validation, so a lost response can be retried exactly.
    return MutationService.execute('VOICE_TURN', `voice-turn:${input.idempotency_key}`, input, 'voice-demo', () => {
      const state = this.load(input.session_id);
      if (state.revision !== input.expected_revision) throw new Error('Voice session changed. Refresh before speaking again.');
      const spokenText = input.utterance.trim();
      const text = interpretedCommand ?? this.commandText(spokenText);
      const normalized = normal(text);
      let speech: string;
      const introduction = this.introduction(text,state);
      const staff = currentStaff();
      if (staffAuthRequired() && staff && introduction) {
        const requested = normal(introduction[1]!.split(/[,.;!?]|\b(?:and|please|let me|show|tell|what|mere)\b/i)[0]!);
        const allowed = [normal(staff.name),normal(staff.name.replace(/,\s*RN$/i,'')),normal(staff.name).split(' ')[0],normal(staff.username)];
        if (!allowed.includes(requested)) throw new Error('Voice introduction cannot switch authenticated staff identity. Sign out and sign in as the other staff member');
      }
      if (introduction) {
        // Never retain an old identity or confirmation after an unknown/ambiguous introduction.
        Object.assign(state, initial(state.dataSource), { revision: state.revision });
        const claimed = normal(introduction[1]!.split(/[,.;!?]|\b(?:and|please|let me|show|tell|what|mere)\b/i)[0]!);
        const matches = staffAuthRequired() && staff ? [{id:staff.id,name:staff.name,department:staff.unit}] : this.resolveNurse(claimed,state);
        if (matches.length !== 1) {
          speech = matches.length ? 'More than one nurse has that name. What’s your full name or badge number?'
            : 'I couldn’t find that name. What’s your full registered name or badge number?';
        } else {
          state.nurse = matches[0]!;
          state.shift = staffAuthRequired() ? db.prepare(`SELECT s.id,s.unit_id AS unit,s.shift_type AS type,s.start_time AS start,s.end_time AS end FROM shifts s JOIN staff_shift_memberships m ON m.shift_id=s.id
            WHERE m.staff_id=? AND s.status IN ('ACTIVE','HANDOFF_IN_PROGRESS') ORDER BY s.start_time DESC LIMIT 1`).get(staff!.id) as Shift || null : db.prepare(`SELECT id, unit_id AS unit, shift_type AS type, start_time AS start, end_time AS end
            FROM shifts WHERE unit_id = ? AND status IN ('ACTIVE', 'HANDOFF_IN_PROGRESS')
            ORDER BY start_time DESC LIMIT 1`).get(state.nurse.department) as Shift || null;
          speech = `Hi ${firstName(state.nurse.name)}. ` + (state.shift
            ? /\b(tasks?|shift|pending|unfinished|assigned)\b/i.test(text) ? this.summary(state) : 'What can I help you with?'
            : 'I don’t have an active shift for your unit right now.');
        }
      } else if (!text && /\bmedi\b/i.test(spokenText)) {
        speech = "Yes, I'm Medi. I'm listening. Take your time.";
      } else if (/\b(?:diagnos\w*|prescrib\w*|recommend.*treatment|change.*dose|increase.*dose|decrease.*dose|administer.*medication)\b/i.test(normalized)) {
        state.pending = null;
        speech = "I coordinate nursing workflows only. Diagnosis, treatment and medication changes require the clinical team.";
      } else if (/\b(?:politic\w*|election\w*|president\w*|prime minister|democrat\w*|republican\w*|parliament|congress|voting|biden|trump|modi|government policy)\b/i.test(normalized)) {
        state.pending = null;
        speech = "I'm focused purely on hospital nursing workflows and shift handoffs, so I don't engage in political or non-clinical topics. Is there a task or handoff you'd like to check?";
      } else if (/\b(?:codebase|source code|git repo|repository|github|database schema|private key|api key|tokens?|internal tables?|under the hood|show (?:me )?the code)\b/i.test(normalized)) {
        state.pending = null;
        speech = "I'm designed to assist with nursing shift workflows, so I don't discuss internal code or technical credentials. Let's focus on your patients and tasks.";
      } else if (/\b(?:what(?:'s|s| is)? (?:your|ur) name|who (?:are|r) you|what should i call you|tell me (?:your|ur) name|(?:your|ur) name please|what are you called|introduce yourself|who am i speaking with|who is this)\b/i.test(normalized)) {
        state.pending = null;
        speech = "I'm Medi, your nursing workflow assistant for ShiftWeave. I help coordinate ICU shift handoffs, track pending tasks, and review documentation discrepancies.";
      } else if (/\b(?:what is shiftweave|what does shiftweave do|tell me about shiftweave|about shiftweave|what is this project|what project is this|what is this app|what are you doing)\b/i.test(normalized)) {
        state.pending = null;
        speech = "ShiftWeave is an ambient clinical coordination system for ICU nursing teams. It synthesizes grounded SBAR shift handoffs, monitors pending bedside care, and flags EHR discrepancies so nothing falls through the cracks.";
      } else if (/^(?:hi+|hey+|hello+|good (?:morning|afternoon|evening))(?: there)?(?: how are you(?: doing)?)?(?: medi)?$/i.test(normalized) || /\b(?:good morning|good afternoon|good evening)\b/i.test(normalized)) {
        state.pending = null;
        speech = "Hey, I'm here. What's on your mind?";
      } else if (/\b(?:how are you|how're you|how are you doing|how is it going|how's it going)\b/i.test(normalized)) {
        state.pending = null;
        speech = "I'm doing well and ready to help! How is your shift going?";
      } else if (/\b(?:thanks|thank you|thanks medi|thank you medi|appreciate it|thx)\b/i.test(normalized)) {
        state.pending = null;
        speech = "You're welcome. I'm here if you need anything else.";
      } else if (/\b(?:are you there|can you hear me|listen|are you listening)\b/i.test(normalized)) {
        state.pending = null;
        speech = "Yes, I'm listening. Take your time.";
      } else if (/\b(?:what can (?:i|we) (?:access|do)|what (?:can|do) you do|how can you help(?: me)?|what is your (?:task|purpose|role|job|function)|what are your tasks|why are you here|what are you here for|what are your (?:features|capabilities)|what can i access|help me understand|tell me what you do|explain your (?:task|purpose|role)|what do you do here|can you help me|help)\b/i.test(normalized)) {
        state.pending = null;
        speech = 'I can look up your existing patient and task records, track local workflow status, and help with reviewed handoffs. What would you like help with?';
      } else if (/^(?:medi )?(?:end (?:my )?session|sign out|log out|goodbye|bye)[.! ]*$/.test(normalized)) {
        Object.assign(state, initial(state.dataSource), { revision: state.revision });
        speech = 'Take care. I’ve cleared this conversation from the screen.';
      } else if (this.conversationText(state,text)) {
        state.pending = null;
        speech = "I'm listening and glad to chat! As your ShiftWeave nursing companion, I'm ready whenever you want to check tasks, review handoffs, or look up patient updates. What would you like to do?";
      } else if (!state.nurse) {
        speech = greeting;
      } else if (!state.shift) {
        speech = 'I don’t have an active shift for your unit right now.';
      } else {
        speech = this.interpret(state, text, input.idempotency_key, interpretedCommand !== undefined);
      }
      state.revision++;
      state.speech = speech;
      state.messages = [...state.messages, { role: 'nurse' as const, text: spokenText }, { role: 'assistant' as const, text: speech }].slice(-30);
      db.prepare(`INSERT OR IGNORE INTO workflow_runs (id, workflow_type, initiated_by, status)
        VALUES (?, 'GENERATE_HANDOFF', ?, 'IN_PROGRESS')`).run(runId(input.session_id), state.nurse?.id || 'voice-demo');
      db.prepare('UPDATE workflow_runs SET initiated_by = ? WHERE id = ?').run(state.nurse?.id || 'voice-demo', runId(input.session_id));
      CheckpointService.saveCheckpoint(runId(input.session_id), state.revision, 'VOICE_TURN', { voice: state }, `voice-state:${input.idempotency_key}`);
      return this.display(state);
    });
  }

  private static resolveNurse(claimed: string, state?:State): Nurse[] {
    const nurses = db.prepare(`SELECT id, full_name AS name, department, badge_number AS badge FROM nurses n WHERE ${nurseScope('n')}`)
      .all() as Array<Nurse & { badge: string }>;
    return nurses.filter(n => {
      if (state?.dataSource === 'hospital' ? !n.id.startsWith('hospital:') : n.id.startsWith('hospital:')) return false;
      const name = normal(n.name.replace(/,\s*RN$/i, ''));
      return claimed === name || claimed === name.split(' ')[0] || claimed === name.split(' ').at(-1) || claimed === normal(n.badge);
    }).map(({ id, name, department }) => ({ id, name, department }));
  }

  private static summary(state: State) {
    const r = this.records(state);
    const unfinished = r.tasks.filter(t => !['COMPLETED', 'CANCELLED'].includes(t.status)).length;
    return `You have ${r.tasks.length} assigned task${r.tasks.length === 1 ? '' : 's'}, with ${unfinished} still unfinished.` +
      (r.conflicts.length ? ` ${r.conflicts.length} discrepanc${r.conflicts.length === 1 ? 'y needs' : 'ies need'} your review.` : '') +
      (r.candidates.length ? ` There are also ${r.candidates.length} incoming handoff tasks waiting for your acceptance.` : '');
  }

  private static selectTask(state: State, text: string, tasks: Task[]): Task | null {
    const normalized = normal(text);
    const exact = tasks.filter(t => hasPhrase(normalized,t.id) || hasPhrase(normalized,t.title));
    if (exact.length) return exact.length === 1 ? exact[0]! : null;
    const matches = tasks.filter(t => {
      const room = normal(t.roomNumber).replace(/^room /, '');
      return hasPhrase(normalized,t.id) || new RegExp(`\\b${room}\\b`).test(normalized) ||
        hasPhrase(normalized,t.patientName) ||
        t.patientName.split(/\s+/).some(n => n.length > 2 && !['patient','demo','test'].includes(normal(n)) && normalized.endsWith(` ${normal(n)}`)) ||
        hasPhrase(normalized,t.title);
    });
    if (matches.length === 1) return matches[0]!;
    if (!matches.length && !/\broom\b|\btask (?:id|named|called)\b/.test(normalized) && /\b(that|this|it|selected)\b/.test(normalized)) return tasks.find(t => t.id === state.selectedTaskId) || null;
    if (!matches.length && tasks.length === 1 && !/\b(?:room|patient)\b|\btask (?!to\b|as\b|is\b|has\b|been\b|status\b|completed\b|pending\b|in progress\b|for\b|please\b)\S/.test(normalized)) return tasks[0]!;
    return null;
  }

  private static taskSpeech(task: Task, details = false) {
    const answer = `${task.title} for ${task.patientName}, ${task.roomNumber}, is ${spokenStatus(task.status)}.`;
    if (!details) return answer;
    const row = db.prepare('SELECT description, scheduled_time, completed_time, updated_at FROM tasks WHERE id=?').get(task.id) as any;
    return `${answer} The recorded priority is ${task.priority.toLowerCase()}. ` +
      (row.description ? `${row.description}. ` : '') + `Scheduled for ${row.scheduled_time}. ` +
      (row.completed_time ? `Completion was recorded at ${row.completed_time}. ` : '') + `Source: ${task.source}; updated ${row.updated_at}.`;
  }

  private static patientSpeech(state: State, text: string, tasks: Task[]) {
    const patients: Array<{patientId:string;patientName:string;roomNumber:string}> = [...new Map(tasks.map(t => [t.patientId, t])).values()];
    // Care-team patients remain queryable even before a coordination task exists.
    if (staffAuthRequired()) {
      const team = db.prepare(`SELECT DISTINCT p.id AS patientId,p.full_name AS patientName,p.room_number AS roomNumber
        FROM patients p JOIN patient_care_team c ON c.patient_id=p.id JOIN shifts s ON s.id=c.shift_id
        WHERE c.staff_id=? AND c.shift_id=? AND c.active=1 AND s.unit_id=?`).all(state.nurse!.id,state.shift!.id,state.nurse!.department) as typeof patients;
      for (const patient of team) if (!patients.some(p => p.patientId === patient.patientId)) patients.push(patient);
    }
    const query = normal(text);
    const matches = patients.filter(t => hasPhrase(query,t.patientId) || hasPhrase(query,t.patientName) ||
      new RegExp(`\\broom ${normal(t.roomNumber).replace(/^room /, '')}\\b`).test(query) ||
      t.patientName.split(/\s+/).some(n => n.length > 2 && !['patient','demo','test'].includes(normal(n)) && query.endsWith(` ${normal(n)}`)));
    const previous = patients.find(p => p.patientId === state.selectedPatientId) || tasks.find(t => t.id === state.selectedTaskId);
    const implicit = !/\broom\b/.test(query) && (!/\bpatient\b/.test(query) || /\bpatient$/.test(query) ||
      /\b(?:my|this|that|the) patient(?: (?:s|have|has|is|doing|allergies|allergy|diagnosis|admission|today|please|right|now))*$/.test(query));
    const patient = matches.length === 1 ? matches[0] : !matches.length && implicit && /\b(this|that|their|my patient|the patient)\b/.test(query)
      ? previous || (patients.length === 1 ? patients[0] : undefined) : undefined;
    if (!patient) return 'Which patient do you mean? I couldn’t find a single match. What’s their name or room?';
    if (staffAuthRequired()) OperationalSandboxService.assertPatient(patient.patientId,state.shift!.id);
    state.selectedPatientId = patient.patientId;
    state.selectedTaskId = tasks.find(t => t.patientId === patient.patientId)?.id || null;
    const row = db.prepare('SELECT * FROM patients WHERE id=?').get(patient.patientId) as any;
    const own = tasks.filter(t => t.patientId === patient.patientId);
    const notes = staffAuthRequired() ? db.prepare('SELECT text,created_at FROM operational_notes WHERE patient_id=? AND shift_id=? ORDER BY created_at DESC LIMIT 3')
      .all(patient.patientId, state.shift!.id) as Array<{text:string;created_at:string}> : [];
    const epic = state.dataSource === 'hospital' ? HospitalService.recordsForPatients([patient.patientId]) : EpicWorkflowService.recordsForPatients([patient.patientId]);
    const freshness = epic.map(record => ` ${state.dataSource === 'hospital' ? 'Hospital record' : 'Epic snapshot'} retrieved at ${record.retrievedAt}.` +
      (record.error ? ' The latest refresh failed, so these records may be stale.' : '') +
      (record.status === 'PARTIAL' ? ' Some source information could not be retrieved.' : '')).join('');
    const allergies = row.allergies ? `The recorded allergy information is: ${row.allergies}.`
      : 'I don’t have allergy information for this patient, so I can’t confirm a negative allergy history.';
    const diagnosis = row.primary_diagnosis ? `The recorded diagnosis is ${row.primary_diagnosis}.` : 'I don’t have a recorded diagnosis for this patient.';
    const identity = `${row.full_name}, ${row.room_number}. `;
    // Answer a specific question directly rather than reading out the entire chart.
    if (/\ballerg\w*\b/.test(query) && !/\b(diagnosis|admission|medications|details|everything|summary)\b/.test(query)) return identity + allergies + freshness;
    if (/\bdiagnosis\b/.test(query) && !/\b(allerg\w*|admission|medications|details|everything|summary)\b/.test(query)) return identity + diagnosis + freshness;
    if (/\badmission\b/.test(query) && !/\b(allerg\w*|diagnosis|medications|details|everything|summary)\b/.test(query)) return identity + `The recorded admission is ${row.admission_date || 'unavailable'}.` + freshness;
    const source = epic.length ? epic.map(record => {
      const sections = record.snapshot.sections;
      const conditions = sections.Condition?.resources || [];
      return `The ${state.dataSource === 'hospital' ? 'synthetic hospital record' : 'Epic snapshot'} was retrieved at ${record.retrievedAt}. ` +
        (record.error ? 'The latest refresh failed, so these records may be stale. ' : '') +
        (record.status === 'PARTIAL' ? 'Some source information could not be retrieved. ' : '') +
        conditions.slice(0,2).map(c => `A recorded condition is ${c.code?.text || c.code?.coding?.[0]?.display || 'unspecified'}. `).join('') +
        (conditions.length > 2 ? `${conditions.length - 2} more conditions are in the source records. ` : '') +
        (sections.MedicationAdministration?.status === 'EMPTY' ? 'No medication administration records were returned. ' : '') +
        (sections.DocumentReference?.status === 'EMPTY' ? 'No handoff document records were returned. ' : '');
    }).join('') : 'These are stored local records; I don’t have an Epic snapshot for this patient.';
    const detailed = /\b(details|everything|clinical|medications|source records)\b/.test(query);
    return identity + diagnosis + ' ' + allergies + ' ' + own.map(t => this.taskSpeech(t)).join(' ') +
      (notes[0] ? ` The latest recorded shift note, at ${notes[0].created_at}, says: ${notes[0].text}. ` : ' ') +
      (detailed && epic.length ? EpicWorkflowService.narrative(epic).replace(/#+/g, '').replace(/\n+/g, ' ') : source);
  }

  private static stage(state: State, pending: Pending): string {
    state.pending = pending;
    pending.version = this.version(state);
    pending.expiresAt = Date.now() + 5 * 60_000;
    return pending.prompt;
  }

  private static interpret(state: State, raw: string, key: string, semantic = false): string {
    // Structured notes are data; words such as "start" or "finish" inside them cannot change the intent.
    const text = normal(semantic ? raw.split(/\bbecause\b/i)[0]! : raw);
    if (/^(?:medi )?(?:cancel|never mind|no|no cancel|stop)$/.test(text)) {
      state.pending = null;
      return 'Okay, I’ve cancelled that. No records were changed.';
    }
    if (/^(?:medi )?(?:yes|confirm|yes confirm|confirm it|yes please)$/.test(text)) {
      const pending = state.pending;
      state.pending = null;
      if (!pending?.ready) return 'There’s nothing ready to confirm yet. What would you like to do?';
      if (pending.expiresAt < Date.now() || pending.version !== this.version(state)) {
        return 'The confirmation expired or the records changed. Please review the current details and request the action again.';
      }
      try {
        // One transaction for multi-task acceptance; failure cannot leave a partially accepted batch.
        return db.transaction(() => {
          const nurseId = state.nurse!.id;
          if(pending.kind==='CLAIM') {
            const result=HospitalService.claimTask({nurse_id:nurseId,shift_id:state.shift!.id,task_id:pending.taskIds[0]!,human_confirmed:true,idempotency_key:`${key}:claim`});
            return `You are now assigned to ${result.title}. Its status is still ${spokenStatus(result.status)}.`;
          }
          if (pending.kind === 'STATUS') {
            const taskId = pending.taskIds[0]!;
            if (!this.records(state).tasks.some(t => t.id === taskId)) throw new Error('Only your assigned tasks can be updated');
            if (staffAuthRequired()) {
              OperationalSandboxService.updateTask({ taskId, status: pending.finalStatus!, expectedRevision: pending.taskRevision!,
                note: pending.note!, humanConfirmed: true, idempotency_key: `${key}:status` });
            } else {
              new SQLiteCacheProvider().updateLocalTaskStatus(taskId, pending.finalStatus!, nurseId, `${key}:status`, pending.note!);
            }
            const task = this.records(state).tasks.find(t => t.id === taskId)!;
            return `Done. ${task.title} for ${task.patientName} is now ${spokenStatus(pending.finalStatus!)} in the local task record.` +
              (/medicat|infusion|dose|drug/i.test(task.title) ? ' This doesn’t record medication administration or change Epic orders.' : '');
          }
          if (pending.kind === 'RESOLVE') {
            if (!ConflictService.resolveConflict(pending.conflictId!, nurseId, pending.finalStatus! as 'COMPLETED' | 'IN_PROGRESS' | 'CANCELLED', pending.note!, `${key}:resolve`))
              throw new Error('Discrepancy no longer exists');
            return `Your review is saved. The local task is now ${spokenStatus(pending.finalStatus!)}. Nothing was published to Epic.`;
          }
          if (pending.kind === 'FINALIZE') {
            HandoffService.finalize(pending.handoffId!, nurseId, `${key}:finalize`, true);
            return 'Done, the handoff is finalized locally. Nothing was published to Epic.';
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
    if (/\b(diagnose|diagnosing|prescrib\w*|recommend.*treatment|change.*dose|increase.*dose|administer)\b/.test(text)) {
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
    const patientQuery = /\b(patient|allergies|allergy|diagnosis|admission|clinical|medications|source records)\b/.test(text) &&
      !/\b(task|tasks|resolve|verify|accept|escalate|mark|set|assign|handoff)\b/.test(text) &&
      (!/\bupdate\b/.test(text) || /\b(latest|update on|update about)\b/.test(text));
    if (patientQuery && !collecting) { state.focus = 'tasks'; return this.patientSpeech(state, raw, visibleTasks); }
    if(state.dataSource==='hospital'&&(/\b(?:available|unassigned) tasks?\b/.test(text)||/\b(?:assign|claim|pick up|take on)\b/.test(text)&&/\b(?:me|myself)\b/.test(text))) {
      const pool=r.availableTasks;
      const picked=this.selectTask(state,raw,pool);
      const wantsAssignment=/\b(?:assign|claim|pick up|take on)\b/.test(text)&&/\b(?:me|myself)\b/.test(text);
      if(!pool.length)return 'There are no available unassigned tasks in this simulation hospital. Another nurse’s tasks require a reviewed handoff.';
      if(!wantsAssignment)return 'Available tasks: '+pool.map(t=>`${t.title} for ${t.patientName}, ${t.roomNumber}.`).join(' ');
      if(!picked)return 'Which available task would you like? '+pool.map(t=>`${t.title} for ${t.patientName}.`).join(' ');
      return this.stage(state,{kind:'CLAIM',taskIds:[picked.id],handoffId:null,conflictId:null,finalStatus:null,note:null,
        prompt:`Assign ${picked.title} for ${picked.patientName} to you? Say “confirm” or “cancel”.`,version:'',expiresAt:0,ready:true});
    }
    const listQuery = /\b(tasks|pending|unfinished|remaining|next)\b/.test(text) && !/\b(this|that|it)\b/.test(text);
    if (/\broom\s+\d+/.test(text) && !selected && !listQuery) {
      return 'That room did not identify exactly one task in your current view. Please specify the patient and full task title shown on screen.';
    }

    if (/\b(assign|reassign|transfer)\b/.test(text) && !/\bhandoff\b/.test(text)) {
      return 'I cannot choose an assignee or directly reassign a task by voice. Use the existing reviewed assignment workflow, or prepare a handoff for a named nurse.';
    }
    if (/\b(update|mark|set|start|finish|complete|cancel|reopen)\b/.test(text) || collecting?.kind === 'STATUS') {
      const task = selected || visibleTasks.find(t => t.id === collecting?.taskIds[0]);
      if (!task) return 'Which task would you like to update? What’s the patient’s name or room and the task title?';
      if (!r.tasks.some(t => t.id === task.id)) return 'Accept custody through the reviewed handoff before updating this task.';
      if (r.conflicts.some(c => c.taskId === task.id)) return 'This task has an unresolved discrepancy. Review and resolve the discrepancy first.';
      const status = /\b(in progress|start)\b/.test(text) ? 'IN_PROGRESS' : /\b(completed|complete|done|finish|finished)\b/.test(text) ? 'COMPLETED'
        : /\b(cancel|cancelled|canceled)\b/.test(text) ? 'CANCELLED' : /\b(pending|reopen)\b/.test(text) ? 'PENDING' : null;
      const note = raw.match(/\b(?:because|note(?: is)?)[,: ]+(.+)/i)?.[1]?.trim() || collecting?.note || 'Explicit nurse-confirmed local workflow status update';
      state.selectedTaskId = task.id;
      const revision = (db.prepare('SELECT revision FROM operational_task_versions WHERE task_id=?').get(task.id) as any)?.revision || 0;
      return this.stage(state, {kind:'STATUS', taskIds:[task.id],handoffId:null,conflictId:null,finalStatus:status,note,
        taskRevision:revision,ready:Boolean(status),version:'',expiresAt:0,prompt:status
          ? `Should I mark ${task.title} for ${task.patientName} as ${spokenStatus(status)} locally? Say “confirm” or “cancel”.`
          : 'What status should I save for this task?'});
    }

    if (/\b(resolve|verify)\b/.test(text) || (collecting?.kind === 'RESOLVE' && (/\b(completed|in progress|cancelled|canceled|because|note)\b/.test(text) || this.reviewNote(raw,collecting)))) {
      const task = selected || (collecting ? visibleTasks.find(t => t.id === collecting.taskIds[0]) : null);
      if (!task) return 'Please specify the room or patient whose discrepancy you want to review.';
      state.selectedTaskId = task.id; state.focus = 'conflicts';
      const conflict = r.conflicts.find(c => c.taskId === task.id);
      if (!conflict) return 'No unresolved discrepancy is available for that task.';
      const answeringNote = collecting?.finalStatus && this.reviewNote(raw,collecting) &&
        !/^\s*(?:in progress|completed|cancelled|canceled)\b/i.test(raw);
      const finalStatus = answeringNote ? collecting.finalStatus : /\bin progress\b/.test(text) ? 'IN_PROGRESS' : /\bcompleted\b/.test(text) ? 'COMPLETED'
        : /\bcancelled\b|\bcanceled\b/.test(text) ? 'CANCELLED' : collecting?.finalStatus || null;
      const note = raw.match(/\b(?:because|note(?: is)?)[,: ]+(.+)/i)?.[1]?.trim() || this.reviewNote(raw,collecting) || collecting?.note || null;
      const ready = Boolean(finalStatus && note);
      return this.stage(state, { kind: 'RESOLVE', taskIds: [task.id], handoffId: null, conflictId: conflict.id,
        finalStatus, note, ready, version: '', expiresAt: 0,
        prompt: ready ? `For ${task.patientName}, ${task.roomNumber}, mark the local task ${spokenStatus(finalStatus!)} with your note: “${note}”. Say “confirm” or “cancel”.`
          : finalStatus ? 'What should I note about your review?'
          : note ? 'What task status did you verify?'
          : `${conflict.systemAName} says ${conflict.systemAVal}; ${conflict.systemBName} says ${conflict.systemBVal}. What task status did you verify?` });
    }
    if (/\b(escalate|supervisor)\b/.test(text) || collecting?.kind === 'ESCALATE') {
      const task = selected || visibleTasks.find(t => t.id === collecting?.taskIds[0]);
      if (!task) return 'Please specify the room or patient to flag for supervisor review.';
      const note = raw.match(/\b(?:because|note(?: is)?)[,: ]+(.+)/i)?.[1]?.trim() || this.reviewNote(raw,collecting) || null;
      return this.stage(state, { kind: 'ESCALATE', taskIds: [task.id], handoffId: null, conflictId: null, finalStatus: null,
        note, ready: Boolean(note), version: '', expiresAt: 0, prompt: note
          ? `Save a local escalation for ${task.patientName}, ${task.roomNumber}: “${note}”? Say “confirm” or “cancel”.`
          : 'What reason should I include in the escalation note?' });
    }
    if (/\b(prepare|create|generate|draft)\b/.test(text) && /\bhandoff\b/.test(text)) {
      const target = raw.match(/\b(?:for|to)\s+(.+?)[.!?]*$/i)?.[1]?.trim();
      const nurses = target ? this.resolveNurse(normal(target),state) : [];
      if (nurses.length !== 1 || nurses[0]!.id === state.nurse!.id) return 'Who should receive the handoff? What’s the other nurse’s full name?';
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
      const requested=r.handoffs.find(h=>text.includes(normal(h.id)));
      const sourceId=raw.match(/\bfrom nurse ([\w:.-]+)$/i)?.[1] || requested?.outgoingId || state.handoffSourceNurseId;
      if(sourceId)state.handoffSourceNurseId=sourceId;
      const available=sourceId?r.handoffs.filter(h=>h.outgoingId===sourceId):r.handoffs;
      const explicit = available.filter(h => text.includes(normal(h.id)));
      const handoff = explicit[0] || available.find(h => h.id === state.selectedHandoffId) || (available.length === 1 ? available[0] : undefined);
      state.focus = 'handoff';
      if (!handoff) {
        state.selectedHandoffId=null;
        const source=sourceId?db.prepare('SELECT full_name AS name FROM nurses WHERE id=?').get(sourceId) as {name:string}|undefined:undefined;
        return available.length ? 'There is more than one saved handoff. Which one would you like to review?'
          : `I don’t have a saved handoff${source?` from ${source.name}`:''} for you. Someone leaving a shift does not create a handoff or transfer their tasks automatically. ${this.summary(state)} Would you like to review your assigned tasks?`;
      }
      state.selectedHandoffId = handoff.id;
      return `Handoff from ${handoff.outgoingName} to ${handoff.incomingName} is ${handoff.status}. ${handoff.summary.replace(/#+/g, '').replace(/\n+/g, ' ')}`;
    }
    if (/\b(conflict|conflicts|discrepancy|discrepancies)\b/.test(text)) {
      state.focus = 'conflicts';
      const conflicts = selected ? r.conflicts.filter(c => c.taskId === selected.id) : r.conflicts;
      if (selected) state.selectedTaskId = selected.id;
      return conflicts.length ? conflicts.map(c => `${c.patientName}, ${c.patientRoom}: ${c.systemAName} says ${c.systemAVal}; ${c.systemBName} says ${c.systemBVal}.`).join(' ') +
        ' These records disagree and need your review.'
        : 'No unresolved discrepancy was returned for the requested tasks.';
    }
    const plural = listQuery;
    if (selected && !plural && /\b(room|patient|show|explain|details|that|this|it|status|completed|done)\b/.test(text)) {
      state.focus = 'tasks'; state.selectedTaskId = selected.id;
      state.selectedPatientId = selected.patientId;
      return this.taskSpeech(selected, /\b(explain|details|source|scheduled|when|history)\b/.test(text));
    }
    if (/\b(task|tasks|pending|shift|resume|continue|next|remaining|unfinished|assigned)\b/.test(text)) {
      state.focus = 'tasks';
      if (!plural && /\b(this|that|task status|status of)\b/.test(text) && !selected) return 'Which task do you mean? Please give its full title and patient or room.';
      let tasks = r.tasks;
      const scoped = tasks.filter(t => hasPhrase(text,t.patientName) || hasPhrase(text,t.patientId) ||
        new RegExp(`\\broom ${normal(t.roomNumber).replace(/^room /, '')}\\b`).test(text));
      if (scoped.length) tasks = scoped;
      else if (/\b(patient|room)\b/.test(text)) return 'I could not identify that patient or room among your assigned tasks. Please specify the full patient name or room.';
      const status = /\bin progress\b/.test(text) ? 'IN_PROGRESS' : /\bcompleted|done\b/.test(text) ? 'COMPLETED'
        : /\bcancelled|canceled\b/.test(text) ? 'CANCELLED' : /\bpending\b/.test(text) ? 'PENDING' : null;
      if (status) tasks = tasks.filter(t => t.status === status);
      else if (/\b(next|remaining|unfinished)\b/.test(text)) tasks = tasks.filter(t => !['COMPLETED','CANCELLED'].includes(t.status));
      if (!tasks.length) return status ? `You don’t have any assigned tasks marked ${spokenStatus(status)} for this shift.` : 'You don’t have any assigned tasks in this view.';
      if (tasks.length === 1) state.selectedTaskId = tasks[0]!.id;
      return `You have ${tasks.length} assigned task${tasks.length === 1 ? '' : 's'}${status ? ` marked ${spokenStatus(status)}` : ''}. ` + tasks.map(t => this.taskSpeech(t)).join(' ') +
        (tasks.some(t => r.conflicts.some(c => c.taskId === t.id)) ? ' There’s a discrepancy here that needs your review.' : '');
    }
    return 'I’m not sure what you mean yet. Are you asking about a patient or a task?';
  }
}
