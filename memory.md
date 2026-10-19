# ShiftWeave — Project Memory & Progress Log

> **Project**: ShiftWeave — AI-Powered Nursing Shift Handoff & Workflow Recovery  
> **Track**: Amazon Developer Hackathon — Alexa+ Track  
> **Transport**: Streamable HTTP (`StreamableHTTPServerTransport`)  
> **Protocol**: Model Context Protocol (MCP) `2025-11-25`  
> **Persistence**: SQLite (WAL Mode, Local-first)  
> **Status**: Phase 8 (Submission Packaging, Friction Log & Demo) in Progress

---

## 1. Context & Key Decisions So Far

### Architectural & Project Decisions
1. **Zero-Cost & Local Execution ($0.00)**:
   * 100% free, local-first stack. No mandatory paid cloud services, no Docker overhead.
   * SQLite embedded database with WAL mode for microsecond latency.
   * Node.js + Express with `@modelcontextprotocol/sdk` over Streamable HTTP (`POST /mcp`).
   * Pluggable LLM: Gemini Free API / Local Mock by default; AWS Bedrock Converse API toggle for the hackathon mini-challenge.
2. **Clinical Safety Boundary**:
   * Pure nursing workflow coordination, task visibility, and handoff synthesis.
   * **Strictly NO autonomous clinical diagnosis or medication/treatment changes.**
   * Discrepancies between EHR and nurse notes are flagged into `conflicts` and require human verification.
3. **Resilience & Interruption Recovery**:
   * Uses `workflow_runs`, `workflow_checkpoints`, and UUIDv4 `idempotency_key`s.
   * Interrupted workflows query state prior to retrying, ensuring committed actions are **never duplicated**.
4. **Data Strategy (Teammate Data Ready)**:
   * Will not hand-craft synthetic datasets.
   * A flexible Ingestion & Mapping Pipeline (`src/db/ingest.ts`) ingests clinical data from `./data/incoming/` once provided by teammate.
