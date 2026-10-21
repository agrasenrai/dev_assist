# Authenticated operational sandbox

ShiftWeave combines Epic's official public sandbox clinical records with its own writable, explicitly synthetic staffing and nursing coordination environment. This provides an end-to-end simulation without pretending that Epic supplies a hospital's duty roster or that a local note was written into Epic.

## Sources and boundaries

| Data | Authority |
| --- | --- |
| Patients, encounters, conditions, allergies, medication orders | Retrieved Epic public sandbox resources, including original identifiers, timestamps and missing-data warnings |
| Staff accounts, nurses, physicians, units and duty windows | Administrator-configured ShiftWeave operational sandbox |
| Care teams, coordination tasks, notes, discrepancy decisions and custody | Authenticated staff actions persisted in SQLite |
| Scenario observations and administration-shaped test events | Explicitly labelled ShiftWeave scenario sandbox; no actual care or Epic mutation |
| Reviewed published handoff documents | Durable local sandbox documents; `externalEpicWrite:false` |

The current Epic audit covers seven published test patients, 17 encounters, 18 conditions, nine allergy records and seven medication orders. MedicationAdministration and DocumentReference searches returned no clinical records across these patients. Practitioner, PractitionerRole, CareTeam, Location, Task and Observation requests returned 403 for the configured client. One List query requires a supported `code` and does not establish roster access. Source records can be historical. See `deploy/epic-dataset-audit.json` and `EPIC_SANDBOX_ASSESSMENT.md`.

Epic Clinical Notes creation previously returned HTTP 403. `EPIC_WRITES_ENABLED=false` remains in the operational profile. An app registration or sandbox permission change must be verified separately before claiming an Epic write. This implementation does not require that unavailable permission to demonstrate reviewed local publication.

## Start the already provisioned workspace

```sh
npm ci
npm --prefix client ci
npm run build
npm start
```

Use the port from `.env` or the startup output. On the current workstation the app is running at `http://localhost:3101`. Sign in with an account from the ignored `.sandbox/staff-credentials.json`. Do not paste passwords into source files, screenshots, chat, or submission evidence.

The current setup has eight accounts: `administrator`, `charge.meera`, `seema`, `reema`, `jordan`, `asha`, `doctor.mira`, `doctor.arun`. Passwords are randomly generated. The directory contains configured identities, not verified Epic practitioners. Seven Epic patient snapshots have 21 coordination tasks, 21 care-team links and eight initial operational notes. One intentionally conflicting note exercises the review workflow.

## Provision on another laptop

1. Pull the repository and install root/client dependencies.
2. Copy `.env.example` to `.env`; privately configure the existing authorized Epic client, matching private key and passphrase, and an explicitly selected Bedrock provider. Never commit these secrets. The private key is not included in Git.
3. Run `npm run sandbox:setup` once. It fetches all seven configured public Epic patients, creates a separate SQLite file, provisions staff and writes ignored local credentials. It backs up the previous `.env` and selects the new database; existing databases are preserved. Rerunning provisions another workspace, not a migration of existing work.
4. Run `npm run build` and `npm start`. Share each account's password privately with its intended tester.

The original zero-cost fixture demo is still available with `STAFF_AUTH_REQUIRED=false`, `LLM_PROVIDER=mock`, a separate fixture database and explicit fixture import. The authenticated operational profile deliberately requires an explicitly configured Bedrock adapter and never silently falls back to a model mock. Service access and provider costs depend on that account.

## Roles and full workflow

- Administrator: create staff, reset passwords, deactivate/reactivate accounts, create shifts, schedule duty, assign patient care teams and refresh Epic clinical records. Password reset/deactivation revokes existing sessions; the last administrator is protected.
- Charge nurse: manage their unit's duty, care teams and discrepancies; nursing custody actions still use the signed-in identity.
- Staff nurse: see assigned care-team patients, their clinical source records and coordination work; record notes, verify local task status, resolve owned discrepancies and transfer/accept responsibility explicitly.
- Physician: see linked care-team patients, record coordination notes, create work for primary nurses and read published patient documents. Physician access does not grant nursing custody or status actions.

For a new staff member: create the account under Team, create/select a handover shift under Roster, schedule their duty, then assign their patient care-team role. A primary nurse owns current work; an incoming nurse is a prospective recipient until explicit custody acceptance. An assignment alone does not complete a task or transfer ownership.

For a handoff: outgoing nurse reviews task/source notes, resolves disagreements with a human verification note, then prepares the draft for the scheduled incoming nurse. Incoming nurse reviews the current source state, explicitly accepts task custody, reviews again and finalizes. They can then preview the exact patient-specific note and publish it to the local sandbox. Documents provides read-back. No step modifies clinical orders or claims actual administration.

Voice workspace uses the authenticated nurse identity, persistent voice session and actual MCP tools. Spoken names cannot impersonate another staff account. Explicit “Ask assistant” requests invoke the configured model; deterministic workflow commands still enforce the same human confirmations and source checks.

Scenarios allows supervisors to record labelled synthetic measurements or medication-administration-shaped events against a sourced order. These records are shown separately from Epic data and are not a substitute for missing bedside data.

## Architecture and reliability

Browser session -> authenticated Express companion endpoint -> MCP client bridge -> Streamable HTTP `/mcp` using protocol `2025-11-25` -> role/scope validation -> transactional services -> SQLite. The internal MCP service token alone cannot impersonate a staff account. HttpOnly, SameSite session cookies authenticate the user; only password hashes and token hashes are stored.

Mutations bind actor, action and input to a stable request key. Domain changes, events, receipts and workflow checkpoints commit together. A lost response is reconciled from the saved receipt; exact retries return the committed result. Changed payloads and other actors cannot reuse a receipt. Task revisions and handoff review hashes reject stale decisions. The browser retains uncertain non-credential intents per staff session and exposes exact retry/reconciliation controls. Credential values are never persisted in those browser intents.

Session secret, database and signing configuration must persist across restarts. Back up the database with `npm run backup`; protect `.env`, Epic private keys and the credentials file separately. For hosting, use one Node instance and persistent local/EBS storage for SQLite, HTTPS and a correct `PUBLIC_ORIGIN`. Ephemeral serverless storage and multiple independent SQLite writers are unsuitable for this deployment. DynamoDB would require a real transactional persistence adapter and migration; changing the database name alone would not solve the unavailable Epic roster APIs.

## Verification

```sh
npm run typecheck
npm test
npm run test:operations
npm run test:deployment
npm run test:epic-workflow
npm run build
```

`test:operations` uses an isolated synthetic database and a real HTTP/MCP server. It checks role and patient boundaries, source snapshots, discrepancy blocking, stale reviews, explicit custody, patient-specific documents, exact retries, receipt ownership, restart persistence, voice identity, account deactivation and logout. It does not write to Epic or the active demonstration database. Evidence is saved in `deploy/operational-workflow-test.json`.

`npx tsx scripts/verify-provisioned-workspace.ts` checks all eight provisioned accounts against the running app and makes one real read-only model-assisted voice request using the imported Epic snapshots. It creates login/conversation checkpoints, then revokes its own sessions; it does not accept or finalize the active demonstration handoff. Set `OPERATIONAL_TEST_ORIGIN` if the app uses another origin. Evidence is saved in `deploy/provisioned-workspace-test.json`. The verified provider for the current profile is Bedrock; latency in that report is a complete request measurement, not streaming time to first token.

These checks establish implemented simulation behavior, not hospital production readiness, production identity integration, medical correctness or an Alexa+ device certification. The browser voice experience is an Alexa+ simulation.
