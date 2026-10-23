# Update guide for the existing EC2 deployment

Prepared 23 October 2026 from the deployment files supplied by the owner. Commands below are for the owner's build/deployment environments; none were run against EC2. This repository is a synthetic-data demonstration with Epic integration, not a verified clinical production system.

## Keep the existing infrastructure

Keep instance `i-08e66aa7d1bdd0c6c`, `t4g.medium` ARM64, ECR in `us-west-2`, domain `32.189.84.182.nip.io`, Caddy ports 80/443, and the mounted encrypted EBS filesystem. No PostgreSQL, HAPI server, new database, new domain, new login system, load balancer or additional service is required for SQLite simulation.

Keep all of these directories in place:

| Host path | Container use |
|---|---|
| `/mnt/shiftweave/storage` | `/app/storage`, including `shiftweave.db` and SQLite WAL/SHM |
| `/mnt/shiftweave/backups` | `/app/backups`, consistent backups |
| `/mnt/shiftweave/keys` | `/run/epic:ro`, existing Epic private key |
| `/mnt/shiftweave/caddy-data` | Caddy `/data`, current certificates |
| `/mnt/shiftweave/caddy-config` | Caddy `/config` |
| `/mnt/shiftweave/.env.deploy` | App-only secret environment |
| `/mnt/shiftweave/Caddyfile` | Current unchanged Caddy configuration |

Continue running one app process/container against this SQLite file. Do not run several app replicas against it: transport sessions, source capabilities and voice concurrency locks are process-local. Durable workflows survive a restart, but clients must initialize a new MCP transport session and reuse their saved logical voice/workflow IDs and exact retry requests.

## Material changes since image 2026-10-23-006

| Change | Required deployment action |
|---|---|
| Synthetic hospital persists in the original database | Explicit, backed-up hospital import; do not replace the server database with the developer's local DB |
| Fixtures now required by provisioning | New Dockerfile includes `data/hospital/*` and `data/simulations/catalog.json` |
| Production images omit dev dependencies | New TypeScript build includes `setup-hospital.js`, `verify-configured-hospital.js`, and `verify-mcp-independent.js`; no `tsx` needed inside the image |
| Epic/preview isolation | Deploy the latest server/services together; enabling preview in the older image does not provide the new boundary |
| Additional tables/checkpoints | Additive initialization/provisioning; local configured DB currently has 30 application tables, not the historical 23. Do not enforce table count as a migration test |
| Natural-language voice now plans once | Keep `LLM_PROVIDER=bedrock` and the tested Sonnet model; do not select `mock` in production |
| Bedrock SDK client pooling | Clean shutdown now closes shared SDK clients; no patient context is cached in them |
| Graceful shutdown | New Docker CMD uses `exec node` after preflight so Node receives termination signals; retain init and 30-second grace period |
| Caddy currently receives all app secrets | New EC2 Compose template passes only DOMAIN to Caddy; app keeps its existing env_file |
| Expanded ignore rules | Secrets, nested databases/backups, staff credentials and evidence screenshots stay out of Docker build context |

`source_identifiers` and `dashboard_voice_sources` separate source/session/retry state; `hospital_patients` and `hospital_fhir_resources` hold synthetic context; `simulation_catalog`, `simulation_runs` and `simulation_results` hold scenarios and outcomes. Existing patient/task/assignment/handoff/checkpoint tables are reused. Ordinary restarts never seed hospital records.

## Environment changes

Preserve current secret values. Merge required names into the existing `.env.deploy`; never overwrite it with the example file.

