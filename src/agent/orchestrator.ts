import { MCPClientBridge, type MCPToolDefinition } from "./mcp-client-bridge.js";
import { getLLMProvider, type ILLMProvider, type AgentMessage, type AgentTurnResult } from "./llm-provider.js";
import { AuditService } from "../services/audit.service.js";
import { randomUUID } from "crypto";

export interface ConversationTurn {
  id: string;
  role: "nurse" | "agent";
  nurseId: string;
  text: string;
  timestamp: string;
  toolsInvoked?: string[];
  checkpointId?: string;
}

export interface OrchestrationResult {
  speech: string;
  workflowRunId: string;
  toolsExecuted: Array<{
    name: string;
    args: Record<string, unknown>;
    resultSummary: string;
    latencyMs: number;
  }>;
  dashboardCard?: AgentTurnResult["dashboardCard"];
  executionTimeMs: number;
}

/**
 * ShiftWeaveOrchestrator
 * The autonomous agent coordinating ICU shift handoffs and interruption recovery.
 * Acts as the agentic brain behind the Alexa+ conversational interface.
 * Connects to the ShiftWeave MCP server over Streamable HTTP (/mcp).
 */
export class ShiftWeaveOrchestrator {
  private mcpBridge: MCPClientBridge;
  private llmProvider: ILLMProvider;
  private conversationHistory: AgentMessage[] = [];
  private discoveredTools: MCPToolDefinition[] = [];
  private activeWorkflowRunId: string;

  constructor(
    mcpEndpoint = "http://localhost:3000/mcp",
    llmProviderId?: string,
    workflowRunId?: string
  ) {
    this.mcpBridge = new MCPClientBridge(mcpEndpoint);
    this.llmProvider = getLLMProvider(llmProviderId);
    this.activeWorkflowRunId = workflowRunId || `wf_run_${randomUUID().slice(0, 8)}`;
  }

  /**
   * Initializes MCP session and discovers available tools at runtime.
   */
  async initialize(): Promise<{ toolsCount: number; provider: string; sessionId: string }> {
    const initRes = await this.mcpBridge.initialize();
    this.discoveredTools = await this.mcpBridge.listTools();

    AuditService.log({
      actorType: "AGENT",
      actorId: "alexa_plus_agent",
      action: "AGENT:INITIALIZE_SESSION",
      targetResource: "mcp/session",
      outcome: "SUCCESS",
      details: {
        serverName: initRes.serverName,
        sessionId: initRes.sessionId,
        toolsDiscovered: this.discoveredTools.length,
        llmProvider: this.llmProvider.providerName
      }
    });

    return {
      toolsCount: this.discoveredTools.length,
      provider: this.llmProvider.providerName,
      sessionId: initRes.sessionId
    };
  }

  /**
   * Main multi-turn conversational step.
   * Processes a nurse utterance, autonomously invokes MCP tools, and returns
   * grounded voice response + dashboard directives.
   */
  async processUtterance(
    nurseId: string,
    utterance: string,
    context: {
      shiftId?: string;
      outgoingNurseId?: string;
      incomingNurseId?: string;
      simulateInterruptionAtStep?: number;
    } = {}
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const executedTools: OrchestrationResult["toolsExecuted"] = [];

    // 1. Add user message to history
    this.conversationHistory.push({
      role: "user",
      content: utterance
    });

    const executionContext: Record<string, unknown> = {
      workflowRunId: this.activeWorkflowRunId,
      nurseId,
      shiftId: context.shiftId || "shift_20261019_night",
      outgoingNurseId: context.outgoingNurseId || "nurse_seema_01",
      incomingNurseId: context.incomingNurseId || "nurse_reema_02"
    };

    let stepCount = 0;
    const maxSteps = 6;
    let finalSpeech = "";
    let dashboardCard: AgentTurnResult["dashboardCard"];

    // 2. Multi-turn autonomous tool execution loop
    while (stepCount < maxSteps) {
      stepCount++;

      // Check if caller instructed us to simulate an interruption crash
      if (context.simulateInterruptionAtStep && stepCount === context.simulateInterruptionAtStep) {
        AuditService.log({
          actorType: "AGENT",
          actorId: nurseId,
          action: "CHAOS:SIMULATED_INTERRUPTION",
          targetResource: `workflow_run/${this.activeWorkflowRunId}`,
          outcome: "FAILURE",
          details: {
            stepInterrupted: stepCount,
            message: "Simulated hospital Wi-Fi drop / device crash during handoff synthesis."
          }
        });

        throw new Error(
          `[CHAOS SIMULATION]: Server/Network connection dropped at step ${stepCount}! Intermediate state saved in SQLite checkpoint.`
        );
      }

      // Ask LLM what to do next
      const decision = await this.llmProvider.decideNextStep(
        this.conversationHistory,
        this.discoveredTools,
        executionContext
      );

      // If LLM returned final speech, exit the tool loop
      if (decision.finalSpeech) {
        finalSpeech = decision.finalSpeech;
        dashboardCard = decision.dashboardCard;
        this.conversationHistory.push({
          role: "assistant",
          content: finalSpeech
        });
        break;
      }

      // If LLM decided to invoke an MCP tool
      if (decision.toolCall) {
        const { toolName, arguments: toolArgs } = decision.toolCall;
        const toolStartTime = Date.now();

        // Execute tool over Streamable HTTP via MCP Bridge
        const toolResult = await this.mcpBridge.callTool(toolName, toolArgs);
        const toolLatency = Date.now() - toolStartTime;

        const resultText = toolResult.content?.[0]?.text || JSON.stringify(toolResult);

        executedTools.push({
          name: toolName,
          args: toolArgs,
          resultSummary: resultText.slice(0, 150) + (resultText.length > 150 ? "..." : ""),
          latencyMs: toolLatency
        });

        // Add tool execution to conversational history
        this.conversationHistory.push({
          role: "tool",
          toolName,
          content: resultText
        });

        // Audit log tool execution
        AuditService.log({
          actorType: "AGENT",
          actorId: nurseId,
          action: `ORCHESTRATOR:TOOL_CALL:${toolName}`,
          targetResource: `workflow_run/${this.activeWorkflowRunId}`,
          outcome: toolResult.isError ? "FAILURE" : "SUCCESS",
          details: {
            arguments: toolArgs,
            stepIndex: stepCount
          },
          latencyMs: toolLatency
        });
      } else {
        // Fallback default response
        finalSpeech = "Shift status updated.";
        break;
      }
    }

    const totalTime = Date.now() - startTime;

    return {
      speech: finalSpeech || "ICU-B handoff processing completed.",
      workflowRunId: this.activeWorkflowRunId,
      toolsExecuted: executedTools,
      dashboardCard,
      executionTimeMs: totalTime
    };
  }

  getWorkflowRunId(): string {
    return this.activeWorkflowRunId;
  }

  setWorkflowRunId(runId: string): void {
    this.activeWorkflowRunId = runId;
  }

  getConversationHistory(): AgentMessage[] {
    return [...this.conversationHistory];
  }
}
