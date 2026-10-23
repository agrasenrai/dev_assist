# Standalone MCP and synthetic hospital dataset

Ordinary clients connecting to `/mcp` default to **Epic**, even when dashboard preview is enabled. Epic calls require configured credentials, permissions and patient mappings; failed calls never fall back to synthetic data. Generic nursing coordination records remain in the configured SQLite database and are filtered to Epic-linked patients. This is not generic Epic Task API support.

The dashboard defaults to the **synthetic hospital** when enabled. Its server-side bridge uses a private process-local capability to select preview; client names and untrusted source headers cannot select it. Both sources persist in the same configured SQLite database, with separate record scopes, voice sessions, retry keys, checkpoints and source fingerprints. This is application-level source isolation, not separate database encryption or tenant authentication. Existing service-token/staff controls remain required.

Synthetic clinical resources are stored as FHIR R4 JSON; tasks, assignments and handoffs use the existing tables. This embedded store is not a public FHIR server or an Epic environment. Public production preview cannot switch to Epic or restore a previously selected local Epic session. Authorized external Epic clients use `/mcp` independently of the dashboard.

## Prepare and run

Install dependencies with `npm ci`. Use a supported Node version with this project's native better-sqlite3 dependency. On Linux ARM64, install dependencies on that architecture rather than copying Windows node_modules.

Set `SQLITE_DB_PATH` to your existing database. `hospital:prepare` backs it up and adds synthetic records; it does not replace existing Epic/staff records. A fresh checkout without a configured path uses `data/shiftweave.db`. Fixtures are imported explicitly, never as an error fallback.

```sh
npm run hospital:prepare
npm run hospital:start
```

The start command enables the synthetic source for that process. For the existing `npm run dev` or production start command, configure:

```dotenv
SQLITE_DB_PATH=./data/shiftweave.db
HOSPITAL_SIMULATION_ENABLED=true
HOSPITAL_DATA_SOURCE=sqlite
SIMULATION_MODE=false
```

Keep your actual existing database path instead of copying the example path. Keep your configured Bedrock provider for flexible server-side intent understanding. A fresh local environment defaults to the free deterministic provider, whose language coverage is limited; the external MCP client's own LLM can also use structured tools. Neither mode fabricates clinical records. Existing production, MCP token and staff authorization requirements still apply. Do not disable staff authentication to use this demo in an authenticated staff deployment.

No frontend build is needed for MCP. Build the client with `npm run build:client` if you also want the dashboard. The default dashboard remains the voice workspace; `/?workspace=simulations` opens guided scenarios when the hospital source is enabled.

For a built runtime with development dependencies removed, the provisioning entry point is `node build/scripts/setup-hospital.js`, followed by the existing `npm start`. It requires an existing configured database. Preserve the populated database on persistent storage; the production start command never silently replaces an empty or missing dataset. Hosting is configured by the project owner separately.

## Tester connection

Use Streamable HTTP, minimum protocol `2025-11-25`, with your server's `/mcp` URL. Supply `Authorization: Bearer <MCP_AUTH_TOKEN>` when the server is configured with a service token. Never put this token in a public frontend bundle. A remote tester needs the URL and authorized credential, not a database copy, localhost tunnel into the developer's laptop, or dashboard session.

1. Initialize and discover tools using a standard MCP client.
2. Call `get_voice_display` with a new UUID `session_id`. It returns the current `revision` in Epic mode, without synthetic nurses or tasks. Use the configured Epic patient tools to fetch permitted records. Nurse workflows require actual local nurse/shift mappings linked to imported Epic patients.
3. Call `voice_turn` with that session, the question in `utterance`, the current `expected_revision`, and a new UUID `idempotency_key`.
4. Read the returned `speech`. Keep the same voice session UUID for follow-ups and use the returned revision.
5. Replay the exact same request and key after an uncertain response. Human confirmation must come from the person; do not generate it automatically.

The voice conversation UUID is separate from the MCP transport session ID. Reinitializing an expired MCP connection and reusing the voice UUID restores persisted conversation state. Separate people should use separate voice UUIDs.

Run the independent verifier against an already-running server:

```sh
npm run test:mcp-independent -- https://YOUR-DOMAIN/mcp
```

The URL above is a placeholder, not a deployed endpoint. The verifier uses the official SDK and imports no database, dashboard or server modules. Set `MCP_AUTH_TOKEN` in its environment if required. It performs read-only conversation checks, not task modifications.

## Dataset and demonstrations

Explicit fixtures live in `data/hospital/fhir-r4.json` and `data/hospital/workflow.json`. Initial records include three synthetic nurses (Seema Patel, Reema Roy, Jordan Lee), three patients, nine coordination tasks across different statuses, a sourced documentation conflict, two shift-scoped unassigned tasks, and an actual Reema-to-Seema draft handoff. This draft does not transfer responsibility. Six scenario definitions use the existing simulation engine. Updates are shared and persistent; starting a scenario does not reset its records.

