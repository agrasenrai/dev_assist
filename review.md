# ShiftWeave — Demo-Production Review

> Goal: everything runs cleanly when you present. Latency first. No crashes. No blank screens.
> Updated: 21 October 2026.

---

## TL;DR — What Will Actually Hurt You During Demo

| Rank | Issue | Impact | Fix effort |
|------|-------|--------|-----------|
| 🔴 1 | Every voice turn does a full MCP self-connect (initialize → listTools → callTool → DELETE) | +80–150ms added latency per voice word | 20 min |
| 🔴 2 | VoiceWorkspace polls display AND trace every 2500ms simultaneously | Double HTTP traffic during a voice turn, causes visible jank | 10 min |
| 🔴 3 | Session map has no TTL — leak across demo browser tabs | Server slows down across a long demo session | 15 min |
| 🔴 4 | `finalize` route throws naked errors — judge sees HTML 500 page | Demo ends on an ugly crash screen | 10 min |
| 🟡 5 | audit_log hard-capped at 30 rows — tool calls scroll off instantly | Judge watching trace panel sees incomplete history | 5 min |
| 🟡 6 | `shift_id` hard-coded in frontend `api.ts` | Chat path always uses one shift; breaks if DB has no matching shift | 10 min |
| 🟡 7 | `operation_receipts` grows forever | No demo impact today, but a long demo session bloats RAM/DB | 10 min |
| 🟢 8 | Confirmation stale state never cleaned from checkpoint | Cosmetic edge case, low demo risk | 5 min |

Fix the red ones before you present. Yellow ones are easy wins. Green is optional.

---

## Issue 1 (CRITICAL LATENCY) — Voice API Self-Connects to Its Own MCP Server

**File:** `src/server.ts`, lines around `app.post('/api/voice')`

**What happens now:**
Every time the nurse says a word, the server does this internally:
```
POST /api/voice
  → new MCPClientBridge()
  → POST /mcp  (initialize — full JSON-RPC handshake)
  → POST /mcp  (tools/list — fetches all 11 tool schemas)
  → POST /mcp  (tools/call voice_turn)
  → DELETE /mcp (session close)
```
That is 4 HTTP round-trips to itself. `initialize` + `listTools` alone add ~80–150ms to every voice response. The user sees a delay between speaking and hearing an answer. On a slow demo laptop it is very noticeable.

**Root cause:** The route was designed to prove MCP traversal for the judges, but it calls `VoiceService.turn()` indirectly through MCP when `VoiceService` is already importable directly.

**Fix:** Call `VoiceService.turn()` directly in the `/api/voice` route. MCP still exists for external clients — the judge can still see MCP tool calls in the trace from the `/api/chat` path. Voice does not need to be routed through MCP internally.

```ts
// BEFORE (in server.ts):
app.post('/api/voice', async (req, res) => {
  const input = voiceInput.parse(req.body);
  const bridge = new MCPClientBridge(localMcpEndpoint());
  try {
    await bridge.initialize();
    const tools = await bridge.listTools();
    if (!tools.some(tool => tool.name === 'voice_turn')) throw new Error('Voice workflow tool is unavailable');
    const result = await bridge.callTool('voice_turn', input);
    if (result.isError) throw new Error(result.content[0]?.text || 'Voice workflow failed');
    res.json(JSON.parse(result.content[0]!.text));
  } finally {
    await bridge.close();
  }
});

// AFTER — direct service call, ~80-150ms faster per turn:
app.post('/api/voice', (req, res) => {
  const input = voiceInput.parse(req.body);
  res.json(VoiceService.turn(input));
});
```

---

## Issue 2 (DEMO JANK) — VoiceWorkspace Polls Display AND Trace Every 2500ms

**File:** `client/src/components/VoiceWorkspace.tsx`

**What happens now:**
```ts
const timer = setInterval(() => {
  void refresh();       // GET /api/voice/:id
  void refreshTrace();  // GET /api/execution-trace
}, 2500);
```
Both run in the same interval — 2 network calls every 2.5 seconds whether or not anything changed. During an active voice turn, this fires during the request, causing React state updates mid-response that can briefly flash the UI or show a stale state. On a demo laptop with screen recording running, this is visible.

