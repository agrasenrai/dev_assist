# ShiftWeave

Nursing workflow coordination, local handoff drafts, human discrepancy review, and durable interruption recovery.

**Authenticated staff workspace:** [OPERATIONAL_SANDBOX.md](OPERATIONAL_SANDBOX.md) covers the Epic-sourced clinical dataset, administrator/nurse/physician accounts, duty roster, care teams, explicit handoff custody, reviewed sandbox documents and recovery. This is a separate profile from the original fixture demo below. Staff and operational observations are labelled simulation records, not Epic hospital staff.

**End-to-end setup:** [DEPLOYMENT.md](DEPLOYMENT.md) covers local setup, Docker/HTTPS deployment, LLM and Epic placeholders, persistent storage, backup and verification. Hosted production uses Bedrock; free local mock mode remains available. For the existing ARM64 EC2/EBS deployment, follow the [current update checklist](deploy/UPDATE_CHECKLIST.md) and [EC2 Compose template](deploy/compose.ec2.yaml), preserving its bind paths. See the [cleanup report](CLEANUP_REPORT.md) for removed files, preserved material and verification, and [deployment architecture](deploy/ARCHITECTURE.md) for tradeoffs.

**Epic workflow:** [EPIC_WORKFLOW.md](EPIC_WORKFLOW.md) documents verified live sandbox reads through MCP, sourced voice handoff, explicit custody transfer, and note review. The live note-create attempt returned HTTP 403; write-back remains disabled pending Epic authorization.

Built for the Amazon Developer Hackathon Alexa+ track. The browser simulates voice/chat using speech recognition and synthesis. MCP tool traffic uses Streamable HTTP on Express `/mcp`, with protocol `2025-11-25`.

## Run locally

Requires Node.js and npm. Default execution uses synthetic demo records and SQLite; cloud accounts are unnecessary.

```sh
npm install
npm --prefix client install
npm run db:init
npm run import:data
npm run build:client
npm run dev
```

Open [the local dashboard](http://127.0.0.1:3000). For frontend development, run `npm run dev:client` in another terminal; Vite proxies API, health and MCP requests.

Use `LLM_PROVIDER=mock` in your local `.env`. Never commit credentials.

## What works

- Discoverable MCP workflow tools, including authenticated operational dispatch, with validated inputs and stateful HTTP sessions.
- Database-backed conversation history and pending tool intent, restored in a fresh orchestrator.
- Stable retry receipts, atomic local mutation/checkpoint commits, and persisted workflow completion.
- Recovery reuses committed tool results; source changes invalidate stale reads. A lost response to a committed draft is retried with the original key.
- Summaries and saved draft facts are rendered from retrieved/local records. Optional cloud models plan permitted tool calls; unconstrained clinical prose is not displayed as verified facts.
- Human conflict review requires a note and explicit final status. Escalation preserves task status.
- Drafts propose carry-forward candidates. Explicit human custody acceptance changes assignments; local sign-off checks acceptance and unresolved conflicts.
- Dashboard task/handoff queries and audit payloads match the database/frontend field contracts.
- Errors remain visible; failed data loads are not displayed as zero discrepancies.

## Demo

1. Inspect the synthetic Seema -> Reema shift and seeded source discrepancy.
2. Ask **Prepare my handoff draft**. Inspect the returned summary, local draft and actual audit records.
3. Use **Simulate Wi-Fi Drop / Crash** to inject an exception after saved results. This control does not kill the HTTP server.
4. Use **Resume Saved Workflow**. The response includes the actual checkpoint and restored tool-result count.
5. Review the discrepancy, enter a verification note and select its documented final workflow status.
6. Accept candidate task custody, then confirm reviewed handoff sign-off. These actions stay local.

The test suite separately verifies an actual worker process exit after a draft commits and before its result checkpoint, followed by recovery in a fresh process.

## Verify

```sh
npm run typecheck
npm test
npm run build:client
```

`npm test` creates a temporary SQLite database, imports the fixture, starts an ephemeral loopback server and checks protocol, API contracts, retries, source reconciliation, human-action semantics, native LLM message conversion and process restart recovery. It does not alter `data/shiftweave.db`.

Targeted commands: `npm run test:mcp`, `npm run test:agent`, `npm run test:chaos`. Legacy script entrypoints also use the isolated runner.

## Optional models and external integration

- **Bedrock:** set `LLM_PROVIDER=bedrock`, `AWS_REGION` and `BEDROCK_MODEL_ID`; use the AWS SDK credential chain. In the voice workspace, ordinary speech uses Bedrock intent interpretation and current scoped MCP records without an “Ask assistant” prefix. Confirmations and mutations remain backend-validated. `mock` is the explicit free local mode; cloud failures never silently select it. See [voice verification](VOICE_VERIFICATION.md) for checks and limits.
- **Epic/FHIR:** hospital-specific operational mapping, OAuth/permissions and write-back are **not configured**. Selecting the external workflow provider returns an explicit error and keeps local mode active. No public HAPI patients or SQLite rows are presented as live Epic results. See [incomingapikey.md](incomingapikey.md) before implementing the adapter.

## Boundaries and current limitations

This is a local synthetic-data demonstration. It has no production nurse authentication or hospital authorization. Nurse IDs are demo context bindings, not authenticated identities. The HTTP server binds to loopback by default.

There are no autonomous diagnoses, treatment recommendations, medication administration or order modifications. Local task status is not a medication-administration record. Local finalization does not publish an official Epic clinical note.

The fixture contains two patients and two tasks. Cross-platform identity mapping and a full ward worksheet remain future scope. Runtime state and verified limitations are tracked in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); older architecture documents describe intentions as well as historical claims.

Project rules: [AGENTS.md](AGENTS.md), [important.md](important.md), and the repository [guidelines skill](.agents/skills/hackathon-guidelines/SKILL.md).

License: ISC, as declared in `package.json`.
