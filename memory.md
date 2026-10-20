# ShiftWeave — Maintained Project Memory

Updated 21 October 2026.

## UI Observability & Demo Walkthrough Update — 21 October 2026

- **Integrated Observable MCP Telemetry & Chaos Panel**: Integrated `ExecutionTracePanel` and `ChaosControlBar` into `VoiceWorkspace.tsx` via view-toggle tabs (`Clinical Shift Workspace` and `Observable MCP Telemetry & Chaos Recovery`). Satisfies the hackathon observability and resilience judging criteria with real-time audit logs, latencies, and checkpoint IDs.
- **1-Click Demo Walkthrough Prompt Chips**: Added 10 sequential prompt chips to `VoiceWorkspace.tsx` covering the complete clinical journey (`Hi, I am Seema`, `Explain room 305`, `Review discrepancies`, `Prepare my handoff for Reema`, `Hi, I am Reema`, `Accept all handoff tasks`, `Yes, confirm`, `Finalize handoff`, `Cancel`, `End my session`), enabling immediate evaluation without microphone hardware constraints.
- **Direct Spoken-Action Triggers**: Added responsive action buttons to confirmation drawers ("Speak Confirm", "Speak Cancel"), conflict cards ("Stage Verified Resolution"), and handoff cards ("Finalize Handoff", "Accept All Incoming Tasks").
- **Verification**:
  - `npm run build:client`: Passed cleanly with Vite + TypeScript in 4.16s.
  - `npm run typecheck`: Passed with 0 errors across entire workspace.
  - `npm test`: **All 73 isolated checks passed** (50 core workflow/transport + 23 voice checks).
  - Production Express server tested and healthy at `http://localhost:3000`.
- **Next Milestone**: Connect AWS Bedrock Converse API adapter (`@aws-sdk/client-bedrock-runtime`) for the hackathon mini challenge.

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
- `npm test`: passed all 73 isolated assertions (50 core workflow/transport + 23 voice checks).
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

At this update, the working branch is `feature/backend`. The earlier Incoming API guide was pushed as commit `ad7fd85`. The subsequent rules/skill updates and implementation fixes remain local and uncommitted; this memory update is also local.

Untracked `install.sh` and `install.sh~` predate these fixes and were not modified. Keep them out of any fixes commit unless explicitly requested. Recheck Git status before committing or pushing, and do not treat this dated snapshot as current remote state.

### Epic Backend Integration Update — Step 1 Verified & Step 2 Credential Resolution (21 October 2026)

- **Step 1 Completion Verified**:
  - `.env` configured with `EPIC_CLIENT_ID=ccc8c11f-4af0-4caf-b981-848012aab1a2`, `EPIC_JWKS_URL=https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json`, and sandbox endpoints.
  - Public JWKS endpoint verified live (HTTP 200) on GitHub Pages with matching kid (`691586d6-d0fe-4efc-800d-d5316d69128c`), alg (`RS384`), use (`sig`), and 2048-bit modulus `n`.
  - Application settings confirmed: Backend Systems (Backend), Use Case: General, SMART on FHIR Version: R4, SMART Scope Version: SMART v2, FHIR ID Scheme: Unconstrained FHIR IDs.
  - Git isolation confirmed: `.env`, `keys/`, and `*.pem` are verified in `git status --ignored` and excluded from version control.
- **Step 2 Credential Security Hardening**:
  - Identified hardcoded passphrase (`Agrasen@1`) in the key generation script and absence of passphrase configuration in `.env`.
  - Re-encrypted the private key with a cryptographically secure 256-bit random passphrase without altering the public JWKS parameters.
  - Stored re-encrypted private key at `./keys/private_key.pem` with restricted file permissions.
  - Configured `PRIVATE_KEY_PATH=./keys/private_key.pem` and `PRIVATE_KEY_PASSPHRASE` in local `.env`.
  - Added `PRIVATE_KEY_PASSPHRASE=` to `.env.example` for reproducible secure configuration.
  - Updated `generate-jwks.cjs` to require `process.env.PRIVATE_KEY_PASSPHRASE` instead of hardcoded secrets.
  - Verified local RS384 sign and verify cycle against the public key; passed.
### Epic Backend Integration Update — Step 2 (Backend OAuth & Authorized Read) COMPLETED (21 October 2026)