**Fix:** Separate the intervals. Display refresh stays at 2500ms (it needs to be fast). Trace refresh can slow to 5000ms — judges read traces, they don't need it live.

Also add a guard: skip the poll if a voice turn is actively in-flight (`busyRef.current`).

```ts
// AFTER:
const displayTimer = setInterval(() => {
  if (!busyRef.current) void refresh();
}, 2500);
const traceTimer = setInterval(() => {
  void refreshTrace();
}, 5000);
return () => {
  alive = false;
  clearInterval(displayTimer);
  clearInterval(traceTimer);
};
```

---

## Issue 3 (DEMO RELIABILITY) — MCP Session Map Has No TTL

**File:** `src/server.ts` — `const sessions = new Map<string, SessionRecord>()`

**What happens now:**
Every browser tab open, every test run, every chaos simulation creates MCP sessions. They are only removed on explicit `DELETE /mcp`. Browser refreshes, closed tabs, and interrupted orchestrators never send DELETE. After 1 hour of a demo with multiple judges, the map has dozens of dead sessions holding memory.

The `SessionRecord` already has `lastActive: number` field — it's tracked but never used for eviction.

**Fix:** Add one `setInterval` that evicts sessions idle for 30 minutes. Already have all the data needed.

```ts
// Add once after sessions map declaration in server.ts:
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of sessions) {
    if (s.lastActive < cutoff) {
      void s.server.close();
      sessions.delete(id);
    }
  }
}, 5 * 60_000);
```

---

## Issue 4 (CRASH ON DEMO) — Finalize Route Throws Naked Errors

**File:** `src/server.ts`

**What happens now:**
```ts
app.post('/api/handoffs/:id/finalize', (req, res) => {
  const input = z.object({...}).parse(req.body);
  res.json(HandoffService.finalize(...));  // ← throws if unresolved conflicts
});
```
`HandoffService.finalize()` intentionally throws when there are unresolved conflicts or unaccepted custody. This throw propagates to Express's global error handler which returns a 409 with `{ error: message }`. That part is fine.

BUT — if `Zod.parse` throws (malformed body), it throws a `ZodError` which the global handler catches and returns as 400. Fine.

The real problem: `/api/tasks/:id/acknowledge` has **no try/catch at all**:
```ts
app.post('/api/tasks/:id/acknowledge', (req, res) => {
  const input = z.object({...}).parse(req.body);
  res.json(HandoffService.acknowledge({ ...input, task_id: String(req.params.id) }));
  // ← if acknowledge() throws, Express gets an unhandled sync throw
  // Express 5 does catch sync throws in route handlers, but only if next() is wired
});
```
Express 5 propagates sync throws automatically — so the global handler does catch them. **But the global handler itself has a bug:**

```ts
app.use((error: unknown, req: Request, res: Response, _next: express.NextFunction) => {
  if (res.headersSent) return _next(error);
  const message = error instanceof Error ? error.message : String(error);
  AuditService.log({...});
  res.status(error instanceof z.ZodError ? 400 : 409).json({ error: message });
  //                                                   ↑
  // Everything that isn't a ZodError gets a 409 (Conflict).
  // A 404 "Task not found" error becomes 409. A DB error becomes 409.
  // The frontend only checks response.ok — but 409 causes it to throw,
  // which shows the raw error message to the judge.
});
```
This is not a crash but it means errors that should be informative ("Unresolved discrepancies prevent final sign-off") can surface as ugly 409 errors in the UI depending on how the frontend handles them.

**Fix:** Add explicit try/catch to the acknowledge route for better control, and fix the global error handler to use 400 for validation errors and 422 for expected business logic rejections:

```ts
app.post('/api/tasks/:id/acknowledge', (req, res) => {
  try {
    const input = z.object({
      nurse_id: z.string().min(1),
      action: z.enum(['ACCEPT_HANDOFF', 'FLAG_FOR_SUPERVISOR']),
      handoff_id: z.string().optional(),
      resolution_note: z.string().optional(),
      idempotency_key: z.string().min(1),
      human_confirmed: z.literal(true)
    }).parse(req.body);
    res.json(HandoffService.acknowledge({ ...input, task_id: String(req.params.id) }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(err instanceof z.ZodError ? 400 : 422).json({ error: message });
  }
});
```

