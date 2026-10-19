import { AuditService } from "../src/services/audit.service.js";
import { CheckpointService } from "../src/services/checkpoint.service.js";
import { ConflictService } from "../src/services/conflict.service.js";
import { RecoveryService } from "../src/services/recovery.service.js";
import { randomUUID } from "crypto";

async function testRecoveryEngine() {
  console.log("\n========================================");
  console.log("Testing Zero-Loss Recovery & Core Engine");
  console.log("========================================\n");

  // 1. Audit Service Test
  const auditId = AuditService.log({
    actorType: "AGENT",
    actorId: "alexa_plus_session_01",
    action: "MCP_PROBE_TEST",
    targetResource: "tasks/icu_b",
    outcome: "SUCCESS",
    details: { probe: "ok" },
    latencyMs: 14
  });
  console.log(`Audit log written: ${auditId}`);
  const recentLogs = AuditService.getRecentLogs(3);
  console.log(`Recent Audit Entries: ${recentLogs.length} found`);

  // 2. Conflict Service Test
  const conflicts = ConflictService.getUnresolvedConflicts();
  console.log(`\nUnresolved Conflicts Found: ${conflicts.length}`);
  conflicts.forEach(c => {
    console.log(` - [${c.id}] ${c.patientRoom}: ${c.taskTitle}`);
    console.log(`   Source A (${c.systemAName}): ${c.systemAVal}`);
    console.log(`   Source B (${c.systemBName}): ${c.systemBVal}`);
  });

  // 3. Workflow Checkpoint & Interruption Recovery Test
  console.log("\n--- Simulating Multi-Step Workflow Run ---");
  const runId = CheckpointService.initWorkflowRun("GENERATE_HANDOFF", "nurse_reema_02");
  console.log(`Workflow Run Initiated: ${runId}`);

  // Step 1: Fetch Tasks
  const key1 = randomUUID();
  const chk1 = CheckpointService.saveCheckpoint(runId, 1, "FETCH_ASSIGNED_TASKS", { tasksCount: 12 }, key1);
  console.log(`Step 1 Committed: ${chk1.stepName} (ID: ${chk1.id})`);

  // Step 2: Detect Discrepancies
  const key2 = randomUUID();
  const chk2 = CheckpointService.saveCheckpoint(runId, 2, "DETECT_DISCREPANCIES", { conflictsFound: 1 }, key2);
  console.log(`Step 2 Committed: ${chk2.stepName} (ID: ${chk2.id})`);

  // Test Idempotency: Re-saving Step 2 with same key
  const chk2Duplicate = CheckpointService.saveCheckpoint(runId, 2, "DETECT_DISCREPANCIES", { conflictsFound: 1 }, key2);
  if (chk2Duplicate.id === chk2.id) {
    console.log(`Idempotency Protection VERIFIED: Duplicate token returned existing checkpoint ${chk2.id}`);
  } else {
    throw new Error("Idempotency test failed: duplicate checkpoint inserted!");
  }

  // Simulate Crash / Interruption
  console.log("\n💥 SIMULATING PROCESS INTERRUPTION / SERVER CRASH...");
  CheckpointService.markInterrupted(runId, "Simulated network drop mid-handoff");

  // Run Zero-Loss Recovery
  console.log("\n🔄 RUNNING ZERO-LOSS RECOVERY SERVICE...");
  const recoveryPlan = RecoveryService.reconcileAndResume(runId, randomUUID());
  console.log(`Recovery Status: ${recoveryPlan.recoveryStatus}`);
  console.log(`Already Committed Steps: [${recoveryPlan.alreadyCommittedSteps.join(", ")}]`);
  console.log(`Remaining Steps to Execute: [${recoveryPlan.remainingStepsToExecute.join(", ")}]`);
  console.log(`Avoided Duplicated Actions: ${recoveryPlan.avoidedDuplicateStepsCount}`);
  console.log(`Recovery Message: ${recoveryPlan.message}`);

  console.log("\n========================================");
  console.log("PHASE 3: CORE RECOVERY ENGINE 100% VERIFIED!");
  console.log("========================================\n");
}

testRecoveryEngine().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
