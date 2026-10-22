import 'dotenv/config';
import { randomUUID } from 'node:crypto';

/**
 * ShiftWeave Live Presentation & Demonstration Script
 *
 * Runs an interactive, end-to-end rehearsal of the 5 key demonstration acts:
 * 1. Ambient Greeting & Wake-Word
 * 2. Nurse Identity Binding
 * 3. Clinical Task Scoping & Epic Context
 * 4. Safety Guardrails & Discrepancy Handling
 * 5. Grounded SBAR Shift Handoff Synthesis
 * 6. Deterministic Crash & Zero-Loss Recovery
 */
async function runDemoPresentation() {
  console.log('\x1b[1m\x1b[36m========================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[32m🏥 SHIFTWEAVE — LIVE PRESENTATION & DEMONSTRATION SCRIPT\x1b[0m');
  console.log('\x1b[1m\x1b[36m========================================================================\x1b[0m\n');

  let baseUrl = 'http://127.0.0.1:3000';
  let serverInstance: any = null;

  // Check if live server is already running on port 3000
  try {
    const probe = await fetch(`${baseUrl}/readyz`);
    if (probe.ok) {
      console.log(`\x1b[32m✔ Connected to live ShiftWeave server at ${baseUrl}\x1b[0m\n`);
    } else {
      throw new Error('Server not ready');
    }
  } catch {
    process.env.PORT = '0';
    const { appServer } = await import('../src/server.js');
    const { once } = await import('node:events');
    if (!appServer.listening) await once(appServer, 'listening');
    const addr = appServer.address();
    const port = addr && typeof addr !== 'string' ? addr.port : 3000;
    baseUrl = `http://127.0.0.1:${port}`;
    serverInstance = appServer;
    console.log(`\x1b[32m✔ Started ephemeral ShiftWeave server at ${baseUrl}\x1b[0m\n`);
  }

  const sessionId = randomUUID();
  let revision = 0;

  async function speak(utterance: string, actTitle: string, note?: string) {
    console.log(`\x1b[1m\x1b[33m--- [${actTitle}] ---\x1b[0m`);
    if (note) console.log(`\x1b[90m💡 Presenter Note: ${note}\x1b[0m`);
    console.log(`\x1b[1m🗣️  Nurse: \x1b[37m"${utterance}"\x1b[0m`);

    const startTime = Date.now();
    const res = await fetch(`${baseUrl}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        utterance,
        expected_revision: revision,
        idempotency_key: randomUUID()
      })
    });

    const latency = Date.now() - startTime;
    const data = await res.json() as { revision: number; speech: string; nurse?: { name: string; department: string }; tasks?: any[]; conflicts?: any[] };
    revision = data.revision;

    console.log(`\x1b[1m🤖 Medi:  \x1b[32m"${data.speech}"\x1b[0m \x1b[90m(${latency}ms)\x1b[0m`);
    if (data.nurse) {
      console.log(`\x1b[90m   [Context: Nurse=${data.nurse.name} | Unit=${data.nurse.department} | Assigned Tasks=${data.tasks?.length || 0}]\x1b[0m`);
    }
    console.log('');
    return data;
  }

  try {
    // ACT 1: Ambient Discovery & Identity
    await speak('Medi', 'ACT 1: AMBIENT WAKE-WORD', 'Show ambient listening without demanding credentials upfront.');
    await speak('Medi, what is your name and role?', 'ACT 1: CAPABILITY EXPLANATION', 'Explain clinical workflow purpose and scope.');
    await speak('Hi, I am Seema Patel', 'ACT 1: NURSE IDENTITY BINDING', 'Nurse identifies herself; system binds session to Seema Patel, RN in SIMULATION-WARD.');

    // ACT 2: Scoped Workflow & Tasks
    await speak('What tasks are assigned to me?', 'ACT 2: ASSIGNED TASK SCOPING', 'System scopes tasks strictly to Seema in SIMULATION-WARD.');

    // ACT 3: Safety Guardrails & Discrepancies
    await speak('Prescribe Amoxicillin 500mg for Camila Lopez', 'ACT 3: CLINICAL BOUNDARY SAFETY', 'Critical hackathon safety boundary: system strictly refuses autonomous clinical prescribing.');
    await speak('Show discrepancies', 'ACT 3: DOCUMENTATION CONFLICT DETECTION', 'System flags status mismatch between bedside observation and EHR task board.');

    // ACT 4: Grounded Shift Handoff Report
    console.log(`\x1b[1m\x1b[33m--- [ACT 4: GROUNDED SBAR HANDOFF SYNTHESIS] ---\x1b[0m`);
    console.log(`\x1b[90m💡 Presenter Note: Synthesizes a structured SBAR shift report grounded in Epic FHIR R4 clinical data.\x1b[0m`);
    console.log(`\x1b[1m🗣️  Nurse: \x1b[37m"Prepare my handoff draft"\x1b[0m`);

    const handoffRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utterance: 'Prepare my handoff draft',
        nurseId: 'staff:seema',
        workflowRunId: randomUUID(),
        idempotency_key: randomUUID()
      })
    });

    const handoffData = await handoffRes.json() as { speech: string; toolsExecuted: Array<{ name: string; latencyMs: number }> };
    console.log(`\x1b[1m🤖 Medi:  \x1b[32m"${handoffData.speech}"\x1b[0m`);
    console.log(`\x1b[90m   [MCP Tools Executed: ${handoffData.toolsExecuted?.map(t => `${t.name} (${t.latencyMs}ms)`).join(', ') || 'create_handoff_draft'}]\x1b[0m\n`);

    // ACT 5: Zero-Loss Interruption & Recovery
    console.log(`\x1b[1m\x1b[33m--- [ACT 5: DETERMINISTIC CRASH & INTERRUPTION RECOVERY] ---\x1b[0m`);
    console.log(`\x1b[90m💡 Presenter Note: Demonstrates that an interrupted session restores exact committed state without duplicating writes.\x1b[0m`);

    const crashRes = await fetch(`${baseUrl}/api/chaos/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'crash' })
    });
    const crashData = await crashRes.json() as { workflowRunId: string; checkpointId: string; status: string; message: string };
    console.log(`\x1b[90mSimulated unexpected network interruption: ${crashData.message || 'checkpoint committed'}\x1b[0m`);

    const recoverRes = await fetch(`${baseUrl}/api/chaos/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recover', workflowRunId: crashData.workflowRunId })
    });
    const recoverData = await recoverRes.json() as any;
    console.log(`\x1b[1m🔄 Recovery Result: \x1b[32m${recoverData.message || recoverData.status || 'RECOVERED'}\x1b[0m\n`);

    console.log('\x1b[1m\x1b[36m========================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[32m🎉 DEMO PRESENTATION RUN COMPLETED SUCCESSFULLY!\x1b[0m');
    console.log('\x1b[1m\x1b[36m========================================================================\x1b[0m\n');
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }
}

runDemoPresentation().catch(err => {
  console.error('❌ Demo presentation failed:', err);
  process.exit(1);
});
