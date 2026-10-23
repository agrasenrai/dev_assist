# ShiftWeave — Engineering Friction and Decision History

**Maintained through:** 23 October 2026 · **Reviewed source:** `603fd97` · **Track:** Amazon Developer Hackathon, Alexa+

## Purpose and evidence discipline

This log records challenges, decisions, resolutions, trade-offs and unfinished work. It replaces the older friction narrative's unsupported “production-grade,” universal sandbox restrictions, fixed microsecond latency, 100% uptime and complete bidirectional-interoperability claims. Relevant original lessons are retained below with provenance, rather than presented as newly reproduced events.

Evidence comes from Git history, current code/configuration, dated reports, [memory.md](memory.md), prior friction entries and verification documents. **Git date** means a recorded commit date, not necessarily when the problem first occurred. **Recorded** means an existing engineering narrative; **tested now** means executed in the documentation review. Precise original occurrence times, person-hours and individual authors are generally unavailable and are not invented. Within 23 October, some records have only a date; exact order between overlapping threads is unknown.

Stable event IDs support follow-up. Findings link to [review.md](review.md); current setup/architecture are in [DOCUMENTATION.md](DOCUMENTATION.md). The optional friction-log bonus is **up to 10%** under [important.md](important.md), not an award already achieved.

## Chronology at a glance

| Date or bounded period | Event | Outcome / remaining friction |
|---|---|---|
| 12 October | FL-001 project initialization | TypeScript/ESM project established |
| 13 October, later refined 20–21 October | FL-002 MCP transport lifecycle | Session factory and Streamable HTTP; bounded lifecycle/load testing still needed |
| 19–20 October | FL-003 durable workflow design/correction | Atomic local state and restart reconciliation; no universal zero-loss claim |
| 20–21 October | FL-004 native model/tool schemas | Bedrock adapter and message conversion; later single-pass optimization |
| 20 October | FL-005 Epic API selection/JWKS decisions | Corrected catalog assumptions; permission still environment-specific |
| 21–23 October records | FL-006 test/database isolation | Isolated main runner and repaired recovery test; legacy flags remain a risk |
| 21 October | FL-007 server/observability refinements | TTL, errors, polling and IDs corrected incrementally |
| 21 October | FL-008 live Epic reads/workflow | Historical reads succeeded; note create 403 |
| 21 October | FL-009 damaged local database | Preserved old files; fresh verified Epic workspace selected with approval |
| 22 October | FL-010 seven-patient Epic assessment | Bounded operational coverage gap documented |
| 22–23 October | FL-011 semantic voice and evidence validation | Ordinary language routed through model, grounded response rules retained |
| 22–23 October | FL-012 voice/TTS interruption behavior | Simulated browser lifecycle verified; physical audio remains open |
| 23 October | FL-013 hospital preview and scenario persistence | Synthetic FHIR/operational rows in same configured SQLite, additive import |
| 23 October | FL-014 strict preview/Epic realms | External defaults Epic; tested scope/receipt/workflow isolation |
| 23 October | FL-017 latency work | Single inference/lazy records; upstream delay still possible |
| 23 October | FL-015 release cleanup/AWS handover | Existing EBS structure preserved; owner performs deployment |
| 23 October | FL-016 public preview/TTS sanitization | Anonymous synthetic preview accepted; TTS errors fixed, abuse controls open |
| 23 October | FL-018 welcome and voice UI | Guide/animation/transcript/controls refined without staff redesign |
| 23 October | FL-019 Jordan review conversation | Missing receiver/review guidance and note collection repaired |
| 23 October, this review | FL-020 consolidated documentation | Fresh offline evidence, tracked corrupt DB confirmed, risks registered |

IDs remain stable even where dated evidence places an event before an earlier-numbered topic. This is not a fabricated minute-by-minute chronology.

<a id="fl-001"></a>
## FL-001 — Initial project setup and growing design records

**When/evidence:** Git `6f99742` and `fc7852f`, 12 October; design/schema additions `d8ef2b6`, `c5e3795`, 19 October; architecture/plan additions on 20 October.

**Challenge:** establish an ESM TypeScript MCP application and express the nursing-handoff domain. Subsequent design prose mixed intended architecture with claimed completed behavior.

**Decision/change:** retain a dedicated local persistence layer, nursing ownership semantics and a browser demonstration. Core documents introduced tasks, assignments, conflicts, handoffs, workflows/checkpoints and audit records.

**Trade-off/lesson:** early specifications accelerated shared understanding but became stale as code changed. A checked roadmap box or architecture diagram is not execution evidence. Current documentation separates implementation, test and deployment states.

