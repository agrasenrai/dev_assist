# ShiftWeave — Project Memory & Progress Log

> **Project**: ShiftWeave — AI-Powered Nursing Shift Handoff & Workflow Recovery  
> **Track**: Amazon Developer Hackathon — Alexa+ Track  
> **Transport**: Streamable HTTP (`StreamableHTTPServerTransport`)  
> **Protocol**: Model Context Protocol (MCP) `2025-11-25`  
> **Persistence**: SQLite (WAL Mode, Local-first)  
> **Status**: Phase 0 (Setup & Tooling) in Progress

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

---

## 3. Implementation Progress Tracker

- [x] **Foundation Phase**: Guidelines, Schemas, Architecture, Protocol Specs, and Plans.
- [x] **Phase 0: Setup & Dependencies**: Installed `better-sqlite3`, `dotenv`, `@types/better-sqlite3`, configured scripts in `package.json`, `.env.example`, `.env`. *(DONE)*
- [x] **Phase 1: Database & Ingestion Pipeline**:
  - [x] `src/db/connection.ts` (SQLite + WAL mode + Foreign Keys).
  - [x] `src/db/schema.ts` & `src/db/init.ts` (All 11 canonical tables initialized & verified).
  - [x] `data/incoming/` drop-in directory + template JSON created.
  - [x] `src/db/ingest.ts` (Flexible ingestion pipeline with automated conflict detector).
- [ ] **Phase 2: Swappable Provider Abstraction**: `IEHRProvider`, `MockEHRProvider`, `AlternateHospitalMock`.
- [ ] **Phase 3: Core Workflow & Recovery Engine**: Checkpoints, idempotency, state reconciliation.
- [ ] **Phase 4: MCP Server (9 Tools)**: Streamable HTTP transport, Zod schemas, automated test script.
- [ ] **Phase 5: Agent & Conversational Layer**: Bedrock / Gemini tool-calling orchestrator.
- [ ] **Phase 6: Clinical Shift Dashboard**: React + Vite UI, task board, conflict drawer, live MCP trace panel.
- [ ] **Phase 7: Chaos Interruption & Recovery Verification**: End-to-end testing with network disconnect simulation.
- [ ] **Phase 8: Submission & Friction Log**: `FRICTION_LOG.md` (10% bonus points capture), video demo script.
