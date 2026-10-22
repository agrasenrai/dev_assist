# MCP verification — 23 October 2026

The server starts on an ephemeral port and accepts both the project MCP bridge and the official SDK Client with StreamableHTTPClientTransport. The bridge negotiated protocol 2025-11-25; discovery returned 16 tools. Tests exercised database-backed reads, status filters, checkpoint writes/replays, handoff creation, explicit custody, voice state, error handling and interruption recovery.

The existing running server also accepted the official SDK client. A separate read-only connection to the configured SQLite database verified 12 returned task IDs, titles and statuses against stored assignments. Database quick_check returned ok; foreign_key_check returned no violations. The database contained 8 nurses, 7 patients, 21 tasks and 21 assignments at verification time. No fixtures were imported into that database and no clinical writes were performed there. Read-tool audit records may be written by the server.

## Changes

| File | Change |
| --- | --- |
| src/services/shift-context.ts | Resolve the selected nurse and stored shift; reject unknown nurses, absent shifts, ambiguous active shifts and mismatched units. |
| src/server.ts | Remove fixture IDs and automatic chat identity selection; use the resolver; enforce the configured MCP service bearer credential for POST/GET/DELETE; log the actual bound port. |
| src/agent/orchestrator.ts | Remove fixed nurse/shift defaults; preserve saved conversation context; default outgoing context to the requesting nurse rather than another person. |
| src/db/connection.ts | Production requires an explicit existing SQLite file, preventing accidental creation of an empty substitute database. |
| src/runtime-config.ts | Production requires explicit Bedrock selection; preserve the free local deterministic path. |
| src/services/epic-writeback.service.ts | Reject simulated publication in production; remove the credentials-missing mock branch. |
| scripts/verify-workflows.ts | Official SDK interoperability, missing records/shifts, database errors, status filters, checkpoint and event-query checks; explicit test handoff identities. |
| scripts/restart-worker.ts | Specify fixture handoff context explicitly for process-restart tests. |
| scripts/verify-deployment.ts | Check missing/incorrect MCP credentials and production simulated-write rejection; explicitly provision the temporary database. |
| scripts/verify-configured-mcp.ts | Read-only configured-database comparison using an official SDK client and existing service credentials. |
| scripts/verify-alexa-mcp-connection.ts | Remove expired tunnel and fixture identity defaults; require endpoint/record configuration; omit patient/task details from output; close the client on failure. |
| scripts/test-writeback.ts | Replace the automatic live note POST and catch-any-error-as-success permission test with an offline production-simulation boundary test. |
| package.json | Add test:mcp-configured. |
| MCP_VERIFICATION.md | Record evidence, commands and limitations. |

No staff UI, login flow, dataset or external integration was added. Normal server startup creates/migrates schema; fixture import remains an explicit command, not an automatic production seed. Local deterministic rendering uses retrieved records; it is retained for the required offline path. The separate legacy chat renderer still constrains generated speech using tool results.

## Executed checks

- `npm test`: **178 checks passed**, temporary database and port; includes protocol, official SDK discovery/calls, read/write persistence, idempotency, subprocess recovery and voice semantic guardrails. LLM responses in these regression tests are controlled fixtures, not proof of current Bedrock availability.
- `npm run test:mcp-configured`: **passed** against the existing running server and configured database; 16 discovered tools and 12 matching assigned tasks.
- `npm run test:deployment`: **passed**, including bearer protection, old-protocol rejection, readiness, simulated-publication rejection, explicit Epic read errors and backup integrity. No live cloud calls.
- `npm run test:epic-workflow`: **passed**, including MCP sync, sourced drafts, custody, local finalization and resync. External responses were simulated; no external writes.
- `npm run test:writeback`: **8 passed**, local safety/simulation/reconciliation checks; no live permission claim.
- `npm run test:recovery`: **7 passed**, with live configured Epic OAuth/metadata/invalid-resource reads and isolated local workflow mutations. Existing temporary database/PORT=0 configuration was verified while the application was running.
- `npm run typecheck`, `npm run build`, `git diff --check`: **passed**. Initial localhost/network EACCES failures were rerun with allowed networking; they were not counted as successful tests.

## Configure and run (PowerShell)

Use the existing `.env` credentials. Do not print them or run `npm run setup` against an operational database: that command explicitly imports demonstration fixtures.

```powershell
Set-Location C:\Users\siddh\Desktop\dev_assist
# Dependencies are already installed here; for a fresh checkout:
npm ci
npm --prefix client ci

# Existing database verified during this review:
$env:SQLITE_DB_PATH = (Resolve-Path '.\data\workflow-sandbox-1792609735104.db').Path
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:LLM_PROVIDER = 'bedrock'
# AWS_REGION, BEDROCK_MODEL_ID and AWS credentials come from existing configuration.
npm run preflight
npm run build
npm start
```

Stop the old server in its terminal before starting another instance on port 3000. The changed code was tested on isolated servers; the existing listener was not forcibly restarted. Its current process must reload/restart to apply changes if it is not watching source files.

For production, additionally set `NODE_ENV=production`, `PUBLIC_ORIGIN` to the actual exact deployment origin, and `MCP_AUTH_TOKEN` to a persistent random value of at least 32 characters. Keep existing staff authorization settings. Production rejects a missing database file or non-Bedrock provider. Provision a new empty database deliberately using `npm run db:init` before switching to production; importing demonstration records is not required. For optional local offline execution, use `NODE_ENV=development` and `LLM_PROVIDER=mock`; this is explicitly deterministic mode, not live Bedrock or live EHR.

In a second terminal, with the same `.env`:

```powershell
$env:MCP_SERVER_URL = 'http://127.0.0.1:3000/mcp'
npm run test:mcp-configured
npm test
npm run test:deployment
npm run test:epic-workflow
npm run test:writeback
npm run test:recovery
```

`test:mcp-configured` needs an authorized existing staff session in `MCP_TEST_STAFF_SESSION` if staff authentication is enabled. It never bypasses that check. The external Alexa-connection probe requires `MCP_SERVER_URL`, `MCP_TEST_NURSE_ID`, `MCP_TEST_INCOMING_NURSE_ID`, and `MCP_TEST_SHIFT_ID` referencing stored records. These are client tests, not proof of Alexa cloud registration.

## Remaining limits

- Live Epic note publication is disabled in the configured environment and was not attempted. Write permission and a reviewed note are still required before claiming live publication works.
- The generic `live-fhir-api` workflow provider is explicitly unconfigured and rejects selection. Existing Epic snapshot/sync integration is separate and remains available.
- This review did not run a new paid Bedrock inference, physical microphone/speaker test, or staff-workspace acceptance suite. Their readiness is not implied by MCP discovery.
- The 16-tool inventory includes the staff operational tool. Its staff behavior was left unchanged; not every authorized role/action combination was exercised here.
- Local name selection remains identity selection, not nurse authentication. MCP service-token enforcement preserves the existing configured service boundary; it does not replace existing staff authorization or certify a clinical production deployment.
