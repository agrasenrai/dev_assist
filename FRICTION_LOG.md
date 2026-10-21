# ShiftWeave — Developer Friction Log & Technical Feedback

> **Implementation note (20 October 2026):** This document includes intended design and historical claims. Use [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current verified behavior and limitations; use [incomingapikey.md](incomingapikey.md) for corrected Epic API guidance. External write-back, production authentication, universal recovery guarantees and fixed latency claims are not established by this document.
> **Target Track**: Amazon Developer Hackathon (Alexa+ Track)  
> **Bonus Category**: Developer Friction Log (Up to 10% Bonus Points)  
> **Author**: ShiftWeave Engineering Team  
> **MCP Protocol Spec Version**: `2025-11-25`  
> **Transport**: Streamable HTTP (`StreamableHTTPServerTransport`)  
> **Core Stack**: Node.js v22 (ESM), TypeScript 5.7+, Express 5, `@modelcontextprotocol/sdk` v1.32+, SQLite (WAL Mode), AWS Bedrock Runtime SDK

---

## Executive Summary

To build **ShiftWeave**—an ambient AI nursing shift handoff and fault-tolerant failure recovery system—we engineered a full-stack, production-grade MCP architecture over **Streamable HTTP** (`POST /mcp`), complying with the latest `2025-11-25` protocol specification.

During development, our team logged concrete technical friction points across the MCP TypeScript SDK, Streamable HTTP session lifecycles, Express 5 router modernizations, and AWS Bedrock Converse API tool integrations. This friction log details:
1. **The Exact Friction Point & Symptom** (with error messages).
2. **Root Cause Analysis**.
3. **Our Architecture / Code Resolution**.
4. **Concrete Recommendations for Amazon's Developer & MCP Teams**.

---

## Log Item 1: Streamable HTTP Multi-Session Transport Lifecycle

### 1. The Friction Point
When transitioning from basic stdio/single-client examples to a multi-client production web server mounted on Express `/mcp`, attempting to reuse a single `McpServer` instance across incoming Streamable HTTP connections threw the following runtime exception:
```
Error: Already connected to a transport
    at McpServer.connect (node_modules/@modelcontextprotocol/sdk/dist/server/mcp.js:...)
```

### 2. Root Cause
In `@modelcontextprotocol/sdk`, an `McpServer` instance maintains an internal 1:1 binding to its active transport. While `StreamableHTTPServerTransport` correctly supports session IDs via `sessionIdGenerator`, passing the transport to a shared singleton `McpServer` causes subsequent client handshakes to collide and fail.

### 3. Our Resolution
We developed an isolated **Server Factory Pattern** in `src/server.ts`:
* Created `createShiftWeaveServer(): McpServer` which instantiates and registers all 9 tools per session.
* Implemented stateful session routing via an in-memory session map:
  ```typescript
  interface SessionRecord {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    lastActive: number;
  }
  const sessions = new Map<string, SessionRecord>();
  ```
* On an incoming `initialize` JSON-RPC method, a new server and transport pair is instantiated, registered in `sessions.set(sid, ...)`. Subsequent requests pass the `mcp-session-id` header to route directly to the active session.
* Added an ad-hoc stateless fallback for one-off tool queries.

### 4. Recommendation for Amazon & MCP Teams
* Provide a built-in `McpServerPool` or an Express middleware helper in `@modelcontextprotocol/sdk/server/express.js` that abstracts multi-session lifecycle management, so developers do not have to implement custom session maps from scratch.

---

## Log Item 2: Streamable HTTP Header Negotiation & SSE Chunking

### 2.1 The Friction Point
When testing the MCP server with standard HTTP clients (e.g. `fetch` or Axios) without exact headers, the server silently rejected or hung requests without a clear error diagnostic:
```
HTTP/1.1 406 Not Acceptable (or socket hang up)
```

### 2.2 Root Cause
The `2025-11-25` Streamable HTTP transport specification strictly expects the client to announce support for Server-Sent Events alongside JSON:
```http
Accept: application/json, text/event-stream
```
If a developer sends only `Accept: application/json`, the transport layer may decline the handshake or fail to stream tool execution progress.

### 2.3 Our Resolution
In our client bridge (`src/agent/mcp-client-bridge.ts`), we enforced canonical negotiation headers:
```typescript
const res = await fetch(this.endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {})
  },
  body: JSON.stringify(payload)
});
```
Furthermore, we built a hybrid response parser that automatically unwraps standard JSON responses as well as chunked `data: {...}\n\n` SSE lines.

### 2.4 Recommendation for MCP Team
* If an incoming Streamable HTTP request is missing `text/event-stream` in the `Accept` header, return an explicit, descriptive JSON-RPC error:
  `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Streamable HTTP requires Accept header: 'application/json, text/event-stream'"}}` instead of an ambiguous connection drop.

---

## Log Item 3: Express 5 Router Migration & SPA Wildcard Routing

### 3.1 The Friction Point
To provide judges with a zero-friction demo, ShiftWeave's backend serves the compiled React Clinical Dashboard directly from the Express server. In Express 5 (which upgraded to `path-to-regexp` v8), using standard wildcard route `app.get("*", ...)` crashed server startup immediately:
```
PathError [TypeError]: Missing parameter name at index 1: *; visit https://git.new/pathToRegexpError for info
    at consumeUntil (node_modules/path-to-regexp/src/index.ts:218:17)
```

### 3.2 Root Cause
In `path-to-regexp` v8 (bundled in Express 5), unadorned asterisks `*` are no longer valid route paths; routes must use named wildcards `*splat` or path-agnostic fallback middleware.

### 3.3 Our Resolution
Replaced the fragile `app.get("*", ...)` with a robust path-filter middleware:
```typescript
const clientDist = path.resolve(process.cwd(), "client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req: Request, res: Response, next) => {
    // Pass through API and MCP routes
    if (req.path.startsWith("/api") || req.path.startsWith("/mcp") || req.path === "/health") {
      return next();
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}
```

### 3.4 Recommendation for Hackathon Starters
* Document Express 5 SPA routing patterns in hackathon starter templates, as many developers upgrading to Express 5 will encounter this breaking change.

---

## Log Item 4: ESM `verbatimModuleSyntax` and Type Import Collisions

### 4.1 The Friction Point
Under modern TypeScript (`"verbatimModuleSyntax": true` and `"type": "module"` in `package.json`), running `tsx` against imports like:
```typescript
import express, { Request, Response } from "express";
```
Triggered the following ESM runtime error:
```
SyntaxError: The requested module 'express' does not provide an export named 'Request'
    at ModuleJob._instantiate (node:internal/modules/esm/module_job:180:21)
```

### 4.2 Root Cause
Because Express 5's type definitions export `Request` as an interface, Node's native ESM loader attempts to resolve `Request` as a runtime export when bundled without explicit type qualifiers.

### 4.3 Our Resolution
Enforced explicit type-only imports across all server and provider files:
```typescript
import express from "express";
import type { Request, Response } from "express";
```

### 4.4 Recommendation for Documentation
* Emphasize `import type` conventions in TypeScript MCP documentation to avoid ESM instantiating issues.

---

## Log Item 5: Bridging MCP Tool Schemas with AWS Bedrock Converse API

### 5.1 The Friction Point
To fulfill the **AWS Builder Mini-Challenge**, ShiftWeave connects to Amazon Bedrock Converse API (`ConverseCommand`). However, MCP tool definitions use standard JSON Schema / Zod definitions, whereas AWS Bedrock expects a distinct schema structure:
* Bedrock expects: `{ toolSpec: { name, description, inputSchema: { json: { ... } } } }`
* MCP tools provide: `{ name, description, inputSchema: { type: "object", properties: { ... } } }`

Additionally, Bedrock responses return tool calls inside a nested array:
`response.output.message.content[i].toolUse` with fields `{ name, toolUseId, input }`, requiring normalization to match MCP `tools/call`.

### 5.2 Our Resolution
We developed an automated translation adapter inside `src/agent/llm-provider.ts` (`BedrockLLMProvider`):
```typescript
// Seamlessly map discovered MCP tool declarations to AWS Bedrock Converse format
const tools = availableTools.map(t => ({
  toolSpec: {
    name: t.name,
    description: t.description,
    inputSchema: {
      json: t.inputSchema
    }
  }
}));
```
This enables ShiftWeave to discover tools dynamically via MCP `tools/list` and hand them directly to Bedrock models (Claude 3.5 Sonnet / Amazon Nova Pro) without manual schema redefinition.

### 5.3 Recommendation for Amazon Bedrock Team
* Release an official `@aws-sdk/mcp-bedrock-bridge` package or helper function that allows AWS Bedrock Converse developers to ingest MCP tools natively with one line of code:
  `const bedrockTools = mcpToolsToBedrock(mcpClient.listTools());`

---

## Log Item 6: Public Cloud FHIR Sandboxes vs Local Edge Cache Reliability

### 6.1 The Friction Point
Testing bidirectional EHR integration against open public sandboxes (e.g. Epic Open Sandbox, Cerner Open Sandbox) revealed major operational friction for inpatient clinical workflows:
1. Public EHR sandboxes are almost universally **Read-Only** for unauthenticated/test apps; attempting to write `PUT /Task/:id` or `POST /DocumentReference` returns `403 Forbidden` or requires high-friction SMART-on-FHIR client registration.
2. Cloud round-trip latencies fluctuated between **800ms and 4500ms**, which is unacceptably slow for high-pressure ICU nursing shift handoffs.
3. Network disconnects during live tablet interaction cause catastrophic data loss if state relies exclusively on cloud roundtrips.

### 6.2 Our Resolution: Hybrid Edge-Tiering
We designed the **ShiftWeave Hybrid Model** (`IEHRProvider`):
* **Local Edge Cache (SQLite WAL Mode)**: All nurse station queries and mutations commit locally in **~0.1ms to 3ms** microsecond latency. Intermediate workflow state is committed to `workflow_checkpoints` with UUIDv4 idempotency keys.
* **Pluggable Cloud Sync (Medplum / FHIR R4)**: When network connectivity is established, ShiftWeave dispatches standard FHIR R4 writes (`Task.Update`, `DocumentReference`, `AuditEvent`) to the external cloud EHR tier.
* **Result**: 100% offline uptime, zero-loss recovery during network drops, and full bidirectional healthcare interoperability.

---

## Summary of Architectural Lessons

| Dimension | Initial Friction | Engineered Solution |
| :--- | :--- | :--- |
| **MCP Transport** | `Already connected to a transport` error on concurrent requests | Session-isolated Factory pattern + Map registry |
| **Protocol Handshake** | Silent failures without `Accept: application/json, text/event-stream` | Strict header enforcement + hybrid SSE/JSON unwrap |
| **Web Routing** | Express 5 `path-to-regexp` v8 wildcard crash (`*`) | Route-agnostic fallback middleware for SPA serving |
| **AWS Integration** | Schema divergence between MCP and Bedrock Converse API | Runtime schema transformer in `BedrockLLMProvider` |
| **Clinical EHR** | High cloud latency and restricted public sandbox writes | Hybrid Edge Cache (SQLite WAL) + queued FHIR writes |
| **Epic JWKS & Scopes** | Zero-login HTTPS hosting requirement & SMART v1 vs v2 scope ambiguity | GitHub Pages static JWKS hosting + SMART v2 `.rs` granular permissions |

---

## Log Item 7: Epic on FHIR Backend Registration, JWKS Hosting, and SMART Scope Selection

### 7.1 The Friction Point
When transitioning from synthetic local mocks to real Epic on FHIR sandbox integration, registering a machine-to-machine application (Backend Systems OAuth 2.0 with Private Key JWT Assertion - RFC 7523) presented several architectural friction points:
1. **Public HTTPS Requirement for JWKS Without Authentication:** Epic requires that the public JSON Web Key Set (`jwks.json`) be hosted at a publicly reachable, stable HTTPS URL with zero login or basic auth barriers. For a developer working locally, exposing localhost via transient tunnels (e.g. ngrok) creates unstable, ephemeral endpoints that break Epic's asynchronous key fetching.
2. **SMART Scope Version Ambiguity (SMART v1 vs SMART v2):** In the Epic Build Apps portal, developers must choose between SMART v1 (broad `system/Resource.read`) and SMART v2 (fine-grained CRUDX `.cruds` / `.rs` scopes). Epic displays a warning that SMART v2 is only supported in Epic versions Nov 2024+, leading to confusion over whether selecting SMART v2 limits data access or breaks in the sandbox.
3. **FHIR ID Generation Scheme (Constrained vs Unconstrained):** Epic prompts between "Use 64-Character-Limited FHIR IDs for USCDI FHIR Resources" and "Use Unconstrained FHIR IDs." Developers must ensure their database schema handles varying identifier lengths without truncation errors.

### 7.2 Root Cause Analysis
* **JWKS Hosting:** Epic's OAuth token endpoint (`oauth2/token`) verifies client assertion JWTs by querying the registered `Non-Production JWK Set URL` directly from Epic's cloud infrastructure. If the URL is behind a corporate VPN, auth gate, or temporary localhost tunnel, token exchange fails with `invalid_client`.
* **SMART v2 Capabilities:** SMART v2 does not restrict data fields; rather, it introduces fine-grained action specifiers (`r` = read, `s` = search, `c` = create, `u` = update, `d` = delete). Epic's developer sandbox (`fhir.epic.com`) runs the latest release and fully supports SMART v2, whereas the warning applies strictly to older on-premise hospital environments.
* **FHIR IDs:** Official HL7 FHIR specifies `id` as `[A-Za-z0-9\-\.]{1,64}`. However, Epic's sandbox test fixtures frequently use native unconstrained identifiers (e.g. `erXuFYUfucBZPVZEIC5nnzg3`). Enforcing custom truncation logic creates unnecessary friction.

### 7.3 Our Resolution & Configuration
1. **Decoupled Key Hosting via GitHub Pages:**
   * Generated an RSA 2048-bit key pair locally (`RS384` algorithm, unique `kid`).
   * Encrypted and retained `private-key.pem` strictly on the local machine (`./keys/private_key.pem`, added to `.gitignore`).
   * Published ONLY the public `jwks.json` to a dedicated public GitHub repository deployed via GitHub Pages at:
     `https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json`
   * Provides 100% uptime, zero cost, native HTTPS, and instant public accessibility without exposing the development backend.
2. **Standard-Compliant Configuration Profile in Epic Portal:**
   * **Application Audience:** Backend Systems (Backend)
   * **Use Case:** General
   * **SMART on FHIR Version:** R4
   * **SMART Scope Version:** SMART v2 configured (enabling modern `.rs` read+search permissions)
   * **FHIR ID Generation Scheme:** Use Unconstrained FHIR IDs (seamless compatibility with Epic sandbox test patients)
   * **Non-Production JWK Set URL:** `https://agrasenrai.github.io/epic-sandbox-jwks/jwks.json`
   * **Non-Production Client ID:** `ccc8c11f-4af0-4caf-b981-848012aab1a2`
   * **Saved State:** Successfully saved under **Save & Ready for Sandbox**

### 7.4 Recommendation for Epic & Hackathon Teams
* In developer tutorials, explicitly recommend GitHub Pages as the simplest, zero-cost method for hosting static non-production JWKS files for backend system development.
* Clarify in the Build Apps UI that the SMART v2 Nov 2024 warning does not apply to the developer sandbox, reassuring builders that SMART v2 is fully functional in sandbox testing.

---

## 8. Live workflow verification — 21 October 2026

- The existing encrypted signing key matched the public JWKS and obtained a live Epic token. The MCP workflow successfully read source records, drafted a handoff, transferred custody explicitly, finalized locally and refreshed without stealing custody back.
- MedicationAdministration and DocumentReference returned HTTP 200 bundles containing an OperationOutcome warning, not clinical records. The adapter now separates warnings from resource counts, follows bounded same-endpoint pagination and reports partial/failed sections explicitly.
- Practitioner.Read and the explicitly human-approved DocumentReference.Create attempt returned HTTP 403. The latter is recorded as FAILED, with no invented remote identifier. API registration/access is being checked; write-back remains disabled. A catalog listing or working token does not prove write access.
- The existing local database and pre-migration backups reported corruption, including unreadable checkpoint/audit/receipt records. With owner approval, a separate fresh Epic demo database was selected after integrity verification. Original files were preserved; no claim is made that old workflow history was recovered.
- Evidence is in `deploy/epic-workflow-live-report.json` and `deploy/epic-write-report.json`. Model speed, production clinical authorization and universal zero-loss recovery are not established by these tests.

*This log distinguishes resolved implementation issues from remaining external access restrictions.*

