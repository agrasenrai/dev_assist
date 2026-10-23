import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Existing application data is changed only by an explicit --configured import.
const configured=!process.argv[2]||process.argv[2]==='--configured';
if(configured&&!process.env.SQLITE_DB_PATH)throw new Error('SQLITE_DB_PATH must explicitly identify the existing application database');
const target=path.resolve(configured?process.env.SQLITE_DB_PATH!:process.argv[2] || 'data/reviewer-simulations.db');
if(configured&&!fs.existsSync(target))throw new Error('Configured database does not exist');
if(!configured&&fs.existsSync(target))throw new Error('Choose a new database path, or use --configured for an additive import');
Object.assign(process.env,{SQLITE_DB_PATH:target,NODE_ENV:'development',SIMULATION_MODE:'true',STAFF_AUTH_REQUIRED:'false'});
const {db}=await import('../src/db/connection.js');
const {initializeDatabase}=await import('../src/db/schema.js');
const {simulationSchema}=await import('../src/services/simulation.service.js');
const {MutationService}=await import('../src/services/mutation.service.js');
try {
 if(configured){
  const destination=path.join(path.dirname(target),'backups',`before-simulations-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  await db.backup(destination);
  console.log(`Consistent pre-import backup: ${destination}`);
 }
 initializeDatabase(); db.exec(simulationSchema);
 const scenarios=z.array(z.object({id:z.string(),title:z.string(),description:z.string(),steps:z.array(z.object({title:z.string(),input:z.string(),processing:z.string(),expected:z.string(),kind:z.enum(['voice','interrupt','resume','unavailable']),nurse_id:z.string().optional(),recipient_id:z.string().optional()}))})).parse(JSON.parse(fs.readFileSync('data/simulations/catalog.json','utf8')));
 MutationService.execute('SIMULATION_SEED','simulation-seed-v1',{version:1},'simulation-reviewer',()=>{
  for(const [id,name,badge] of [['review:ava','Ava Review','REVIEW-01'],['review:zoe','Zoe Review','REVIEW-02']])db.prepare('INSERT INTO nurses(id,badge_number,full_name,email,department) VALUES(?,?,?,?,?)').run(id,badge,name,`${badge}@example.invalid`,'REVIEW-WARD');
  db.prepare("INSERT INTO shifts(id,unit_id,shift_type,start_time,end_time,status) VALUES('review:shift','REVIEW-WARD','DAY',?,?,'ACTIVE')").run(new Date().toISOString(),new Date(Date.now()+43200000).toISOString());
  for(const [index,name,allergy] of [[1,'Rowan Demo','Latex'],[2,'Taylor Demo',null]] as const){
   const patient=`review:patient:${index}`,task=`review:task:${index}`;
   db.prepare('INSERT INTO patients(id,mrn,full_name,room_number,admission_date,allergies,primary_diagnosis) VALUES(?,?,?,?,?,?,?)').run(patient,`REVIEW-${index}`,name,`Room ${700+index}`,new Date().toISOString(),allergy,'Synthetic observation record; no treatment recommendation');
   db.prepare("INSERT INTO tasks(id,patient_id,title,category,status,priority,scheduled_time,source_system) VALUES(?,?,?,'DISCHARGE_PREP','PENDING','ROUTINE',?,'SYNTHETIC_REVIEW')").run(task,patient,index===1?'Check discharge paperwork':'Review transport checklist',new Date().toISOString());
   db.prepare("INSERT INTO task_assignments(id,task_id,nurse_id,shift_id,assigned_by) VALUES(?,?,'review:ava','review:shift','review:ava')").run(`review:assignment:${index}`,task);
  }
  for(const s of scenarios)db.prepare('INSERT INTO simulation_catalog VALUES(?,?,?,?)').run(s.id,s.title,s.description,JSON.stringify(s.steps));
  return {scenarios:scenarios.length,synthetic:true};
 });
 if(configured)MutationService.execute('SIMULATION_SHARED_DATABASE','simulation-shared-database-v1',{version:1},'simulation-reviewer',()=>({syntheticNamespace:'review:',existingRecordsPreserved:true}));
 console.log(`Simulation records available in: ${target}`);
} finally {db.close();}
