# ShiftWeave — Full Codebase Understanding

**Last updated:** 2026-10-21  
**Based on:** Complete file-by-file reading of all source, service, provider, agent, client, script, deploy, and documentation files.

---

## 1. What ShiftWeave Is

ShiftWeave is a **nursing shift handoff and workflow coordination system** built for the Amazon Developer Hackathon (Alexa+ track). It is:

- A full-stack MCP server over **Streamable HTTP** (`POST /mcp`, spec `2025-11-25`)
- A multi-turn voice/chat agent with durable interruption recovery
- A React dashboard for nurses to see tasks, conflicts, handoffs, and audit traces
- An Epic FHIR R4 integration for read-only clinical context supplementation
- 100% locally runnable with synthetic demo data, zero cloud required (mock LLM + SQLite)

**Clinical safety boundary:** No autonomous diagnosis, treatment, medication administration, or order modification. All state-changing actions require explicit human confirmation.

---

## 2. Stack & Entry Points

| Component | Technology |
|---|---|
| Backend server | Node.js v22, TypeScript 5.7+, Express 5 |
| MCP protocol | `@modelcontextprotocol/sdk` v1.32+ |
| Database | `better-sqlite3` (WAL mode, synchronous FULL) |
| Input validation | `zod` v4 |
| LLM adapters | Mock (default), Google Gemini, AWS Bedrock Converse |
| Frontend | React + Vite (TypeScript) |
| Build | `tsx` for dev, `tsc` for production build |

**Dev startup:**
```sh
npm install && npm --prefix client install
npm run db:init && npm run import:data
npm run build:client
npm run dev
```

**Key env vars:** `LLM_PROVIDER` (mock/gemini/bedrock), `EPIC_CLIENT_ID`, `EPIC_READS_ENABLED`, `EPIC_WRITES_ENABLED`, `GEMINI_API_KEY`, `AWS_REGION`, `BEDROCK_MODEL_ID`

---

## 3. Project Structure

