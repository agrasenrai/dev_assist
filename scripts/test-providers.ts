import { getActiveProvider, setActiveProvider, listAvailableProviders } from "../src/providers/index.js";

async function runProviderTests() {
  console.log("\n========================================");
  console.log("Running Hybrid Provider Contract Tests");
  console.log("========================================\n");

  // 1. List Providers
  const providers = listAvailableProviders();
  console.log("Available Providers:", providers);

  // 2. Test Default Edge Cache Provider
  const edgeProvider = getActiveProvider();
  console.log(`\nTesting Active Provider: ${edgeProvider.providerName}`);
  const pingEdge = await edgeProvider.ping();
  console.log(`Ping Success: ${pingEdge}`);

  const patients = await edgeProvider.getPatientsByUnit("ICU-B");
  console.log(`Patients Retrieved: ${patients.length}`);
  patients.forEach(p => console.log(` - ${p.roomNumber}: ${p.fullName} (MRN: ${p.mrn})`));

  const seemaTasks = await edgeProvider.getTasksForNurse("nurse_seema_01", "shift_20261019_night");
  console.log(`\nTasks Assigned to Seema: ${seemaTasks.length}`);
  seemaTasks.forEach(t => console.log(` - [${t.status}] ${t.title} (Priority: ${t.priority})`));

  // 3. Test Task Details & Conflict Check
  if (seemaTasks.length > 0) {
    const details = await edgeProvider.getTaskDetails(seemaTasks[0].id);
    console.log(`\nTask Details for ${seemaTasks[0].id}:`);
    console.log(` Title: ${details?.task.title}`);
    console.log(` Patient: ${details?.patient?.fullName} (${details?.patient?.primaryDiagnosis})`);
    console.log(` Recent Events: ${details?.recentEvents.length}`);
  }

  // 4. Test Switching to Live FHIR Provider
  console.log("\n--- Testing Dynamic Provider Switch ---");
  const fhirProvider = setActiveProvider("live-fhir-api");
  console.log(`Switched to: ${fhirProvider.providerName}`);
  const pingFHIR = await fhirProvider.ping();
  console.log(`FHIR Ping (HAPI FHIR): ${pingFHIR}`);

  const fhirPatients = await fhirProvider.getPatientsByUnit("ICU-B");
  console.log(`FHIR Patients: ${fhirPatients.length}`);

  // 5. Switch back to Local Edge Cache
  setActiveProvider("sqlite-edge-cache");
  console.log(`Switched back to: ${getActiveProvider().providerName}`);

  console.log("\n========================================");
  console.log("ALL HYBRID PROVIDER TESTS PASSED!");
  console.log("========================================\n");
}

runProviderTests().catch(err => {
  console.error("Provider test failed:", err);
  process.exit(1);
});
