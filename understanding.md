# ShiftWeave — Complete Codebase Understanding

> Last updated: 21 October 2026. Covers every file and directory in the repository.

---

## What This Project Is

**ShiftWeave** is an AI-assisted nursing shift handoff coordinator built for the Amazon Developer Hackathon (Alexa+ Track). It is not a chatbot. It is a fault-tolerant, stateful, MCP-native workflow engine that:

- Coordinates the handoff of clinical tasks from one nurse (Seema, outgoing) to another (Reema, incoming).
- Detects and surfaces EHR data discrepancies for mandatory human review.
- Persists multi-step workflow progress across crashes/reconnects using SQLite checkpoints.
- Exposes 11 MCP tools over Streamable HTTP (`POST /mcp`, protocol `2025-11-25`).
- Simulates Alexa+ voice interaction in the browser using Web Speech API.

All data is synthetic. There is no real patient data, no production authentication, and no live hospital connection by default.

---

## Directory Map

```
dev_assist/
├── src/                  — Backend TypeScript (Node.js, Express, MCP server)
│   ├── server.ts         — Main entry point: Express app + MCP tool registrations
│   ├── db/               — SQLite layer
│   ├── agent/            — LLM orchestrator + MCP client bridge
│   ├── providers/        — EHR provider abstraction (SQLite / FHIR)
│   └── services/         — Core business logic services
├── client/               — React + TypeScript frontend (Vite)
│   └── src/
│       ├── components/   — UI components
│       ├── api.ts        — Frontend REST API calls
│       ├── voice-api.ts  — Voice session API
│       └── types.ts      — Shared frontend types
├── scripts/              — Test and verification scripts
├── data/
│   ├── shiftweave.db     — SQLite database (WAL mode)
│   └── incoming/         — Drop zone for JSON clinical fixture files
├── keys/                 — RSA private key for Epic OAuth (not committed)
└── .agents/              — Agent skill rules for AI coding assistants
```

---

## Backend Source Files (`src/`)

### `src/server.ts`
The central file. Does everything:
- Starts Express on `PORT` (default 3000).
- Serves the React client build from `client/dist/`.
- Mounts `StreamableHTTPServerTransport` on `POST /mcp` — one `McpServer` instance per session (factory pattern to avoid "already connected" errors).
- Manages MCP session lifecycles: runs a background maintenance interval (every 5 minutes) evicting sessions idle for >30 minutes with `.unref()` and server shutdown cleanup.
- Registers all **11 MCP tools** with Zod-validated inputs.
- Exposes companion REST endpoints: `/api/chat` (with dynamic nurse-unit active shift resolution), `/api/tasks`, `/api/conflicts`, `/api/handoffs`, `/api/execution-trace` (configurable limit via `?limit=`, default 100, max 500), `/api/provider/switch`, `/api/chaos/simulate`, `/health`, and voice endpoints.
- Optimizes voice turn latency: `POST /api/voice` dispatches directly to `VoiceService.turn()` in-process, bypassing redundant self-connecting MCP HTTP overhead (~80–150ms faster per turn) while preserving the external `voice_turn` MCP tool over `/mcp`.
- Implements route-level error handling on `/api/handoffs/:id/finalize` and `/api/tasks/:id/acknowledge`, returning HTTP 400 for schema validation failures and HTTP 422 for clinical prerequisites (e.g., unresolved discrepancies, unaccepted custody).
- Calls `initializeDatabase()` on startup and automatically prunes `operation_receipts` older than 3 days.

**MCP Tools registered in server.ts:**

