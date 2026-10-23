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
  - Step 4 (Handoff integration): Completed on 21 October 2026 (see below).

### Epic Backend Integration Update — Step 4 (Handoff Integration & Field Authority) COMPLETED (21 October 2026)

- **Step 4 Implementation Completed & Verified Live**:
  - Built `FieldAuthorityService` (`src/services/field-authority.service.ts`):
    - Defined `FIELD_AUTHORITY_MATRIX` separating single-source-of-truth boundaries:
      * **EHR Authority (`EPIC_FHIR_R4`)**: Patient demographics, primary diagnoses (problem list), documented allergies, and physician medication orders.
      * **Local ShiftWeave Authority (`LOCAL_SHIFTWEAVE`)**: Bedside nursing custody, shift assignments, execution status (`PENDING`, `IN_PROGRESS`, `COMPLETED`), escalation notes, and discrepancy resolutions.
    - Implemented external identifier namespacing: `namespaceId('epic', resourceType, id)` generating clean, unambiguous IDs (e.g. `epic:Patient:erXuFYUfucBZaryVksYEcMg3`, `epic:MedicationRequest:ePDJ.zsf3Jfg2.MKkAMgW9EcIbsaiB.y-OTrPS5v2h8Q3`) preventing collision with local synthetic keys.
    - Implemented bidirectional ID parsing (`parseNamespacedId`) and external ID validation (`isExternalId`).
  - Enhanced `HandoffService` (`src/services/handoff.service.ts`):
    - Grounded SBAR handoff narrative (`buildIntegratedHandoffNarrative`): Integrates live Epic clinical context (Camila Lopez / `erXuFYUfucBZaryVksYEcMg3`) alongside local bedside assignments.
    - SBAR structure preserves: `## Situation`, `## Clinical Context (Epic on FHIR R4)` with namespaced IDs, `## Recorded Bedside Workflow State (ShiftWeave Local Authority)`, `## Assessment & Discrepancies`, and `## Workflow Follow-up & Custody`.
    - Preserved custody invariants: Drafting proposes candidate tasks only; custody remains strictly with outgoing nurse until explicit incoming nurse acceptance.
    - Two-party human review gate: Unresolved discrepancies block acceptance and finalization until verified by a human nurse.
    - Local sign-off finalization: Finalizing handoffs records `acknowledged_at` locally with `externalSync: 'NOT_REQUESTED'`.
  - Updated MCP tools in `src/server.ts`:
    - `get_handoff_context`: Exposes `field_authority` matrix to agent orchestrators.
    - `create_handoff_draft`: Supports optional `epic_clinical_context` parameter.
  - **Automated Verification Suite (`npm run test:handoff`)**:
    - Ran all 9 test scenarios in `scripts/test-handoff-integration.ts`:
      1. Field Authority Matrix boundary checks (8 boundaries verified).
      2. Namespacing and bidirectional parsing.
      3. Grounded handoff draft synthesis with live Epic clinical context (Camila Lopez).
      4. Grounded SBAR narrative and snapshot inspection.
      5. Custody invariance on draft creation.
      6. Discrepancy gate enforcement (unresolved conflict blocks acceptance).
      7. Explicit custody acceptance (previous assignment `TRANSFERRED`, new assignment `ACTIVE`).
      8. Local handoff finalization.
      9. Retention of immutable local history (`task_events`, audit records).
  - **Regression Verification**:
    - `npm run typecheck`: Passed with 0 errors.
    - `npm test`: **All 73 isolated database checks passed**.
    - `npm run test:epic`: All 5 Step 2 OAuth checks passed.
    - `npm run test:epic-reads`: All 8 Step 3 reads checks passed.
    - `npm run test:handoff`: All 9 Step 4 integration checks passed.
- **Next Milestone (Step 5: Integration Recovery / AWS Bedrock Adapter)**:
  - Step 5 (Integration Recovery): Completed on 21 October 2026 (see below).

### Epic Backend Integration Update — Step 5 (Integration Recovery) COMPLETED (21 October 2026)

- **Step 5 Implementation Completed & Verified Live**:
  - **Token Expiry & Recovery**:
    - Verified in-memory token cache expiry handling: automatically detects expired cached tokens and fetches fresh credentials from Epic OAuth endpoint.
    - Verified HTTP 401 Unauthorized handling: `authorizedFetch` catches 401 from Epic sandbox, re-authenticates via `getAccessToken(true)`, and transparently retries the request with the fresh token.
  - **Permission Denial & Scope Boundaries**:
    - Invalid or unauthorized FHIR queries surface explicit HTTP error statuses and OperationOutcome payloads with zero silent fallback to local/mock data, logging `outcome: 'FAILURE'` to `AuditService`.
  - **Timeout Handling**:
    - Verified network timeout behavior via `AbortSignal.timeout(ms)`. Catches timeout/abort errors and surfaces explicit messages without process hangs.
  - **Deduplication & Interruption Resumption**:
    - Ingestion pipeline (`importIncomingData`): Idempotent hashing prevents duplicate records across patients, nurses, shifts, and tasks on repeated or interrupted runs.
    - Stable idempotency keys: Verified exact deduplication for mutations (`HandoffService.createDraft`); reusing keys with identical payload returns the exact saved result from `operation_receipts`.
    - Key reuse guard: Reusing an idempotency key with a changed payload throws an explicit error (`Idempotency key was already used for a different request`).
  - **Workflow Interruption Recovery with Source Reconciliation**:
    - Injected chaos interruption during multi-step agent orchestration.
    - Verified durable checkpoint commitment before crash.
    - Simulated external source record updates in SQLite during interruption.
    - Resuming via fresh orchestrator (`resume_workflow`) detected `sourceChanged: true`, refreshed reads, reconciled against updated source values, and avoided duplicate draft creation.
  - **Automated Verification Suite (`npm run test:recovery`)**:
    - Ran all 7 test scenarios in `scripts/test-integration-recovery.ts` covering token expiry, 401 retry, permission denial, timeout, ingestion deduplication, retry key payload guards, and chaos recovery.
  - **Regression Verification**:
    - `npm run typecheck`: Passed with 0 errors.
    - `npm test`: **All 73 isolated database checks passed**.
    - `npm run test:epic`: All 5 Step 2 OAuth checks passed.
    - `npm run test:epic-reads`: All 8 Step 3 reads checks passed.
    - `npm run test:handoff`: All 9 Step 4 integration checks passed.
    - `npm run test:recovery`: All 7 Step 5 recovery checks passed.
- **Next Milestone (Step 6 of Roadmap / AWS Bedrock Integration)**:
  - Step 6 (Browser Verification): Completed on 21 October 2026 (see below).

### Epic Backend & Browser Journey Update — Step 6 (Browser Verification) COMPLETED (21 October 2026)