5. **Rules & Compliance Enforced**:
   * Built workspace rule [`AGENTS.md`](file:///C:/Users/siddh/Desktop/dev_assist/AGENTS.md) and skill [`.agents/skills/hackathon-guidelines/SKILL.md`](file:///C:/Users/siddh/Desktop/dev_assist/.agents/skills/hackathon-guidelines/SKILL.md) to guarantee compliance with `important.md` on every step.
6. **Hybrid Edge-Cache Model (Local SQLite + External FHIR API)**:
   * Local SQLite operates as the high-speed edge cache (~0.1ms latency) for nurse station tablets.
   * `IEHRProvider` connects to external open-source / Epic on FHIR endpoints to pull patient rosters and medication orders.
   * Guarantees 100% availability during hospital Wi-Fi drops and zero cloud latency during critical handoffs.

---

## 2. Master Specification Documents Created

| Document | Purpose |
| :--- | :--- |
| [`important.md`](file:///C:/Users/siddh/Desktop/dev_assist/important.md) | Official Hackathon rules, Streamable HTTP mandate, judging criteria, and friction log guidelines. |
| [`field_schema.md`](file:///C:/Users/siddh/Desktop/dev_assist/field_schema.md) | Pure canonical list of all 11 database entities and field names. |
| [`schema.md`](file:///C:/Users/siddh/Desktop/dev_assist/schema.md) | Full technical schema with SQLite DDL, TypeScript models, and Zod validator schemas for all 9 tools. |
| [`plain_schema.md`](file:///C:/Users/siddh/Desktop/dev_assist/plain_schema.md) | Conceptual database blueprint with Big Format ER diagrams and field tables. |
| [`architecture.md`](file:///C:/Users/siddh/Desktop/dev_assist/architecture.md) | Comprehensive system architecture with side-by-side free & fast alternatives. |
| [`plan.md`](file:///C:/Users/siddh/Desktop/dev_assist/plan.md) | 8-phase actionable implementation roadmap with external data ingestion. |
| [`mcp.md`](file:///C:/Users/siddh/Desktop/dev_assist/mcp.md) | Protocol deep dive (Streamable HTTP, JSON-RPC 2.0, 9 tools) and React Dashboard UI integration guide. |
| [`how_it_works.md`](file:///C:/Users/siddh/Desktop/dev_assist/how_it_works.md) | End-to-end data flow, Epic comparison, user journey, and visual UI screens walkthrough. |
| [`goal.md`](file:///C:/Users/siddh/Desktop/dev_assist/goal.md) | Architectural separation (Alexa+ vs MCP Server), judge scorecard analysis, and winning demo strategy. |

---

## 3. Implementation Progress Tracker

- [x] **Foundation Phase**: Guidelines, Schemas, Architecture, Protocol Specs, and Plans.
- [x] **Phase 0: Setup & Dependencies**: Installed `better-sqlite3`, `dotenv`, `@types/better-sqlite3`, configured scripts in `package.json`, `.env.example`, `.env`. *(DONE)*
- [x] **Phase 1: Database & Ingestion Pipeline**:
  - [x] `src/db/connection.ts` (SQLite + WAL mode + Foreign Keys).
  - [x] `src/db/schema.ts` & `src/db/init.ts` (All 11 canonical tables initialized & verified).
  - [x] `data/incoming/` drop-in directory + template JSON created.
  - [x] `src/db/ingest.ts` (Flexible ingestion pipeline with automated conflict detector).
- [x] **Phase 2: Hybrid Provider Architecture**:
  - [x] `src/providers/types.ts` (`IEHRProvider` interface and canonical data models).
  - [x] `src/providers/sqlite-cache-provider.ts` (Microsecond SQLite edge cache).
  - [x] `src/providers/fhir-api-provider.ts` (Live FHIR R4 open-source / Epic REST API adapter).
  - [x] `src/providers/index.ts` (Dynamic runtime provider manager & switcher).
  - [x] Verified via `scripts/test-providers.ts` (100% pass).
- [x] **Phase 3: Core Workflow & Recovery Engine**:
  - [x] `src/services/audit.service.ts` (Structured audit logger with latency & telemetry).
  - [x] `src/services/checkpoint.service.ts` (Atomic checkpointing with idempotency deduplication).
  - [x] `src/services/conflict.service.ts` (Discrepancy detection & human resolution flow).
  - [x] `src/services/recovery.service.ts` (State reconciliation, skipping committed actions).
  - [x] Verified via `scripts/test-recovery.ts` (100% pass).
- [x] **Phase 4: MCP Server (9 Tools over Streamable HTTP)**:
  - [x] `src/server.ts` with official `StreamableHTTPServerTransport` (`POST /mcp`, `GET /mcp`, `DELETE /mcp`).
  - [x] Registered all 9 canonical tools with Zod schema validation & audit logging.
  - [x] Companion endpoints: `/health`, `/api/execution-trace`, `/api/conflicts`, `/api/provider/switch`.
  - [x] Verified via `scripts/test-mcp-client.ts` (`npm run test:mcp` passing 100%).
- [x] **Phase 5: Agent & Conversational Layer**:
  - [x] `src/agent/mcp-client-bridge.ts` (Streamable HTTP JSON-RPC 2.0 client bridge with runtime `tools/list` discovery).
  - [x] `src/agent/llm-provider.ts` (Pluggable adapters: MockAutonomousAgent $0 free runner, Google Gemini API, and AWS Bedrock Converse API for Mini Challenge).
  - [x] `src/agent/orchestrator.ts` (Multi-turn conversational loop, safety boundaries, and interruption recovery).
  - [x] Verified via `scripts/test-agent.ts` (`npm run test:agent` passing 100%).
- [x] **Phase 6: Clinical Shift Dashboard (React + TypeScript)**:
  - [x] Scaffolded React 18 + Vite + TypeScript in `client/`.
  - [x] `ShiftHeader.tsx` (ICU-B status, Seema ➔ Reema handoff identity, provider toggle, shift timer).
  - [x] `TaskBoard.tsx` (4-column Kanban: Pending, In Progress, Flagged Conflict, Completed with STAT indicators).
  - [x] `ConflictReviewDrawer.tsx` (Room 305-B Vancomycin EHR vs Notes discrepancy review with human nurse sign-off).
  - [x] `ExecutionTracePanel.tsx` (Live stream of MCP tools invoked over Streamable HTTP with latencies).
  - [x] `AlexaVoiceSim.tsx` (Simulated Alexa+ assistant with Web Speech API audio synthesis).
  - [x] `ChaosControlBar.tsx` (Interactive judge demo buttons: crash simulation, zero-loss recovery, provider switch).
  - [x] Production build compiled via Vite into `client/dist` and served directly by Express on `http://localhost:3000`.
- [x] **Phase 7: End-to-End Chaos Interruption & Recovery Verification**:
  - [x] Built comprehensive test script `scripts/test-chaos-recovery.ts`.
  - [x] Tested planned server crash after Checkpoint #1 commitment.
  - [x] Verified zero duplicate task repetition upon recovery (`avoidedDuplicateStepsCount = 1`).
  - [x] Verified bedside human conflict resolution and task status transition to `COMPLETED`.
  - [x] Verified `npm run test:chaos` passing 100% with full audit trail in SQLite.
- [ ] **Phase 8: Submission Packaging, Friction Log & Demo**:
  - [ ] `FRICTION_LOG.md` (Capturing the up to 10% bonus points on MCP TypeScript SDK & Streamable HTTP).
  - [ ] 3-Minute Video Demo Script & submission documentation.
