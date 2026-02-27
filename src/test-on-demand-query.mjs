import test from "node:test";
import assert from "node:assert/strict";
import { runOnDemandQueryWithDataset } from "./on-demand-query.mjs";

function makeOperator({
  id,
  wallet,
  domain,
  alignment = 80,
  sybilRisk = "Low Risk",
  sybilScore = 85,
}) {
  return {
    operator_id: id,
    wallet_address: wallet,
    wallet_label: "Wallet",
    summary: "Operator",
    capabilities: ["delivery"],
    expert_knowledge: [{ domain, confidence: "High" }],
    sybil_score: sybilScore,
    sybil_risk: sybilRisk,
    linked_accounts: [],
    alignment_score: alignment,
    alignment_tier: "Contributor",
    weekly_tasks: 3,
    monthly_tasks: 12,
    weekly_rewards: 100,
    monthly_rewards: 600,
    leaderboard_score_week: 50,
    leaderboard_score_month: 70,
    is_public: true,
    is_published: true,
  };
}

test("mock on-demand query returns valid ranked operators", () => {
  const dataset = {
    metadata: { generated_at: new Date().toISOString() },
    operator_profiles: [
      makeOperator({
        id: "op-video-1",
        wallet: "r-video-1",
        domain: "Video production and direct response scripting",
        alignment: 90,
      }),
      makeOperator({
        id: "op-data-1",
        wallet: "r-data-1",
        domain: "Data mapping and schema migration",
        alignment: 82,
      }),
      makeOperator({
        id: "op-video-2",
        wallet: "r-video-2",
        domain: "Short-form video ads and creative testing",
        alignment: 76,
      }),
    ],
    network_tasks: [],
    match_results: [],
    integrity: {
      circuit_breaker: { blocked_operator_ids: [], blocked_wallet_addresses: [] },
      unauthorized_operator_ids: [],
    },
  };

  const result = runOnDemandQueryWithDataset(
    {
      request_id: "q1",
      user_request_text: "Need help producing conversion-focused video ads",
      required_skills: ["video production", "creative scripting"],
      constraints: { min_alignment_score: 70, public_only: true },
      top_k: 2,
    },
    dataset
  );

  assert.equal(result.ok, true);
  assert.equal(result.top_matches.length, 2);
  assert.equal(result.top_matches[0].operator_id, "op-video-1");
  assert.ok(result.top_matches[0].matched_expert_domains.length > 0);
  assert.ok(result.top_matches[0].confidence > 0);
});
