import { VoiceService, type VoiceInput } from './voice.service.js';
import { ShiftWeaveOrchestrator } from '../agent/orchestrator.js';
import { db } from '../db/connection.js';
import { canonicalJson } from './canonical-json.js';
import { AuditService } from './audit.service.js';
import { MCPClientBridge } from '../agent/mcp-client-bridge.js';

const busy = new Set<string>();
/** Await remote calls outside SQLite transactions; commit the display only at the expected revision. */
export async function runVoiceTurn(input: VoiceInput, endpoint: string) {
  if (busy.has(input.session_id)) throw new Error('Voice session busy; retry the same request');
  busy.add(input.session_id);
  const start = Date.now();
  let succeeded = false;
  try {
    const receipt = db.prepare('SELECT request_json, response_json FROM operation_receipts WHERE idempotency_key = ?')
      .get(`voice-turn:${input.idempotency_key}`) as { request_json: string; response_json: string } | undefined;
    if (receipt) {
      if (receipt.request_json !== canonicalJson(input)) throw new Error('Idempotency key was already used for a different request');
      succeeded = true;
      return JSON.parse(receipt.response_json);
    }
    const epic = input.utterance.match(/^read epic patient ([A-Za-z0-9.-]+)$/i);
    const syncEpic = /^(?:sync|refresh|connect) epic(?: patients| records| workspace)?[.!]?$/i.test(input.utterance.trim());
    if (!epic && !syncEpic && !/^(?:alexa[, ]+)?ask assistant[, :]+/i.test(input.utterance)) {
      const result = VoiceService.turn(input); succeeded = true; return result;
    }
    const display = VoiceService.read(input.session_id);
    if (display.revision !== input.expected_revision) throw new Error('Voice session changed. Refresh before speaking again.');
    if (!display.nurse || !display.shift) { const result = VoiceService.turn(input); succeeded = true; return result; }
    if (syncEpic) {
      const bridge = new MCPClientBridge(endpoint);
      try {
        await bridge.initialize();
        const response = await bridge.callTool('sync_epic_workspace', { nurse_id: display.nurse.id, shift_id: display.shift.id, idempotency_key: input.idempotency_key });
        if (response.isError) throw new Error(response.content.map(c => c.text).join('\n'));
        const result = JSON.parse(response.content[0]!.text);
        const saved = VoiceService.saveAssistantTurn(input, `Epic workspace sync is ${result.status}. ` +
          result.results.map((r: any) => `${r.patientId}: ${r.status}${r.error ? ` — ${r.error}` : ''}.`).join(' ') +
          ' Source records and local review tasks are on screen. Medication orders are not administration records; existing task custody is unchanged.');
        succeeded = true; return saved;
      } finally { await bridge.close(); }
    }
    if (epic) {
      const bridge = new MCPClientBridge(endpoint);
      try {
        await bridge.initialize();
        const response = await bridge.callTool('get_epic_patient_context', {
          patient_id: epic[1], idempotency_key: input.idempotency_key });
        if (response.isError) throw new Error(response.content.map(c => c.text).join('\n'));
        const { context } = JSON.parse(response.content[0]!.text);
        const saved = VoiceService.saveAssistantTurn(input, `Epic returned source records for ${context.patient.fullName}, retrieved ${context.retrievedAt}. ` +
          `${context.encounters.length} encounters, ${context.medicationOrders.length} medication orders, and ${context.documents.length} document references. ` +
          'These are supplemental records. Document contents and medication administration have not been verified; local nurse assignments are unchanged.');
        succeeded = true; return saved;
      } finally { await bridge.close(); }
    }
    // Read-only planning cannot manufacture human confirmation or change workflow custody.
    const agent = new ShiftWeaveOrchestrator(endpoint, process.env.LLM_PROVIDER || 'mock',
      `voice-agent:${input.session_id}:${display.nurse.id}:${display.shift.id}`, true);
    try {
      await agent.initialize();
      const result = await agent.processUtterance(display.nurse.id,
        input.utterance.replace(/^(?:alexa[, ]+)?ask assistant[, :]+/i, ''), {
          shiftId: display.shift.id, outgoingNurseId: display.nurse.id, incomingNurseId: display.nurse.id,
          requestKey: input.idempotency_key
        });
      const saved = VoiceService.saveAssistantTurn(input, result.speech);
      succeeded = true; return saved;
    } finally { await agent.close(); }
  } finally {
    busy.delete(input.session_id);
    AuditService.log({ actorType: 'SYSTEM', actorId: 'voice-gateway', action: 'VOICE:TURN_FINISHED',
      targetResource: `voice:${input.session_id}`, outcome: succeeded ? 'SUCCESS' : 'FAILURE', latencyMs: Date.now() - start,
      details: { metric: 'server_turn_duration_ms', receiptCommitted: Boolean(db.prepare(
        'SELECT 1 FROM operation_receipts WHERE idempotency_key = ?').get(`voice-turn:${input.idempotency_key}`)) } });
  }
}