- **Step 6 Implementation Completed & Verified Live**:
  - **Browser Journey & Voice Test Automation (`scripts/test-browser-journey.ts`)**:
    - Built comprehensive end-to-end integration test exercising the complete Seema-to-Reema nurse workflow via the Express API and Streamable HTTP MCP transport:
      1. *Frontend static distribution serving*: Verified `GET /` serves `index.html` from `client/dist` with HTTP 200.
      2. *Initial display state*: Verified `GET /api/voice/:sessionId` returns clean initial prompt greeting without a prior nurse context.
      3. *Seema Patel introduction*: Spoken turn `"Hi, I am Seema"` successfully resolved nurse identity (Seema Patel, RN), retrieved 2 assigned tasks, 1 unfinished, and 1 unresolved discrepancy.
      4. *Room task explanation*: Spoken turn `"Explain room 305"` retrieved Elena Rostova's IV Vancomycin 1g Infusion task details with status `IN_PROGRESS` and priority `STAT`.
      5. *Discrepancy review*: Spoken turn `"Review discrepancies"` detailed Elena Rostova's Room 305 EHR vs Shift Notes discrepancy.
      6. *Staging and confirming discrepancy resolution*: Spoken turn `"Resolve discrepancy in room 305 in progress because verified with pharmacy"` staged pending confirmation; confirmed via `"Yes confirm"`, committing the resolution note and local status without touching Epic EHR.
      7. *Handoff preparation with custody invariance*: Spoken turn `"Prepare my handoff for Reema"` drafted handoff for incoming nurse Reema; verified that custody invariant was strictly maintained (Seema remains assigned nurse).
      8. *Identity switch to incoming nurse*: Spoken turn `"Hi, I am Reema"` switched active nurse context to Reema Roy, RN, clearing previous turn history and displaying 1 incoming handoff candidate.
      9. *Explicit two-party custody acceptance*: Spoken turn `"Accept all handoff tasks"` staged confirmation; confirmed via `"Yes confirm"`, transitioning previous assignments to `TRANSFERRED` and incoming assignments to `ACTIVE` in SQLite.
      10. *Local handoff finalization*: Spoken turn `"Finalize handoff"` staged confirmation; confirmed via `"Yes confirm"`, finalizing handoff with human sign-off timestamp and `externalSync: 'NOT_REQUESTED'`.
      11. *Session termination & security clearing*: Spoken turn `"End my session"` cleared nurse identity, purged sensitive clinical display, and reset session state.
      12. *Browser error and recovery states*: Verified HTTP 409 Conflict rejection on stale revision, refusal of autonomous clinical diagnosis/prescription requests, and idempotent exact-response replay on turn retry.
  - **Runtime & Resilience Fixes**:
    - Fixed `src/server.ts` Express error middleware: Added `if (res.headersSent) return _next(error);` to guard against double-send header exceptions during socket teardown or client cancellations.
    - Hardened `src/agent/mcp-client-bridge.ts`: Wrapped session close `DELETE /mcp` fetch call in a try/catch to gracefully handle `ECONNRESET` during rapid test server shutdowns.
    - Fixed `src/services/handoff.service.ts` custody transfer query: Ensured all active assignments for outgoing nurse/tasks are updated to `TRANSFERRED` upon batch custody acceptance.
    - Verified client build: `npm run build:client` built cleanly in 9.51s with Vite + TypeScript (`client/dist`).
  - **Documented Limitations**:
    - The voice interpreter is a deterministic clinical workflow parser supporting defined English phrases, not a generalized freeform conversational NLP engine or multilingual parser.
    - Clinical safety boundaries are absolute: Medication administrations, diagnostic interpretations, and EHR order adjustments are strictly rejected.
    - Name selection (`"I am Seema"`) is local demonstration context, not production multi-factor nurse authentication.
    - External EHR write-back is blocked in the external sandbox; custody and finalization states remain within the local edge cache.
  - **Regression Verification**:
    - `npm run typecheck`: Passed with 0 errors.
    - `npm test`: **All 73 isolated database checks passed**.
    - `npm run test:epic`: All 5 Step 2 OAuth checks passed.
    - `npm run test:epic-reads`: All 8 Step 3 reads checks passed.
    - `npm run test:handoff`: All 9 Step 4 integration checks passed.
    - `npm run test:recovery`: All 7 Step 5 recovery checks passed.
    - `npm run test:browser`: All 12 Step 6 browser journey checks passed.
### Epic Backend & EHR Write-Back Update — Step 7 (Reviewed Write-Back Evaluation) COMPLETED (21 October 2026)

  - **Live Epic Sandbox Scope & Permission Findings**: and probed `POST /api/FHIR/R4/DocumentReference` against test patient Camila Lopez (`erXuFYUfucBZaryVksYEcMg3`).
    - Epic Sandbox confirmed scopes: `system/Patient.r`, `system/DocumentReference.r`, `system/DocumentReference.s`, `system/Condition.r`, `system/Condition.s`, `system/MedicationRequest.r`, `system/MedicationRequest.s`, `system/MedicationAdministration.r`, `system/MedicationAdministration.s`, `system/AllergyIntolerance.r`, `system/AllergyIntolerance.s`.
    - Probing `POST /DocumentReference` returned **HTTP 403 Forbidden**: Backend Systems non-production client credentials receive read/search scopes only; clinical write scopes (`system/DocumentReference.c`) are not granted for automated backend accounts in this public sandbox tier.
    - Result: As mandated by `incomingapikey.md` and `goal.md`, this sandbox restriction is surfaced explicitly with zero false success claims.
  - **Durable External Sync State Machine**:
    - Extended `handoffs` table with 5 durable columns: `external_sync_status: 'NOT_REQUESTED' | 'PENDING' | 'SYNCED' | 'FAILED' | 'UNCERTAIN'`, `external_resource_id`, `external_sync_error`, `external_synced_at`, `external_sync_payload`.
    - Added safe automatic schema migrations in `initializeDatabase()` in `src/db/schema.ts`.
  - **US Core FHIR R4 DocumentReference Payload Construction**:
    - Implemented `EpicWriteBackService.buildDocumentReferencePayload()` creating strictly conformant US Core clinical notes with LOINC `11506-3` Progress note code, US-Core `clinical-note` category, base64 text attachments, and patient/author provenance.
  - **Safety & Invariant Gates**:
    - *Human Review Gate*: Rejects unconfirmed requests (`human_confirmed: false`) with `"Explicit human review and confirmation is required before publishing external clinical notes"`.
    - *Discrepancy Gate*: Rejects publication on handoffs with unresolved conflicts (`unresolved_conflicts_count > 0`).
    - *Custody Gate*: Requires incoming nurse to have accepted active custody (`transfer_status = 'ACTIVE'`) before publishing clinical notes.
    - *Local Finalization Invariant*: Proved that local sign-off marks `status = 'FINALIZED'` while `external_sync_status` remains strictly `'NOT_REQUESTED'`. Local finalization is never represented as external publication.
  - **Network Ambiguity & Remote Reconciliation Before Retry**:
    - Network timeouts/aborts durably transition state to `UNCERTAIN` with explicit warning surfaced.
    - Before retrying or re-issuing a write, `EpicWriteBackService.reconcileRemoteNote()` queries remote EHR records to verify if the note was already committed remotely.
    - If found remotely: recovers remote resource ID, updates local status to `SYNCED`, and avoids creating duplicate clinical notes in the hospital EHR.
  - **API & Protocol Integration**:
    - Added Express endpoint `POST /api/handoffs/:id/publish-note` with Zod schema validation and error surfacing.
    - Registered 12th MCP tool: `publish_reviewed_handoff_note` (with human mutation protection excluded from autonomous agent toolsets).
    - Updated `verify-workflows.ts` to assert 12 discovered MCP tools.
  - **Automated Verification Suite (`scripts/test-writeback.ts` / `npm run test:writeback`)**:
    - Ran all 8 test scenarios on an isolated temporary SQLite database:
      1. Live Epic sandbox scope evaluation and HTTP 403 Forbidden surfacing.
      2. US Core FHIR R4 DocumentReference payload validation.
      3. Explicit human review gate enforcement (`human_confirmed: false` rejected).
      4. Discrepancy gate enforcement (unresolved conflict blocks publishing).
      5. Custody acceptance gate enforcement (custody required before write-back).
      6. Local finalization invariant (local sign-off is not external publication).
      7. Ambiguous network outcome & durable `UNCERTAIN` state handling.
      8. Remote reconciliation before retry (duplicate note prevention and state recovery).
  - **Regression Verification**:
    - `npm run typecheck`: Passed with 0 errors.
    - `npm test`: **All 73 isolated database checks passed** (including 12 MCP tools discovery).
    - `npm run test:epic`: All 5 Step 2 OAuth checks passed.
    - `npm run test:epic-reads`: All 8 Step 3 reads checks passed.
    - `npm run test:handoff`: All 9 Step 4 integration checks passed.
    - `npm run test:recovery`: All 7 Step 5 recovery checks passed.
    - `npm run test:browser`: All 12 Step 6 browser journey checks passed.
    - `npm run test:writeback`: All 8 Step 7 write-back checks passed.
    - `npm run build:client`: Clean Vite production build passed.

