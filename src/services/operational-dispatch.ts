import { z } from 'zod';
import { OperationalSandboxService as service } from './operational-sandbox.service.js';
import { StaffAuthService } from './staff-auth.service.js';
import { requireStaff } from './staff-context.js';
import { db } from '../db/connection.js';
import { MutationService } from './mutation.service.js';
import { createHmac } from 'node:crypto';
const key = z.string().min(1).max(200);
export async function operationalDispatch(action: string, input: unknown) {
  if(action==='sync_epic'){
    const actor=requireStaff(['ADMIN','CHARGE_NURSE']);const a=z.object({shiftId:z.string(),idempotency_key:key}).parse(input);service.shift(a.shiftId);const {EpicWorkflowService}=await import('./epic-workflow.service.js');return EpicWorkflowService.sync({nurse_id:actor.id,shift_id:a.shiftId,idempotency_key:a.idempotency_key});
  }
  if(['workspace','audit','reconcile_request','recovery','preview_note','read_document','review_handoff'].includes(action))return dispatchSync(action,input);
  const actor=requireStaff();const request=z.record(z.string(),z.unknown()).parse(input);const requestKey=key.parse(request.idempotency_key);
  const safeInput={...request};
  for(const field of ['password','newPassword'])if(typeof safeInput[field]==='string')safeInput[field]=createHmac('sha256',process.env.SANDBOX_SESSION_SECRET||'isolated-test-context').update(String(safeInput[field])).digest('hex');
  return MutationService.execute('OPERATIONAL_COMMAND',`command:${requestKey}`,{action,input:safeInput},actor.id,()=>dispatchSync(action,input));
}
function dispatchSync(action:string,input:unknown){
  switch(action) {
    case 'workspace': return service.workspace();
    case 'update_staff':return StaffAuthService.updateAccount(z.object({staffId:z.string(),active:z.boolean(),newPassword:z.string().optional(),idempotency_key:key}).parse(input));
    case 'audit': {const actor=requireStaff();return db.prepare(`SELECT id,actor_id,action,target_resource,outcome,timestamp,latency_ms FROM audit_log ${actor.role==='ADMIN'?'':'WHERE actor_id=?'} ORDER BY rowid DESC LIMIT 100`).all(...(actor.role==='ADMIN'?[]:[actor.id]));}
    case 'reconcile_request':{const actor=requireStaff();const a=z.object({requestKey:z.string().min(1)}).parse(input);for(const key of [`command:${a.requestKey}`,a.requestKey,`epic-sync:${a.requestKey}`]){const row=db.prepare('SELECT r.response_json FROM operation_receipts r JOIN workflow_runs w ON w.id=? WHERE r.idempotency_key=? AND w.initiated_by=?').get(`mutation:${key}`,key,actor.id)as any;if(row)return{status:'COMMITTED',response:JSON.parse(row.response_json)};}return{status:'NOT_CONFIRMED',instruction:'Retry the exact original request key; no automatic mutation replay occurred'};}
    case 'recovery':{const actor=requireStaff();return db.prepare(`SELECT w.id,w.workflow_type,w.status,w.updated_at,(SELECT c.step_name FROM workflow_checkpoints c WHERE c.workflow_run_id=w.id ORDER BY c.step_index DESC LIMIT 1) AS latest_step FROM workflow_runs w WHERE w.initiated_by=? ORDER BY w.rowid DESC LIMIT 50`).all(actor.id);}
    case 'create_staff': return StaffAuthService.createAccount(z.object({username:z.string(),password:z.string(),fullName:z.string(),role:z.enum(['ADMIN','CHARGE_NURSE','STAFF_NURSE','PHYSICIAN']),unit:z.string(),badge:z.string(),idempotency_key:key}).parse(input));
    case 'create_shift': return service.createShift(z.object({unit:z.string(),type:z.enum(['DAY','NIGHT','ROTATING']),start:z.string(),end:z.string(),idempotency_key:key}).parse(input));
    case 'set_duty': return service.setDuty(z.object({staffId:z.string(),shiftId:z.string(),start:z.string(),end:z.string(),dutyRole:z.enum(['OUTGOING','INCOMING','SUPERVISOR','CONSULTING']),idempotency_key:key}).parse(input));
    case 'assign_care_team': return service.assignCareTeam(z.object({patientId:z.string(),staffId:z.string(),shiftId:z.string(),teamRole:z.enum(['PRIMARY_NURSE','INCOMING_NURSE','PHYSICIAN']),idempotency_key:key}).parse(input));
    case 'create_task': return service.createTask(z.object({patientId:z.string(),nurseId:z.string(),shiftId:z.string(),title:z.string(),description:z.string(),category:z.string(),priority:z.string(),scheduledTime:z.string(),idempotency_key:key}).parse(input));
    case 'update_task': return service.updateTask(z.object({taskId:z.string(),status:z.string(),expectedRevision:z.number().int().nonnegative(),note:z.string(),humanConfirmed:z.literal(true),idempotency_key:key}).parse(input));
    case 'add_note': return service.addNote(z.object({patientId:z.string(),shiftId:z.string(),taskId:z.string().optional(),text:z.string(),recordedStatus:z.string().optional(),idempotency_key:key}).parse(input));
    case 'preview_note': {const a=z.object({handoffId:z.string(),patientId:z.string()}).parse(input);return service.notePreview(a.handoffId,a.patientId);}
    case 'publish_note': return service.publishNote(z.object({handoffId:z.string(),patientId:z.string(),reviewHash:z.string(),humanConfirmed:z.literal(true),idempotency_key:key}).parse(input));
    case 'read_document': return service.readDocument(z.object({id:z.string()}).parse(input).id);
    case 'prepare_handoff': return service.prepareHandoff(z.object({incomingId:z.string(),shiftId:z.string(),idempotency_key:key}).parse(input));
    case 'review_handoff': return service.reviewHandoff(z.object({handoffId:z.string()}).parse(input).handoffId);
    case 'accept_handoff': return service.acceptHandoff(z.object({handoffId:z.string(),reviewHash:z.string(),humanConfirmed:z.literal(true),idempotency_key:key}).parse(input));
    case 'finalize_handoff': return service.finalizeHandoff(z.object({handoffId:z.string(),reviewHash:z.string(),humanConfirmed:z.literal(true),idempotency_key:key}).parse(input));
    case 'resolve_conflict': return service.resolveConflict(z.object({conflictId:z.string(),finalStatus:z.enum(['COMPLETED','IN_PROGRESS','CANCELLED']),note:z.string().min(1),humanConfirmed:z.literal(true),idempotency_key:key}).parse(input));
    case 'record_scenario_observation':return service.recordScenarioObservation(z.object({patientId:z.string(),type:z.enum(['Observation','MedicationAdministration']),status:z.string(),recordedAt:z.string(),orderId:z.string().optional(),value:z.number().optional(),unit:z.string().optional(),code:z.string().optional(),humanConfirmed:z.literal(true),idempotency_key:key}).parse(input));
    default: throw new Error('Unknown operational action');
  }
}
