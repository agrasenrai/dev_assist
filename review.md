# ShiftWeave — Critical Technical Review

**Date:** 23 October 2026 · **Baseline:** `603fd97` · **Scope:** repository/local verification, not an AWS-account or clinical certification audit

## Executive assessment

ShiftWeave implements considerably more than a static Q&A wrapper: actual MCP discovery, multi-turn durable state, explicit local custody, atomic receipts/checkpoints, source reconciliation and process-restart recovery. Current offline checks pass. Synthetic hospital answers use database records; external Epic MCP and trusted preview are separated in tested paths.

**Release decision:** appropriate for a controlled synthetic-data reviewer demonstration after target-host acceptance. This is **not approval for real-patient clinical use**, unrestricted public paid-service consumption, or proof that the latest repository is deployed. A corrupted tracked default database and remaining operational/security gaps require attention.

[DOCUMENTATION.md](DOCUMENTATION.md) is the current operations guide. [FRICTION_LOG.md](FRICTION_LOG.md) preserves engineering history. This replaces the older review's now-outdated claims of keyword-only voice routing, split dialogue and absent voice interruption.

## Scope, methodology and evidence

The review inventoried first-party Markdown, nested deployment/ingestion/skill records; inspected source layers, executable schemas, scripts, manifests/lockfiles, environment templates and Docker/Compose/Caddy; compared Git evolution from 12–23 October and dated reports with current code; read only environment names; and checked local databases read-only. Private configuration values are not reproduced.

Typecheck/build and isolated routine suites were executed. Application code was not changed. No paid model/TTS request, live Epic call, AWS API query, deployment, destructive operation, dependency advisory lookup, physical audio or ARM64 container test was performed.

Evidence labels distinguish **confirmed test result**, **confirmed code condition**, **historical observation** and **risk/evidence gap**. A source inconsistency is not automatically a reproduced exploit. Severity is profile-dependent: anonymous synthetic demonstration and real clinical use have different consequences.

## Architecture and code quality assessment

| Strength | Evidence and assessment |
|---|---|
| Transport | [server.ts](src/server.ts): actual Streamable HTTP, protocol minimum, per-session factory, token/origin checks and official-SDK interoperability |
| Local atomicity | [mutation.service.ts](src/services/mutation.service.ts): immediate SQL transaction binds domain changes, canonical request, actor, receipt, checkpoint and audit |
| Recovery | [orchestrator.ts](src/agent/orchestrator.ts), [recovery.service.ts](src/services/recovery.service.ts): planned intent/results and source reconciliation; selected real process-exit windows tested |
| Isolation | [source-context.ts](src/services/source-context.ts), [source-policy.ts](src/services/source-policy.ts): immutable realms, private preview capability, scoped aliases/workflows/queries and fingerprints |
| Human authority | [handoff.service.ts](src/services/handoff.service.ts), [conflict.service.ts](src/services/conflict.service.ts): draft, custody, task state and external publication are distinct; stale/incomplete proposals rejected |
| Voice grounding | [voice-agent.service.ts](src/services/voice-agent.service.ts): semantic intent, backend validation, lazy clinical context and durable shared history |
| Simulation integrity | [hospital.service.ts](src/services/hospital.service.ts), [hospital-store.ts](src/providers/hospital-store.ts): explicit provisioning, SQL-backed FHIR resources, confirmed self-claim and no Epic-to-synthetic failure fallback |
| Publication safety | [epic-note.service.ts](src/services/epic-note.service.ts): exact reviewed hash, single-patient binding and durable uncertain-state handling |
| Packaging | [Dockerfile](Dockerfile): compiled production provisioner/verifiers and fixtures, non-root app, health check and graceful Node signal path |
| TTS diagnostics | [elevenlabs.service.ts](src/services/elevenlabs.service.ts): provider bodies excluded from sanitized TTS errors/logs; visible fallback |

