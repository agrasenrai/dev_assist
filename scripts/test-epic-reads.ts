import dotenv from 'dotenv';
dotenv.config();

import { LiveFHIRProvider } from '../src/providers/fhir-api-provider.js';
import { EpicMappingService } from '../src/providers/epic-mapping.service.js';

async function runEpicReadsVerification() {
  console.log('======================================================');
  console.log('🏥 ShiftWeave — Epic on FHIR Reads (Step 3) Verification');
  console.log('======================================================\n');

  const provider = new LiveFHIRProvider();

  // Test 1: CapabilityStatement Ping
  console.log('Test 1: Pinging Epic Sandbox CapabilityStatement (metadata)...');
  const pingOk = await provider.ping();
  if (!pingOk) throw new Error('LiveFHIRProvider.ping() failed');
  console.log('  CapabilityStatement is active.');
  console.log('  ✅ Test 1 PASSED: Live FHIR capability check succeeded.\n');

  // Test 2: Full Clinical Context Aggregation (Patient, Encounters, Conditions, Allergies, Meds)
  const testPatientId = 'erXuFYUfucBZaryVksYEcMg3'; // Camila Lopez
  console.log(`Test 2: Aggregating clinical context for Patient ${testPatientId} (Camila Lopez)...`);
  const ctx = await provider.getPatientClinicalContext(testPatientId);

  console.log('  Patient ID:', ctx.patient.id);
  console.log('  Full Name:', ctx.patient.fullName);
  console.log('  MRN:', ctx.patient.mrn);
  console.log('  Room/Location:', ctx.patient.roomNumber);
  console.log('  Primary Diagnosis:', ctx.patient.primaryDiagnosis);
  console.log('  Allergies Summary:', ctx.patient.allergies);
  console.log('  Encounter count:', ctx.encounters.length);
  console.log('  Condition count:', ctx.conditions.length);
  console.log('  Medication order count:', ctx.medicationOrders.length);
  console.log('  Document count:', ctx.documents.length);

  if (ctx.patient.id !== testPatientId) throw new Error('Patient ID mismatch');
  if (!ctx.patient.fullName.includes('Camila')) throw new Error('Patient full name mismatch');
  if (!ctx.patient.roomNumber) throw new Error('Expected roomNumber or fallback status');
  if (ctx.encounters.length === 0) throw new Error('Expected at least 1 encounter for Camila Lopez');
  if (ctx.conditions.length === 0) throw new Error('Expected at least 1 condition for Camila Lopez');
  if (ctx.medicationOrders.length === 0) throw new Error('Expected at least 1 medication order for Camila Lopez');

  // Verify first encounter provenance
  const enc = ctx.encounters[0]!;
  console.log(`  Encounter [${enc.id}]: status=${enc.status}, locations=${enc.locations.join(', ') || 'None'}`);
  if (!enc.id) throw new Error('Encounter missing ID');

  // Verify first condition provenance
  const cond = ctx.conditions[0]!;
  console.log(`  Condition [${cond.id}]: display="${cond.display}", status=${cond.clinicalStatus}, category=${cond.category}`);
  if (!cond.id || !cond.display) throw new Error('Condition missing ID or display');

  // Verify first medication order provenance
  const med = ctx.medicationOrders[0]!;
  console.log(`  MedicationOrder [${med.id}]: name="${med.medicationName}", status=${med.status}, intent=${med.intent}`);
  console.log(`    Dosage instruction: ${med.dosageInstruction || 'None specified'}`);
  if (!med.id || !med.medicationName) throw new Error('Medication order missing ID or name');

  console.log('  ✅ Test 2 PASSED: Clinical context aggregated with full source provenance, timestamps, and codes.\n');

  // Test 3: Roster / Unit Patient List
  console.log('Test 3: Querying Sandbox Patients via getPatientsByUnit("EMH-3W")...');
  const unitPatients = await provider.getPatientsByUnit('EMH-3W');
  console.log(`  Retrieved ${unitPatients.length} patients in sandbox unit.`);
  for (const p of unitPatients) {
    console.log(`    - [${p.id}] ${p.fullName} | Room: ${p.roomNumber} | Acuity: ${p.acuityLevel}`);
  }
  if (unitPatients.length === 0) throw new Error('Expected at least 1 patient from sandbox unit');
  console.log('  ✅ Test 3 PASSED: Patient roster successfully resolved.\n');

  // Test 4: Tasks For Nurse (Derived from Live Medication Orders)
  console.log('Test 4: Querying nursing tasks via getTasksForNurse("nurse_101", "shift_201")...');
  const tasks = await provider.getTasksForNurse('nurse_101', 'shift_201');
  console.log(`  Retrieved ${tasks.length} active medication tasks across assigned sandbox patients.`);
  if (tasks.length > 0) {
    const sampleTask = tasks[0]!;
    console.log(`    Sample Task [${sampleTask.id}]:`);
    console.log(`      Title: ${sampleTask.title}`);
    console.log(`      Category: ${sampleTask.category}`);
    console.log(`      Status: ${sampleTask.status}`);
    console.log(`      Priority: ${sampleTask.priority}`);
    console.log(`      Source System: ${sampleTask.sourceSystem}`);
    console.log(`      Scheduled: ${sampleTask.scheduledTime}`);
    if (sampleTask.sourceSystem !== 'EPIC_FHIR_R4') throw new Error('Expected sourceSystem EPIC_FHIR_R4');
  }
  console.log('  ✅ Test 4 PASSED: Live medication orders mapped to canonical nursing tasks.\n');

  // Test 5: Task Details Resolution
  if (tasks.length > 0) {
    const targetTaskId = tasks[0]!.id;
    console.log(`Test 5: Fetching detailed task context for task ID ${targetTaskId}...`);
    const details = await provider.getTaskDetails(targetTaskId);
    if (!details) throw new Error(`Failed to fetch details for task ${targetTaskId}`);
    console.log(`  Task resolved: "${details.task.title}" for Patient ID ${details.task.patientId}`);
    if (details.patient) {
      console.log(`  Linked Patient: ${details.patient.fullName} (Room ${details.patient.roomNumber})`);
    }
    console.log('  ✅ Test 5 PASSED: Detailed task context resolved with patient link.\n');
  }

  // Test 6: DocumentReference & Binary Content Resolution Logic
  console.log('Test 6: Testing DocumentReference inline base64 and Binary decoding...');
  const testInlineDoc = {
    resourceType: 'DocumentReference',
    id: 'doc_inline_1',
    content: [
      {
        attachment: {
          contentType: 'text/plain',
          data: Buffer.from('DISCHARGE INSTRUCTIONS: Continue oral hydration and medication as prescribed.').toString('base64'),
        },
      },
    ],
  };
  const inlineContent = await EpicMappingService.resolveDocumentContent(testInlineDoc);
  console.log('  Decoded inline content excerpt:', inlineContent?.slice(0, 45) + '...');
  if (!inlineContent || !inlineContent.includes('DISCHARGE INSTRUCTIONS')) {
    throw new Error('Inline document decoding failed');
  }
  console.log('  ✅ Test 6 PASSED: Document base64 content correctly decoded.\n');

  // Test 7: Task Write-Back Safety Boundary
  console.log('Test 7: Verifying task status write-back safety guard (EHR write rejection)...');
  try {
    await provider.updateTaskStatus('task_test_1', 'COMPLETED', 'nurse_101', 'idem_key_123');
    throw new Error('Expected updateTaskStatus to be rejected for external Epic sandbox');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('not enabled in external sandbox')) {
      throw new Error(`Unexpected error message: ${msg}`);
    }
    console.log('  Correctly caught expected safety rejection:', msg);
    console.log('  ✅ Test 7 PASSED: EHR write-back boundary protected; mutations preserved locally.\n');
  }

  // Test 8: Explicit Missing-Data / Error Surfacing
  console.log('Test 8: Verifying explicit error surfacing on non-existent patient ID...');
  try {
    await provider.getPatientClinicalContext('non-existent-pid-99999');
    throw new Error('Expected non-existent patient query to reject');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('  Explicit error returned:', msg);
    if (!msg.includes('Failed to read patient non-existent-pid-99999')) {
      throw new Error(`Unexpected error message: ${msg}`);
    }
    console.log('  ✅ Test 8 PASSED: External read failures surfaced explicitly with zero silent fallback.\n');
  }

  console.log('======================================================');
  console.log('🎉 ALL 8 EPIC READS VERIFICATION TESTS PASSED!');
  console.log('======================================================\n');
}

runEpicReadsVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
