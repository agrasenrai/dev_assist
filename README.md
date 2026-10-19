# 🏥 ShiftWeave
### Ambient AI Nursing Shift Handoff, Clinical Discrepancy Isolation & Zero-Loss Failure Recovery

> **Amazon Developer Hackathon — Alexa+ Track Submission**  
> **Protocol Specification**: Model Context Protocol (MCP) `2025-11-25`  
> **Primary Transport**: Streamable HTTP (`StreamableHTTPServerTransport`) on Express `/mcp`  
> **AWS Integration**: Amazon Bedrock Converse API (Claude 3.5 Sonnet / Amazon Nova Pro)  
> **Default Execution**: 100% Free, Local-First, Zero Cloud Cost ($0.00) via SQLite WAL Mode  
> **Bonus Submission**: [Detailed Developer Friction Log (10% Bonus Points)](./FRICTION_LOG.md)

---

## 🌟 Overview: What is ShiftWeave?

According to **The Joint Commission**, an estimated **80% of serious hospital medical errors** involve miscommunication between healthcare providers during patient shift handoffs. In fast-paced Intensive Care Units (ICUs), nurses juggle bedside emergencies, conflicting EHR records, handwritten shift notes, and frequent device disconnects.

**ShiftWeave** is an ambient clinical workflow agent designed for the **Alexa+** smart assistant and hospital nurse tablets. Operating over **Streamable HTTP MCP** (`POST /mcp`), ShiftWeave:
1. **Coordinates Inpatient Shift Transitions**: Synthesizes verified, structured **SBAR** (Situation, Background, Assessment, Recommendation) shift handoffs between outgoing nurses (e.g., *Seema Patel, RN*) and incoming nurses (e.g., *Reema Roy, RN*).
2. **Enforces Strict Clinical Safety Boundaries**: Cross-references EHR orders against nurse shift notes. When discrepancies arise (e.g. EHR logs a dose as given, but nurse notes state delayed), ShiftWeave **strictly refuses** autonomous resolution and isolates the conflict into an interactive human-review drawer.
3. **Guarantees Zero-Loss Interruption Recovery**: Hospital tablets frequently drop Wi-Fi or suffer device restarts. ShiftWeave commits intermediate progress to atomic SQLite checkpoints with UUIDv4 idempotency keys. After an outage, ShiftWeave reconciles database state and resumes **only remaining steps with 0% duplicated actions**.
4. **Bidirectional EHR Interoperability (Read + Write)**: Implements the **HL7 FHIR R4 standard** (Epic & Oracle Health compliant). It reads active patient rosters and orders, and writes back verified bedside status updates (`Task.Update`) and finalized SBAR handoff documents (`DocumentReference`) to the cloud EHR tier (e.g., Medplum / Epic sandbox).

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph Client_Layer ["Client & Interface Tier"]
        AlexaVoice["🎙️ Alexa+ Ambient Voice / Speech Synthesis"]
        TabletUI["📱 React 18 Clinical Shift Dashboard (Vite + Tailwind)"]
        ChaosPanel["⚡ Judge Demo Controls (Simulate Crash / Zero-Loss Recovery)"]
    end

    subgraph Agentic_Orchestrator ["Autonomous Agent Tier"]
        Orchestrator["🧠 ShiftWeave Orchestrator (Multi-Turn Session Loop)"]
        LLMAdapter["🔌 Pluggable LLM Adapter"]
        Bedrock["☁️ AWS Bedrock Converse API (Mini-Challenge)"]
        MockLLM["⚡ Local Deterministic Agent ($0 Free Default)"]
        MCPClient["📡 MCP Client Bridge (Streamable HTTP /mcp)"]
        LLMAdapter --> Bedrock
        LLMAdapter --> MockLLM
    end

    subgraph MCP_Server ["ShiftWeave MCP Server (Spec 2025-11-25)"]
        HTTPRoute["POST /mcp (StreamableHTTPServerTransport)"]
        Tools["🛠️ 9 Standardized MCP Tools (Zod Validated)"]
        RecoveryEngine["🛡️ State Reconciliation & Recovery Engine"]
        ConflictEngine["⚠️ Clinical Discrepancy & Isolation Engine"]
        HTTPRoute --> Tools
        Tools --> RecoveryEngine
        Tools --> ConflictEngine
    end

    subgraph Hybrid_Data ["Hybrid Edge-Cache & EHR Tier"]
        SQLite[("⚡ Local SQLite Database (WAL Mode)<br/>~0.1ms Microsecond Latency<br/>Checkpoints, Runs, Audit Logs, Cache")]
        ExternalFHIR["☁️ External Cloud EHR (FHIR R4 / Medplum / Epic)<br/>Bidirectional Read + Write-Back"]
    end

    %% Wiring
    AlexaVoice <--> Orchestrator
    TabletUI <--> Orchestrator
    ChaosPanel <--> Orchestrator
    Orchestrator --> LLMAdapter
    Orchestrator <== "Streamable HTTP (JSON-RPC 2.0)" ==> MCPClient
    MCPClient <--> HTTPRoute
    RecoveryEngine <--> SQLite
    ConflictEngine <--> SQLite
    Tools <--> SQLite
    Tools -. "Bidirectional FHIR Write-Back" .-> ExternalFHIR
