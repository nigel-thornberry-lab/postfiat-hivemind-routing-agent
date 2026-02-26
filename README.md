# Hive Mind Routing Agent

This repository is the initialization baseline for the Post Fiat Hive Mind Routing Agent. It centralizes live network audit outputs, typed schemas, a sample dataset, and the core matching algorithm specification.

## Repository Structure

- `docs/` - design and algorithm documentation
- `data/` - sample datasets for prototype ingestion
- `src/` - implementation code scaffold
- `network-data-audit.md` - live observed network data field audit
- `hivemind-routing-schemas.md` - `OperatorProfile`, `NetworkTask`, and `MatchResult` schemas
- `sample-data.json` - 5 operators, 5 tasks, 5 match results test harness

## Core Documents

- Live audit: [`network-data-audit.md`](./network-data-audit.md)
- Schemas: [`hivemind-routing-schemas.md`](./hivemind-routing-schemas.md)
- Matching pseudocode: [`docs/matching-logic.md`](./docs/matching-logic.md)
- Sample ingestion data: [`sample-data.json`](./sample-data.json)

## Live API Integration

The Routing Agent includes a Task Node API client and ingestion script:

- `src/tasknode-client.mjs`
- `src/fetch-live-state.mjs`
- `src/realtime-listener.mjs`
- `src/health-server.mjs`
- `src/state-ingestion.mjs`
- `src/dispatch-routing.mjs`
- `src/e2e-dry-run.mjs`
- `src/agent-daemon.mjs`

### Required environment variables

- `PFT_TASKNODE_JWT` (required): bearer token for Task Node API auth
- `PFT_TASKNODE_URL` (optional): defaults to `https://tasknode.postfiat.org`
- `PFT_TASKNODE_TIMEOUT_MS` (optional): request timeout, default `30000`
- `PFT_TASKNODE_DISPATCH_PATH` (optional): defaults to `/api/routing/dispatch`
- `PFT_DISPATCH_DRY_RUN` (optional): set `true` to force dry-run dispatch behavior
- `PFT_TASKNODE_WSS_URL` (required for real-time listener): Task Node WebSocket endpoint
- `PFT_TASKNODE_WSS_TOPICS` (optional): comma-separated event topics; default `task_created,task_updated`
- `PFT_ROUTING_EVENT_OUTPUT` (optional): output path for latest ranked event result; default `data/latest-match-result.json`
- `PFT_E2E_DRY_RUN_LOG` (optional): output path for e2e dry-run log; default `data/e2e-dry-run-log.json`
- `PFT_EVENT_PROCESS_MAX_ATTEMPTS` (optional): retries for rate-limited event processing, default `3`
- `PFT_DISPATCH_MAX_ATTEMPTS` (optional): retries for retryable dispatch failures, default `3`

### Fetch live state

`PFT_TASKNODE_JWT="<jwt>" node src/fetch-live-state.mjs --operator-limit 25`

This writes mapped live data to `data/live-state.json` in the same schema family as `sample-data.json`.

### State ingestion module (API + WSS payload mapping)

`src/state-ingestion.mjs` performs strict parsing + transformation + validation:

- raw API/WSS operator payloads -> `OperatorProfile`
- raw API/WSS task payloads -> `NetworkTask`
- strict schema conformance checks before handoff to matching engine

Run live ingestion test:

`PFT_TASKNODE_JWT="<jwt>" node src/test-state-ingestion.mjs`

### Dispatch routing module (ranked match -> assignment submission)

`src/dispatch-routing.mjs` provides:
- dispatch payload formatter aligned to task-assignment schema
- authenticated POST submission to Task Node
- structured error handling for unauthorized (`401/403`), rate-limit (`429`), and circuit-breaker style failures

Run unit tests:

`node --test src/test-dispatch-routing.mjs`

### End-to-end dry-run integration

Runs the full flow (WSS bootstrap -> live ingestion -> matching -> dry-run dispatch) without mutating production state:

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://<endpoint>" node src/e2e-dry-run.mjs`

Writes sample execution logs to `data/e2e-dry-run-log.json`.

### Real-time task event listener

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://<tasknode-endpoint>" node src/realtime-listener.mjs`

Behavior:
- opens secure WebSocket connection
- subscribes to `task_created` and `task_updated`
- automatically triggers the matching pipeline for incoming routable task events
- writes latest ranked output to `data/latest-match-result.json`
- auto-reconnects with exponential backoff and jitter on disconnect/errors
- retries event processing on API rate-limit errors with exponential backoff

### 24/7 daemon mode

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://<tasknode-endpoint>" node src/agent-daemon.mjs`

Daemon behavior:
- starts the real-time listener process
- restarts listener automatically on crash/exit with exponential backoff
- installs global handlers for uncaught exceptions and unhandled promise rejections
- keeps credentials in environment variables only (no hardcoded secrets)

### Routing health endpoint

`node src/health-server.mjs`

Environment:
- `PFT_ROUTING_HEALTH_PORT` (optional): defaults to `8787`

Endpoint:
- `GET /health` returns:
  - agent operational status (`ok`/`degraded`)
  - uptime and environment/data-source readiness checks
  - active schema summary for `OperatorProfile`, `NetworkTask`, and `MatchResult`

## Deployment (systemd)

Reference files:
- `deploy/hivemind-routing-agent.service`
- `deploy/hivemind-routing-agent.env.example`

Suggested setup:
1. Clone repo to `/opt/postfiat-hivemind-routing-agent`
2. Copy env template to `/etc/postfiat/hivemind-routing-agent.env`
3. Set file permissions to `600` and owner to service user
4. Install the service:
   - `sudo cp deploy/hivemind-routing-agent.service /etc/systemd/system/`
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable --now hivemind-routing-agent`
5. Monitor:
   - `sudo systemctl status hivemind-routing-agent`
   - `sudo journalctl -u hivemind-routing-agent -f`
