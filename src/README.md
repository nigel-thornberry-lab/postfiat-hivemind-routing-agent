# Source Directory

Reserved for Hive Mind Routing Agent implementation code (scoring engine, API adapters, and ranking services).

## Current executable

- `matcher.mjs` - ranks operators for a target task using:
  - hard expert-tag filtering (`task.requirements` vs `expert_knowledge[].domain`)
  - weighted scoring (`expertise`, `alignment_score`, `sybil_score`)
- `fetch-live-state.mjs` - pulls live Task Node operator/task state and maps it into `OperatorProfile` + `NetworkTask` schema shapes
- `tasknode-client.mjs` - API client with auth header handling and schema mapping helpers
- `realtime-listener.mjs` - persistent WSS listener with auto-reconnect that triggers live ranking on `task_created` / `task_updated`

Run:

`node src/matcher.mjs --task-title "Map leaderboard/profile fields into canonical routing schema"`

`PFT_TASKNODE_JWT="<jwt>" node src/fetch-live-state.mjs --operator-limit 25`

`PFT_TASKNODE_JWT="<jwt>" PFT_TASKNODE_WSS_URL="wss://..." node src/realtime-listener.mjs`