- **Next Milestone**:

  - Step 8: Submission packaging (friction log, demo video, final documentation).
  - AWS Bedrock Converse API Adapter: Pluggable `@aws-sdk/client-bedrock-runtime` for hackathon mini challenge.


## Hosted synthetic hospital implementation — 23 October 2026
- Step 1 (inspection): Read repository rules, understanding.md, provider, deployment, voice, simulation, and database code. Confirmed live-fhir-api refuses activation and SIMULATION_MODE rejects public/production hosting. Existing workflow data remains in the configured SQLite database. No deployment has been performed.
- Plan: Preserve Epic; add an independently labeled FHIR R4 hospital source with explicit provisioning, persistent workflow records, per-voice-session source selection, a private HAPI deployment option, and isolated verification. Preserve staff workspace and existing authorization.
- Step 2 (implemented, not yet verified): Added a separate synthetic FHIR R4 HTTP adapter with timeout, paging, same-endpoint checks and patient-reference validation. Added explicit hospital provisioning fixtures and a setup script that backs up the configured SQLite database, uploads idempotent FHIR PUT transactions, seeds namespaced workflow rows and creates a real draft handoff. Added durable hospital refresh/failure receipts. No Epic code or staff workspace was replaced; no hosted deployment or real HAPI connection verified yet.
- Step 3 (implemented, verification pending): Added durable per-voice-session data-source selection through MCP, a voice-only source selector, automatic synthetic FHIR refresh through MCP, and explicit connection-failure responses. Source changes clear identity, conversation and pending confirmations while preserving workflow rows. Added hosted hospital catalog provisioning and a private HAPI/PostgreSQL Compose overlay; Docker image includes fixtures. Existing SIMULATION_MODE guard and staff authentication remain intact. Docker engine initially unavailable; started Docker Desktop for actual server verification. Root typecheck reports two pre-existing errors in verify-handoff-conversation-live.ts; no new type errors reported by that run.
- Step 4 (scope correction): User explicitly retained hosting responsibility. Stopped Docker/image/deployment work; no services deployed. Added an explicit SQLite FHIR resource store in the same configured application database so the synthetic dataset works without a separate FHIR server. External FHIR mode remains opt-in through HOSPITAL_DATA_SOURCE=fhir and never silently falls back. Initial HTTP contract test failed on sandbox localhost access; no passing integration claim made. Production/client build passed before the latest SQLite-source changes; full dataset verification now in progress.
- Step 5 (MCP independence): User clarified external testers must use MCP without the dashboard/laptop state. Added MCP server instructions, database-derived synthetic nurse discovery in get_voice_display, an explicit prepare/start command using the configured SQLite DB, and an independent official MCP SDK client verifier that imports no server/database/dashboard modules. Dataset tests are isolated; initial sandbox MCP connection hit EACCES and was rerun with localhost permission. No hosting performed.
- Step 6 (verified): Independent official MCP SDK client passed connection, discovery, database-derived identity, task question and follow-up without importing server/database/dashboard modules. SQLite hospital suite passed 13 checks and all six guided scenarios; existing suite passed 186 checks. Fixed ambiguous room-only references in hospital scenario/test wording rather than bypassing clarification. Root typecheck passed after correcting SDK optional-property typing and two existing live-handoff verifier annotations. Added MCP_DATASET.md with standalone commands, synthetic provenance, source-switch semantics and honest mode limitations.
- Step 7 (implementation refinement): Included still-owned incoming handoff candidates in source refresh; reject mismatched nurse/shift combinations. Added synthetic source snapshots to handoff context/drafts with generic patient-source labeling. These refinements require a final regression run. Hosting remains user-owned; no deployment performed.
- Step 8 (configured database populated): Ran hospital:prepare against the existing configured data/workflow-sandbox-1792609735104.db. A consistent backup was created at data/backups/before-hospital-1792740037303.db before additive import. Enabled only HOSPITAL_SIMULATION_ENABLED=true and HOSPITAL_DATA_SOURCE=sqlite in local .env; existing Epic/Bedrock/auth credentials and settings were preserved. No remote hosting performed. Production/client build passed after the handoff refinements; final isolated tests still running.
- Step 9 (verified): Final SQLite hospital run passed 13 checks, including an independent official SDK process; six scenarios ran through MCP. Controlled FHIR HTTP run passed 16 checks including paging, wrong-patient rejection, cross-server link rejection and explicit outage handling (not a real HAPI verification). Final build passed. Existing regression suite again passed 186 checks after handoff-source changes. Isolated legacy test profiles now explicitly disable the hospital source so local .env cannot change their fixture expectations. Started only the existing local dev server on port 3000 with the configured populated database; no cloud deployment performed. Running configured Bedrock/MCP read-only conversation verification next.
- Step 10 (configured live local MCP verified): Independent official SDK client successfully connected to the local port-3000 server using the actual configured Bedrock adapter, dynamically selected a synthetic nurse, asked for tasks and completed a contextual follow-up. No dashboard/database imports in that client. A read-only verifier compared the populated DB with the pre-import backup and confirmed every original nurse, patient, task, assignment, handoff, staff-account and Epic-snapshot row was unchanged. Confirmed 3 new synthetic nurses, 3 patients, 17 stored FHIR resources, 5 tasks, 1 initial handoff and 6 scenarios, with valid foreign keys/integrity.
- Step 11 (safety refinement): Refresh source data before human confirmation; exclude only refresh timestamps from evidence-version comparison. Actual resource changes invalidate pending actions, while a wake-only call preserves a valid proposal. Added these cases to isolated MCP dataset tests. Enabled-but-unpopulated hospital startup now fails with an actionable prepare command. Latest test/build results will be recorded after completion.
- Step 12 (review fix): Identified a content-hash-only import receipt that could incorrectly treat a later intentional restoration as an old retry. Embedded FHIR writes now require an explicit Idempotency-Key, while a new intentional edit gets a new key. Added a repeated value-change cycle to dataset verification. This affects synthetic source imports only; no frontend clinical write capability was introduced.
- Step 13 (final verification): Latest SQLite hospital suite passed 14 meaningful checks with all six scenarios, the independent official SDK client, confirmation revalidation and intentional repeated data edits. Latest controlled FHIR HTTP suite passed 17 checks including paging/identity/link/outage cases; this is contract verification, not a real HAPI deployment. npm run typecheck, npm run build and git diff --check passed. The existing isolated regression suite passed 186 checks after the source/version safeguards. Read-only configured-database verification again confirmed 3 synthetic nurses, 3 patients, 17 FHIR resources, 5 tasks, the initial handoff and 6 scenarios; all pre-import domain records remain identical to backup. Local dev server remains on port 3000. Hosting was not performed; real HAPI hosting and deployment remain the user's responsibility. Physical microphone/audio acoustics were not re-tested in this dataset/MCP task.
- Deliverable: MCP_DATASET.md documents prepare/start commands, the direct MCP connection flow, official SDK verifier, production compiled provisioning command, persisted data boundaries and optional external-FHIR limitations. External testers use the server /mcp URL and authorized credential; they do not need this developer's dashboard, browser session, database files or laptop.

