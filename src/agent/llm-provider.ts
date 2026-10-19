import dotenv from "dotenv";
import type { MCPToolDefinition } from "./mcp-client-bridge.js";

dotenv.config();

export interface AgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCallDecision {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface AgentTurnResult {
  thought?: string;
  toolCall?: ToolCallDecision;
  finalSpeech?: string;
  dashboardCard?: {
    title: string;
    type: "HANDOFF_SUMMARY" | "CONFLICT_ALERT" | "RECOVERY_REPORT" | "INFO";
    metrics?: Record<string, unknown>;
    data?: unknown;
  };
}

export interface ILLMProvider {
  providerId: string;
  providerName: string;
  decideNextStep(
    messages: AgentMessage[],
    availableTools: MCPToolDefinition[],
    context?: Record<string, unknown>
  ): Promise<AgentTurnResult>;
}

/**
 * 1. MockAutonomousAgent (Default Free $0.00 Engine)
 * Deterministic, offline autonomous agent simulating Alexa+ clinical reasoning.
 * Ensures tests and local evaluation run 100% reliably without requiring paid cloud keys.
 */
export class MockAutonomousAgent implements ILLMProvider {
  providerId = "mock-autonomous";
  providerName = "ShiftWeave Local Deterministic Nurse Agent";

  private stepCounter = 0;