The large server and voice service mix protocol, routing, state resolution and rendering. Existing layers help, but multiple modes and the legacy chat orchestrator increase regression burden. Incremental separation with contract tests is preferable to a pre-submission rewrite. Prompts support interpretation; they are not authorization or evidence.

Synchronous SQLite fits current SQL joins and local atomicity, with one writer and event-loop blocking during SQL work. Process-local locks, transport sessions and source capabilities make arbitrary horizontal scaling unsupported. Controlled workflow speech is intentionally templated with dynamic records, even under Bedrock; general conversation is model-generated. This trade-off limits free clinical paraphrasing without making the task list static.

## Epic transition assessment

Epic Sandbox originally supplied a non-production clinical interoperability target. The dated seven-patient assessment returned useful encounters/conditions/allergies/orders but no administration/document records, several operational-resource calls were denied, and approved clinical-note creation returned 403. These are findings about the tested client/query/cohort, not universal Epic policy or an established precise cause of denial.

The adopted hospital simulation supplies controlled staff/tasks/clinical context/discrepancies/recovery cases. It stores FHIR-shaped resources and operational state in the configured SQLite file. Epic OAuth/endpoints/read/note services remain intact. Synthetic success proves application workflow behavior, not authenticated clinician access, current hospital census, medication administration or Epic publication. An earlier staff sandbox and local-review catalog remain distinct profiles. See FL-010, FL-013, FL-014 and R-08.

| Transition aspect | Review conclusion |
|---|---|
| Replaced for public preview | Dependence on the limited Epic cohort; preview now uses explicitly synthetic clinical/workflow records |
| Retained | Epic endpoints, OAuth/JWKS/key settings, allowlisted reads, snapshots, reviewed publication implementation and failure visibility |
| Reused | Actual SQLite assignments, tasks, events, handoffs, receipts and checkpoints; not a parallel pretend-success service |
| Deliberately simulated | Initial hospital staff, patients, shift, task/status mix, disagreement and outage/recovery scenario inputs |
| Explicit local mock | Free deterministic agent remains opt-in locally; hosted production requires Bedrock, and cloud failure does not silently activate mock |
| Deferred | Institution-specific identities/rosters/task contracts, authorized successful Epic note create/readback and clinical governance |
| Benefit | Reproducible missing/conflict/update/retry coverage without requiring clinical side effects |
| Cost of decision | Small curated shared dataset, fixed initial scenario data and no automatically evolving external hospital feed; same-file scoping is not physical tenant isolation |

The recorded reason is demonstrated coverage/access gaps for this client and cohort. It is a technical inference that a curated SQLite source simplifies reliable demo operations; it is not evidence that Epic generally cannot support such workflows. Real-world interoperability still needs the separate R-08 acceptance gate.

## AWS and security assessment

The owner-reported deployment is one ARM64 `t4g.medium` EC2 host in `us-west-2`, encrypted EBS mounted at `/mnt/shiftweave`, private ECR image delivery, Caddy TLS and Bedrock configured in `us-east-1`. Current templates preserve the mounts, use non-root UID 1000, drop capabilities and give Caddy only its domain environment. This topology fits the implemented single-process SQL/session model.

No current instance/volume/KMS policy, IAM role, security group, route, certificate, patch/image scan, off-host backup or alarm inventory was verified. No Terraform/CloudFormation/CDK or CI workflow establishes those resources in this repository. Do not draw RDS/DynamoDB/ALB/WAF/CloudWatch as deployed resources without evidence.

Public synthetic preview is explicitly intended and should not be “fixed” by adding a new login. It still needs capacity/spending/request-boundary controls. A service bearer authenticates a trusted service, not a nurse. EBS encryption, TLS and checkpoints do not independently establish HIPAA compliance, clinical authorization, high availability or universal zero loss.

## Verification performed now

