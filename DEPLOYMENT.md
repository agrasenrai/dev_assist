# ShiftWeave deployment and configuration

For the existing **t4g.medium ARM64 / encrypted EBS / ECR / Caddy** deployment, use [the current update checklist](deploy/UPDATE_CHECKLIST.md) and [EC2 Compose template](deploy/compose.ec2.yaml). They preserve the supplied `/mnt/shiftweave` bind paths and certificates and explain the required one-time hospital import. Do not replace the deployed Compose file with the root named-volume example.

Recommended topology remains one always-on EC2 host and one application container. React, voice gateway, Express MCP and SQLite workflow state share the host. Mock remains the free local default; hosted production requires Bedrock. This is a synthetic-data demonstrator, not verified hospital production software.

For the authenticated Epic/staff profile, follow [OPERATIONAL_SANDBOX.md](OPERATIONAL_SANDBOX.md). The fixture import and machine-token-only smoke flow below apply to the original fixture profile. Do not run the fixture import against a provisioned operational database. Set `STAFF_AUTH_REQUIRED=true`, preserve `SANDBOX_SESSION_SECRET`, select Bedrock explicitly and deploy a backup of the provisioned database to the persistent SQLite path configured by Compose. Each user signs in with their individual sandbox account. MCP calls additionally require that staff session; the service bearer token alone does not grant staff access. This profile uses reviewed local sandbox document publication while Epic writes remain disabled.

## 1. Free local start

Use Node.js 24 and npm. From the repository root:

```powershell
Copy-Item .env.example .env  # only if you do not already have .env
npm run setup
npm start
```

Open http://localhost:3000. `setup` installs both dependency trees, initializes schema, idempotently imports the synthetic fixture, and builds both application layers. It does not erase your database. Do not import fixtures into a clinical database. Development remains `npm run dev` plus `npm run dev:client`.

## 2. Hosted deployment

Provision one Linux EC2 host with Docker Engine and the Compose plugin. A small x86-64 host with 4 GiB RAM is a reasonable starting build host; measure actual utilization before resizing. This is a sizing suggestion, not a benchmark or free-tier promise. Place Docker's data directory on encrypted EBS storage. Use one replica; no shared SQLite file on EFS/NFS. Preserve the volume when replacing the host and enable EBS snapshots. Cloud hosting, domain names and model calls can incur charges.

