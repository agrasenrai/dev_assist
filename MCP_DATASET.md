# Standalone MCP and synthetic hospital dataset

The MCP server works without the dashboard, microphone, browser storage, Docker, Epic credentials, or a separate FHIR server. It reads the configured SQLite database. Synthetic clinical resources are stored as FHIR R4 JSON; tasks, assignments, handoffs and checkpoints remain in the existing application tables. This embedded store is not a public FHIR server or an Epic environment.

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
2. Call `get_voice_display` with a new UUID `session_id`. It returns current `revision` and database-derived `availableNurses` for the synthetic hospital.
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

Explicit fixtures live in `data/hospital/fhir-r4.json` and `data/hospital/workflow.json`. Initial records include three synthetic nurses (Seema Patel, Reema Roy, Jordan Lee), three patients, five coordination tasks across different statuses, and an actual Reema-to-Seema draft handoff. This draft does not transfer responsibility. Six scenario definitions use the existing simulation engine. Updates are shared and persistent; starting a scenario does not reset its records.

Example questions after choosing Simulation hospital:

- “I am Seema Patel, what tasks are assigned to me?”
- “Tell me about Rowan Morgan.” Then: “What are their allergies?”
- “What tasks are still unfinished?”
- “Where did Reema Roy leave off?” (Bedrock intent mode), or “Review handoff from Reema Roy.”
- “Mark Check discharge paperwork completed.” Review the proposed action, then explicitly confirm or cancel.
- “What is the status of Check discharge paperwork?”
- “What are Taylor Brooks' allergies?” Missing data must remain unknown.

One room can contain multiple tasks. Specify the task title when updating; clarification is correct behavior when the reference is ambiguous. Synthetic data is labeled and never represented as live Epic data. Switching sources clears identity, conversation and pending confirmations, while retaining durable workflow records.

## Verification

```sh
npm run test:hospital
npm run typecheck
npm test
npm run build
```

Dataset tests provision and mutate a temporary database, use real SQLite and MCP HTTP calls, exercise all six scenarios, and run the independent SDK verifier. They never run mutation tests against the configured application database.

Optional external FHIR adapter checks use `npm run test:hospital -- --http` against a controlled HTTP contract server. `--live` targets `HOSPITAL_FHIR_BASE_URL` and explicitly uploads the namespaced synthetic fixture there; use only an authorized synthetic server. Those checks are distinct from validation against a real HAPI or Epic deployment.

The optional `HOSPITAL_DATA_SOURCE=fhir` adapter is preserved. It requires a configured FHIR R4 endpoint and never falls back to SQLite after connection failure. No external deployment is needed for the SQLite dataset path, and none is performed by the start/prepare commands.
