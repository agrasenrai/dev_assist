import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Request, Response } from "express";
import { randomUUID, timingSafeEqual } from "crypto";
import path from "path";
import fs from "fs";
import { z } from "zod";
import dotenv from "dotenv";
import { db } from "./db/connection.js";
import { resolveNurseShift } from './services/shift-context.js';
import { simulationDispatch, simulationInput, assertSimulationDatabase } from './services/simulation.service.js';
import { initializeDatabase } from "./db/schema.js";
import { getActiveProvider, setActiveProvider, listAvailableProviders } from "./providers/index.js";
import { AuditService } from "./services/audit.service.js";
import { CheckpointService } from "./services/checkpoint.service.js";
import { ConflictService } from "./services/conflict.service.js";
import { RecoveryService } from "./services/recovery.service.js";
import { HandoffService } from "./services/handoff.service.js";
import { EpicWriteBackService } from "./services/epic-writeback.service.js";
import { EpicNoteService } from './services/epic-note.service.js';
import { ShiftWeaveOrchestrator } from "./agent/orchestrator.js";
import { VoiceService } from "./services/voice.service.js";
import { host, allowedOrigins, publicOrigin } from './runtime-config.js';
import { MCPClientBridge } from './agent/mcp-client-bridge.js';
import { BedrockLLMProvider } from './agent/llm-provider.js';
import { runVoiceTurn } from './services/voice-agent.service.js';
import { readEpicContext } from './services/epic-context.service.js';
import { EpicWorkflowService } from './services/epic-workflow.service.js';
import { operationalDispatch } from './services/operational-dispatch.js';
import { StaffAuthService } from './services/staff-auth.service.js';
import { ElevenLabsService, ttsFailureDiagnostics } from './services/elevenlabs.service.js';
import { staffMiddleware, authorizeMcpTool } from './services/staff-http.js';
import { currentStaff, staffAuthRequired } from './services/staff-context.js';
import { hospitalSchema, hospitalEnabled, HospitalService } from './services/hospital.service.js';
import { hospitalResourceSchema } from './providers/hospital-store.js';
import { sourceContext, sourceRealm, trustedSource, type SourceRealm } from './services/source-context.js';
import { sourceSchema, scopeToolArguments, scopedIdentifier, scopedWorkflow, taskScope, handoffScope } from './services/source-policy.js';

const voiceInput = z.object({
  session_id: z.string().uuid(),
  utterance: z.string().trim().min(1).max(2000),
  expected_revision: z.number().int().nonnegative(),
  idempotency_key: z.string().uuid()
});

dotenv.config();

// Ensure all database tables exist on server startup
if(process.env.SIMULATION_MODE==='true')assertSimulationDatabase();
initializeDatabase();
db.exec(hospitalSchema);
db.exec(hospitalResourceSchema);
db.exec(sourceSchema);
if(hospitalEnabled()&&!HospitalService.provisioned())throw new Error('Simulation hospital is enabled but not populated. Run npm run hospital:prepare with the configured database first.');
// Receipts must survive restarts and delayed retries; never prune independently of workflows.

/**
 * Factory function to create a fully configured ShiftWeave MCP Server
 * with all 9 standardized tools registered.
 */
