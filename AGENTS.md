# Workspace Agent Rules — Amazon Developer Hackathon (Alexa+ Track)

> **Core Reference**: [`important.md`](file:///C:/Users/siddh/Desktop/dev_assist/important.md) & [`ShiftWeave_Project_Document`](file:///C:/Users/siddh/Desktop/dev_assist/ShiftWeave_Project_Document.docx)

## Required Project Skill and Context

For every task in this repository, load and apply [hackathon-guidelines](.agents/skills/hackathon-guidelines/SKILL.md). Read this file and `important.md` at task start, then consult the skill's [project context](.agents/skills/hackathon-guidelines/references/project-context.md) and relevant architecture/schema/API documents before implementation. Re-read sources when they change rather than relying on an old conversation summary.

At each implementation step, check transport, durable state, idempotency, clinical boundaries, observable outcomes, and the free local default. Apply checks to the behavior being changed; documentation edits do not themselves require clinical workflow checkpoints.

Completion claims in `memory.md`, `plan.md`, and README must be verified against code and checks. For Epic API selection, consult `incomingapikey.md`, which corrects older `apicall.md` and `callapi.md` assumptions. Surface external failures explicitly; never present missing data, failed calls, or mock results as verified live success.

## Mandatory Rules for All Implementation Steps:

1. **MCP Spec & Transport Integrity**:
   * Minimum MCP protocol version: `2025-11-25`.
   * All client-server communication must use **Streamable HTTP** (`StreamableHTTPServerTransport`) on Express `/mcp`.

2. **Creative Agentic Architecture (Anti-Obviousness Rule)**:
   * Do NOT build a simple single-turn Q&A bot or a basic CRUD database wrapper.
   * Every feature must support multi-turn state preservation, cross-session context, checkpointing, and observable execution traces.

3. **Deterministic State & Zero-Loss Interruption Recovery**:
   * All mutations and steps must use `idempotency_key` and commit to `workflow_checkpoints`.
   * After any crash or interruption, state must be reconciled against the database before executing remaining steps.

4. **Safety Boundaries**:
   * Strictly nursing workflow coordination, task tracking, and handoff synthesis.
   * Absolutely NO autonomous clinical diagnosis, treatment recommendations, or order modifications.
   * Conflicting data must be flagged into `conflicts` and presented for human review.

5. **Cost & Feasibility**:
   * Default execution must remain 100% Free, Local, and Fast ($0 cost via SQLite, Express, Mock Providers, and Gemini/Mock Agent).
   * AWS Bedrock must be provided as a modular pluggable adapter for the optional mini challenge.