```dotenv
APP_IMAGE=540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave:YOUR_NEW_IMMUTABLE_TAG
DOMAIN=32.189.84.182.nip.io
PUBLIC_ORIGIN=https://32.189.84.182.nip.io
LLM_PROVIDER=bedrock
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6
SIMULATION_MODE=false
HOSPITAL_DATA_SOURCE=sqlite
HOSPITAL_SIMULATION_ENABLED=true
EPIC_WRITES_ENABLED=false
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

Your EC2/ECR region remains `us-west-2`; `AWS_REGION=us-east-1` here selects the existing Bedrock runtime. Do not change it to match ECR accidentally. Keep your approved `ELEVENLABS_VOICE_ID` if set; rotating API keys does not require replacing an agent in the same workspace. An agent ID is optional for normal streaming TTS. Keep keys server-side.

The owner explicitly selected the public synthetic preview profile: use `STAFF_AUTH_REQUIRED=false` with `HOSPITAL_SIMULATION_ENABLED=true`. Anyone can open the preview without staff sign-in; spoken nurse selection is demo identity, not authenticated nurse identity. Apply those values to the preview deployment's environment. Current preflight intentionally rejects combining staff-auth mode with hosted hospital preview; do not remove that guard or existing staff security code. No staff records/accounts are removed, and external MCP retains service-token authorization.

`EPIC_READS_ENABLED` remains your explicit choice. With configured credentials and allowlisted patient IDs, Epic tools call Epic; failures do not use synthetic fallback. Enabling Epic reads prevents the guided "Epic unavailable" scenario from injecting that condition; its refusal is expected. Keep writes disabled unless target-environment permission and exact-note review are separately verified. Preserve `EPIC_CREATE_REVIEW_TASKS` based on the chosen workflow; it creates local coordination tasks, not generic Epic bedside tasks.

Keep `EPIC_CLIENT_ID`, `EPIC_KID`, endpoint URLs, `EPIC_TEST_PATIENT_IDS`, key passphrase and key mount. For initial Epic synchronization before mappings exist, set `EPIC_DEMO_NURSE_ID` and `EPIC_DEMO_SHIFT_ID` to actual existing non-synthetic database IDs; names are insufficient. Do not use the example legacy IDs without checking. Keep `MCP_AUTH_TOKEN` stable if clients must continue using it. If using temporary AWS credentials, supply `AWS_SESSION_TOKEN` too.

No changes to IMDS are required if current credentials work. If adopting an EC2 IAM role later, verify container access while retaining IMDSv2; AWS recommends a response hop limit of 2 for containers. [AWS documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-new-instances.html)

## Build and pre-release checks (build environment)

Review/commit the complete intended source tree first. Do not rebuild tag `2026-10-23-006` in place. On the repository checkout:

```sh
npm ci
npm --prefix client ci
npm run typecheck
npm test
npm run test:deployment
npm run test:hospital
npm run test:source-isolation
npm run build
npm run test:runtime-package
```

The compiled runtime test provisions only a temporary database, verifies repeat provisioning preserves updated tasks and does not duplicate the initial handoff, starts the compiled production server with plain Node, and connects an independent compiled MCP client. It does not prove the ARM64 image or cloud credentials work.

Build native dependencies for Linux ARM64; do not copy Windows node_modules. The Docker build stage installs and compiles dependencies inside the target image. Buildx can select ARM64 explicitly. [Docker documentation](https://docs.docker.com/build/building/multi-platform/)

```sh
REGISTRY=540087632943.dkr.ecr.us-west-2.amazonaws.com
TAG="$(git rev-parse --short=12 HEAD)"
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build --platform linux/arm64 --tag "$REGISTRY/shiftweave:$TAG" --push .
```

Test/inspect the resulting image on ARM64 before using it. Keep the built image tag/digest and source commit in your release record. This guide does not claim the image was built or pushed.

## Safe update sequence (owner's EC2 host)

Use a short maintenance window. Build and, where practical, pre-pull the new immutable image before stopping the app to reduce downtime. All commands below use the same existing Compose project `shiftweave`. They are not intended to be pasted without replacing/reviewing the release-specific values.

1. Verify `/mnt/shiftweave` is the intended EBS mount, sufficient space exists and the database is present. Check with `findmnt -T /mnt/shiftweave`, `df -h /mnt/shiftweave`, and `test -f /mnt/shiftweave/storage/shiftweave.db`. Preserve UID 1000 read/write access to storage/backups and read access to the existing private key; do not use chmod 777.
2. Record the currently running image digest and preserve the existing Compose, Caddyfile and `.env.deploy` with restrictive permissions. Do not print populated env files or expanded Compose output in logs/chat; `docker compose config --quiet` is sufficient.
3. Stop the existing app before migration and create a consistent backup with the OLD Compose/image. Caddy can stay running; it may report a temporary upstream failure during maintenance.

```sh
cd /mnt/shiftweave
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp -p compose.yaml "backups/compose-before-$STAMP.yaml"
cp -p .env.deploy "backups/env-before-$STAMP"
chmod 600 "backups/env-before-$STAMP"
cp -p Caddyfile "backups/Caddyfile-before-$STAMP"
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave stop app
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave run --rm --no-deps app node build/scripts/backup.js "/app/backups/pre-update-$STAMP.db"
```

Do not copy a live `.db` without its WAL. The bundled backup uses SQLite's backup API. Also retain an appropriate EBS snapshot/recovery procedure. [SQLite backup documentation](https://www.sqlite.org/backup.html)

4. Copy reviewed `deploy/compose.ec2.yaml` from the new release to `/mnt/shiftweave/compose.yaml`. This preserves all supplied host bind paths; **do not replace it with the root named-volume compose.yaml**. Merge the environment changes above, including APP_IMAGE. Keep the current Caddyfile and certificate directories. Authenticate ECR on this host if needed, then:

```sh
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave config --quiet
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave pull app
```

On the ARM64 host, verify Node and the native SQLite module in the new image before importing data:

```sh
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave run --rm --no-deps app node --input-type=module -e 'import Database from "better-sqlite3"; if(process.arch!=="arm64"||!process.versions.node.startsWith("24."))process.exit(1); const d=new Database(":memory:"); console.log({architecture:process.arch,node:process.versions.node,sqlite:d.prepare("select sqlite_version() AS version").get()}); d.close();'
```

5. If this is the chosen public synthetic preview profile, provision hospital data into the existing mounted database using the new image. Do not run `db:init`, `import:data`, `sandbox:setup`, `simulation:setup`, `db:clean`, or `npm run setup` as a production update. Do not upload the developer's populated database over the hosted file.

```sh
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave run --rm --no-deps app node build/scripts/setup-hospital.js
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave run --rm --no-deps app node build/scripts/verify-configured-hospital.js "/app/backups/pre-update-$STAMP.db"
```

The import takes its own additional backup under `/app/storage/backups`, uses namespaced records/receipts and preserves existing records. Ordinary repeat runs do not reset workflow updates or create another initial handoff. Do not pass `--restore-fhir` unless deliberately restoring synthetic resource content. If the hospital has already been provisioned, verification still permits additional records and handoffs.

For Epic-only/staff profiles, skip synthetic provisioning and keep `HOSPITAL_SIMULATION_ENABLED=false`; do not run the hospital-specific verifier against an unseeded Epic-only DB.

6. Check preflight, start the app, then recreate Caddy with its reduced environment. This retains the current certificate directories and domain.

```sh
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave run --rm --no-deps app node build/scripts/preflight.js
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave up -d app
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave up -d https
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave ps
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave exec -T app node build/scripts/smoke.js
```

7. Verify the public endpoint with the independent compiled client (service token comes from app environment; it is never placed in the command text):

```sh
docker compose --env-file /mnt/shiftweave/.env.deploy -p shiftweave exec -T app node build/scripts/verify-mcp-independent.js https://32.189.84.182.nip.io/mcp
```

For the public preview profile, expect 15 external Epic tools, no hospital claim/source/scenario controls, and rejection of `hospital:task:paperwork` through the external MCP client. Staff-auth deployments require their existing staff session as well; the machine-token-only independent verifier is intended for the public preview/service-token profile.

8. In the browser, open HTTPS, identify Seema/Jordan and verify task/patient follow-ups. Confirm/cancel a synthetic task proposal and check a subsequent read. Test microphone permission, interruption, streaming speech and missing-data handling. In a separate authorized MCP client, verify an allowlisted Epic read and visible permission/service failures. These are actual target-host checks, not covered by a process-only health probe.

## Isolation, latency and remaining limits

External `/mcp` defaults Epic. Preview access requires a private process-local capability used only by the server's loopback bridge. Untrusted headers/client names cannot choose preview. Data-source filters, source-scoped IDs/receipts/checkpoints and separate fingerprints prevent tested cross-source reads/retries. The same physical SQLite file contains both sources; this is application-level isolation, not separate encryption, independent tenants or proof of healthcare compliance. A service bearer token is service authorization; a spoken nurse name is not identity authentication. Use authorized synthetic/test Epic data in this demonstration.

Clinical reads call the configured Epic APIs. Generic local coordination tasks remain in SQLite; this update does not add a verified generic Epic Task write API or confer missing Epic permissions. Reviewed note publishing stays separately gated. Keep the existing key/JWKS registration and verify target permissions after deployment.

The public synthetic voice/TTS companion routes intentionally accept demo users without staff sign-in and can incur Bedrock/ElevenLabs usage. The service token on `/mcp` is not an abuse-control policy for those public companion routes. Spending/traffic limits and the intended reviewer audience still need owner review before broad public exposure; no new login or rate-limit system was added in this cleanup.

Ordinary voice requests now use one semantic model call; combined introductions carry a validated next-operation plan. Final clinical/workflow facts come from the actual backend result. General conversation remains LLM-generated. SDK pooling stores connections/credentials, not nurse context. Do not enable a second process merely to warm connections. Local samples were roughly 1.5–2.9 seconds backend on optimized runs, with occasional first-request outliers above 6 seconds; the 1.5-second sentence pause and TTS/playback are additional. Re-measure on EC2; a strict 4-second maximum is not guaranteed.

One pre-existing guided scenario intentionally requires Epic reads disabled; it refuses to inject an outage when live reads are enabled. The optional compose.hospital.yaml (HAPI/PostgreSQL) is retained but unnecessary for this deployment; it was not validated on this ARM64 target. Do not enable it for the SQLite path.

## Rollback and preservation

Never use `docker compose down -v`, remove the EBS mount, delete database sidecars while a process is active, remove certificate directories or discard backups as part of cleanup. Do not run filesystem/DB cleanup scripts against production merely to reduce file count.

Keep the old image/config/consistent DB snapshot together. Rolling back code to the old image also rolls back the new isolation guarantees; do not expose the old preview-enabled MCP against the new shared database. Stay in maintenance until the restored profile is verified. A database restore can discard all actions since the snapshot; preserve the latest state and reconcile that risk before restoring. Restore only with all writers stopped, into a separate clean location, with matching permissions and without unrelated old WAL/SHM files. Do not automatically restore an older database just because a new image fails to start.

## Verification status

Repository production-config and compiled-runtime checks are recorded in CLEANUP_REPORT.md and memory.md. Docker/ARM64 image build, ECR push, remote migration, TLS issuance, remote microphone/audio and live Epic authorization remain owner-environment verification steps. No changes were applied to EC2 during this cleanup.
