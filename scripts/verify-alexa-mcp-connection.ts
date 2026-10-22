/**
 * Verification Script: Alexa+ MCP Voice Agent Integration
 * Tests the Model Context Protocol (MCP 2025-11-25) over Streamable HTTP (/mcp)
 * simulating an external Alexa+ cloud client invoking ShiftWeave tools.
 */

import { MCPClientBridge } from '../src/agent/mcp-client-bridge.js';

async function main() {
  const endpoint = process.argv[2] || process.env.PUBLIC_MCP_URL || process.env.MCP_SERVER_URL;
  if (!endpoint || !process.env.MCP_TEST_NURSE_ID || !process.env.MCP_TEST_INCOMING_NURSE_ID || !process.env.MCP_TEST_SHIFT_ID) {
    throw new Error('Configure MCP_SERVER_URL, MCP_TEST_NURSE_ID, MCP_TEST_INCOMING_NURSE_ID and MCP_TEST_SHIFT_ID with existing records');
  }
  console.log(`\n======================================================`);
  console.log(`📡 Alexa+ MCP Server Connection & Protocol Verification`);
  console.log(`   Target Endpoint: ${endpoint}`);
  console.log(`======================================================\n`);

  const bridge = new MCPClientBridge(endpoint);

  try {
    // 1. Handshake & Initialization
    console.log(`[1/4] Performing MCP 2025-11-25 Streamable HTTP Handshake...`);
    const initStart = Date.now();
    const session = await bridge.initialize();
    const initLatency = Date.now() - initStart;

    console.log(`  ✓ Handshake Successful! (${initLatency}ms)`);
    console.log(`    - Server Name:    ${session.serverName}`);
    console.log(`    - Spec Version:   ${session.version}`);
    console.log(`    - MCP Session ID: ${session.sessionId}`);

    // 2. Runtime Tool Discovery (tools/list)
    console.log(`\n[2/4] Introspecting MCP Tools (tools/list)...`);
    const listStart = Date.now();
    const tools = await bridge.listTools();
    const listLatency = Date.now() - listStart;

    console.log(`  ✓ Discovered ${tools.length} Tools (${listLatency}ms):`);
    for (const tool of tools) {
      console.log(`    • ${tool.name.padEnd(30)}: ${tool.description.slice(0, 70)}...`);
    }

    // 3. Alexa+ Simulation Turn 1: Get Assigned Tasks
    console.log(`\n[3/4] Simulating Medi Voice Query: "Medi, what tasks did Seema leave?"`);
    const taskStart = Date.now();
    const taskResult = await bridge.callTool('get_assigned_tasks', {
      nurse_id: process.env.MCP_TEST_NURSE_ID,
      shift_id: process.env.MCP_TEST_SHIFT_ID
    });
    const taskLatency = Date.now() - taskStart;

    if (taskResult.isError) {
      throw new Error(`get_assigned_tasks failed: ${taskResult.content.map(c => c.text).join('\n')}`);
    }

    const taskData = JSON.parse(taskResult.content[0]?.text || '{}');
    console.log(`  ✓ Tool Execution Successful (${taskLatency}ms) [Latency < 500ms SLA: ${taskLatency < 500 ? 'PASS' : 'WARN'}]`);
    console.log(`    - Returned Tasks: ${taskData.tasks_count}`);
    console.log(`    - Provider:       ${taskData.provider}`);

    // 4. Alexa+ Simulation Turn 2: Retrieve Handoff Context
    console.log(`\n[4/4] Simulating Medi Voice Query: "Medi, summarize the handoff for ICU Bed 305"`);
    const handoffStart = Date.now();
    const handoffResult = await bridge.callTool('get_handoff_context', {
      outgoing_nurse_id: process.env.MCP_TEST_NURSE_ID,
      incoming_nurse_id: process.env.MCP_TEST_INCOMING_NURSE_ID,
      shift_id: process.env.MCP_TEST_SHIFT_ID
    });
    const handoffLatency = Date.now() - handoffStart;

    if (handoffResult.isError) {
      throw new Error(`get_handoff_context failed: ${handoffResult.content.map(c => c.text).join('\n')}`);
    }

    const handoffData = JSON.parse(handoffResult.content[0]?.text || '{}');
    console.log(`  ✓ Handoff Synthesis Successful (${handoffLatency}ms)`);
    console.log(`    - Patient Roster: ${handoffData.patients?.length || 0} patients`);
    console.log(`    - Active Alerts:  ${handoffData.discrepancies?.length || 0} discrepancy items flagged for nurse review`);

    console.log(`\n======================================================`);
    console.log(`🎉 VERIFICATION COMPLETE: ALL 4 CHECKS PASSED!`);
    console.log(`   ShiftWeave MCP Server is ready to serve Alexa+ Voice Agent.`);
    console.log(`======================================================\n`);
  } catch (error) {
    console.error(`\n❌ Error during Alexa+ MCP verification:`, error);
    process.exitCode = 1;
  } finally {
    await bridge.close();
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
