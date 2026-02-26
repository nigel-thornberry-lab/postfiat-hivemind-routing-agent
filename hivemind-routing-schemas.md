# Hive Mind Routing Agent Schemas (Live-Mapped)

Derived from audited live Post Fiat application-layer data in `network-data-audit.md`.

## 1) OperatorProfile (JSON model)

```jsonc
{
  "operator_id": "9c1a0196-f7af-4b07-bc3e-f03e5a86eeaf", // string (uuid) -> /api/leaderboard rows[].user_id, /api/profile/public/{wallet} profile.user_id
  "wallet_address": "rh7eykJ99XnGTm2iNBzeD5A9MLqnb7kXCp", // string -> leaderboard rows[].wallet_address
  "wallet_label": "Janitor", // string|null -> profile.public profile.wallet_label

  "summary": "Meta Ads lead generation specialist", // string|null -> leaderboard rows[].summary / profile.public profile.summary
  "capabilities": [
    "Produce high-engagement short-form video content for social media."
  ], // string[] -> leaderboard rows[].capabilities / profile.public profile.capabilities
  "expert_knowledge": [
    {
      "domain": "Lead generation business models", // string -> profile.public profile.expert_knowledge[].domain
      "confidence": "High" // string -> profile.public profile.expert_knowledge[].confidence (observed values include High, Medium)
    }
  ],

  "sybil_score": 92, // integer -> leaderboard rows[].sybil_score OR profile.public profile.sybil_score.sybil_score
  "sybil_risk": "Low Risk", // string|null -> leaderboard rows[].sybil_risk OR profile.public profile.sybil_score.sybil_risk
  "linked_accounts": ["github", "x"], // string[] -> profile.public profile.sybil_score.linked_accounts

  "alignment_score": 84, // integer -> leaderboard rows[].alignment_score OR profile.public profile.alignment.alignment_score
  "alignment_tier": "Active Contributor", // string|null -> leaderboard rows[].alignment_tier OR profile.public profile.alignment.alignment_tier

  "weekly_tasks": 7, // integer -> leaderboard rows[].weekly_tasks OR profile.public profile.alignment.weekly_counts.total
  "monthly_tasks": 81, // integer -> leaderboard rows[].monthly_tasks OR profile.public profile.alignment.monthly_counts.total
  "weekly_rewards": 360350.0, // number -> leaderboard rows[].weekly_rewards OR profile.public profile.alignment.weekly_rewards_total
  "monthly_rewards": 988523.75, // number -> leaderboard rows[].monthly_rewards OR profile.public profile.alignment.monthly_rewards_total

  "leaderboard_score_week": 68, // integer -> leaderboard rows[].leaderboard_score_week
  "leaderboard_score_month": 78, // integer -> leaderboard rows[].leaderboard_score_month

  "is_public": true, // boolean -> leaderboard rows[].is_public
  "is_published": true, // boolean -> leaderboard rows[].is_published OR profile.public profile.is_published
  "published_at": null, // string|null -> leaderboard rows[].published_at

  "nft_image_url": "ipfs://bafy...", // string|null -> leaderboard rows[].nft_image_url
  "avatar_image_url": "https://pft-ipfs-testnet-node-1.fly.dev/ipfs/..." // string|null -> profile.public profile.avatar.image_url
}
```

### OperatorProfile notes

- If `GET /api/profile/public/{wallet}` returns `403`, fallback to leaderboard-only fields.
- `expert_knowledge[].confidence` is a string classification, not numeric.

## 2) NetworkTask (JSON model)

```jsonc
{
  "task_id": "4ac8c0c1-410e-4035-80fb-27b2560727b2", // string -> /api/tasks/rewarded tasks[].id, /api/tasks/refused tasks[].id
  "title": "Produce and Export Final Refinance Video Ad for Meta Upload", // string -> tasks[].title
  "type": "network", // string (observed task types include personal/network/alpha) -> tasks[].type
  "status": "rewarded", // string (e.g., pending/outstanding/rewarded/refused/cancelled) -> /api/tasks/summary tasks + rewarded/refused endpoints

  "requirements": "Screenshot of Meta Ads Manager showing...", // string -> tasks[].requirements
  "verification_ask": "What specific CTA text and visual cue...", // string|null -> tasks[].verificationAsk
  "verification_status": "response_submitted", // string|null -> tasks[].verificationStatus

  "pft_offer": 4200.0, // number (parsed from string) -> tasks[].pft (source is string in API)
  "reward_tier": "very_good", // string|null -> tasks[].rewardTier
  "reward_score": 88, // integer|null (parse from string) -> tasks[].rewardScore
  "reward_summary": "Strong execution of the video ad production...", // string|null -> tasks[].rewardSummary

  "created_at_ms": 1771901886191, // integer|null -> tasks[].createdAt
  "accepted_at_ms": 1771903104435, // integer|null -> tasks[].acceptedAt
  "submitted_at_ms": 1771992284929, // integer|null -> tasks[].submittedAt
  "rewarded_at_ms": 1771993868543, // integer|null -> tasks[].rewardedAt

  "submission_id": "a4da18f7-da18-4c85-91e8-ff564e0d3f78", // string|null -> tasks[].submissionId
  "tx_hash": "7A9C25C3693E89BA384770EBEEE2D0EB23F691CADF98ED8E65044EC00D8F4CD3", // string|null -> tasks[].txHash

  "refusal_category": null, // string|null -> tasks[].refusalCategory
  "reason": null // string|null -> tasks[].reason
}
```

### NetworkTask notes

