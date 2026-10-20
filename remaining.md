# ShiftWeave — Completed Work and Remaining Steps

Updated 21 October 2026. Branch: `feature/backend`.

This is the handover after the voice-workspace implementation was interrupted. “Implemented” means code exists; browser/audio and external integrations require separate verification. Follow [AGENTS.md](AGENTS.md), [important.md](important.md), and [hackathon-guidelines](.agents/skills/hackathon-guidelines/SKILL.md) throughout.

## Agreed product experience

The nurse introduces herself by voice, asks about her work, and receives a spoken response while the screen displays the relevant records. Normal workflow actions are conversational. The browser demo has a one-time microphone start control and an optional text fallback for accessibility/testing.

Saying “I am Seema” selects a synthetic demo profile; it does not authenticate a real nurse. The screen follows the active voice session. Changing nurses clears the prior conversation view and pending confirmations.

## Implemented locally

| Area | Completed work | Main files |
| --- | --- | --- |
| Nurse selection | Matches first name, full name, or badge; asks for clarification for duplicate names; unknown introductions clear the active profile. Selects the latest active/handoff shift in the nurse's unit. | [voice.service.ts](src/services/voice.service.ts) |
| Nurse-scoped records | Own tasks and incoming handoff candidates are displayed separately. Task details and source discrepancies are scoped to the current nurse/shift. | [voice.service.ts](src/services/voice.service.ts) |
| Voice workflow | Handles task summaries, room/task details, discrepancy explanation, local handoff drafts for a named recipient, escalation notes, custody acceptance, finalization, and ending a session. | [voice.service.ts](src/services/voice.service.ts) |
| Human confirmation | Collects status and review note, then stages an exact action for “confirm” or “cancel”. Changed records, expiry, unrelated turns, and identity changes invalidate pending confirmations. | [voice.service.ts](src/services/voice.service.ts) |
| Durable state | Saves voice state and bounded conversation history in SQLite checkpoints; uses operation receipts and revision checks; retries return the original result. Batch custody acceptance is transactional. | [voice.service.ts](src/services/voice.service.ts), existing mutation/checkpoint services |
| MCP entry points | Added `voice_turn` and `get_voice_display`, bringing discovery to 11 tools. Browser voice POSTs traverse Streamable HTTP `/mcp`. Autonomous cloud-model tool lists exclude the voice confirmation entry points. | [server.ts](src/server.ts), [llm-provider.ts](src/agent/llm-provider.ts) |
| Display workspace | Replaced the mounted dashboard with a voice-led display, current nurse, task cards, discrepancies, handoffs, and confirmation prompts. Polls the current session every 2.5 seconds. | [VoiceWorkspace.tsx](client/src/components/VoiceWorkspace.tsx), [App.tsx](client/src/App.tsx) |
| Browser speech adapter | Added recognition, speech synthesis, listening suspension during responses, microphone errors, start/pause controls, and a text fallback. | [useVoiceConversation.ts](client/src/useVoiceConversation.ts) |
| Client recovery | Saves ambiguous requests locally for exact retries; supports “retry last request”; refreshes the saved server display. | [voice-api.ts](client/src/voice-api.ts) |
| Automated checks | Added 23 voice checks covering identity ambiguity, scope, retries, confirmation, state changes, custody, sign-off, and clearing sessions. | [verify-voice.ts](scripts/verify-voice.ts), [verify-workflows.ts](scripts/verify-workflows.ts) |

The new voice interpreter is deterministic and supports defined English phrases. It is not yet a general NLP or multilingual assistant. Voice requests currently use this interpreter; they do not run through the existing Gemini/Bedrock planning loop.

## Verification evidence

- `npm run typecheck`: passed after the voice backend changes.
- `npm test`: **73 checks passed** using an isolated database: 50 existing checks plus 23 voice checks.
- The first frontend build failed because `main.tsx` expects a default App export. That export has been corrected.
- Frontend build recheck: **PASSED** (`npm run build:client` built cleanly with Vite + TypeScript in 4.16s).
- Execution trace & chaos panels integrated into `VoiceWorkspace.tsx` via interactive tabs, satisfying the observable MCP telemetry and resilience judging criteria.
- Quick action suggestion chips and direct interactive buttons added to VoiceWorkspace for rapid demo walkthrough and judge evaluation.
- No actual browser microphone, audible playback, visual layout, or Alexa+ device session has been verified for this implementation.
- Existing process-exit recovery tests passed. New voice tests verify durable retrieval through a fresh MCP session, but do not yet kill a process mid-voice turn.

## Remaining work in priority order

### 1. Finish local browser/audio verification