| Check | Result and boundary |
|---|---|
| Typecheck / production build | Passed backend and frontend |
| `npm test` | 220 isolated checks passed; controlled model responses, not live Bedrock |
| `npm run test:hospital` | 20 passed; all 15 preview tools and six scenarios |
| `npm run test:source-isolation` | 11 passed; controlled HTTP Epic contract, not live Epic |
| `npm run test:deployment` | Passed config/auth/origin/partial-page/backup groups; no EC2 deployment |
| `npm run test:runtime-package` | Passed compiled plain-Node provisioner/server/client with temporary DB; not ARM64 Docker |
| Configured local DB, read-only | Healthy quick check, zero FK violations; 3 hospital nurses, 3 patients, 9 tasks, 17 FHIR resources |
| Tracked legacy DB, read-only | `SQLITE_CORRUPT` |

Historical live Bedrock 21-question and Jordan 13-turn successes are recorded in memory/test guides; earlier provider and validation failures remain relevant. No fresh inference or audio test was run here. Test counts overlap concerns and do not form an additive coverage percentage.

## Findings register

Priorities: **P0** before clinical use; **P1** before broad public submission exposure; **P2** scheduled hardening. Stable IDs cross-reference the friction log. No application fix below was implemented in this documentation-only change.

<a id="r-01"></a>
### R-01 — Anonymous preview can consume paid capacity without abuse controls

**Severity:** High · **Priority:** P1 · **State:** confirmed code condition; load/cost impact unmeasured

**Evidence/files:** [server.ts](src/server.ts), [runtime-config.ts](src/runtime-config.ts), [elevenlabs.service.ts](src/services/elevenlabs.service.ts). Public voice/TTS/ConvAI routes are intentionally accessible; only staff login has an attempt limiter. TTS lacks an explicit text-length ceiling, voice/model allowlist and provider cancellation deadline. The general JSON body cap does not replace these controls.

**Impact:** quota/spending exhaustion and response degradation. Origin checks do not stop direct callers; MCP service-token protection does not protect every companion API.

**Fix:** retain anonymous preview but define size/model/voice/concurrency/traffic limits, cancellation budgets and owner-approved spend alerts. Disable unused optional paths rather than adding another login.