```

---

## 🛠️ The 9 Standardized MCP Tools

ShiftWeave registers 9 specialized tools under MCP Protocol version `2025-11-25`:

| # | Tool Name | Scope | Idempotent | Description |
| :-: | :--- | :---: | :---: | :--- |
| **1** | `get_assigned_tasks` | Query | Yes | Retrieves clinical and operational tasks assigned to the nurse for a given shift. |
| **2** | `get_task_details` | Query | Yes | Retrieves comprehensive details, patient context, and audit history for a specific task. |
| **3** | `get_task_changes` | Query | Yes | Retrieves recent clinical task events and modifications since a given timestamp or checkpoint. |
| **4** | `get_handoff_context` | Query | Yes | Retrieves operational context required to construct shift handoffs, surfacing pending tasks & conflicts. |
| **5** | `create_handoff_draft` | Mutation | **Yes (Key)** | Creates and persists a structured SBAR shift handoff draft grounded in verified data; writes to external EHR. |
| **6** | `get_workflow_checkpoint` | Query | Yes | Retrieves the latest saved checkpoint state for an active or interrupted workflow run. |
| **7** | `save_workflow_checkpoint` | Mutation | **Yes (Key)** | Commits intermediate workflow progress to SQLite storage for zero-loss crash recovery. |
| **8** | `resume_workflow` | Mutation | **Yes (Key)** | Reconciles state after an interruption, identifying uncommitted actions and avoiding duplicate steps. |
| **9** | `acknowledge_task` | Mutation | **Yes (Key)** | Records explicit human nurse bedside verification, resolves conflict, and updates external FHIR EHR. |

---

## 🏆 Why ShiftWeave Wins (Anti-Obviousness & Technical Depth)

| Hackathon Dimension | Typical Losing Project | ShiftWeave (Winning Approach) |
| :--- | :--- | :--- |
| **Agentic Workflow** | Single-turn Q&A bot (*"Alexa, what is patient BP?"*) | **Autonomous multi-turn coordination**: Synthesizes cross-shift handoffs, detects cross-record conflicts, transfers custody. |
| **MCP Spec Compliance** | Basic stdio CLI script or legacy SSE | **Streamable HTTP (`StreamableHTTPServerTransport`)** on Express `/mcp` with multi-session isolated factory. |
| **Failure Resilience** | Process crash loses all state; repeats completed actions | **Atomic Checkpoints & Zero-Loss Recovery**: Avoids duplicated work upon resumption. |
| **Observability** | Opaque black-box chatbot | **Live MCP Execution Trace Panel** displaying real-time JSON-RPC tool calls, arguments, and millisecond latencies. |
| **Safety Boundaries** | AI hallucinating treatment plans | **Strict Non-Clinical Boundary**: Discrepancies are flagged into a human-review drawer requiring RN sign-off. |
| **Cloud Cost** | Requires paid cloud servers and Docker | **100% Free ($0.00)** local-first execution via embedded SQLite WAL mode. |
| **EHR Interoperability** | Read-only synthetic dummy data | **Bidirectional FHIR R4 Read + Write-Back** (Medplum / Epic compatible). |
| **AWS Integration** | None | **Amazon Bedrock Converse API** modular adapter for the AWS Mini-Challenge. |
| **Bonus Category** | No friction log provided | **10% Bonus Points** earned via documented [`FRICTION_LOG.md`](./FRICTION_LOG.md). |

---

## 🚀 Quickstart for Hackathon Judges (1-Click Run)

### 1. Prerequisites
* **Node.js**: v20 or v22 (v22.14.0 recommended).
* **Package Manager**: npm.

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/agrasenrai/dev_assist.git
cd dev_assist
npm install
npm --prefix client install
```