## MCP tool coverage and nurse assignment follow-up — 23 October 2026
- Inspected routing, source mode, initial assignments, operational authorization and schema. Confirmed the local MCP uses real SQLite queries and synthetic FHIR records; no externally hosted deployment has been verified. Jordan initially had no assignment. Existing operational staff creation/assignment is protected and remains unchanged.
- Implemented additive fixture version 2: Jordan coordination work, an unassigned task pool and a sourced documentation conflict. Added simulation-only available-task lookup and explicitly confirmed self-claim using the existing assignment/event/receipt/checkpoint tables; rejects owned tasks, conflicting tasks, stale confirmations and cross-unit identities. Added natural-language AVAILABLE_TASKS/ASSIGN_SELF intents and a direct MCP claim tool. Existing Epic tools remain Epic-specific; they are never relabeled simulation successes.
- Verification in progress: expanded isolated hospital suite to exercise every discovered MCP tool, with real workflow successes and explicit rejection checks for unavailable Epic/auth-only operations. Added Jordan lookup, selection/confirmation, concurrent-claim rejection, replay and discrepancy-resolution tests. No completion claim yet.
- Expanded SQLite test passed 18 checks and exercised all 20 discovered MCP tools, including successful task/handoff/checkpoint operations and expected rejections for four Epic-only operations and the authenticated staff dispatcher. Jordan task retrieval, self-claim, duplicate replay, competing owner rejection and discrepancy resolution passed.
- Added a same-shift UNASSIGNED pool using existing task_assignments, rather than introducing another assignment service/database. Claim marks the pool row TRANSFERRED and creates ACTIVE custody atomically. Added read-only column population reporting; empty/nonapplicable fields are reported rather than filled with invented data. Final tests pending this refinement.
- Provisioned fixture v2 additively into the configured original SQLite DB after backup data/backups/before-hospital-1792742063071.db. Read-only comparison confirmed all pre-upgrade domain records were unchanged; current hospital has 9 tasks, including Jordan work and two shift-scoped unassigned tasks. Generated HOSPITAL_DATABASE_COVERAGE.md with per-table/per-column population counts and explicit empty-field explanations. All 20-tool SQLite tests passed (18 checks), existing regression passed 186 checks, typecheck and client/backend build passed.
- Live Bedrock assignment probe on a temporary copy successfully reached Jordan work, offered extra work, staged and confirmed an assignment, but its final conversational follow-up failed evidence wording validation and returned the honest backend fallback. Investigating that verified remaining issue before claiming the live wording path is complete; production task data was not changed by this probe.
- Root cause of live wording failure confirmed: Bedrock used the neutral introduction "Here is/Here’s the full picture" outside exact fact placeholders. Added that exact benign phrase to neutral connective handling, while preserving exact source evidence, missing-data warnings, clinical advice rejection and unsupported fact/number checks. Added regression assertions for accepting the phrase with sourced facts and rejecting an invented allergy after it. Rerunning the real Bedrock flow on a temporary copy.
- Final live Bedrock verification passed on a temporary copy: natural Jordan introduction, extra-work query, explicit self-assignment proposal, human confirmation and persisted task follow-up, with SUCCESS model audit outcomes. The benign full-picture wording fix passed the existing 186-check regression suite, including unsafe/unsourced-answer rejection. Latest backend/client build and root typecheck passed before final documentation.
- User supplied the older deployed endpoint https://32.189.84.182.nip.io/mcp and explicitly stated it has not been updated. Read-only official-SDK initialize/tools-list succeeded: 16 tools exposed; missing claim_hospital_task, refresh_hospital_records, select_voice_source and review_simulation. No remote tool execution, database mutation or deployment performed. Latest local mode has 20 tools; code AND persistent dataset/config must be updated by the user for those capabilities to appear remotely.
- Deliverables: expanded data/hospital/workflow.json and additive seeder v2; hospital self-claim service and MCP tool; semantic voice intents and confirmation; existing voice drawer shows available work; report-hospital-coverage.ts and HOSPITAL_DATABASE_COVERAGE.md; all-tool isolated tests, live Bedrock temporary-copy verifier, remote discovery-only inspector; updated MCP_DATASET.md. Authenticated staff workspace and Epic endpoints remain separate and preserved.

## Strict Epic/default MCP and preview isolation — 23 October 2026
- User authorized external MCP defaulting to Epic while dashboard preview remains synthetic in the same original database. Found prior configuration-based default and shared generic reads did not provide this boundary.
- Implemented per-transport source realms with a private in-process server-to-server capability; ordinary external clients default Epic and cannot choose preview by a mode/header alone. GET/POST/DELETE require matching session realm/capability. Discovery hides preview tools from Epic and Epic/auth sandbox tools from preview.
- Implemented database-backed realm-specific aliases for voice sessions and retry keys, tagged checkpoints, source-scoped workflow IDs, nurse/task/patient reads, handoff scope validation and source-version fingerprints. Source rows/assignments remain in the original DB. Same caller UUID can no longer return another source’s receipt or conversation. Dashboard source switching uses separate internal scoped connections; public production preview cannot switch into Epic.
- Added production rejection of mock publication and removed hardcoded Epic key-id fallback. Existing staff auth remains separate; hosted Epic-only companion APIs cannot proxy data without existing staff auth. Initial preview suite passed 18 checks with 15 preview tools. Legacy SDK regression fixture now explicitly uses its trusted fixture realm; untrusted external defaults tested separately. Further adversarial isolation checks in progress; no production/deployment claims yet.
- Completed companion-route isolation: preview task/handoff/conflict queries and audit traces stay scoped, acknowledgement/finalization validate source, generic checkpoint calls cannot overwrite managed voice/mutation state, and preview cannot change the global provider or publish Epic notes. Production also refuses restoring an old locally selected Epic dashboard session. Explicit configured non-synthetic nurse/shift IDs permit initial Epic sync before patient mappings exist; unit/shift validation remains enforced.
- Verified 11 adversarial source-isolation checks through real Streamable HTTP connections using the official MCP SDK and trusted preview bridge. Covered forged headers/stolen transport IDs, shared caller UUIDs, durable retry separation, cross-source reads/recovery, independent fingerprints, real HTTP Epic-adapter reads and failures against a controlled FHIR contract server, dashboard scope and production public-preview restrictions. No live Epic authorization or note publication was established by these contract tests.
- Final checks: 18 isolated hospital checks passed with all 15 preview tools exercised; 186 existing regression checks passed; typecheck and backend/client build passed; browser voice regression passed using simulated recognition/playback, including interruption and error recovery. Read-only configured-DB comparison against before-hospital-1792742063071.db confirmed original nurse/patient/task/assignment/handoff/staff/Epic snapshot rows unchanged, 3 hospital nurses, 3 patients, 17 FHIR resources, 9 tasks and 6 scenarios present, integrity/foreign-key checks clean. Updated MCP_DATASET.md with source defaults, tool lists, setup limitations and exact test command. No hosting or remote data changes performed; older deployed endpoint still requires owner deployment and verification.

