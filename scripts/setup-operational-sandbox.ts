import 'dotenv/config';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

// Separate writable simulation. No sample-template patients or staff are imported.
const databasePath=`./data/workflow-sandbox-${Date.now()}.db`;
Object.assign(process.env,{SQLITE_DB_PATH:databasePath,EPIC_CREATE_REVIEW_TASKS:'false',STAFF_AUTH_REQUIRED:'false',EPIC_READS_ENABLED:'true',EPIC_WRITES_ENABLED:'false'});
const {db}=await import('../src/db/connection.js');
const {initializeDatabase}=await import('../src/db/schema.js');
const {StaffAuthService}=await import('../src/services/staff-auth.service.js');
const {staffContext}=await import('../src/services/staff-context.js');
const {OperationalSandboxService:operations}=await import('../src/services/operational-sandbox.service.js');
const {EpicWorkflowService}=await import('../src/services/epic-workflow.service.js');
initializeDatabase();
const unit='SIMULATION-WARD';
const users=[
  {username:'administrator',fullName:'Sandbox Administrator',role:'ADMIN'},
  {username:'charge.meera',fullName:'Meera Shah, RN',role:'CHARGE_NURSE'},
  {username:'seema',fullName:'Seema Patel, RN',role:'STAFF_NURSE'},
  {username:'reema',fullName:'Reema Roy, RN',role:'STAFF_NURSE'},
  {username:'jordan',fullName:'Jordan Lee, RN',role:'STAFF_NURSE'},
  {username:'asha',fullName:'Asha Rao, RN',role:'STAFF_NURSE'},
  {username:'doctor.mira',fullName:'Dr Mira Sen',role:'PHYSICIAN'},
  {username:'doctor.arun',fullName:'Dr Arun Mehta',role:'PHYSICIAN'},
] as const;
const ids=['erXuFYUfucBZaryVksYEcMg3','eq081-VQEgP8drUUqCWzHfw3','eAB3mDIBBcyUKviyzrxsnAw3','egqBHVfQlt4Bw3XGXoxVxHg3','eIXesllypH3M9tAA5WdJftQ3','eh2xYHuzl9nkSFVvV3osUHg3','e0w0LEDCYtfckT6N.CkJKCw3'];
process.env.EPIC_TEST_PATIENT_IDS=ids.join(',');
const credentials:any[]=[];
try{
  for(const [index,user] of users.entries()){
    const password=randomBytes(18).toString('base64url');
    const input={...user,unit,badge:`SIM-${1000+index}`,password,idempotency_key:randomUUID()};
    if(index===0)StaffAuthService.createAccount(input,true);
    else staffContext.run({principal:StaffAuthService.principal('staff:administrator'),sessionToken:''},()=>StaffAuthService.createAccount(input));
    credentials.push({username:user.username,password,name:user.fullName,role:user.role,source:'SHIFTWEAVE_OPERATIONAL_SANDBOX'});
  }
  const actor=StaffAuthService.principal('staff:administrator');
  await staffContext.run({principal:actor,sessionToken:''},async()=>{
    const start=new Date(Date.now()-60*60_000).toISOString(),end=new Date(Date.now()+24*60*60_000).toISOString();
    const shift=operations.createShift({unit,type:'ROTATING',start,end,idempotency_key:randomUUID()});
    for(const user of users)operations.setDuty({staffId:`staff:${user.username}`,shiftId:shift.id,start,end,dutyRole:user.role==='PHYSICIAN'?'CONSULTING':user.role==='STAFF_NURSE'?(['reema','asha'].includes(user.username)?'INCOMING':'OUTGOING'):'SUPERVISOR',idempotency_key:randomUUID()});
    const sync=await EpicWorkflowService.sync({nurse_id:actor.id,shift_id:shift.id,idempotency_key:randomUUID()});
    if(sync.status!=='READY'||sync.results.length!==ids.length)throw new Error(`Epic cohort import was ${sync.status}; .env was not switched. Inspect the separate database for explicit source errors`);
    const patients=db.prepare('SELECT patient_id FROM epic_patient_snapshots ORDER BY epic_patient_id').all() as any[];
    for(const [index,p]of patients.entries()){
      const outgoing=index<4?'seema':'jordan',incoming=index<4?'reema':'asha',physician=index<4?'doctor.mira':'doctor.arun';
      for(const [username,teamRole]of [[outgoing,'PRIMARY_NURSE'],[incoming,'INCOMING_NURSE'],[physician,'PHYSICIAN']])operations.assignCareTeam({patientId:p.patient_id,staffId:`staff:${username}`,shiftId:shift.id,teamRole:teamRole!,idempotency_key:randomUUID()});
      const taskProfiles = [
        [['Review sourced clinical records - Camila Lopez','CONSULT'],['Review outstanding nursing documentation','CONSULT'],['Confirm endocrine follow-up requirements','DISCHARGE_PREP']],
        [['Review sourced clinical records - Derrick Lin','CONSULT'],['Review outstanding nursing documentation (Derrick Lin)','CONSULT'],['Confirm respiratory follow-up requirements','DISCHARGE_PREP']],
        [['Review sourced clinical records - Desiree Powell','CONSULT'],['Review outstanding nursing documentation (Desiree Powell)','CONSULT'],['Confirm cardiology follow-up requirements','DISCHARGE_PREP']],
        [['Review sourced clinical records - Elijah Davis','CONSULT'],['Review outstanding nursing documentation (Elijah Davis)','CONSULT'],['Confirm pediatric follow-up requirements','DISCHARGE_PREP']],
        [['Review sourced clinical records - Dr. Linda Ross','CONSULT'],['Review outstanding nursing documentation (Dr. Linda Ross)','CONSULT'],['Confirm oncology follow-up requirements','DISCHARGE_PREP']],
        [['Review sourced clinical records - Olivia Roberts','CONSULT'],['Review outstanding nursing documentation (Olivia Roberts)','CONSULT'],['Confirm obstetric follow-up requirements','DISCHARGE_PREP']],
        [['Review sourced clinical records - Warren McGinnis','CONSULT'],['Review outstanding nursing documentation (Warren McGinnis)','CONSULT'],['Confirm cardiac telemetry follow-up requirements','DISCHARGE_PREP']]
      ];
      const patientTasks = taskProfiles[index] || [['Review sourced clinical records for handoff','CONSULT'],['Review outstanding nursing documentation','CONSULT'],['Confirm incoming coordination requirements','DISCHARGE_PREP']];
      for(const [title,category]of patientTasks)operations.createTask({patientId:p.patient_id,nurseId:`staff:${outgoing}`,shiftId:shift.id,title:title!,description:'Operator-configured synthetic nursing coordination task. Not an Epic clinical order or verified medication administration.',category:category!,priority:'ROUTINE',scheduledTime:new Date().toISOString(),idempotency_key:randomUUID()});
      operations.addNote({patientId:p.patient_id,shiftId:shift.id,text:'Simulation onboarding note: review original Epic source timestamps and preserve missing-data warnings. Nursing duty and task assignments are configured in this operational sandbox.',idempotency_key:randomUUID()});
    }
    const task=db.prepare("SELECT * FROM tasks WHERE title='Review outstanding nursing documentation' ORDER BY id LIMIT 1").get() as any;
    operations.addNote({patientId:task.patient_id,shiftId:shift.id,taskId:task.id,text:'Explicit simulation exercise: this recorded observation says coordination work is in progress while the task board records pending. The responsible nurse must review both records.',recordedStatus:'IN_PROGRESS',idempotency_key:randomUUID()});
    if(db.pragma('quick_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check')as unknown[]).length)throw new Error('New sandbox database integrity verification failed');
    fs.mkdirSync('.sandbox',{recursive:true});
    fs.writeFileSync('.sandbox/staff-credentials.json',JSON.stringify({environment:'SHIFTWEAVE_OPERATIONAL_SANDBOX',databasePath,credentials},null,2)+'\n');
    const settings:Record<string,string>={SQLITE_DB_PATH:databasePath,STAFF_AUTH_REQUIRED:'true',SANDBOX_SESSION_SECRET:randomBytes(48).toString('hex'),MCP_AUTH_TOKEN:process.env.MCP_AUTH_TOKEN||randomBytes(48).toString('hex'),EPIC_READS_ENABLED:'true',EPIC_WRITES_ENABLED:'false',EPIC_TEST_PATIENT_IDS:ids.join(','),EPIC_CREATE_REVIEW_TASKS:'false',OPERATIONAL_SHIFT_ID:shift.id};
    fs.mkdirSync('backups',{recursive:true});fs.copyFileSync('.env',`backups/env-before-operational-${Date.now()}.txt`);
    let env=fs.readFileSync('.env','utf8');
    for(const[name,value]of Object.entries(settings)){const pattern=new RegExp(`^${name}=.*$`,'m');env=pattern.test(env)?env.replace(pattern,`${name}=${value}`):env.trimEnd()+`\n${name}=${value}\n`;}
    fs.writeFileSync('.env',env);
    fs.writeFileSync('deploy/operational-sandbox-setup.json',JSON.stringify({configuredAt:new Date().toISOString(),environment:'SHIFTWEAVE_OPERATIONAL_SANDBOX',epicPatientCount:patients.length,staffCount:users.length,taskCount:(db.prepare('SELECT count(*) n FROM tasks').get()as any).n,shiftId:shift.id,clinicalSource:'EPIC_OFFICIAL_PUBLIC_SANDBOX',operationalSource:'SHIFTWEAVE_OPERATIONAL_SANDBOX',externalEpicWrites:'DISABLED',credentialsFile:'.sandbox/staff-credentials.json'},null,2)+'\n');
    console.log('Operational sandbox created and selected. 7 sourced Epic patients, 8 configured staff accounts, 21 coordination tasks. Credentials saved to ignored .sandbox/staff-credentials.json; no secrets displayed.');
  });
}finally{db.close();}
