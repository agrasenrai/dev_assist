import { scopedWorkflow } from '../services/source-policy.js';
import { MCPClientBridge, type MCPToolDefinition } from "./mcp-client-bridge.js";
import { getLLMProvider, MockAutonomousAgent, type ILLMProvider, type AgentMessage, type AgentTurnResult, type ToolCallDecision } from "./llm-provider.js";
import { AuditService } from "../services/audit.service.js";
import { CheckpointService } from "../services/checkpoint.service.js";
import { db } from "../db/connection.js";
import { randomUUID } from "crypto";
import { canonicalJson } from '../services/canonical-json.js';
import { sourceVersion } from '../services/source-version.js';
import { resolveNurseShift } from '../services/shift-context.js';

export interface OrchestrationResult {
  speech: string;
  workflowRunId: string;
  toolsExecuted: Array<{ name: string; args: Record<string, unknown>; resultSummary: string; latencyMs: number }>;
  dashboardCard?: AgentTurnResult["dashboardCard"];
  executionTimeMs: number;
  provider: string;
  checkpointId?: string | undefined;
  avoidedDuplicateStepsCount?: number;
}
const busyRuns = new Set<string>();
const mutationTools = new Set(['create_handoff_draft', 'acknowledge_task']);
const readTools = new Set(['get_assigned_tasks', 'get_task_details', 'get_task_changes', 'get_handoff_context', 'get_workflow_checkpoint']);

export class ShiftWeaveOrchestrator {
  private mcpBridge: MCPClientBridge;
  private llmProvider: ILLMProvider;
  private conversationHistory: AgentMessage[] = [];
  private discoveredTools: MCPToolDefinition[] = [];
  private activeWorkflowRunId: string;
  constructor(endpoint = "http://localhost:3000/mcp", providerId?: string, runId?: string, private readOnly = false) {
    this.mcpBridge = new MCPClientBridge(endpoint);
    this.llmProvider = getLLMProvider(providerId);
    this.activeWorkflowRunId = scopedWorkflow(runId || `wf_run_${randomUUID()}`);
  }
  async initialize() {
    const info = await this.mcpBridge.initialize();
    this.discoveredTools = await this.mcpBridge.listTools();
    if (this.readOnly) this.discoveredTools = this.discoveredTools.filter(tool => readTools.has(tool.name));
    AuditService.log({ actorType: 'AGENT', actorId: 'shiftweave_agent', action: 'AGENT:INITIALIZE_SESSION',
      targetResource: 'mcp/session', outcome: 'SUCCESS',
      details: { toolsDiscovered: this.discoveredTools.length, provider: this.llmProvider.providerName } });
    return { toolsCount: this.discoveredTools.length, provider: this.llmProvider.providerName, sessionId: info.sessionId };
  }
  async close() { this.llmProvider.close?.(); await this.mcpBridge.close(); }