## Voice response latency investigation — 23 October 2026

- Parsed the user-supplied HAR locally without printing credentials or full request bodies. Its voice POST took 6027 ms (6012 ms waiting); the following TTS stream took 802 ms total, with headers after 319 ms. The HAR does not include speech-end timing or prove audible playback latency. Its long status-101 Vite connection is a development WebSocket, not a slow answer request. The dominant observed delay is backend inference, not downloading the voice audio.
- Applied hackathon-guidelines. Inspected the voice hook, HTTP/MCP bridge, durable semantic workflow, Bedrock adapter and ElevenLabs streaming service. Kept microphone capture, sentence pause, barge-in, configured model/voice, staff workspace and source isolation unchanged in this task. Local app was not listening when browser verification began; started npm run dev on port 3000, session 33375.
- Reduced the Bedrock wording pass to the current question, authoritative answer, source facts and validation feedback rather than resending the entire directory/context/history and full intent instructions. Full history remains persisted and used for intent/follow-up resolution. A live compact-prompt trial still emitted a name outside evidence and required a repair, so constrained the wording tool's introduction to explicit neutral choices and let the adapter append model-selected fact IDs as placeholders. The existing source evidence, uncertainty, clinical-scope and action validation still run; invalid IDs remain rejected. This avoids the observed free-prose validation retry without allowing invented claims.
- Added per-decision LLM:VOICE_DECISION timing/token/stage audit entries without prompt/credential logging. Updated the isolated live assignment verifier to report per-turn timings and decision metrics. Final live Bedrock/MCP/SQLite check passed on a temporary database copy: combined introduction/tasks 7900 ms (three model calls, first 4406 ms); available-work query 2754 ms; assignment proposal 2780 ms; explicit confirmation 85 ms; established-session task follow-up 4071 ms (2383 ms intent + 1411 ms wording). Wording calls used roughly 1367–1401 input tokens; no repair was needed in this final run. These are individual backend samples, not an SLA or a controlled before/after performance comparison. Three-call combined introduction remains a latency limitation, and cloud/network timing varies.
- Verification: 187 isolated regression checks passed, including compact-context preservation, fact ordering, missing-data warnings and invalid-ID rejection; root typecheck and backend/client build passed; git diff --check passed. Real browser UI answered a normal greeting and Seema's combined introduction/task query from stored synthetic records. Physical microphone/audio quality was not measured. No deployment or hosting changes performed. Existing uncommitted edits to audio-related files predated this task and were preserved.

## Single-inference voice workflow and transport reuse — 23 October 2026

- User requested eliminating extra calls and targeting 3–4 second answers. Applied current hackathon-guidelines, important.md, AGENTS.md and project context. Identified two remaining avoidable inferences: planning the requested operation after identifying the nurse, and wording a result already rendered by the backend.
- Extended the existing private semantic intent tool with an optional after_identification plan, render_backend and a bounded neutral introduction. One model call can identify the speaker and plan their remaining operation. Identity is validated first; queued operations are checkpointed and validated against the newly identified nurse's current scope. Existing private child receipts prevent duplicate identification/operations on retry. No new API endpoint or authentication flow added.
- The model still interprets natural language and handles general conversation; nursing facts and confirmations now come directly from the actual just-executed backend result. Ordinary reads avoid the final wording inference. Existing evidence validation, source uncertainty, human confirmation, negation checks and fresh source-version revalidation remain. Old persisted plans and legacy reply validation paths remain supported.
- Added a shorter single-pass system instruction and required a tool choice between structured workflow execution and general conversation. Prevented the model from answering workflow facts through the conversation tool. A live early trial of unconstrained single-pass output attempted free prose for available work and was rejected safely; required tool selection corrected the Sonnet live workflow. A separate Haiku comparison had a slow first request and an extra reference-repair inference, so it was not selected; the configured Sonnet model and .env remain unchanged.
- Reused Bedrock SDK transport clients across turns, keyed by region and hashed credential configuration, with cleanup on server close. The pool stores no nurse records or dialogue; context remains source/session-scoped and reads stay current. Per-decision metrics now distinguish SDK client reuse, credential resolution time, Bedrock-reported inference time, token counts and total decision time. Reusing an SDK client enables transport pooling but does not itself measure physical TCP socket reuse.
- Live Sonnet/MCP/SQLite verification asserts exactly one inference for every ordinary turn and zero for explicit confirmation. An optimized run measured introduction+tasks 2891 ms, available work 1633 ms, assignment proposal 1985 ms, confirmation 124 ms, and follow-up 1712 ms. A subsequent run measured 2540/1741/1674/48/1711 ms. Credentials resolved in 0 ms; later Bedrock-reported service inference was about 1066–1329 ms. Another run had a 6526 ms first-request outlier but 1489–1818 ms later turns. These samples establish reduced overhead, not a universal latency guarantee or an SLA.
- Optional --speech verification streamed the actual synthetic backend answer through configured ElevenLabs and received audio bytes after 552 ms. Physical playback was not measured. The existing 1500 ms sentence-completion pause, microphone behavior, barge-in and voice settings were deliberately preserved. Backend timing excludes this pause and playback buffering; typical voice timing can approach 3–4 seconds, but cold/network/service tails can exceed it.
- Added regression coverage for one-call combined identity/tasks, exact receipt replay, patient follow-up, unknown identity blocking, scoped target validation, uncommitted update proposals and recovery after a lost final response. Updated the browser test to verify one semantic inference through transcription/MCP/backend speech/playback/listening. Final tests: 194 regression checks passed; 11 source-isolation checks passed; browser voice regression passed with simulated recognition/audio; root typecheck and backend/client build passed. Live checks mutated only temporary database copies. No deployment, hosting, model switch, staff-workspace changes or question-answer cache introduced.
- Reproduce live latency checks with npx tsx scripts/verify-hospital-assignment-live.ts; append --speech to test configured ElevenLabs streaming. These commands use explicitly configured live cloud credentials and temporary database copies; they do not verify production Epic authorization or publish to Epic.