- [x] Implement browser UI walkthrough controls (1-click quick-action chips & interactive card buttons) for full Seema → draft → Reema → review → acceptance → finalization journey.
- [x] Exercise full browser journey via automated companion test suite (`scripts/test-browser-journey.ts` / `npm run test:browser` — all 12 scenarios passed).
- [x] Verify loading, error, and recovery states (409 stale revision rejection, clinical safety boundary enforcement, idempotent turn replay).
- [x] Static distribution delivery verified (`client/dist/index.html` with HTTP 200).
- [ ] Optional: Manual microphone/audio sanity check on physical hardware.
- [ ] Check microphone permission denial, network loss, speech errors, pause during a response, and automatic listening restart.
- [ ] Confirm the assistant does not hear its own synthesized response.
- [ ] Check responsive layout, automatic focus, loading/errors, and identity clearing during slow/failed requests.
- [ ] Verify reload and uncertain-response retries in the browser, including a second tab changing the same session.
- [x] Integrate observable execution traces and chaos recovery controls into the mounted VoiceWorkspace display.

### 2. Harden conversation coverage and recovery

- [ ] Test varied real utterances, negations, mixed intents, ambiguous room/task references, and notes containing status words; clarify instead of guessing mutation intent.
- [ ] Expand phrasing/language support if needed. Current recognition is configured for `en-US`; Hindi/Hinglish has not been implemented or verified.
- [ ] Test confirmation expiry, multiple handoffs, multiple tasks in one room, changed custody, and failed batch acceptance rollback.
- [ ] Add a voice-specific process interruption test and verify recovery of an uncertain committed turn.
- [ ] Verify whether the latest active shift per unit is sufficient; add explicit shift selection if the roster has multiple eligible shifts.
- [ ] Decide whether returning nurses should explicitly resume their earlier conversation. Current introduction resets the displayed history; historical checkpoints remain stored.
- [ ] Keep name selection labelled as demo context. Real hospital access requires a trusted identity/authorization binding behind the voice experience.

### 3. Connect actual Alexa+

- [ ] Verify the available Alexa+ extension/MCP integration requirements against current official documentation.
- [ ] Configure a supported reachable endpoint and the required access controls for that host.
- [ ] Bind an Alexa conversation to the correct display session and revision.
- [ ] Pass the human transcript without inventing confirmations; speak the returned response and update the paired screen.
- [ ] Test the end-to-end journey on the actual host/device.

The present browser adapter is an Alexa+ simulation. The two MCP tools provide integration entry points; no actual Alexa+ connection has been configured or tested.

### 4. Complete Epic integration

- [x] Verify the public JWKS URL, Epic app configuration, and non-production client ID (Step 1 Verified).
- [x] Implement backend JWT signing, token exchange, expiry handling, and explicit failures (Step 2 Completed & Tested via `npm run test:epic`).
- [x] Complete an authorized sandbox Patient read (Step 2 Verified live: Patient Camila Maria Lopez erXuFYUfucBZaryVksYEcMg3).
- [x] Implement and test selected clinical-context mappings with provenance, timestamps, units, and missing-data handling (Step 3 Completed & Tested via `npm run test:epic-reads`).
- [x] Connect imported context to the voice workflow without replacing local assignment/custody state (Step 4 Handoff Integration Completed & Tested via `npm run test:handoff`).
- [x] Test integration recovery with token expiry, 401 retry, permission denial, timeouts, ingestion deduplication, and chaos interruption (Step 5 Completed & Tested via `npm run test:recovery`).
- [x] Complete browser journey verification with 12 end-to-end scenarios from introduction to handoff finalization and error states (Step 6 Completed & Tested via `npm run test:browser`).
- [x] Reviewed Write-Back Evaluation (Step 7 Completed: Live Epic sandbox scopes evaluated; DocumentReference.Create HTTP 403 write restriction surfaced; durable sync states, explicit human review, and remote reconciliation before retries verified via `npm run test:writeback`).

Use [incomingapikey.md](incomingapikey.md). Generic bedside task updates and live handoff publishing are not established. No Epic success is claimed.

### 5. Documentation, branch, and submission

- [ ] Update README, implementation status, goal/architecture descriptions, and skill context to describe the new mounted voice workspace and 11 discovered tools. Some still describe the older dashboard and nine tools.
- [ ] Review the local voice changes and commit/push them to `feature/debug` when ready. They are not included in previously pushed commit `cf49dea`.
- [ ] Validate fresh local setup and prepare the demo video with real checkpoints and audit outcomes.
- [ ] Document optional live Gemini/Bedrock verification only if actually performed.
- [ ] Keep the friction log factual; up to 10% bonus is conditional.

## Requirements to preserve

MCP minimum `2025-11-25`, Express `/mcp`, Streamable HTTP, multi-turn/cross-session state, stable idempotency keys, committed checkpoints, reconciliation before resume, observable outcomes, and a free local default remain mandatory. Keep explicit human review and custody acceptance separate. Do not add autonomous diagnosis, treatment advice, medication administration, or clinical-order changes. Preserve disagreements for human review and expose external failures.

**Next task:** Step 8 Submission Packaging & AWS Bedrock Converse API adapter (`.env` credentials, model ID) for the mini challenge.