**Acceptance:** oversized/disallowed requests fail before provider calls; synthetic load stays within bounded concurrency; stalled calls expire; budgets/alarms have an owner. **History:** [FL-016](FRICTION_LOG.md#fl-016), [FL-019](FRICTION_LOG.md#fl-019).

<a id="r-02"></a>
### R-02 — Corrupted tracked default DB can break a fresh checkout

**Severity:** High · **Priority:** P1 · **State:** confirmed read-only failure

**Evidence/files:** `git ls-files` contains [data/shiftweave.db](data/shiftweave.db), whose read-only quick check raised `SQLITE_CORRUPT`. [.env.example](.env.example) and [connection.ts](src/db/connection.ts) default to this path. The configured workflow DB is different and healthy. Ignore rules do not untrack existing files.

**Impact:** new users can start with broken state; copying it over EBS state risks destroying useful data. No new corruption of the configured DB was observed.

**Fix:** preserve diagnostic evidence, remove the artifact from normal distribution in a reviewed follow-up, and make a fresh explicit provisioning path canonical. Never overwrite hosted DB from a developer checkout.

**Acceptance:** clean checkout provisions a healthy DB; repository/image excludes populated databases; existing host retains its original healthy persistent file. **History:** [FL-009](FRICTION_LOG.md#fl-009), [FL-020](FRICTION_LOG.md#fl-020).

<a id="r-03"></a>
### R-03 — Provider/error minimization remains incomplete outside TTS

**Severity:** High with clinical content; Medium for synthetic demo · **Priority:** P1 · **State:** confirmed code paths; no actual secret leak asserted

**Evidence/files:** [server.ts](src/server.ts) global handler returns/audits raw `error.message` and logs MCP exceptions; [epic-oauth.service.ts](src/providers/epic-oauth.service.ts) retains upstream OAuth descriptions/raw failure text; [mutation.service.ts](src/services/mutation.service.ts) audits non-voice request/response payloads. TTS has a narrower sanitized implementation.

**Impact:** internal paths, source content or sensitive context may enter errors/durable audit storage. Existing targeted redaction checks do not prove universal minimization.

**Fix:** typed public errors and internal correlation IDs, bounded/redacted upstream diagnostics, explicit audit retention/access. GET TTS also carries text in query strings; prevent sensitive query logging.

**Acceptance:** injected sentinel secrets/record text never reach public errors or inappropriate logs; useful explicit failure categories remain; retention reviewed. **History:** [FL-016](FRICTION_LOG.md#fl-016).

<a id="r-04"></a>
### R-04 — Optional ConvAI handlers diverge from validated voice scoping

**Severity:** High if exposed with clinical mappings · **Priority:** P1 · **State:** confirmed structural inconsistency; exploit not reproduced

**Evidence/files:** [server.ts](src/server.ts), `/api/convai/tools`, directly reads/calls voice services with body/default IDs, bypassing the standard UUID `voiceInput` and scoped MCP argument wrapper. Defaults include shared `convai-session` and timestamp keys. No provider webhook-signature check is present in that handler; session endpoint can issue signed URLs in anonymous preview.

**Impact:** inconsistent source/revision/idempotency/session validation and possible collisions or unintended access. Tested main MCP isolation does not certify this optional path.

**Fix:** reuse validated/scoped transport/service contracts, require valid independent IDs and appropriate provider authorization, or disable unused ConvAI routes for the release profile.

**Acceptance:** forged/wrong-realm/staff/default IDs and unauthenticated webhook calls fail before reads/actions; valid requests remain recoverable. Do not claim a demonstrated cross-patient leak. **History:** [FL-012](FRICTION_LOG.md#fl-012), [FL-014](FRICTION_LOG.md#fl-014).

<a id="r-05"></a>
### R-05 — Initial failed Epic sync can lack a durable patient failure row

**Severity:** Medium · **Priority:** P1 · **State:** confirmed source logic; not reproduced live here

**Evidence/files:** [epic-workflow.service.ts](src/services/epic-workflow.service.ts), `EPIC_SYNC_FAILURE`, updates `epic_patient_snapshots`; a first-time patient has no row to update. Top-level receipt/result still reports failure, so this is not a wholly silent failure.

**Impact:** later snapshot-based display may omit the failed patient and lose useful per-patient diagnosis of the integration problem.

**Fix:** persist sync attempts independently of successful clinical imports, or safely represent failure without inventing mandatory patient data.

**Acceptance:** initial failed fetch remains visible after restart; retry works without fabricated facts or duplicate records. **History:** [FL-008](FRICTION_LOG.md#fl-008), [FL-010](FRICTION_LOG.md#fl-010).

<a id="r-06"></a>
### R-06 — Current AWS runtime/security state is not verified

**Severity:** High for release confidence · **Priority:** P1 · **State:** evidence gap, not asserted AWS misconfiguration

**Evidence/files:** [Dockerfile](Dockerfile), [EC2 template](deploy/compose.ec2.yaml), [update guide](deploy/UPDATE_CHECKLIST.md); no current AWS exports/IaC or target image execution. Compiled local runtime is not native ARM64 container validation.

**Impact:** mounts, native modules, key permissions, model IAM, TLS, security groups and latest release may differ from supplied descriptions. EC2/ECR and Bedrock regions intentionally differ.

**Fix:** owner records sanitized resource/IAM/network configuration, immutable digest/source commit, ARM64/Node 24/SQLite probe, actual bind mounts and HTTPS/MCP/provider acceptance.

**Acceptance:** target checklist passes without exposing secrets; port 3000 is private; model/KMS permissions and release provenance reviewed. **History:** [FL-015](FRICTION_LOG.md#fl-015), [FL-020](FRICTION_LOG.md#fl-020).

<a id="r-07"></a>
### R-07 — Single-host checkpoint recovery is not disaster recovery

**Severity:** High for real operations; Medium for submission · **Priority:** P1 backup plan, P2 availability redesign · **State:** confirmed topology/missing evidence

**Evidence/files:** [connection.ts](src/db/connection.ts), [backup.ts](scripts/backup.ts), Compose; backup directories share the host; no off-host schedule, restore evidence or operational alarms. Locks/sessions are process-local. Receipt/checkpoint/audit history grows without a coordinated retention policy.

**Impact:** disk/host loss, full disk or backup rollback can lose later actions; synchronous queries can block requests. No universal zero-loss or multi-AZ guarantee is established.

**Fix:** define RPO/RTO, encrypted off-host retention, restore rehearsal and capacity alerts. Keep one writer host; do not share WAL on NFS or independently prune recovery receipts.

**Acceptance:** clean-location restore passes integrity/isolation/workflow replay; measured objectives and alarms recorded. **History:** [FL-003](FRICTION_LOG.md#fl-003), [FL-009](FRICTION_LOG.md#fl-009), [FL-015](FRICTION_LOG.md#fl-015).

<a id="r-08"></a>
### R-08 — Real clinician identity and Epic interoperability remain incomplete

**Severity:** Critical blocker for real-patient use; known demo limit · **Priority:** P0 clinical gate · **State:** historical external denial plus implemented demo boundary

**Evidence/files:** [Epic assessment](EPIC_SANDBOX_ASSESSMENT.md), [write report](deploy/epic-write-report.json), [epic-note.service.ts](src/services/epic-note.service.ts), [source-policy.ts](src/services/source-policy.ts). Spoken names are demo identities; no institution-specific roster/task/author mapping is verified. Historical note create failed 403; writes are separately gated.

**Impact:** synthetic success cannot authorize patient access or official chart publication. Service bearer holders are trusted services, not individually authenticated clinicians.

**Fix:** preserve public synthetic preview and disabled writes; separately validate hospital-approved identity/roles, patient/encounter/task/note contracts, permissions and governance. Do not infer exact permission cause from 403.

**Acceptance:** approved target access/read/write/readback and ambiguous-write reconciliation; no synthetic blending, inferred administrations or autonomous clinical changes. **History:** [FL-008](FRICTION_LOG.md#fl-008), [FL-010](FRICTION_LOG.md#fl-010), [FL-013](FRICTION_LOG.md#fl-013), [FL-014](FRICTION_LOG.md#fl-014).

<a id="r-09"></a>
### R-09 — Physical audio, latency bounds and fresh-page recovery UX need acceptance

**Severity:** Medium · **Priority:** P1 before presentation · **State:** verification gaps and confirmed behavior

**Evidence/files:** [useVoiceConversation.ts](client/src/useVoiceConversation.ts), [voice-api.ts](client/src/voice-api.ts), [llm-provider.ts](src/agent/llm-provider.ts), [voice evidence](VOICE_VERIFICATION.md). Browser tests simulate audio. Reload chooses a new visible session while old uncertain requests remain under old session keys. Model calls have individual timeouts rather than a strict global speech deadline; provider takes the first of multiple emitted tool uses and warns about the rest.

**Impact:** physical STT/echo/headset or provider delays can break a demo; older ambiguous outcomes are less accessible. Historical timings do not prove a maximum of 3–4 seconds.

**Fix:** rehearse real HTTPS/hardware, record warm/cold speech-to-speech p50/p95 and failures; provide explicit safe old-session reconciliation; test unexpected parallel model tool use.

**Acceptance:** physical input→correct operation→audible response→listening, interruption/error cases and old-request exact replay verified; no retry of a write to hide delay. **History:** [FL-011](FRICTION_LOG.md#fl-011), [FL-012](FRICTION_LOG.md#fl-012), [FL-017](FRICTION_LOG.md#fl-017), [FL-019](FRICTION_LOG.md#fl-019).

<a id="r-10"></a>
### R-10 — Schema and hospital catalog evolution lack a general migration ledger

**Severity:** Medium · **Priority:** P2 · **State:** confirmed constraints

**Evidence/files:** [schema.ts](src/db/schema.ts) startup DDL/catch-all ALTER errors; [setup-hospital.ts](scripts/setup-hospital.ts) versioned fixture receipt, fixed catalog/initial-handoff keys and catalog-name replacements; [update-simulation-catalog.ts](scripts/update-simulation-catalog.ts) updates original review IDs, not a general hospital-version migration.

**Impact:** changing JSON alone does not update a provisioned catalog; repeat import intentionally preserves state. Unexpected migration errors may look like already-existing columns. Code rollback does not reverse DDL.

**Fix:** explicit schema/catalog revisions, narrow error classification, old-version fixtures and preserved frozen run definitions.

**Acceptance:** old populated DB upgrades predictably; new runs see intended catalog version; tasks/receipts/older runs preserved; failures stop clearly. **History:** [FL-013](FRICTION_LOG.md#fl-013), [FL-015](FRICTION_LOG.md#fl-015).

<a id="r-11"></a>
### R-11 — Historical documents conflict with current source

**Severity:** Medium · **Priority:** P1 submission navigation · **State:** confirmed drift; consolidated entry point addressed here

**Evidence/files:** README's blanket “not configured” Epic section versus successful read reports; `remaining.md` deterministic-only/Gemini text; `architecture.md` NORMAL synchronous and broad offline/write guarantees; old counts in `mcp.md`, `mcpendpoints.md`, `understanding.md`; skill context mentions removed Gemini; early `SIMULATIONS.md` local-only statements precede hosted hospital.

**Impact:** wrong setup/profile, misleading capability claims and point-in-time inventories read as live state.

**Fix:** use DOCUMENTATION as current entry point; separately update old notices/navigation, preserving dated evidence. Avoid universal uptime/zero-loss/compliance or automatic hackathon-bonus claims.

**Acceptance:** new developers reach one current setup/profile/tool reference; historical material visibly dated; links/commands checked. Other Markdown was intentionally not rewritten in this task. **History:** [FL-001](FRICTION_LOG.md#fl-001), [FL-020](FRICTION_LOG.md#fl-020).

<a id="r-12"></a>
### R-12 — Optional HAPI overlay does not explicitly select external FHIR

**Severity:** Medium · **Priority:** P2, P1 if using overlay · **State:** confirmed config mismatch; image health assumption unverified

**Evidence/files:** [compose.hospital.yaml](compose.hospital.yaml) sets URL/enabled but not `HOSPITAL_DATA_SOURCE=fhir`; [hospital-fhir.ts](src/providers/hospital-fhir.ts) defaults SQLite. Java `HealthCheck` command assumes a class in the selected image; no compatible image/class validation is recorded.

**Impact:** added HAPI/PostgreSQL cost/memory while app still uses SQLite, or failed health dependency startup.

**Fix:** explicit source and tested pinned image/probe in a separately validated optional profile. Current EBS/SQLite preview needs no HAPI deployment.

**Acceptance:** observed HTTP use, persistence/paging/failure/restart on target architecture, no fallback after failure. **History:** [FL-013](FRICTION_LOG.md#fl-013), [FL-015](FRICTION_LOG.md#fl-015).

<a id="r-13"></a>
### R-13 — Truncated audit IDs create avoidable collision risk

**Severity:** Medium · **Priority:** P2 · **State:** confirmed code; no collision observed

**Evidence/files:** [audit.service.ts](src/services/audit.service.ts) uses the first eight UUID hex characters for a primary key, retaining approximately 32 random bits.

**Impact:** collision risk grows with volume and duplicate insert can fail an enclosing transaction. The audit is append-by-convention, not tamper-proof/WORM storage.

**Fix:** full UUID entropy and explicit logging-failure semantics; preserve existing IDs.

**Acceptance:** collision-resistant IDs and tests for transaction outcomes on audit failure, without silent committed-action loss. **History:** [FL-003](FRICTION_LOG.md#fl-003), [FL-020](FRICTION_LOG.md#fl-020).

<a id="r-14"></a>
### R-14 — Automated release/dependency assurance is not established

**Severity:** Medium · **Priority:** P2 · **State:** evidence gap, no asserted CVE

**Evidence/files:** lockfiles/Dockerfile exist; no `.github` CI workflow/IaC; Node/Caddy tags are mutable; no fresh dependency advisory/image scan or target native-module execution.

**Impact:** build/runtime divergence and incomplete release provenance. Typechecking is not vulnerability scanning.

**Fix:** owner-run isolated CI, target image smoke, dependency/image review and immutable digest record; keep paid/live scripts opt-in.

**Acceptance:** commit/digest/test/scan artifacts recorded; clean CI cannot inadvertently contact Epic or paid providers. **History:** [FL-015](FRICTION_LOG.md#fl-015), [FL-020](FRICTION_LOG.md#fl-020).

<a id="r-15"></a>
### R-15 — Preserved legacy/profile edges need targeted tests

**Severity:** Low–Medium by profile · **Priority:** P2 · **State:** confirmed source conditions; impacts not re-created

**Evidence/files:** [TaskBoard.tsx](client/src/components/TaskBoard.tsx) omits CANCELLED despite schema support; [server.ts](src/server.ts) staff login uses `req.ip` without explicit trust-proxy configuration, and GET MCP does not update `lastActive` in that route; [fhir-api-provider.ts](src/providers/fhir-api-provider.ts) contains partial/empty error behavior but global activation is disabled; [test-integration-recovery.ts](scripts/test-integration-recovery.ts) isolates DB/port yet inherits other profile flags and makes live Epic reads.

**Impact:** legacy cancelled tasks disappear, proxy-shared login limits, possible active-stream eviction, and profile-sensitive tests. Disabled provider debt is not proof the active Epic snapshot path fabricates success.

**Fix:** profile-specific regression, narrow proxy trust policy, complete status visibility when legacy UI is in scope, explicit flags and script external-access classification. Do not change staff UX in this voice/documentation-only work.

**Acceptance:** documented cancelled visibility, proxy/TTL tests and reproducible isolated script profiles; live checks remain opt-in. **History:** [FL-006](FRICTION_LOG.md#fl-006), [FL-007](FRICTION_LOG.md#fl-007), [FL-020](FRICTION_LOG.md#fl-020).

## Release gates, ownership and next actions

| Gate | Current evidence | Responsible role |
|---|---|---|
| Synthetic correctness | Current isolated suites pass | Backend/QA maintain regressions |
| Distribution/default DB | Seeds/runtime pass; corrupt tracked artifact remains | Maintainer resolves R-02 |
| Public spending/security | Main source isolation tested; R-01/03/04 open | Backend/security/DevOps |
| ARM64/AWS deployment | Templates/local runtime only | Deployment owner, R-06 |
| Backup/rollback | Backup utility tested; off-host restore unknown | DevOps, R-07 |
| Physical voice and timing | Historical simulated speech/live text runs | QA/presentation owner, R-09 |
| Clinical interoperability | Dated reads, denied write | Institution/Epic owner, R-08 |

Recommended sequence: R-02 and exposure-sensitive R-01/03/04; target-host R-06/07; presentation R-09; keep R-08 as a closed clinical-use gate; schedule migration/catalog/release/legacy debt. This work register must not be mistaken for completed fixes.
