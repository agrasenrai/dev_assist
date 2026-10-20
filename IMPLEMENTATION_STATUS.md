# ShiftWeave implementation status

Updated 20 October 2026. This is the current behavior/limitations record; historical completion claims in other documents must be read alongside it.

## Implemented corrections

- Correct dashboard SQL columns and carried-forward assignment visibility.
- Map audit payloads to frontend fields; display API failures instead of empty-success fallbacks.
- Persist conversation history, pending tool intent, tool results, stable retry keys and workflow completion in SQLite checkpoints.
- Store operation receipts in the additive `operation_receipts` table; reject key reuse with a changed request.
- Restore interrupted state in a fresh process. Reconcile current local records and refresh stale read results.
- Return the original completed chat result for an identical HTTP retry.
- Generate deterministic summaries and draft content from actual retrieved/local records.
- Use native Gemini function messages and Bedrock matching tool-use/result IDs. Cloud errors do not silently select mock mode.
- Keep human escalation, conflict resolution, custody acceptance and final sign-off separate. A draft alone never transfers custody.
- Require explicit conflict provenance in incoming fixtures; ingestion no longer invents source disagreements.
- Deduplicate identical JSON ingestion. Keep default execution local and free.
- Use temporary databases for all verification entrypoints.

## Runtime contracts

The original 11 domain tables remain. Additive operation receipts record `idempotency_key`, `operation`, `request_json`, `response_json`, and `created_at`.

`/api/chat` requires a nonempty utterance and `idempotency_key`; clients retain `workflowRunId`. Checkpoints contain messages, context, request identity, pending tool, source version and final speech. Completed responses have durable receipts.

Human conflict resolution requires `resolvedBy`, `finalStatus`, `resolutionNote`, `idempotency_key`, and `human_confirmed: true`.

`acknowledge_task` requires explicit human confirmation; `ACCEPT_HANDOFF` also requires `handoff_id`. Conflict resolution uses the review endpoint with a final status. Finalization uses `POST /api/handoffs/:id/finalize` after custody acceptance and discrepancy review.

The dashboard trace polls audit records; it is not a push telemetry stream. Chaos controls inject an exception and report an actual checkpoint. Process-exit recovery is exercised separately by a worker test.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build:client`. The isolated suite checks actual protocol/API responses, repeat-request behavior, source changes, human state transitions, adapter message formats, and fresh-process recovery after a committed draft loses its response.

Local tests do not verify live AWS/Gemini calls, Epic compatibility, production authorization, browser microphone availability, or arbitrary distributed failure conditions. No universal zero-loss or latency guarantee is claimed.

## Remaining integration work

- Configure an authorized target Epic environment, OAuth access and patient/encounter/roster mappings. Validate each selected API against actual enabled permissions and returned data.
- Implement verified hospital task mappings. Episode Checklist and Community Resource Task APIs are not interchangeable generic bedside task APIs.
- Implement a reviewed clinical-note publishing workflow with explicit external sync state and remote reconciliation before retries. No live write-back is currently enabled.
- Add production nurse authentication/authorization before any real clinical deployment.
- Expand the synthetic fixture only when needed; currently two patients/two tasks.
- Verify optional models with authorized credentials; local tests cover native message construction and explicit configuration failures.
- Record the submission demo and confirm submission assets. A friction log may earn up to 10%; no award is guaranteed.

See `incomingapikey.md` for the corrected API-selection guidance and `AGENTS.md` for mandatory project constraints.

## Completed Epic integration milestones

- **Step 1: Epic Registration & Public JWKS Publishing (Completed 20 October 2026)**:
  - Generated RSA-2048 key pair with RS384 algorithm and unique kid.
  - Public JWKS set verified live at `https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json`.
  - Registered Backend Systems application on Epic on FHIR (`fhir.epic.com`).
  - Obtained Non-Production Client ID: `ccc8c11f-4af0-4caf-b981-848012aab1a2`.
  - Application settings: Application Audience: Backend Systems (Backend), Use Case: General, SMART on FHIR Version: R4, SMART Scope Version: SMART v2 configured, FHIR ID Generation Scheme: Use Unconstrained FHIR IDs.
  - Private key secured locally at `./keys/private_key.pem`.
  - Live data retrieval, token exchange, and write-back remain pending implementation in Steps 2 & 3.

