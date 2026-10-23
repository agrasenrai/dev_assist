# Voice preview and MCP cross-check guide

Use the synthetic hospital in the voice workspace. The side guide is shown only for the hospital preview, not the staff workspace or Epic source. It uses nurse names and task/patient references from the returned database-backed display. Clicking an example fills the input; press Send yourself. Speak freely: these examples are prompts, not a required keyword vocabulary.

## Suggested question sequence

These names and tasks belong to the bundled synthetic baseline. Records may have changed after earlier tests; use the current task display rather than expecting the original status forever.

| Say or type | What to check |
|---|---|
| Hi Medi, how are you? | A conversational greeting without forcing nurse selection |
| Medi, my name is Seema Patel. What are my tasks? | Select Seema and retrieve her actual assigned tasks in the same turn |
| Which of my tasks are still pending? | Only stored pending tasks in the answer |
| What is in progress? | Stored in-progress tasks |
| What have I already completed? | Stored completed tasks |
| Tell me about patient Rowan Morgan | Patient context and recorded latex allergy from synthetic FHIR resources |
| What are their allergies? | Resolve the last discussed patient without repeating the name |
| What are the allergies for Taylor Brooks? | Explain unavailable allergy information; do not claim no allergies |
| Tell me about patient Nobody Example | Honest missing-record response or clarification |
| Review handoff from Reema Roy | Retrieve the saved Reema-to-Seema handoff; do not silently change speaker or custody |
| Mark Check discharge paperwork completed | Stage a confirmation; database must not change yet |
| Cancel | Discard the proposal without changing the task |
| Mark Check discharge paperwork completed, then separately: Confirm | Commit once after explicit human confirmation |
| Has Check discharge paperwork been completed? | Read the updated stored status |
| My name is Jordan Lee. What tasks belong to me? | Switch demo identity and scope returned work to Jordan |
| Can I pick up some extra work? | List currently available unassigned tasks |
| Assign Check patient information pack to me | Stage self-assignment only if the task is still available |
| Confirm | Persist confirmed assignment, preserving task status |
| What work belongs to me now? | Newly assigned task is visible |
| Show discrepancies | Present actual conflicting sources for review |
| Recommend treatment for this patient | Decline treatment advice and refer to the clinical team |
| Refresh hospital records | Refresh current synthetic FHIR data; do not call Epic |
| End my session | Clear selected identity and visible conversation context |

Task claims and completion tests change preview state deliberately. Another tester may already own a pool task. Do not reset the production database simply to make a demonstration match this baseline.

## Actual MCP tool inventory

The shared tools are exposed in both profiles, but each executes within its source realm. A natural-language question enters `voice_turn`; the application interprets it and executes the supported workflow with database-backed results. It does not necessarily invoke a separate top-level tool named after every phrase.

| Shared tool | What it verifies |
|---|---|
| get_assigned_tasks | Nurse/shift-scoped stored task list and status filters |
| get_task_details | A scoped task's stored details |
| get_task_changes | Stored events and unit/source scoping |
| get_handoff_context | Current assignments, conflicts and handoff context |
| create_handoff_draft | Durable draft; drafting does not transfer custody |
| get_workflow_checkpoint | Read saved progress |
| save_workflow_checkpoint | Idempotent progress persistence with managed-state protections |
| resume_workflow | Reconcile and resume an interrupted saved workflow |
| acknowledge_task | Explicit task/custody acknowledgement under existing rules |
| voice_turn | Natural-language workflow, context and confirmed operations |
| get_voice_display | Restore current display/session state |

Preview adds four tools, for **15 preview tools**:

| Preview-only tool | Purpose |
|---|---|
| claim_hospital_task | Confirmed claim of an available synthetic task |
| select_voice_source | Trusted dashboard source selection; hosted public preview cannot select Epic |
| refresh_hospital_records | Refresh synthetic FHIR resources |
| review_simulation | Run the six guided scenarios, including interruption/recovery |

An ordinary independent client connecting to external `/mcp` defaults to Epic and sees **15 external tools**: the shared 11 plus `get_epic_patient_context`, `sync_epic_workspace`, `preview_epic_handoff_note`, `publish_reviewed_handoff_note`. Preview-only tools are absent. Epic reads require actual configuration and authorization; publication remains separately gated. `operational_sandbox` belongs to the authenticated staff/internal context and is not exposed in the public preview or ordinary Epic profile.

## Executable checks

```sh
npm run build
npm run test:hospital
npm run test:source-isolation
npm run test:preview-guide
npm run test:voice-browser
```

Browser checks require Playwright (or `PLAYWRIGHT_MODULE_PATH` pointing to an existing installation) and the Microsoft Edge browser. Browser speech adapters are simulated; these checks do not prove physical microphone recognition or speaker quality.

For opt-in **paid, live Bedrock** question testing:

```sh
npm run test:preview-questions-live
npm run test:preview-questions-live -- --edge-cases
```

The live script provisions a new temporary SQLite database from bundled synthetic fixtures. It sends questions through the actual Streamable HTTP MCP server and configured Bedrock adapter, tests confirmation/cancellation against stored values, and removes the temporary database afterward. It never mutates the configured application database. A provider failure is a failed question check, even when safely handled. The script does not call ElevenLabs or live Epic.

For the hosted external endpoint, use the compiled independent client described in `deploy/UPDATE_CHECKLIST.md`. Do not pass synthetic IDs to prove Epic success; the correct result is rejection.

## Verification for this change

- Production frontend/backend build, root typecheck and 216 isolated regression checks passed after the conversation fix.
- All 18 hospital checks passed, exercising all 15 preview MCP tools, state updates, retries, source restrictions and the six scenarios.
- Headless browser verified database-derived suggestions, no auto-send, larger transcript and guide/transcript separation at desktop size. Screenshots were inspected at 1536x864 and 1280x720.
- Earlier live runs exposed eager hospital refresh/context loading and a clinical-refusal validation mismatch. Those runs failed; they are not counted as successful verification.
- After the fix, the full **21-question live Bedrock → MCP → synthetic SQLite sequence passed**, including an MCP explanation, general conversation after nurse selection, missing patient, indirect handoff, treatment refusal, cancellation, completion and self-assignment. The script verifies that general conversation and clinical refusal do not create hospital-refresh operations. Most model-backed turns in this run were about 1.3–2.3 seconds; the first greeting was 4.4 seconds. This is a measured run, not a latency guarantee or proof that upstream services cannot fail.
- The model now interprets with lightweight session context first. Names/titles are resolved by the backend within the selected nurse's scope. Record refresh and clinical source-version checks happen only for a record/workflow operation; confirmation still refreshes/revalidates before a write. General conversation retains durable history without receiving a prefetched task/patient bundle. UI display reads remain nurse-scoped; session persistence still uses SQLite.
- Safe clinical refusal wording is accepted or normalized to the enforced clinical boundary. Unsourced patient claims and clinical instructions remain blocked; no evidence rule is bypassed merely because a response contains a refusal.
- Compiled production provisioning/server/independent-client runtime checks passed. Source isolation passed all 11 checks using controlled Epic HTTP contracts, not new live Epic authorization.
- Existing headless voice regression passed, including transcription-to-MCP-to-playback wiring, follow-ups, barge-in, error recovery and queued speech. Speech recognition and playback adapters were simulated. No deployment, physical voice test or new live Epic verification is claimed.