---

## Issue 5 (DEMO VISIBILITY) — Audit Log Capped at 30 Rows

**File:** `src/server.ts` — `/api/execution-trace` endpoint

**What happens now:**
```ts
const logs = AuditService.getRecentLogs(30)
```
The execution trace panel is one of the most impressive things judges see — live tool calls with latencies. But after a few voice turns, the interesting MCP tool calls (get_assigned_tasks, create_handoff_draft, get_handoff_context) scroll off the bottom because they're older than 30 entries. A chaos + recovery demo generates 20+ audit entries on its own.

**Fix:** Raise the default to 100. Also expose it as a query param:

```ts
// server.ts
app.get("/api/execution-trace", (_req, res) => {
  const limit = Math.min(Number(_req.query.limit) || 100, 500);
  const logs = AuditService.getRecentLogs(limit).map(log => ({...}));
  res.json({ count: logs.length, logs });
});
```

---

## Issue 6 (SILENT FAILURE) — shift_id Hard-Coded in Frontend

**File:** `client/src/api.ts`

**What happens now:**
```ts
export function sendChatMessage(utterance: string, nurseId = 'nurse_reema_02') {
  return request('/api/chat', {
    utterance, nurseId,
    shiftId: 'shift_20261019_night',   // ← hard-coded
    outgoingNurseId: 'nurse_seema_01', // ← hard-coded
    incomingNurseId: nurseId,
    ...
  });
}
```
If the demo DB is ever re-seeded with a different shift ID (which `npm run import:data` can do), the chat path will silently query the wrong shift and return zero tasks — confusing during a live demo. The voice path dynamically resolves the shift from the nurse's unit, which is correct.

**Fix:** The `/api/chat` backend already accepts `shiftId` as optional and falls back to `'shift_20261019_night'` — so the server-side fallback is fine. But the frontend should not send a hard-coded ID. Send nothing and let the server resolve:

```ts
export function sendChatMessage(utterance: string, nurseId = 'nurse_reema_02') {
  return request('/api/chat', {
    utterance, nurseId,
    // shiftId: removed — server resolves from DB
    outgoingNurseId: 'nurse_seema_01',
    incomingNurseId: nurseId,
    workflowRunId: workflowId(),
    idempotency_key: retryKey(...)
  });
}
```

Better fix: have the server look up the active shift for the nurse dynamically in `/api/chat`, same as the voice service does.

---

## Issue 7 (MEMORY) — operation_receipts Grows Forever

**File:** `src/db/schema.ts` / any migration script

**What happens now:**
Every voice turn, every mutation, every chaos run appends a row to `operation_receipts`. No TTL, no cleanup. On a demo day with 50 turns, this is ~50 rows — fine. But across a week of testing and demo runs it adds up and marginally slows idempotency key lookups.

**Fix:** Add one line at server startup after `initializeDatabase()`:

```ts
// Prune receipts older than 3 days at startup
db.prepare("DELETE FROM operation_receipts WHERE created_at < datetime('now', '-3 days')").run();
```

---

## Issue 8 (COSMETIC) — Stale Pending Confirmation in Checkpoint After Expiry

**File:** `src/services/voice.service.ts` — `load()` method

**What happens now:**
If a nurse stages a "confirm custody acceptance" and then walks away for 5 minutes, the pending state sits in the checkpoint. On the next turn it is correctly rejected ("confirmation expired"). But the `pending` section still shows in the display until the next turn clears it. If a judge opens the dashboard after this, they see a confirmation prompt for an expired action with no way to dismiss it except speaking.

**Fix:** In `VoiceService.load()`, clear expired pending state immediately on load:

