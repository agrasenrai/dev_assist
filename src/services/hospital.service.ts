import { createHash } from 'node:crypto';
import { db } from '../db/connection.js';
import { MutationService } from './mutation.service.js';
import { hospitalConfig, hospitalFetch, hospitalSearch } from '../providers/hospital-fhir.js';
import type { EpicRecord } from './epic-workflow.service.js';
import { staffAuthRequired } from './staff-context.js';
import { sourceRealm } from './source-context.js';

export const hospitalSchema = `
CREATE TABLE IF NOT EXISTS hospital_patients (
 patient_id TEXT PRIMARY KEY REFERENCES patients(id), fhir_id TEXT NOT NULL UNIQUE,
 snapshot_json TEXT, retrieved_at TEXT, status TEXT NOT NULL DEFAULT 'NOT_SYNCED');
`;
export const hospitalEnabled = () => process.env.HOSPITAL_SIMULATION_ENABLED === 'true';
export class HospitalService {
  static availableTasks(nurseId:string,shiftId:string) {
    if(sourceRealm()==='epic'||!hospitalEnabled()||staffAuthRequired()||!nurseId.startsWith('hospital:'))return [];
    if(!db.prepare(`SELECT n.id FROM nurses n JOIN shifts s ON n.department=s.unit_id WHERE n.id=? AND s.id=? AND s.status IN ('ACTIVE','HANDOFF_IN_PROGRESS')`).get(nurseId,shiftId))throw new Error('Simulation nurse and active shift do not match');
    return db.prepare(`SELECT t.id,t.patient_id AS patientId,p.full_name AS patientName,p.room_number AS roomNumber,t.title,t.status,t.priority,t.source_system AS source
      FROM tasks t JOIN patients p ON p.id=t.patient_id JOIN hospital_patients h ON h.patient_id=p.id
      WHERE t.id LIKE 'hospital:%' AND t.status IN ('PENDING','IN_PROGRESS')
      AND EXISTS(SELECT 1 FROM task_assignments pool WHERE pool.task_id=t.id AND pool.shift_id=? AND pool.transfer_status='UNASSIGNED')
      AND NOT EXISTS(SELECT 1 FROM task_assignments a WHERE a.task_id=t.id AND a.transfer_status IN ('ACTIVE','CARRIED_FORWARD'))
      AND NOT EXISTS(SELECT 1 FROM conflicts c WHERE c.task_id=t.id AND c.status='UNRESOLVED') ORDER BY t.scheduled_time,t.id`).all(shiftId) as Array<{id:string;patientId:string;patientName:string;roomNumber:string;title:string;status:string;priority:string;source:string}>;
  }
  static claimTask(input:{nurse_id:string;shift_id:string;task_id:string;human_confirmed:boolean;idempotency_key:string}) {
    if(sourceRealm()==='epic'||staffAuthRequired()||!hospitalEnabled())throw new Error('Synthetic task claims are available only in the simulation hospital');
    if(input.human_confirmed!==true)throw new Error('Explicit human confirmation is required');
    return MutationService.execute('HOSPITAL_TASK_CLAIM',`hospital-claim:${input.idempotency_key}`,input,input.nurse_id,()=>{
      const task=this.availableTasks(input.nurse_id,input.shift_id).find(t=>t.id===input.task_id);
      if(!task)throw new Error('This task is no longer available. Review the current unassigned tasks.');
      db.prepare("UPDATE task_assignments SET transfer_status='TRANSFERRED' WHERE task_id=? AND shift_id=? AND transfer_status='UNASSIGNED'").run(task.id,input.shift_id);
      db.prepare("INSERT INTO task_assignments(id,task_id,nurse_id,shift_id,transfer_status,assigned_by) VALUES(?,?,?,?,'ACTIVE',?)")
        .run(`hospital:claim:${input.idempotency_key}`,task.id,input.nurse_id,input.shift_id,input.nurse_id);
      db.prepare("INSERT INTO task_events(id,task_id,event_type,previous_value,new_value,source,actor_id,idempotency_key,metadata) VALUES(?,?,'REASSIGNMENT','UNASSIGNED',?,'SYNTHETIC_HOSPITAL_WORKFLOW',?,?,?)")
        .run(`hospital:event:${input.idempotency_key}`,task.id,input.nurse_id,input.nurse_id,`hospital-claim-event:${input.idempotency_key}`,JSON.stringify({humanConfirmed:true,shiftId:input.shift_id}));
      return {success:true,taskId:task.id,nurseId:input.nurse_id,status:task.status,title:task.title};
    });
  }
  static provisioned() {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name='hospital_patients'").get()
      && db.prepare('SELECT patient_id FROM hospital_patients LIMIT 1').get());
  }
  static recordsForPatients(ids:string[]): EpicRecord[] {
    if (!ids.length || !this.provisioned()) return [];
    return (db.prepare(`SELECT h.*,p.full_name FROM hospital_patients h JOIN patients p ON p.id=h.patient_id
      WHERE h.patient_id IN (${ids.map(()=>'?').join(',')}) AND h.snapshot_json IS NOT NULL`).all(...ids) as any[])
      .map(r=>({patientId:r.patient_id,epicPatientId:r.fhir_id,name:r.full_name,retrievedAt:r.retrieved_at,
        status:r.status,error:r.status==='FAILED'?'Simulation hospital refresh failed; saved records may be stale':null,snapshot:JSON.parse(r.snapshot_json)}));
  }
  static async refresh(nurseId:string, shiftId:string, key:string) {
    if (sourceRealm()==='epic'||!hospitalEnabled() || !nurseId.startsWith('hospital:')) throw new Error('Select a simulation hospital nurse first');
    if(!db.prepare(`SELECT n.id FROM nurses n JOIN shifts s ON s.unit_id=n.department WHERE n.id=? AND s.id=? AND s.status IN ('ACTIVE','HANDOFF_IN_PROGRESS')`).get(nurseId,shiftId))
      throw new Error('Simulation nurse and active shift do not match');
    const request = {nurseId,shiftId,endpoint:hospitalConfig().base};
    const prior=db.prepare('SELECT response_json,request_json FROM operation_receipts WHERE idempotency_key=?').get(`hospital-refresh:${key}`) as any;
    if(prior) return MutationService.execute('HOSPITAL_REFRESH',`hospital-refresh:${key}`,request,nurseId,()=>{throw new Error('Invalid receipt');});
    const ids=db.prepare(`SELECT DISTINCT h.patient_id,h.fhir_id FROM hospital_patients h JOIN tasks t ON t.patient_id=h.patient_id
      JOIN task_assignments a ON a.task_id=t.id WHERE a.shift_id=? AND a.transfer_status IN ('ACTIVE','CARRIED_FORWARD') AND
      (a.nurse_id=? OR EXISTS (SELECT 1 FROM handoffs f, json_each(f.data_snapshot,'$.carriedForwardIds') c
       WHERE f.incoming_nurse_id=? AND f.outgoing_nurse_id=a.nurse_id AND f.shift_id=a.shift_id AND f.status!='FINALIZED' AND c.value=t.id))`).all(shiftId,nurseId,nurseId) as {patient_id:string;fhir_id:string}[];
    for (const row of ids) {
      const patientKey=`hospital-patient:${key}:${row.fhir_id}`;
      if(db.prepare('SELECT idempotency_key FROM operation_receipts WHERE idempotency_key=?').get(patientKey)) continue;
      try {
        const patient=await hospitalFetch(`Patient/${row.fhir_id}`);
        if(patient.resourceType!=='Patient'||patient.id!==row.fhir_id)throw new Error('FHIR patient identity mismatch');
        const types=['Encounter','Condition','AllergyIntolerance','MedicationRequest','MedicationAdministration','DocumentReference'];
        const sections:Record<string,any>={};
        await Promise.all(types.map(async type=>{const resources=await hospitalSearch(type,row.fhir_id);sections[type]={status:resources.length?'AVAILABLE':'EMPTY',resources,warnings:[]};}));
        const retrievedAt=new Date().toISOString();
        const snapshot={source:'SYNTHETIC_FHIR_R4',endpoint:hospitalConfig().base,patientId:row.fhir_id,retrievedAt,patient,sections,
          documents:sections.DocumentReference.resources.flatMap((d:any)=>(d.content||[]).map((c:any)=>({id:d.id,contentType:c.attachment?.contentType||'unknown',
            ...(c.attachment?.contentType==='text/plain'&&c.attachment.data&&c.attachment.data.length<27000?{text:Buffer.from(c.attachment.data,'base64').toString('utf8'),status:'AVAILABLE'}:{status:'UNSUPPORTED'})})))};
        MutationService.execute('HOSPITAL_PATIENT_REFRESH',patientKey,{...request,patientId:row.patient_id},nurseId,()=>{
          const official=patient.name?.find((n:any)=>n.use==='official')||patient.name?.[0];
          const name=official?.text||[...(official?.given||[]),official?.family].filter(Boolean).join(' ');
          if(!name)throw new Error('FHIR patient name is missing');
          const active=sections.Encounter.resources.filter((e:any)=>e.status==='in-progress');
          const encounter=active.length===1?active[0]:undefined;
          const room=encounter?.location?.find((l:any)=>l.status==='active')?.location?.display||'Room not available';
          const allergies=sections.AllergyIntolerance.resources.map((a:any)=>a.code?.text||a.code?.coding?.[0]?.display||'Unspecified recorded allergy').join('; ')||null;
          const diagnosis=sections.Condition.resources.map((c:any)=>c.code?.text||c.code?.coding?.[0]?.display).filter(Boolean).join('; ')||'Recorded condition unavailable';
          db.prepare('UPDATE patients SET full_name=?,room_number=?,allergies=?,primary_diagnosis=?,admission_date=? WHERE id=?')
            .run(name,room,allergies,diagnosis,encounter?.period?.start||'Admission not available',row.patient_id);
          db.prepare("UPDATE hospital_patients SET snapshot_json=?,retrieved_at=?,status='READY' WHERE patient_id=?").run(JSON.stringify(snapshot),retrievedAt,row.patient_id);
          return {patientId:row.patient_id,status:'READY',version:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
        });
      } catch {
        // Persist failure independently; never replace a failed external read with fixture success.
        MutationService.execute('HOSPITAL_PATIENT_FAILURE',`${patientKey}:failure`,{...request,patientId:row.patient_id},nurseId,()=>{
          db.prepare("UPDATE hospital_patients SET status='FAILED' WHERE patient_id=?").run(row.patient_id);
          return {patientId:row.patient_id,status:'FAILED'};
        });
      }
    }
    // Reconcile already committed patient steps on a retry after interruption.
    const states=ids.map(row=>db.prepare('SELECT patient_id AS patientId,status FROM hospital_patients WHERE patient_id=?').get(row.patient_id));
    return MutationService.execute('HOSPITAL_REFRESH',`hospital-refresh:${key}`,request,nurseId,()=>({results:states,
      status:states.some((r:any)=>r.status==='FAILED')?'FAILED':'READY',source:'SYNTHETIC_FHIR_R4'}));
  }
}