**Open:** consolidate navigation/notices in older files without erasing history. **Finding:** [R-11](review.md#r-11).

<a id="fl-002"></a>
## FL-002 — Streamable HTTP session lifecycle, headers, ESM and Express routing

**When/evidence:** initial MCP implementation Git `b7d9ac8`, 13 October; prior friction items 1–4; current [server.ts](src/server.ts), [mcp-client-bridge.ts](src/agent/mcp-client-bridge.ts), tsconfig and current MCP tests.

**Recorded symptoms:** the earlier log reported `Already connected to a transport`, unacceptable/missing SSE negotiation, Express 5 wildcard routing failure and ESM type-import conflicts. Original timestamped reproductions/stacks were not retained for each; these are recorded development accounts, not failures newly observed here.

**Resolution present in code:** one MCP server/transport pair per initialization, session routing map, canonical JSON/SSE headers/parser, SPA fallback middleware and TypeScript type-only imports. Later changes added idle cleanup and source-bound transports.

**Verification:** current regression/hospital/isolation suites actually initialized and executed through Streamable HTTP, including official SDK clients. The present server requires initialization; the older “ad-hoc stateless fallback” narrative is not its current contract.

**Trade-off/lesson:** MCP transport sessions are process-local while workflow state is durable. A reconnect must recover business state explicitly. Streaming-capable MCP does not mean token/audio streaming. Recommendations for SDK pooling/examples remain suggestions, not delivered upstream features.

**Open:** sustained streams/TTL/load and restart-client acceptance. **Findings:** [R-09](review.md#r-09), [R-15](review.md#r-15).

<a id="fl-003"></a>
## FL-003 — Turning recovery claims into committed local state

**When/evidence:** Git `1723302`, `cf49dea`, 20 October; [mutation.service.ts](src/services/mutation.service.ts), [checkpoint.service.ts](src/services/checkpoint.service.ts), [recovery.service.ts](src/services/recovery.service.ts), restart-worker and workflow tests; memory change record 20 October.

**Challenge:** earlier documentation advertised zero-loss handoff recovery while implementations still needed durable multi-turn context, correct SQL contracts and safe replay of ambiguous mutations. A draft alone must not transfer Seema's responsibility to Reema.

**Resolution:** operation receipts bind key/request/actor; immediate transactions commit domain/event/checkpoint/audit; orchestration stores intent and result; recovery reconciles current source state and reuses committed outcomes. Draft, explicit custody acceptance, escalation, verified resolution and finalization remain distinct.

**Verification:** current 220-check suite includes real worker exit after a committed draft and before result checkpoint, plus recovery without duplicate draft. Tests cover selected failure windows, not arbitrary disk loss.

**Trade-off/lesson:** business exactly-once behavior comes from application state/constraints, not MCP or UUIDs alone. FULL synchronous/WAL strengthen local commits but do not supply off-host disaster recovery. Receipts cannot be pruned independently of recoverable workflows.

**Open:** backup objectives/retention, full-disk behavior, audit identifier entropy. **Findings:** [R-07](review.md#r-07), [R-13](review.md#r-13).

<a id="fl-004"></a>
## FL-004 — Bridging MCP tool schemas to native Bedrock messages

**When/evidence:** prior friction item 5, 20–21 October implementation records; [llm-provider.ts](src/agent/llm-provider.ts), [orchestrator.ts](src/agent/orchestrator.ts); later Git `10494af`, `f672023` on 21 October.

**Challenge:** MCP schemas/messages are not directly the same representation as Bedrock Converse toolSpec/toolUse/toolResult. Results must preserve matching tool-use IDs and native role/content contracts. Historical Gemini support increased adapter complexity.

**Resolution:** native conversion and tool schema mapping, bounded sequential tool planning, explicit provider selection and no silent cloud-error-to-mock fallback. Later incompatible host-generated IDs were mapped deterministically on both sides. Gemini runtime/dependency were removed at the owner's request; historical references remain in older docs.

**Trade-off/lesson:** runtime discovery is useful interoperability, but does not guarantee correct planning or grounded prose. Current voice factual replies avoid a second wording call and use backend facts; legacy chat remains a separate constrained renderer. The adapter currently takes only the first unexpected parallel tool call, so multi-tool output needs explicit coverage.

**Open:** broader language/provider/cancellation coverage and dependency/release assurance. **Findings:** [R-09](review.md#r-09), [R-14](review.md#r-14).

<a id="fl-005"></a>
## FL-005 — Correcting Epic catalog assumptions and backend registration

**When/evidence:** Git `ad7fd85`, `d2c2c71`, 20 October; [incomingapikey.md](incomingapikey.md); prior friction item 7 and [goal.md](goal.md) milestones.

**Challenge:** original API proposals treated a small catalog selection as sufficient for generic bedside tasks and underestimated Encounter/Location/Binary relationships. Backend access required a signed client assertion and an externally accessible public JWKS matching the local private key.

**Recorded decision:** use backend-system OAuth with RS384, public-key-only JWKS hosting and separately retained private signing material. SMART scope/API selection had to be checked in the target registration; unconstrained Epic identifiers were not to be truncated. Public JWKS hosting is recorded historically; availability was not rechecked here.

**Correction retained:** “Incoming” includes permitted calls into Epic, including writes. Episode Checklist/Community Resource tasks are not assumed generic ICU medication tasks. A reviewed Clinical Notes create is not an Epic-specific Handoff update. API catalog presence does not prove authorization or returned data.

**Trade-off/lesson:** credentials/configuration enable an attempt, not permission or clinical interoperability. Published public keys are not private secrets; private keys/tokens must remain outside source and browser bundles. Older 100%-uptime JWKS claims are withdrawn as unsupported guarantees.

**Open:** actual hospital API/identity/author contracts and key lifecycle ownership. **Findings:** [R-06](review.md#r-06), [R-08](review.md#r-08).

<a id="fl-006"></a>
## FL-006 — Test scripts sharing application state and ports

**When/evidence:** historical audit/memory and [file.md](file.md), 21–23 October; recovery integration added Git `4780c2c`; current [run-tests.ts](scripts/run-tests.ts), [test-integration-recovery.ts](scripts/test-integration-recovery.ts), [test-writeback.ts](scripts/test-writeback.ts).

**Recorded challenge:** some integration scripts imported database/server/fixtures before selecting temporary configuration. This risked mutation of the configured dataset and port 3000 collisions; the old term “database corruption” was stronger than the evidence of this particular test risk. A separate record describes legacy fixtures entering the operational sandbox.

**Resolution:** main runner provisions a temporary DB, loopback/ephemeral port and explicit profile before imports; recovery script dynamically imports after temporary DB/PORT=0 setup. Write-back tests use explicit local execution modes rather than accidentally invoking the live publisher.

**Verification:** current main suites use isolated files and ports; hospital tests verify additive import/replay preservation. The separate recovery script still makes live Epic reads and inherits some flags; it was deliberately not included in this review's offline command set.

**Trade-off/lesson:** a script named “test” is not automatically safe/offline. Classify by database mutation and external cost/access before running. Cleanup must preserve the original exception and safely close/remove only known temporary resources.

**Open:** consistent environment isolation across legacy entrypoints. **Findings:** [R-14](review.md#r-14), [R-15](review.md#r-15).

<a id="fl-007"></a>
## FL-007 — Server lifecycle, polling and observability corrections

**When/evidence:** Git `4eb5683`, `dcf7a8e`, `85775c2`, `b1de745`, `da5d74a`, `9f3e33b`, `8798485`, 21 October; current server/audit/client code.

**Challenge/changes:** commits address voice self-connection handling, display/trace polling, session TTL, naked finalize errors, trace row limits, hardcoded shift context and receipt growth. Current routing derives the local MCP port; shift context comes from stored records; receipts are retained rather than independently discarded after a fixed short interval.

**Trade-off/lesson:** audit UI is polling actual stored records, not a push/token stream. Increasing trace limits does not create immutable audit storage. Correct latency/trace names matter to technical reviewers.

**Open:** global error minimization, sustained-session load, login proxy policy and cancelled legacy-board visibility. **Findings:** [R-03](review.md#r-03), [R-15](review.md#r-15).

<a id="fl-008"></a>
## FL-008 — Historical live Epic workflow succeeded locally; write-back did not

**When/evidence:** 21 October; Git `bf21363`, `88032b7`, later milestone commits; [epic-live-report.json](deploy/epic-live-report.json), [epic-workflow-live-report.json](deploy/epic-workflow-live-report.json), [epic-write-report.json](deploy/epic-write-report.json), [EPIC_WORKFLOW.md](EPIC_WORKFLOW.md).

**Observed in retained reports:** live OAuth/JWKS/read path, sourced MCP sync, handoff draft, explicit incoming custody, local finalization and refresh preserving custody. One recorded patient returned 10 encounters, 7 conditions, 1 allergy resource and1 medication order. Administration/document searches returned no clinical records; warning OperationOutcomes were not clinical results.

**Blocker:** Practitioner.Read and explicitly approved DocumentReference.Create returned 403. Note outcome is FAILED; no remote identifier/readback success. Earlier claims identifying an exact universal scope restriction from 403 are not adopted: the report proves denial, not its universal cause.

**Resolution:** retain read/source context, source-section warnings/partial states, bounded same-server pagination and separate local coordination tasks. External publication requires exact reviewed hash and durable intent; uncertain outcomes cannot be blindly resent. Writes stay disabled unless separately authorized.

**Lesson:** order is not administration; missing data is not completion; local finalization is not external publication. Current review did not renew live access. First-time failed sync persistence still merits correction.

**Open:** target authorization, identity/note type and remote readback; first-sync failure row. **Findings:** [R-05](review.md#r-05), [R-08](review.md#r-08).

<a id="fl-009"></a>
## FL-009 — Damaged historical database and a deliberately fresh workspace

**When/evidence:** 21 October records in [EPIC_WORKFLOW.md](EPIC_WORKFLOW.md), prior friction item 8 and memory.

**Recorded challenge:** existing DB and pre-migration backups reported unreadable checkpoint/audit/receipt state. This is separate from the evidence of unsafe test mutation and does not prove which action caused corruption.

**Decision/resolution:** with recorded owner approval, preserve old files and select a fresh Epic demo DB only after integrity/FK checks. Old handoff history was not claimed recovered. Later operational/hospital data used the configured workflow sandbox.

**Current confirmation:** the configured local workflow database is healthy; the still-tracked `data/shiftweave.db` raises `SQLITE_CORRUPT` in this documentation review. No repair, deletion or replacement was performed.

**Trade-off/lesson:** choosing a healthy workspace restores a usable demo but is not zero-loss restoration of old history. Shipping a populated legacy DB is unnecessary when reproducible seeds exist.

**Open:** separately remove/quarantine the distributed artifact and prove clean setup/restore. **Findings:** [R-02](review.md#r-02), [R-07](review.md#r-07).

<a id="fl-010"></a>
## FL-010 — Bounded Epic assessment exposed missing operational demonstration cases

**When/evidence:** 22 October; [EPIC_SANDBOX_ASSESSMENT.md](EPIC_SANDBOX_ASSESSMENT.md), [epic-dataset-audit.json](deploy/epic-dataset-audit.json), operational sandbox records; Git `2c18166` records related evolution but is not itself proof of the audit result.

**Verified historically:** seven accessible published test patients; 17 encounters, 18 conditions, 9 allergy resources and7 medication orders; zero returned administration/document clinical records. Tested practitioner/role/care-team/location/task/observation access was blocked; List search needed a supported code. Encounter dates did not establish a current hospital feed.

**Decision:** preserve Epic as clinical interoperability evidence, while using clearly labeled writable synthetic staff/rosters/tasks/notes/custody/discrepancy scenarios for capabilities the tested client/sample could not demonstrate. The operational staff sandbox was one stage; public hospital preview followed later.

**Trade-off/lesson:** another sandbox might support more; this assessment does not prove no Epic environment can meet the need. Synthetic nursing events must not be relabeled Epic. Population counts are less meaningful than correct relationships and source provenance.

**Open:** real institution contracts and enabled permissions; current snapshot freshness. **Finding:** [R-08](review.md#r-08).

<a id="fl-011"></a>
## FL-011 — Keyword gates, name loops and overly constrained model speech

**When/evidence:** 22–23 October records in [VOICE_VERIFICATION.md](VOICE_VERIFICATION.md), [memory.md](memory.md), Git flexibility/LLM commits; [voice-agent.service.ts](src/services/voice-agent.service.ts), [voice.service.ts](src/services/voice.service.ts).

**Challenge:** early nursing-keyword routing bypassed LLM interpretation; “ask assistant” was a special route; identity detection could consume an introduction and ignore the following question or treat feelings/colleague names as new identities. Unconstrained model wording could introduce unsupported facts; strict evidence validation also rejected benign headings/connective phrases.

**Resolution:** shared durable dialogue, model interpretation for ordinary Bedrock voice input, typed intents, backend-scoped name/task resolution, same-turn introduction plus question, explicit speaker-versus-colleague fields and bounded repair. Exact facts/warnings remain backend-authoritative. Treatment advice and invented patient claims are independently rejected, without an unrelated “cannot” bypass.

**Verification:** regression cases cover combined introductions, negation, stale data, missing handoff, no identity switch, unsourced claims and clinical refusals. Historical live replays passed after fixes; intermediate failures are not counted as passes.

**Trade-off/lesson:** flexible understanding does not authorize free-form clinical invention. Workflow speech remains controlled and can sound repetitive; correct operation/follow-up handling matters more than adding decorative language.

**Open:** wider natural-language/device acceptance. **Findings:** [R-08](review.md#r-08), [R-09](review.md#r-09).

<a id="fl-012"></a>
## FL-012 — ElevenLabs, microphone endpointing and voice interruption

**When/evidence:** Git `e868dc2` 22 October, `3ab6ded` 23 October; [useVoiceConversation.ts](client/src/useVoiceConversation.ts), [elevenlabs.service.ts](src/services/elevenlabs.service.ts), [VOICE_VERIFICATION.md](VOICE_VERIFICATION.md), browser test records.

**Challenge:** brief pauses split sentences; stopping recognition during playback made spoken interruption ineffective. Capture/playback races, echo, stale events, quota failures and Bluetooth profile quality complicated the experience.

**Resolution implemented:** longer utterance buffering, recognition restarts, live capture/interruption with echo rejection, local stop handling, queued follow-up during processing, suppressed superseded audio, bounded playback fallback and optional ElevenLabs streaming. Existing browser synthesis remains a visible fallback. Agent ID is optional for normal TTS; API key/model/voice settings are separate.

**Verification boundary:** historical Edge tests used simulated speech events through real React/HTTP/MCP/SQLite. They do not verify audible quality, recognition accuracy on a real microphone, or native Alexa hardware parity. The owner chose to retain interruption behavior despite Bluetooth muffling; no physical quality fix is claimed.

**Trade-off/lesson:** keeping a Bluetooth headset microphone active can reduce playback quality; releasing it can compromise barge-in. That is a device/product trade-off, not something a passing HTTP test resolves. Optional ConvAI handlers need the same scoping/security discipline as the main voice route.

**Open:** real hardware/HTTPS acceptance and optional webhook validation. **Findings:** [R-04](review.md#r-04), [R-09](review.md#r-09).

<a id="fl-013"></a>
## FL-013 — From local reviewer scenarios to the hosted synthetic hospital profile

**When/evidence:** 23 October implementation sequence in memory; [SIMULATIONS.md](SIMULATIONS.md), [MCP_DATASET.md](MCP_DATASET.md), [setup-hospital.ts](scripts/setup-hospital.ts), [hospital.service.ts](src/services/hospital.service.ts), [hospital-store.ts](src/providers/hospital-store.ts), JSON seed files; Git `e791629` and subsequent release changes.

**Challenge:** a separate reviewer DB/local-only launcher did not satisfy the owner's requirement to preserve the original persistent application DB and demonstrate workflows online. Epic's sample could not populate all desired cases. Initial proposal included a private external FHIR server; the owner retained hosting responsibility.

**Decision/resolution:** implement explicit synthetic FHIR R4 resources in the configured SQLite file, alongside namespaced hospital workflow rows. Retain an optional external FHIR adapter; it is selected explicitly and never an automatic fallback. Back up before additive import; ordinary restart does not reseed/reset.

**Dataset evolution:** initial hospital had five tasks; fixture v2 adds Jordan work, two shift-scoped unassigned tasks and a sourced documentation conflict, giving nine tasks. Three nurses, three patients and 17 FHIR resources remain the baseline. A real Reema-to-Seema draft is seeded without transferring custody. Six catalog scenarios persist run snapshots/cursor/actual outputs and permit follow-ups. Self-claim is simulation-only and human-confirmed, rejecting owned/conflicting/stale work.

**Verification:** current 20 hospital checks pass; all 15 preview tools and six scenarios exercised through HTTP/MCP/SQLite. A read-only local inventory confirms 9 hospital tasks/17 resources; older review catalog entries coexist, so total catalog rows are 12 while hosted hospital scenarios are 6. Repeated provisioning preserves updates and initial-handoff uniqueness in compiled runtime tests.

**Trade-off/lesson:** hosted SQLite is online when the app is online; there is no need to add HAPI just to avoid “local JSON.” Seeds are legitimate synthetic definitions; runtime queries must read DB state. Shared preview changes persist for other testers; scenario start is not reset. This is curated simulation, not an autonomous live hospital feed or full FHIR conformance server.

**Open:** seed/catalog migration lifecycle; optional HAPI mode selection/health; fair repeatable shared-demo rehearsal. **Findings:** [R-10](review.md#r-10), [R-12](review.md#r-12).

<a id="fl-014"></a>
## FL-014 — External assistants must default Epic without seeing preview data

**When/evidence:** 23 October source-isolation record; [source-context.ts](src/services/source-context.ts), [source-policy.ts](src/services/source-policy.ts), server and [verify-source-isolation.ts](scripts/verify-source-isolation.ts).

**Challenge:** earlier configuration-selected preview mode also affected other assistants connecting to the same MCP endpoint. Client name alone was not a trustworthy source selector, and shared session/retry IDs could collide across realms.

**Resolution:** immutable per-transport realm, private process-local preview capability, realm-specific session/retry aliases and workflow IDs, scoped nurse/patient/task/handoff/event reads, separate source versions and filtered discovery. Public production preview cannot switch/restore Epic. External MCP defaults Epic; staff authorization remains separate. The same physical database is retained.

**Verification:** 11 adversarial checks passed again now: spoofed headers/stolen transport IDs, cross-source IDs/workflows/retries, fingerprints, controlled Epic HTTP success/failure, preview publication denial and production dashboard guards. External Epic and trusted preview each expose 15 tools with different extra tools. The old 20-tool preview observation belongs to an earlier version.

**Trade-off/lesson:** application scoping is not separate encrypted storage or clinical access governance. Generic local workflow tools use Epic-linked records/snapshots rather than every operation making a new Epic call. Main-path isolation tests cannot certify optional webhook shortcuts automatically.

**Open:** provider-specific ConvAI paths and real institution authorization. **Findings:** [R-04](review.md#r-04), [R-08](review.md#r-08).

<a id="fl-017"></a>
## FL-017 — Reducing redundant inference without hiding provider failures

**When/evidence:** 23 October latency/single-inference/lazy-context records in memory, [deploy/ARCHITECTURE.md](deploy/ARCHITECTURE.md), [PREVIEW_TEST_GUIDE.md](PREVIEW_TEST_GUIDE.md), model/voice services. Within-day work overlapped release cleanup.

**Challenge:** introduction-plus-question could trigger multiple model decisions; general chat eagerly refreshed clinical context. Evidence repairs and provider timeouts added further delay. Clinical refusal wording sometimes failed validation despite a safe intent.

**Resolution:** one semantic plan for ordinary requests and combined identity/operation, lightweight durable context before clinical retrieval, backend resolution of names/titles, deterministic workflow output and confirmation, pooled SDK clients, voice output cap and bounded repair. Safe treatment refusals can normalize to the enforced boundary without another wording call; unsafe factual/advice additions remain blocked.

**Recorded measurements:** successful optimized runs often took roughly 1.3–2.3 seconds backend; first greetings/introduction could be 4–5+ seconds. Earlier runs had 30–56-second failures. Latest Jordan replay recorded roughly 1.5–2.2-second workflow model turns, 4.8-second introduction and 36 ms confirmation. These are individual local text/backend samples, not speech-to-speech percentiles or a guarantee.

**Verification:** historical full 21-question live sequence and later 13-question Jordan sequence passed; current offline tests verify no eager clinical refresh for general dialogue and exact retry without duplicate inference. No paid calls were made during this documentation task.

**Trade-off/lesson:** caching context alone does not remove model calls; blind retries must not conceal a committed write. Measure endpointing, inference, backend, TTS and playback separately. SDK pooling does not cache patient state; streaming MCP is not model TTFT.

**Open:** actual host p50/p95, provider outage/cancellation behavior and hardware timing. **Findings:** [R-01](review.md#r-01), [R-09](review.md#r-09).

<a id="fl-015"></a>
## FL-015 — Preserve the owner's EC2/EBS deployment rather than replace it

**When/evidence:** 23 October owner-supplied deployment description/configuration, recorded in [deploy/UPDATE_CHECKLIST.md](deploy/UPDATE_CHECKLIST.md); [deploy/compose.ec2.yaml](deploy/compose.ec2.yaml), [Dockerfile](Dockerfile), [CLEANUP_REPORT.md](CLEANUP_REPORT.md).

**Reported architecture:** one `t4g.medium` ARM64 EC2 in `us-west-2`, 32 GB KMS-encrypted EBS mounted `/mnt/shiftweave`, Caddy 80/443, one Node 24 app, persistent SQLite and read-only Epic key mount, ECR image delivery, Bedrock configured in `us-east-1`. The previously deployed image tag was `2026-10-23-006`; latest repository deployment was not verified.

**Challenge:** root Compose uses generic named volumes; applying it over existing bind paths could disconnect the intended data. Windows native modules and missing runtime seed assets could fail a Linux ARM64 release. Old Caddy env_file unnecessarily exposed app secrets to the proxy.

**Resolution:** dedicated EC2 template preserves mounts; Docker includes hospital/catalog assets and compiled utility scripts; Caddy receives only DOMAIN; preflight then execs Node for signals. Consistent backup/additive provisioning/verification steps avoid uploading a developer database or rewriting hosted schema manually.

**Verification:** compiled plain-Node runtime checks pass now, including preserved task updates/no duplicate initial handoff and external Epic-default MCP. This does not prove a Docker image was built/pushed/run, TLS issued or AWS IAM configured. The owner explicitly retained deployment responsibility; no hosting was performed in these changes.

**Trade-off/lesson:** single-host SQLite is economical in complexity, not a zero-total-cost or HA claim. Encrypted EBS is one control, not proof of HIPAA compliance. Keep old image/config/consistent snapshot together; rollback can discard later actions or remove new isolation guarantees.

**Open:** target ARM64/native module/mount/credential/TLS checks, IAM/network evidence, off-host restore/monitoring. **Findings:** [R-06](review.md#r-06), [R-07](review.md#r-07), [R-10](review.md#r-10), [R-14](review.md#r-14).

<a id="fl-016"></a>
## FL-016 — Open synthetic preview and sanitized TTS errors

**When/evidence:** 23 October memory; Git `89d5470`; [elevenlabs.service.ts](src/services/elevenlabs.service.ts), [verify-tts-errors.ts](scripts/verify-tts-errors.ts), deployment checklist.

**Challenge:** staff-auth and public-preview flags conflicted; owner explicitly wanted anonymous preview. Raw upstream TTS messages reached responses/logs in an isolated failure reproduction.

**Decision/resolution:** select `STAFF_AUTH_REQUIRED=false` with hospital enabled; preserve staff profile/security code and the preflight conflict guard. TTS provider bodies are discarded, responses use generic 502/fallback and logs contain sanitized category/status. Stream failures close safely; no claim that real credentials had leaked.

**Verification:** historical sentinel HTTP/network/midstream TTS tests passed; current build/regression includes the revised code. No fresh paid audio was requested here.

**Trade-off/lesson:** anonymous access is intentional, not authentication. It still exposes paid model/TTS capacity; origin and MCP-token checks do not constitute abuse/spend protection. Error sanitization must extend beyond TTS; optional agent sessions/webhooks need review.

**Open:** capacity/limits, broad diagnostic minimization and ConvAI guardrails. **Findings:** [R-01](review.md#r-01), [R-03](review.md#r-03), [R-04](review.md#r-04).

<a id="fl-018"></a>
## FL-018 — Presentation UI without changing the workflow or staff workspace

**When/evidence:** 23 October; Git `6bf385d`, `c383c40`, `d4fd7db`; [OneThreadWorkspace.tsx](client/src/components/OneThreadWorkspace.tsx), [PreviewQuestionGuide.tsx](client/src/components/PreviewQuestionGuide.tsx), [one-thread.css](client/src/one-thread.css), browser verification records.

**Challenge:** empty opening canvas, small transcript, prominent typing field and mismatched scrollbar made testing awkward. Owner required preserving background, logos, voice/keyboard controls and a minimal layout.

**Resolution:** database-derived question examples start open/centered and transition to the existing right side only when a real selected nurse appears; workflow enters from actual backend state. Examples edit input and never auto-send. Voice logo reacts to capture; keyboard toggles typing; transcript is larger; dark indigo scrollbars match the theme; reduced motion is respected.

**Verification:** historical preview/browser checks verified colors, guide DOM preservation, no overlap, examples, logos/buttons and reduced motion at desktop/laptop sizes. No staff workspace redesign or data-only fake workflow animation was introduced.

**Trade-off/lesson:** examples improve discoverability without becoming the only supported language. An attractive card must still correspond to stored state. Screenshots are visual evidence, not full clinical/audio acceptance.

**Open:** target-browser/accessibility/physical presentation rehearsal. **Finding:** [R-09](review.md#r-09).

<a id="fl-019"></a>
## FL-019 — Jordan's incoming-nurse and discrepancy-review conversation

**When/evidence:** 23 October final implementation record and Git `603fd97`; [verify-voice-conversation.ts](scripts/verify-voice-conversation.ts), [verify-preview-questions-live.ts](scripts/verify-preview-questions-live.ts), [PREVIEW_TEST_GUIDE.md](PREVIEW_TEST_GUIDE.md).

**Reported failure:** noisy “incoming news” and requests for discrepancy review repeated task lists/details. “What do you need from me?” could fail evidence validation. Intermediate live testing also exposed status text becoming a review note and a conversational question clearing unfinished review.

**Root causes/resolution:** validated semantic commands could be intercepted by the old conversational fallback; intent lacked focused receiver/review-guidance details; generated canonical commands could be mistaken for human notes. Added current-turn semantic guidance, actual outgoing-handoff receiver lookup, grounded conflict guidance, pending-state preservation, status-only note rejection and exact human note retention. Explicit confirmation/source checks still govern writes.

**Verification:** historical final 13-turn Bedrock→MCP→isolated SQLite replay passed through actual persisted resolution. Earlier runs failed, including one upstream timeout/reset; they are not counted as success. Current220 regression/20 hospital suites pass the added state/note/guidance cases. Task cards remain actual SQL records; the repeated wording partly reflects backend templates, not a static task list.

**Trade-off/lesson:** humanized conversation must still answer the current intent and explain required human verification. Do not fabricate review evidence just to make a flow finish or weaken the validator to hide failures.

**Open:** broader ASR variations, provider reliability and device testing. **Finding:** [R-09](review.md#r-09).

<a id="fl-020"></a>
## FL-020 — Evidence-based documentation and fresh release review

**When:** 23 October 2026, this documentation task; baseline `603fd97`.

**Challenge:** fragmented Markdown mixed current contracts, historical test counts, deployment claims and aspirations. User required three complete submission-ready files and no code changes, cloud cost or deployment.

**Work completed:** inventoried first-party Markdown and Git history; inspected code/config/scripts/deployment records; created DOCUMENTATION and replaced review/friction with consistent evidence labels, diagrams, source-specific inventory, operations guidance, findings and this chronology. Older files remain available; this log explicitly withdraws unsupported universal claims rather than erasing their historical context.

**Fresh executed checks:** typecheck and production build passed; 220 regression checks, 20 hospital checks and11 source-isolation checks passed; deployment config/controlled-Epic/backup groups and compiled runtime preservation/server/independent-client tests passed. These suites use temporary DBs and no paid/live external services.

**Read-only DB evidence:** configured workflow DB quick_check healthy, zero FK violations, 3 hospital nurses/3 patients/9 tasks/17 FHIR resources; 30 application tables plus SQLite statistics, 12 catalog entries including 6 hospital scenarios. The tracked legacy DB failed with `SQLITE_CORRUPT`. No file was repaired/deleted or application state reset.

**New/remaining findings:** public preview spending/concurrency controls, error minimization, optional ConvAI contract, first-sync failure persistence, AWS/IAM/backup evidence, physical audio/latency, migration/catalog lifecycle, audit-ID entropy, release automation and legacy-profile edges. See the complete [findings register](review.md#findings-register). These are not claimed fixed by documentation.

**Validation boundary:** local Markdown/path/anchor/command/diagram checks are documented with final task validation below. No AWS resource deployed/queried, image pushed, paid inference/TTS performed, live Epic permission renewed or physical microphone certified.

**Documentation checks:** 41 first-party Markdown files inventoried; all 259 local deliverable links/anchors checked; package commands and compiled utility paths resolved; 15 finding/20 event IDs verified. Configured credential values were absent from the deliverables. Five Mermaid blocks passed structural/fence checks, without a rendering engine. Final whitespace/scope checks passed; only the three requested Markdown files changed. This is not rendered-diagram, remote-link or cloud acceptance.

## Outstanding friction and ownership

| Next owner | Outstanding work | Related findings |
|---|---|---|
| Repository maintainer | Clean distribution/default DB and historical navigation; retain diagnostic evidence | R-02, R-11 |
| Backend/security | Capacity and request budgets, error minimization, ConvAI boundaries, initial sync failure representation | R-01, R-03, R-04, R-05 |
| DevOps/deployment owner | Actual AWS/IAM/network/KMS/image evidence, persistent mounts, backups, restore, alarms and immutable release provenance | R-06, R-07, R-14 |
| QA/presentation owner | Real microphone/headset/HTTPS, timing percentiles, broad intent/retry acceptance | R-09 |
| Authorized clinical integration owner | Institution-approved identity/data/task/note contracts and live authorization/readback | R-08 |
| Backend maintenance | Schema/catalog versions, optional HAPI, audit IDs and preserved-profile tests | R-10, R-12, R-13, R-15 |

The strongest lesson across this history is to preserve observable boundaries: configured is not authorized, a template is not a deployment, a synthetic workflow is not real care, a draft is not custody, and a local commit is not external publication. Successful checks should remain reproducible and dated; failures should remain visible.
