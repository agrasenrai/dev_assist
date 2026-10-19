# Amazon Developer Hackathon — Alexa+ Track Guidelines & Rules

## 1. Track Requirements (Alexa+)
* **Core Deliverable**: Build a working **Agent Skill** or a self-hosted **MCP server**, implementing MCP spec version (minimum acceptable version is **`2025-11-25`**).
* **Transport**: Must be implemented over **Streamable HTTP** (`StreamableHTTPServerTransport`).
* **Alternative Simulated Option**: Developers can simulate the Alexa+ experience in a web app using their own agentic tools — built using any AI or agentic tool of choice (no specific framework, SDK, or MCP-shaped surface required). The code repository must still include the simulation's source code, and the demo video must clearly show the simulated experience.
* **Official Documentation**:
  * MCP Getting Started: `https://modelcontextprotocol.io/docs/latest/getting-started/intro`
  * Build with Agent Skills: `https://apps.extensions.modelcontextprotocol.io/api/#build-with-agent-skills`
  * Streamable HTTP Transport: `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http`
  * Community Forum: `https://community.amazondeveloper.com/c/fire-apps/17` (Discussions & Q&A for Fire TV, Alexa, and Ring developers).

---

## 2. Mini Challenge (AWS Services)
* Any Primary Track project that incorporates **AWS services** (e.g., Amazon Bedrock, AgentCore, Strands SDK, Kiro Crew, SageMaker, etc.) with documented integrations.
* A project can only win one (1) track prize and one (1) mini challenge prize.

---

## 3. Judging Criteria

### A. Quality of the Idea
* Is this a creative, imaginative use of the required tools?
* Does the team demonstrate a genuine understanding of the developer ecosystem and the end-user needs within their chosen track?
* **Distinguish creative ideas from obvious ones**:
  * *Obvious*: Single-turn Q&A bot, basic MCP wrapper around an existing API.
  * *Creative*: Agentic workflow that orchestrates across services autonomously, context-aware add-on that maintains state across sessions, purchasing capabilities, media support (cards, carousels, etc.), MCP Apps, Agent Skills.

### B. Technical Implementation
* How well is the project built, and how effectively does it use the required tech?
* Does it effectively leverage the required APIs, SDKs, or device capabilities for the specified track or mini-challenge?

### C. Design
* Does the project deliver a complete, coherent product experience?
* Is the interaction model intuitive and well-considered for the target device or platform?

### D. Potential Impact
* Does the project make a credible, specific case for solving customer needs?
* Could it realistically serve an audience beyond the hackathon?

---

## 4. Bonus Points (Friction Log)
* Up to **10% bonus** to the final spreadsheet score during Stage 1 downselection.
* Amazon's internal review team assesses submission friction log entries (if provided) and passes a recommended bonus to the Stage 2 judging panel along with shortlisted projects.
