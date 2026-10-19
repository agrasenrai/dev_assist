---
name: hackathon-guidelines
description: Mandatory guidelines, evaluation criteria, and transport rules for the Amazon Developer Hackathon (Alexa+ Track) based on important.md. Must be consulted for all implementation decisions.
---

# Hackathon Guidelines Skill (Alexa+ Track)

This skill enforces the core rules, architecture constraints, and judging criteria specified in `important.md` for the Amazon Developer Hackathon.

## 1. Non-Negotiable Technical Requirements
* **MCP Specification Version**: Minimum acceptable version is `2025-11-25`.
* **Transport Protocol**: Must use **Streamable HTTP** (`StreamableHTTPServerTransport`) on Express `/mcp`. (Stdio-only or legacy SSE transports alone are not acceptable).
* **Creative Workflow over Obvious Solutions**:
  * *Disqualified/Penalized (Obvious)*: Single-turn Q&A bot, thin database wrapper, superficial MCP tool.
  * *Rewarded (Creative)*: Agentic multi-turn workflow across services, session state preservation, observable execution trace, verified interruption recovery.
* **Clinical Safety**: Pure workflow coordination; no autonomous clinical diagnoses or prescription alterations.

## 2. Mini Challenge (AWS Services Integration)
* Primary track project can win the mini-challenge by incorporating AWS services (e.g. Amazon Bedrock Converse API, Strands SDK, AgentCore, SageMaker) with documented integrations.
* Keep a modular adapter so the system runs free locally (via Gemini/Mock) but seamlessly connects to AWS Bedrock when credentials are provided.

## 3. Judging Criteria & Scoring
* **Tech Implementation**: Proper usage of required APIs, SDKs, and Streamable HTTP.
* **Quality of the Idea**: Autonomous orchestration, context-awareness, and meaningful MCP architectural value (runtime discovery, provider interoperability).
* **Design & Coherence**: Polished user experience (Dashboard + simulated Alexa+ conversational interaction).
* **Potential Impact**: Clear, realistic hospital nursing workflow problem solved (Seema -> Reema shift handoff).
* **Bonus Points (10% Bonus)**: Friction log entries submitted to Amazon's review team.

## 4. Key Links
* MCP Docs: https://modelcontextprotocol.io/docs/latest/getting-started/intro
* Streamable HTTP: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http
* Agent Skills: https://apps.extensions.modelcontextprotocol.io/api/#build-with-agent-skills
