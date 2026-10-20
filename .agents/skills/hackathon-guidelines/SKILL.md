---
name: hackathon-guidelines
description: Apply ShiftWeave repository rules, Alexa+ hackathon requirements, architecture and schema context when implementing, reviewing, testing, or documenting this project's nursing handoff workflows. Consult for every implementation decision in dev_assist.
---

# ShiftWeave Project Guidelines

Apply this repository-local skill throughout ShiftWeave work. The repository root is `../../..` from this directory. These rules do not apply to unrelated projects.

## Load current requirements

At task start, read [AGENTS.md](../../../AGENTS.md) and [important.md](../../../important.md). Follow higher-priority instructions and the user's current authorized scope. Re-read changed sources after a branch change, sync, or requirements update.

Read [project-context.md](references/project-context.md) for the architecture, schema invariants, document map, and contradictions. Open relevant original documents and implementation before decisions; the reference is a navigation aid, not a replacement for current sources.

## Apply at every implementation step

1. **MCP:** Minimum protocol `2025-11-25`; preserve `StreamableHTTPServerTransport` on Express `/mcp`, runtime discovery, and validated tool contracts. Agent-to-MCP traffic uses this transport. External provider adapters call the provider's FHIR HTTP interface; existing dashboard companion APIs are separate from MCP transport.
2. **Workflow depth:** Preserve multi-turn and cross-session context, durable checkpoints, and observable execution. Do not reduce ShiftWeave to a single-turn answer bot or thin CRUD wrapper. MCP does not automatically provide recovery or data correctness.
3. **Durability:** Every application workflow step/mutation needs an `idempotency_key` and committed `workflow_checkpoints` record. Use stable retry keys and atomic local state/event/checkpoint writes where appropriate. After interruption or ambiguous response, reconcile actual committed state before remaining work. Verify external commits before retrying; local keys alone do not guarantee remote deduplication.
4. **Clinical scope:** Nursing workflow coordination, task tracking, and grounded handoff synthesis only. No autonomous diagnoses, treatment recommendations, medication administration, or clinical-order modifications. Preserve conflicting values and sources in `conflicts` for human review. Acknowledgement, escalation, completion, and custody acceptance are distinct actions.
5. **Ownership:** Seema's unfinished work does not automatically become Reema's responsibility. Carry-forward and acceptance require explicit assignment/handoff state. Do not infer custody from a changed nurse name or generated draft.
6. **Cost:** Keep a runnable $0 local path using SQLite, Express, mock providers and deterministic agent. Gemini is optional and depends on configured service access. Retain Bedrock as an optional modular adapter; default execution must not require cloud credentials or paid calls.
7. **Visible failures:** Follow the API documents' zero-silent-fallback requirement. Surface external failures and degraded/mock mode explicitly to callers/UI and audit logs. Do not turn failures into empty successes. Preserve timestamps, units, source IDs and uncertainty; missing allergy data is not a verified negative allergy history.
8. **Evidence:** Derive traces, recovery metrics and sync status from real outcomes. Distinguish proposed design, implemented code, tested behavior and verified external integration. Do not claim production readiness, Epic compatibility, successful writes, latency, or zero duplicates without supporting checks.

Apply checks to the behavior affected by each step. Markdown/skill edits do not require database checkpoint records. Do not add unrelated features or approval ceremonies to satisfy a checklist.

## Epic decisions

Read [incomingapikey.md](../../../incomingapikey.md) before API/provider changes. It corrects older `apicall.md` and `callapi.md` assumptions:

- Incoming means ShiftWeave calls Epic, including permitted writes. The supplied Outgoing list is not required for the current flow.
- Verify target-environment permissions, supported searches, resource relationships and actual test data. HAPI is not Epic.
- Episode Checklist tasks are not a guaranteed generic ICU task source. Community Resource updates are not generic bedside medication-task updates.
- Follow linked Binary resources when content requires them; verify encounter/location mappings for room, bed and admission context.
- Human-reviewed Clinical Notes creation is a candidate write-back, not proof of dedicated Epic Handoff updates. Keep draft, review and sync states distinct.
- Verify current official provider documentation before implementing external behavior. Example payloads and catalog listings do not prove enabled access.

## Verification and reporting

Check affected contracts, state transitions, retry/recovery behavior, clinical scope, error reporting and local execution before completing implementation. Run proportionate checks. Use isolated test databases for mutating verification; existing integration scripts can change configured handoffs/conflicts.

For documentation/skill-only changes, validate skill structure, links and rule consistency; application tests are unnecessary. Report actual checks and unresolved gaps. Keep progress and friction-log claims factual when updating those documents.

## Hackathon criteria

`important.md` evaluates idea quality, technical implementation, coherent design and credible impact. Discovery, interoperability, recoverable workflows and real traces support the demonstration. The simulated Alexa+ track option exists, but this repository's AGENTS.md retains MCP requirements. AWS integration is optional for the mini challenge. A factual friction log may earn **up to 10%**, not an automatic award.