| # | Tool name | Purpose |
|---|-----------|---------|
| 1 | `get_assigned_tasks` | Tasks for a nurse/shift, with optional status filter |
| 2 | `get_task_details` | Single task with patient info and conflict flag |
| 3 | `get_task_changes` | Events since a timestamp or checkpoint |
| 4 | `get_handoff_context` | Outgoing nurse metrics, unresolved conflicts, candidate tasks |
| 5 | `create_handoff_draft` | Creates DRAFT handoff record; does NOT transfer custody |
| 6 | `get_workflow_checkpoint` | Retrieves latest checkpoint for a run ID |
| 7 | `save_workflow_checkpoint` | Commits a step snapshot with idempotency key |
| 8 | `resume_workflow` | Reconciles DB state, returns recovery plan |
| 9 | `acknowledge_task` | Human custody acceptance or supervisor escalation |
| 10 | `voice_turn` | Processes one nurse voice/text turn via VoiceService |
| 11 | `get_voice_display` | Returns current voice session display state |

---

### `src/db/`

**`connection.ts`** — Opens `better-sqlite3` on `SQLITE_DB_PATH`. Enables WAL mode, foreign keys, and `NORMAL` synchronous writes. Exports the singleton `db` instance used everywhere.

**`schema.ts`** — Defines and runs `CREATE TABLE IF NOT EXISTS` for all **12 tables** (11 domain + 1 additive receipts). Also runs safe `ALTER TABLE` migrations for Epic sync columns on existing databases.

Tables:
| Table | Purpose |
|-------|---------|
| `nurses` | Nurse identity records |
| `shifts` | Shift windows per unit |
| `patients` | Patient demographics and room |
| `tasks` | Clinical/workflow tasks |
| `task_assignments` | Nurse ↔ task ↔ shift linkage with transfer status |
| `task_events` | Immutable event log (status changes, notes, conflicts) |
| `conflicts` | EHR discrepancies requiring human resolution |
| `handoffs` | Handoff draft/review/finalized records with external sync state |
| `workflow_runs` | Top-level workflow execution records |
| `workflow_checkpoints` | Step-level state snapshots with idempotency key |
| `audit_log` | Every tool/agent/nurse action with latency |
| `operation_receipts` | Durable receipts binding idempotency key → request+response |

**`init.ts`** — CLI entry point (`npm run db:init`). Just calls `initializeDatabase()`.

**`ingest.ts`** — CLI entry point (`npm run import:data`). Reads all `.json` files from `data/incoming/`, validates with Zod, and runs an atomic SQLite transaction inserting nurses, shifts, patients, tasks, assignments, and conflicts. Uses `MutationService.execute` so re-importing the same file is idempotent (SHA-256 content hash as key). Enforces: flagged tasks must have explicit conflict records.

---

### `src/agent/`

**`mcp-client-bridge.ts`** — HTTP client implementing MCP `2025-11-25`. Sends `initialize` → `notifications/initialized` → `tools/list` → `tools/call` over `POST /mcp`. Handles both JSON and SSE (`text/event-stream`) response formats. Sends `DELETE /mcp` on `close()`. Preserves session ID via `mcp-session-id` header.

**`llm-provider.ts`** — Defines `ILLMProvider` interface and three implementations:
- `MockAutonomousAgent` — Deterministic rule-based agent. Decides tool calls based on utterance keywords and already-received tool results. Enforces clinical safety boundary (refuses diagnosis/treatment requests). Default for local/test runs.
- `GeminiLLMProvider` — Uses `@google/generative-ai`. Filters out voice/mutation tools from function declarations. Requires `GEMINI_API_KEY`.
- `BedrockLLMProvider` — Uses `@aws-sdk/client-bedrock-runtime` Converse API. Uses SDK credential chain. Preserves tool-use IDs. Requires `AWS_REGION` + `BEDROCK_MODEL_ID`.

Also exports `toBedrockMessages()` and `toGeminiMessages()` for native format conversion.

`getLLMProvider(id)` selects by `LLM_PROVIDER` env var: `mock` | `gemini` | `bedrock`.

**`orchestrator.ts`** — `ShiftWeaveOrchestrator` class. Multi-turn loop:
1. Loads latest checkpoint for the run ID.
2. Checks for pending tool (from interrupted run) and replays its result if already receipted.
3. Calls `llmProvider.decideNextStep()` to get next tool call or final speech.
4. Executes tool via `mcpBridge.callTool()`.
5. Saves checkpoint after each mutation tool.
6. Repeats until `finalSpeech` is returned.
7. Persists conversation history + pending tool intent in SQLite checkpoint.

