import 'dotenv/config';
import assert from 'node:assert/strict';
import { MCPClientBridge } from '../src/agent/mcp-client-bridge.js';

const endpoint = process.env.MCP_SERVER_URL || 'http://127.0.0.1:3000/mcp';
const bridge = new MCPClientBridge(endpoint);
try {
  const started = Date.now();
  const handshake = await bridge.initialize();
  const tools = await bridge.listTools();
  for (const name of ['get_assigned_tasks', 'resume_workflow', 'voice_turn', 'get_epic_patient_context']) {
    assert(tools.some(t => t.name === name), `Missing tool: ${name}`);
  }
  console.log(JSON.stringify({ protocol: handshake.version, toolCount: tools.length,
    discoveryMs: Date.now() - started, externalServices: 'NOT_TESTED', mutations: 'NONE' }, null, 2));
} finally { await bridge.close(); }