```
src/
  server.ts                    # Express app, MCP server factory, all REST endpoints
  runtime-config.ts            # host, allowedOrigins, demoAccess middleware
  agent/
    orchestrator.ts            # ShiftWeaveOrchestrator — multi-turn LLM+MCP agentic loop
    llm-provider.ts            # MockAutonomousAgent, GeminiLLMProvider, BedrockLLMProvider
    mcp-client-bridge.ts       # HTTP MCP client (JSON-RPC 2.0 + SSE parsing)
  db/
    connection.ts              # better-sqlite3 singleton
    schema.ts                  # 11 tables + migration helpers (initializeDatabase)
    init.ts                    # standalone db:init script
    ingest.ts                  # fixture import (nurses, patients, tasks, conflicts, shifts)
  providers/
    types.ts                   # IEHRProvider interface + all canonical types
    index.ts                   # singleton provider registry, getActiveProvider/setActiveProvider
    sqlite-cache-provider.ts   # local SQLite IEHRProvider implementation
    fhir-api-provider.ts       # live FHIR R4 IEHRProvider (currently disabled)
    epic-oauth.service.ts      # RFC 7523 RS384 JWT client assertion + token cache
    epic-mapping.service.ts    # Epic FHIR R4 → canonical ShiftWeave type mapping
    epic-workflow-source.ts    # fetchEpicWorkflowSnapshot (multi-section parallel FHIR fetch)
  services/
    handoff.service.ts         # createDraft, acknowledge, finalize
    checkpoint.service.ts      # saveCheckpoint, getLatestCheckpoint, markInterrupted, complete
    mutation.service.ts        # atomic receipt+domain+checkpoint+audit transaction wrapper
    recovery.service.ts        # reconcileAndResume — recovery plan builder
    conflict.service.ts        # flagConflict, resolveConflict, getUnresolvedConflicts
    audit.service.ts           # log, getRecentLogs
    voice.service.ts           # full voice state machine (VoiceService.turn)
    voice-agent.service.ts     # runVoiceTurn — bridges voice_turn MCP tool to VoiceService
    epic-workflow.service.ts   # EpicWorkflowService.sync, recordsForPatients, narrative
    epic-writeback.service.ts  # EpicWriteBackService.publishReviewedNote (mock/uncertain/live)
    epic-note.service.ts       # EpicNoteService.preview, publish
    epic-context.service.ts    # readEpicContext helper
    field-authority.service.ts # FIELD_AUTHORITY_MATRIX, buildIntegratedHandoffNarrative
    source-version.ts          # fingerprint of current source data for stale-read detection
    canonical-json.ts          # deterministic JSON serialization for receipt comparison
client/
  src/
    App.tsx / main.tsx         # React root
    api.ts                     # typed API client functions
    voice-api.ts               # voice session API helpers
    voice-types.ts             # voice display types
    useVoiceConversation.ts    # React hook for voice state
    components/
      VoiceWorkspace.tsx       # primary voice/chat UI (large component)
      AlexaVoiceSim.tsx        # simulated voice input/output panel
      TaskBoard.tsx            # task list with status display
      ConflictReviewDrawer.tsx # conflict review with note + final status
      ShiftHeader.tsx          # nurse/shift header bar
      ExecutionTracePanel.tsx  # live audit trace display
      ChaosControlBar.tsx      # simulate crash / resume controls
      EpicNoteReview.tsx       # note preview + publish button
scripts/
  run-tests.ts                 # isolated test runner (mcp/agent/chaos/all)
  verify-workflows.ts          # full test suite (protocol, API, recovery, human actions)
  test-browser-journey.ts      # end-to-end Seema→Reema workflow test (12 checks)
  test-writeback.ts            # EpicWriteBackService tests (8 checks)
  test-handoff-integration.ts  # FieldAuthority + draft/acknowledge/finalize tests
  test-integration-recovery.ts # chaos + process-restart recovery tests
  test-epic-reads.ts           # Epic FHIR R4 canonical mapping tests
  test-epic-oauth.ts           # Epic OAuth token exchange tests
  verify-epic-workflow.ts      # full Epic workspace sync + MCP workflow
  verify-gemini-live.ts        # live Gemini LLM integration test
  connect-epic.ts              # Epic workspace setup script
  probe-epic.ts                # Epic FHIR scope probe
  publish-approved-epic-note.ts # manual Epic note write (explicit only)
  verify-deployment.ts         # deployment smoke tests
  backup.ts, smoke.ts, preflight.ts, restart-worker.ts
deploy/
  ARCHITECTURE.md              # topology, tradeoffs, latency notes
  VERIFICATION.md              # deployment verification checklist
  epic-live-report.json        # evidence of live Epic reads
  epic-workflow-live-report.json
  epic-write-report.json       # evidence of HTTP 403 on write attempt
  epic-note-preview.json/md    # exact note that was attempted
  Caddyfile                    # HTTPS reverse proxy config
data/
  shiftweave.db                # main SQLite database
  epic-demo-*.db               # fresh Epic demo database (post-sync)
  incoming/                    # fixture template
backups/                       # SQLite backup files
keys/
  private_key.pem              # Epic RS384 private key (never committed)
```

---

## 4. Database Schema (11 Tables + 2 Epic Tables)

