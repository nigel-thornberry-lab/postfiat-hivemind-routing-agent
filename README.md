# Hive Mind Routing Agent

This repository is the routing and policy layer for the Post Fiat Hive Mind system.
It centralizes live network audit outputs, typed schemas, matching logic, integrity controls, and observability.

## Purpose and Scope

This project is designed to answer:

- "Given a task request, who are the best operators to route it to?"
- "What integrity and risk controls should gate or penalize routing?"
- "How can routing decisions be audited in a verifiable way?"

This project is **not** intended to replace the generic task execution loop client.

## What This Repo Is / Is Not

**This repo is:**
- a ranking engine (`OperatorProfile` x `NetworkTask` -> ranked `MatchResult[]`)
- an integrity-aware policy layer (sybil penalties + hard-block filters)
- a real-time listener + orchestration shell for routing decisions
- an observability/audit telemetry module for routing evidence

**This repo is not:**
- the canonical "worker loop" implementation for request/accept/evidence/verification/reward
- a wallet management product
- the source of truth for all Task Node lifecycle semantics

## Relationship to Task Loop Clients

The router is intentionally compatible with external task-loop clients.
Integration model:

1. A worker or coordinator emits/receives live task state.
2. This routing layer ranks candidate operators for that task.
3. A downstream execution client performs assignment acceptance/evidence/verification flows.

If an existing task-loop client already handles end-to-end execution, this repository should be used as a plug-in routing policy engine rather than a replacement.

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
- `src/integrity-integration.mjs`
- `src/feedback-ingestion.mjs`
- `src/on-demand-query.mjs`
- `src/query-server.mjs`
- `src/double-opt-in.mjs`

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
- `PFT_TASKNODE_INTEGRITY_PATH` (optional): integrity endpoint path, default `/api/routing/integrity`
- `PFT_FEEDBACK_MEMORY_PATH` (optional): feedback memory store path used by ingestion + matcher
- `PFT_FEEDBACK_OPERATOR_ID` (optional): explicit operator ID to attribute terminal outcomes to
- `PFT_QUERY_PORT` (optional): on-demand query server port, default `8790`
- `PFT_INTEGRITY_BLOCKED_OPERATOR_IDS` (optional): comma-separated hard-block operator IDs
- `PFT_INTEGRITY_BLOCKED_WALLETS` (optional): comma-separated hard-block wallet addresses
- `PFT_INTEGRITY_UNAUTHORIZED_OPERATOR_IDS` (optional): comma-separated unauthorized operator IDs

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

### Integrity integration module

`src/integrity-integration.mjs` provides:
- live integrity context fetch (`sybil` snapshot + circuit-breaker lists)
- hard-block lists for unauthorized/flagged operators
- sybil-risk penalty multipliers applied by matcher

Run integrity tests:

`node --test src/test-integrity-integration.mjs`

### Feedback ingestion and dynamic weighting module

`src/feedback-ingestion.mjs` provides:
- terminal outcome ingestion from live task state (`completed`, `refused`, `abandoned`)
- persistent feedback memory per operator (`performance_multiplier`, `alignment_bonus`)
- idempotent processing via `processed_outcome_ids`
- dynamic weighting inputs consumed by `matcher.mjs` in future routing cycles

Run ingestion:

`PFT_TASKNODE_JWT="<jwt>" PFT_FEEDBACK_OPERATOR_ID="<operator-id>" node src/feedback-ingestion.mjs`

Schema:
- `docs/feedback-outcome-schema.md`

### On-demand user-to-agent query flow

Use this when a user explicitly asks for best operator matches (no unsolicited dispatch spam).

- Query evaluator module: `src/on-demand-query.mjs`
- HTTP endpoint server: `src/query-server.mjs` (`POST /query`)
- Query schema: `docs/on-demand-query-schema.md`

Run query server:

`PFT_TASKNODE_JWT="<jwt>" node src/query-server.mjs`

Example request:

`curl -X POST "http://localhost:8790/query" -H "Content-Type: application/json" --data '{"user_request_text":"Need help with video production","required_skills":["video production","creative scripting"],"constraints":{"max_sybil_risk":"Moderate","min_alignment_score":60,"public_only":true},"top_k":3}'`

### Double Opt-In handshake protocol (event-sourced)

- Protocol module: `src/double-opt-in.mjs`
- Schema doc: `docs/double-opt-in-schema.md`
- Unit tests: `src/test-double-opt-in.mjs`

Run tests:

`node --test src/test-double-opt-in.mjs`

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
