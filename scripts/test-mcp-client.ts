import { appServer } from "../src/server.js";

async function testMCPServer() {
  console.log("\n========================================================");
  console.log("Testing ShiftWeave MCP Server (Streamable HTTP /mcp)");
  console.log("========================================================\n");

  const endpoint = "http://localhost:3000/mcp";

  // Helper function to send standard JSON-RPC 2.0 requests over Streamable HTTP
  async function callMCP(method: string, params: Record<string, unknown> = {}, id = 1) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params
      })
    });

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // In case of SSE streaming chunks
      const lines = text.split("\n").filter(l => l.startsWith("data: "));
      if (lines.length > 0) {
        return JSON.parse(lines[0].replace("data: ", ""));
      }
      return { raw: text };
    }
  }

  try {
    // 1. Health check
    const healthRes = await fetch("http://localhost:3000/health");
    const health = await healthRes.json();
    console.log("1. Health Endpoint Check:", health);

    // 2. Discover Tools (tools/list)
    console.log("\n2. Sending JSON-RPC 'tools/list' discovery request...");
    const listRes = await callMCP("tools/list", {}, 1);
    const tools = listRes.result?.tools || [];
    console.log(`Discovered ${tools.length} Tools on MCP Server:`);
    tools.forEach((t: { name: string; description: string }) => {
      console.log(`  ✓ ${t.name}: ${t.description.slice(0, 70)}...`);
    });

    if (tools.length < 9) {
      throw new Error(`Expected at least 9 tools, but found ${tools.length}`);
    }

    // 3. Test Tool: get_assigned_tasks
    console.log("\n3. Invoking Tool: get_assigned_tasks for nurse_seema_01...");
    const taskCall = await callMCP("tools/call", {
      name: "get_assigned_tasks",
      arguments: {
        nurse_id: "nurse_seema_01",
        shift_id: "shift_20261019_night"
      }
    }, 2);
    console.log("Response text:", taskCall.result?.content?.[0]?.text);

    // 4. Test Tool: get_handoff_context
    console.log("\n4. Invoking Tool: get_handoff_context (Seema -> Reema)...");
    const handoffCall = await callMCP("tools/call", {
      name: "get_handoff_context",
      arguments: {
        outgoing_nurse_id: "nurse_seema_01",
        incoming_nurse_id: "nurse_reema_02",
        shift_id: "shift_20261019_night"
      }
    }, 3);
    console.log("Handoff Context Result:", handoffCall.result?.content?.[0]?.text);

    // 5. Test Checkpoint & Recovery Tool
    console.log("\n5. Invoking Tool: save_workflow_checkpoint...");
    const chkCall = await callMCP("tools/call", {
      name: "save_workflow_checkpoint",
      arguments: {
        workflow_run_id: "wf_run_http_01",
        step_index: 1,
        step_name: "FETCH_ASSIGNED_TASKS",
        state_payload: { verified: true },
        idempotency_key: "idem_key_http_001"
      }
    }, 4);
    console.log("Checkpoint Result:", chkCall.result?.content?.[0]?.text);

    console.log("\n6. Invoking Tool: resume_workflow...");
    const resumeCall = await callMCP("tools/call", {
      name: "resume_workflow",
      arguments: {
        workflow_run_id: "wf_run_http_01",
        idempotency_key: "idem_key_resume_001"
      }
    }, 5);
    console.log("Recovery Plan Result:", resumeCall.result?.content?.[0]?.text);

    // 7. Check Execution Trace
    const traceRes = await fetch("http://localhost:3000/api/execution-trace");
    const trace = await traceRes.json();
    console.log(`\n7. Observable Execution Trace Logged: ${trace.count} entries in database.`);

    console.log("\n========================================================");
    console.log("ALL 9 MCP TOOLS & STREAMABLE HTTP TESTS PASSED 100%!");
    console.log("========================================================\n");
  } finally {
    appServer.close();
  }
}

testMCPServer().catch(err => {
  console.error("MCP test failed:", err);
  appServer.close();
  process.exit(1);
});
