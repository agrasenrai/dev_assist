# ShiftWeave Context and Document Map

Paths below are relative to the repository root. Reviewed on 20 October 2026; re-check current code before relying on implementation observations.

## Architecture

ShiftWeave helps Seema hand off nursing work to Reema, inspect unfinished tasks/conflicting records, explicitly accept custody, and recover interrupted workflows. Alexa+ is simulated through browser speech/chat unless a genuine integration is separately verified.

| Location | Responsibility |
| --- | --- |
| `client/src/` | React/Vite dashboard, task board, conflict review, voice simulation, traces and chaos controls. |
| `src/server.ts` | Express companion APIs and session-isolated MCP server/transport on `/mcp`. |
| `src/agent/` | Orchestrator, MCP HTTP bridge and mock/Gemini/Bedrock adapters. |
| `src/providers/` | `IEHRProvider`, SQLite/FHIR adapters and runtime provider selection. |
| `src/services/` | Checkpoints, recovery, conflicts and audit logging. |
| `src/db/` | Executable schema, connection, initialization and ingestion. |
| `scripts/` | MCP, agent, provider and recovery verification; inspect database mutations before running. |

Flow: dashboard chat -> Express -> orchestrator -> MCP discovery/tool calls -> services/provider -> SQLite -> returned speech/card and actual audit trace. External EHR access belongs behind provider adapters. Local storage owns workflow state; specify the authority for imported clinical fields.

Existing tools: `get_assigned_tasks`, `get_task_details`, `get_task_changes`, `get_handoff_context`, `create_handoff_draft`, `get_workflow_checkpoint`, `save_workflow_checkpoint`, `resume_workflow`, `acknowledge_task`. Read actual input/output contracts before changing callers.

## Schema invariants

The 11 entities are `patients`, `nurses`, `shifts`, `tasks`, `task_assignments`, `task_events`, `conflicts`, `handoffs`, `workflow_runs`, `workflow_checkpoints`, `audit_log`.

- Compare intended contracts with `src/db/schema.ts` and active database DDL; docs are not executable migrations.
- Assignment/transfer state lives in `task_assignments`, not `tasks`. Current DDL uses `nurses.full_name` and `handoffs.data_snapshot`.
- Task states: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `FLAGGED_CONFLICT`.
- Transfer states: `ACTIVE`, `CARRIED_FORWARD`, `TRANSFERRED`, `UNASSIGNED`.
- Intended handoff lifecycle: `DRAFT` -> `UNDER_REVIEW` -> `ACKNOWLEDGED` -> `FINALIZED`, with explicit review/acceptance.
- Workflow states: `INITIATED`, `IN_PROGRESS`, `INTERRUPTED`, `COMPLETED`, `FAILED`. Persist transitions rather than only displaying status.
- Stable workflow IDs, deduplication keys, saved source versions and current-state checks support recovery.
- Map database snake_case explicitly to frontend camelCase, including telemetry. Preserve units, timestamps and provenance.

## Document routing

| Document | Purpose / when to consult |
| --- | --- |
| `AGENTS.md` | Mandatory rules and skill loading; every task. |
| `important.md` | Track requirements, simulated-option distinction, judging and conditional bonus; every task. |
| `architecture.md` | Intended layers, provider separation and recovery design; backend/architecture work. |
| `schema.md` | DDL design, models and tool contracts; persistence/MCP work. |
| `field_schema.md` | Canonical field inventory; queries, mappings and ingestion. |
| `plain_schema.md` | Entity relationships, ownership and lifecycle semantics; transition changes. |
| `mcp.md` | Discovery/calls, transport and UI contract design; protocol/trace work. |
| `how_it_works.md` | Intended user journey and UI/data flow; product/UI work. |
| `goal.md` | Alexa/server boundary, demo narrative and appended Epic worksheet proposals; scope decisions. |
| `incomingapikey.md` | API-selection guidance and corrections to older assumptions; Epic integration work. |
| `apicall.md` | Broad original API map and explicit failure policy; apply later corrections. |
| `callapi.md` | Earlier lean API proposal and failure policy; generic Task/room/Binary assumptions need correction. |
| `plan.md` | Historical roadmap; checked boxes require implementation evidence. |
| `memory.md` | Historical decisions/progress; not proof of working capabilities. |
| `baaki.md` | Earlier gap analysis; re-check observations and completion claims. |
| `README.md` | Setup and judging/demo guide; verify commands and advertised behavior. |
| `FRICTION_LOG.md` | Developer friction; evidence must be factual and bonus conditional. |
| `data/incoming/README.md` | Ingestion instructions; verify actual format support in importer. |
| `.agents/skills/hackathon-guidelines/SKILL.md` | Operational guidance applying these documents. |

The original `ShiftWeave_Project_Document.docx` adds scope, source-of-truth, ownership and honest-demo boundaries. `important.md.docx` contains the supplied track reference. Consult when relevant.

## Contradictions and evidence

Mandatory safety/scope requirements remain requirements even when old code violates them. Separate intended design from implemented behavior. Verify external contracts against current official provider documentation.

- README, memory and plans advertise complete write-back/recovery and passing tests; the initial review found missing external writes, partial recovery and root TypeScript failures. Re-check rather than preserving either conclusion indefinitely.
- `incomingapikey.md` corrects “eight APIs suffice,” generic Community Resource Task updates, dismissal of Binary retrieval, and assuming Patient supplies room/bed/admission context.
- The appended worksheet/multi-platform proposal in `goal.md` is context, not authorization to implement Epic/Oracle/UKG for every task. Namespace external IDs and use verified identifier crosswalks; display names or an unqualified MRN alone do not prove cross-system identity.
- Earlier prose calls traces streaming; the reviewed client polls audit records. Describe the actual mechanism.
- Ingestion README advertises CSV; the reviewed importer reads JSON. Verify before promising formats.
- Guardrail prompts are not enforced authorization/state validation. Discovery alone does not prove provider interoperability.

## Implementation investigation pointers

The initial review found invalid dashboard SQL columns, audit field-name mismatches, per-request conversation loss, hardcoded mock output, dashboard crash-before-checkpoint behavior, incomplete mutation deduplication/recovery, and Bedrock dropping tool results. Re-check when touching these areas; this list does not authorize unrelated fixes.

Cross-session context requires persistent storage. Recovery must use an actual checkpoint/current state, stop on unrecoverable state, execute remaining work and persist completion. Fixed recovery badges or canned success text do not verify those properties.