For a new generic host, point DNS at its stable address, allow TCP 80/443, keep port 3000 private, and install Docker/Compose using the official [Ubuntu guide](https://docs.docker.com/engine/install/ubuntu/). The commands below assume the persistent database has already been provisioned or consistently restored into the chosen volume. Production refuses a missing database; image startup does not manufacture fixture data. The existing `/mnt/shiftweave` deployment must use the dedicated update checklist instead.

```sh
cp .env.deploy.example .env.deploy
mkdir -p keys
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Generate secret; fill .env.deploy with an editor.
chmod 600 .env.deploy
docker compose --env-file .env.deploy config --quiet
docker compose --env-file .env.deploy build
docker compose --env-file .env.deploy run --rm app node build/scripts/preflight.js
# Existing populated deployment: follow deploy/UPDATE_CHECKLIST.md instead.
# Do not run legacy fixture ingestion against a provisioned production database.
docker compose --env-file .env.deploy up -d
docker compose --env-file .env.deploy ps
docker compose --env-file .env.deploy exec app node build/scripts/smoke.js
```

If Node is not installed on the host, generate the secret with `openssl rand -hex 32`. The database import is explicit so restarting a server never resets the demo. Compose's `workflow-data` volume holds the database and WAL on the host; it is persistent across container recreation, not across deletion of the host's disk. Never use `docker compose down -v` to update this deployment.

Open `https://YOUR_DOMAIN`. Caddy obtains TLS certificates once DNS and ports are correct. This provides the secure browser context needed for microphone access. Browser speech support varies; the typed transcript interface remains available. This is an Alexa+ simulation, not an installed Alexa skill.

### Required placeholders

| Variable | Value |
| --- | --- |
| `DOMAIN` | DNS hostname, without scheme |
| `PUBLIC_ORIGIN` | Exact `https://hostname`, no trailing slash |
| `MCP_AUTH_TOKEN` | Random secret, at least 32 characters |
| `LLM_PROVIDER` | `bedrock` for production; `mock` is local-only |

Public binding fails at startup if these are missing or still contain shipped placeholders. Selecting a nurse by name is **not authenticated nurse identity**. Keep credentials server-side. Do not put cloud keys or the MCP token in React/Vite variables. `/readyz` is an intentionally minimal unauthenticated process/database probe. `/health` reports configuration, not verified cloud connectivity.

External MCP clients connect to `https://YOUR_DOMAIN/mcp` using `Authorization: Bearer YOUR_MCP_AUTH_TOKEN`, initialize protocol `2025-11-25`, and retain the returned session header. The bundled bridge supplies this header from its server-side environment. This is a preconfigured demo bearer scheme, not MCP OAuth discovery; clients requiring OAuth authorization-server metadata need a separate identity integration. HTTP sessions are ephemeral; workflow checkpoints are durable. After a server restart, create a fresh MCP session and resume with the saved workflow ID and request key.

## 3. LLM selection

For the AWS mini challenge set `LLM_PROVIDER=bedrock`, `AWS_REGION`, and `BEDROCK_MODEL_ID` to a currently enabled **Converse tool-capable model or inference-profile ID**. Choose a small/fast tool-capable model first, then compare correctness and measured latency on the demo cases. No model is asserted to be universally fastest or most accurate.

Prefer an EC2 instance IAM role with least-privilege `bedrock:InvokeModel` access to the selected model/profile and its required regional resources. For Docker bridge networking, configure IMDSv2 access appropriately (including a response hop limit of 2 if needed); do not disable IMDSv2. Alternatively supply temporary AWS access key, secret, and session token to the server environment. Never bake them into an image. Cross-region inference profiles may require additional regional model permissions.

Bedrock requires configured service access. Only explicit mock mode makes no paid model calls. Preflight validates configuration presence, not external permissions.
The voice workspace uses one semantic model call for ordinary requests, including a combined introduction/operation plan. Backend services validate and execute the operation and provide the factual spoken answer. SDK clients are pooled across turns without pooling patient context. Supported changes still require the existing proposal and human-confirmation flow. The separate legacy chat orchestrator retains its existing behavior. See memory.md and the current update checklist for measured timing and limits.
## 4. Epic configuration and boundaries

Follow `incomingapikey.md` and the target Epic environment's approved API catalog. Configure `EPIC_CLIENT_ID`, `EPIC_KID`, `EPIC_TOKEN_URL`, `EPIC_FHIR_BASE_URL`, and comma-separated `EPIC_TEST_PATIENT_IDS`. Register your matching public JWKS with Epic. Put the private signing key at `keys/private_key.pem` on the host; Compose mounts it read-only. It must be readable by container UID 1000; use restrictive ownership/permissions. For local execution use `PRIVATE_KEY_PATH`. Set `EPIC_READS_ENABLED=true` only after configuration.

Introduce Seema, then select **Sync Epic patients** (or type that phrase). This invokes `sync_epic_workspace` through MCP. Patient, Encounter, Condition, AllergyIntolerance, MedicationRequest, MedicationAdministration and DocumentReference records become durable, endpoint-namespaced source snapshots. A local coordination task asks the nurse to review those records; it is not an Epic medication task. Preparing a handoff includes this context, and Reema explicitly accepts custody before finalization. Refresh preserves existing custody. `Read Epic patient YOUR_APPROVED_ID` remains available for supplemental context.

Search follows same-endpoint pagination with cycle/page limits, filters OperationOutcome entries from clinical records, and reports failed sections separately from empty results. Plain-text inline or linked Binary content is supported; other document MIME types are explicitly marked unsupported. Source timestamps, identifiers and warnings are retained. No acuity, clinical completion, primary diagnosis or nurse identity is inferred. See [EPIC_WORKFLOW.md](EPIC_WORKFLOW.md) for the verified journey and setup commands.

Finalized single-patient Epic handoffs have a note preview with patient, encounter, encounter-linked practitioner and exact review hash. Explicit review is required before publication. A write intent and outcome have durable checkpoints; ambiguous attempts are not automatically replayed. Live publication stays disabled by default (`EPIC_WRITES_ENABLED=false`). On 21 October 2026, live OAuth/read/workflow verification passed, but the approved DocumentReference.Create attempt returned **HTTP 403**. Practitioner.Read also returned 403. No external note was created or reported synced. API selection alone does not establish write permission; hospital production authorization remains outside this demonstration.

## 5. Backup, restore and updates

```sh
docker compose --env-file .env.deploy exec app node build/scripts/backup.js /app/backups/demo-before-update.db
docker compose --env-file .env.deploy cp app:/app/backups/demo-before-update.db ./demo-before-update.db
```

The online backup API produces a consistent SQLite snapshot. Copy it off the host to durable storage; another volume on the same host is not a disaster-recovery solution. Retention and encryption are deployment responsibilities. Do not copy just the live `.db` while ignoring its WAL.

For restore, stop the app first, preserve the current data directory, restore the snapshot into a fresh volume as `shiftweave.db`, give UID 1000 ownership, update Compose to use that volume, and start one replica. Do not leave WAL/SHM files from the previous database alongside the restored snapshot. Run the smoke test and resume a known demo workflow. Restoring an older backup can lose later acknowledgements; the application cannot guarantee zero data loss after disk loss or rollback.

For an update: back up, rebuild, then `docker compose up -d`. Startup uses additive schema initialization, not destructive reset. SIGTERM allows up to 25 seconds for HTTP work to drain; interrupted longer work is reconciled from checkpoints on retry.

## 6. Judging demonstration and evidence

1. Introduce Seema; show the task screen and source labels.
2. Ask a natural task/patient question; no “Ask assistant” prefix is required. Inspect `LLM:VOICE_DECISION`, `VOICE:SEMANTIC_TOOL` and `VOICE:TURN_FINISHED` evidence. Distinguish current voice flow from legacy chat traces.
3. Review a discrepancy; demonstrate that an incomplete/expired confirmation cannot mutate the task.
4. Prepare a handoff for Reema, switch identity, and explicitly accept custody. Drafting alone does not transfer responsibility.
5. Demonstrate interruption/recovery; show actual checkpoints and unchanged draft count on retry.
6. Optionally read an approved Epic test patient; show actual source response or explicit failure.

Run `npm test`, `npm run test:deployment`, `npm run typecheck`, `npm run build`, and the deployed MCP smoke test. The local suite uses isolated databases and mock model execution. Report results separately from live cloud/Epic checks. Browser voice hardware, TLS issuance, cloud deployment and provider latency require verification on the actual target.

## Official references

- [MCP Streamable HTTP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [SQLite WAL constraints](https://sqlite.org/wal.html) and [appropriate SQLite uses](https://sqlite.org/whentouse.html)
- [Amazon EBS volume persistence](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)
- [Bedrock Converse inference](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
- [Epic backend service documentation](https://fhir.epic.com/Documentation)
- [Caddy reverse proxy streaming](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