### Core tables
1. **nurses** — id, badge_number, full_name, email, department, role
2. **shifts** — id, unit_id, shift_type (DAY/NIGHT/ROTATING), start_time, end_time, status (ACTIVE/HANDOFF_IN_PROGRESS/…)
3. **patients** — id, mrn, full_name, room_number, bed_number, admission_date, acuity_level (nullable), allergies, primary_diagnosis
4. **tasks** — id, patient_id, title, description, category (VITAL/MEDICATION_CHECK/LAB_DRAW/WOUND_CARE/MOBILITY/CONSULT/DISCHARGE_PREP), status (PENDING/IN_PROGRESS/COMPLETED/CANCELLED/FLAGGED_CONFLICT), priority (STAT/URGENT/ROUTINE), scheduled_time, completed_time, source_system
5. **task_assignments** — id, task_id, nurse_id, shift_id, transfer_status (ACTIVE/CARRIED_FORWARD/TRANSFERRED/UNASSIGNED)
6. **task_events** — id, task_id, event_type, previous_value, new_value, source, actor_id, idempotency_key, metadata
7. **conflicts** — id, task_id, conflict_type (STATUS_MISMATCH/DUPLICATE_ORDER/STALE_DATA/UNASSIGNED_CARRIED_FORWARD), system_a_name/val, system_b_name/val, status (UNRESOLVED/VERIFIED_RESOLVED/DISMISSED), resolution_note, resolved_by, resolved_at
8. **handoffs** — id, shift_id, outgoing_nurse_id, incoming_nurse_id, status (DRAFT/UNDER_REVIEW/ACKNOWLEDGED/FINALIZED), summary_markdown, data_snapshot (JSON), unresolved_conflicts_count, external_sync_status (NOT_REQUESTED/PENDING/SYNCED/FAILED/UNCERTAIN), external_resource_id, external_sync_error, external_synced_at, external_sync_payload
9. **workflow_runs** — id, workflow_type (GENERATE_HANDOFF/RECOVER_INTERRUPTED_SHIFT/VERIFY_CONFLICTS), initiated_by, status (INITIATED/IN_PROGRESS/INTERRUPTED/COMPLETED/FAILED), error_message
10. **workflow_checkpoints** — id, workflow_run_id, step_index, step_name, state_payload (JSON), idempotency_key (UNIQUE)
11. **audit_log** — id, actor_type (NURSE/AGENT/MCP_SERVER/SYSTEM), actor_id, action, target_resource, outcome (SUCCESS/FAILURE/RECOVERED), details, latency_ms

### Additive tables
- **operation_receipts** — idempotency_key (PK), operation, request_json, response_json, created_at
- **epic_patient_snapshots** — patient_id (FK), epic_patient_id, endpoint, snapshot_json, retrieved_at, sync_status, last_error
- **epic_snapshot_versions** — id, patient_id, snapshot_json, retrieved_at (versioned history)

### Key migration notes
- `patients.acuity_level` was made nullable via safe table-rename migration
- `handoffs` external sync columns added via safe `ALTER TABLE … ADD COLUMN` (ignored if already exist)
- Schema initializes via `initializeDatabase()` called on server startup

---

## 5. MCP Tools (13 registered)

All tools run on `POST /mcp` with Streamable HTTP, session-isolated factory pattern, minimum protocol version `2025-11-25`.

| # | Tool Name | Purpose |
|---|---|---|
| 1 | `get_assigned_tasks` | Get nurse's tasks for a shift |
| 2 | `get_task_details` | Full task + patient + conflict detail |
| 3 | `get_task_changes` | Recent events since a timestamp |
| 4 | `get_handoff_context` | Full handoff context (tasks, conflicts, field authority matrix, Epic narrative) |
| 5 | `create_handoff_draft` | Persist a handoff draft; proposes carry-forward, does NOT transfer custody |
| 6 | `get_workflow_checkpoint` | Read latest checkpoint for a workflow run |
| 7 | `save_workflow_checkpoint` | Commit checkpoint with idempotency |
| 8 | `resume_workflow` | Reconcile and resume an interrupted workflow |
| 9 | `acknowledge_task` | Human-confirmed: ACCEPT_HANDOFF, FLAG_FOR_SUPERVISOR |
| 10 | `voice_turn` | Local demo voice state machine turn |
| 11 | `get_voice_display` | Read current voice session display state |
| 12 | `preview_epic_handoff_note` | Preview finalized note with review hash |
| 13 | `publish_reviewed_handoff_note` | Publish human-reviewed note to FHIR EHR (gated by EPIC_WRITES_ENABLED) |
| + | `get_epic_patient_context` | Read allowlisted Epic patient context |
| + | `sync_epic_workspace` | Fetch Epic patients into durable source snapshots |

**Session management:** Each `initialize` request creates a new `(McpServer, StreamableHTTPServerTransport)` pair stored in a `Map<sessionId, SessionRecord>`. Sessions expire after 30 minutes idle. GET `/mcp` handles SSE streams; DELETE `/mcp` terminates session.

---

## 6. Agent / Orchestrator Architecture

### ShiftWeaveOrchestrator (`src/agent/orchestrator.ts`)