  async decideNextStep(
    messages: AgentMessage[],
    _availableTools: MCPToolDefinition[],
    context: Record<string, unknown> = {}
  ): Promise<AgentTurnResult> {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content.toLowerCase() || "";
    const lastToolMsg = [...messages].reverse().find(m => m.role === "tool");
    const outgoingNurse = (context.outgoingNurseId as string) || "nurse_seema_01";
    const incomingNurse = (context.incomingNurseId as string) || "nurse_reema_02";
    const shiftId = (context.shiftId as string) || "shift_20261019_night";

    // Scenario A: Resuming an interrupted workflow
    if (lastUserMsg.includes("resume") || lastUserMsg.includes("continue") || lastUserMsg.includes("recover")) {
      const runId = (context.workflowRunId as string) || "wf_run_handoff_01";
      if (!lastToolMsg) {
        return {
          thought: "User requested workflow resumption after interruption. Checking database checkpoints first to avoid duplicate steps.",
          toolCall: {
            toolName: "resume_workflow",
            arguments: {
              workflow_run_id: runId,
              idempotency_key: `idem_resume_${runId}`
            }
          }
        };
      }

      // After resume_workflow tool executed
      if (lastToolMsg.toolName === "resume_workflow") {
        return {
          thought: "State reconciled from checkpoints. Generating the remaining handoff draft with carried-forward tasks.",
          toolCall: {
            toolName: "create_handoff_draft",
            arguments: {
              outgoing_nurse_id: outgoingNurse,
              incoming_nurse_id: incomingNurse,
              shift_id: shiftId,
              summary_markdown: "Shift handoff completed successfully after automated failure recovery. Room 304 neuro checks completed. Room 305 Vancomycin conflict flagged into review drawer.",
              carried_forward_task_ids: ["task_med_102_03"],
              idempotency_key: `idem_handoff_draft_${runId}`
            }
          }
        };
      }

      if (lastToolMsg.toolName === "create_handoff_draft") {
        return {
          thought: "Recovery and handoff draft complete. Delivering grounded voice response to Nurse Reema.",
          finalSpeech: "Handoff preparation recovered successfully, Nurse Reema. I reconciled state from our previous checkpoint so no tasks were repeated. Room 304 vital signs are completed, and Room 305 IV Vancomycin has been carried forward with an active status discrepancy in your review drawer.",
          dashboardCard: {
            title: "Workflow Recovered & Handoff Draft Ready",
            type: "RECOVERY_REPORT",
            metrics: {
              completedTasks: 1,
              carriedForward: 1,
              conflictsFlagged: 1,
              duplicatesAvoided: 1
            }
          }
        };
      }
    }

    // Scenario B: Standard multi-turn handoff compilation
    if (!lastToolMsg) {
      this.stepCounter = 1;
      return {
        thought: "Nurse Reema requested shift handoff status. First querying assigned tasks for Nurse Seema.",
        toolCall: {
          toolName: "get_assigned_tasks",
          arguments: {
            nurse_id: outgoingNurse,
            shift_id: shiftId
          }
        }
      };
    }

    if (lastToolMsg.toolName === "get_assigned_tasks") {
      this.stepCounter = 2;
      return {
        thought: "Received Seema's assigned tasks. Now querying handoff context and active conflicts.",
        toolCall: {
          toolName: "get_handoff_context",
          arguments: {
            outgoing_nurse_id: outgoingNurse,
            incoming_nurse_id: incomingNurse,
            shift_id: shiftId
          }
        }
      };
    }

    if (lastToolMsg.toolName === "get_handoff_context") {
      this.stepCounter = 3;
      const runId = (context.workflowRunId as string) || "wf_run_handoff_01";
      return {
        thought: "Discrepancy detected in Room 305 (Vancomycin EHR vs Notes mismatch). Saving step checkpoint to guarantee zero-loss recovery before synthesizing handoff.",
        toolCall: {
          toolName: "save_workflow_checkpoint",
          arguments: {
            workflow_run_id: runId,
            step_index: 1,
            step_name: "DETECT_DISCREPANCIES",
            state_payload: {
              tasksInspected: 2,
              conflictsDetected: 1,
              conflictId: "conf_task_med_102_03",
              patientRoom: "Room 305"
            },
            idempotency_key: `idem_chk_step1_${runId}`
          }
        }
      };
    }

    if (lastToolMsg.toolName === "save_workflow_checkpoint") {
      this.stepCounter = 4;
      const runId = (context.workflowRunId as string) || "wf_run_handoff_01";
      return {
        thought: "Checkpoint confirmed in SQLite. Generating structured SBAR shift handoff draft.",
        toolCall: {
          toolName: "create_handoff_draft",
          arguments: {
            outgoing_nurse_id: outgoingNurse,
            incoming_nurse_id: incomingNurse,
            shift_id: shiftId,
            summary_markdown: "Night shift handoff from Seema to Reema. Room 304 James Clark Q4 neuro checks finished. Room 305 Elena Rostova IV Vancomycin has conflicting documentation (EHR logged completed vs Nurse notes awaiting pharmacy).",
            carried_forward_task_ids: ["task_med_102_03"],
            idempotency_key: `idem_draft_init_${runId}`
          }
        }
      };
    }

    if (lastToolMsg.toolName === "create_handoff_draft") {
      return {
        thought: "Shift handoff synthesized and committed. Responding to Nurse Reema with clear safety boundaries.",
        finalSpeech: "Good morning, Nurse Reema. Seema assigned two tasks in ICU-B: James Clark in Room 304 had his Q4 neuro check completed normally. However, in Room 305 for Elena Rostova, there is a discrepancy on the IV Vancomycin infusion. The EHR logged it completed, but nursing notes state it is pending pharmacy delivery. Per hospital protocol, I have flagged this in your Conflict Review Drawer for human verification.",
        dashboardCard: {
          title: "ICU-B Morning Shift Handoff Draft",
          type: "CONFLICT_ALERT",
          metrics: {
            totalAssigned: 2,
            completed: 1,
            carriedForward: 1,
            activeConflicts: 1
          },
          data: {
            flaggedTask: "IV Vancomycin 1g Infusion (Room 305)",
            status: "FLAGGED_FOR_HUMAN_REVIEW"
          }
        }
      };
    }

    return {
      finalSpeech: "I have updated the shift status on your dashboard, Nurse Reema."
    };
  }
}

/**
 * 2. GeminiLLMProvider (Google Gemini Free API)
 * Pluggable provider for Google Gemini models via `@google/generative-ai`.
 */
export class GeminiLLMProvider implements ILLMProvider {
  providerId = "gemini";
  providerName = "Google Gemini LLM Runner";
  private apiKey: string;
  private modelName: string;

  constructor(apiKey = process.env.GEMINI_API_KEY || "", modelName = "gemini-1.5-flash") {
    this.apiKey = apiKey;
    this.modelName = modelName;
  }

