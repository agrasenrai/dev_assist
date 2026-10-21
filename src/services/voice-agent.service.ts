import { VoiceService, type VoiceInput } from './voice.service.js';
import { ShiftWeaveOrchestrator } from '../agent/orchestrator.js';
import { db } from '../db/connection.js';
import { canonicalJson } from './canonical-json.js';
import { AuditService } from './audit.service.js';
import { MCPClientBridge } from '../agent/mcp-client-bridge.js';
import { StaffAuthService } from './staff-auth.service.js';
import { currentStaff, staffAuthRequired } from './staff-context.js';
import { getLLMProvider, type AgentMessage } from '../agent/llm-provider.js';
import { CheckpointService } from './checkpoint.service.js';
import { createHash } from 'node:crypto';

const busy = new Set<string>();

async function runConversation(input: VoiceInput) {
  const display = VoiceService.read(input.session_id);
  if (display.revision !== input.expected_revision) throw new Error('Voice session changed. Refresh before speaking again.');
  const provider = getLLMProvider();
  const key = `voice-model:${input.idempotency_key}`;
  const requestJson = canonicalJson({input,provider:provider.providerId});
  const existing = db.prepare('SELECT request_json,response_json FROM operation_receipts WHERE idempotency_key=?').get(key) as any;
  try {
    if (existing) {
      if (existing.request_json !== requestJson) throw new Error('Conversation request key was reused for a different request');
      const saved = JSON.parse(existing.response_json);
      return VoiceService.saveAssistantTurn(input,saved.speech,{provider:saved.provider,status:saved.status});
    }
    const actorId = currentStaff()?.id || display.nurse?.id || 'voice-demo';
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO workflow_runs (id,workflow_type,initiated_by,status)
        VALUES (?,'GENERATE_HANDOFF',?,'IN_PROGRESS')`).run(key,actorId);
      CheckpointService.saveCheckpoint(key,1,'VOICE_LLM_INTENT',
        {sessionId:input.session_id,revision:input.expected_revision,provider:provider.providerId,
          requestHash:createHash('sha256').update(requestJson).digest('hex')},`${key}:intent`);
    }).immediate();
    const messages: AgentMessage[] = VoiceService.conversationContext(input.session_id).map(message => ({
      role:message.role === 'nurse' ? 'user' : 'assistant',content:message.text
    }));
    messages.push({role:'user',content:input.utterance});
    const started = Date.now();
    let speech: string;
    let status: 'SUCCESS' | 'FAILED';
    try {
      const result = await provider.decideNextStep(messages,[],{voiceConversation:true});
      if (result.toolCall || !result.finalSpeech?.trim()) throw new Error('Conversation model must return text without actions');
      speech = result.finalSpeech.trim(); status = 'SUCCESS';
    } catch {
      // No canned reply is presented as a successful model response, and provider errors cannot leak secrets.
      speech = "I couldn't reach my conversation model right now. Please try again. No records were changed.";
      status = 'FAILED';
    }
    const saved = {speech,status,provider:provider.providerId};
    db.transaction(() => {
      db.prepare('INSERT INTO operation_receipts (idempotency_key,operation,request_json,response_json) VALUES (?,?,?,?)')
        .run(key,'VOICE_MODEL_REPLY',requestJson,JSON.stringify(saved));
      CheckpointService.saveCheckpoint(key,2,'VOICE_LLM_RESULT',saved,`${key}:result`);
      if (status === 'SUCCESS') CheckpointService.completeWorkflowRun(key);
      else db.prepare("UPDATE workflow_runs SET status='FAILED',error_message='Conversation model unavailable' WHERE id=?").run(key);
      AuditService.log({actorType:'AGENT',actorId,action:'LLM:VOICE_CONVERSATION',targetResource:`voice:${input.session_id}`,
        outcome:status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',latencyMs:Date.now()-started,
        details:{provider:provider.providerId,toolsEnabled:false,status}});
    }).immediate();
    return VoiceService.saveAssistantTurn(input,speech,{provider:provider.providerId,status});
  } finally { provider.close?.(); }
}

/** Await remote calls outside SQLite transactions; commit the display only at the expected revision. */
export async function runVoiceTurn(input: VoiceInput, endpoint: string) {
  // Authorize even an exact saved-response retry before reading its receipt.
  if (staffAuthRequired()) StaffAuthService.bindVoiceSession(input.session_id);
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
    const command = VoiceService.commandText(input.utterance);
    const epic = command.match(/^read epic patient ([A-Za-z0-9.-]+)$/i);
    const syncEpic = /^(?:sync|refresh|connect) epic(?: patients| records| workspace)?[.!]?$/i.test(command);
    if (!epic && !syncEpic && !/^ask assistant[, :]+/i.test(command)) {
      if ((process.env.LLM_PROVIDER || 'mock').toLowerCase() !== 'mock' && VoiceService.isConversational(input)) {
        const result = await runConversation(input); succeeded = true; return result;
      }
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
        command.replace(/^ask assistant[, :]+/i, ''), {
          shiftId: display.shift.id, outgoingNurseId: display.nurse.id, incomingNurseId: display.nurse.id,
          requestKey: input.idempotency_key
        });
      const saved = VoiceService.saveAssistantTurn(input, result.speech);
      succeeded = true; return saved;
    } finally { await agent.close(); }
  } finally {
    busy.delete(input.session_id);
    AuditService.log({ actorType: 'SYSTEM', actorId: currentStaff()?.id || 'voice-gateway', action: 'VOICE:TURN_FINISHED',
      targetResource: `voice:${input.session_id}`, outcome: succeeded ? 'SUCCESS' : 'FAILURE', latencyMs: Date.now() - start,
      details: { metric: 'server_turn_duration_ms', receiptCommitted: Boolean(db.prepare(
        'SELECT 1 FROM operation_receipts WHERE idempotency_key = ?').get(`voice-turn:${input.idempotency_key}`)) } });
  }
}
