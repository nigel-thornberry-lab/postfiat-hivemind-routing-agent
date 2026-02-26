export const OPERATOR_PROFILE_FIELDS = [
  "operator_id",
  "wallet_address",
  "wallet_label",
  "summary",
  "capabilities",
  "expert_knowledge",
  "sybil_score",
  "sybil_risk",
  "linked_accounts",
  "alignment_score",
  "alignment_tier",
  "weekly_tasks",
  "monthly_tasks",
  "weekly_rewards",
  "monthly_rewards",
  "leaderboard_score_week",
  "leaderboard_score_month",
  "is_public",
  "is_published",
  "published_at",
  "nft_image_url",
  "avatar_image_url",
];

export const NETWORK_TASK_FIELDS = [
  "task_id",
  "title",
  "type",
  "status",
  "requirements",
  "verification_ask",
  "verification_status",
  "pft_offer",
  "reward_tier",
  "reward_score",
  "reward_summary",
  "created_at_ms",
  "accepted_at_ms",
  "submitted_at_ms",
  "rewarded_at_ms",
  "submission_id",
  "tx_hash",
  "refusal_category",
  "reason",
];

export const MATCH_RESULT_FIELDS = [
  "match_id",
  "generated_at",
  "task",
  "operator",
  "scores",
  "confidence",
  "routing_decision",
  "rank",
  "eligibility",
  "feature_snapshot",
  "explanation",
];

export function getSchemaSummary() {
  return {
    OperatorProfile: {
      field_count: OPERATOR_PROFILE_FIELDS.length,
      required_core_fields: ["operator_id", "wallet_address", "expert_knowledge", "sybil_score", "alignment_score"],
      fields: OPERATOR_PROFILE_FIELDS,
    },
    NetworkTask: {
      field_count: NETWORK_TASK_FIELDS.length,
      required_core_fields: ["task_id", "title", "type", "status", "requirements", "pft_offer"],
      fields: NETWORK_TASK_FIELDS,
    },
    MatchResult: {
      field_count: MATCH_RESULT_FIELDS.length,
      required_core_fields: ["match_id", "task", "operator", "scores", "confidence", "routing_decision"],
      fields: MATCH_RESULT_FIELDS,
    },
  };
}