## Conservative project cleanup and EC2 release handover — 23 October 2026

- User authorized an in-depth cleanup while critically preserving necessary files and requested all changes required for the existing deployment. Loaded current hackathon-guidelines, important.md, AGENTS.md, project context and understanding.md; inventoried source, scripts, manifests, fixtures, deployment files and file references before removing anything. Starting Git working tree was clean. The user clarified Docker/deployment live in a separate setup; stopped local Docker probing and requested sanitized deployed Compose/Dockerfile/Caddyfile. No image build/push, container deployment, remote database change or hosting action performed.
- Owner supplied actual /mnt/shiftweave Compose with EBS bind mounts, image 540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave:2026-10-23-006, unchanged Caddy config and redacted variable names. Preserved those host paths, domain, certificates, one-app topology, Node 24, non-root UID 1000 and existing Epic endpoints/credentials. Added deploy/compose.ec2.yaml as a reviewable template, not an applied remote change. Root Compose's separate named-volume profile is retained and explicitly distinguished from the EC2 file.
- Removed exactly six confirmed-unreferenced tracked files (46,744 bytes): unrelated px0 install.sh and byte-identical install.sh~ backup, starter assets vite.svg/typescript.svg/hero.png, and public/icons.svg. Removed their now-empty assets folder only after verifying it was empty and inside the workspace. No reset/clean or broad delete. Retained all backend/voice/staff code, tests, fixtures, source specifications/DOCX, evidence, fonts/licenses, private keys/secrets, SQLite files/WAL/SHM, backups and active generated dependencies. Uncertain legacy/evidence files were preserved rather than assumed unnecessary.
- Removed unused client dev_assist:file:.. dependency and corresponding unreferenced parent/link lock metadata; required dependency versions stayed unchanged. npm's lock-only/incremental reconciliation initially restored the old link metadata, so explicitly synchronized the client manifest and lockfile and verified both. A normal clean install hit Windows locks on native Rollup/esbuild dependencies; an offline incremental install restored the working tree, and a fresh isolated temporary-directory npm ci passed using only the cleaned manifests. Did not kill an unknown running process or force-delete locked binary leftovers. Subsequent frontend/backend build passed, with unchanged active JS/CSS output hashes.
- Confirmed missing production artifact bug: tsconfig.build.json did not emit the documented setup-hospital script, although the production image prunes tsx. Included compiled hospital setup, configured-dataset verifier and independent MCP verifier. Dockerfile includes hospital fixture directory and only simulation catalog JSON, not screenshot evidence; startup now execs Node after preflight for direct signal delivery. Non-root user, health check and persistent mounts preserved.
- Fixed deploy env template's mock/production mismatch (runtime requires Bedrock), added explicit SIMULATION_MODE=false and SQLite hospital source settings, required owner image reference, optional existing speech variables and Epic bootstrap mapping names. Actual .env and real .env.deploy were not changed. Expanded Docker ignores for .sandbox, nested DB/WAL/SHM/backups, editor backups and evidence; added gitignore protection for future database/editor artifacts. Already tracked data/shiftweave.db remains tracked and intact; ignoring does not remove its history.
- Limited Caddy environment to DOMAIN in both Compose templates so it need not receive Bedrock/Epic/ElevenLabs credentials. Documented required --env-file interpolation. Production regression test initially failed because it inherited enabled-but-unpopulated local hospital settings; explicitly isolated source flags and reran successfully. Relaxed configured fixture verifier from exact total row counts to minimum baseline population, so legitimate additional records/handoffs do not cause a false deployment failure; SQLite integrity and foreign-key checks remain.
- Added scripts/verify-runtime-package.ts / npm run test:runtime-package. Plain Node child processes run the compiled provisioner twice in a temporary DB, retain an edited task and an extra dynamic task, avoid duplicate initial handoff, pass compiled verification/preflight, start the compiled NODE_ENV=production server, serve readiness/dashboard and connect a compiled independent official MCP client confirming Epic default and preview rejection. No cloud model/Epic calls are made. Initial test-only fixture misses (task priority/schedule and TypeScript result typing) were corrected before checks passed.
- Verification completed: root typecheck passed; full backend/client build passed after dependency cleanup; 194 isolated regression checks passed; 18 hospital checks passed; 11 source-isolation checks passed; production configuration/auth/origin/mocked-Epic/backup groups passed; compiled runtime package groups passed; fresh isolated frontend install passed; git diff --check passed. Read-only inspection found 30 current application tables and integrity ok, and compiled configured-hospital verifier confirmed baseline population without resetting the app database.
- Created CLEANUP_REPORT.md with deletion inventory, preserved categories, changed-file explanations, checks and limitations. Created deploy/UPDATE_CHECKLIST.md with the exact owner-supplied topology, immutable ARM64 ECR build instructions, image native-SQLite smoke command, env/profile choices, consistent backup/maintenance/additive hospital import into the ORIGINAL hosted database, independent public MCP verification, browser checks and rollback cautions. Updated README, DEPLOYMENT.md and deploy/ARCHITECTURE.md to remove obsolete keyword-gated/Gemini/hosted-mock guidance and link current instructions.
- Outstanding owner-environment work: review/commit intended changes, build and test Node 24 ARM64 image, push a new immutable ECR tag/digest, back up hosted data/config, select the intended preview vs existing authenticated-staff profile without silently disabling staff security, provision synthetic records additively if selected, deploy and verify actual TLS/browser/MCP/Epic permissions. No new DB or HAPI/PostgreSQL service is required. Public synthetic voice/TTS routes remain a demo profile with paid-provider exposure; spending/traffic policy requires owner review before broad public exposure. Local tests do not establish a universal latency SLA, live Epic write authorization, healthcare compliance or completed deployment.

## 23 October 2026 - Public preview decision and TTS error sanitization
- Owner explicitly approved an anonymous synthetic preview without staff sign-in. Updated deployment checklist to select STAFF_AUTH_REQUIRED=false and HOSPITAL_SIMULATION_ENABLED=true; preserved existing staff code, preflight guard and external MCP authorization. Actual deployment environment and EC2 were not modified.
- Reproduced raw upstream TTS details reaching HTTP responses using a synthetic HTTP 429 body in an isolated database/server. The regression failed before the fix. This establishes an error disclosure path, not evidence that real credentials were leaked.
- Removed upstream response bodies from buffered/streaming provider errors. HTTP failures retain only a typed status; endpoint responses use a fixed generic 502 error with fallback=true, and logs contain fixed provider/category plus HTTP status when available. Unknown/network errors never log message, stack, request text or credentials.
- Added an audio-stream error listener: interrupted streams close safely after audio starts, or return a generic 502 before headers. Existing success audio settings, microphone behavior and browser fallback code were unchanged.
- Added scripts/verify-tts-errors.ts and npm run test:tts-errors. Verified POST buffered, POST streaming and GET streaming HTTP/network failures; sanitized response/log checks; successful audio bytes; missing-key fallback; midstream failure and subsequent readiness. Tests use synthetic upstream responses, no paid requests and no configured application database mutations.
- Verification passed: targeted TTS script, npm run typecheck, npm run build and all 194 isolated regression checks. No hosting or live provider verification claimed.

