# Database-driven reviewer simulations

## Run against the application database

The launcher now uses the same explicit SQLITE_DB_PATH as the normal application. The configured database was populated additively with the six scenarios and their synthetic review records. Existing nurse/patient records and staff accounts are retained. The former reviewer-simulations.db is retained but is no longer selected by default.

```powershell
# Reads SQLITE_DB_PATH from the environment or .env; backs up before importing.
# Idempotent: repeat imports do not reset tasks, assignments or run progress.
npm run simulation:setup
npm run build
npm run simulation:start
```

The local review server opens on http://127.0.0.1:3001. Its voice workspace is http://127.0.0.1:3001/?workspace=voice. It preserves the configured LLM_PROVIDER (Bedrock in this installation); SIMULATION_LLM_PROVIDER is an explicit override. Review mode disables Epic network reads/writes to support the unavailable-service scenario. The normal app launcher retains its existing Epic settings.

Explicit alternate database paths remain supported for isolated rehearsals:

```powershell
npx tsx scripts/setup-simulations.ts data/reviewer-simulations-rehearsal.db
npx tsx scripts/start-simulations.ts data/reviewer-simulations-rehearsal.db
```

### Hosting the same SQLite file on EC2/EBS

The backend uses better-sqlite3 and a local file, not a remote database URL. On EC2, set SQLITE_DB_PATH to the absolute path of the provisioned database on your mounted EBS filesystem (for example /mnt/shiftweave-data/shiftweave.db). Make the mount a prerequisite of application startup and give the service user write access to the containing directory for WAL/SHM files. Use one application instance against this file.

Use the SQLite backup API (npm run backup) to produce a consistent transfer artifact; do not copy just an active .db file while its WAL may contain committed changes. Transfer the backup privately and configure the hosted service to use it. The database is ignored by Git and is not uploaded by pushing source code. Keep backups and credentials out of the repository.

Normal hosted startup remains npm start after npm run build, with the existing PUBLIC_ORIGIN, MCP_AUTH_TOKEN, LLM_PROVIDER and SQLITE_DB_PATH requirements. The guided simulation UI is still guarded as local review mode: copying the database alone does not enable that UI in production. Do not use simulation:start as the public production launcher. Hosted access control and a hosted simulation policy still require deployment verification; no EC2 deployment is claimed here.

### Verification of the shared database change

- Before import: 8 nurses, 7 patients, 21 tasks; no simulation tables.
- After import: 10 nurses, 9 patients, 23 tasks; all 6 scenario definitions.
- Existing records compared against the consistent pre-import backup: unchanged, including 8 staff accounts and 7 Epic snapshots.
- SQLite quick_check: ok; foreign_key_check: no violations.
- npm run test:shared-simulations clones the configured database and verifies additive/repeated import, preserved original records, catalog via MCP, and the combined Seema identification/task question against actual assignment rows. It never performs test mutations on the source database.
- npm run test:simulations verifies all six workflows in a separate temporary database.
- Live review server: catalog returned 6 scenarios with Bedrock configured; the exact Seema question identified staff:seema and returned 12 task IDs matching the original database. That check originally rejected source-backed patient headings and neutral transitions. The reply validator now verifies those headings against the current source, preserves fact placeholders and missing-data warnings, and avoids splitting names at Dr./Mr./Mrs./Ms./Prof./Sr./Jr. Live Bedrock verification subsequently passed the exact Seema question with 12 matching assignments, saved-response retry and no task mutations. This verifies the reported case, not every possible model phrasing.

## Architecture and findings

Reviewed repository rules, understanding/plan documents, source layout, database schema, voice service and browser hook, MCP registration/client, orchestrator, mutation/checkpoint services, handoff service, Epic read/sync boundaries and existing tests before implementation.

