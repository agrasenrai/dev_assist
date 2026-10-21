# ShiftWeave deployment and configuration

Recommended hackathon topology: **one always-on EC2 Linux host, one application container, SQLite on local EBS-backed Docker storage, and Caddy HTTPS**. React, voice gateway, agent, Express MCP and durable workflow state share the host. Bedrock is optional; mock remains the free default. This is a synthetic-data demonstrator, not hospital production software.

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

Point a DNS A record at the host's stable public address. Allow inbound TCP 80 and 443; keep port 3000 private and restrict administration to your trusted access method. Install Docker using its official [Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/), including the Compose plugin. Clone this repository onto the host, then:

```sh
cp .env.deploy.example .env.deploy
mkdir -p keys
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Generate two different secrets; fill .env.deploy with an editor.
chmod 600 .env.deploy
docker compose config --quiet
docker compose build
docker compose run --rm app node build/scripts/preflight.js
docker compose run --rm app node build/src/db/ingest.js
docker compose up -d
docker compose ps
docker compose exec app node build/scripts/smoke.js
```

If Node is not installed on the host, generate each secret with `openssl rand -hex 32`. The database import is explicit so restarting a server never resets the demo. Compose's `workflow-data` volume holds the database and WAL on the host; it is persistent across container recreation, not across deletion of the host's disk. Never use `docker compose down -v` to update this deployment.

Open `https://YOUR_DOMAIN` and enter the configured demo username/password. Caddy obtains TLS certificates once DNS and ports are correct. This provides the secure browser context needed for microphone access. Browser speech support varies; the typed transcript interface remains available. This is an Alexa+ simulation, not an installed Alexa skill.

### Required placeholders

| Variable | Value |
| --- | --- |
| `DOMAIN` | DNS hostname, without scheme |
| `PUBLIC_ORIGIN` | Exact `https://hostname`, no trailing slash |
| `DEMO_USER` | Shared judge/demo username |
| `DEMO_PASSWORD` | Unique random secret, at least 24 characters |
| `MCP_AUTH_TOKEN` | Different random secret, at least 32 characters |
| `LLM_PROVIDER` | `mock`, `bedrock`, or `gemini` |

Public binding fails at startup if these are missing or still contain shipped placeholders. The shared gate protects the synthetic demo; selecting a nurse by name is **not authenticated nurse identity**. Keep credentials server-side. Do not put cloud keys or the MCP token in React/Vite variables. `/readyz` is an intentionally minimal unauthenticated process/database probe. `/health` reports configuration, not verified cloud connectivity.

External MCP clients connect to `https://YOUR_DOMAIN/mcp` using `Authorization: Bearer YOUR_MCP_AUTH_TOKEN`, initialize protocol `2025-11-25`, and retain the returned session header. The bundled bridge supplies this header from its server-side environment. This is a preconfigured demo bearer scheme, not MCP OAuth discovery; clients requiring OAuth authorization-server metadata need a separate identity integration. HTTP sessions are ephemeral; workflow checkpoints are durable. After a server restart, create a fresh MCP session and resume with the saved workflow ID and request key.

## 3. LLM selection

For the AWS mini challenge set `LLM_PROVIDER=bedrock`, `AWS_REGION`, and `BEDROCK_MODEL_ID` to a currently enabled **Converse tool-capable model or inference-profile ID**. Choose a small/fast tool-capable model first, then compare correctness and measured latency on the demo cases. No model is asserted to be universally fastest or most accurate.

Prefer an EC2 instance IAM role with least-privilege `bedrock:InvokeModel` access to the selected model/profile and its required regional resources. For Docker bridge networking, configure IMDSv2 access appropriately (including a response hop limit of 2 if needed); do not disable IMDSv2. Alternatively supply temporary AWS access key, secret, and session token to the server environment. Never bake them into an image. Cross-region inference profiles may require additional regional model permissions.