- **Step 2 Implementation Completed & Verified Live**:
  - Built `EpicOAuthService` (`src/providers/epic-oauth.service.ts`) implementing RFC 7523 OAuth 2.0 client credentials grant over RS384.
  - **Client Assertion JWT Signing**: Generates valid JWT assertions with RS384, key ID (`691586d6-d0fe-4efc-800d-d5316d69128c`), client ID issuer/subject, audience, and bounded 5-minute expiry.
  - **Live Token Exchange Verified**: Successfully exchanged assertion with Epic OAuth endpoint (`https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token`). Received valid Bearer access token with registered SMART v2 scopes (`system/Patient.r`, `system/Encounter.r`, `system/DocumentReference.r`, etc.).
  - **In-Memory Caching & Expiry Buffer**: Caches access tokens in-memory and reuses them sub-millisecond, automatically refreshing 60 seconds prior to expiration.
  - **First Authorized Sandbox Read Verified**: Executed authorized HTTP GET against Epic on FHIR R4 endpoint (`https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Patient/erXuFYUfucBZaryVksYEcMg3`). Successfully retrieved real test patient Camila Maria Lopez (Female, DOB 1987-09-12) with HTTP 200.
  - **Explicit Error Surfacing**: Verified that invalid credentials return explicit `invalid_client` failures without silent fallback or empty mock data.
  - **Automated Verification Suite**: Added `npm run test:epic` (`scripts/test-epic-oauth.ts`), passing all 5 test scenarios (JWT generation, live token exchange, cache hit, authorized read, explicit error surfacing).
  - **Security Invariants Preserved**: Private keys and passphrases remain strictly server-side and are completely excluded from source control (`.gitignore`).
- **Next Pending Milestone (Step 3 Implementation)**:
  - Step 3 (Epic Reads): Completed on 21 October 2026 (see below).

### Epic Backend Integration Update — Step 3 (Epic Reads) COMPLETED (21 October 2026)

- **Step 3 Implementation Completed & Verified Live**:
  - Built `EpicMappingService` (`src/providers/epic-mapping.service.ts`):
    - Normalized mappings for FHIR R4 Patient, Encounter, Condition (diagnoses / problem list), AllergyIntolerance, MedicationRequest, and DocumentReference.
    - Resolves room/bed from the active Encounter's `location[].location.display` (e.g. `EMC Family Medicine`, `EMH Main Operating Room`) with fallback to explicit missing state (`'Not Documented in FHIR'`).
    - Retains source IDs, timestamps (`authoredOn`, `recordedDate`), dosage units (`doseQuantity.unit`), and clinical status.
    - Implemented `resolveDocumentContent` supporting both inline base64 data and linked `/Binary/{id}` references.
    - Implemented `getPatientClinicalContext` aggregating core resources in parallel with per-resource isolation.
  - Updated `LiveFHIRProvider` (`src/providers/fhir-api-provider.ts`):
    - Replaced deliberate configuration errors with live sandbox implementations for `ping()`, `getPatientsByUnit()`, `getTasksForNurse()`, `getTaskDetails()`, and `getPatientClinicalContext()`.
    - Protected write-back safety boundary: `updateTaskStatus()` explicitly rejects remote writes with an informative audit log and error, keeping nursing custody and task status changes durably committed in ShiftWeave local edge cache.
  - **Automated Verification Suite (`npm run test:epic-reads`)**:
    - Ran all 8 test scenarios against live Epic sandbox:
      1. Ping to CapabilityStatement metadata (HTTP 200).
      2. Unified clinical context fetch for Camila Lopez (`erXuFYUfucBZaryVksYEcMg3`): 10 encounters, 1 condition (PCOS `euDDjG6i1-OkhZii5APxOiw3`), 1 medication order (drospirenone-ethinyl estradiol / YAZ 3-0.02 MG tablet), 1 document reference.
      3. Patient roster resolution via `getPatientsByUnit` (Camila Lopez, Derrick Lin, Desiree Powell).
      4. Nursing tasks derived from live medication orders (`sourceSystem: 'EPIC_FHIR_R4'`).
      5. Single task detail resolution with linked patient demographics.
      6. Document inline base64 content decoding.
      7. Task write-back safety guardrail enforcement.
      8. Explicit error surfacing on non-existent patient (Epic OperationOutcome 404 propagated with zero silent fallback).
  - **Regression Verification**:
    - `npm run typecheck`: Passed with 0 errors (strict `exactOptionalPropertyTypes: true` satisfied).
    - `npm test`: **All 73 isolated database checks passed**.
    - `npm run test:epic`: All 5 Step 2 OAuth checks passed.
    - `npm run test:epic-reads`: All 8 Step 3 reads checks passed.
- **Next Milestone (Step 4 of Roadmap / AWS Bedrock Integration)**:
  - Step 4 (Handoff integration): Combine imported Epic clinical context with local nursing assignments, conflict detection, and custody state, keeping field authority clear and external IDs namespaced.
  - Mini challenge: Connect AWS Bedrock Converse API adapter (`@aws-sdk/client-bedrock-runtime`).