The core agentic loop:
1. **Initialize** — MCP session + tool discovery. If `readOnly=true`, filters to read-only tools.
2. **processUtterance** — multi-turn loop (max 12 iterations, 55s budget):
   - Checks `busyRuns` set (per-run concurrency guard)
   - Checks `operation_receipts` for exact HTTP retry replay
   - Detects resume intent (`/resume|recover|continue/`) → calls `resume_workflow` MCP tool
   - Otherwise validates nurse identity, shift ownership, and workflow ownership
   - Iterates: LLM decides → intent persisted → tool called → result persisted → repeat
   - Final speech triggers receipt commit + `workflow_checkpoints` completion
3. **Recovery path:** If `sourceVersion` changed since checkpoint, stale read results are stripped and mutation-committed results are preserved. `avoidedDuplicateStepsCount` counts reused results.
4. **Constraint enforcement:** Only `create_handoff_draft` + read tools allowed from agent. All human-confirmation actions go through dashboard controls, not agent.

### LLM Providers (`src/agent/llm-provider.ts`)

- **MockAutonomousAgent** (default, `mock-autonomous`): Deterministic rule-based agent. Calls tools in order: get_assigned_tasks → get_handoff_context → create_handoff_draft. Refuses clinical actions. Renders facts from actual tool results only.
- **GeminiLLMProvider** (`gemini`): Uses `@google/generative-ai`, native function declarations. Strips `$schema`/`$id` from MCP JSON Schema via `toGeminiToolSchema()`. Parallel tool calls rejected.
- **BedrockLLMProvider** (`bedrock`): Uses `@aws-sdk/client-bedrock-runtime` ConverseCommand. Tool-use IDs and tool-result messages preserved via `toBedrockMessages()`. SDK credential chain (no hardcoded creds). 30s timeout per call. Parallel tool calls rejected.
- **Important:** If cloud LLM returns `finalSpeech` directly (not through mock-autonomous), it is discarded and `MockAutonomousAgent` re-runs the decision. Clinical prose from cloud models is never displayed as verified facts.

### MCPClientBridge (`src/agent/mcp-client-bridge.ts`)

HTTP JSON-RPC 2.0 client. Handles:
- SSE (`text/event-stream`) response parsing alongside plain JSON
- Session ID header management (`mcp-session-id`, `MCP-Protocol-Version: 2025-11-25`)
- 30s default timeout, 95s for `voice_turn` and `sync_epic_workspace`
- `close()` sends DELETE to server, tolerates 404

---

## 7. Core Services

### MutationService (`src/services/mutation.service.ts`)
**Every write goes through this.** Single method `execute(operation, key, request, actorId, action)`:
- Runs in `db.transaction().immediate()`
- Checks `operation_receipts` for idempotency; returns prior response if key matches
- Rejects key reuse with different operation/request
- On new request: runs `action()`, saves checkpoint, completes run, writes receipt, writes audit log
- All in one atomic SQLite transaction

### CheckpointService (`src/services/checkpoint.service.ts`)
- `saveCheckpoint(runId, stepIndex, stepName, statePayload, idempotencyKey)` — upserts workflow_run + inserts checkpoint
- `getLatestCheckpoint(runId)` — highest stepIndex for the run
- `markInterrupted(runId, errorMessage)` — sets status INTERRUPTED
- `completeWorkflowRun(runId)` — sets status COMPLETED
- Checkpoint `statePayload` contains: `messages`, `pendingTool`, `turnId`, `toolIndex`, `context`, `requestKey`, `requestJson`, `sourceVersion`, `finalSpeech`

### RecoveryService (`src/services/recovery.service.ts`)
- `reconcileAndResume(workflowRunId, idempotencyKey)` returns `RecoveryPlan`
- Inspects all checkpoints to find committed RESULT:* steps
- Detects pending mutation key in `operation_receipts` (was it already committed?)
- Detects source version change (`sourceVersion` vs `sourceVersion()`)
- Returns: `ALREADY_COMPLETED`, `RECOVERED`, or `CANNOT_RECOVER`
- `reconciledState.sourceChanged` tells orchestrator to strip stale reads
- `reconciledState.pendingMutationCommitted` tells orchestrator whether pending tool already ran

