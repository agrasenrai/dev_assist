import { createHash, randomUUID } from 'node:crypto';
import { db } from '../db/connection.js';
import { MutationService } from './mutation.service.js';
import { requireStaff, type StaffPrincipal } from './staff-context.js';
import { EpicWorkflowService } from './epic-workflow.service.js';
import { ConflictService } from './conflict.service.js';
import { HandoffService } from './handoff.service.js';

const coordinationSource = 'SHIFTWEAVE_OPERATIONAL_SANDBOX';
const nursingRoles = ['STAFF_NURSE','CHARGE_NURSE'];
export class OperationalSandboxService {
  static assertUnit(unit: string, principal = requireStaff()) {
    if (principal.role !== 'ADMIN' && unit !== principal.unit) throw new Error('Resource belongs to another unit');
  }
  static shift(id: string) {
    const shift = db.prepare('SELECT * FROM shifts WHERE id=?').get(id) as any;
    if (!shift) throw new Error('Shift not found');
    this.assertUnit(shift.unit_id); return shift;
  }
  static assertPatient(patientId: string, shiftId?: string, principal = requireStaff()) {
    const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(patientId) as any;
    if (!patient) throw new Error('Patient not found');
    if (principal.role === 'ADMIN') return patient;
    const team = db.prepare(`SELECT p.shift_id,s.unit_id FROM patient_care_team p JOIN shifts s ON s.id=p.shift_id
      WHERE p.patient_id=? AND p.active=1 ${shiftId ? 'AND p.shift_id=?' : ''}`).all(...(shiftId ? [patientId, shiftId] : [patientId])) as any[];
    if (principal.role === 'CHARGE_NURSE' && team.some(t => t.unit_id === principal.unit)) return patient;
    const assigned = db.prepare(`SELECT p.id FROM patient_care_team p JOIN shifts s ON s.id=p.shift_id
      WHERE p.patient_id=? AND p.staff_id=? AND p.active=1 AND s.unit_id=? ${shiftId ? 'AND p.shift_id=?' : ''}`).get(...(shiftId ? [patientId, principal.id, principal.unit, shiftId] : [patientId, principal.id, principal.unit]));
    if (!assigned) throw new Error('Patient is not assigned to your care team');
    return patient;
  }
  static directory() {
    const actor = requireStaff();
    return db.prepare(`SELECT n.id,n.full_name AS name,n.role,n.department AS unit,n.badge_number AS badge,a.active,a.source
      FROM nurses n JOIN staff_accounts a ON a.staff_id=n.id WHERE ${actor.role === 'ADMIN' ? '1=1' : 'n.department=?'} ORDER BY n.full_name`).all(...(actor.role === 'ADMIN' ? [] : [actor.unit]));
  }
  static workspace() {
    const actor = requireStaff();
    const teams = db.prepare(`SELECT c.*,n.full_name AS staff_name,n.role FROM patient_care_team c JOIN nurses n ON n.id=c.staff_id
      JOIN shifts s ON s.id=c.shift_id WHERE c.active=1 ${actor.role === 'ADMIN' ? '' : 'AND s.unit_id=?'}`).all(...(actor.role === 'ADMIN' ? [] : [actor.unit])) as any[];
    const visibleIds = new Set(teams.filter(c => ['ADMIN','CHARGE_NURSE'].includes(actor.role) || c.staff_id === actor.id).map(c => c.patient_id));
    const snapshots = db.prepare(`SELECT p.id,p.full_name AS name,p.room_number AS location,s.epic_patient_id AS epicId,s.sync_status AS syncStatus,s.retrieved_at AS retrievedAt
      FROM patients p JOIN epic_patient_snapshots s ON s.patient_id=p.id`).all() as any[];
    const patients = snapshots.filter(p => actor.role === 'ADMIN' || visibleIds.has(p.id));
    const ids = new Set(patients.map(p => p.id));
    const tasks = (db.prepare(`SELECT t.*,p.full_name AS patient_name,COALESCE(v.revision,0) AS revision FROM tasks t JOIN patients p ON p.id=t.patient_id
      LEFT JOIN operational_task_versions v ON v.task_id=t.id`).all() as any[]).filter(t => ids.has(t.patient_id));
    const taskIds = new Set(tasks.map(t => t.id));
    const notes = (db.prepare(`SELECT o.*,n.full_name AS author_name FROM operational_notes o JOIN nurses n ON n.id=o.author_id ORDER BY o.created_at DESC`).all() as any[]).filter(n => ids.has(n.patient_id));
    const shifts = db.prepare(`SELECT s.* FROM shifts s WHERE ${actor.role === 'ADMIN' ? '1=1' : 's.unit_id=?'} ORDER BY s.start_time DESC`).all(...(actor.role === 'ADMIN' ? [] : [actor.unit]));
    const memberships = (db.prepare('SELECT m.*,n.full_name AS staff_name FROM staff_shift_memberships m JOIN nurses n ON n.id=m.staff_id').all() as any[]).filter(m => (shifts as any[]).some(s => s.id === m.shift_id));
    const assignments = (db.prepare(`SELECT a.*,n.full_name AS nurse_name FROM task_assignments a JOIN nurses n ON n.id=a.nurse_id WHERE a.transfer_status IN ('ACTIVE','CARRIED_FORWARD')`).all() as any[]).filter(a => taskIds.has(a.task_id));
    const documents = (db.prepare('SELECT id,handoff_id,patient_id,author_id,review_hash,created_at FROM sandbox_documents ORDER BY created_at DESC').all() as any[]).filter(d => ids.has(d.patient_id));
    const handoffs = (db.prepare(`SELECT h.*,o.full_name AS outgoing_name,i.full_name AS incoming_name FROM handoffs h JOIN nurses o ON o.id=h.outgoing_nurse_id JOIN nurses i ON i.id=h.incoming_nurse_id ORDER BY h.created_at DESC`).all() as any[]).filter(h => (shifts as any[]).some(s => s.id === h.shift_id) && (['ADMIN','CHARGE_NURSE'].includes(actor.role) || h.outgoing_nurse_id === actor.id || h.incoming_nurse_id === actor.id || actor.role === 'PHYSICIAN' && JSON.parse(h.data_snapshot).tasks?.every((t: any) => ids.has(t.patient_id))));
    const observations=(db.prepare('SELECT * FROM sandbox_source_resources ORDER BY created_at DESC').all() as any[]).filter(o=>ids.has(o.patient_id)).map(o=>({...o,resource:JSON.parse(o.resource_json),source:'SHIFTWEAVE_SCENARIO_SANDBOX'}));
    return { principal: actor, source: coordinationSource, directory: this.directory(), patients, shifts, memberships,observations,clinicalRecords:EpicWorkflowService.recordsForPatients(patients.map(p=>p.id)),
      careTeam: teams.filter(t => ids.has(t.patient_id)), tasks, assignments, notes, handoffs, documents,
      conflicts: ConflictService.getUnresolvedConflicts().filter(c => taskIds.has(c.taskId)),
      epic: { writesEnabled: process.env.EPIC_WRITES_ENABLED === 'true', source: 'EPIC_OFFICIAL_PUBLIC_SANDBOX', clinicalRecordsMayBeHistorical: true } };
  }
  static createShift(input: { unit: string; type: 'DAY'|'NIGHT'|'ROTATING'; start: string; end: string; idempotency_key: string }) {
    const actor = requireStaff(['ADMIN','CHARGE_NURSE']); this.assertUnit(input.unit, actor);
    if (!Number.isFinite(Date.parse(input.start)) || !Number.isFinite(Date.parse(input.end)) || Date.parse(input.end) <= Date.parse(input.start)) throw new Error('Valid shift start/end required');
    return MutationService.execute('OPERATIONAL_SHIFT_CREATE', input.idempotency_key, input, actor.id, () => {
      const id = `shift:${randomUUID()}`;
      db.prepare("INSERT INTO shifts (id,unit_id,shift_type,start_time,end_time,status) VALUES (?,?,?,?,?,'ACTIVE')").run(id, input.unit, input.type, new Date(input.start).toISOString(), new Date(input.end).toISOString());
      return { id, source: coordinationSource };
    });
  }
  static setDuty(input: { staffId: string; shiftId: string; start: string; end: string; dutyRole: string; idempotency_key: string }) {
    const actor = requireStaff(['ADMIN','CHARGE_NURSE']); const shift = this.shift(input.shiftId);
    const staff = db.prepare('SELECT * FROM nurses WHERE id=?').get(input.staffId) as any;
    if (!staff || staff.department !== shift.unit_id) throw new Error('Staff and shift must belong to the same unit');
    if (!Number.isFinite(Date.parse(input.start)) || !Number.isFinite(Date.parse(input.end)) || Date.parse(input.end) <= Date.parse(input.start)) throw new Error('Valid duty dates required');
    if (Date.parse(input.start) < Date.parse(shift.start_time) || Date.parse(input.end) > Date.parse(shift.end_time)) throw new Error('Duty must be inside the handover shift window');
    if (!['OUTGOING','INCOMING','SUPERVISOR','CONSULTING'].includes(input.dutyRole)) throw new Error('Unsupported duty role');
    if (['OUTGOING','INCOMING'].includes(input.dutyRole) && !nursingRoles.includes(staff.role)) throw new Error('Nursing duty requires a nursing role');
    return MutationService.execute('OPERATIONAL_DUTY_SET', input.idempotency_key, input, actor.id, () => {
      const overlap = db.prepare(`SELECT id FROM staff_shift_memberships WHERE staff_id=? AND shift_id!=? AND julianday(duty_start)<julianday(?) AND julianday(duty_end)>julianday(?)`).get(input.staffId,input.shiftId,input.end,input.start);
      if (overlap) throw new Error('Staff already has overlapping duty in another shift');
      const id = `duty:${input.shiftId}:${input.staffId}`;
      db.prepare(`INSERT INTO staff_shift_memberships (id,staff_id,shift_id,duty_start,duty_end,duty_role) VALUES (?,?,?,?,?,?)
        ON CONFLICT(staff_id,shift_id) DO UPDATE SET duty_start=excluded.duty_start,duty_end=excluded.duty_end,duty_role=excluded.duty_role`).run(id,input.staffId,input.shiftId,new Date(input.start).toISOString(),new Date(input.end).toISOString(),input.dutyRole);
      return { id };
    });
  }
  static assignCareTeam(input: { patientId: string; staffId: string; shiftId: string; teamRole: string; idempotency_key: string }) {
    const actor = requireStaff(['ADMIN','CHARGE_NURSE']); const shift = this.shift(input.shiftId);
    if (!db.prepare('SELECT patient_id FROM epic_patient_snapshots WHERE patient_id=?').get(input.patientId)) throw new Error('Patient must have a sourced Epic snapshot');
    const staff = db.prepare('SELECT role,department FROM nurses WHERE id=?').get(input.staffId) as any;
    if (!staff || staff.department !== shift.unit_id || !db.prepare('SELECT id FROM staff_shift_memberships WHERE staff_id=? AND shift_id=?').get(input.staffId,input.shiftId)) throw new Error('Staff needs scheduled duty in the same unit');
    if (!['PRIMARY_NURSE','INCOMING_NURSE','PHYSICIAN'].includes(input.teamRole)) throw new Error('Unsupported care-team role');
    if (input.teamRole === 'PHYSICIAN' ? staff.role !== 'PHYSICIAN' : !nursingRoles.includes(staff.role)) throw new Error('Staff qualification does not match care-team role');
    return MutationService.execute('OPERATIONAL_CARE_TEAM_ASSIGN', input.idempotency_key, input, actor.id, () => {
      if (input.teamRole === 'PRIMARY_NURSE' && db.prepare("SELECT id FROM patient_care_team WHERE patient_id=? AND shift_id=? AND team_role='PRIMARY_NURSE' AND active=1 AND staff_id!=?").get(input.patientId,input.shiftId,input.staffId)) throw new Error('A primary nurse already exists; use handoff custody transfer rather than silently replacing ownership');
      const id = `team:${input.patientId}:${input.shiftId}:${input.staffId}`;
      db.prepare(`INSERT INTO patient_care_team (id,patient_id,staff_id,shift_id,team_role,assigned_by) VALUES (?,?,?,?,?,?)
        ON CONFLICT(patient_id,staff_id,shift_id) DO UPDATE SET team_role=excluded.team_role,active=1,assigned_by=excluded.assigned_by`).run(id,input.patientId,input.staffId,input.shiftId,input.teamRole,actor.id);
      return { id };
    });
  }
  static createTask(input: { patientId: string; nurseId: string; shiftId: string; title: string; description: string; category: string; priority: string; scheduledTime: string; idempotency_key: string }) {
    const actor = requireStaff(); const shift = this.shift(input.shiftId); this.assertPatient(input.patientId,input.shiftId);
    if (!['ADMIN','CHARGE_NURSE','PHYSICIAN'].includes(actor.role) && input.nurseId !== actor.id) throw new Error('Nurses can create coordination work only for themselves');
    const nurse = db.prepare('SELECT role,department FROM nurses WHERE id=?').get(input.nurseId) as any;
    if (!nurse || !nursingRoles.includes(nurse.role) || nurse.department !== shift.unit_id || !db.prepare("SELECT id FROM patient_care_team WHERE patient_id=? AND staff_id=? AND shift_id=? AND active=1 AND team_role='PRIMARY_NURSE'").get(input.patientId,input.nurseId,input.shiftId)) throw new Error('Assign work to the patient primary nurse in this shift');
    if (!input.title.trim() || input.title.length > 200 || !Number.isFinite(Date.parse(input.scheduledTime))) throw new Error('Valid task title and scheduled time required');
    if (!['VITAL','MEDICATION_CHECK','LAB_DRAW','WOUND_CARE','MOBILITY','CONSULT','DISCHARGE_PREP'].includes(input.category) || !['STAT','URGENT','ROUTINE'].includes(input.priority)) throw new Error('Unsupported coordination category or priority');
    return MutationService.execute('OPERATIONAL_TASK_CREATE',input.idempotency_key,input,actor.id,() => {
      const id = `coordination:${randomUUID()}`;
      db.prepare("INSERT INTO tasks (id,patient_id,title,description,category,status,priority,scheduled_time,source_system) VALUES (?,?,?,?,?,'PENDING',?,?,?)").run(id,input.patientId,input.title,input.description,input.category,input.priority,new Date(input.scheduledTime).toISOString(),coordinationSource);
      db.prepare('INSERT INTO task_assignments (id,task_id,nurse_id,shift_id,assigned_by) VALUES (?,?,?,?,?)').run(`assignment:${id}`,id,input.nurseId,input.shiftId,actor.id);
      db.prepare('INSERT INTO operational_task_versions (task_id) VALUES (?)').run(id);
      return { id, status:'PENDING', revision:0, source:coordinationSource };
    });
  }
  static task(taskId: string) {
    const task = db.prepare('SELECT t.*,COALESCE(v.revision,0) AS revision FROM tasks t LEFT JOIN operational_task_versions v ON v.task_id=t.id WHERE t.id=?').get(taskId) as any;
    if (!task) throw new Error('Task not found'); this.assertPatient(task.patient_id); return task;
  }
  static updateTask(input: { taskId: string; status: string; expectedRevision: number; note: string; humanConfirmed: boolean; idempotency_key: string }) {
    const actor = requireStaff(['ADMIN','CHARGE_NURSE','STAFF_NURSE']);
    if (!input.humanConfirmed || !input.note.trim() || !['PENDING','IN_PROGRESS','COMPLETED','CANCELLED'].includes(input.status)) throw new Error('Reviewed local coordination status and note required');
    return MutationService.execute('OPERATIONAL_TASK_STATUS',input.idempotency_key,input,actor.id,() => {
      const task = this.task(input.taskId);
      if (!['ADMIN','CHARGE_NURSE'].includes(actor.role) && !db.prepare("SELECT id FROM task_assignments WHERE task_id=? AND nurse_id=? AND transfer_status='ACTIVE'").get(input.taskId,actor.id)) throw new Error('Only the current task owner can update this task');
      if (task.revision !== input.expectedRevision) throw new Error('Task changed; refresh before confirming');
      if (db.prepare("SELECT id FROM conflicts WHERE task_id=? AND status='UNRESOLVED'").get(input.taskId)) throw new Error('Human discrepancy review is required first');
      db.prepare('UPDATE tasks SET status=?,completed_time=?,updated_at=? WHERE id=?').run(input.status,input.status==='COMPLETED'?new Date().toISOString():null,new Date().toISOString(),input.taskId);
      db.prepare('INSERT INTO operational_task_versions (task_id,revision) VALUES (?,1) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1').run(input.taskId);
      db.prepare("INSERT INTO task_events (id,task_id,event_type,previous_value,new_value,source,actor_id,idempotency_key,metadata) VALUES (?,?,'STATUS_TRANSITION',?,?,?,?,?,?)").run(randomUUID(),input.taskId,task.status,input.status,coordinationSource,actor.id,`event:${input.idempotency_key}`,JSON.stringify({note:input.note,scope:'local coordination; not medication administration'}));
      return { taskId:input.taskId,status:input.status,revision:task.revision+1,scope:'LOCAL_COORDINATION_ONLY' };
    });
  }
  static addNote(input: { patientId: string; shiftId: string; taskId?: string | undefined; text: string; recordedStatus?: string | undefined; idempotency_key: string }) {
    const actor = requireStaff(); this.assertPatient(input.patientId,input.shiftId); this.shift(input.shiftId);
    if (!input.text.trim() || input.text.length > 10000) throw new Error('A note between 1 and 10,000 characters is required');
    if (input.recordedStatus && !['PENDING','IN_PROGRESS','COMPLETED','CANCELLED'].includes(input.recordedStatus)) throw new Error('Invalid recorded task status');
    return MutationService.execute('OPERATIONAL_NOTE_CREATE',input.idempotency_key,input,actor.id,() => {
      const task = input.taskId ? this.task(input.taskId) : undefined;
      if (task && (task.patient_id !== input.patientId || !db.prepare('SELECT id FROM task_assignments WHERE task_id=? AND shift_id=?').get(task.id,input.shiftId))) throw new Error('Note task must belong to this patient and shift');
      if (input.recordedStatus && !task) throw new Error('A task is required for a status observation');
      const id=`note:${randomUUID()}`;
      db.prepare('INSERT INTO operational_notes (id,patient_id,task_id,shift_id,author_id,text,recorded_status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,input.patientId,input.taskId||null,input.shiftId,actor.id,input.text,input.recordedStatus||null,new Date().toISOString());
      let conflictId: string | undefined;
      if (task && input.recordedStatus && input.recordedStatus !== task.status && task.status !== 'FLAGGED_CONFLICT') {
        conflictId=ConflictService.flagConflict(task.id,'STATUS_MISMATCH',`Operational task ${task.id}`,task.status,`Recorded observation ${id} by ${actor.name}`,input.recordedStatus,undefined,`note-conflict:${input.idempotency_key}`);
      }
      if (task) {
        db.prepare("INSERT INTO task_events (id,task_id,event_type,new_value,source,actor_id,idempotency_key,metadata) VALUES (?,?,'NOTE_ADDED',?,?,?,?,?)").run(randomUUID(),task.id,input.text,coordinationSource,actor.id,`note-event:${input.idempotency_key}`,JSON.stringify({noteId:id,recordedStatus:input.recordedStatus,conflictId}));
        db.prepare('INSERT INTO operational_task_versions (task_id,revision) VALUES (?,1) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1').run(task.id);
      }
      return { id,conflictId:conflictId||null,source:coordinationSource };
    });
  }
  static notePreview(handoffId: string, patientId: string) {
    const actor = requireStaff(['STAFF_NURSE','CHARGE_NURSE']); this.assertPatient(patientId);
    const handoff=db.prepare('SELECT * FROM handoffs WHERE id=? AND incoming_nurse_id=?').get(handoffId,actor.id) as any;
    if (!handoff || handoff.status !== 'FINALIZED') throw new Error('Only the incoming nurse can publish a finalized handoff');
    const snapshot=JSON.parse(handoff.data_snapshot);
    const tasks=snapshot.tasks.filter((t:any)=>t.patient_id===patientId);
    if (!tasks.length) throw new Error('Patient is not part of this handoff');
    for(const task of tasks) if(db.prepare("SELECT id FROM conflicts WHERE task_id=? AND status='UNRESOLVED'").get(task.id)) throw new Error('Unresolved discrepancies block publication');
    const notes=db.prepare('SELECT id,text,author_id,created_at FROM operational_notes WHERE patient_id=? AND shift_id=? ORDER BY created_at').all(patientId,handoff.shift_id);
    const content=`SHIFTWEAVE OPERATIONAL SANDBOX — SYNTHETIC WORKFLOW, NOT FOR PATIENT CARE\nPatient: ${patientId}\nHandoff: ${handoffId}\nAuthor: ${actor.name}\n`+tasks.map((t:any)=>`${t.title}: recorded draft state ${t.status}`).join('\n')+`\nRecorded shift notes:\n${JSON.stringify(notes,null,2)}`+EpicWorkflowService.narrative(EpicWorkflowService.recordsForPatients([patientId]));
    const reviewHash=createHash('sha256').update(content).digest('hex');
    return {handoffId,patientId,authorId:actor.id,content,reviewHash,source:coordinationSource,externalEpicWrite:false};
  }
  static publishNote(input:{handoffId:string;patientId:string;reviewHash:string;humanConfirmed:boolean;idempotency_key:string}) {
    const actor=requireStaff(['STAFF_NURSE','CHARGE_NURSE']);
    if(!input.humanConfirmed)throw new Error('Human review is required');
    return MutationService.execute('SANDBOX_DOCUMENT_PUBLISH',input.idempotency_key,input,actor.id,()=>{
      const preview=this.notePreview(input.handoffId,input.patientId);
      if(preview.reviewHash!==input.reviewHash)throw new Error('Note changed; review the new preview');
      const existing=db.prepare('SELECT id,review_hash FROM sandbox_documents WHERE handoff_id=? AND patient_id=?').get(input.handoffId,input.patientId) as any;
      if(existing){if(existing.review_hash!==input.reviewHash)throw new Error('A different note is already published');return {id:existing.id,status:'PUBLISHED',source:coordinationSource,externalEpicWrite:false};}
      const id=`document:${randomUUID()}`;
      db.prepare('INSERT INTO sandbox_documents (id,handoff_id,patient_id,author_id,content,review_hash,created_at) VALUES (?,?,?,?,?,?,?)').run(id,input.handoffId,input.patientId,actor.id,preview.content,preview.reviewHash,new Date().toISOString());
      return {id,status:'PUBLISHED',source:coordinationSource,externalEpicWrite:false};
    });
  }
  static readDocument(id:string){const doc=db.prepare('SELECT * FROM sandbox_documents WHERE id=?').get(id) as any;if(!doc)throw new Error('Sandbox document not found');this.assertPatient(doc.patient_id);return {...doc,source:coordinationSource,externalEpicWrite:false};}
  static reviewHandoff(handoffId:string){
    const actor=requireStaff(['STAFF_NURSE','CHARGE_NURSE']);
    const handoff=db.prepare('SELECT * FROM handoffs WHERE id=? AND (incoming_nurse_id=? OR outgoing_nurse_id=?)').get(handoffId,actor.id,actor.id) as any;
    if(!handoff)throw new Error('Handoff is not assigned to you');
    const snapshot=JSON.parse(handoff.data_snapshot);
    const tasks=snapshot.tasks.map((t:any)=>db.prepare('SELECT * FROM tasks WHERE id=?').get(t.id));
    const assignments=snapshot.tasks.flatMap((t:any)=>db.prepare("SELECT * FROM task_assignments WHERE task_id=? AND transfer_status IN ('ACTIVE','CARRIED_FORWARD') ORDER BY id").all(t.id));
    const notes=db.prepare('SELECT * FROM operational_notes WHERE shift_id=? ORDER BY id').all(handoff.shift_id).filter((n:any)=>snapshot.tasks.some((t:any)=>t.patient_id===n.patient_id));
    const reviewHash=createHash('sha256').update(JSON.stringify({handoff,tasks,assignments,notes})).digest('hex');
    return {handoff,tasks,assignments,notes,reviewHash};
  }
  static prepareHandoff(input:{incomingId:string;shiftId:string;idempotency_key:string}){
    const actor=requireStaff(['STAFF_NURSE','CHARGE_NURSE']);this.shift(input.shiftId);
    const tasks=db.prepare(`SELECT t.id FROM tasks t JOIN task_assignments a ON a.task_id=t.id WHERE a.nurse_id=? AND a.shift_id=? AND a.transfer_status IN ('ACTIVE','CARRIED_FORWARD') AND t.status NOT IN ('COMPLETED','CANCELLED')`).all(actor.id,input.shiftId) as any[];
    if(!tasks.length)throw new Error('No unfinished assigned work to hand off');
    for(const t of tasks){const task=this.task(t.id);if(!db.prepare("SELECT id FROM patient_care_team WHERE patient_id=? AND staff_id=? AND shift_id=? AND active=1 AND team_role='INCOMING_NURSE'").get(task.patient_id,input.incomingId,input.shiftId))throw new Error('Incoming nurse must be on every carried patient care team');}
    return HandoffService.createDraft({outgoing_nurse_id:actor.id,incoming_nurse_id:input.incomingId,shift_id:input.shiftId,summary_markdown:'',carried_forward_task_ids:tasks.map(t=>t.id),idempotency_key:input.idempotency_key});
  }
  static acceptHandoff(input:{handoffId:string;reviewHash:string;humanConfirmed:boolean;idempotency_key:string}){
    const actor=requireStaff(['STAFF_NURSE','CHARGE_NURSE']);
    return MutationService.execute('OPERATIONAL_HANDOFF_ACCEPT',input.idempotency_key,input,actor.id,()=>{
      if(!input.humanConfirmed)throw new Error('Explicit custody review is required');
      const review=this.reviewHandoff(input.handoffId);if(review.reviewHash!==input.reviewHash)throw new Error('Handoff changed; review it again');
      if(review.handoff.incoming_nurse_id!==actor.id)throw new Error('Only the incoming nurse can accept custody');
      const snapshot=JSON.parse(review.handoff.data_snapshot);
      for(const taskId of snapshot.carriedForwardIds)HandoffService.acknowledge({task_id:taskId,nurse_id:actor.id,action:'ACCEPT_HANDOFF',handoff_id:input.handoffId,human_confirmed:true,idempotency_key:`${input.idempotency_key}:${taskId}`});
      return {handoffId:input.handoffId,accepted: snapshot.carriedForwardIds.length};
    });
  }
  static finalizeHandoff(input:{handoffId:string;reviewHash:string;humanConfirmed:boolean;idempotency_key:string}){
    const actor=requireStaff(['STAFF_NURSE','CHARGE_NURSE']);
    return MutationService.execute('OPERATIONAL_HANDOFF_FINALIZE',input.idempotency_key,input,actor.id,()=>{
      const review=this.reviewHandoff(input.handoffId);if(review.reviewHash!==input.reviewHash)throw new Error('Handoff changed; review it again');
      return HandoffService.finalize(input.handoffId,actor.id,`finalize:${input.idempotency_key}`,input.humanConfirmed);
    });
  }
  static resolveConflict(input:{conflictId:string;finalStatus:'COMPLETED'|'IN_PROGRESS'|'CANCELLED';note:string;humanConfirmed:boolean;idempotency_key:string}){
    const actor=requireStaff(['STAFF_NURSE','CHARGE_NURSE']);
    if(!input.humanConfirmed)throw new Error('Human verification is required');
    const conflict=db.prepare('SELECT task_id FROM conflicts WHERE id=?').get(input.conflictId) as any;
    if(!conflict)throw new Error('Conflict not found');
    this.task(conflict.task_id);
    if(actor.role==='STAFF_NURSE'&&!db.prepare("SELECT id FROM task_assignments WHERE task_id=? AND nurse_id=? AND transfer_status='ACTIVE'").get(conflict.task_id,actor.id))throw new Error('Only the task owner or charge nurse can resolve this discrepancy');
    return ConflictService.resolveConflict(input.conflictId,actor.id,input.finalStatus,input.note,input.idempotency_key);
  }
  static recordScenarioObservation(input:{patientId:string;type:'Observation'|'MedicationAdministration';status:string;recordedAt:string;orderId?:string|undefined;value?:number|undefined;unit?:string|undefined;code?:string|undefined;humanConfirmed:boolean;idempotency_key:string}){
    const actor=requireStaff(['ADMIN','CHARGE_NURSE']);this.assertPatient(input.patientId);
    if(!input.humanConfirmed||!Number.isFinite(Date.parse(input.recordedAt)))throw new Error('Explicit scenario confirmation and valid timestamp required');
    const patient=EpicWorkflowService.recordsForPatients([input.patientId])[0];if(!patient)throw new Error('Sourced patient required');
    let resource:any;
    const id=randomUUID();const meta={tag:[{system:'urn:shiftweave:source',code:'SCENARIO_SANDBOX',display:'Synthetic scenario observation; not an Epic event'}]};
    const subject={identifier:{system:'urn:shiftweave:patient',value:input.patientId}};
    if(input.type==='MedicationAdministration'){
      const order=patient.snapshot.sections.MedicationRequest?.resources.find(o=>o.id===input.orderId);
      if(!order||!['completed','not-done','in-progress','stopped'].includes(input.status))throw new Error('Choose an actual sourced medication order and supported scenario status');
      resource={resourceType:input.type,id,meta,status:input.status,subject,effectiveDateTime:new Date(input.recordedAt).toISOString(),request:{reference:`${patient.snapshot.endpoint}/MedicationRequest/${order.id}`},medicationCodeableConcept:order.medicationCodeableConcept||{text:order.medicationReference?.display||'Sourced medication order'},note:[{text:'Synthetic test event recorded in the workflow sandbox. No medication was administered and no Epic record was changed.'}]};
    }else{
      if(!Number.isFinite(input.value)||!input.unit?.trim()||!input.code?.trim()||input.status!=='final')throw new Error('A recorded scenario measurement, unit and code are required');
      resource={resourceType:input.type,id,meta,status:'final',subject,effectiveDateTime:new Date(input.recordedAt).toISOString(),code:{text:input.code},valueQuantity:{value:input.value,unit:input.unit},note:[{text:'Synthetic scenario measurement, not a clinically verified vital sign.'}]};
    }
    return MutationService.execute('SANDBOX_SCENARIO_OBSERVATION',input.idempotency_key,input,actor.id,()=>{
      db.prepare('INSERT INTO sandbox_source_resources (resource_type,id,patient_id,author_id,resource_json,created_at) VALUES (?,?,?,?,?,?)').run(input.type,id,input.patientId,actor.id,JSON.stringify(resource),new Date().toISOString());
      return {id,resource,source:'SHIFTWEAVE_SCENARIO_SANDBOX',externalEpicWrite:false};
    });
  }
}