## 23 October 2026 - Tester question guide, transcript visibility and MCP cross-check
- Applied repository hackathon skill/context. Changed only the voice UI, its display typing, verification scripts and documentation. Existing staff workspace/backend source policies and configured application database were not modified.
- Added PreviewQuestionGuide in the synthetic voice preview only. Nurse examples use availableNurses already returned from SQLite; patient/task examples use current display records. Examples fill the input without auto-sending; confirmation appears only for a ready pending proposal. Added a link to existing guided simulations. No new endpoint, data source or backend hardcoded answer.
- Increased nurse transcript from 20px to 30px in the reference canvas, with wrapping/scrolling and higher contrast; input increased to 26px. Kept the lower-center microphone and existing interruption behavior. Reserved right-side guide space and moved the context card away from it.
- Added PREVIEW_TEST_GUIDE.md with normal/complex/follow-up/missing-data/mutation questions, expected behavior, exact shared/preview/external MCP inventories, source-isolation explanation and executable checks.
- Added verify-preview-guide-browser.ts (npm run test:preview-guide). Headless Edge with isolated synthetic SQLite confirmed DB-derived nurse/patient examples, no request on example selection, larger transcript and no guide/transcript overlap; screenshots inspected at 1536x864 and 1280x720. Existing voice-browser regression also passed microphone/transcript/HTTP/MCP/playback wiring, interruption, queued speech and fallback using simulated speech adapters; no physical microphone quality claim.
- Added opt-in paid Bedrock script verify-preview-questions-live.ts (npm run test:preview-questions-live), with --edge-cases subset. It creates/provisions a fresh temporary database and calls real voice_turn through Streamable HTTP. Initial 19-question run correctly handled task filters, patient/allergy follow-ups, cancel/confirm, persisted completion, Jordan identity, available work and confirmed self-assignment. Four questions returned explicit provider failures with delays about 30-56 seconds. Initial greeting/missing-patient/handoff predicates were too weak and counted some generic error text as success; tightened the global check to reject provider/verification failures for every question. No clean pass is claimed for that run.
- Strict five-question retry: greeting, Seema introduction/tasks, missing patient and indirect Reema handoff passed (~1.7-3.1 seconds). Treatment advice request was safely blocked but returned generic verification failure, so the live test correctly failed one case. Remaining issue: clearer clinical-boundary wording and intermittent provider latency/failures; did not weaken validation to turn it green.
- Verification: final build and typecheck passed; 18 hospital checks passed and exercised all 15 preview tools (including six scenarios, actual persisted writes and idempotent retry); all 11 source-isolation checks passed with controlled Epic HTTP contracts. No live Epic write/read authorization, deployment or full end-to-end physical audio success is claimed. No synthetic test changes touched the original configured database.

## 23 October 2026 - Lazy clinical retrieval and live conversation reliability fix
- Re-read repository skill, important.md, AGENTS and project context. Confirmed that identified-nurse requests eagerly refreshed the synthetic hospital and prefetched task/patient MCP context even for general conversation; agentVersion additionally queried clinical records before intent. Also confirmed that the validator mistook natural clinical refusals (for example, recommending treatment is a clinical decision for the care team) for advice, and repair feedback incorrectly demanded fact IDs for general replies.
- Added optional lightweight VoiceService.agentContext without directory lookup. Voice model starts with durable dialogue/session references and revision only, with no prefetched patient/task bundle. General conversation skips clinical fingerprinting and hospital refresh. Source version checks become active when a record operation or explicit context read occurs; legacy durable semantic checkpoints remain supported. Ordinary UI display reads still return nurse-scoped records and session/checkpoint persistence still uses SQLite; this is not a claim of zero SQL access for chat.
- Added validated task_name/patient_name intent fields. Backend resolves exact task titles, patient names or room references within the existing nurse's visible records, rejects absent/ambiguous references and retains selected IDs for follow-ups. This keeps ordinary reads/introduction-plus-question in a single inference without exposing the dataset in advance. No keyword-based general/workflow router or additional LLM classifier was added.
- Deferred hospital refresh to validated workflow selection. Human confirmation retains pre-write refresh/version revalidation; explicit refresh and free local mock paths remain supported. Task record SQL now retrieves only current assigned/handoff-candidate IDs instead of loading every task in the source realm.
- Moved clinical-advice checks ahead of broad friendly-language exceptions; added safe complete refusal/referral forms. For a model-selected REFUSAL whose wording triggers the clinical-advice guard, replace the model text with the enforced clinical boundary (no treatment/order recommendations), rather than paying for another rewrite. Independent unsourced-record checks still fail fabricated patient claims. General explanations/math are no longer rejected just for an arbitrary number or nonclinical subject. Source-backed clinical facts retain exact evidence/uncertainty checks. General-reply repair feedback no longer asks for nonexistent fact IDs.
- Capped single-pass model output at 512 tokens (or a lower configured maximum); preserved the configured Sonnet model, Bedrock SDK pooling, existing MCP transport, security controls, idempotent receipts/checkpoints, microphone and playback code.
- Expanded regression coverage: no clinical fingerprint/context prefetch for general dialogue, safe natural refusals, enforced clinical refusal without another inference, clinical advice hidden behind friendly prefixes, patient age/observation fabrication, general MCP explanation/math. Updated the fake provider's handoff behavior to select the operation directly under the lazy-context contract while preserving explicit context-read tests. All 210 isolated regression checks passed. Typecheck and production build passed.
- Live diagnosis used synthetic rejected refusal text only; initial intermediate runs still failed refusal validation and were not counted as passes. Final full 21-question live Bedrock -> Streamable HTTP MCP -> isolated SQLite run PASSED. Included greetings before/after identity, MCP explanation, combined introduction, status filters, allergies and missing allergy data, missing patient, safe clinical refusal, Reema handoff, cancel/confirm, persisted status and Jordan self-assignment. Assertions confirmed no HOSPITAL_REFRESH receipts for general conversation/refusal. Most model-backed turns were ~1.3-2.3 seconds; initial greeting 4.4 seconds; confirm/cancel 28-99 ms. This does not guarantee cloud latency or physical voice timing.
- Also passed 18 hospital checks (all 15 preview tools/scenarios), 11 source-isolation checks and compiled runtime/provisioning/independent-MCP checks. No configured application database was mutated by tests; no new live Epic authorization/write check or deployment was performed. Updated PREVIEW_TEST_GUIDE.md to replace the earlier unresolved refusal limitation with verified results and remaining external-service limits.
- Final safety follow-up retained broad guards against unsourced person assertions (including HIV, diabetes and family details) while permitting nonclinical protocol definitions and arithmetic. Added six checks; final regression count is 216, all passed. Final build/typecheck passed again after that guard change.
- Browser regression initially failed its simulated-model call-count assertion because the fake model still demanded the old eager-context prefetch. Updated that test double to select TASKS directly and assert no read_voice_context message exists before intent. Rerun passed the full browser voice suite, including one-inference semantic workflow, barge-in, queued speech and cloud/browser fallback. Physical speech adapters remain simulated.

