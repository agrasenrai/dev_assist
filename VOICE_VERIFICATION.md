# Existing voice workflow verification

The voice path remains browser recognition → `/api/voice` → Streamable HTTP MCP `voice_turn` → existing services/SQLite → saved response → browser speech synthesis → listening. No login flow, external integration, or dataset was added for this work.

Voice queries now read stored patient information, available Epic snapshots with retrieval time and failure notices, current shift notes, task details, status filters, and room-scoped task lists. Patient and task references survive through saved voice checkpoints. Missing or ambiguous references require clarification. Local task status changes require a spoken status and confirmation, use the existing update services, and are visible in subsequent reads. Pending confirmations are rejected when source records change. Direct automatic assignment remains unsupported by voice; the existing reviewed handoff path is available.

Speech handling ignores obsolete recognition events, permits pausing during backend processing, suppresses late playback after pause, and returns to listening after speech completion or playback failure. Voice audit entries omit transcript and patient display payloads. Existing staff session ownership and task authorization remain enforced.

## Automated verification

Bedrock now interprets ordinary voice requests, including patient/task questions and indirect follow-ups, without an `Ask assistant` prefix. One shared voice history supplies conversational context. The model reads current scoped display records through MCP, then supplies a typed intent to the existing backend; it cannot execute a confirmation. The model composes record replies with source fact references; the backend inserts exact values and preserves missing-data/stale-source notices. Unsupported factual additions get one correction attempt and then an explicit failure with the authoritative backend result. Semantic tool intents/results, final replies and child-operation receipts are durable. Gemini has been removed; the explicit free mock mode remains available.

Live semantic verification passed on 22 October 2026 with `npx tsx scripts/verify-voice-conversation-live.ts --workflow`: natural nurse introduction, “What should I focus on today?”, a patient update without a patient keyword, a task-status paraphrase, “I’ve finished that one” staging only, explicit confirmation, persisted completion follow-up, a negated read-only request, and “I am confused” preserving nurse context. The test used an isolated database and existing synthetic fixtures, with Epic reads/writes disabled. Separate browser verification passed the simulated speech → semantic adapter → MCP → response playback → listening path; the speech and Bedrock adapters are simulated in that browser check, while the live text-input check uses real Bedrock.

Final semantic regression: 131 backend checks passed, including a model-misclassified negated draft, source changes during generation, invalid model tools, review notes containing status words, wake-only preservation of pending confirmation, and recovery without repeated model/tool calls. The 46 existing access-control checks, deployment checks, typecheck and production build also passed. Gemini runtime code, dependency, active environment settings and obsolete live-check script were removed; historical references are not enabled providers.

On 22 October 2026, `npm test` passed 111 checks, including adapter-stubbed conversation/history, exact retries, explicit provider failure and rejection of unexpected model tool calls. `npx tsx scripts/verify-voice-conversation-live.ts` separately passed both reported conversational examples through MCP and the real configured AWS Bedrock model, including saved-response retries. These were text-input checks, not physical microphone tests. Typecheck and production build passed.

All mutating checks use temporary databases and the existing fixture importer or existing isolated test fixtures.

Conversational wording verification: 117 backend checks, 46 existing access-control checks, the Epic fixture workflow, typecheck, production build, and the simulated speech-browser journey passed after the voice reply changes. Introductions no longer recite tasks unless requested; ordinary task answers omit database metadata; focused patient questions retain missing-data and snapshot-age notices. Review notes accept natural follow-up answers without a required prefix, preserve an already selected status, and still require confirmation. Two live Bedrock turns passed with the revised conversational guidance. Physical microphone acoustics and audible playback remain unverified.

| Command | Coverage |
| --- | --- |
| `npm test` | MCP transport, durable recovery, voice reads, patient/room ambiguity, status filters, confirmations, persisted updates, exact retries, failed writes, handoffs, and clinical refusal |
| `npm run test:operations` | Existing staff access controls, source snapshots and shift notes, voice ownership, authorized status updates, receipt ownership and audit redaction |
| `npm run test:epic-workflow` | Epic adapter fixtures, source-based patient answers, partial/failed refreshes and retained stale snapshots |
| `npm run test:epic-live` | Read-only official Epic sandbox sync, patient voice answer, source-based draft and local custody workflow; external writes disabled |
| `npm run test:voice-browser` | Headless Edge with simulated recognition and synthesis events; real React UI, HTTP, MCP and SQLite; response playback, automatic listening, confirmed writes, backend failure/retry, recognition/playback errors and pause during processing |
| `npm run typecheck` / `npm run build` | Backend and client compilation and production bundle |

The browser test uses Playwright available on the machine. If it is outside this repository's module resolution path, set `PLAYWRIGHT_MODULE_PATH` to the installed Playwright package directory. `VOICE_TEST_BROWSER` defaults to `msedge` and can select another installed Playwright browser channel. Build the client before running the browser test.

## Verification limits

Browser recognition and synthesis are simulated in automated browser tests. Actual microphone acoustics, recognition-service availability, browser permission prompts, and audible speaker playback have not been verified. The full physical spoken-input-to-audible-output definition of done therefore remains unverified. A supported browser and microphone permission are required; browser recognition may depend on its vendor's service.

To finish the device check, open the existing voice workspace on localhost or HTTPS, enable voice, introduce the existing nurse, and speak a patient query, a task query, a task update followed by confirmation, and a follow-up status question. Verify the spoken answers and automatic return to listening. Pause during a request and verify that it does not play a late response. Use existing assigned patients and coordination tasks only.

Epic answers describe retrieved source records rather than guaranteed current bedside state. The live sandbox check returned encounters, conditions, an allergy and a medication order; it returned no medication administration or document records. Missing records remain explicit. Local task completion does not record medication administration or modify an Epic order.
