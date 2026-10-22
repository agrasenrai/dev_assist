import 'dotenv/config';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

// No application imports: open the configured database read-only, without migrations or fixtures.
const databasePath = process.env.SQLITE_DB_PATH;
if (!databasePath) throw new Error('SQLITE_DB_PATH is required');
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const client = new Client({ name: 'configured-database-verification', version: '1.0.0' });
try {
  assert.equal(database.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  const assignment = database.prepare(`SELECT a.nurse_id, a.shift_id FROM task_assignments a
    JOIN nurses n ON n.id=a.nurse_id JOIN shifts s ON s.id=a.shift_id AND s.unit_id=n.department
    WHERE a.transfer_status IN ('ACTIVE','CARRIED_FORWARD') ORDER BY a.id LIMIT 1`).get() as { nurse_id: string; shift_id: string } | undefined;
  assert(assignment, 'No stored assignment is available for verification');
  const endpoint = process.env.MCP_SERVER_URL || `http://127.0.0.1:${process.env.PORT || 3000}/mcp`;
  const headers: Record<string, string> = {};
  if (process.env.MCP_AUTH_TOKEN) headers.Authorization = `Bearer ${process.env.MCP_AUTH_TOKEN}`;
  if (process.env.MCP_TEST_STAFF_SESSION) headers['X-ShiftWeave-Staff-Session'] = process.env.MCP_TEST_STAFF_SESSION;
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers } }) as Transport);
  const tools = await client.listTools();
  assert(tools.tools.some(t => t.name === 'get_assigned_tasks'));
  const response = await client.callTool({ name: 'get_assigned_tasks', arguments: assignment });
  assert(!response.isError, 'Configured MCP read failed; check server and existing access controls');
  const actual = JSON.parse((response.content as { text: string }[])[0]!.text);
  const expected = database.prepare(`SELECT t.id,t.status,t.title FROM tasks t JOIN task_assignments a ON a.task_id=t.id
    WHERE a.nurse_id=? AND a.shift_id=? AND a.transfer_status IN ('ACTIVE','CARRIED_FORWARD') ORDER BY t.id`).all(assignment.nurse_id, assignment.shift_id);
  assert.deepEqual(actual.tasks.map((t: { id: string; status: string; title: string }) => ({ id: t.id, status: t.status, title: t.title })).sort((a: {id:string}, b: {id:string}) => a.id.localeCompare(b.id)), expected);
  console.log(`PASS configured SQLite integrity and official SDK MCP discovery (${tools.tools.length} tools); ${expected.length} returned tasks match stored IDs, titles and statuses. No clinical writes or fixture imports.`);
} finally {
  await client.close();
  database.close();
}