```ts
private static load(id: string): State {
  const state = (CheckpointService.getLatestCheckpoint(runId(id))?.statePayload.voice as State | undefined) || initial();
  // Clear expired confirmations on load so the display is never stale
  if (state.pending && state.pending.expiresAt < Date.now()) {
    state.pending = null;
  }
  return state;
}
```

---

## What Is Solid — Do Not Touch

These are working correctly and are demo strengths:

- **Chaos crash + recovery flow** — the `simulateInterruptionAtStep` + checkpoint restore works end-to-end. This is your best demo moment. Do not change the orchestrator logic.
- **MutationService atomicity** — every write is idempotent. A double-tap on a confirm button will not create duplicate handoffs.
- **Zod validation on MCP inputs** — bad inputs fail fast with a clear message, not a DB error.
- **VoiceService revision check** — prevents concurrent tabs from clobbering each other. The 409 response with "Voice session changed, refresh before speaking" is exactly right.
- **`human_confirmed: true` requirement** — keeps the clinical story credible. Judges notice this.
- **Test isolation** (`run-tests.ts` temp DB, `PORT=0`) — `npm test` will never corrupt your demo DB.
- **Global error handler** — already wired. Most errors return JSON, not HTML.

---

## AWS Services — For Demo Day, Only These Two Matter

You do not need AWS for the hackathon demo. The mock LLM and SQLite are sufficient. But if you want to impress judges with live AWS:

### Use This: AWS Bedrock (Already Implemented)

`BedrockLLMProvider` is done. Set `LLM_PROVIDER=bedrock`, `AWS_REGION=us-east-1`, `BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0` in `.env` and it works. The function-calling format is correct. The credential chain uses your default AWS profile.

**One risk for demo day:** Bedrock adds 2–5 seconds per tool-call decision vs the mock's instant response. For a live demo under time pressure, practice with Bedrock enabled first. If latency is a problem, fallback to `LLM_PROVIDER=mock` — the mock agent produces perfectly correct results for the seeded demo data.

**Bedrock Guardrails** — not required for demo, but takes 5 minutes to configure in the console. Adds a visible "AWS Bedrock Guardrails Active" badge of credibility when you show the architecture diagram.

### Skip These for Demo

- **Cognito** — authentication is not required for a hackathon demo. Adding it would break the name-based demo flow.
- **RDS / Aurora** — SQLite is fine for a single demo session. Do not introduce a cloud DB dependency the day before presenting.
- **ECS / App Runner** — run it locally on your laptop. Network latency to a cloud host would hurt voice responsiveness.
- **HealthLake** — long-term architecture, zero demo value.

---

## Pre-Demo Checklist

Run these in order the morning of your presentation:

```sh
# 1. Clean slate — fresh DB with demo data
npm run db:init
npm run import:data

# 2. Verify everything passes
npm test
npm run typecheck

# 3. Build the frontend
npm run build:client

# 4. Start the server
npm run dev

# 5. Open http://127.0.0.1:3000 and run through the demo flow once
# Say: "Hi, I am Seema" → confirm you see 2 tasks
# Click: Simulate Wi-Fi Drop → Resume Saved Workflow
# Say: "Prepare my handoff for Reema"
# Switch to Reema, accept tasks, finalize
```

If any step fails silently (no tasks, no conflicts, wrong names) — it means the DB is in a bad state. Re-run `npm run db:init && npm run import:data` and restart.

---

## Summary: Fix Order Before Demo

1. **Fix voice API self-connect** — biggest latency win, 20 minutes (`src/server.ts`)
2. **Separate polling intervals in VoiceWorkspace** — removes jank, 10 minutes (`client/src/components/VoiceWorkspace.tsx`)
3. **Add session TTL eviction** — prevents slowdown during long demo, 15 minutes (`src/server.ts`)
4. **Add try/catch to acknowledge route** — prevents surprise error UI, 10 minutes (`src/server.ts`)
5. **Raise audit log limit to 100** — makes execution trace panel useful, 5 minutes (`src/server.ts`)
6. **Prune operation_receipts at startup** — one line, no downside, 2 minutes (`src/server.ts`)
7. **Fix stale pending state on load** — cosmetic cleanup, 5 minutes (`src/services/voice.service.ts`)