## 23 October 2026 - Voice logo control and on-demand keyboard
- Confirmed JSON fixture files are deployment assets used for explicit provisioning; the configured SQLite database remains the operational preview source. No dataset/schema/database changes were made for this UI task. Persistent hosted DB must not be overwritten with a developer database.
- Replaced the visible Start microphone text button with an SVG voice-wave logo, keeping its accessible Start/Stop/Interrupt labels, lower-center position and original callbacks. Added distinct listening, detected-speech, processing and assistant-speaking visuals, with reduced-motion support.
- Added hearing state derived only from existing speech-recognition events/results, reset on speech end, pause, submission and rejected echo. No additional microphone request, stream, analyser, audio processing, timing change or Bluetooth behavior change was introduced. Animation indicates detected speech, not measured microphone amplitude.
- Added adjacent keyboard icon with accessible expanded/controls state. Typing bar and Send are hidden initially, open and focus on keyboard click, preserve drafts while hidden, and close on Escape. Existing tester examples reveal the input for editing without auto-send.
- Verification: build and typecheck passed; preview browser checks passed hidden/default typing, toggle, preserved drafts, example opening and no auto-send; full voice-browser regression passed including speech-triggered logo animation, centered microphone, permission recovery, transcript/MCP/playback, interruption, queued speech and fallback. Inspected 1536x864 screenshot and captured laptop layout. Tests used isolated databases and simulated recognition/playback; no physical audio-quality or cloud deployment claim.

## 23 October 2026 - Open welcome layout and workflow entrance animation
- Read the required repository skill, important.md, AGENTS/project context and the supplied opening-layout HTML as visual reference only. Preserved the existing background, local fonts, brand mark, voice logo, keyboard icon, button appearance/actions and microphone behavior; no reference-page scripts or static workflow data were imported.
- The synthetic preview guide now starts centered, wide and transparent without its enclosing sidebar box. Existing question buttons use two columns; the first two categories are open and all other categories/questions remain available via their existing disclosure controls and scrolling. No questions were removed or auto-executed. Introductory copy is shorter; idle answer now reads Your shift, a little clearer.
- Guide positioning/width/background transition to the existing right sidebar only when the backend display contains a selected nurse. The actual saved workflow fades in after the guide clears the center and its main timeline draws in; context card entrance is staggered. Reduced-motion settings disable motion. Existing data controls the timeline; no guessed-name or fake successful-workflow animation trigger was added.
- During identity/end-session transitions the UI clears prior nurse records while retaining the source shell, so the same guide DOM element survives and can animate rather than disappearing/remounting. Backend receipts, authentication, source isolation, database data and APIs were unchanged.
- Adjusted preview context-card/answer vertical bounds to reserve distinct space for context, transcript and the unchanged lower-center voice control. Existing overflow scrolling preserves long response access. Welcome category spacing was refined after screenshot inspection so category headings are not cut midway at laptop size.
- Verification: production build, root typecheck and git diff --check passed. Extended isolated headless preview checks passed centered transparent welcome, open categories/all examples retained, stable guide DOM across I-am identification, rightward transition, exact unchanged brand/voice SVG markup, keyboard/draft/example behavior, no context/transcript/control overlap and reduced motion. Captured and visually inspected opening/workflow desktop/laptop screenshots (1536x864, 1280x720). Initial test-only implicit callback types were corrected before final typecheck passed.
- Full headless voice regression passed after updating its expected idle copy: microphone permission recovery, speech-to-MCP-to-playback, follow-ups, safe updates, fresh session behavior, barge-in, queued speech, one-inference semantic workflow and audio fallback. Tests used isolated databases and simulated speech adapters; no cloud deployment or physical speech-quality claim.

## 23 October 2026 - Themed scrollbars and Jordan discrepancy conversation
- Applied repository hackathon skill/context. Scoped dark color-scheme and thin indigo scrollbars to the existing voice canvas; preserved logos, buttons, background, microphone behavior and staff workspace. Headless preview assertions verified computed scrollbar colors and dark scheme; opening laptop screenshot inspected.
- Traced repeated task responses to current-turn intent confusion and a legacy conversational fallback intercepting validated semantic commands. Validated operations now bypass that fallback. Added scoped receiving-nurse and discrepancy-guidance details to the existing voice intent schema, with Bedrock instructions for contextually clear transcription variants. Receiver answers use actual outgoing handoffs; absent or ambiguous records produce honest clarification, never a directory guess.
- Discrepancy guidance explains conflicting stored values and asks for the human-verified status and what was checked. Preserves unfinished review through guidance and ordinary conversation. Fixed canonical generated commands accidentally being considered human review notes; status-only restatements cannot supply a note. Note follow-ups preserve exact human wording, and writes still require explicit confirmation, source revalidation and existing idempotent checkpoints.
- Extended deterministic tests for missing receiver, grounded review guidance, no pre-confirmation writes, status-only note rejection and pending-state preservation. Added opt-in live --jordan-review replay and documented it in PREVIEW_TEST_GUIDE.md. No new dataset, source, endpoint or configured application database mutation.
- Verification: final production build and root typecheck passed; all 220 isolated regression checks, 20 hospital MCP checks (all 15 preview tools), and 11 source-isolation checks passed. Preview browser layout/scrollbar checks passed. Final 13-question real Bedrock -> Streamable HTTP MCP -> temporary synthetic SQLite replay passed, including noisy Jordan introduction, incoming nurse, discrepancy guidance, separate status/note and confirmed persisted resolution. Most workflow model turns were approximately 1.5-2.2 seconds, introduction 4.8 seconds; confirmation 36ms. These measurements are not latency guarantees.
- Intermediate live runs exposed the repaired defects and one upstream timeout/reset; those runs failed and are not presented as passes. No new live Epic authorization, physical microphone quality or deployment is claimed. Task cards are SQLite-backed; workflow speech still uses controlled dynamic templates while Bedrock interprets intent. Do not describe every response as unconstrained LLM wording.
- Final headless voice-browser regression also passed: transcript/HTTP/MCP/stored-data/playback loop, short pauses, safe updates, backend failure/retry, barge-in, queued follow-up, one-inference semantic request and audio fallback. Recognition/playback were simulated. git diff --check passed.

## 23 October 2026 - Android microphone ownership fix
- Applied repository guidelines; inspected the reported Android Listening/no-transcript message against the hook. Confirmed a persistent getUserMedia capture preceded recognition.start(track). The owner's Google speech-service warning and Chromium's documented rejection of forwarded Android audio identify a competing microphone/unsupported forwarding path; physical device telemetry was not available.
- Android now lets native speech recognition own the microphone directly from the tap, without a parallel capture stream or forwarded track. Desktop capture, interruption/echo handling, controls and backend request/confirmation/retry semantics remain unchanged. No backend, dataset, staff workspace, cloud service or mobile layout change.
- Extended the existing isolated browser regression with Android user-agent/viewport and a speech adapter that rejects competing capture or supplied tracks. Covers interim transcription, HTTP/MCP response/playback, engine restart, permission recovery and zero extra capture requests. These simulate Android constraints; actual Android/Brave support is not established by desktop emulation.
- Production build, root typecheck and full voice-browser regression passed, including the added Android ownership/transcript/MCP/playback/restart/permission cases and existing desktop interruption, queued speech, mutation confirmation and error/fallback checks. Tests used a temporary database and simulated speech adapters, with no paid calls. Deployment remains owner-managed and has not been performed; physical Android capture must be checked after the updated release is installed.
