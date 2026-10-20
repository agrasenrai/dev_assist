# ShiftWeave — Project Goal, Architectural Boundary & Winning Strategy

> **Implementation note (20 October 2026):** This document includes intended design and historical claims. Use [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current verified behavior and limitations; use [incomingapikey.md](incomingapikey.md) for corrected Epic API guidance. External write-back, production authentication, universal recovery guarantees and fixed latency claims are not established by this document.

> **Target Track**: Amazon Developer Hackathon — Alexa+ Track  
> **Core Spec**: MCP Protocol `2025-11-25` over Streamable HTTP (`StreamableHTTPServerTransport`)  
> **Key Question Addressed**: What is the exact boundary between Alexa+ and our MCP Server, and is this a winning idea?

---

## Current completion roadmap — 20 October 2026

This roadmap takes precedence over historical completion and write-back claims below. Follow [AGENTS.md](AGENTS.md), [important.md](important.md), and [hackathon-guidelines](.agents/skills/hackathon-guidelines/SKILL.md) at every implementation step. Consult relevant architecture/schema/API documents before changes and [incomingapikey.md](incomingapikey.md) for Epic API selection.

### Verified local baseline

Checks run on 20 October 2026 against the current working tree:

- `npm run typecheck`: passed.
- `npm test`: all 50 isolated workflow checks passed, including retry deduplication, human custody acceptance, source reconciliation, and fresh-process recovery after a committed draft loses its response.
- `npm run build:client`: passed.
- The test and build reruns passed outside the sandbox after local network/file permissions blocked the initial attempts. Tests used an isolated database.

These checks establish the tested local behavior only. Live Epic authentication, data retrieval, and write-back remain unimplemented/unverified. Browser interaction, microphone behavior, live optional models, production authorization, and arbitrary distributed failures are not established by these checks. Re-run affected checks after implementation changes.

### Ordered remaining work

| Step | Work | Completion evidence |
| --- | --- | --- |
| 1. Epic registration | Publish the public JWKS at a stable public HTTPS URL without authentication; register the non-production URL and obtain the non-production client ID. Keep the matching private key secure and use separate production keys. Select APIs using `incomingapikey.md`. | The URL serves the expected public key set and the app configuration is saved. Neither is assumed completed yet. |
| 2. Backend OAuth | Implement JWT signing, token exchange, expiry handling, and explicit authentication errors. Keep private keys and tokens server-side and out of source control/logs. | Obtain an actual sandbox access token and complete an authorized read. |
| 3. Epic reads | Replace the external adapter's deliberate configuration errors with verified Patient, Encounter, allergy, medication, and document mappings. Follow linked Binary content when needed; verify roster/location support. | Actual responses retain source IDs, timestamps, units, and explicit missing-data/error states. |
| 4. Handoff integration | Combine imported Epic clinical context with local assignments, acknowledgements, conflicts, and custody state. Define field authority and namespace external identifiers. | A grounded handoff uses retrieved data while retaining local history and provenance. |
| 5. Integration recovery | Test expired tokens, permission denial, timeouts, changed source records, and interruptions during import. Persist workflow progress and stable retry keys. | Resume reconciles committed state and avoids duplicate local mutations or false success for the tested cases. |
| 6. Browser verification | Exercise chat/voice, draft review, discrepancy resolution, explicit custody acceptance, finalization, refresh, and resume. Verify loading and error states. | The complete Seema-to-Reema journey works in the browser, with limitations documented. |
| 7. Reviewed write-back (conditional scope) | Evaluate Clinical Notes creation against the target environment's payload and permissions. Require explicit human approval, durable external sync state, returned resource IDs, and remote reconciliation before retries. | A reviewed note is confirmed remotely; ambiguous outcomes remain visibly uncertain. Local finalization alone is not external publication. |
| 8. Submission packaging | Update status documents and stale claims, verify setup instructions, record the demo, and retain a factual friction log. | Reproducible repository, demo video, accurate README, and evidence aligned with the judging criteria. |

**Next concrete milestone:** registered JWKS → sandbox token → one verified Patient/Encounter read. Expand the adapter incrementally while preserving the passing local workflow checks.

### Requirements preserved throughout

- **Transport:** Agent-to-MCP traffic uses minimum protocol `2025-11-25` and `StreamableHTTPServerTransport` on Express `/mcp`. Epic adapters use the provider's FHIR HTTP interface.
- **Agent depth:** Preserve multi-turn and cross-session context, durable checkpoints, runtime discovery, and observable execution traces.
- **Durability:** Workflow steps/mutations require stable `idempotency_key` values and committed `workflow_checkpoints`. Reconcile database state before resuming; verify ambiguous remote commits before retrying. Local deduplication does not guarantee remote deduplication.
- **Human control:** Drafting, acknowledgement, escalation, discrepancy resolution, custody acceptance, and final sign-off remain distinct. Unfinished work does not automatically transfer to the incoming nurse.
- **Clinical boundary:** Nursing coordination, task tracking, and grounded synthesis only. No autonomous diagnosis, treatment recommendations, medication administration, or order modifications. Preserve conflicting evidence in `conflicts` for human review.
- **Free default:** SQLite, Express, mock providers, and the deterministic mock agent remain runnable locally at $0. Gemini is optional; Bedrock remains a modular optional adapter for the AWS mini challenge.
- **Honest outcomes:** Clearly distinguish local, mock, live Epic, failed, missing, and pending results. No silent fallback or unsupported success/latency/zero-loss claims.

### Integration and submission boundaries

Generic nursing tasks stay local until the target hospital's supported task workflow is verified. Episode Checklist and Community Resource Task APIs are not interchangeable generic bedside task interfaces. Reviewed Clinical Notes creation is a candidate write-back, not proof of dedicated Epic Handoff updates.

Backend OAuth authenticates the application; real clinical deployment additionally needs nurse authentication, authorization, and target hospital configuration. The sandbox does not establish customer-environment access.

The demo should show grounded handoff preparation, a sourced discrepancy, explicit human review/custody acceptance, and recovery with actual checkpoints and audit outcomes. Describe browser voice/chat as an Alexa+ simulation unless a genuine integration is verified. The dashboard interruption control injects an exception; process-exit recovery is tested separately. Do not demonstrate unimplemented provider swapping or write-back as successful live behavior.

Package evidence for idea quality, technical implementation, coherent design, and credible impact. Document optional AWS integration only to the extent verified. The friction log may earn up to 10%; it is not a guaranteed award.

Reference for implementing Epic backend authentication: [Epic OAuth documentation](https://fhir.epic.com/Documentation?docId=patientfacingfhirapps&section=AutomaticClientDistribution). Re-check current official requirements before implementation.

---

## 1. The Core Architectural Boundary: Alexa+ vs MCP Server

One common confusion in hackathons is: *"Will Alexa+ provide the database for us?"*  
**The Answer is NO.**

### Separation of Concerns:

```
┌────────────────────────────────────────────────────────┐
│  ALEXA+ (The Client / LLM Orchestrator in AWS Cloud)   │
│  • Voice Recognition & Natural Language Understanding  │
│  • Client Runtime that queries `tools/list`            │
│  • Calls MCP tools over Streamable HTTP `tools/call`   │
│  • Does NOT own or create hospital databases           │
└───────────────────────────┬────────────────────────────┘
                            │
               Streamable HTTP (POST /mcp)
               "What tools do you have?" (tools/list)
               "Execute get_handoff_context!" (tools/call)
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  SHIFTWEAVE MCP SERVER (Our Self-Hosted Engine)        │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 1. 9 MCP Tools (Input/Output Zod Schemas)        │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ 2. Discrepancy & Conflict Engine (EHR vs Notes)  │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ 3. Checkpointing & Zero-Loss Recovery Engine     │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ 4. Local Database (SQLite with WAL Mode)         │  │
│  │    • Clinical Rosters, Shifts, Tasks             │  │
│  │    • Audit Logs, Idempotent Checkpoints          │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### Why Having our Own Database is Mandatory:
1. **Alexa+ is stateless across deep domain logic**: Alexa+ knows how to converse, but it doesn't know hospital shift windows, ICU patient assignments, or pending IV doses unless an MCP server provides them.
2. **Hackathon Anti-Obviousness Rule**: If our MCP server were just a passthrough without a database, judges would classify it as a *"basic MCP wrapper around an existing API"* (**penalized in the rubric**).
3. **Resilience & Checkpointing**: When an interruption occurs, our server checks its own `workflow_checkpoints` and `tasks` tables to determine what already committed, allowing Alexa+ to resume without repeating work.

---

## 2. Is this a Winning Idea? (Honest Evaluation Against Judges' Rubric)

**Yes, this is an exceptionally strong, top-tier hackathon concept.** Here is the honest breakdown of why:

### Comparison: Why 80% of Hackathon Submissions Lose vs Why ShiftWeave Wins

| Evaluation Metric | Typical Losing Submission | ShiftWeave (Winning Approach) |
| :--- | :--- | :--- |
| **Concept Depth** | Single-turn Q&A bot (*"Alexa, what is patient's blood pressure?"*) | **Autonomous multi-turn coordination**: Synthesizes full shift handoffs, detects cross-record conflicts, transfers custody explicitly. |
| **MCP Implementation** | Superficial wrapper around one REST API endpoint | **Deep MCP Spec Compliance**: Runtime discovery (`tools/list`), 9 specialized tools, stateful checkpoints, and swappable provider abstraction. |
| **Transport** | Basic CLI stdio or legacy SSE | **Streamable HTTP (`StreamableHTTPServerTransport`)** on Express `/mcp` matching the exact hackathon mandate. |
| **Observability** | Black-box chat window (judges can't see what the LLM is actually doing) | **Live MCP Execution Trace Panel** in the React UI displaying real-time JSON-RPC tool calls, latencies, and checkpoint IDs. |
| **Safety Guardrails** | Hallucinates medical diagnoses or blindly updates orders | **Strict non-clinical boundary**: Isolates discrepancies into a Conflict Drawer requiring human nurse sign-off. |
| **Resilience Demonstration** | Crashes if connection drops | **Live Chaos Demonstration**: Simulate server crash mid-turn $\to$ Reconnect $\to$ Resume cleanly from checkpoint with zero duplicate writes. |
| **Bonus Capture** | No friction log submitted | **10% Bonus Points** earned via documented `FRICTION_LOG.md`. |

---

## 3. The 4 Official Judging Criteria Breakdown

### Criterion 1: Quality of the Idea (Creative vs. Obvious)
* **The Guideline Rule**: *"Judges should distinguish creative ideas from obvious ones: Obvious: single-turn Q&A bot, basic MCP wrapper around an existing API. Creative: agentic workflow that orchestrates across services autonomously, context-aware add-on that maintains state across sessions, failure recovery."*
* **How ShiftWeave Scores Maximum Points**:
  * Cross-session state persistence via `workflow_checkpoints`.
  * Real-world clinical significance: 80% of serious hospital medical errors occur due to miscommunication during shift handoffs (The Joint Commission).
  * Solves a verified operational nightmare for nurses without attempting dangerous autonomous clinical diagnoses.

### Criterion 2: Technical Implementation
* **The Guideline Rule**: Proper usage of required SDKs, MCP spec version $\ge 2025-11-25$, and Streamable HTTP.
* **How ShiftWeave Scores Maximum Points**:
  * Built using official `@modelcontextprotocol/sdk` v1.32+.
  * Implemented over Streamable HTTP on Express `/mcp`.
  * Integrates AWS Bedrock Converse API for the AWS Builder Mini-Challenge.

### Criterion 3: Design & Product Coherence
* **The Guideline Rule**: Delivers a complete, intuitive, well-considered user experience.
* **How ShiftWeave Scores Maximum Points**:
  * Dual interface: Natural voice interaction (simulating Alexa+) paired with a high-density, professional ICU nurse dashboard.
  * Interactive Conflict Review Drawer giving nurses transparent control over conflicting data sources.

### Criterion 4: Potential Impact
* **The Guideline Rule**: Credible case for solving real customer needs beyond the hackathon.
* **How ShiftWeave Scores Maximum Points**:
  * Every hospital on earth conducts shift handoffs 2 to 3 times every single day.
  * High commercial viability as an ambient AI workflow companion for inpatient healthcare systems.

---

## 4. The 3-Minute Video Demo Narrative (Winning Story Arc)

To win, the video must not just show code; it must tell a gripping story:

1. **Minute 1: The Problem & The Ambient Query (0:00 - 1:00)**:
   * Introduce Seema (leaving night shift) and Reema (arriving day shift in ICU-B).
   * Reema asks: *"Alexa, what did Seema leave unresolved for my shift?"*
   * Show Alexa+ responding with synthesized handoff while the **Live Execution Trace panel** displays real-time `tools/list` and `get_handoff_context` calls.
2. **Minute 2: Conflict Isolation & The Live Chaos Crash (1:00 - 2:00)**:
   * Show the UI popping up a **Yellow Alert**: Room 305-B medication discrepancy (EHR says given, notes say pending). Show human confirmation.
   * **The Wow Factor**: Click **"Simulate Server Crash"** mid-draft!
   * The connection drops. Click **"Reconnect & Resume"**.
   * Show the system querying the latest checkpoint and completing the handoff **without repeating earlier steps**.
3. **Minute 3: Provider Swapping & Conclusion (2:00 - 3:00)**:
   * Click **"Swap Provider"** to alternate hospital format, demonstrating MCP runtime discovery in action.
   * Highlight AWS Bedrock integration and close on the clinical safety impact.

---

## 5. Bidirectional Integration: External EHR Write-Back (Confirmed Architectural Decision)

A crucial architectural decision confirmed for ShiftWeave is **Bidirectional Clinical Integration (Read + Write)**:
* **Not Read-Only**: ShiftWeave does not merely query external hospital data; it actively **WRITES BACK** verified workflow outcomes to an external FHIR R4 EHR destination.
* **Pluggable Destination**: The exact external write destination is modular and swappable (e.g., **Medplum Cloud EHR**, **Epic on FHIR Sandbox**, or **Oracle Cerner Sandbox**). While the final cloud target is configurable, the **Write-Back pipeline itself is confirmed and fully supported**.
* **Confirmed Clinical Write Operations**:
  1. **Bedside Verification Status Updates (`Task.Update`)**: When incoming nurse Reema bedside-verifies Room 305-B's Vancomycin order, ShiftWeave writes the status update (`completed`) with human verification notes back to the external FHIR server.
  2. **Grounded SBAR Handoff Report (`DocumentReference` / `Communication`)**: The synthesized shift handoff document is committed to the external EHR as an official clinical handoff record.
  3. **Custody Transfer Event (`AuditEvent` / `Provenance`)**: Transfers clinical custody with digital timestamp and nurse signatures.
* **Tiered Write Model**:
  * **Immediate Local Write (0.1ms)**: Absorbed by the local SQLite edge cache for instant tablet feedback and crash-proof checkpointing.
  * **External EHR Write**: Dispatched to the external FHIR R4 cloud endpoint when network connectivity is confirmed, ensuring hospital records are permanently updated without slowing down the nurse's tablet.

---

## 6. Final Verdict: Why ShiftWeave Will Stand Out
ShiftWeave is not another toy chatbot. It is a **fault-tolerant, protocol-native, bidirectional, clinically grounded workflow coordinator**. It checks every box in the hackathon rubric, complies strictly with `important.md`, and directly solves an authentic human workflow problem.
## 5. Final Verdict: Why ShiftWeave Will Stand Out
ShiftWeave is not another toy chatbot. It is a **fault-tolerant, protocol-native, clinically grounded workflow coordinator**. It checks every box in the hackathon rubric, complies strictly with `important.md`, and directly solves an authentic human workflow problem.



##7.
---Agrasen epic R4 catalog
The worksheet, assembled from Epic’s public R4 catalog

The Epic catalog has APIs for most of what a nurse “brain sheet” contains:

Worksheet section	Epic R4 source
Patient header	Patient (Demographics), Encounter (Patient Chart)
Allergies	AllergyIntolerance (Patient Chart), List (Allergies)
Diagnosis	Condition (Encounter Diagnosis), List (Hospital Problem)
Code status	Consent (Code Status)
Isolation / infection	Flag (Isolation), Flag (Infection)
Lines, drains, airways	Device and Observation (Lines, Drains, Airways)
Meds and administration	MedicationRequest, MedicationAdministration
Orders	ServiceRequest (Orders)
Care plan and goals	CarePlan (Inpatient CarePlan), Goal (Care Plan Goal)
Vitals, assessments, flowsheets	Observation (Vital Signs, Assessments, Flowsheets)
Function and diet	Observation (Activities of Daily Living), NutritionOrder
Nursing actions, restraints	Procedure (Nursing Intervention), Procedure (Restricting Intervention)
Handoff document	Binary / DocumentReference (Handoff), content unverified

All of these are in the Epic on FHIR resource summary. I haven’t confirmed that each returns data for the sandbox test patients, so check that in the sandbox before relying on them. 
epic

“One place” and “any platform”
IDs are system-specific. An Epic FHIR patient ID means nothing in Oracle. You need a crosswalk keyed on stable identifiers like MRN, plus NPI for practitioners if the system exposes it.
What is portable is the FHIR R4 shape. Oracle’s Millennium list covers most of the same resource types: AllergyIntolerance, CarePlan, CareTeam, MedicationAdministration, NutritionOrder, Procedure, ServiceRequest and others. Oracle lacks the specialized Flag and Lines/Drains/Airways variants I saw in Epic. 
oracle
The design that gets you “all in one place”: a canonical Worksheet model, one adapter per platform (Epic, Oracle, a UKG stub), and an MCP tool like get_nurse_worksheet(patient_ref) that fans out to those APIs and merges the results. Your source_system and conflicts tables record where each piece came from and where systems disagree.
Production needs a hospital. The open.epic subscription agreement is signed by the organization, not by individual apps. Without a hospital sponsor, you stay in the sandbox. 
epic

Epic’s APIs are also patient-centric (community reports say you resolve a patient first, then pull their data), so “everything for this nurse” would always be a fan-out you build.
