import test from "node:test";
import assert from "node:assert/strict";
import { buildIntegrityContext, getSybilPenaltyMultiplier } from "./integrity-integration.mjs";
import { rankOperatorsForTask } from "./matcher.mjs";

function makeTask() {
  return {
    task_id: "task-1",
    title: "Implement API integration layer",
    type: "network",
    status: "pending",
    requirements: "Build API and integration support for routing",
    pft_offer: 1000,
  };
}

function makeOperator({
  id,
  wallet,
  domain = "API integration",
  sybilRisk = "Low Risk",
  sybilScore = 90,
  alignment = 85,
}) {
  return {
    operator_id: id,
    wallet_address: wallet,
    wallet_label: "Wallet",
    summary: "Operator",
    capabilities: ["API integration"],
    expert_knowledge: [{ domain, confidence: "High" }],
    sybil_score: sybilScore,
    sybil_risk: sybilRisk,
    linked_accounts: ["github"],
    alignment_score: alignment,
    alignment_tier: "Contributor",
    weekly_tasks: 5,
    monthly_tasks: 20,
    weekly_rewards: 100,
    monthly_rewards: 500,
    leaderboard_score_week: 50,
    leaderboard_score_month: 60,
    is_public: true,
    is_published: true,
    published_at: null,
    nft_image_url: null,
    avatar_image_url: null,
  };
}

test("buildIntegrityContext merges blocked and unauthorized ids from env+payload", () => {
  const ctx = buildIntegrityContext({
    operatorProfiles: [makeOperator({ id: "op-1", wallet: "r1" })],
    rawIntegrityPayload: {
      circuit_breaker: { blocked_operator_ids: ["op-2"] },
      unauthorized_operator_ids: ["op-3"],
    },
    env: {
      PFT_INTEGRITY_BLOCKED_OPERATOR_IDS: "op-4",
      PFT_INTEGRITY_UNAUTHORIZED_OPERATOR_IDS: "op-5",
      PFT_INTEGRITY_BLOCKED_WALLETS: "r9",
    },
  });

  assert.deepEqual(new Set(ctx.circuit_breaker.blocked_operator_ids), new Set(["op-2", "op-4"]));
  assert.deepEqual(new Set(ctx.unauthorized_operator_ids), new Set(["op-3", "op-5"]));
  assert.deepEqual(new Set(ctx.circuit_breaker.blocked_wallet_addresses), new Set(["r9"]));
});

test("rankOperatorsForTask filters blocked operators out of ranked_results", () => {
  const task = makeTask();
  const allowed = makeOperator({ id: "op-allowed", wallet: "r-allowed" });
  const blocked = makeOperator({ id: "op-blocked", wallet: "r-blocked" });
  const dataset = {
    operator_profiles: [allowed, blocked],
    network_tasks: [task],
    match_results: [],
    integrity: {
      circuit_breaker: {
        blocked_operator_ids: ["op-blocked"],
        blocked_wallet_addresses: [],
      },
      unauthorized_operator_ids: [],
    },
  };

  const result = rankOperatorsForTask(dataset, task);
  assert.equal(result.ranked_results.length, 1);
  assert.equal(result.ranked_results[0].operator.operator_id, "op-allowed");
  assert.equal(
    result.rejected_operators.some(
      (x) =>
        x.operator_id === "op-blocked" &&
        x.reason.includes("integrity policy")
    ),
    true
  );
});

test("elevated sybil risk applies penalty multiplier and reduces score", () => {
  const task = makeTask();
  const lowRisk = makeOperator({ id: "op-low", wallet: "r-low", sybilRisk: "Low Risk", sybilScore: 90 });
  const elevated = makeOperator({
    id: "op-elevated",
    wallet: "r-elevated",
    sybilRisk: "Elevated",
    sybilScore: 90,
  });
  const dataset = {
    operator_profiles: [lowRisk, elevated],
    network_tasks: [task],
    match_results: [],
    integrity: {
      circuit_breaker: { blocked_operator_ids: [], blocked_wallet_addresses: [] },
      unauthorized_operator_ids: [],
    },
  };
  const result = rankOperatorsForTask(dataset, task);
  const low = result.ranked_results.find((x) => x.operator.operator_id === "op-low");
  const elev = result.ranked_results.find((x) => x.operator.operator_id === "op-elevated");
  assert.ok(low);
  assert.ok(elev);
  assert.ok(low.scores.overall_match_score > elev.scores.overall_match_score);
  assert.equal(getSybilPenaltyMultiplier("Elevated", 90), 0.6);
});
