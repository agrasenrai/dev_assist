import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hospitalCapability, hospitalFetch, hospitalConfig } from '../src/providers/hospital-fhir.js';

// Explicit deployment/provisioning command. Never runs on ordinary application startup.
if (!process.env.SQLITE_DB_PATH || !fs.existsSync(process.env.SQLITE_DB_PATH)) throw new Error('Set SQLITE_DB_PATH to the existing application database');
const bundle=JSON.parse(fs.readFileSync('data/hospital/fhir-r4.json','utf8'));
const fixture=z.object({version:z.number(),nurses:z.array(z.object({id:z.string().startsWith('hospital:'),name:z.string(),badge:z.string()})),
  tasks:z.array(z.object({id:z.string(),patient:z.string(),nurse:z.string().startsWith('hospital:'),title:z.string(),status:z.enum(['PENDING','IN_PROGRESS','COMPLETED']),category:z.enum(['DISCHARGE_PREP','CONSULT'])}))}).parse(JSON.parse(fs.readFileSync('data/hospital/workflow.json','utf8')));
await hospitalCapability();
const {db}=await import('../src/db/connection.js');
const {initializeDatabase}=await import('../src/db/schema.js');
const {hospitalSchema,HospitalService}=await import('../src/services/hospital.service.js');
const {hospitalResourceSchema}=await import('../src/providers/hospital-store.js');
const {MutationService}=await import('../src/services/mutation.service.js');
const {HandoffService}=await import('../src/services/handoff.service.js');
const {simulationSchema,migrateSimulationRuns}=await import('../src/services/simulation.service.js');
try {
  const backup=path.join(path.dirname(process.env.SQLITE_DB_PATH),'backups',`before-hospital-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(backup),{recursive:true}); await db.backup(backup);
  initializeDatabase(); db.exec(hospitalSchema);db.exec(hospitalResourceSchema);db.exec(simulationSchema);migrateSimulationRuns();
  const digest=createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  const key=`hospital-fhir-upload:${digest}`;
  const previous=db.prepare('SELECT response_json FROM operation_receipts WHERE idempotency_key=?').get(key) as any;
  if(!previous || process.argv.includes('--restore-fhir')) {
    // PUT inside an atomic transaction permits safe reconciliation after a lost response.
    // Re-import is explicit: ordinary restarts never overwrite edited remote records.
    const result=await hospitalFetch('',{method:'POST',headers:{'Content-Type':'application/fhir+json','Idempotency-Key':process.argv.includes('--restore-fhir')?`restore:${randomUUID()}`:key},body:JSON.stringify(bundle)});
    if(result.resourceType!=='Bundle'||result.type!=='transaction-response'||result.entry?.length!==bundle.entry.length||result.entry.some((e:any)=>!/^2\d\d\b/.test(e.response?.status||'')))
      throw new Error('FHIR transaction was not confirmed; workflow provisioning stopped');
    MutationService.execute('HOSPITAL_FHIR_UPLOAD',key,{digest,endpoint:hospitalConfig().base},'hospital-setup',()=>({confirmed:true,resources:result.entry.length}));
  }
  MutationService.execute('HOSPITAL_SEED','hospital-seed-v1',{version:fixture.version},'hospital-setup',()=>{
    for(const n of fixture.nurses)db.prepare('INSERT INTO nurses(id,badge_number,full_name,email,department) VALUES(?,?,?,?,?)').run(n.id,n.badge,n.name,`${n.badge}@example.invalid`,'SYNTHETIC-HOSPITAL');
    const now=new Date().toISOString();
    db.prepare("INSERT INTO shifts(id,unit_id,shift_type,start_time,end_time,status) VALUES('hospital:shift','SYNTHETIC-HOSPITAL','DAY',?,?,'ACTIVE')").run(now,new Date(Date.now()+43200000).toISOString());
    for(const entry of bundle.entry.filter((e:any)=>e.resource.resourceType==='Patient')) {
      const p=entry.resource;
      db.prepare('INSERT INTO patients(id,mrn,full_name,room_number,admission_date,primary_diagnosis) VALUES(?,?,?,?,?,?)')
        .run(`hospital:${p.id}`,`SIM-${p.id}`,[...p.name[0].given,p.name[0].family].join(' '),'Awaiting source',now,'Awaiting FHIR record');
      db.prepare('INSERT INTO hospital_patients(patient_id,fhir_id) VALUES(?,?)').run(`hospital:${p.id}`,p.id);
    }
    for(const t of fixture.tasks) {
      db.prepare('INSERT INTO tasks(id,patient_id,title,description,category,status,priority,scheduled_time,source_system) VALUES(?,?,?,?,?,?,?, ?,?)')
        .run(`hospital:task:${t.id}`,`hospital:${t.patient}`,t.title,'Synthetic nursing coordination task; not a clinical order',t.category,t.status,'ROUTINE',now,'SYNTHETIC_HOSPITAL_WORKFLOW');
      db.prepare("INSERT INTO task_assignments(id,task_id,nurse_id,shift_id,assigned_by) VALUES(?,?,?,'hospital:shift','hospital-setup')").run(`hospital:assignment:${t.id}`,`hospital:task:${t.id}`,t.nurse);
    }
    return {patients:bundle.entry.filter((e:any)=>e.resource.resourceType==='Patient').length,tasks:fixture.tasks.length,synthetic:true};
  });
  process.env.HOSPITAL_SIMULATION_ENABLED='true';
  const refreshKey=`setup-${Date.now()}`;
  for(const n of fixture.nurses) {
    const result=await HospitalService.refresh(n.id,'hospital:shift',`${refreshKey}-${n.id}`);
    if(result.status!=='READY')throw new Error('Hospital provisioned but clinical refresh failed. Retry setup; no fallback was used.');
  }
  HandoffService.createDraft({outgoing_nurse_id:'hospital:reema',incoming_nurse_id:'hospital:seema',shift_id:'hospital:shift',summary_markdown:'',carried_forward_task_ids:fixture.tasks.filter(t=>t.nurse==='hospital:reema'&&t.status!=='COMPLETED').map(t=>`hospital:task:${t.id}`),idempotency_key:'hospital-initial-handoff-v1'});
  const catalog=JSON.parse(fs.readFileSync('data/simulations/catalog.json','utf8').replaceAll('Ava Review','Seema Patel').replaceAll('Zoe Review','Jordan Lee')
    .replaceAll('Rowan Demo','Rowan Morgan').replaceAll('Taylor Demo','Taylor Brooks').replaceAll('review:ava','hospital:seema').replaceAll('review:zoe','hospital:jordan')
    .replaceAll('Ava','Seema').replaceAll('Zoe','Jordan').replaceAll('the task in room 701','Check discharge paperwork').replaceAll('the task status in room 701','the status of Check discharge paperwork'));
  MutationService.execute('HOSPITAL_CATALOG','hospital-catalog-v1',{version:1},'hospital-setup',()=>{
    for(const s of catalog)db.prepare('INSERT INTO simulation_catalog(id,title,description,steps_json) VALUES(?,?,?,?)').run(`hospital-${s.id}`,s.title,s.description,JSON.stringify(s.steps));
    return {scenarios:catalog.length};
  });
  console.log(`Synthetic hospital provisioned in the configured database. Backup: ${backup}. Epic records preserved.`);
} finally {db.close();}
