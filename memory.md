# ShiftWeave — Maintained Project Memory

Updated 20 October 2026.

## Voice workspace update — 20 October 2026

The user requested a voice-operated nurse workflow: introduce the nurse by name, speak grounded answers, and automatically display matching details. The demo has no login page; name selection is demo context, not authentication. The browser still requires an initial microphone permission/start action.

Implemented `VoiceService` with scoped tasks, incoming candidates, discrepancy explanation, named-recipient drafts, spoken review/acceptance/finalization, cancellation, identity clearing, and session end. Voice turns have durable checkpoints, atomic mutation receipts, revision checks, and exact-request retries. Confirmation expires after five minutes or changes to the scoped records.

Added MCP tools `voice_turn` and `get_voice_display` (11 tools total) and the browser companion voice endpoints. The browser uses MCP for voice turns. Cloud-model tool lists exclude these confirmation entry points. The new mounted `VoiceWorkspace` replaces the former interactive dashboard; legacy components remain in the repository.

Added a browser recognition/synthesis hook, display polling, microphone state/errors, text fallback, and persisted uncertain-request retry handling. This is an English deterministic voice demo, not verified general NLP, Hindi/Hinglish support, or an actual Alexa+ integration.

Verification: root typecheck passed; 73 isolated checks passed, including 23 new voice checks. The first frontend build exposed a missing default App export; the export was fixed and a build recheck started. Browser/audio verification and the actual Alexa+/Epic integrations remain outstanding.

See [remaining.md](remaining.md) for the detailed completed-work inventory, current verification results, and ordered next steps. The voice changes are local on `feature/debug` and have not been committed/pushed with the earlier `cf49dea` baseline.

## Mandatory context

Read `AGENTS.md`, `important.md`, and `.agents/skills/hackathon-guidelines/SKILL.md` for every repository task. The skill's `references/project-context.md` maps architecture, schema, API documents and historical contradictions.

Preserve MCP minimum `2025-11-25` over Streamable HTTP at `/mcp`, multi-turn durable state, idempotent checkpointed mutations, actual traces, explicit discrepancy review, clinical boundaries and the free local default. Bedrock remains optional.

## Current implementation

Read [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) before making completion claims.

The default is a synthetic-data SQLite demo. Conversations and pending tool intent survive fresh orchestrators/processes. Local mutation receipts prevent duplicate retries and detect changed request payloads. Source changes trigger read reconciliation. Human conflict resolution, custody acceptance and local finalization are separate.

Gemini/Bedrock adapters use native function/tool messages and explicit errors. Nurse-facing summaries and drafts use recorded facts. Live model calls are unverified.

Epic operational mapping, authentication and external note publishing are not configured. `incomingapikey.md` corrects older API assumptions. Local success must never be labelled Epic sync.

## Verification

`npm run typecheck`, `npm test`, `npm run build:client`. Tests create their own database and include real process-exit recovery after a committed draft response is lost. Never run mutation tests against the shared demo database.

No production nurse authentication exists. Keep the demonstration on loopback and use synthetic records. A demo nurse ID is context, not proof of identity.

## Scope

Architecture documents include future worksheet and multi-provider proposals. They do not automatically authorize building those features in every task. Historical checked boxes and promotional claims are not verification evidence.

## Change record — 20 October 2026

### Repository rules and API guidance

- Updated `AGENTS.md` and the repository-local `hackathon-guidelines` skill to require current rules, relevant architecture/schema context, explicit failures, factual verification claims and clinical boundaries throughout project work.
- Added `.agents/skills/hackathon-guidelines/references/project-context.md` as a document map and architecture reference. Its initial investigation notes are historical; consult current code and `IMPLEMENTATION_STATUS.md` for corrected behavior.
- Created `incomingapikey.md` with core/optional Epic Incoming API guidance. Incoming means this app calls Epic, including permitted writes. The supplied Outgoing APIs are not required for the current flow.
- Corrected assumptions about generic bedside Task updates, Binary retrieval, and encounter/location mapping. API catalog availability does not establish authorized or tested integration.

### Database, mutations and recovery

- Retained the original 11 domain tables and added `operation_receipts` for operation identity, canonical request JSON and saved response JSON.
- Added `canonical-json.ts`, `mutation.service.ts` and `source-version.ts`. Local domain changes, mutation workflow/checkpoint records, receipts and audit records commit atomically. Reusing a key with a different operation or payload fails explicitly.
- Strengthened checkpoint validation and ordering. Recovery reads actual saved state and committed receipts; missing checkpoints return an unrecoverable result.
- Persisted conversation history, request identity, pending tool intent, results, context, source version and final response. Completed chat retries return the original saved result.
- Reconcile changed local source records before continuing interrupted reads. Fresh processes can resume after a draft commits but its tool response is lost, without inserting another draft.

### Handoffs and human review

- Added `handoff.service.ts` for factual draft generation, explicit custody acceptance and local finalization.
- Drafts snapshot assigned unfinished work and do not transfer responsibility. Draft narrative is rendered from database records.
- Escalation records a note without changing task completion status. Conflict resolution requires an explicit human decision, final status and review note.
- Custody acceptance requires the matching incoming nurse/handoff, current outgoing assignment and no unresolved conflict. It transfers assignment custody without claiming task completion.
- Finalization requires human confirmation, accepted custody and discrepancy review. It is a local sign-off, with no external publishing.

### Agent and MCP