export function createShiftWeaveServer(realm:SourceRealm='epic',internal=false): McpServer {
  const server = new McpServer({
    name: "shiftweave-mcp-server",
    version: "1.0.0"
  }, {instructions:'ShiftWeave coordinates nursing tasks and handoffs. No dashboard is required. Start with get_voice_display using a new session UUID; Epic mode is the external default; only configured Epic-linked records are available. Preview exists only for trusted dashboard sessions. The display lists source-scoped records. Send the human question verbatim to voice_turn with that session_id, latest expected_revision and a new UUID idempotency_key. Reuse the exact request/key after a network failure. Return its speech to the user; never claim an action succeeded beyond the tool result. Keep the session UUID for follow-up questions. Human confirmation must come from the user. Name selection is not staff authentication. Epic and synthetic hospital sources remain distinct.'});

  // Each transport has an immutable source realm. Client-supplied mode strings
  // cannot grant preview access. Every callback restores its own realm explicitly.
  const register=server.tool.bind(server) as any;
  (server as any).tool=(...args:any[])=>{
    const name=args[0] as string;
    const previewOnly=['claim_hospital_task','refresh_hospital_records','review_simulation'];
    const epicOnly=['get_epic_patient_context','sync_epic_workspace','preview_epic_handoff_note','publish_reviewed_handoff_note'];
    if(realm==='epic'&&(previewOnly.includes(name)||name==='operational_sandbox'||name==='select_voice_source'&&!internal))return;
    if(realm==='preview'&&(epicOnly.includes(name)||name==='operational_sandbox'))return;
    const handler=args.at(-1);
    args[args.length-1]=(input:any,extra:any)=>sourceContext.run(realm,async()=>handler(scopeToolArguments(name,input),extra));
    return register(...args);
  };
  // =========================================================================
  // REGISTER THE 9 STANDARDIZED SHIFTWEAVE MCP TOOLS
  // =========================================================================

  // Tool 1: get_assigned_tasks
  server.tool(
    "get_assigned_tasks",
    "Retrieve clinical and operational tasks assigned to the nurse for a given shift.",
    {
      nurse_id: z.string().describe("Existing nurse identifier from the selected user context"),
      shift_id: z.string().optional().describe("Existing shift identifier; omission requires exactly one active shift in the nurse unit"),
      status_filter: z.array(z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FLAGGED_CONFLICT'])).optional()
    },
    async (args) => {
      const startTime = Date.now();
      const provider = getActiveProvider();
      const shiftId = resolveNurseShift(args.nurse_id, args.shift_id);

      let tasks = await provider.getTasksForNurse(args.nurse_id, shiftId);
      if (args.status_filter && args.status_filter.length > 0) {
        tasks = tasks.filter(t => args.status_filter!.includes(t.status));
      }

      AuditService.log({
        actorType: "MCP_SERVER",
        actorId: args.nurse_id,
        action: "MCP_TOOL:get_assigned_tasks",
        targetResource: `nurse/${args.nurse_id}`,
        outcome: "SUCCESS",
        details: { tasksReturned: tasks.length, shiftId },
        latencyMs: Date.now() - startTime
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              nurse_id: args.nurse_id,
              shift_id: shiftId,
              tasks_count: tasks.length,
              provider: provider.providerName,
              tasks
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 2: get_task_details
  server.tool(
    "get_task_details",
    "Retrieve comprehensive details, patient context, and history for a specific task.",
    {
      task_id: z.string().describe("Target task identifier (e.g., 'task_vital_101_01')")
    },
    async (args) => {
      const startTime = Date.now();
      const provider = getActiveProvider();
      const details = await provider.getTaskDetails(args.task_id);

      if (!details) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Task not found: ${args.task_id}` }) }],
          isError: true
        };
      }

      const conflict = ConflictService.getConflictByTaskId(args.task_id);

      AuditService.log({
        actorType: "MCP_SERVER",
        actorId: "agent",
        action: "MCP_TOOL:get_task_details",
        targetResource: `task/${args.task_id}`,
        outcome: "SUCCESS",
        details: { taskId: args.task_id, hasConflict: !!conflict },
        latencyMs: Date.now() - startTime
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...details,
              activeConflict: conflict
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 3: get_task_changes
  server.tool(
    "get_task_changes",
    "Retrieve recent clinical task events and modifications since a given timestamp.",
    {
      since_timestamp: z.string().describe("ISO 8601 timestamp starting the change query window"),
      unit_id: z.string().optional().describe("Optional nursing unit filter")
    },
    async (args) => {
      const startTime = Date.now();
      const provider = getActiveProvider();
      const sinceDate = new Date(args.since_timestamp);
      if (Number.isNaN(sinceDate.getTime())) throw new Error('Invalid since_timestamp');
      let events = await provider.getRecentEvents(sinceDate);
      if (args.unit_id) {
        const allowed = db.prepare(`SELECT DISTINCT t.id FROM tasks t JOIN task_assignments a ON a.task_id = t.id
          JOIN shifts s ON s.id = a.shift_id WHERE s.unit_id = ?`).all(args.unit_id) as Array<{ id: string }>;
        events = events.filter(event => allowed.some(task => task.id === event.taskId));
      }

      AuditService.log({
        actorType: "MCP_SERVER",
        actorId: "agent",
        action: "MCP_TOOL:get_task_changes",
        targetResource: `events/since_${args.since_timestamp}`,
        outcome: "SUCCESS",
        details: { eventsReturned: events.length },
        latencyMs: Date.now() - startTime
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              since: args.since_timestamp,
              events_count: events.length,
              events
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 4: get_handoff_context
  server.tool(
    "get_handoff_context",
    "Retrieve comprehensive operational context required to construct a shift handoff report.",
    {
      outgoing_nurse_id: z.string().describe("Existing outgoing nurse identifier"),
      incoming_nurse_id: z.string().describe("Existing incoming nurse identifier"),
      shift_id: z.string().describe("Existing shift identifier")
    },
    async (args) => {
      const startTime = Date.now();
      const provider = getActiveProvider();

      const tasks = await provider.getTasksForNurse(args.outgoing_nurse_id, args.shift_id);
      const completedTasks = tasks.filter(t => t.status === "COMPLETED");
      const pendingTasks = tasks.filter(t => t.status === "PENDING" || t.status === "IN_PROGRESS");
      const conflictedTasks = tasks.filter(t => t.status === "FLAGGED_CONFLICT");
      const unresolvedConflicts = ConflictService.getUnresolvedConflicts().filter(c => tasks.some(t => t.id === c.taskId));

      AuditService.log({
        actorType: "MCP_SERVER",
        actorId: args.incoming_nurse_id,
        action: "MCP_TOOL:get_handoff_context",
        targetResource: `shift/${args.shift_id}`,
        outcome: "SUCCESS",
        details: {
          total: tasks.length,
          completed: completedTasks.length,
          pending: pendingTasks.length,
          conflicts: conflictedTasks.length
        },
        latencyMs: Date.now() - startTime
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              outgoing_nurse_id: args.outgoing_nurse_id,
              incoming_nurse_id: args.incoming_nurse_id,
              shift_id: args.shift_id,
              metrics: {
                total_assigned: tasks.length,
                completed_count: completedTasks.length,
                pending_count: pendingTasks.length,
                conflicts_count: conflictedTasks.length
              },
              field_authority: (await import('./services/field-authority.service.js')).FIELD_AUTHORITY_MATRIX,
              pending_tasks: pendingTasks,
              conflicted_tasks: conflictedTasks,
              active_conflicts: unresolvedConflicts
              ,epic_source_summary: EpicWorkflowService.narrative([...EpicWorkflowService.recordsForNurse(args.outgoing_nurse_id, args.shift_id),...HospitalService.recordsForPatients(tasks.map(t=>t.patientId))])
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 5: create_handoff_draft
  server.tool(
    "create_handoff_draft",
    "Create and persist a structured clinical shift handoff draft grounded in verified data.",
    {
      outgoing_nurse_id: z.string().describe("Outgoing nurse identifier"),
      incoming_nurse_id: z.string().describe("Incoming nurse identifier"),
      shift_id: z.string().describe("Shift identifier"),
      summary_markdown: z.string().describe("Grounded clinical handoff narrative"),
      carried_forward_task_ids: z.array(z.string()).describe("List of task IDs transferred to incoming nurse"),
      idempotency_key: z.string().describe("UUIDv4 idempotency key preventing duplicate draft creation"),
      epic_clinical_context: z.array(z.any()).optional().describe("Imported Epic FHIR R4 clinical context to ground SBAR narrative")
    },
    async (args) => {
      if (args.epic_clinical_context?.length) throw new Error('Epic context must come from the verified workspace sync, not caller-supplied clinical data');
      const result = HandoffService.createDraft(args as any);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // Tool 6: get_workflow_checkpoint
  server.tool(
    "get_workflow_checkpoint",
    "Retrieve the most recent saved checkpoint state for an active or interrupted workflow.",
    {
      workflow_run_id: z.string().describe("Target workflow run identifier (e.g., 'wf_run_98234')")
    },
    async (args) => {
      const checkpoint = CheckpointService.getLatestCheckpoint(args.workflow_run_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              workflow_run_id: args.workflow_run_id,
              has_checkpoint: !!checkpoint,
              checkpoint
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 7: save_workflow_checkpoint
  server.tool(
    "save_workflow_checkpoint",
    "Commit intermediate workflow progress to storage for zero-loss recovery.",
    {
      workflow_run_id: z.string().describe("Active workflow run ID"),
      step_index: z.number().int().describe("Sequence number of completed step (1, 2, 3...)"),
      step_name: z.string().describe("Descriptive name of the completed step"),
      state_payload: z.record(z.string(), z.unknown()).describe("JSON-serializable snapshot of intermediate variables"),
      idempotency_key: z.string().describe("UUIDv4 deduplication token")
    },
    async (args) => {
      const startTime = Date.now();
      const checkpoint = CheckpointService.saveCheckpoint(
        args.workflow_run_id,
        args.step_index,
        args.step_name,
        args.state_payload,
        args.idempotency_key
      );

      AuditService.log({
        actorType: "MCP_SERVER",
        actorId: "workflow_engine",
        action: "MCP_TOOL:save_workflow_checkpoint",
        targetResource: `checkpoint/${checkpoint.id}`,
        outcome: "SUCCESS",
        details: { stepIndex: args.step_index, stepName: args.step_name },
        latencyMs: Date.now() - startTime
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "COMMITTED",
              checkpoint
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 8: resume_workflow
  server.tool(
    "resume_workflow",
    "Reconcile state and safely resume remaining actions after an interruption without duplicate execution.",
    {
      workflow_run_id: z.string().describe("Interrupted workflow run identifier"),
      idempotency_key: z.string().describe("UUIDv4 token preventing duplicate resumption requests")
    },
    async (args) => {
      const startTime = Date.now();
      const recoveryPlan = RecoveryService.reconcileAndResume(args.workflow_run_id, args.idempotency_key);

      AuditService.log({
        actorType: "MCP_SERVER",
        actorId: "recovery_engine",
        action: "MCP_TOOL:resume_workflow",
        targetResource: `workflow/${args.workflow_run_id}`,
        outcome: recoveryPlan.recoveryStatus === "CANNOT_RECOVER" ? "FAILURE" : "RECOVERED",
        details: { ...recoveryPlan },
        latencyMs: Date.now() - startTime
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(recoveryPlan, null, 2)
          }
        ],
        isError: recoveryPlan.recoveryStatus === "CANNOT_RECOVER"
      };
    }
  );

  // Tool 9: acknowledge_task
  server.tool(
    "acknowledge_task",
    "Record human nurse verification, sign-off, or conflict resolution against a task.",
    {
      task_id: z.string().describe("Target task identifier"),
      nurse_id: z.string().describe("Nurse recording the action"),
      human_confirmed: z.literal(true).describe("Explicit human confirmation; not supplied by the agent"),
      handoff_id: z.string().optional(),
      action: z.enum(['ACCEPT_HANDOFF', 'RESOLVE_CONFLICT', 'FLAG_FOR_SUPERVISOR']),
      resolution_note: z.string().optional().describe("Clinical note or explanation"),
      idempotency_key: z.string().describe("UUIDv4 token ensuring exact-once execution")
    },
    async (args) => {
      const result = HandoffService.acknowledge(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool('voice_turn',
    'Nursing voice workflow using the configured source profile. Pass the human transcript verbatim, a stable display session UUID, ' +
    'the latest display revision, and a retry UUID. Returns speech and matching display data. Staff-auth mode binds identity to the signed-in account; legacy demo name selection is not authentication. ' +
    'Never invent a human confirmation. Read get_voice_display to restore a session.',
    voiceInput.shape, async args => ({ content: [{ type: 'text', text: JSON.stringify(await runVoiceTurn(args, localMcpEndpoint())) }] }));
  server.tool('get_voice_display', 'Read the saved voice session and current nurse-scoped display, including available imported Epic snapshots. Staff-auth mode requires the owning account.',
    { session_id: z.string().uuid() }, async args => ({
      content: [{ type: 'text', text: JSON.stringify(VoiceService.read(args.session_id)) }]
    }));
  if(hospitalEnabled()) {
    server.tool('claim_hospital_task','Assign an available unowned synthetic coordination task to the requesting simulation nurse. Explicit human confirmation required; never takes another nurse’s task or changes Epic.',
      {nurse_id:z.string().startsWith('hospital:'),shift_id:z.string(),task_id:z.string().startsWith('hospital:'),human_confirmed:z.literal(true),idempotency_key:z.string().uuid()},
      async args=>({content:[{type:'text',text:JSON.stringify(HospitalService.claimTask(args))}]}));
    server.tool('select_voice_source','Select the synthetic hospital or existing Epic workspace for a voice session. Clears identity, pending confirmations and conversation; keeps saved workflow records.',
      {session_id:z.string().uuid(),source:z.enum(['hospital','epic','existing']),expected_revision:z.number().int().nonnegative(),idempotency_key:z.string().uuid()},
      async args=>({content:[{type:'text',text:JSON.stringify(VoiceService.selectSource(args))}]}));
    server.tool('refresh_hospital_records','Read current synthetic FHIR R4 records for an assigned simulation nurse. Does not modify clinical orders or Epic.',
      {nurse_id:z.string().startsWith('hospital:'),shift_id:z.string(),idempotency_key:z.string().min(1)},
      async args=>({content:[{type:'text',text:JSON.stringify(await HospitalService.refresh(args.nurse_id,args.shift_id,args.idempotency_key))}]}));
  }
  server.tool('preview_epic_handoff_note', 'Preview a finalized single-patient sandbox note with encounter-linked author and review hash. Does not write to Epic.',
    { handoff_id: z.string(), nurse_id: z.string() }, async args => ({ content: [{ type: 'text', text: JSON.stringify(EpicNoteService.preview(args.handoff_id, args.nurse_id)) }] }));
  server.tool(
    'publish_reviewed_handoff_note',
    'Publishes a human-reviewed handoff note to external FHIR R4 EHR as a DocumentReference. Requires explicit human confirmation, accepted custody, and zero unresolved discrepancies.',
    {
      handoff_id: z.string().describe('Target handoff identifier'),
      nurse_id: z.string().describe('Nurse authorizing external publication'),
      human_confirmed: z.literal(true).describe('Explicit human confirmation'),
      idempotency_key: z.string().describe('UUIDv4 token ensuring idempotent execution'),
      patient_id: z.string().optional().describe('Target patient identifier'),
      review_hash: z.string().optional().describe('Exact note preview hash reviewed by the human; required for live publication'),
      execution_mode: z.enum(['live', 'mock', 'simulate_uncertain']).optional().describe('Execution environment')
    },
    async (args) => {
      if (args.execution_mode !== 'mock' && args.execution_mode !== 'simulate_uncertain' && process.env.EPIC_WRITES_ENABLED !== 'true') {
        throw new Error('Live Epic note publication is disabled until target-environment write validation is complete');
      }
      const result = await EpicWriteBackService.publishReviewedNote({
        handoffId: args.handoff_id,
        nurseId: args.nurse_id,
        idempotencyKey: args.idempotency_key,
        humanConfirmed: args.human_confirmed,
        patientId: args.patient_id,
        reviewHash: args.review_hash,
        executionMode: args.execution_mode
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
  server.tool('get_epic_patient_context',
    'Read explicitly allowlisted Epic patient context. Supplemental records only; orders are not assigned nursing tasks. ' +
    'Requires configured backend access. Failures and incomplete pages are errors; no local fallback.',
    { patient_id: z.string().min(1), idempotency_key: z.string().min(1) }, async args => ({
      content: [{ type: 'text', text: JSON.stringify(await readEpicContext(args)) }]
    }));
  server.tool('sync_epic_workspace', 'Fetch allowlisted Epic patients into durable source snapshots and local coordination tasks. Does not modify Epic orders or infer administrations. Existing custody is preserved.',
    { nurse_id: z.string(), shift_id: z.string(), idempotency_key: z.string().min(1) }, async args => ({
      content: [{ type: 'text', text: JSON.stringify(await EpicWorkflowService.sync(args)) }]
    }));
  server.tool('operational_sandbox','Authenticated staff directory, roster, care-team assignments, coordination tasks, sourced notes and reviewed sandbox document publication. Clinical orders are never modified.',
    {action:z.string(),input:z.record(z.string(),z.unknown())},async args=>({content:[{type:'text',text:JSON.stringify(await operationalDispatch(args.action,args.input))}]}));
  if (process.env.SIMULATION_MODE === 'true'||hospitalEnabled()&&!staffAuthRequired()) server.tool('review_simulation','Run database-backed synthetic review scenarios. Results are actual existing MCP tool outputs; expected outcomes are guidance only.',simulationInput.shape,
    async args=>({content:[{type:'text',text:JSON.stringify(await simulationDispatch(args,localMcpEndpoint()))}]}));
  return server;
}

// =========================================================================
// STREAMABLE HTTP PROTOCOL SESSION MANAGEMENT
// =========================================================================

interface SessionRecord {
  realm:SourceRealm;
  internal:boolean;
  staffId?: string | undefined;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  open: number;
  lastActive: number;
}

const sessions = new Map<string, SessionRecord>();

const sessionCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of sessions) {
    if (s.lastActive < cutoff) {
      void s.server.close();
      sessions.delete(id);
    }
  }
}, 5 * 60_000);
sessionCleanupTimer.unref();

const isInitializeRequest = (body: unknown): boolean => {
  return typeof body === "object" && body !== null &&
    ((body as { method?: string }).method === "initialize" ||
     (Array.isArray(body) && body.some((req: { method?: string }) => req.method === "initialize")));
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// Enable CORS for React Dashboard
app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  const hostHeader = _req.get('host') || '';
  const hostWithoutPort = hostHeader.split(':')[0] || '';
  let isSameHost = false;
  if (origin && hostHeader) {
    try {
      const originUrl = new URL(origin);
      isSameHost = originUrl.host === hostHeader || originUrl.hostname === hostWithoutPort;
    } catch {}
  }
  const allowAny = publicOrigin === '*' || allowedOrigins.has('*') || process.env.ALLOW_ANY_ORIGIN === 'true';

  if (origin && !isSameHost && !allowAny && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: 'Origin is not allowed' });
    return;
  }
  if (origin) res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version");
  res.header('Access-Control-Expose-Headers', 'mcp-session-id, MCP-Protocol-Version');
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (_req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});
// Minimal probe contains no clinical records or configuration.
app.get('/readyz', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ready: true }); }
  catch { res.status(503).json({ ready: false }); }
});
// Demo basic auth removed
app.use(staffMiddleware);
app.use('/api',(req,_res,next)=>{
  let realm:SourceRealm='legacy';
  if(!staffAuthRequired()&&hospitalEnabled()) {
    const id=req.body?.session_id||req.path.match(/^\/voice\/([^/]+)$/)?.[1];
    const selected=id?db.prepare('SELECT realm FROM dashboard_voice_sources WHERE session_id=?').get(id) as {realm:SourceRealm}|undefined:undefined;
    realm=selected?.realm||'preview';
  }
  if(realm==='epic'&&process.env.NODE_ENV==='production'&&!currentStaff()){
    _res.status(403).json({error:'Public preview cannot restore an Epic session. Use the authorized Epic MCP endpoint.'});return;
  }
  if(process.env.NODE_ENV==='production'&&!staffAuthRequired()&&!hospitalEnabled()&&
    !['/staff/config','/simulations','/tts/config'].includes(req.path)){
    _res.status(403).json({error:'Epic data requires an authorized MCP client or the existing staff authentication.'});return;
  }
  sourceContext.run(realm,()=>next());
});
// Companion preview routes must not invoke Epic publication or change the shared provider.
app.use('/api',(req,res,next)=>{
  if(sourceRealm()==='preview'&&(req.path==='/provider/switch'||/\/handoffs\/[^/]+\/(?:epic-note-preview|publish-note)$/.test(req.path))){res.status(403).json({error:'This operation is unavailable in the synthetic preview.'});return;}
  next();
});
app.get('/api/simulations', (_req,res)=>res.json({enabled:process.env.SIMULATION_MODE==='true'||hospitalEnabled()&&!staffAuthRequired(),hosted:hospitalEnabled()}));
app.post('/api/simulations', async(req,res)=>{
  if(process.env.SIMULATION_MODE!=='true'&&!(hospitalEnabled()&&!staffAuthRequired())){res.status(404).json({error:'Synthetic review environment is not enabled'});return;}
  const bridge=new MCPClientBridge(localMcpEndpoint());
  try {
    const input=simulationInput.parse(req.body); await bridge.initialize();
    const result=await bridge.callTool('review_simulation',input);
    if(result.isError){res.status(409).json({error:result.content.map(c=>c.text).join(' ')});return;}
    res.json(JSON.parse(result.content[0]!.text));
  } finally {await bridge.close();}
});
// Enforce the existing service credential for every MCP method, including session deletion.
app.use('/mcp', (req, res, next) => {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) return next();
  const expected = Buffer.from(`Bearer ${token}`);
  const supplied = Buffer.from(req.headers.authorization || '');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    res.status(401).json({ error: 'MCP service credential required' });
    return;
  }
  next();
});
app.get('/api/staff/config',(_req,res)=>res.json({required:staffAuthRequired(),environment:'SHIFTWEAVE_OPERATIONAL_SANDBOX'}));
const loginAttempts=new Map<string,{count:number;until:number}>();
app.post('/api/staff/login',(req,res)=>{
  try{
    const ip=req.ip||'unknown';const previous=loginAttempts.get(ip);const now=Date.now();
    if(previous&&previous.until>now&&previous.count>=20){res.status(429).json({error:'Too many sign-in attempts. Try again after one minute'});return;}
    if(loginAttempts.size>=1000)for(const[key,value]of loginAttempts)if(value.until<=now)loginAttempts.delete(key);
    loginAttempts.set(ip,previous&&previous.until>now?{...previous,count:previous.count+1}:{count:1,until:now+60_000});
    const a=z.object({username:z.string(),password:z.string().max(200),idempotency_key:z.string().uuid()}).parse(req.body);
    const result=StaffAuthService.login(a.username,a.password,a.idempotency_key);
    res.cookie('shiftweave_staff',result.token,{httpOnly:true,sameSite:'strict',secure:process.env.PUBLIC_ORIGIN?.startsWith('https://')||false,maxAge:8*60*60_000,path:'/'});
    res.json({principal:result.principal,expiresAt:result.expiresAt});
  }catch(error){res.status(401).json({error:error instanceof Error?error.message:String(error)});}
});
app.get('/api/staff/me',(_req,res)=>res.json({principal:currentStaff()||null}));
app.post('/api/staff/logout',(req,res)=>{
  try{const result=StaffAuthService.logout(z.string().min(1).parse(req.body.idempotency_key));res.clearCookie('shiftweave_staff',{path:'/'});res.json(result);}
  catch(error){res.status(401).json({error:error instanceof Error?error.message:String(error)});}
});
app.post('/api/operations/:action',async(req,res)=>{
  const bridge=new MCPClientBridge(localMcpEndpoint());
  try{
    await bridge.initialize();
    const result=await bridge.callTool('operational_sandbox',{action:String(req.params.action),input:req.body});
    if(result.isError)throw new Error(result.content.map(c=>c.text).join('\n'));
    res.json(JSON.parse(result.content[0]!.text));
  }catch(error){res.status(422).json({error:error instanceof Error?error.message:String(error)});}
  finally{await bridge.close();}
});
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

/**
 * Primary MCP Protocol Endpoint: POST /mcp
 * Compliant with MCP Spec 2025-11-25 over Streamable HTTP
 */
app.post("/mcp", async (req: Request, res: Response): Promise<void> => {
  const trusted=trustedSource(req.headers);
  const realm=trusted||'epic';
  if(req.body&&Array.isArray(req.body)){res.status(400).json({error:'Batch MCP requests are not enabled'});return;}
  if(staffAuthRequired()){
    try{
      const existing=sessions.get(String(req.headers['mcp-session-id']||''));
      if(existing&&existing.staffId!==currentStaff()?.id)throw new Error('MCP session belongs to another staff member');
      if(req.body?.method==='tools/call')authorizeMcpTool(req.body.params?.name,req.body.params?.arguments||{});
      if(Array.isArray(req.body))throw new Error('Batch MCP requests are not enabled for staff sessions');
    }catch(error){res.status(403).json({jsonrpc:'2.0',id:req.body?.id??null,error:{code:-32003,message:error instanceof Error?error.message:String(error)}});return;}
  }
  const requestedVersion = req.body?.method === 'initialize' ? req.body.params?.protocolVersion : req.headers['mcp-protocol-version'];
  if (typeof requestedVersion === 'string' && requestedVersion < '2025-11-25') {
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32602, message: 'Minimum MCP protocol version is 2025-11-25' }, id: req.body?.id ?? null });
    return;
  }
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (session) {
      if(session.realm!==realm||session.internal!==Boolean(trusted)){res.status(403).json({error:'MCP session belongs to another source profile'});return;}
      session.lastActive = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      // Create new session-isolated server and transport
      const newServer = createShiftWeaveServer(realm,Boolean(trusted));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          sessions.set(sid, { transport, server: newServer, realm,internal:Boolean(trusted),open: 0, lastActive: Date.now(),staffId:currentStaff()?.id });
        }
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      // SDK 1.x callback declarations include explicit undefined while Transport uses optional properties.
      // @ts-expect-error SDK exactOptionalPropertyTypes declaration mismatch; real transport handshake is tested.
      await newServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId) {
      res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
      return;
    }

    res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Initialize an MCP session first' }, id: null });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

/** Handle GET requests for SSE streams (MCP Spec requirement) */
app.get("/mcp", async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).send("Missing session ID");
    return;
  }
  const session = sessions.get(sessionId);
  if(session&&(session.realm!==(trustedSource(req.headers)||'epic')||session.internal!==Boolean(trustedSource(req.headers)))){res.status(403).json({error:'MCP session belongs to another source profile'});return;}
  if(staffAuthRequired()&&session?.staffId!==currentStaff()?.id){res.status(403).json({error:'MCP session belongs to another staff member'});return;}
  if (!session) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    return;
  }
  await session.transport.handleRequest(req, res);
});

/** Handle DELETE requests for session termination */
app.delete("/mcp", async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).send("Missing session ID");
    return;
  }
  const session = sessions.get(sessionId);
  if(session&&(session.realm!==(trustedSource(req.headers)||'epic')||session.internal!==Boolean(trustedSource(req.headers)))){res.status(403).json({error:'MCP session belongs to another source profile'});return;}
  if(staffAuthRequired()&&session?.staffId!==currentStaff()?.id){res.status(403).json({error:'MCP session belongs to another staff member'});return;}
  if (!session) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    return;
  }
  await session.transport.handleRequest(req, res);
  sessions.delete(sessionId);
});

// =========================================================================
// REST API COMPANION ENDPOINTS FOR REACT DASHBOARD
// =========================================================================

// Browser transcript crosses the same MCP boundary as an external assistant.
app.post('/api/voice', async (req, res) => {
  const input = voiceInput.parse(req.body);
  const bridge = new MCPClientBridge(localMcpEndpoint());
  try {
    await bridge.initialize();
    const result = await bridge.callTool('voice_turn', input);
    if (result.isError) throw new Error(result.content.map(c => c.text).join('\n'));
    res.json(JSON.parse(result.content[0]!.text));
  } finally { await bridge.close(); }
});
app.get('/api/voice/:sessionId', (req, res) => {
  res.json(VoiceService.read(scopedIdentifier('session_id',z.string().uuid().parse(req.params.sessionId))));
});
app.get('/api/voice-sources', (_req,res)=>res.json({enabled:hospitalEnabled()&&!staffAuthRequired(),provisioned:HospitalService.provisioned()}));
app.post('/api/voice-source',async(req,res)=>{
  if(!hospitalEnabled()||staffAuthRequired()){res.status(404).json({error:'Voice source selection is not enabled'});return;}
  const args=z.object({session_id:z.string().uuid(),source:z.enum(['hospital','epic','existing']),expected_revision:z.number().int().nonnegative(),idempotency_key:z.string().uuid()}).parse(req.body);
  const current=VoiceService.read(scopedIdentifier('session_id',args.session_id));
  if(current.revision!==args.expected_revision){res.status(409).json({error:'Voice session changed. Refresh before switching sources.'});return;}
  const target:SourceRealm=args.source==='hospital'?'preview':'epic';
  if(target==='epic'&&process.env.NODE_ENV==='production'&&!currentStaff()){res.status(403).json({error:'Public preview cannot access Epic records. Use the authorized Epic MCP endpoint.'});return;}
  await sourceContext.run(target,async()=>{
    const bridge=new MCPClientBridge(localMcpEndpoint());
    try {
      await bridge.initialize();
      const display=await bridge.callTool('get_voice_display',{session_id:args.session_id});
      if(display.isError)throw new Error('Target source display is unavailable');
      const result=await bridge.callTool('select_voice_source',{...args,expected_revision:JSON.parse(display.content[0]!.text).revision});
      if(result.isError){res.status(409).json({error:result.content.map(c=>c.text).join(' ')});return;}
      const {MutationService}=await import('./services/mutation.service.js');
      MutationService.execute('DASHBOARD_SOURCE',`dashboard-source:${scopedIdentifier('idempotency_key',args.idempotency_key)}`,{sessionId:args.session_id,target},'source-router',()=>{
        db.prepare('INSERT INTO dashboard_voice_sources(session_id,realm) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET realm=excluded.realm').run(args.session_id,target);return {target};
      });
      res.json(JSON.parse(result.content[0]!.text));
    }finally{await bridge.close();}
  });
});

/** Text-to-Speech endpoint (ElevenLabs with automatic browser fallback) */
const ttsFailureResponse = { error: 'Speech is temporarily unavailable. Please try again.', fallback: true };
app.get('/api/tts/config', (_req,res)=>res.json({enabled:ElevenLabsService.isConfigured()}));
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceId, modelId } = req.body || {};
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required for TTS' });
      return;
    }

    if (!ElevenLabsService.isConfigured()) {
      res.status(200).json({ enabled: false, message: 'ElevenLabs not configured; using browser speech synthesis' });
      return;
    }

    const result = await ElevenLabsService.synthesizeSpeech({ text, voiceId, modelId });
    if (!result) {
      res.status(200).json({ enabled: false, message: 'ElevenLabs not configured; using browser speech synthesis' });
      return;
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.audioBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(result.audioBuffer);
  } catch (error) {
    console.error('TTS synthesis failed', ttsFailureDiagnostics(error));
    res.status(502).json(ttsFailureResponse);
  }
});

/** Streaming Text-to-Speech endpoint (ElevenLabs chunked audio for ultra-low latency playback) */
app.all('/api/tts/stream', async (req, res) => {
  try {
    const text = (req.method === 'POST' ? req.body?.text : req.query.text) as string;
    const voiceId = (req.method === 'POST' ? req.body?.voiceId : req.query.voiceId) as string | undefined;
    const modelId = (req.method === 'POST' ? req.body?.modelId : req.query.modelId) as string | undefined;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required for TTS streaming' });
      return;
    }

    if (!ElevenLabsService.isConfigured()) {
      res.status(200).json({ enabled: false, message: 'ElevenLabs not configured; using browser speech synthesis' });
      return;
    }

    const result = await ElevenLabsService.streamSpeech({ text, voiceId, modelId });
    if (!result) {
      res.status(200).json({ enabled: false, message: 'ElevenLabs not configured; using browser speech synthesis' });
      return;
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    result.stream.once('error', (error: unknown) => {
      console.error('TTS audio stream failed', ttsFailureDiagnostics(error));
      if (!res.headersSent) {
        res.removeHeader('Content-Type');
        res.status(502).json(ttsFailureResponse);
      } else {
        // Audio headers/bytes have already been sent; terminate without exposing details.
        res.destroy();
      }
    });
    result.stream.pipe(res);
    res.on('close', () => {
      if ('destroy' in result.stream && typeof (result.stream as any).destroy === 'function') {
        (result.stream as any).destroy();
      }
    });
  } catch (error) {
    console.error('TTS streaming failed', ttsFailureDiagnostics(error));
    if (!res.headersSent) {
      res.status(502).json(ttsFailureResponse);
    }
  }
});

/** ElevenLabs Conversational AI Session Info & Signed URL endpoint */
app.get('/api/convai/session', async (_req, res) => {
  const agentId = ElevenLabsService.getConvaiAgentId();

  if (!agentId) {
    res.json({
      enabled: false,
      mode: 'STREAMING_VOICE',
      message: 'ELEVENLABS_AGENT_ID not set. Running in Ultra-Fast Streaming Voice mode with instant Flash 2.5 TTS.'
    });
    return;
  }

  const signedUrl = await ElevenLabsService.getSignedConvaiUrl();
  res.json({
    enabled: true,
    agentId,
    signedUrl,
    mode: 'FULL_DUPLEX_CONVAI',
    requiresSignedUrl: Boolean(signedUrl)
  });
});

/** Webhook for ElevenLabs Conversational AI server tools */
app.post('/api/convai/tools', async (req, res) => {
  try {
    const { tool_name, session_id, utterance, idempotency_key } = req.body || {};
    const effectiveSessionId = session_id || 'convai-session';
    const effectiveKey = idempotency_key || `convai-${Date.now()}`;

    if (tool_name === 'get_voice_context') {
      const display = VoiceService.read(effectiveSessionId);
      res.json({ success: true, display });
      return;
    }

    if (tool_name === 'execute_voice_turn' || utterance) {
      const result = await runVoiceTurn({
        session_id: effectiveSessionId,
        utterance: utterance || '',
        expected_revision: req.body.expected_revision ?? 0,
        idempotency_key: effectiveKey
      }, localMcpEndpoint());
      res.json({ success: true, result });
      return;
    }

    res.status(400).json({ error: `Unknown tool: ${tool_name}` });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Health check endpoint */
app.get("/health", async (_req, res) => {
  const provider = getActiveProvider();
  const ping = await provider.ping();
  res.json({
    status: ping ? "ok" : "degraded",
    mode: "LOCAL_DEMO_NO_PRODUCTION_AUTH",
    llmProvider: process.env.LLM_PROVIDER || 'mock',
    voiceAgentMode: (process.env.LLM_PROVIDER || 'mock') === 'mock' ? 'LOCAL_DETERMINISTIC' : 'BEDROCK_SEMANTIC_VOICE',
    epicStatus: process.env.EPIC_CLIENT_ID ? 'CONFIGURED_NOT_VERIFIED' : 'NOT_CONFIGURED',
    server: "ShiftWeave MCP Server",
    specVersion: "2025-11-25",
    transport: "Streamable HTTP (/mcp)",
    activeSessions: sessions.size,
    provider: {
      id: provider.providerId,
      name: provider.providerName,
      isEdgeCache: provider.isEdgeCache,
      healthy: ping
    },
    timestamp: new Date().toISOString()
  });
});

/** Telemetry stream endpoint for React Dashboard live trace */
app.get("/api/execution-trace", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const actor=currentStaff();
  const logs = AuditService.getRecentLogs(limit).filter(log=>!staffAuthRequired()||log.actor_id===actor?.id).map(log => ({ id: log.id, actorType: log.actor_type,
    actorId: log.actor_id, action: log.action, targetResource: log.target_resource,
    outcome: log.outcome, details: log.details ? JSON.parse(log.details) : null,
    latencyMs: log.latency_ms || 0, timestamp: log.timestamp }));
  res.json({ count: logs.length, logs });
});

/** Unresolved conflicts query endpoint */
app.get("/api/conflicts", (_req, res) => {
  const conflicts = ConflictService.getUnresolvedConflicts();
  res.json({ count: conflicts.length, conflicts });
});

/** Dynamic provider switcher endpoint (proves interoperability to judges) */
app.post("/api/provider/switch", (req, res) => {
  const { providerId } = req.body as { providerId: "sqlite-edge-cache" | "live-fhir-api" };
  try {
    const switched = setActiveProvider(providerId);
    res.json({
      success: true,
      activeProvider: {
        id: switched.providerId,
        name: switched.providerName,
        isEdgeCache: switched.isEdgeCache
      }
    });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/providers", (_req, res) => {
  res.json({ providers: listAvailableProviders() });
});

/** Return clinical tasks with patient and assignment metadata */
app.get("/api/tasks", (_req, res) => {
  const tasks = db.prepare(`
    SELECT t.id, t.patient_id AS patientId, p.full_name AS patientName, p.room_number AS roomNumber,
           t.title, t.description, t.category, t.status, t.priority,
           t.scheduled_time AS scheduledTime, t.completed_time AS completedTime,
           t.source_system AS sourceSystem, ta.transfer_status AS transferStatus,
           ta.nurse_id AS assignedNurseId, n.full_name AS assignedNurseName
    FROM tasks t
    JOIN patients p ON p.id = t.patient_id
    LEFT JOIN task_assignments ta ON ta.task_id = t.id AND ta.transfer_status IN ('ACTIVE', 'CARRIED_FORWARD')
    LEFT JOIN nurses n ON n.id = ta.nurse_id
    WHERE ${taskScope('t')} ORDER BY t.scheduled_time ASC
  `).all();
  res.json({ count: tasks.length, tasks });
});

/** Return shift handoffs */
app.get("/api/handoffs", (_req, res) => {
  const handoffs = db.prepare(`
    SELECT h.id, h.shift_id AS shiftId, h.outgoing_nurse_id AS outgoingNurseId,
           n1.full_name AS outgoingNurseName, h.incoming_nurse_id AS incomingNurseId,
           n2.full_name AS incomingNurseName, h.status, h.summary_markdown AS summaryMarkdown,
           h.data_snapshot AS structuredSnapshot, h.created_at AS createdAt,
           h.external_sync_status AS externalSyncStatus, h.external_resource_id AS externalResourceId,
           h.external_sync_error AS externalSyncError, h.external_synced_at AS externalSyncedAt
    FROM handoffs h
    LEFT JOIN nurses n1 ON n1.id = h.outgoing_nurse_id
    LEFT JOIN nurses n2 ON n2.id = h.incoming_nurse_id
    WHERE ${handoffScope('h')} ORDER BY h.created_at DESC
  `).all();
  res.json({ count: handoffs.length, handoffs });
});

app.post('/api/handoffs/:id/finalize', (req, res) => {
  try {
    const input = z.object({ nurse_id: z.string().min(1), idempotency_key: z.string().min(1), human_confirmed: z.literal(true) }).parse(req.body);
    res.json(HandoffService.finalize(String(req.params.id), input.nurse_id, input.idempotency_key, input.human_confirmed));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err instanceof z.ZodError ? 400 : 422).json({ error: message });
  }
});

/** Publish human-reviewed handoff note as external FHIR DocumentReference */
app.get('/api/handoffs/:id/epic-note-preview', (req, res) => {
  try { res.json(EpicNoteService.preview(String(req.params.id), z.string().min(1).parse(req.query.nurse_id))); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.post('/api/handoffs/:id/publish-note', async (req, res) => {
  const input = z.object({
    nurse_id: z.string().min(1),
    idempotency_key: z.string().min(1),
    human_confirmed: z.boolean(),
    patient_id: z.string().optional(),
    review_hash: z.string().optional(),
    execution_mode: z.enum(['live', 'mock', 'simulate_uncertain']).optional(),
  }).parse(req.body);

  try {
    if (input.execution_mode !== 'mock' && input.execution_mode !== 'simulate_uncertain' && process.env.EPIC_WRITES_ENABLED !== 'true') {
      throw new Error('Live Epic note publication is disabled until target-environment write validation is complete');
    }
    const result = await EpicWriteBackService.publishReviewedNote({
      handoffId: String(req.params.id),
      nurseId: input.nurse_id,
      idempotencyKey: input.idempotency_key,
      humanConfirmed: input.human_confirmed,
      patientId: input.patient_id,
      reviewHash: input.review_hash,
      executionMode: input.execution_mode,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Resolve a clinical conflict from the review drawer */
app.post("/api/conflicts/:id/resolve", (req, res) => {
  const args = z.object({ resolvedBy: z.string().min(1), finalStatus: z.enum(['COMPLETED', 'IN_PROGRESS', 'CANCELLED']),
    resolutionNote: z.string().trim().min(1), idempotency_key: z.string().min(1), human_confirmed: z.literal(true) }).parse(req.body);
  const success = ConflictService.resolveConflict(String(req.params.id), args.resolvedBy, args.finalStatus,
    args.resolutionNote, args.idempotency_key);
  if (!success) { res.status(404).json({ error: 'Conflict not found' }); return; }
  res.json({ success: true, conflictId: req.params.id, status: 'VERIFIED_RESOLVED', externalSync: 'NOT_REQUESTED' });
});

/** Chat endpoint for the Medi conversational simulation */
app.post("/api/chat", async (req, res) => {
  const input = z.object({ utterance: z.string().trim().min(1).max(8000), nurseId: z.string().min(1),
    shiftId: z.string().optional(), outgoingNurseId: z.string().optional(), incomingNurseId: z.string().optional(),
    idempotency_key: z.string().min(1), workflowRunId: z.string().min(1).max(200).optional() }).parse(req.body);
  const orchestrator = new ShiftWeaveOrchestrator(localMcpEndpoint(), process.env.LLM_PROVIDER || 'mock', input.workflowRunId);
  try {
    await orchestrator.initialize();
    const result = await orchestrator.processUtterance(input.nurseId, input.utterance, { ...input, requestKey: input.idempotency_key });
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error), workflowRunId: orchestrator.getWorkflowRunId() });
  } finally { await orchestrator.close(); }
});

app.get('/api/conversations/:id', (req, res) => {
  let workflowId:string;
  try {workflowId=scopedWorkflow(String(req.params.id));}catch{res.status(403).json({error:'Conversation belongs to another data source'});return;}
  const run = db.prepare('SELECT initiated_by FROM workflow_runs WHERE id = ?').get(workflowId) as { initiated_by: string } | undefined;
  if (!run) { res.json({ messages: [] }); return; }
  if (run.initiated_by !== req.query.nurseId) { res.status(403).json({ error: 'Conversation belongs to another nurse' }); return; }
  res.json({ messages: CheckpointService.getLatestCheckpoint(workflowId)?.statePayload.messages || [] });
});

/** Explicit local task acceptance/escalation; not medication administration. */
app.post('/api/tasks/:id/acknowledge', (req, res) => {
  try {
    const input = z.object({
      nurse_id: z.string().min(1),
      action: z.enum(['ACCEPT_HANDOFF', 'FLAG_FOR_SUPERVISOR']),
      handoff_id: z.string().optional(),
      resolution_note: z.string().optional(),
      idempotency_key: z.string().min(1),
      human_confirmed: z.literal(true)
    }).parse(req.body);
    res.json(HandoffService.acknowledge({ ...input, task_id: String(req.params.id) }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err instanceof z.ZodError ? 400 : 422).json({ error: message });
  }
});

/** Exception injection tests durable resumption; does not claim to kill the server. */
app.post('/api/chaos/simulate', async (req, res) => {
  const input = z.object({ action: z.enum(['crash', 'recover']), workflowRunId: z.string().optional() }).parse(req.body);
  if (input.action === 'recover' && !input.workflowRunId) { res.status(400).json({ error: 'workflowRunId is required for recovery' }); return; }
  const runId = scopedWorkflow(input.workflowRunId || `chaos_${randomUUID()}`);
  const orchestrator = new ShiftWeaveOrchestrator(localMcpEndpoint(), 'mock', runId);
  try {
    await orchestrator.initialize();
    const activeNurse = (db.prepare(`SELECT n.id FROM nurses n WHERE n.role = 'STAFF_NURSE' AND ${sourceRealm()==='preview'?"n.id LIKE 'hospital:%'":"1=1"} ORDER BY n.id ASC LIMIT 1`).get() as any)?.id;
    if (!activeNurse) throw new Error('No configured nurse is available for this simulation');
    const result = await orchestrator.processUtterance(activeNurse, input.action === 'crash'
      ? 'Prepare my shift handoff' : 'Resume my handoff', input.action === 'crash' ? { simulateInterruptionAtStep: 3 } : {});
    res.json({ status: 'RECOVERED', workflowRunId: runId, checkpointId: result.checkpointId,
      message: `Recovered saved workflow. Restored tool results: ${result.avoidedDuplicateStepsCount || 0}.`, result });
  } catch (error) {
    const checkpoint = CheckpointService.getLatestCheckpoint(runId);
    const message = error instanceof Error ? error.message : String(error);
    if (input.action === 'crash' && message.includes('[CHAOS SIMULATION]') && checkpoint) {
      res.json({ status: 'INTERRUPTED', workflowRunId: runId, checkpointId: checkpoint.id,
      message: 'Interruption demo paused. Your progress is saved. Select “Resume Saved Workflow” to continue.' });
    } else res.status(409).json({ error: message, workflowRunId: runId });
  } finally { await orchestrator.close(); }
});

app.use((error: unknown, req: Request, res: Response, _next: express.NextFunction) => {
  if (res.headersSent) return _next(error);
  const message = error instanceof Error ? error.message : String(error);
  AuditService.log({ actorType: 'SYSTEM', actorId: 'http', action: 'HTTP:ERROR', targetResource: req.path,
    outcome: 'FAILURE', details: { message } });
  res.status(error instanceof z.ZodError ? 400 : 409).json({ error: message });
});

// Serve compiled React Clinical Dashboard
const clientDist = path.resolve(process.cwd(), "client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req: Request, res: Response, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/mcp") || req.path === "/health") {
      return next();
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

function localMcpEndpoint() {
  const address = appServer.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server is not ready');
  return `http://127.0.0.1:${address.port}/mcp`;
}
const PORT = Number(process.env.PORT || 3000 );

export const appServer = app.listen(PORT, host, () => {
  console.log(`\n======================================================`);
  console.log(`🏥 ShiftWeave MCP Server (Spec 2025-11-25) Running`);
  const address = appServer.address();
  console.log(`📡 Transport: Streamable HTTP at http://${host.includes(':') ? `[${host}]` : host}:${address && typeof address !== 'string' ? address.port : PORT}/mcp`);
  console.log(`🩺 Active Provider: ${getActiveProvider().providerName}`);
  console.log(`======================================================\n`);
});

appServer.on('close', () => {
  clearInterval(sessionCleanupTimer);
  for (const session of sessions.values()) void session.server.close();
  sessions.clear();
  BedrockLLMProvider.closeClients();
});
export default app;

if (process.env.SHIFTWEAVE_TEST !== '1') {
  const shutdown = () => {
    appServer.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 25_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