Supports `simulateInterruptionAtStep` for chaos testing (throws after a specified step).

---

### `src/providers/`

**`types.ts`** — Core domain types (`Patient`, `Task`, `TaskEvent`, `Nurse`, `Shift`) and the `IEHRProvider` interface with methods: `ping`, `getPatientsByUnit`, `getTasksForNurse`, `getTaskDetails`, `getRecentEvents`, `updateTaskStatus`, and optional `syncFromExternalFHIR` / `writeHandoffDocument`.

**`sqlite-cache-provider.ts`** — `SQLiteCacheProvider` implements `IEHRProvider` using direct `better-sqlite3` queries. Primary local provider. Returns tasks with patient name/room joined. `isEdgeCache = true`.

**`fhir-api-provider.ts`** — `LiveFHIRProvider` implements `IEHRProvider`. Currently configured to return an explicit configuration error rather than silently fall back. Selecting this provider returns an error (no live Epic mapping is configured yet). `isEdgeCache = false`.

**`index.ts`** — Singleton provider instances. `getActiveProvider()` returns current provider. `setActiveProvider()` switches provider but blocks `live-fhir-api` with a clear error. `listAvailableProviders()` lists both with active flag.

**`epic-oauth.service.ts`** — `EpicOAuthService`. Implements RFC 7523 RS384 JWT client assertion generation, token exchange against Epic's OAuth endpoint, in-memory token caching with 60-second expiry buffer, and automatic refresh on 401. Requires `./keys/private_key.pem` and `EPIC_CLIENT_ID`.

**`epic-mapping.service.ts`** — `EpicMappingService`. Maps Epic FHIR R4 resources (Patient, Encounter, Condition, AllergyIntolerance, MedicationRequest, DocumentReference) to ShiftWeave canonical models. Resolves room/bed from Encounter.location. Decodes Binary document content inline.

---

### `src/services/`

**`audit.service.ts`** — `AuditService.log()`. Inserts a row into `audit_log` with actor, action, resource, outcome, latency, and details (JSON-serialized).

**`checkpoint.service.ts`** — `CheckpointService`. Key methods:
- `initWorkflowRun()` — Creates a `workflow_runs` row, returns run ID.
- `saveCheckpoint()` — Inserts into `workflow_checkpoints` with idempotency check. Rejects key reuse for different state.
- `getLatestCheckpoint()` — Returns highest step_index checkpoint for a run.
- `getAllCheckpoints()` — Returns all checkpoints for a run (used for recovery).
- `completeWorkflowRun()` — Sets run status to `COMPLETED`.

**`mutation.service.ts`** — `MutationService.execute()`. Wraps any domain write in a single SQLite `IMMEDIATE` transaction that: checks `operation_receipts` for prior execution (idempotency), runs the action, saves a checkpoint, completes the run, writes the receipt, and logs to audit. If the key already exists with the same request, returns the stored response without re-executing.

**`recovery.service.ts`** — `RecoveryService.reconcileAndResume()`. Loads the latest checkpoint and all checkpoints for a run. Reads committed mutation receipts. Determines pending tool from checkpoint state. Checks if source data changed (via `sourceVersion()`). Returns a `RecoveryPlan` with `alreadyCommittedSteps`, `remainingStepsToExecute`, and `avoidedDuplicateStepsCount`.

**`conflict.service.ts`** — `ConflictService`. `getUnresolvedConflicts()` joins `conflicts` + `tasks` + `patients`. `resolveConflict()` requires `resolvedBy`, `finalStatus`, `resolutionNote`, `human_confirmed: true`, and an idempotency key. Updates the conflict record via `MutationService`.