### HandoffService (`src/services/handoff.service.ts`)
- `createDraft(args)` — validates nurses, tasks, carry-forward candidates; builds SBAR summary; inserts handoff row; returns `{handoff_id, status:'DRAFT', ...}`
  - If `epic_clinical_context` provided → `FieldAuthorityService.buildIntegratedHandoffNarrative()`
  - Always appends Epic source narrative via `EpicWorkflowService.narrative()`
  - Snapshot includes `epicRecords`, `tasks`, `carriedForwardIds`, optionally `epicClinicalContext` + `fieldAuthority`
- `acknowledge(args)` — ACCEPT_HANDOFF: transfers task_assignment from outgoing to incoming nurse, sets handoff to UNDER_REVIEW; FLAG_FOR_SUPERVISOR: adds task_event with note
- `finalize(handoffId, nurseId, key, humanConfirmed)` — verifies no unresolved conflicts, verifies incoming nurse accepted all carry-forward tasks (ACTIVE assignment), sets handoff FINALIZED

### ConflictService (`src/services/conflict.service.ts`)
- `getUnresolvedConflicts()` — joins conflicts + tasks + patients
- `getConflictByTaskId(taskId)` — latest UNRESOLVED conflict for a task
- `flagConflict(...)` — inserts conflict record, sets task status to FLAGGED_CONFLICT
- `resolveConflict(conflictId, nurseId, finalStatus, note, key)` — requires non-empty note; sets conflict VERIFIED_RESOLVED; updates task status; inserts task_event

### VoiceService (`src/services/voice.service.ts`)
Full voice state machine. Key points:
- State: `{revision, nurse, shift, pending, selectedTaskId, selectedHandoffId, focus, messages, speech}`
- Stored in `workflow_checkpoints` under runId `voice:{session_id}`
- `turn(input)` — intent classification via regex; MutationService for idempotency
- Confirmation flow: `stage(state, pending)` → expired/stale-source check → `confirm` executes transaction
- Actions handled: identify, sign-out, task summary, room/patient detail, conflict review (multi-turn with RESOLVE), escalation, prepare handoff, accept custody, finalize, review handoff
- **Not authentication** — name matching is demo identity selection only
- `saveAssistantTurn(input, speech)` — used by voice-agent service when LLM generates speech externally

### EpicWorkflowService (`src/services/epic-workflow.service.ts`)
- `sync(input)` — gated behind `EPIC_READS_ENABLED=true`; iterates `EPIC_TEST_PATIENT_IDS`; for each: calls `fetchEpicWorkflowSnapshot`, upserts patients table, inserts review task + assignment, saves snapshots; atomic via MutationService; full idempotency
- `recordsForPatients(ids)` — reads `epic_patient_snapshots` + joins `patients`
- `recordsForNurse(nurseId, shiftId)` — finds assigned patient IDs, delegates to `recordsForPatients`
- `narrative(records)` — generates text block with source labels, per-section counts, medication orders (explicitly labeled as orders, not administrations), warnings

### FieldAuthorityService (`src/services/field-authority.service.ts`)
- `FIELD_AUTHORITY_MATRIX` — 8 fields with authoritative system and reconciliation rule
  - Epic authoritative: patient.demographics, primaryDiagnosis, allergies, task.medicationOrder
  - ShiftWeave authoritative: task.nursingCustody, task.workflowStatus, task.acknowledgementAndEvents, handoff.custodyTransfer
- `namespaceId(system, resourceType, rawId)` → e.g. `epic:Patient:erXuFYUfucBZaryVksYEcMg3`
- `buildIntegratedHandoffNarrative(params)` — SBAR sections: Situation, Clinical Context (Epic FHIR), Bedside Workflow State (ShiftWeave), Assessment & Discrepancies, Workflow Follow-up

### EpicWriteBackService (`src/services/epic-writeback.service.ts`)
- `publishReviewedNote(input)` — only handles `mock` and `simulate_uncertain` modes internally; delegates `live` to `EpicNoteService.publish()`
- Gates: humanConfirmed=true, unresolved_conflicts_count=0, active custody (ACTIVE task assignment)
- Already SYNCED: returns cached result
- `reconcileRemoteNote()` — checks in-memory mock store for prior commit (prevents duplicate on retry)
- `simulate_uncertain`: sets UNCERTAIN, pre-commits to mock store (tests reconciliation flow)
- `mock`: generates `doc_mock_*` ID, commits to mock store + DB
- `buildDocumentReferencePayload()` — US Core FHIR R4 DocumentReference (LOINC 11506-3, base64 text/plain)