### 3. Build & Run (Single Command)
Build the React clinical dashboard and start the MCP server:
```bash
npm run build:client
npm run dev
```

The unified server will start on port `3000`:
* 🏥 **Clinical Shift Dashboard**: Open `http://localhost:3000` in any web browser!
* 📡 **Streamable HTTP MCP Endpoint**: `http://localhost:3000/mcp`
* 🩺 **Server Health & Telemetry**: `http://localhost:3000/health`

### 4. Run Automated Protocol Verification Tests
Verify all MCP tools, multi-turn agent coordination, and chaos recovery:
```bash
npm test
```
*Executes `test:mcp` (Streamable HTTP handshake), `test:agent` (multi-turn loop), and `test:chaos` (crash recovery) with 100% pass rate!*

---

## 🎯 Click-by-Click Demo Guide for Judges

Once you open `http://localhost:3000` in your browser:

### Step 1: Inspect the Clinical Shift Header & Hybrid Provider
* Notice the active unit: `ICU-B (Surgical & Cardiac Intensive Care)`.
* Handover: `Outgoing: Seema Patel, RN` ➔ `Incoming: Reema Roy, RN`.
* Click the **"SQLite Edge Cache (~0.1ms)"** button to toggle instantly between the local edge cache and the live FHIR REST API.

### Step 2: The Clinical Conflict Review Drawer (Safety Boundary)
* Observe the **Red Alert Box**: Room 305-B for patient *Elena Rostova*.
* Notice the discrepancy: **System A (EHR Core)** reports `COMPLETED (Logged 06:10)` while **System B (Nurse Notes)** reports `PENDING (Awaiting pharmacy delivery)`.
* Type a bedside verification note: *"Physically verified empty IV bag on pole; infusion completed"* and click **"Verify Bedside & Mark Completed"**.
* Watch the task move to **Completed** in real-time and log an audit trail entry.

### Step 3: Test Ambient Voice / Chat with Alexa+
* Under the **Alexa+ Conversational Interface**, click the quick chip:  
  `"Alexa, what is pending from Seema in ICU-B, and are there any conflicts?"`
* Listen to Alexa speak aloud via browser TTS:
  > *"Good morning, Nurse Reema. Seema assigned two tasks in ICU-B: James Clark in Room 304 had his Q4 neuro check completed normally. However, in Room 305 for Elena Rostova, there is a discrepancy on the IV Vancomycin infusion..."*
* Watch the **Live Execution Trace Panel** stream the underlying MCP tool calls (`get_assigned_tasks`, `get_handoff_context`, `save_workflow_checkpoint`, `create_handoff_draft`) with microsecond latencies (3ms - 9ms).