**`handoff.service.ts`** — `HandoffService`. Three methods:
- `createDraft()` — Validates nurses exist, validates carry-forward tasks are unfinished, builds SBAR narrative (from Epic context via `FieldAuthorityService` if provided, otherwise from local records), inserts DRAFT handoff row. Does NOT transfer custody.
- `acknowledge()` — Handles `ACCEPT_HANDOFF` (transfers task_assignment from outgoing to incoming nurse, requires `handoff_id`) or `FLAG_FOR_SUPERVISOR` (requires a note). Both require `human_confirmed: true`.
- `finalize()` — Requires: incoming nurse, no unresolved conflicts on any handoff task, all carry-forward tasks accepted. Sets handoff to `FINALIZED`.

**`voice.service.ts`** — `VoiceService`. The most complex service. Manages a stateful voice session per `session_id`. State includes: active nurse, active shift, pending confirmation, message history, task/conflict/handoff focus. Key behaviors:
- Identity: matches nurse by first/full name or badge. Clears session on unknown name.
- Deterministic phrase interpreter: handles task summaries, room details, discrepancy explanation, draft creation, custody acceptance, finalization, escalation, session end, confirmation, cancellation.
- Pending confirmation: stages an action (RESOLVE/ACCEPT/FINALIZE/ESCALATE) with a 5-minute expiry. "Confirm"/"Yes" executes it; "Cancel"/"No" dismisses it. Any mutation, identity change, or expired time invalidates it.
- Immediate expiry check: `load()` clears expired pending confirmations immediately (`expiresAt < Date.now()`), preventing the dashboard or subsequent voice turns from displaying or acting on stale confirmations.
- State is persisted in SQLite checkpoints using `voice:{session_id}` run ID. Operation receipts and revision checks prevent duplicate mutations on retried requests.

**`field-authority.service.ts`** — `FieldAuthorityService`. Defines which fields are authoritative from Epic vs local ShiftWeave (e.g., allergies and diagnoses from Epic, task status and custody from local). `buildIntegratedHandoffNarrative()` merges Epic clinical context with local task/conflict state into a grounded SBAR narrative while enforcing source boundaries.

**`epic-writeback.service.ts`** — `EpicWriteBackService`. Constructs a US Core FHIR R4 `DocumentReference` payload (LOINC `11506-3`, base64 attachment) for clinical notes write-back. Enforces safety gates: explicit human review, zero unresolved conflicts, accepted custody. Manages an external sync state machine (`NOT_REQUESTED` → `PENDING` → `SYNCED`/`FAILED`/`UNCERTAIN`). Performs remote reconciliation before retries. Currently blocked by Epic sandbox read-only permissions (`system/DocumentReference.c` requires production approval).

**`source-version.ts`** — `sourceVersion()`. Returns a hash of the current patient/task data state. Used by recovery to detect whether source records changed between a checkpoint and resume.

**`canonical-json.ts`** — `canonicalJson()`. Deterministic JSON serialization (sorted keys) used for idempotency key comparisons.

---

## Frontend (`client/src/`)

### Build setup
- Vite + React + TypeScript.
- `vite.config.ts` proxies `/api`, `/health`, `/mcp` to `localhost:3000` in dev.
- Production build goes to `client/dist/` and is served by Express.

### `App.tsx`
Minimal — just renders `<VoiceWorkspace />`.

### `main.tsx`
Bootstraps React into `#app` div.

### `api.ts`
All REST calls to the backend. Key exports:
- `fetchTasks()`, `fetchConflicts()`, `fetchHandoffs()`, `fetchExecutionTrace()`, `fetchHealth()` — GET calls.
- `resolveConflict()`, `acknowledgeTask()`, `finalizeHandoff()` — mutation calls with per-action retry key management.
- `sendChatMessage()` — posts to `/api/chat` with workflow run ID from localStorage without hardcoding a shift ID, allowing server-side dynamic shift resolution from the nurse's active unit.
- `triggerChaos(action)` — `crash` or `recover` via `/api/chaos/simulate`.
- `switchProvider()` — calls `/api/provider/switch`.
- Retry keys are stored in a `Map<string, string>` and cleared on success. On failure, the same key is reused for safe retry.