- Reworked the orchestrator around durable checkpoints and stable tool retry keys; added demo nurse ownership checks and an in-process busy-run guard.
- Restricted agent execution to scoped reads and draft creation. Human mutation tools cannot be autonomously executed by the model.
- Replaced hardcoded mock patient responses with deterministic summaries from actual tool results, including contextual follow-ups.
- Gemini uses native function-call/function-response messages; Bedrock preserves matching tool-use/result IDs and uses the SDK credential chain. Missing configuration and provider failures are explicit.
- Nurse-facing final content is grounded through deterministic rendering; unconstrained cloud prose is not displayed as clinical guidance.
- MCP bridge validates negotiated protocol `2025-11-25`, parses result events, applies timeouts and closes sessions. Server retains stateful Streamable HTTP on `/mcp`; removed the uninitialized stateless fallback.

### Server and providers

- Corrected dashboard SQL to use assignment transfer state, nurse full names and handoff snapshots; carried-forward assignments remain visible.
- Mapped audit fields into the frontend contract and added validated chat, conversation restoration, human acknowledgement and handoff finalization endpoints.
- Added explicit JSON errors, local-origin CORS and loopback binding. A demo nurse identifier is still not authenticated identity.
- Chaos controls now reference actual runs/checkpoints and report actual recovery results. The UI injects an exception; a separate test exercises real worker-process termination.
- Removed fake live-FHIR behavior and arbitrary public patient fetching. Optional FHIR metadata transport reports failures, while operational provider selection is explicitly unavailable until mappings are implemented.
- Unknown local units no longer fall back to returning all patients.

### Ingestion

- Incoming JSON requires validated identifiers/statuses and explicit conflict provenance; the importer does not invent disagreements from a flagged status.
- Identical file content is deduplicated through a content hash and durable receipt/checkpoint.
- The synthetic fixture contains two patients and two tasks. Changed imports can update local state and require review before use; CSV ingestion is not implemented.

### Frontend

- Switched to same-origin API calls with Vite proxies, request timeouts and visible failure messages.
- Persisted workflow IDs and retry keys; restore server conversation history after refresh and provide a new-conversation action.
- Added draft review, explicit custody acceptance and local sign-off controls. Conflict review requires a typed note.
- Fixed voice recognition stop/abort cleanup, provider display, audit/recovery types and missing spacing/disabled/loading styles.
- Removed misleading live-sync, fixed-latency and guaranteed-recovery claims. Labels identify the synthetic local demonstration.

### Documentation and configuration

- Updated README, `baaki.md`, incoming-data instructions and environment examples to match local execution and pending integrations.
- Added `IMPLEMENTATION_STATUS.md` as the current behavior/limitations record.
- Added status notices to older architecture, schema, API, workflow and planning documents; their aspirational text is not evidence of implemented features.
- Documented operation receipts in `field_schema.md`, ignored SQLite sidecars and retained strict TypeScript checking.

## Last implementation verification

These results were obtained during the preceding implementation task; this memory-only update does not rerun them.

- Root TypeScript check: passed with `tsc --noEmit --pretty false`.
- `npm test`: passed all 50 isolated assertions.
- `npm run build:client`: passed.
- `git diff --check`: no whitespace errors; line-ending warnings were present.

The test runner creates and cleans its own temporary database. Legacy test entrypoints now use this isolated runner. Coverage includes protocol/discovery, dashboard contracts, identical/changed retries, persisted history, owner checks, stale-source reconciliation, human conflict/custody transitions, adapter message formats and explicit configuration errors. A child worker exits after committing a draft and before saving its result checkpoint; a fresh worker resumes and verifies exactly one draft.

The shared demo database was not used for mutating verification. No live Epic writes or cloud-provider calls were verified. Browser visual behavior and microphone operation still need manual verification.

## Pending work and practical limits

- Authorized Epic OAuth/environment setup, patient/encounter/roster/task mapping and tested resource permissions.
- Human-reviewed external note publishing with explicit sync states and remote reconciliation before retrying.
- Production nurse authentication and authorization before using real clinical records.
- Live Gemini/Bedrock verification with authorized credentials.
- Browser/microphone checks and submission demo/assets.
- Recovery tests cover selected local failure cases, not every distributed failure. The busy-run guard is process-local; no distributed lock or universal zero-loss guarantee exists.
- Completed workflow replay returns its saved historical result. Audit traces are polled, not pushed.

## Git handoff

At this update, the working branch is `feature/api`. The earlier Incoming API guide was pushed as commit `ad7fd85`. The subsequent rules/skill updates and implementation fixes remain local and uncommitted; this memory update is also local.

Untracked `install.sh` and `install.sh~` predate these fixes and were not modified. Keep them out of any fixes commit unless explicitly requested. Recheck Git status before committing or pushing, and do not treat this dated snapshot as current remote state.

### Epic Backend Registration update — 20 October 2026

- Completed Step 1 of the integration roadmap (Epic Backend Application Registration).
- Configured settings: Application Audience: Backend Systems (Backend), Use Case: General, SMART on FHIR Version: R4, SMART Scope Version: SMART v2 configured, FHIR ID Generation Scheme: Use Unconstrained FHIR IDs.
- Published and verified live public JWKS endpoint on GitHub Pages: `https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json`.
- Non-Production Client ID issued by Epic: `ccc8c11f-4af0-4caf-b981-848012aab1a2`.
- Private key retained locally at `./keys/private_key.pem` with matching RS384 public key.
- Next pending integration step is Step 2 (OAuth 2.0 Client Assertion JWT signing & token exchange).

