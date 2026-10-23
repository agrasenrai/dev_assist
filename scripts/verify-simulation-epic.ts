import 'dotenv/config';
import assert from 'node:assert/strict';
import {fetchEpicWorkflowSnapshot} from '../src/providers/epic-workflow-source.js';
// Separate from synthetic review mode. Read only the first explicitly configured allowlisted patient.
assert.equal(process.env.EPIC_READS_ENABLED,'true','Epic reads are not configured as enabled');
const patientId=(process.env.EPIC_TEST_PATIENT_IDS||'').split(',').map(s=>s.trim()).filter(Boolean)[0];
assert(patientId,'Configure an approved EPIC_TEST_PATIENT_IDS allowlist');
const snapshot=await fetchEpicWorkflowSnapshot(patientId);
assert(snapshot.patient?.id,'Patient read did not return a record');
const sections=Object.fromEntries(Object.entries(snapshot.sections).map(([name,value])=>[name,{status:value.status,count:value.resources.length}]));
console.log(JSON.stringify({source:'LIVE_CONFIGURED_EPIC',patientRead:true,sections,externalWrites:false,localPatientImport:false},null,2));
if(Object.values(snapshot.sections).some(s=>s.status==='ERROR'))throw new Error('One or more Epic sections failed; see status summary. No synthetic fallback was used.');