### `voice-api.ts`
Voice session calls: `readVoiceDisplay()` (GET `/api/voice/display`), `sendVoiceTurn()` (POST `/api/voice/turn`). Saves the last uncertain request locally for "retry last request" support.

### `voice-types.ts`
`VoiceDisplay` and `VoiceTask` interfaces — the full state shape returned by `GET /api/voice/display`.

### `types.ts`
Frontend type definitions: `ClinicalTask`, `ConflictItem`, `AuditLogItem`, `HandoffItem`, `ProviderHealth`, `ChatMessage`.

### `useVoiceConversation.ts`
React hook wrapping Web Speech API (`SpeechRecognition` + `speechSynthesis`). Handles: recognition start/stop, synthesis playback, microphone suspension during responses, error handling, listening restart.

### Components

**`VoiceWorkspace.tsx`** — Main page component. Two tabs:
1. `Clinical Shift Workspace`: shows nurse identity, current speech, task cards, conflict cards, handoff cards, pending confirmation drawer, quick-action prompt chips (10-step demo walkthrough), and direct action buttons on cards.
2. `Observable MCP Telemetry & Chaos Recovery`: shows `ExecutionTracePanel` and `ChaosControlBar`.
Separated background polling: clinical display polls at 2.5s (guarded by `!busyRef.current` to prevent re-render jitter during active voice turns), while execution trace telemetry polls at 5.0s. Integrates `useVoiceConversation` for browser speech.

**`AlexaVoiceSim.tsx`** — Legacy chat bubble component (chat + voice). Shows message history, sample prompts, microphone toggle. Used by the older `/api/chat` orchestrator path.

**`ExecutionTracePanel.tsx`** — Lists audit log entries from `/api/execution-trace`. Shows actor, action, outcome, latency, timestamp.

**`ChaosControlBar.tsx`** — Two buttons: "Simulate Wi-Fi Drop / Crash" and "Resume Saved Workflow". Calls `triggerChaos('crash')` and `triggerChaos('recover')` respectively.

**`ConflictReviewDrawer.tsx`** — Drawer for resolving a discrepancy. Requires a note and a final status selection before enabling confirm.

**`TaskBoard.tsx`** — Legacy kanban board showing tasks by status column.

**`ShiftHeader.tsx`** — Legacy header showing shift info and provider health.

---

## Scripts (`scripts/`)

**`run-tests.ts`** — Test runner. Creates a temp directory with a fresh `test.db`, sets `PORT=0`, `LLM_PROVIDER=mock`, spawns `verify-workflows.ts` as a child process. Cleans up the temp DB on exit. Never touches `data/shiftweave.db`.

**`verify-workflows.ts`** — Main test suite (73 checks). Covers: MCP protocol handshake, all 9 core tools, idempotency/retry deduplication, conflict resolution, custody acceptance, handoff finalization, source reconciliation, Bedrock/Gemini message format conversion, process-exit recovery (kills worker, starts fresh orchestrator, verifies checkpoint restoration). Also runs 23 voice checks.

**`verify-voice.ts`** — Voice-specific test suite (23 checks): identity selection, ambiguity, scoped records, retries, confirmation lifecycle, state changes, custody, sign-off, session clearing.

**`test-epic-oauth.ts`** — 5 checks: JWT signing, token exchange against live Epic sandbox, first authorized read (Camila Lopez).

**`test-epic-reads.ts`** — 8 checks: Patient, Encounter, Condition, Allergy, MedicationRequest, DocumentReference mapping via `EpicMappingService`.

**`test-handoff-integration.ts`** — 9 checks: `FieldAuthorityService` boundaries, integrated SBAR narrative generation with Epic context.

**`test-integration-recovery.ts`** — 7 checks: token refresh on 401, permission denial handling, timeout with AbortSignal, idempotent ingestion deduplication, chaos interruption recovery with checkpoint reconciliation.

**`test-browser-journey.ts`** — 12 checks: full Seema→draft→Reema→accept→finalize journey via HTTP, including 409 stale revision, clinical boundary refusal, idempotent turn replay.

