# ShiftWeave — Remaining Work

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the maintained implementation record.

The original code review's dashboard SQL, audit mappings, conversation persistence, mock grounding, retry/recovery and human-action semantics have been corrected. Verification now uses an isolated database and includes a real worker exit after a committed draft loses its response.

Remaining work:

- Authorized Epic environment, OAuth access and verified resource mappings.
- Hospital-specific nursing task/assignment integration; do not assume generic Task.Update support.
- Human-reviewed external note publishing with explicit sync state and remote retry reconciliation.
- Live Gemini/Bedrock verification with configured access.
- Production authentication/authorization before using identifiable records.
- Larger synthetic roster if required for the demo.
- Submission video and packaging.

Local drafts and workflow acknowledgements are not Epic writes or medication administration. Current implementation does not claim production readiness.