  async processUtterance(nurseId: string, utterance: string, context: {
    shiftId?: string | undefined; outgoingNurseId?: string | undefined; incomingNurseId?: string | undefined;
    simulateInterruptionAtStep?: number; requestKey?: string;
  } = {}): Promise<OrchestrationResult> {
    const runId = this.activeWorkflowRunId;
    if (busyRuns.has(runId)) throw new Error('Workflow is busy; wait for the current turn');
    busyRuns.add(runId);
    const started = Date.now();
    const executed: OrchestrationResult['toolsExecuted'] = [];
    let checkpoint = CheckpointService.getLatestCheckpoint(runId);
    let stepIndex = checkpoint?.stepIndex || 0;
    let state = checkpoint?.statePayload || {};
    let pendingTool: ToolCallDecision | undefined;
    let turnId: string = randomUUID();
    let toolIndex = 0;
    let recoveredCount = 0;
    let executionContext: Record<string, unknown> = {};
    let requestKey = context.requestKey || randomUUID();
    let requestJson = canonicalJson({ nurseId, utterance, shiftId: context.shiftId,
      outgoingNurseId: context.outgoingNurseId, incomingNurseId: context.incomingNurseId });
    const persist = (name: string, completed = false) => {
      state = { messages: this.conversationHistory, pendingTool: pendingTool || null, turnId, toolIndex,
        context: executionContext, requestKey, requestJson, sourceVersion: sourceVersion(),
        finalSpeech: completed ? this.conversationHistory.at(-1)?.content : null };
      checkpoint = CheckpointService.saveCheckpoint(runId, ++stepIndex, name, state, `${runId}:checkpoint:${stepIndex}`);
      if (completed) CheckpointService.completeWorkflowRun(runId);
    };
    try {
      if (!utterance?.trim()) throw new Error('Utterance is required');
      if (!db.prepare('SELECT id FROM nurses WHERE id = ?').get(nurseId)) throw new Error('Unknown nurse');
      const run = db.prepare('SELECT initiated_by, status FROM workflow_runs WHERE id = ?').get(runId) as
        { initiated_by: string; status: string } | undefined;
      if (run && run.initiated_by !== nurseId) throw new Error('Workflow belongs to another nurse');
      const receipt = db.prepare('SELECT request_json, response_json FROM operation_receipts WHERE idempotency_key = ?')
        .get(`chat:${requestKey}`) as { request_json: string; response_json: string } | undefined;
      if (receipt) {
        if (receipt.request_json !== requestJson) throw new Error('Chat request key reused for a different request');
        return JSON.parse(receipt.response_json) as OrchestrationResult;
      }
      this.conversationHistory = (state.messages as AgentMessage[] | undefined) || [];
      const isRetry = context.requestKey && state.requestKey === context.requestKey;
      if (isRetry && state.requestJson !== requestJson) throw new Error('Chat request key reused for a different request');
      const resuming = /\b(resume|recover|continue)\b/i.test(utterance) || Boolean(isRetry);
      if (resuming) {
        const result = await this.mcpBridge.callTool('resume_workflow', {
          workflow_run_id: runId, idempotency_key: `resume:${runId}:${stepIndex}` });
        if (result.isError) throw new Error(result.content[0]?.text || 'Recovery failed');
        const plan = JSON.parse(result.content[0]!.text);
        executed.push({ name: 'resume_workflow', args: { workflow_run_id: runId }, resultSummary: plan.message, latencyMs: 0 });
        if (plan.recoveryStatus === 'CANNOT_RECOVER') throw new Error(plan.message);
        recoveredCount = plan.avoidedDuplicateStepsCount;
        if (plan.recoveryStatus === 'ALREADY_COMPLETED') {
          return { speech: String(state.finalSpeech || 'This workflow is already completed.'), workflowRunId: runId,
            toolsExecuted: executed, provider: this.llmProvider.providerName, executionTimeMs: Date.now() - started,
            checkpointId: checkpoint?.id, avoidedDuplicateStepsCount: recoveredCount };
        }
        executionContext = state.context as Record<string, unknown> || {};
        requestKey = String(state.requestKey || requestKey);
        requestJson = String(state.requestJson || requestJson);
        turnId = String(state.turnId);
        toolIndex = Number(state.toolIndex || 0);
        pendingTool = state.pendingTool as ToolCallDecision | undefined;
        if (plan.reconciledState.sourceChanged) {
          const lastUser = this.conversationHistory.findLastIndex(message => message.role === 'user');
          const mutationCommitted = plan.reconciledState.pendingMutationCommitted;
          this.conversationHistory = this.conversationHistory.filter((message, index) => index <= lastUser ||
            (!readTools.has(message.toolName || message.toolCall?.toolName || '') &&
              !(message.toolCall === pendingTool && !mutationCommitted)));
          if (pendingTool && !mutationCommitted) {
            const pendingName = pendingTool.toolName;
            this.conversationHistory = this.conversationHistory.filter((message, index) => index <= lastUser ||
              message.toolCall?.toolName !== pendingName);
            pendingTool = undefined;
          }
          recoveredCount = this.conversationHistory.slice(lastUser + 1)
            .filter(message => message.role === 'tool' && mutationTools.has(message.toolName || '')).length;
          persist('SOURCE_RECONCILED');
        }
      } else {
        if (run && run.status !== 'COMPLETED') throw new Error('Unfinished workflow exists. Resume it before starting another turn.');
        const previousContext = state.context as { shiftId?: string; outgoingNurseId?: string; incomingNurseId?: string } | undefined;
        executionContext = { workflowRunId: runId, nurseId, shiftId: resolveNurseShift(nurseId, context.shiftId || previousContext?.shiftId),
          outgoingNurseId: context.outgoingNurseId || previousContext?.outgoingNurseId || nurseId,
          incomingNurseId: context.incomingNurseId || previousContext?.incomingNurseId || nurseId };
        if (!run) db.prepare("INSERT INTO workflow_runs (id, workflow_type, initiated_by, status) VALUES (?, 'GENERATE_HANDOFF', ?, 'IN_PROGRESS')").run(runId, nurseId);
        this.conversationHistory.push({ role: 'user', content: utterance });
        persist('TURN_STARTED');
      }
      for (let iteration = 1; iteration <= 12; iteration++) {
        if (Date.now() - started > 55_000) throw new Error('Turn time budget reached; retry the same request to reconcile and resume');
        if (context.simulateInterruptionAtStep === iteration) {
          throw new Error(`[CHAOS SIMULATION] Interrupted before step ${iteration}; checkpoint ${checkpoint?.id} is committed.`);
        }
        const decisionStart = Date.now();
        const reusedIntent = Boolean(pendingTool);
        let decision: AgentTurnResult = pendingTool ? { toolCall: pendingTool } : await this.llmProvider.decideNextStep(
          this.conversationHistory, this.readOnly ? this.discoveredTools.filter(tool => readTools.has(tool.name)) : this.discoveredTools, executionContext);
        if (!reusedIntent) AuditService.log({ actorType: 'AGENT', actorId: nurseId, action: 'LLM:DECISION',
          targetResource: `workflow_run/${runId}`, outcome: 'SUCCESS', latencyMs: Date.now() - decisionStart,
          details: { provider: this.llmProvider.providerId, iteration, metric: 'complete_decision_ms' } });
        // Cloud models can plan read/draft calls, but nurse-facing facts are rendered from actual tool results.
        // This prevents unconstrained model prose from becoming clinical recommendations or invented success.
        if (decision.finalSpeech && this.llmProvider.providerId !== 'mock-autonomous') {
          decision = await new MockAutonomousAgent().decideNextStep(this.conversationHistory, this.discoveredTools, executionContext);
        }
        if (decision.finalSpeech) {
          this.conversationHistory.push({ role: 'assistant', content: decision.finalSpeech });
          const result: OrchestrationResult = { speech: decision.finalSpeech, workflowRunId: runId, toolsExecuted: executed,
            dashboardCard: decision.dashboardCard, executionTimeMs: Date.now() - started,
            provider: this.llmProvider.providerName, checkpointId: checkpoint?.id, avoidedDuplicateStepsCount: recoveredCount };
          db.transaction(() => {
            persist('TURN_COMPLETED', true);
            result.checkpointId = checkpoint?.id;
            db.prepare('INSERT INTO operation_receipts (idempotency_key, operation, request_json, response_json) VALUES (?, ?, ?, ?)')
              .run(`chat:${requestKey}`, 'CHAT_TURN', requestJson, JSON.stringify(result));
          })();
          return result;
        }
        if (!decision.toolCall) throw new Error('Provider returned neither a tool call nor a response');
        if (this.readOnly && !readTools.has(decision.toolCall.toolName)) {
          throw new Error('Ask assistant supports read-only questions. Use the voice handoff and confirmation commands for changes.');
        }
        if (!pendingTool) {
          toolIndex++;
          pendingTool = { ...decision.toolCall, arguments: { ...decision.toolCall.arguments } };
          // Agent writes are limited to a local draft. Human actions use explicit dashboard controls.
          if (!readTools.has(pendingTool.toolName) && pendingTool.toolName !== 'create_handoff_draft') {
            throw new Error('This tool requires an explicit human workflow action');
          }
          if (pendingTool.toolName === 'get_assigned_tasks') {
            pendingTool.arguments.nurse_id = executionContext.outgoingNurseId;
            pendingTool.arguments.shift_id = executionContext.shiftId;
          }
          if (pendingTool.toolName === 'get_task_details') {
            const assigned = db.prepare(`SELECT t.id FROM tasks t JOIN task_assignments a ON a.task_id = t.id
              WHERE t.id = ? AND a.shift_id = ? AND a.nurse_id IN (?, ?)`)
              .get(pendingTool.arguments.task_id, executionContext.shiftId, executionContext.outgoingNurseId, nurseId);
            if (!assigned) throw new Error('Task is outside this shift context');
          }
          if (pendingTool.toolName === 'get_workflow_checkpoint') pendingTool.arguments.workflow_run_id = runId;
          if (pendingTool.toolName === 'get_handoff_context' || pendingTool.toolName === 'create_handoff_draft') {
            Object.assign(pendingTool.arguments, { outgoing_nurse_id: executionContext.outgoingNurseId,
              incoming_nurse_id: executionContext.incomingNurseId, shift_id: executionContext.shiftId });
          }
          if (mutationTools.has(pendingTool.toolName)) pendingTool.arguments.idempotency_key = `${runId}:${turnId}:tool:${toolIndex}`;
          this.conversationHistory.push({ role: 'assistant', content: '', toolCall: pendingTool,
            toolCallId: decision.toolCallId || `tool_${turnId}_${toolIndex}` });
          persist(`INTENT:${pendingTool.toolName}`);
        }
        const tool = pendingTool;
        const tick = Date.now();
        const result = await this.mcpBridge.callTool(tool.toolName, tool.arguments);
        const text = result.content.map(c => c.text).join('\n');
        if (result.isError) throw new Error(`Tool ${tool.toolName} failed: ${text}`);
        const call = this.conversationHistory.at(-1);
        this.conversationHistory.push({ role: 'tool', toolName: tool.toolName, toolCallId: call?.toolCallId, content: text });
        pendingTool = undefined;
        persist(`RESULT:${tool.toolName}`);
        executed.push({ name: tool.toolName, args: tool.arguments, resultSummary: text.slice(0, 250), latencyMs: Date.now() - tick });
        AuditService.log({ actorType: 'AGENT', actorId: nurseId, action: `ORCHESTRATOR:TOOL_CALL:${tool.toolName}`,
          targetResource: `workflow_run/${runId}`, outcome: 'SUCCESS', details: { args: tool.arguments }, latencyMs: Date.now() - tick });
      }
      throw new Error('Tool step limit reached; workflow remains resumable');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Do not change another nurse's run, or turn an already completed run into interrupted.
      const run = db.prepare('SELECT initiated_by, status FROM workflow_runs WHERE id = ?').get(runId) as { initiated_by: string; status: string } | undefined;
      if (run?.initiated_by === nurseId && run.status !== 'COMPLETED') CheckpointService.markInterrupted(runId, message);
      AuditService.log({ actorType: 'AGENT', actorId: nurseId, action: 'WORKFLOW:FAILED',
        targetResource: `workflow_run/${runId}`, outcome: 'FAILURE', details: { message } });
      throw error;
    } finally { busyRuns.delete(runId); }
  }
  getWorkflowRunId() { return this.activeWorkflowRunId; }
  setWorkflowRunId(id: string) { this.activeWorkflowRunId = id; }
  getConversationHistory() { return [...this.conversationHistory]; }
}
