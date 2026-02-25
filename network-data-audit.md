# Network Data Audit (Post Fiat)

Date: 2026-02-25  
Base API: `https://tasknode.postfiat.org/api/*`  
Method: Live authenticated endpoint inspection, observed fields only.

## Core Endpoints Audited

- `GET /api/leaderboard`
- `GET /api/profile/public/{wallet_address}`
- `GET /api/profile/runs?latest=true`
- `GET /api/tasks/summary`
- `GET /api/tasks/rewarded`
- `GET /api/tasks/refused`
- `GET /api/context/task-history`
- `GET /api/nfts/gallery/public/{wallet_or_user_id}`

## Leaderboard Row Schema (Observed)

| Field | Type | Example |
|---|---|---|
| `user_id` | string (uuid) | `9c1a0196-f7af-4b07-bc3e-f03e5a86eeaf` |
| `wallet_address` | string | `rh7eykJ99XnGTm2iNBzeD5A9MLqnb7kXCp` |
| `summary` | string \| null | `Meta Ads lead generation specialist` |
| `capabilities` | string[] | `["Build conversion funnels", "..."]` |
| `expert_knowledge` | object[] | `[{"domain":"Lead generation business models"}]` |
| `sybil_score` | integer | `92` |
| `sybil_risk` | string \| null | `Low Risk` |
| `alignment_score` | integer | `84` |
| `alignment_tier` | string \| null | `Active Contributor` |
| `weekly_tasks` | integer | `7` |
| `monthly_tasks` | integer | `81` |
| `weekly_rewards` | number | `360350.0` |
| `monthly_rewards` | number | `988523.75` |
| `leaderboard_score_week` | integer | `68` |
| `leaderboard_score_month` | integer | `78` |
| `nft_image_url` | string \| null | `ipfs://bafy...` |
| `is_public` | boolean | `true` |
| `is_published` | boolean | `true` |

## Public Profile Schema (Observed)

Endpoint: `GET /api/profile/public/{wallet_address}`

| Field | Type | Example |
|---|---|---|
| `profile.user_id` | string | `9c1a0196-f7af-4b07-bc3e-f03e5a86eeaf` |
| `profile.wallet_address` | string | `rh7eykJ99XnGTm2iNBzeD5A9MLqnb7kXCp` |
| `profile.wallet_label` | string | `Janitor` |
| `profile.is_published` | boolean | `true` |
| `profile.looking_for` | string \| null | `null` |
| `profile.summary` | string | `Meta Ads lead generation specialist` |
| `profile.capabilities` | string[] | `["...", "..."]` |
| `profile.expert_knowledge[]` | object[] | `{"domain":"...", "confidence":"High"}` |
| `profile.associated_tickers[]` | object[] | `{"symbol":"NVDA","name":"NVIDIA","relevance":83}` |
| `profile.alignment.alignment_score` | integer | `84` |
| `profile.alignment.alignment_tier` | string | `Active Contributor` |
| `profile.alignment.weekly_counts.total` | integer | `7` |
| `profile.alignment.monthly_counts.total` | integer | `81` |
| `profile.alignment.weekly_rewards_total` | number | `360350.0` |
| `profile.alignment.monthly_rewards_total` | number | `988523.75` |
| `profile.sybil_score.sybil_score` | integer | `92` |
| `profile.sybil_score.sybil_risk` | string | `Low Risk` |
| `profile.sybil_score.linked_accounts` | string[] | `["github","x"]` |
| `profile.avatar.image_url` | string | `https://pft-ipfs-testnet-node-1.fly.dev/ipfs/...` |

## Profile Runs (Observed Fields)

Endpoint: `GET /api/profile/runs?latest=true`

Run fields:
- `id` (string)
- `field` (string; observed: `alignment`, `associated_tickers`, `capabilities`, `expert_knowledge`, `leaderboard_summary`, `nft_image`, `recommended_connections`, `sybil_score`)
- `status` (string; observed: `completed`, `pending`, `failed`)
- `model` (string)
- `job_id` (string|null)
- `extracted_output` (object|string|null)
- `error` (string|null)
- `created_at` / `updated_at` / `run_started_at` / `run_finished_at` (string|null)

Observed extracted payload examples:
- `recommended_connections[]`: `{ wallet_address, match_score, reason, capabilities[] }`
- `sybil_score`: `{ sybil_score, sybil_risk, linked_accounts[], attempted_gaming, network_graph, score_components }`
- `alignment`: `{ alignment_score, alignment_tier, weekly_counts, monthly_counts, weekly_rewards_total, monthly_rewards_total, weights }`

## Task History + Reward Metrics

`GET /api/tasks/rewarded` (`tasks[]`):
- `id`, `title`, `type`, `pft`, `rewardTier`, `rewardScore`, `rewardSummary`, `status`
- workflow timestamps: `createdAt`, `acceptedAt`, `submittedAt`, `rewardedAt`
- verification: `verificationAsk`, `verificationStatus`
- transaction: `txHash`

Example:
- `rewardTier`: `very_good`
- `rewardScore`: `"88"`
- `pft`: `"4200.00"`

`GET /api/tasks/refused` (`tasks[]`):
- same core schema, with refusal fields populated:
- `refusalCategory` example: `missing_info`

`GET /api/context/task-history`:
- `task_history` (string blob with formatted sections and line-level historical task summaries)

## NFT Metadata Schema

Endpoint: `GET /api/nfts/gallery/public/{wallet_or_user_id}`

`nfts[]` fields:
- `id` (string)
- `wallet_address` (string)
- `nft_token_id` (string|null)
- `tx_hash` (string)
- `image_cid` / `metadata_cid` (string)
- `image_gateway_url` / `metadata_gateway_url` (string)
- `nft_name` / `nft_description` / `display_name` (string|null)
- `status` (string; example: `minted`)
- `is_pinned` (boolean)
- `taxon` (integer)
- `flags` (integer)
- `created_at` / `minted_at` (string)

## Sampled Active Operators (5+)

Sample set selected from top active leaderboard rows:
- `rDqf4nowC2PAZgn1UGHDn46mcUMREYJrsr` (profile/public returned `403`)
- `rh7eykJ99XnGTm2iNBzeD5A9MLqnb7kXCp`
- `rnmLkDT2SBeaFA5z2ogdUCbJ2GMzn2sLLu`
- `rDVKRNp3kWE1ykryU8ta6bBZWrFjFetyjB`
- `rpyTMcAKiCxqY7VXenD5ercGGzGWNV9xpg`
- `rPo8GkCA9YMKzuJGTHbj11kdVfPqSJHxNx`
- `rHTgM9rZBZkuqF5H8DQxFWTR7biXmMvPLm`

## Access / Visibility Findings

- `GET /api/profile/public/{wallet}` works with wallet addresses; using user ID in this endpoint returned `404` in observed tests.
- Some operators are listed on leaderboard but public profile fetch is blocked (`403`), which implies visibility/privacy constraints must be handled in routing.
- `is_public` and `is_published` are available in leaderboard rows and should be treated as first-class routing filters.

## Routing-Relevant Canonical Inputs (Observed)

- Expertise: `expert_knowledge[].domain`, `expert_knowledge[].confidence`
- Capabilities: `capabilities[]`
- Sybil: `sybil_score`, `sybil_risk`
- Alignment: `alignment_score`, `alignment_tier`
- Activity: `weekly_tasks`, `monthly_tasks`
- Rewards: `weekly_rewards`, `monthly_rewards`
- Visibility: `is_public`, `is_published`
- NFT/Profile media: `nft_image_url`, `avatar.image_url` (optional enrichment)
