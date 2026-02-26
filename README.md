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

### Required environment variables

- `PFT_TASKNODE_JWT` (required): bearer token for Task Node API auth
- `PFT_TASKNODE_URL` (optional): defaults to `https://tasknode.postfiat.org`
- `PFT_TASKNODE_TIMEOUT_MS` (optional): request timeout, default `30000`
- `PFT_TASKNODE_WSS_URL` (required for real-time listener): Task Node WebSocket endpoint
- `PFT_TASKNODE_WSS_TOPICS` (optional): comma-separated event topics; default `task_created,task_updated`
- `PFT_ROUTING_EVENT_OUTPUT` (optional): output path for latest ranked event result; default `data/latest-match-result.json`

### Fetch live state

`PFT_TASKNODE_JWT="<jwt>" node src/fetch-live-state.mjs --operator-limit 25`

This writes mapped live data to `data/live-state.json` in the same schema family as `sample-data.json`.

### Real-time task event listener

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://<tasknode-endpoint>" node src/realtime-listener.mjs`

Behavior:
- opens secure WebSocket connection
- subscribes to `task_created` and `task_updated`
- automatically triggers the matching pipeline for incoming routable task events
- writes latest ranked output to `data/latest-match-result.json`
- auto-reconnects with exponential backoff and jitter on disconnect/errors

### Routing health endpoint

`node src/health-server.mjs`

Environment:
- `PFT_ROUTING_HEALTH_PORT` (optional): defaults to `8787`

Endpoint:
- `GET /health` returns:
  - agent operational status (`ok`/`degraded`)
  - uptime and environment/data-source readiness checks
  - active schema summary for `OperatorProfile`, `NetworkTask`, and `MatchResult`