For Gemini set `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, and an accessible `GEMINI_MODEL`. Account quotas and costs depend on your service access; only mock mode is guaranteed to make no paid LLM calls. `npm run preflight` validates presence, not provider permission. A real “Ask assistant, summarize my shift” turn is the live model integration check. Service failures remain errors.

The LLM plans read calls; the existing orchestrator renders final clinical-facing facts deterministically from tool results. It does not publish unconstrained model prose. “Ask assistant…” is read-only; regular voice commands handle draft creation, review and explicit confirmation. All decisions are recorded as provider-labelled timing events, not hidden reasoning transcripts.

## 4. Epic configuration and boundaries

Follow `incomingapikey.md` and the target Epic environment's approved API catalog. Configure `EPIC_CLIENT_ID`, `EPIC_KID`, `EPIC_TOKEN_URL`, `EPIC_FHIR_BASE_URL`, and comma-separated `EPIC_TEST_PATIENT_IDS`. Register your matching public JWKS with Epic. Put the private signing key at `keys/private_key.pem` on the host; Compose mounts it read-only. It must be readable by container UID 1000; use restrictive ownership/permissions. For local execution use `PRIVATE_KEY_PATH`. Set `EPIC_READS_ENABLED=true` only after configuration.

After introducing a demo nurse, type `Read Epic patient YOUR_APPROVED_ID`. This calls `get_epic_patient_context` over MCP, retrieves Patient, Encounter, problem-list Condition, AllergyIntolerance, MedicationRequest and DocumentReference searches, then saves the returned snapshot with a receipt/checkpoint. Search denial, invalid responses and paginated results fail explicitly. Current aggregation deliberately rejects pagination instead of presenting a partial list as complete. Voice reports source identity, retrieval time and counts; full structured context is the MCP tool result.

This route is a supplemental read path, not an Epic-backed assignment provider. Document **references** are retrieved; Binary content and administration reconciliation are not part of this command. No inferred acuity, admission date or primary diagnosis is exposed by the new tool. No automatic crosswalk from synthetic local patients to Epic patients exists. Local task custody stays in SQLite. Do not enable the legacy full-provider switch: hospital task/encounter/identity mappings remain unverified.

Reviewed-note publication exists separately in the repository. Live HTTP/MCP publication defaults to disabled (`EPIC_WRITES_ENABLED=false`). Do not infer that filling an API key grants note-write access: patient/encounter linkage, approved note types, hospital payload validation and ambiguous remote-commit reconciliation must be verified before explicitly enabling it. The deploy smoke test makes no external writes. This delivery does not establish live Epic interoperability or hospital production authorization.

## 5. Backup, restore and updates

```sh
docker compose exec app node build/scripts/backup.js /app/backups/demo-before-update.db
docker compose cp app:/app/backups/demo-before-update.db ./demo-before-update.db
```

The online backup API produces a consistent SQLite snapshot. Copy it off the host to durable storage; another volume on the same host is not a disaster-recovery solution. Retention and encryption are deployment responsibilities. Do not copy just the live `.db` while ignoring its WAL.

For restore, stop the app first, preserve the current data directory, restore the snapshot into a fresh volume as `shiftweave.db`, give UID 1000 ownership, update Compose to use that volume, and start one replica. Do not leave WAL/SHM files from the previous database alongside the restored snapshot. Run the smoke test and resume a known demo workflow. Restoring an older backup can lose later acknowledgements; the application cannot guarantee zero data loss after disk loss or rollback.

For an update: back up, rebuild, then `docker compose up -d`. Startup uses additive schema initialization, not destructive reset. SIGTERM allows up to 25 seconds for HTTP work to drain; interrupted longer work is reconciled from checkpoints on retry.

## 6. Judging demonstration and evidence

1. Introduce Seema; show the task screen and source labels.
2. Say “Ask assistant, summarize my shift”; inspect MCP discovery/tool calls and `LLM:DECISION` timings. Use Bedrock only when a real successful provider call is visible.
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
