# Verification record — 21 October 2026

Executed against the local workspace; tests used isolated temporary databases.

| Check | Observed result |
| --- | --- |
| `npm test` | 79 workflow checks passed, including real process-exit recovery and voice-to-MCP assistant turns |
| `npm run test:deployment` | Passed demo access gate, authenticated MCP discovery, minimum protocol rejection, origin rejection, default live-publication denial, mocked Epic failure/allowlist/pagination handling and consistent backup integrity |
| `npm run typecheck` | Passed |
| `npm run build` | Passed backend compilation and Vite production build |
| Final `npx tsc -p tsconfig.build.json` | Passed after the minimum-protocol check was added |
| Compose configuration using `.env.deploy.example` | `docker compose ... config --quiet` passed |
| `git diff --check` | Passed; only line-ending notices |

The first build and workflow-test attempts were blocked by filesystem/loopback sandbox restrictions. Authorized reruns outside that sandbox passed. Tests ran with local Node.js 22.14.0; the Dockerfile targets Node.js 24.

Not executed: Docker image build/container startup (Docker engine unavailable), AWS provisioning, public TLS issuance, live Bedrock/Gemini inference, live Epic calls, real microphone/TTS testing, or a target-host latency benchmark. Epic deployment tests use synthetic in-process responses and are not evidence of live Epic access. The current model interface does not expose token-stream TTFT.