| Area | Existing behavior / review finding | Implementation |
| --- | --- | --- |
| Patient/nurse/task records | SQLite-backed services already join real stored records. | Reused those tables and services; did not replace them with static responses. |
| Demonstration fixtures | Explicit importer and test fixtures contain fixed example records. Such seed content is appropriate when clearly synthetic. | New explicit review seed, never automatic production seeding. |
| Scenario instructions | No persistent reviewer catalog or saved guided progress. | Catalog, run and step-result tables. UI fetches catalog and records dynamically. |
| Identity/context | Voice sessions already persist nurse/patient references. | Each review run gets its own voice session and reuses existing voice_turn/get_voice_display tools. |
| Writes/retries | Existing domain services require confirmations and persist receipts/checkpoints. | Guided steps reuse them; wrapper requests also persist receipts. Voice intent preserves its original revision across ambiguous failures. |
| Interruption | Orchestrator supports a deliberate exception and checkpoint reconciliation. | Guided interrupt/resume scenario invokes that real implementation. It is explicitly a simulated interruption, not a machine crash. |
| Epic | Allowlisted snapshots and reads exist; generic FHIR workflow provider remains unconfigured. | Separate live read verification; review launcher disables Epic network calls; existing stored snapshots are retained. |
| Frontend constants | Labels, enums, clinical boundaries, and layout constants are not patient data. | Kept legitimate constants. Scenario questions/expected outcomes are stored catalog content, never substituted for actual answers. |
| Review layout | Global voice header/overflow CSS initially interfered with the new screen. | Scoped review layout and scrolling; no staff redesign. |

No new authentication mechanism, clinical recommendations, medication administration, or order modification was introduced. Review mode is loopback-only, non-production and explicitly provisioned. Mixed application databases require the additive configured-database import receipt; existing staff authentication cannot be disabled by the review launcher. It is intended for one local review server, not concurrent public or multi-tenant deployment.

## Entities and relationships

Existing domain tables: two synthetic nurses (Ava Review and Zoe Review), one active review shift, two synthetic patients (Rowan Demo and Taylor Demo), two discharge-coordination tasks and their assignments. Rowan has a recorded synthetic latex allergy; Taylor deliberately has missing allergy information. A missing field is not a negative allergy history.

New tables:

- `simulation_catalog`: scenario ID, title, description and ordered step definitions.
- `simulation_runs`: scenario foreign key, unique voice session, progress cursor, frozen scenario definition, last actual response and creation time.
- `simulation_results`: ordered actual results, keyed uniquely by run and step.

Existing `operation_receipts`, `workflow_runs`, `workflow_checkpoints`, `task_events` and `handoffs` preserve action/recovery evidence. Run progress and result updates commit through MutationService. A stale step cursor is rejected, and exact retries return the saved response. Follow-up voice context and latest responses survive reloads. New runs share domain records within the review database; they do not reset completed tasks or erase handoffs.

## Guided scenarios

1. **Patient record:** identify Ava, retrieve Rowan, ask “What are their allergies?” using saved context.
2. **Task update:** read a task, stage completion, explicitly confirm, and query its stored status again.
3. **Missing information:** ask about Taylor's missing allergies, an absent patient, and an unsupported treatment request.
4. **Handoff:** draft for Zoe, verify assignments remain with Ava, switch to Zoe, explicitly confirm custody, then confirm local finalization. No Epic publication occurs.
5. **Interruption/recovery:** interrupt after committed reads, inspect checkpoint evidence, then resume to a grounded handoff draft.
6. **Unavailable integration:** call the explicitly disabled Epic tool, see its real error, then deliberately continue with local synthetic records. This does not claim Epic recovered or silently substitute local records for an Epic answer.

Every step distinguishes input, processing, expected outcome, and actual output. “COMPLETED” means the request executed, not that an automated assertion proved every expected statement. Reviewers can ask typed or spoken follow-ups, inspect returned evidence and refresh current database records.

## Maintain the catalog

Edit `data/simulations/catalog.json`, then run:

```powershell
npm run simulation:catalog
# Or target another already-provisioned review database:
npm run simulation:catalog -- data/reviewer-simulations-rehearsal.db
```