### EpicOAuthService (`src/providers/epic-oauth.service.ts`)
- RFC 7523 RS384 client assertion JWT (`alg:RS384, typ:JWT, kid:keyId`)
- Token exchange with Epic (`client_credentials` grant)
- In-memory token cache with 60s expiry buffer; single in-flight token request (deduplication via Promise)
- Auto-refresh on HTTP 401 from FHIR calls
- `authorizedFetch<T>(resourcePath, options)` — injects Bearer token, handles 401 retry, surfaces errors explicitly
- `resolveResourceUrl()` — validates resource path stays within configured FHIR base URL (SSRF protection)

### EpicMappingService (`src/providers/epic-mapping.service.ts`)
- `mapToCanonicalPatient(epicPatient, encounters, conditions, allergies)` → `Patient`
- `mapMedicationRequestToTask(medReq, patientName, roomNumber)` → `Task` (category: MEDICATION_CHECK, source_system: EPIC_FHIR_R4)
- `getPatientClinicalContext(patientId)` → `EpicClinicalContext` (parallel fetch: Patient, Encounter, Condition, AllergyIntolerance, MedicationRequest, DocumentReference; rejects paginated results; rejects non-Bundle responses)
- `resolveDocumentContent(docRef)` — decodes inline base64 or follows Binary URL reference

---

## 8. REST API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/mcp` | Primary MCP Streamable HTTP endpoint |
| GET | `/mcp` | SSE stream for active session |
| DELETE | `/mcp` | Terminate MCP session |
| GET | `/health` | Server health + provider info |
| GET | `/readyz` | SQLite probe for load balancer |
| POST | `/api/voice` | Voice turn (bridges through MCP) |
| GET | `/api/voice/:sessionId` | Read voice session display |
| GET | `/api/execution-trace` | Recent audit log (max 500) |
| GET | `/api/conflicts` | Unresolved conflicts |
| POST | `/api/conflicts/:id/resolve` | Resolve conflict (requires human_confirmed:true) |
| POST | `/api/provider/switch` | Switch active provider (live-fhir-api currently throws) |
| GET | `/api/providers` | List available providers |
| GET | `/api/tasks` | All tasks with patient/nurse info |
| GET | `/api/handoffs` | All handoffs |
| POST | `/api/handoffs/:id/finalize` | Finalize handoff |
| GET | `/api/handoffs/:id/epic-note-preview` | Preview Epic note |
| POST | `/api/handoffs/:id/publish-note` | Publish Epic note (gated) |
| POST | `/api/tasks/:id/acknowledge` | Acknowledge task (human_confirmed:true) |
| POST | `/api/chat` | Chat/utterance processing via orchestrator |
| GET | `/api/conversations/:id` | Conversation history |
| POST | `/api/chaos/simulate` | Inject chaos or recover |

---

## 9. Provider Architecture

`IEHRProvider` interface defines: `getPatientsByUnit`, `getTasksForNurse`, `getTaskDetails`, `getRecentEvents`, `updateTaskStatus`, optional `syncFromExternalFHIR`, `writeHandoffDocument`.

**SQLiteCacheProvider** (default, `sqlite-edge-cache`): reads from local SQLite. Always selected.  
**LiveFHIRProvider** (`live-fhir-api`): `setActiveProvider('live-fhir-api')` throws an explicit error — not yet configured. Selecting it does not silently fall back to mock.

Provider singleton managed by `src/providers/index.ts`. `getActiveProvider()` always returns the current instance.

---

## 10. Voice Workspace

**Browser simulation of Alexa+ voice/chat:**
- `VoiceWorkspace.tsx` — main panel with voice input, display cards, task/conflict/handoff views
- `AlexaVoiceSim.tsx` — speech recognition (Web Speech API) + synthesis (SpeechSynthesis)
- `useVoiceConversation.ts` — React hook managing session_id, revision, idempotency key
- `voice-agent.service.ts` — `runVoiceTurn(input, mcpEndpoint)`: if utterance starts with `ask ` or `alexa ask`, routes to orchestrator (read-only mode); otherwise routes to `VoiceService.turn()`

