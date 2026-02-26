# Source Directory

Reserved for Hive Mind Routing Agent implementation code (scoring engine, API adapters, and ranking services).

## Current executable

- `matcher.mjs` - ranks operators for a target task using:
  - hard expert-tag filtering (`task.requirements` vs `expert_knowledge[].domain`)
  - weighted scoring (`expertise`, `alignment_score`, `sybil_score`)

Run:

`node src/matcher.mjs --task-title "Map leaderboard/profile fields into canonical routing schema"`
