# Source Directory

Reserved for Hive Mind Routing Agent implementation code (scoring engine, API adapters, and ranking services).

## Current executable

- `matcher.mjs` - ranks operators for a target task using:
  - hard expert-tag filtering (`task.requirements` vs `expert_knowledge[].domain`)
  - weighted scoring (`expertise`, `alignment_score`, `sybil_score`)
- `fetch-live-state.mjs` - pulls live Task Node operator/task state and maps it into `OperatorProfile` + `NetworkTask` schema shapes
- `tasknode-client.mjs` - API client with auth header handling and schema mapping helpers
- `realtime-listener.mjs` - persistent WSS listener with auto-reconnect that triggers live ranking on `task_created` / `task_updated`
- `health-server.mjs` - lightweight HTTP health endpoint exposing operational status + schema summary
- `schema-summary.mjs` - canonical field lists for OperatorProfile/NetworkTask/MatchResult health reporting
- `state-ingestion.mjs` - strict parser/transformer/validator mapping raw API/WSS payloads into `OperatorProfile` + `NetworkTask`
- `test-state-ingestion.mjs` - live ingestion verification script against Task Node payloads
- `dispatch-routing.mjs` - dispatch formatter + authenticated POST module for submitting ranked assignments
- `test-dispatch-routing.mjs` - unit tests for dispatch formatting and network response handling
- `e2e-dry-run.mjs` - end-to-end dry-run integrating WSS bootstrap, ingestion, matching, and dry-run dispatch
- `agent-daemon.mjs` - production supervisor loop that runs listener continuously with crash recovery and restart backoff
- `integrity-integration.mjs` - live sybil/circuit-breaker integrity context and policy utilities
- `test-integrity-integration.mjs` - tests for integrity filtering and sybil-penalty behavior
- `telemetry.mjs` - structured audit telemetry emitter for match, penalty, and block decisions (stdout/file/webhook transports)
- `feedback-ingestion.mjs` - terminal outcome ingestion + dynamic operator weight memory updates

Run:

`node src/matcher.mjs --task-title "Map leaderboard/profile fields into canonical routing schema"`

`PFT_TASKNODE_JWT="<jwt>" node src/fetch-live-state.mjs --operator-limit 25`

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://..." node src/realtime-listener.mjs`

`node src/health-server.mjs`

`PFT_TASKNODE_JWT="<jwt>" node src/test-state-ingestion.mjs`

`node --test src/test-dispatch-routing.mjs`

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://..." node src/e2e-dry-run.mjs`

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://..." node src/agent-daemon.mjs`

`node --test src/test-integrity-integration.mjs`

`PFT_TELEMETRY_ENABLED="true" PFT_TELEMETRY_TRANSPORT="stdout,file" PFT_TELEMETRY_FILE="data/routing-telemetry.log" node src/matcher.mjs`

`PFT_TASKNODE_JWT="<jwt>" PFT_FEEDBACK_OPERATOR_ID="<operator-id>" PFT_FEEDBACK_MEMORY_PATH="data/feedback-memory.json" node src/feedback-ingestion.mjs`

`node --test src/test-feedback-ingestion.mjs`