- API returns `pft` and `rewardScore` as strings; normalize to numeric fields for routing/scoring.
- Use `tasks/summary` as the status index and `tasks/rewarded` + `tasks/refused` for detailed historical reward/refusal metadata.

## 3) MatchResult (JSON model)

```jsonc
{
  "match_id": "8a3a9b40-49f4-4c9a-b1f1-49c4d4b3f90d", // string (uuid) -> routing output identifier (agent-generated)
  "generated_at": "2026-02-25T12:30:00.000Z", // string (ISO timestamp) -> routing output metadata

  "task": {
    "task_id": "4ac8c0c1-410e-4035-80fb-27b2560727b2", // from NetworkTask.task_id
    "type": "network", // from NetworkTask.type
    "pft_offer": 4200.0 // from NetworkTask.pft_offer
  },

  "operator": {
    "operator_id": "9c1a0196-f7af-4b07-bc3e-f03e5a86eeaf", // from OperatorProfile.operator_id
    "wallet_address": "rh7eykJ99XnGTm2iNBzeD5A9MLqnb7kXCp", // from OperatorProfile.wallet_address
    "alignment_score": 84, // from OperatorProfile.alignment_score
    "sybil_score": 92 // from OperatorProfile.sybil_score
  },

  "scores": {
    "overall_match_score": 0.87, // number [0..1] -> final routing score
    "capability_score": 0.91, // number [0..1] -> task requirements vs capabilities
    "expertise_score": 0.88, // number [0..1] -> task domain vs expert_knowledge[].domain
    "alignment_score_norm": 0.84, // number [0..1] -> normalized from live alignment_score (0..100)
    "sybil_score_norm": 0.92, // number [0..1] -> normalized from live sybil_score (0..100)
    "activity_score": 0.76 // number [0..1] -> normalized from weekly/monthly task+reward signals
  },

  "confidence": 0.89, // number [0..1] -> confidence in assignment recommendation
  "routing_decision": "assign", // enum: assign|defer|manual_review
  "rank": 1, // integer -> rank among candidates for the same task

  "eligibility": {
    "passed_visibility_gate": true, // derived from is_public/is_published and profile accessibility
    "passed_sybil_gate": true, // derived from sybil_risk/sybil_score policy threshold
    "gate_notes": [] // string[] -> reasons when disqualified or downgraded
  },

  "feature_snapshot": {
    "capabilities": ["Produce high-engagement short-form video content for social media."], // copied from OperatorProfile.capabilities
    "expert_domains": ["Lead generation business models"], // copied from OperatorProfile.expert_knowledge[].domain
    "alignment_tier": "Active Contributor", // copied from OperatorProfile.alignment_tier
    "sybil_risk": "Low Risk" // copied from OperatorProfile.sybil_risk
  },

  "explanation": [
    "Operator has strong overlap with required domain and capabilities.",
    "High sybil/alignment scores and recent activity support assignment."
  ] // string[] -> human-readable rationale for auditability
}
```

### MatchResult notes

- `MatchResult` is routing-layer output, but every operator/task feature used should be traceable to live fields listed above.
- Keep normalized component scores separate for explainability and policy tuning.

## Optional Supabase SQL Skeleton (for persistence)

```sql
-- Operator snapshot table mapped from live endpoints.
create table if not exists operator_profiles (
  operator_id uuid primary key,             -- /api/leaderboard rows[].user_id
  wallet_address text not null unique,      -- /api/leaderboard rows[].wallet_address
  wallet_label text,                        -- /api/profile/public profile.wallet_label
  summary text,                             -- leaderboard/profile.public summary
  capabilities jsonb not null default '[]', -- string[]
  expert_knowledge jsonb not null default '[]', -- [{domain, confidence}]
  sybil_score int,                          -- leaderboard/profile.public sybil score
  sybil_risk text,                          -- leaderboard/profile.public sybil risk
  alignment_score int,                      -- leaderboard/profile.public alignment score
  alignment_tier text,                      -- leaderboard/profile.public alignment tier
  weekly_tasks int default 0,
  monthly_tasks int default 0,
  weekly_rewards numeric default 0,
  monthly_rewards numeric default 0,
  is_public boolean,
  is_published boolean,
  nft_image_url text,
  avatar_image_url text,
  updated_at timestamptz not null default now()
);

create table if not exists network_tasks (
  task_id uuid primary key,                 -- /api/tasks/* tasks[].id
  title text not null,
  type text not null,                       -- personal|network|alpha
  status text not null,                     -- summary/rewarded/refused state
  requirements text,
  verification_ask text,
  verification_status text,
  pft_offer numeric,                        -- normalized from string pft
  reward_tier text,
  reward_score int,                         -- normalized from string rewardScore
  reward_summary text,
  created_at_ms bigint,
  accepted_at_ms bigint,
  submitted_at_ms bigint,
  rewarded_at_ms bigint,
  submission_id uuid,
  tx_hash text,
  refusal_category text,
  reason text,
  updated_at timestamptz not null default now()
);

create table if not exists match_results (
  match_id uuid primary key,
  generated_at timestamptz not null default now(),
  task_id uuid not null references network_tasks(task_id),
  operator_id uuid not null references operator_profiles(operator_id),
  overall_match_score numeric not null,
  capability_score numeric,
  expertise_score numeric,
  alignment_score_norm numeric,
  sybil_score_norm numeric,
  activity_score numeric,
  confidence numeric,
  routing_decision text not null,           -- assign|defer|manual_review
  rank int,
  eligibility jsonb not null default '{}',  -- gate outcomes and reasons
  feature_snapshot jsonb not null default '{}',
  explanation jsonb not null default '[]'
);
```
