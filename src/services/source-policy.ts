import { createHash } from 'node:crypto';
import { db } from '../db/connection.js';
import { MutationService } from './mutation.service.js';
import { sourceRealm } from './source-context.js';

export const sourceSchema=`CREATE TABLE IF NOT EXISTS source_identifiers (
 realm TEXT NOT NULL,kind TEXT NOT NULL,external_id TEXT NOT NULL,internal_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(realm,kind,external_id));
CREATE TABLE IF NOT EXISTS dashboard_voice_sources(session_id TEXT PRIMARY KEY,realm TEXT NOT NULL);`;
export function patientScope(alias='p') {
  return sourceRealm()==='epic'?`EXISTS(SELECT 1 FROM epic_patient_snapshots es WHERE es.patient_id=${alias}.id AND json_extract(es.snapshot_json,'$.source')='EPIC_FHIR_R4')`
    :sourceRealm()==='preview'?`${alias}.id LIKE 'hospital:%'`:'1=1';
}
export function taskScope(alias='t') {return `EXISTS(SELECT 1 FROM patients sp WHERE sp.id=${alias}.patient_id AND ${patientScope('sp')})`;}
export function handoffScope(alias='h') {
  if(sourceRealm()==='legacy')return '1=1';
  return `json_array_length(${alias}.data_snapshot,'$.tasks')>0 AND NOT EXISTS(SELECT 1 FROM json_each(${alias}.data_snapshot,'$.tasks') ht WHERE NOT EXISTS(SELECT 1 FROM tasks st WHERE st.id=json_extract(ht.value,'$.id') AND ${taskScope('st')}))`;
}
export function nurseScope(alias='n') {
  return sourceRealm()==='epic'?`${alias}.id NOT LIKE 'hospital:%' AND ${alias}.id NOT LIKE 'review:%' AND EXISTS(SELECT 1 FROM nurses en JOIN task_assignments sa ON sa.nurse_id=en.id JOIN tasks st ON st.id=sa.task_id WHERE en.department=${alias}.department AND ${taskScope('st')})`
    :sourceRealm()==='preview'?`${alias}.id LIKE 'hospital:%'`:'1=1';
}
export function scopedIdentifier(kind:string,id:string) {
  const realm=sourceRealm();if(realm==='legacy')return id;
  const existing=db.prepare('SELECT realm,kind,internal_id FROM source_identifiers WHERE internal_id=?').get(id) as any;
  if(existing){if(existing.realm!==realm||existing.kind!==kind)throw new Error('Identifier belongs to another data source');return id;}
  const hex=createHash('sha256').update(`${realm}\0${kind}\0${id}`).digest('hex');
  const internal=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  MutationService.execute('SOURCE_IDENTIFIER',`source-id:${realm}:${kind}:${hex}`,{realm,kind,digest:hex},'source-router',()=>{
    db.prepare('INSERT OR IGNORE INTO source_identifiers(realm,kind,external_id,internal_id) VALUES(?,?,?,?)').run(realm,kind,id,internal);return{internal};
  });return internal;
}
export function scopedWorkflow(id:string) {
  const realm=sourceRealm();if(realm==='legacy')return id;
  if(id.startsWith('source:')){if(!id.startsWith(`source:${realm}:`))throw new Error('Workflow belongs to another data source');return id;}
  const row=db.prepare('SELECT state_payload FROM workflow_checkpoints WHERE workflow_run_id=? ORDER BY step_index DESC LIMIT 1').get(id) as any;
  if(row){if(JSON.parse(row.state_payload)._sourceRealm!==realm)throw new Error('Workflow belongs to another data source');return id;}
  return `source:${realm}:${id}`;
}
export function scopeToolArguments(name:string,args:Record<string,any>) {
  if(sourceRealm()==='legacy')return args;
  const scoped={...args};
  for(const key of ['session_id','idempotency_key'])if(typeof scoped[key]==='string')scoped[key]=scopedIdentifier(key,scoped[key]);
  if(typeof scoped.workflow_run_id==='string')scoped.workflow_run_id=scopedWorkflow(scoped.workflow_run_id);
  if(name==='save_workflow_checkpoint'&&/^(?:voice:|voice-model:|mutation:)/.test(scoped.workflow_run_id||''))throw new Error('Managed voice and mutation checkpoints cannot be overwritten by a generic checkpoint call');
  if(sourceRealm()==='epic') {
    if(['claim_hospital_task','refresh_hospital_records','review_simulation','operational_sandbox'].includes(name))throw new Error('Preview/staff sandbox operation is not available in Epic MCP mode');
    if(scoped.execution_mode&&scoped.execution_mode!=='live')throw new Error('Mock execution is disabled in Epic MCP mode');
  }
  for(const key of ['task_id',...(name==='create_handoff_draft'?['carried_forward_task_ids']:[])]) {
    for(const id of Array.isArray(scoped[key])?scoped[key]:scoped[key]?[scoped[key]]:[]) {
      if(!db.prepare(`SELECT t.id FROM tasks t WHERE t.id=? AND ${taskScope('t')}`).get(id))throw new Error('Task is outside this data source');
    }
  }
  for(const key of ['nurse_id','outgoing_nurse_id','incoming_nurse_id'])if(scoped[key]&&!['get_epic_patient_context'].includes(name)) {
    const configuredBootstrap=sourceRealm()==='epic'&&name==='sync_epic_workspace'&&key==='nurse_id'&&scoped[key]===process.env.EPIC_DEMO_NURSE_ID&&scoped.shift_id===process.env.EPIC_DEMO_SHIFT_ID&&db.prepare("SELECT id FROM nurses WHERE id=? AND id NOT LIKE 'hospital:%' AND id NOT LIKE 'review:%'").get(scoped[key]);
    if(!configuredBootstrap&&!db.prepare(`SELECT n.id FROM nurses n WHERE n.id=? AND ${nurseScope('n')}`).get(scoped[key]))throw new Error('Nurse is outside this data source or has no configured Epic patient mapping');
  }
  if(scoped.handoff_id) {
    const row=db.prepare('SELECT data_snapshot FROM handoffs WHERE id=?').get(scoped.handoff_id) as any;
    if(!row)throw new Error('Handoff not found');
    const tasks=JSON.parse(row.data_snapshot).tasks||[];
    if(!tasks.length||tasks.some((t:any)=>!db.prepare(`SELECT t.id FROM tasks t WHERE t.id=? AND ${taskScope('t')}`).get(t.id)))throw new Error('Handoff is outside this data source');
  }
  return scoped;
}