**`test-writeback.ts`** — 8 checks: `EpicWriteBackService` payload construction, safety gate enforcement, sync state machine, remote reconciliation.

**`restart-worker.ts`** — Used in process-exit recovery test. Spawns an orchestrator worker, kills it mid-run, starts a fresh one to verify checkpoint-based recovery.

**`test-agent.ts`, `test-chaos-recovery.ts`, `test-mcp-client.ts`, `test-providers.ts`, `test-recovery.ts`** — Legacy single-line stubs that delegate to `run-tests.ts`.

---

## Data (`data/`)

**`shiftweave.db`** — Live SQLite database. WAL mode (`.db-wal`, `.db-shm` files normal). Contains synthetic fixture: 2 nurses (Seema, Reema), 1 shift, 2 patients, 2 tasks, task assignments, and 1 seeded `STATUS_MISMATCH` conflict (Vancomycin order discrepancy in Room 305).

**`incoming/`** — Drop zone for JSON fixture files.
- `sample_template.json` — Template showing the expected JSON shape for importing nurses, shifts, patients, tasks, assignments, and conflicts.
- `README.md` — Brief instructions for the data import format.

---

## Configuration Files

**`package.json`** — Node.js ESM project. Key scripts:
- `dev` — `tsx watch src/server.ts` (hot reload)
- `db:init` — Initialize tables
- `import:data` — Ingest JSON fixtures
- `test` / `test:mcp` / `test:agent` / `test:chaos` — Run isolated test suite
- `typecheck` — `tsc --noEmit`
- `build:client` — Vite build
- `test:epic*`, `test:handoff`, `test:recovery`, `test:browser`, `test:writeback` — Integration test scripts

Key deps: `@modelcontextprotocol/sdk ^1.32.1`, `better-sqlite3 ^13.0.3`, `express ^5.3.0`, `zod ^4.6.7`, `@aws-sdk/client-bedrock-runtime ^3.x`, `@google/generative-ai ^0.24.1`.

**`tsconfig.json`** — TypeScript config. ESM (`"module": "NodeNext"`), `strict: true`, target ES2022.

**`.env` / `.env.example`** — Environment config. Key vars:
- `PORT=3000`
- `LLM_PROVIDER=mock` (or `gemini` / `bedrock`)
- `SQLITE_DB_PATH=./data/shiftweave.db`
- `INCOMING_DATA_DIR=./data/incoming`
- `GEMINI_API_KEY` / `GEMINI_MODEL`
- `AWS_REGION` / `BEDROCK_MODEL_ID`
- `EPIC_CLIENT_ID` / `EPIC_PRIVATE_KEY_PATH`

**`client/package.json`** — React + TypeScript client. Uses Vite, React 18, lucide-react icons.

**`client/vite.config.ts`** — Vite config with proxy rules for `/api`, `/health`, `/mcp` → `localhost:3000`.

**`.gitignore`** — Ignores `node_modules`, `dist`, `data/*.db*`, `.env`, `keys/`.

---

## Documentation Files

**`README.md`** — Quick start guide, feature summary, demo walkthrough, test/verify commands, optional model setup, and scope/limitations.

**`review.md`** — Pre-demo production review covering latency optimizations, UI polling separation, session map TTL, error handling ergonomics, execution trace sizing, dynamic shift resolution, and startup receipt hygiene.

**`AGENTS.md`** — Mandatory rules for AI coding agents: MCP spec compliance, multi-turn state requirement, idempotency/checkpointing, clinical safety boundary, free-local default, no silent fallbacks.

**`important.md`** — Hackathon track requirements, judging criteria (idea quality, technical, design, impact), bonus friction log rule.

**`goal.md`** — Architecture boundary explanation (Alexa+ is the client, ShiftWeave is the MCP server), winning strategy analysis, judging criterion breakdown, demo narrative, Epic FHIR integration roadmap with ordered milestones.

**`plan.md`** — Phase-by-phase implementation plan (Phase 0–8), timeline matrix, Epic registration milestone record.