Validated definitions are upserted transactionally with an idempotent receipt/checkpoint. New runs read updated definitions; existing runs preserve their saved definitions. Recovery participant IDs are supplied by catalog data and resolved against nurse records, not embedded in server logic. Seed patient/nurse data is deliberately supplied by `scripts/setup-simulations.ts`; new synthetic domain entities require an explicit additive import, never automatic server-start seeding. This is a developer-managed catalog, not an administrative data editor.

## API/MCP

- `GET /api/simulations`: whether the dedicated review environment is enabled.
- `POST /api/simulations`: validated actions `list`, `start`, `read`, `step`, `ask`; bridged through Streamable HTTP MCP.
- `review_simulation`: registered only in review mode. Normal server discovery remains at 16 tools; review mode adds this tool.
- `start` requires a stored scenario ID and UUID idempotency key.
- `step` requires a run UUID, current `expected_cursor` and retry UUID.
- `ask` requires a run UUID, nonempty question (maximum 2,000 characters) and retry UUID.
- Nested actions reuse existing MCP tools and the existing orchestrator; no generic arbitrary tool executor is exposed by the review API.

## Verification

Executed during this implementation:

- `npm run test:simulations`: all six scenarios passed through real HTTP/MCP/SQLite, with exact retries, staged/confirmed updates, missing-data responses, recovery, explicit disabled-integration errors and database integrity checks.
- Additional simulation checks passed: changed allergy data reflected in a follow-up; lost voice response after commit reconciled using the original revision; stale-step rejection; latest response persistence; dynamic catalog edits with frozen existing runs; unknown scenario rejection.
- `npm test`: 178 existing regression checks passed in an isolated database.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Browser: scenario selection, nurse identification, patient retrieval, typed contextual follow-up, resumed progress after server restart, and latest response after reload were observed. Physical microphone/audio were not tested.
- `npm run simulation:verify-epic`: live read-only configured allowlist check passed. It retrieved a patient, 7 conditions, 10 encounters, 1 allergy and 1 medication request. Medication-administration and document sections returned zero records. No external writes or local patient imports occurred; no identifying content was printed.

Initial restricted-network attempts failed and were rerun with networking permitted. A startup guard initially used the wrong staff column; corrected to `staff_id` and reran the simulation suite successfully. Cleanup was fixed so import failures close the temporary database rather than masking errors with a locked-file failure.

## Original hackathon feature coverage and limits

MCP discovery, database reads, voice follow-ups, confirmed local mutations, draft creation, durable progress, retries, interruption recovery, missing data, and explicit provider failures are demonstrated here. Synthetic custody acceptance and local handoff finalization are also included and verified against stored assignments/status. Discrepancy resolution remains implemented in the existing voice/services and regression tests; this first guided catalog does not add a dedicated discrepancy walkthrough. The free local path and optional Bedrock adapter remain available. No claim is made that all historical roadmap ideas have been implemented.

Live Epic note publication remains disabled/unverified, and generic Epic nursing-task mapping is not available. The reviewer site is a browser simulation rather than verified Alexa+ cloud registration. The recovery demonstration does not establish recovery from every hardware/storage failure. Live data changes, browser speech availability and model latency can affect a presentation; rehearse on the actual device.

## Changed files

New: `src/services/simulation.service.ts`, `data/simulations/catalog.json`, `scripts/setup-simulations.ts`, `scripts/start-simulations.ts`, `scripts/update-simulation-catalog.ts`, `scripts/verify-simulations.ts`, `scripts/verify-simulation-epic.ts`, `client/src/components/SimulationWorkspace.tsx`, `client/src/simulation.css`, and this document.

Updated: `src/server.ts` (gated MCP/API registration and startup guard), `src/runtime-config.ts` (review isolation), `src/agent/mcp-client-bridge.ts` (review tool timeout), `client/src/App.tsx` (review-only entry selection), `package.json` (commands), `.gitignore` (generated review databases). Generated database contents are not committed.
