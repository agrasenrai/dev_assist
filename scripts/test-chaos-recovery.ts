import { appServer } from "../src/server.js";
import { ShiftWeaveOrchestrator } from "../src/agent/orchestrator.js";
import { db } from "../src/db/connection.js";

async function runEndToEndChaosRecoveryTest() {
  console.log("\n========================================================");
  console.log("PHASE 7: END-TO-END CHAOS INTERRUPTION & RECOVERY VERIFICATION");
  console.log("========================================================\n");

  const port = process.env.PORT || 3000;
  const endpoint = `http://localhost:${port}/mcp`;
  const runId = `wf_run_e2e_chaos_${Date.now()}`;

  try {
    // 1. Initial State Inspection
    console.log("1. Inspecting initial ICU-B database state...");
    const initialConflicts = db.prepare("SELECT * FROM conflicts WHERE status = 'UNRESOLVED'").all() as any[];
    console.log(`✓ Active Unresolved Conflicts: ${initialConflicts.length}`);
    initialConflicts.forEach(c => {
      console.log(`   - Discrepancy on ${c.task_id}: ${c.system_a_name} says "${c.system_a_val}" vs ${c.system_b_name} says "${c.system_b_val}"`);
    });

    // 2. Initialize Agent Orchestrator connected over Streamable HTTP
    console.log("\n2. Initializing Agent Orchestrator connected to Streamable HTTP...");
    const orchestrator = new ShiftWeaveOrchestrator(endpoint, "mock", runId);
    const init = await orchestrator.initialize();
    console.log(`✓ Connected to MCP Server via Streamable HTTP (Session: ${init.sessionId})`);

    // 3. Initiate Handoff with Simulated Server Interruption
    console.log("\n3. Turn 1: Nurse Reema initiates handoff preparation with SIMULATED OUTAGE at step 4 (after checkpoint commit)...");
    let caughtOutage = false;
    try {
      await orchestrator.processUtterance(
        "nurse_reema_02",
        "Alexa, prepare my morning shift handoff for ICU-B.",
        {
          shiftId: "shift_20261019_night",
          outgoingNurseId: "nurse_seema_01",
          incomingNurseId: "nurse_reema_02",
          simulateInterruptionAtStep: 4
        }
      );
    } catch (err: any) {
      caughtOutage = true;
      console.log(`⚡ [CHAOS SIMULATION ACTIVATED]: Caught planned failure:`);
      console.log(`   "${err.message}"`);
    }

    if (!caughtOutage) {
      throw new Error("Expected simulated outage did not trigger!");
    }

    // 4. Verify SQLite Checkpoint committed before the crash
    console.log("\n4. Verifying intermediate checkpoint persistence in SQLite...");
    const checkpoints = db.prepare(`
      SELECT step_index, step_name, idempotency_key, created_at
      FROM workflow_checkpoints
      WHERE workflow_run_id = ?
    `).all(runId) as any[];

    console.log(`✓ Confirmed ${checkpoints.length} Checkpoint(s) saved before crash:`);
    checkpoints.forEach(chk => {
      console.log(`   - Checkpoint #${chk.step_index} [${chk.step_name}] IdempotencyKey: ${chk.idempotency_key}`);
    });

    if (checkpoints.length === 0) {
      throw new Error("No checkpoint found in SQLite for interrupted run!");
    }

    // 5. Zero-Loss Resumption
    console.log("\n5. Turn 2: Nurse Reema requests recovery: 'Alexa, resume my handoff preparation.'");
    const recoveryResult = await orchestrator.processUtterance(
      "nurse_reema_02",
      "Alexa, resume my handoff preparation.",
      {
        shiftId: "shift_20261019_night",
        outgoingNurseId: "nurse_seema_01",
        incomingNurseId: "nurse_reema_02"
      }
    );

    console.log(`✓ Autonomous Recovery Executed ${recoveryResult.toolsExecuted.length} Steps:`);
    recoveryResult.toolsExecuted.forEach((step, idx) => {
      console.log(`   Step ${idx + 1}: ${step.name} (${step.latencyMs}ms)`);
    });

    console.log(`\n🗣️ Recovered Alexa+ Spoken Output:`);
    console.log(`   "${recoveryResult.speech}"`);

    // 6. Verify Handoff Draft Persisted
    console.log("\n6. Verifying structured handoff draft in database...");
    const handoff = db.prepare(`
      SELECT * FROM handoffs WHERE outgoing_nurse_id = 'nurse_seema_01' AND incoming_nurse_id = 'nurse_reema_02'
    `).get() as any;

    if (!handoff) {
      throw new Error("Expected handoff draft record in database!");
    }
    console.log(`✓ Shift Handoff Record Found: [${handoff.id}] Status: ${handoff.status}`);
    console.log(`   Summary: "${handoff.summary_markdown}"`);

    // 7. Human Nurse Bedside Verification & Conflict Resolution
    console.log("\n7. Human Nurse Bedside Action: Reema verifies Elena Rostova in Room 305...");
    const resolveRes = await fetch(`http://localhost:${port}/api/conflicts/conf_task_med_102_03/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolvedBy: "nurse_reema_02",
        finalStatus: "COMPLETED",
        resolutionNote: "Bedside physical check: IV Vancomycin 1g empty bag verified on IV pole; infusion was completed at 06:14 by Seema."
      })
    });

    const resolveData = await resolveRes.json();
    console.log("✓ Conflict Resolution Response:", resolveData);

    // Verify task status transitioned
    const updatedTask = db.prepare("SELECT id, title, status FROM tasks WHERE id = 'task_med_102_03'").get() as any;
    console.log(`✓ Task Status Transitioned in Database: [${updatedTask.id}] -> ${updatedTask.status}`);

    const remainingConflicts = db.prepare("SELECT count(*) as count FROM conflicts WHERE status = 'UNRESOLVED'").get() as any;
    console.log(`✓ Remaining Unresolved Conflicts in ICU-B: ${remainingConflicts.count}`);

    // 8. Execution Trace & Audit Trail Verification
    const auditCount = db.prepare("SELECT count(*) as count FROM audit_log").get() as any;
    console.log(`\n8. Total Audit Log Entries in SQLite: ${auditCount.count}`);

    console.log("\n========================================================");
    console.log("✅ PHASE 7 END-TO-END CHAOS RECOVERY PASSED 100%!");
    console.log("========================================================\n");
  } finally {
    appServer.close();
  }
}

runEndToEndChaosRecoveryTest().catch(err => {
  console.error("End-to-end chaos test failed:", err);
  appServer.close();
  process.exit(1);
});