**Voice state machine flow:**
1. Nurse says "I am Seema" → name matched → shift loaded → summary spoken
2. "Explain room 305" → task detail read from DB
3. "Resolve discrepancy in room 305 because in progress" → RESOLVE pending staged, prompt spoken
4. "Confirm" → `ConflictService.resolveConflict()` committed
5. "Prepare my handoff for Reema" → draft created, custody NOT transferred
6. "I am Reema" → identity switch
7. "Accept all handoff tasks" → ACCEPT pending staged
8. "Confirm" → `HandoffService.acknowledge()` transfers task_assignment
9. "Finalize handoff" + "Confirm" → `HandoffService.finalize()` (checks: no conflicts, accepted custody)
10. "End my session" → state cleared

---

## 11. Epic Integration Status

**Non-production credentials registered:**
- Client ID: `ccc8c11f-4af0-4caf-b981-848012aab1a2`
- JWKS hosted: `https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json`
- Key algorithm: RS384, RSA-2048
- SMART v2 scopes: `system/DocumentReference.r`, `system/DocumentReference.s` (read/search only)
- Sandbox: `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`

**Verified live (21 Oct 2026):**
- OAuth token exchange: ✅
- Patient read (`erXuFYUfucBZaryVksYEcMg3` — Camila Maria Lopez): ✅
- Encounter (10 records), Condition (7), AllergyIntolerance (1), MedicationRequest (1): ✅
- MedicationAdministration/DocumentReference: returned OperationOutcome warning (no records — not failure)
- Practitioner.Read: HTTP 403
- DocumentReference.Create: HTTP 403 (write scopes not granted)

**Current Epic database:** `data/epic-demo-1792585651290.db` (fresh, post-sync, integrity verified)

**Epic reads gated:** `EPIC_READS_ENABLED=true` required in `.env`  
**Epic writes disabled:** `EPIC_WRITES_ENABLED=true` required, currently not set

---

## 12. Idempotency & Recovery Architecture

Every mutation flows through `MutationService.execute()` which provides:
1. **Read receipt** — if key exists with matching op+request, return prior response
2. **Execute action** — run domain write
3. **Write receipt** — save `operation_receipts` row
4. **Checkpoint** — save `workflow_checkpoints` row
5. **Audit** — save `audit_log` row
6. All in one `db.transaction().immediate()` call

**Chat turn idempotency:** `requestKey` (caller-supplied `idempotency_key`) is stored in checkpoint. Exact HTTP retry returns the original `OrchestrationResult` from `operation_receipts`. Key reuse with different request throws.

**Source version tracking:** `sourceVersion()` fingerprints the current DB state. If a checkpoint's `sourceVersion` differs from current on resume, stale read results are dropped and only committed mutation results are retained.

**Process-exit recovery:** The test suite (`test:chaos`) spawns a worker process, commits a draft, kills the process before checkpoint, then starts a fresh process and calls `resume_workflow`. The fresh process reads `workflow_checkpoints` and `operation_receipts` from SQLite to reconstruct state.

---

## 13. Conflict/Custody Human Gate Invariants

- **No custody transfer from draft creation alone.** `create_handoff_draft` only writes a DRAFT handoff row.
- **ACCEPT_HANDOFF requires `handoff_id`** and incoming nurse must be `incoming_nurse_id`.
- **Task must be a carry-forward candidate** (in `data_snapshot.carriedForwardIds`) with no unresolved conflict.
- **Finalize requires:** all carry-forward tasks accepted by incoming nurse (ACTIVE assignment in correct shift), zero UNRESOLVED conflicts on all snapshot tasks.
- **Conflict resolution requires:** `human_confirmed:true`, `finalStatus`, non-empty `resolutionNote`, valid `idempotency_key`.
- **Agent cannot:** acknowledge tasks, resolve conflicts, finalize handoffs, publish notes — these all require explicit human action through dashboard endpoints or voice confirm flow.

---

## 14. Field Authority Matrix Summary