**`IMPLEMENTATION_STATUS.md`** — Ground truth document. What is actually verified to work, what the runtime contracts are, and what remains unimplemented (live Epic write-back, production auth, browser audio, arbitrary distributed failure recovery).

**`remaining.md`** — Post-voice-workspace handover document. Lists completed work per area with file references, verification evidence (73 checks passed), and remaining work in priority order.

**`memory.md`** — Running project memory log. Records each major implementation event with verification results and next steps.

**`architecture.md`** — System architecture spec with layered diagram: Client → Agent → MCP → Domain Engine → SQLite → EHR Integration.

**`mcp.md`** — Deep dive on MCP protocol usage, Streamable HTTP session lifecycle, tool schema design, and UI execution trace architecture.

**`schema.md`** / **`plain_schema.md`** / **`field_schema.md`** — Database schema documentation at varying levels of detail.

**`incomingapikey.md`** — Authoritative guide for Epic FHIR R4 API selection. Written in Hindi/English. Clarifies Incoming vs Outgoing API direction, lists all relevant R4 endpoints for nursing (Patient, Encounter, Condition, AllergyIntolerance, MedicationRequest, DocumentReference, etc.) with per-API caveats. Supersedes `apicall.md` and `callapi.md`.

**`apicall.md`** / **`callapi.md`** — Older Epic API reference docs. Superseded by `incomingapikey.md`.

**`FRICTION_LOG.md`** — Developer experience log documenting real friction encountered: MCP multi-session transport lifecycle, SSE parsing edge cases, Express 5 router changes, Bedrock tool-use ID preservation, SQLite WAL concurrency. Submitted for the 10% bonus.

**`how_it_works.md`** — End-to-end flow walkthrough from nurse utterance to MCP tool execution to response.

---

## `.agents/` (Agent Skill)

**`.agents/skills/hackathon-guidelines/SKILL.md`** — Loaded by AI coding agents at task start. References `important.md`, mandates reading `incomingapikey.md` for Epic API selection, and enforces checks at each implementation step (transport, durable state, idempotency, clinical boundaries, free local default, honest outcomes).

**`.agents/skills/hackathon-guidelines/references/`** — Project context references for agent use.

---

## Key Design Decisions

**Server-per-session MCP factory**: `createShiftWeaveServer()` is called per HTTP request rather than once. This avoids the `McpServer` "already connected" error when multiple browser tabs or test clients connect simultaneously.

**MutationService as the single write path**: Every state-changing operation goes through `MutationService.execute()`. This guarantees: idempotency check, atomic commit, receipt storage, checkpoint, audit log — all in one SQLite `IMMEDIATE` transaction.

**Revision-based voice state**: `VoiceDisplay` has a `revision` counter. Voice turn requests must send `expected_revision`; mismatches return 409. This prevents two concurrent tabs from diverging state silently.

**Clinical boundary is hard-coded, not configurable**: `MockAutonomousAgent` and the safety string in `llm-provider.ts` both refuse diagnosis, treatment, medication administration, and autonomous conflict resolution. Conflicts require human review with an explicit note and final status.

**External write-back is gated**: `EpicWriteBackService` cannot be triggered unless: `human_confirmed: true`, zero unresolved conflicts, custody accepted. Even then, it is blocked in the sandbox by Epic's read-only permissions for non-production clients.

**Tests never touch the real DB**: `run-tests.ts` creates a temp directory with a fresh `test.db` and sets `SQLITE_DB_PATH` for the child process. Test cleanup is automatic.

**Direct in-process voice dispatch**: `POST /api/voice` executes `VoiceService.turn()` directly without self-connecting through local HTTP MCP handshakes, cutting 80–150ms of latency per utterance while keeping the external `voice_turn` MCP tool available over `/mcp`.

**Dynamic shift scoping over static assumptions**: Both chat and voice workflows resolve the active shift dynamically from the nurse's assigned unit rather than relying on hardcoded shift IDs.

**Durable receipt pruning**: `operation_receipts` older than 3 days are purged on server startup to maintain long-term query performance and prevent unbounded storage growth.