### Step 4: The Chaos Interruption & Zero-Loss Recovery Demo (The Wow Factor!)
* Click the red button: ⚡ **"Simulate Wi-Fi Drop / Crash"**.
* The server simulates a hospital network disconnect mid-workflow at step 4. Notice that Checkpoint #1 was safely committed to the SQLite database prior to the crash!
* Click the cyan button: 🛡️ **"Resume & Recover State (0% Duplicate Work)"**.
* Watch ShiftWeave reconcile state from the checkpoint, resume the remaining steps, and complete the handoff **without repeating any previously committed actions**!

---

## ☁️ AWS Builder Mini-Challenge Integration

ShiftWeave incorporates **Amazon Bedrock Converse API** (`ConverseCommand`) as a pluggable LLM provider for the AWS Builder track:
* **Supported Models**: `anthropic.claude-3-5-sonnet-20241022-v2:0` and `amazon.nova-pro-v1:0`.
* **Zero-Cost Local Fallback**: If AWS credentials are not configured in `.env`, ShiftWeave defaults to its local deterministic runner (`MockAutonomousAgent`), guaranteeing $0.00 cloud cost and 100% offline reliability.
* **To Enable Bedrock**: Simply configure in `.env`:
  ```env
  LLM_PROVIDER=bedrock
  AWS_REGION=us-east-1
  AWS_ACCESS_KEY_ID=your_key
  AWS_SECRET_ACCESS_KEY=your_secret
  ```

---

## 📂 Project Directory Structure

```
dev_assist/
├── client/                     # React 18 + Vite + TypeScript Clinical Dashboard
│   ├── src/
│   │   ├── components/         # ShiftHeader, TaskBoard, ConflictReviewDrawer, AlexaVoiceSim, etc.
│   │   ├── App.tsx             # Main Dashboard Application
│   │   └── types.ts            # Clinical TypeScript models
│   └── dist/                   # Production build served directly by Express
├── src/
│   ├── agent/                  # Agent Orchestration & Conversational Layer
│   │   ├── mcp-client-bridge.ts# Streamable HTTP MCP Client Bridge (Spec 2025-11-25)
│   │   ├── llm-provider.ts     # Pluggable LLM Adapters (Mock, Gemini, AWS Bedrock)
│   │   └── orchestrator.ts     # Multi-turn conversational loop & safety enforcement
│   ├── db/                     # SQLite Database Layer (WAL Mode)
│   │   ├── connection.ts       # better-sqlite3 connection with PRAGMA foreign_keys
│   │   ├── schema.ts           # 11 Canonical tables DDL
│   │   └── ingest.ts           # Flexible external dataset ingestion pipeline
│   ├── providers/              # Hybrid Provider Architecture (IEHRProvider)
│   │   ├── sqlite-cache-provider.ts  # Microsecond Local Edge Cache (~0.1ms)
│   │   └── fhir-api-provider.ts      # Bidirectional FHIR R4 Read/Write REST Adapter
│   ├── services/               # Core Workflow & Resilience Services
│   │   ├── audit.service.ts    # Telemetry and audit logger
│   │   ├── checkpoint.service.ts # Atomic checkpoints with idempotency deduplication
│   │   ├── conflict.service.ts # Clinical discrepancy detector & resolver
│   │   └── recovery.service.ts # Zero-loss state reconciliation engine
│   └── server.ts               # MCP Server over Streamable HTTP (/mcp) & Express REST APIs
├── scripts/
│   ├── test-mcp-client.ts      # MCP protocol verification suite (tools/list & tools/call)
│   ├── test-agent.ts           # Multi-turn conversational agent test
│   └── test-chaos-recovery.ts  # End-to-end chaos interruption & recovery verification
├── data/                       # Local SQLite data and incoming template drop-in
├── FRICTION_LOG.md             # Developer Friction Log for 10% Hackathon Bonus Points
└── README.md                   # Project documentation & Judges' Guide
```

---

## 📜 License
MIT License. Built with ❤️ for the Amazon Developer Hackathon (Alexa+ Track).