| Field | Authoritative System | Rule |
|---|---|---|
| patient.demographics | Epic FHIR R4 | EHR authoritative; local reflects master on read |
| patient.primaryDiagnosis | Epic FHIR R4 | EHR authoritative; agent never alters |
| patient.allergies | Epic FHIR R4 | EHR authoritative; missing is surfaced explicitly |
| task.medicationOrder | Epic FHIR R4 | Order parameters from EHR; bedside changes need physician orders |
| task.nursingCustody | ShiftWeave | Local SQLite; EHR doesn't track bedside shift transfers |
| task.workflowStatus | ShiftWeave | Bedside execution; divergence from EHR triggers human review |
| task.acknowledgementAndEvents | ShiftWeave | Committed with idempotency; never overwritten by EHR reads |
| handoff.custodyTransfer | ShiftWeave | Two-party human review; draft ≠ custody transfer |

---

## 15. Test Suite

Run with `npm test` (uses isolated SQLite, isolated HTTP server):

- **MCP protocol tests** (`test:mcp`): initialize, tool list, protocol version, session management
- **Agent tests** (`test:agent`): chat turns, receipt replay, source reconciliation, LLM message adapters
- **Chaos tests** (`test:chaos`): simulated interruption + recovery, worker process exit recovery
- **Human action tests**: conflict resolution, custody acceptance, finalization invariants

Additional targeted scripts:
- `npm run test:epic` — OAuth token exchange (5 checks, requires Epic config)
- `npm run test:epic-reads` — canonical FHIR mapping (8 checks)
- `npm run test:handoff` — FieldAuthority + handoff integration (9 checks)
- `npm run test:recovery` — chaos + reconciliation (7 checks)
- `npm run test:browser` — full Seema→Reema voice journey (12 checks)
- `npm run test:writeback` — EpicWriteBackService mock/uncertain/reconcile (8 checks)

---

## 16. Known Limitations & Boundaries

- **No production nurse authentication.** Nurse IDs are demo context bindings.
- **No live Epic write-back.** `EPIC_WRITES_ENABLED` not set; HTTP 403 was received on write attempt.
- **Live FHIR provider disabled.** Selecting it throws explicit error.
- **Two patients, two tasks** in synthetic fixture.
- **No production hospital task mappings** (Episode Checklist, Community Resource Task APIs differ from generic task APIs).
- **SQLite single-writer** — no multi-region, no NFS/EFS, one EC2 host architecture.
- **MCP sessions invalidated on server restart** — workflow checkpoints survive in SQLite.
- **No TTFT streaming** — LLM responses buffered; browser speech starts after complete response.
- **Bedrock and Gemini not verified by automated tests** — only message construction and config errors are tested locally.

---

## 17. Deployment Notes

- **Recommended:** EC2 with EBS-backed SQLite, Caddy HTTPS, optional Bedrock
- **Caddy config:** `deploy/Caddyfile` — HTTPS reverse proxy with demo access gate
- **Docker:** `Dockerfile` + `compose.yaml` present
- **`runtime-config.ts`** controls: `host` (loopback by default), `allowedOrigins` (CORS), `demoAccess` middleware (token gate for deployed demo)
- **Backups:** `npm run backup` → copies SQLite to `backups/` with timestamp prefix
- **Preflight:** `npm run preflight` runs before `npm start` to verify environment
- **Health endpoint:** `GET /readyz` for load balancer probe (SQLite `SELECT 1`)

---

## 18. Friction Log Key Points (for Judging)

Seven documented friction items:
1. MCP multi-session `Already connected to transport` → per-session factory + Map registry
2. Streamable HTTP header `Accept: application/json, text/event-stream` requirement
3. Express 5 `path-to-regexp` v8 wildcard `*` breakage → filter middleware
4. ESM `verbatimModuleSyntax` + `import type` requirement for Express types
5. MCP tool schema ↔ Bedrock Converse schema translation (`inputSchema.json` wrapping)
6. Public FHIR sandbox latency (800-4500ms) + write restrictions → hybrid edge-cache architecture
7. Epic JWKS hosting (GitHub Pages), SMART v2 scope selection, FHIR ID generation scheme choices

Up to 10% bonus from friction log in Stage 1 downselection.
