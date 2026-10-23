## Inspiration

A shift ends. The responsibility for unfinished work continues.

We built ShiftWeave around a simple question: **How can the next nurse understand what remains, what needs verification, and what they are taking responsibility for?** Our goal is to make that transition clearer through conversation, with a reliable record behind every answer.

## What it does

ShiftWeave lets nurses ask naturally: “What are my tasks?”, “Where did the previous nurse leave off?” or “What needs my review?”

The assistant retrieves stored patient and task information, remembers context for follow-up questions, highlights conflicting records, and helps prepare handoffs. Supported changes require explicit human confirmation. Incoming nurses accept responsibility deliberately, and interrupted workflows can resume from saved progress.

The value is continuity: **clear information, explicit ownership, and recoverable work.**

## How we built it

We combined a React voice interface with a TypeScript backend, AWS Bedrock for language understanding, and a Model Context Protocol server over Streamable HTTP.

SQLite stores assignments, handoffs, conversation state, audit records and recovery checkpoints. Retry controls prevent tested repeated requests from creating duplicate changes. Backend validation grounds workflow answers in retrieved records and keeps clinical decisions with people.

We retained Epic FHIR integration and added a separate synthetic hospital environment. Reviewers can explore realistic workflows through actual database operations, while external MCP clients default to the Epic integration path.

## Challenges we ran into

Epic’s sandbox provided useful clinical records, but our tested access and patient cohort lacked several nursing workflow scenarios. An approved note-publication attempt also returned a permission denial. We preserved that integration and built an explicitly labeled simulation to demonstrate the missing cases honestly.

Conversation introduced another challenge: understanding intent without letting fluent language invent facts. We refined introductions, follow-ups, discrepancy guidance and confirmation handling while reducing redundant model calls.

Interruption recovery demanded equal care: a lost response must not become a repeated action.

## Accomplishments we're proud of

We built a working workflow engine behind the conversation. Nurses can inspect records, review discrepancies, confirm updates, transfer responsibility and recover supported interrupted workflows.

Our latest local verification passed **220 regression checks, 20 hospital checks and 11 source-isolation checks**. Separate live Bedrock-to-MCP replays demonstrated contextual conversations, including a complete discrepancy review.

We are equally proud of the boundaries: missing information stays missing, failed integrations remain visible, and local completion is never presented as successful Epic publication.

## What we learned

A natural conversation is only useful when the system can explain—and preserve—what actually happened.

Language models help interpret requests. Reliable execution requires validated permissions, current records, explicit confirmation and durable state. We also learned that realistic simulation is valuable when its provenance is clear and its operations are real.

Trust comes from accurate answers, honest uncertainty and recoverable actions.

## What's next for ShiftWeave

Our next milestone is deployment and device validation: testing the actual microphone experience, measuring response times, strengthening public-preview controls and rehearsing backup recovery.

Beyond the demonstration, we want to validate institution-approved identity, task and handoff mappings, then evaluate the product with nursing teams. Clinical deployment and successful Epic publication remain separate validation milestones.

Our ambition is to help teams spend less effort reconstructing a shift—and carry its unfinished work forward with greater clarity and accountability.