Example questions after choosing Simulation hospital:

- “I am Seema Patel, what tasks are assigned to me?”
- “Tell me about Rowan Morgan.” Then: “What are their allergies?”
- “What tasks are still unfinished?”
- “I am Jordan Lee. What tasks are assigned to me?”
- “Show available tasks.” Then: “Assign Check patient information pack to me.” Review the proposal and explicitly confirm or cancel.
- “Where did Reema Roy leave off?” (Bedrock intent mode), or “Review handoff from Reema Roy.”
- “Mark Check discharge paperwork completed.” Review the proposed action, then explicitly confirm or cancel.
- “What is the status of Check discharge paperwork?”
- “What are Taylor Brooks' allergies?” Missing data must remain unknown.

One room can contain multiple tasks. Specify the task title when updating; clarification is correct behavior when the reference is ambiguous. Synthetic data is labeled and never represented as live Epic data. Switching sources clears identity, conversation and pending confirmations, while retaining durable workflow records.

## Verification

```sh
npm run test:hospital
npm run test:source-isolation
npm run typecheck
npm test
npm run build
```

Dataset tests provision and mutate a temporary database, use real SQLite and MCP HTTP calls, exercise all six scenarios, and run the independent SDK verifier. They never run mutation tests against the configured application database.

Optional external FHIR adapter checks use `npm run test:hospital -- --http` against a controlled HTTP contract server. `--live` targets `HOSPITAL_FHIR_BASE_URL` and explicitly uploads the namespaced synthetic fixture there; use only an authorized synthetic server. Those checks are distinct from validation against a real HAPI or Epic deployment.

The optional `HOSPITAL_DATA_SOURCE=fhir` adapter is preserved. It requires a configured FHIR R4 endpoint and never falls back to SQLite after connection failure. No external deployment is needed for the SQLite dataset path, and none is performed by the start/prepare commands.

## Tool and column coverage

`npm run test:hospital` now exercises every discovered MCP tool against isolated synthetic records. Workflow tools execute successfully; Epic-only reads/sync/note publication and authenticated staff operations are checked for explicit boundary rejection when unavailable. Those rejection checks do not prove live Epic access.

Run `npm run hospital:coverage` for a read-only report of populated columns in the configured database. `HOSPITAL_DATABASE_COVERAGE.md` records the latest local report. Unresolved-conflict fields, unused external publication fields and not-yet-started scenario runs can legitimately be empty. Creating records in those fields without performing their workflows would be fabricated evidence.

Task claiming uses the existing task_assignments table. Pool rows have transfer_status=UNASSIGNED and reference the recording custodian; that nurse does not own the work. A confirmed claim marks the pool row TRANSFERRED and creates ACTIVE custody for the requesting nurse in the same shift, with a task event, receipt and checkpoint in one transaction. Another nurse’s active work requires the existing reviewed handoff flow.

## Deployment inspection, 23 October 2026

A read-only official-SDK connection to `https://32.189.84.182.nip.io/mcp` previously succeeded and discovered 16 tools. That older endpoint did not expose the latest hospital tools. No deployment was performed. With the current local hospital-enabled configuration, external Epic clients discover 15 tools and trusted preview clients discover 15 tools. Updating local code does not update the deployed endpoint.

The latest isolated hospital suite passed 18 checks, exercising all 15 discovered preview tools and rejection of unavailable Epic/staff operations. The source-isolation suite passed 11 checks using ordinary official-SDK and trusted preview connections, including real HTTP reads against a controlled FHIR contract server, retry isolation, forged-source rejection, managed-checkpoint protection and public production preview restrictions. These are not live Epic authorization or write-back success claims. The regression suite passed 186 checks; typecheck, build and the browser voice regression passed. Browser audio/recognition are simulated in that regression, not physical microphone verification.

External Epic tools: `get_assigned_tasks`, `get_task_details`, `get_task_changes`, `get_handoff_context`, `create_handoff_draft`, `get_workflow_checkpoint`, `save_workflow_checkpoint`, `resume_workflow`, `acknowledge_task`, `voice_turn`, `get_voice_display`, `get_epic_patient_context`, `sync_epic_workspace`, `preview_epic_handoff_note`, `publish_reviewed_handoff_note`.

Preview replaces the four Epic-specific tools with `claim_hospital_task`, `select_voice_source`, `refresh_hospital_records` and `review_simulation`. A preview MCP transport cannot switch into Epic. The local dashboard source route establishes a separate scoped session when switching; production public preview blocks that switch.

For initial Epic synchronization before any patients have been imported, explicitly configure `EPIC_DEMO_NURSE_ID` and `EPIC_DEMO_SHIFT_ID` to existing non-synthetic records. The sync service still verifies unit and active-shift membership. Configure the existing Epic OAuth/FHIR variables, `EPIC_KID` and authorized patient allowlist; missing configuration returns an error. No hardcoded key ID is substituted.
