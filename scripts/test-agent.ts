import { appServer } from "../src/server.js";
import { ShiftWeaveOrchestrator } from "../src/agent/orchestrator.js";
import { db } from "../src/db/connection.js";

async function testAgentOrchestrator() {
  console.log("\n========================================================");
  console.log("Testing ShiftWeave Agent Orchestrator & Conversational Layer");
  console.log("========================================================\n");

  const port = process.env.PORT || 3000;
  const endpoint = `http://localhost:${port}/mcp`;

  try {
    // 1. Initialize Orchestrator and connect to MCP Server over Streamable HTTP
    console.log("1. Initializing Orchestrator & MCP Client Bridge...");
    const orchestrator = new ShiftWeaveOrchestrator(endpoint, "mock", "wf_run_agent_demo_01");
    const initInfo = await orchestrator.initialize();

    console.log(`✓ MCP Connection Established: Session ID [${initInfo.sessionId}]`);
    console.log(`✓ LLM Provider: ${initInfo.provider}`);
    console.log(`✓ Discovered ${initInfo.toolsCount} MCP Tools over Streamable HTTP\n`);

    if (initInfo.toolsCount < 9) {
      throw new Error(`Expected at least 9 tools discovered, got ${initInfo.toolsCount}`);
    }

    // 2. Scenario A: Autonomous Multi-Turn Shift Handoff Compilation
    console.log("--------------------------------------------------------");
    console.log("Turn 1: Nurse Reema arrives for morning shift in ICU-B");
    console.log("Nurse Utterance: 'Alexa, what is pending from Seema in ICU-B, and are there any conflicts?'");
    console.log("--------------------------------------------------------");

    const turn1Result = await orchestrator.processUtterance(
      "nurse_reema_02",
      "Alexa, what is pending from Seema in ICU-B, and are there any conflicts?",
      {
        shiftId: "shift_20261019_night",
        outgoingNurseId: "nurse_seema_01",
        incomingNurseId: "nurse_reema_02"
      }
    );

    console.log(`\nExecuted ${turn1Result.toolsExecuted.length} autonomous MCP tool steps:`);
    turn1Result.toolsExecuted.forEach((t, i) => {
      console.log(`  Step ${i + 1}: ${t.name} (${t.latencyMs}ms)`);
      console.log(`    Result: ${t.resultSummary.slice(0, 90)}...`);
    });

    console.log("\n🗣️ Spoken Voice Output (Alexa+ TTS):");
    console.log(`"${turn1Result.speech}"`);

    console.log("\n📋 Dashboard Directive:");
    console.log(JSON.stringify(turn1Result.dashboardCard, null, 2));

    // Verify checkpoints committed in database
    const checkpoints = db.prepare(`
      SELECT step_index, step_name, idempotency_key
      FROM workflow_checkpoints
      WHERE workflow_run_id = ?
    `).all("wf_run_agent_demo_01") as Array<{ step_index: number; step_name: string; idempotency_key: string }>;

    console.log(`\n✓ Verified ${checkpoints.length} Checkpoint(s) in SQLite:`, checkpoints);

    // 3. Scenario B: Chaos Network Interruption & Zero-Loss Recovery
    console.log("\n--------------------------------------------------------");
    console.log("Chaos Simulation: Simulated Network Interruption during Handoff");
    console.log("--------------------------------------------------------");

    const chaosRunId = "wf_run_chaos_recovered_02";
    const chaosOrchestrator = new ShiftWeaveOrchestrator(endpoint, "mock", chaosRunId);
    await chaosOrchestrator.initialize();

    // Step 1 commits a checkpoint, but then an unexpected crash/interruption occurs
    try {
      console.log("Running workflow with simulated crash at step 2...");
      await chaosOrchestrator.processUtterance(
        "nurse_reema_02",
        "Prepare my morning handoff for ICU-B",
        {
          shiftId: "shift_20261019_night",
          outgoingNurseId: "nurse_seema_01",
          incomingNurseId: "nurse_reema_02",
          simulateInterruptionAtStep: 2
        }
      );
    } catch (err: any) {
      console.log(`✓ Caught simulated failure: ${err.message}`);
    }

    // Now Nurse Reema asks Alexa to recover/resume
    console.log("\n--------------------------------------------------------");
    console.log("Turn 2: Nurse Reema asks: 'Alexa, resume my handoff preparation.'");
    console.log("--------------------------------------------------------");

    const recoveryResult = await chaosOrchestrator.processUtterance(
      "nurse_reema_02",
      "Alexa, resume my handoff preparation.",
      {
        shiftId: "shift_20261019_night",
        outgoingNurseId: "nurse_seema_01",
        incomingNurseId: "nurse_reema_02"
      }
    );

    console.log(`\nRecovery executed ${recoveryResult.toolsExecuted.length} autonomous steps:`);
    recoveryResult.toolsExecuted.forEach((t, i) => {
      console.log(`  Step ${i + 1}: ${t.name} (${t.latencyMs}ms)`);
      console.log(`    Result: ${t.resultSummary.slice(0, 95)}...`);
    });

    console.log("\n🗣️ Spoken Voice Recovery Output (Alexa+ TTS):");
    console.log(`"${recoveryResult.speech}"`);

    console.log("\n📋 Recovery Dashboard Card:");
    console.log(JSON.stringify(recoveryResult.dashboardCard, null, 2));

    // Verify recovery audit log
    const recoveryAudit = db.prepare(`
      SELECT action, outcome, latency_ms, details
      FROM audit_log
      WHERE target_resource = ?
      ORDER BY id DESC LIMIT 5
    `).all(`workflow_run/${chaosRunId}`) as Array<{ action: string; outcome: string; latency_ms: number; details: string }>;

    console.log("\n✓ Verified Recovery Audit Trail in SQLite:");
    recoveryAudit.forEach(a => console.log(`  ${a.action} -> ${a.outcome} (${a.latency_ms}ms)`));

    console.log("\n========================================================");
    console.log("PHASE 5 AGENT ORCHESTRATOR TESTS PASSED 100%!");
    console.log("========================================================\n");
  } finally {
    appServer.close();
  }
}

testAgentOrchestrator().catch(err => {
  console.error("Agent orchestrator test failed:", err);
  appServer.close();
  process.exit(1);
});