  async decideNextStep(
    messages: AgentMessage[],
    availableTools: MCPToolDefinition[],
    context?: Record<string, unknown>
  ): Promise<AgentTurnResult> {
    if (!this.apiKey) {
      console.warn("No GEMINI_API_KEY provided. Falling back to MockAutonomousAgent.");
      return new MockAutonomousAgent().decideNextStep(messages, availableTools, context);
    }

    try {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({ model: this.modelName });

      // Build system prompt enforcing clinical safety boundaries
      const prompt = `You are ShiftWeave, an AI clinical shift coordination agent for hospital nursing stations.
Strict Safety Rules:
1. Coordinate workflow, task tracking, and handoffs only.
2. NEVER prescribe medications or change clinical orders.
3. If an EHR status and a nurse note disagree, DO NOT guess or auto-resolve: flag it into conflicts.
4. Always checkpoint multi-step workflows.

Available tools:
${JSON.stringify(availableTools, null, 2)}

Conversation History:
${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

Respond with either a tool call (JSON: {"toolName": "...", "arguments": {...}}) or final response text.`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      // Check if text is a JSON tool call
      try {
        const parsed = JSON.parse(text);
        if (parsed.toolName) {
          return {
            thought: parsed.thought || `Calling tool ${parsed.toolName}`,
            toolCall: {
              toolName: parsed.toolName,
              arguments: parsed.arguments || {}
            }
          };
        }
      } catch {
        // Plain text response
      }

      return {
        finalSpeech: text
      };
    } catch (err) {
      console.error("Gemini API error, falling back to mock agent:", err);
      return new MockAutonomousAgent().decideNextStep(messages, availableTools, context);
    }
  }
}

/**
 * 3. BedrockLLMProvider (AWS Bedrock Converse API)
 * Pluggable provider for Amazon Bedrock Claude 3.5 Sonnet / Amazon Nova Pro.
 * Fulfills the Hackathon Mini Challenge (AWS Services Integration).
 */
export class BedrockLLMProvider implements ILLMProvider {
  providerId = "aws-bedrock";
  providerName = "AWS Bedrock Converse Runner (Mini Challenge)";
  private modelId: string;
  private region: string;

  constructor(
    modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0",
    region = process.env.AWS_REGION || "us-east-1"
  ) {
    this.modelId = modelId;
    this.region = region;
  }

  async decideNextStep(
    messages: AgentMessage[],
    availableTools: MCPToolDefinition[],
    context?: Record<string, unknown>
  ): Promise<AgentTurnResult> {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.warn("No AWS credentials configured in .env. Falling back to MockAutonomousAgent.");
      return new MockAutonomousAgent().decideNextStep(messages, availableTools, context);
    }

    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
      const client = new BedrockRuntimeClient({ region: this.region });

      // Transform MCP tool definitions into AWS Bedrock Converse toolConfig format
      const tools = availableTools.map(t => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: {
            json: t.inputSchema
          }
        }
      }));

      // Transform messages
      const bedrockMessages = messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: [{ text: m.content }]
        }));

      if (bedrockMessages.length === 0) {
        bedrockMessages.push({
          role: "user",
          content: [{ text: "Prepare incoming shift handoff for ICU-B." }]
        });
      }

      const command = new ConverseCommand({
        modelId: this.modelId,
        messages: bedrockMessages,
        system: [{
          text: `You are ShiftWeave, an AI clinical shift coordination agent for Alexa+ nursing stations.
Safety Rules:
- Coordinate tasks and synthesize handoffs.
- NEVER alter prescription dosages or make autonomous clinical diagnoses.
- Flag discrepancies into the conflicts table for human nurse verification.`
        }],
        toolConfig: {
          tools
        }
      });

      const response = await client.send(command);
      const outputMsg = response.output?.message;

      // Check for toolUse in output
      const toolUseBlock = outputMsg?.content?.find((c: any) => c.toolUse);
      if (toolUseBlock && toolUseBlock.toolUse) {
        return {
          thought: `AWS Bedrock decided to invoke tool: ${toolUseBlock.toolUse.name}`,
          toolCall: {
            toolName: toolUseBlock.toolUse.name,
            arguments: (toolUseBlock.toolUse.input as Record<string, unknown>) || {}
          }
        };
      }

      const textBlock = outputMsg?.content?.find((c: any) => c.text);
      return {
        finalSpeech: textBlock?.text || "Bedrock handoff processing completed."
      };
    } catch (err) {
      console.error("Bedrock API call failed, falling back to mock agent:", err);
      return new MockAutonomousAgent().decideNextStep(messages, availableTools, context);
    }
  }
}

/**
 * Provider factory function
 */
export function getLLMProvider(requestedId?: string): ILLMProvider {
  const choice = requestedId || process.env.LLM_PROVIDER || "mock";
  switch (choice.toLowerCase()) {
    case "bedrock":
    case "aws":
      return new BedrockLLMProvider();
    case "gemini":
    case "google":
      return new GeminiLLMProvider();
    case "mock":
    default:
      return new MockAutonomousAgent();
  }
}
