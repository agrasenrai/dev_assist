# Epic sandbox workflow

Verified on 21 October 2026 using the existing non-production backend credentials. No new API secret was needed. Tokens, passphrases and private keys remain server-side and are not included in evidence files.

## Current evidence

- Live JWT OAuth and matching public JWKS: passed.
- Patient: read successfully. Search returned 10 Encounters, 7 Conditions, 1 AllergyIntolerance and 1 MedicationRequest.
- MedicationAdministration and DocumentReference searches returned warnings indicating no results. These are zero clinical records, not completed administrations or a negative history.
- MCP `2025-11-25` workflow: live sync → voice display → sourced draft → explicit incoming custody → local finalization → refresh preserving custody: passed in an isolated database.
- Practitioner references were supplied by Epic Encounter participants; direct Practitioner.Read returned HTTP 403. These references do not authenticate Seema/Reema.
- Human-approved Clinical Notes creation: HTTP 403. No note identifier or success is claimed. See `deploy/epic-write-report.json`.

Evidence: `deploy/epic-live-report.json`, `deploy/epic-workflow-live-report.json`, and the exact attempted note in `deploy/epic-note-preview.md`. These are dated observations, not ongoing availability guarantees.

## Run the connected workspace

The local `.env` now selects a fresh Epic demo database after the owner approved replacing the selected workspace. The previous database and pre-migration backups were retained: they report corruption in checkpoint/audit/receipt records. Previous handoff history was not silently imported into the new workspace. New database integrity and foreign keys passed verification.

```sh
npm run build
npm start
```

Open the app at the configured port (3000 by default):

1. Introduce yourself as Seema (simulated nurse profile).
2. Select **Sync Epic patients**. Inspect source status/counts and the local review task.
3. Say **Prepare my handoff for Reema**.
4. Say **I am Reema**, then **Accept all handoff tasks**, then **Confirm**.
5. Say **Finalize handoff**, then **Confirm**.
6. Select **Preview note for review**. Live publication remains disabled until Epic authorization is verified.

Source snapshots/history, workflow receipts, checkpoints and local custody live in SQLite. Epic remains the source for retrieved clinical records. Orders are never converted into administered medications; no order updates are sent. The UI displays source errors instead of substituting mock results.

## Setup on another machine

Configure the Epic placeholders in `.env.example`, securely install the matching signing key, and seed the local application using the normal setup guide. The following command deliberately creates a separate Epic demo database and selects it only after a successful sync and database integrity check:

```sh
npx tsx scripts/connect-epic.ts --fresh
```

For an existing healthy workspace, `npm run epic:connect` backs up SQLite and syncs the configured nurse/shift. It does not erase old tasks. Do not publish a mixed-patient handoff into one patient chart; publication rejects it.

## Finish Epic write authorization

In the Epic backend app registration, verify **DocumentReference.Create (Clinical Notes) (R4)** and **Practitioner.Read (Organizational Directory) (R4)** are selected and enabled for the non-production client. Save the sandbox-ready registration and allow any activation delay specified by Epic. A 403 can also reflect endpoint or environment restrictions; do not infer its precise cause from status alone.

The approved note binds patient `erXuFYUfucBZaryVksYEcMg3`, encounter `ej567ARSFdaF4ooZVunIlIg3`, and encounter participant `Practitioner/elpRiy0AYgjhdjAhTBJ3Aiw3`. The publisher re-reads Encounter and validates these links before POST. Selection prefers the latest returned open encounter without an end timestamp; optional `EPIC_NOTE_ENCOUNTER_ID` and `EPIC_NOTE_AUTHOR_REFERENCE` can pin an eligible reviewed choice.

Only after the access change is confirmed, resubmit the previously approved unchanged note with a new explicit attempt label. The publisher requires its exact review hash. A new key may retry a definitive rejection; PENDING/UNCERTAIN/SYNCED cannot be resent automatically. A transport timeout or unidentifiable success is UNCERTAIN, requiring remote verification. The UI never treats local finalization as an Epic write.

The service is a synthetic sandbox demonstration. Production nurse authentication, institution-approved author mapping, approved note types and production access are separate requirements.

## Verification commands

```sh
npm run typecheck
npm run build
npm test
npm run test:deployment
npm run test:epic-workflow
npm run test:epic-live
```

The first workflow suite makes no external calls. The live suite reads Epic and exercises the local handoff through HTTP MCP; it never creates an external note. `scripts/publish-approved-epic-note.ts` is the separate, explicitly approved write probe.

## Hosting and latency

Keep the recommended single Express process with SQLite on a persistent local disk (EBS on an EC2 host), Caddy HTTPS and optional Bedrock. Existing transactions/joins/receipts depend on SQLite; substituting DynamoDB would require a persistence redesign. Local mock execution remains free. Cloud hosting and model calls may cost money.

Identity, display, custody confirmation and finalization use deterministic local state. Epic reads run in parallel by resource section and use cached OAuth with a single token exchange in flight. LLM planning is optional and read-only; it does not decide clinical changes. Actual tool and turn timings are traceable, but token TTFT and superior reasoning accuracy have not been benchmarked. See `deploy/ARCHITECTURE.md` for deployment tradeoffs.
