# Repository cleanup and production-package review

Reviewed 23 October 2026. The deployment owner supplied the actual EC2 Compose/Dockerfile/Caddy configuration. No EC2, ECR, Docker service, remote database, key or certificate was changed. Local Docker checks were stopped when the owner clarified that deployment is managed in another environment.

## Removed files

Repository-wide reference checks found no runtime/build/test consumers of these files:

| File | Why removed | Bytes |
|---|---|---:|
| `install.sh` | Installer for unrelated `px0-ai/px0` software; not a ShiftWeave installer | 9,309 |
| `install.sh~` | Byte-identical editor backup of that installer | 9,309 |
| `client/src/assets/vite.svg` | Unreferenced starter asset | 8,710 |
| `client/src/assets/typescript.svg` | Unreferenced starter asset | 1,304 |
| `client/src/assets/hero.png` | Unreferenced starter asset | 13,057 |
| `client/public/icons.svg` | Unreferenced starter icon sheet; current favicon retained | 5,055 |

Total: 46,744 bytes from six tracked files. The two installer SHA256 hashes both matched `A03ECA43D396F0E2F6E7655D932BF3D0D8425D1C9BB8D0416EA95A69D9D5A9D7`. They were read, not executed. Git retains their history; no reset/clean or bulk directory deletion was used.

Removed the unused frontend `dev_assist: file:..` dependency and its parent/link lockfile metadata. It was never imported by the frontend and unnecessarily linked the backend into the client dependency graph. React, ReactDOM, lucide-react, backend dependencies and both lockfiles' required versions were preserved. A fresh client lockfile install in an isolated temporary directory passed offline.

## Files and directories intentionally preserved

- All patient/nurse/task/handoff records, SQLite databases, WAL/SHM files, original database backups and schema history. The configured local database was queried read-only and reports 30 application tables with integrity `ok`; table count alone does not prove every feature works.
- `.env`, real deployment secrets, `.sandbox` staff credentials, Epic private keys/JWKS configuration, Caddy state and operational evidence.
- All backend/voice/MCP/Epic services, staff workspace/authentication code, clinical guardrails, workflow checkpoints and recovery logic.
- All tests, fixtures, simulation catalog, hospital resources, optional FHIR adapter and optional HAPI/PostgreSQL Compose file. The optional stack is not required for the current SQLite deployment and was not ARM64-verified.
- Required fonts and their license files, current favicon, CSS and active workspace UI. The production JS/CSS output hashes remained unchanged after unused-asset cleanup.
- Project instructions, original DOCX specifications, historical architecture/schema/API documents, memory, reviewer evidence and other reports. These are source/context/evidence, not all runtime dependencies; the Dockerfile already selects a narrower runtime artifact set.
- Existing node_modules and generated build/dist needed for ongoing local work. A Windows native dependency was locked during an attempted clean install; an offline incremental install restored/verified the working tree, and a separate clean temporary install validated the cleaned manifests. Locked generated binary leftovers were not forcibly removed or treated as source files.

`data/shiftweave.db` was already tracked before this cleanup. Adding a `.gitignore` rule does not untrack it. Its contents/history were left intact under the owner's critical preservation instruction. It is excluded from Docker context/images; future untracking/redaction is a separate reviewed data-retention action.

## Deployment defects fixed in the repository

| Confirmed issue | Change |
|---|---|
| Built production tree omitted the documented hospital provisioner | `tsconfig.build.json` now emits setup-hospital and two production verification scripts |
| Old deployed image lacked synthetic fixture files | Current Dockerfile includes hospital resources/workflow and scenario catalog; it copies only catalog JSON, not the review screenshot |
| Hosted env example selected mock although runtime rejects it | `.env.deploy.example` now uses Bedrock, explicit source flags, optional speech settings and a required owner-supplied image reference |
| Docker context could include `.sandbox`, nested database backups and unnecessary evidence | Expanded `.dockerignore`; no secrets/DBs deleted |
| Default Compose did not match the supplied EBS bind mounts | Added `deploy/compose.ec2.yaml` for the exact existing host paths; retained root Compose for its separate named-volume use |
| Caddy inherited all application credentials through env_file | Both templates pass only DOMAIN to Caddy; app still receives its env_file. Use Compose --env-file for DOMAIN interpolation |
| npm wrapper made production signal propagation less direct | Docker CMD now runs preflight then execs Node; non-root UID, health check and service grace period remain |
| Deployment test inherited the developer's enabled/unpopulated hospital profile | Explicit isolated source flags; production-config tests now pass regardless of local preview setting |
| Configured dataset verifier rejected legitimate added records/handoffs | Baseline population is a lower bound; extra rows are retained, integrity/foreign-key checks remain |
| Deployment/architecture prose described obsolete keyword-gated voice and Gemini | Updated current flow, production provider requirements, source distinction and handover links |

## Verification performed

| Check | Result |
|---|---|
| `npm run typecheck` | Passed after runtime-check fixture fixes |
| `npm run build` | Backend and frontend passed after cleanup; required compiled runtime files present |
| `npm test` | 194 meaningful isolated checks passed |
| `npm run test:hospital` | 18 isolated hospital checks passed; all 15 preview tools exercised |
| `npm run test:source-isolation` | 11 source-boundary checks passed |
| `npm run test:deployment` | Hosted config/origin/auth/MCP, mocked Epic error/idempotency, consistent-backup groups passed |
| `npm run test:runtime-package` | Compiled provisioner, preserved updates/additional records, no duplicate initial handoff, plain-Node production server/readiness/dashboard and independent Epic-default MCP passed |
| Fresh frontend install | Passed in a disposable directory, using only cleaned package.json/lockfile and npm's offline cache |
| Database inspection | Read-only, integrity ok; no application dataset was reset |

These checks did not build/run a Docker image, verify Node 24 ARM64 native modules, push ECR, issue TLS certificates, exercise physical microphone/headset playback, or establish current live Epic permissions. Those require the owner's deployment environment and are explicitly listed in [the update guide](deploy/UPDATE_CHECKLIST.md).

## Release handover

Start with [deploy/UPDATE_CHECKLIST.md](deploy/UPDATE_CHECKLIST.md). It covers the exact old/new deployment differences, required flags and profile decisions, ARM64 build/ECR commands, maintenance/consistent backups, additive import into the existing hosted database, startup, public MCP isolation tests, browser verification and rollback limits. Review/copy [deploy/compose.ec2.yaml](deploy/compose.ec2.yaml) into the host setup; do not apply the root Compose file over EBS bind mounts.
