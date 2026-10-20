import { ShiftWeaveOrchestrator } from '../src/agent/orchestrator.js';
import { MCPClientBridge } from '../src/agent/mcp-client-bridge.js';

if (process.env.SHIFTWEAVE_TEST !== '1') throw new Error('This worker requires the isolated test runner');
const runId = process.argv[3]!;
if (process.argv[2] === 'crash') {
  const original = MCPClientBridge.prototype.callTool;
  MCPClientBridge.prototype.callTool = async function(name, args) {
    const result = await original.call(this, name, args);
    // Real process exit after the domain write commits, before its result checkpoint is persisted.
    if (name === 'create_handoff_draft' && !result.isError) process.exit(77);
    return result;
  };
}
const agent = new ShiftWeaveOrchestrator(process.env.MCP_SERVER_URL, 'mock', runId);
await agent.initialize();
try {
  const result = await agent.processUtterance('nurse_reema_02', process.argv[2] === 'crash' ? 'Prepare my handoff draft' : 'Resume handoff');
  console.log('WORKER_RESULT:' + JSON.stringify(result));
} finally { await agent.close(); }
