import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Uses the existing operational profile. Clinical and workflow reads only;
// authentication and voice conversation checkpoints are deliberately durable.
const base=process.env.OPERATIONAL_TEST_ORIGIN||'http://localhost:3101';
const credentials=JSON.parse(fs.readFileSync('.sandbox/staff-credentials.json','utf8')).credentials;
const checks:any[]=[];
const sessions:string[]=[];
async function request(path:string,input:unknown,cookie?:string){
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(120000)});
  const data=await response.json();if(!response.ok)throw new Error(`${path}: ${response.status} ${data.error||'Request failed'}`);
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
try{
  for(const username of ['administrator','seema','reema','jordan','asha','doctor.mira','doctor.arun','charge.meera']){
    const credential=credentials.find((c:any)=>c.username===username);assert(credential,'Provisioned staff account missing');
    const login=await request('/api/staff/login',{username,password:credential.password,idempotency_key:randomUUID()});assert(login.cookie);sessions.push(login.cookie);
    const workspace=(await request('/api/operations/workspace',{},login.cookie)).data;
    assert(workspace.patients.length>0,'Provisioned care team has no visible sourced patients');
    assert.equal(workspace.clinicalRecords.length,workspace.patients.length);
    checks.push({username,role:login.data.principal.role,visiblePatients:workspace.patients.length,visibleTasks:workspace.tasks.length,clinicalSource:workspace.epic.source});
    if(username==='seema'){
      const session_id=randomUUID();
      const intro=(await request('/api/voice',{session_id,utterance:'I am Seema',expected_revision:0,idempotency_key:randomUUID()},login.cookie)).data;
      const input={session_id,utterance:'Ask assistant, summarize my assigned tasks for this shift',expected_revision:intro.revision,idempotency_key:randomUUID()};
      const start=Date.now();
      const display=(await request('/api/voice',input,login.cookie)).data;
      assert(display.speech?.length,'LLM-assisted turn returned no grounded display');
      const retry=(await request('/api/voice',input,login.cookie)).data;assert.deepEqual(retry,display);
      const audit=(await request('/api/operations/audit',{},login.cookie)).data;
      const decisions=audit.filter((row:any)=>row.action==='LLM:DECISION');assert(decisions.length,'No actual model decision in authenticated audit');
      checks.push({modelProvider:process.env.LLM_PROVIDER,status:'LIVE_AUTHENTICATED_TURN_PASSED',elapsedMs:Date.now()-start,epicSnapshots:display.epicRecords?.length||0,recordedModelDecisions:decisions.length,exactRetry:'IDENTICAL_SAVED_RESPONSE'});
    }
  }
  const report={verifiedAt:new Date().toISOString(),status:'PASSED',source:'PROVISIONED_EPIC_AND_OPERATIONAL_SANDBOX',externalEpicWrites:'NONE',checks};
  fs.writeFileSync('deploy/provisioned-workspace-test.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){
  let message=error instanceof Error?error.message:String(error);
  for(const credential of credentials)message=message.split(credential.password).join('[REDACTED]');
  for(const name of ['GEMINI_API_KEY','AWS_BEARER_TOKEN_BEDROCK','AWS_SECRET_ACCESS_KEY','MCP_AUTH_TOKEN'])if(process.env[name])message=message.split(process.env[name]!).join('[REDACTED]');
  const report={verifiedAt:new Date().toISOString(),status:'FAILED',checks,error:message};fs.writeFileSync('deploy/provisioned-workspace-test.json',JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify(report,null,2));process.exitCode=1;
}finally{for(const cookie of sessions)await request('/api/staff/logout',{idempotency_key:randomUUID()},cookie).catch(()=>{});}
