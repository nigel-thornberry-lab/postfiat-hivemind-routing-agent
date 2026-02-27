import test from "node:test";
import assert from "node:assert/strict";
import { applyOutcomeAdjustments, mapTerminalTasksToOutcomes } from "./feedback-ingestion.mjs";
import { rankOperatorsForTask } from "./matcher.mjs";

function makeTask() {
  return {
    task_id: "task-1",
    title: "Produce short-form video ads",
    type: "network",
    status: "pending",
    requirements: "Need video production and direct response hooks",
    pft_offer: 1000,
  };
}

function makeOperator({
  id,
  wallet,
  domain = "Video production and creative scripting",
  sybilRisk = "Low Risk",
  sybilScore = 90,
  alignment = 70,
}) {
  return {
    operator_id: id,
    wallet_address: wallet,
    wallet_label: "Wallet",
    summary: "Operator",
    capabilities: ["Video production"],
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

test("mapTerminalTasksToOutcomes normalizes rewarded/refused/cancelled statuses", () => {
  const outcomes = mapTerminalTasksToOutcomes(
    [
      { task_id: "t1", status: "rewarded", reward_tier: "very_good", rewarded_at_ms: 1000 },
      { task_id: "t2", status: "rewarded", reward_tier: "rejected", rewarded_at_ms: 2000 },
      { task_id: "t3", status: "refused", rewarded_at_ms: 3000 },
      { task_id: "t4", status: "cancelled", rewarded_at_ms: 4000 },
    ],
    { operatorId: "op-1", detectedAt: "2026-02-27T00:00:00.000Z" }
  );

  assert.equal(outcomes.length, 4);
  assert.equal(outcomes[0].status, "completed");
  assert.equal(outcomes[1].status, "refused");
  assert.equal(outcomes[2].status, "refused");
  assert.equal(outcomes[3].status, "abandoned");
});

test("applyOutcomeAdjustments updates persistent operator memory", () => {
  const base = {
    schema_version: "1.0",
    updated_at: "2026-02-27T00:00:00.000Z",
    processed_outcome_ids: [],
    operators: {},
  };

  const outcomes = [
    {
      outcome_id: "a",
      status: "completed",
      operator_id: "op-1",
      task_id: "t1",
      terminal_at: "2026-02-27T01:00:00.000Z",
    },
    {
      outcome_id: "b",
      status: "refused",
      operator_id: "op-1",
      task_id: "t2",
      terminal_at: "2026-02-27T01:30:00.000Z",
    },
  ];

  const { memory, applied } = applyOutcomeAdjustments(base, outcomes);
  assert.equal(applied, 2);
  assert.equal(memory.operators["op-1"].completed_count, 1);
  assert.equal(memory.operators["op-1"].refused_count, 1);
  assert.equal(memory.operators["op-1"].performance_multiplier, 0.95);
  assert.equal(memory.operators["op-1"].alignment_bonus, -1);
});

test("rankOperatorsForTask applies feedback memory multipliers", () => {
  const task = makeTask();
  const baseline = makeOperator({ id: "op-baseline", wallet: "r-baseline", alignment: 70 });
  const boosted = makeOperator({ id: "op-boosted", wallet: "r-boosted", alignment: 70 });

  const dataset = {
    operator_profiles: [baseline, boosted],
    network_tasks: [task],
    match_results: [],
    integrity: {
      circuit_breaker: { blocked_operator_ids: [], blocked_wallet_addresses: [] },
      unauthorized_operator_ids: [],
    },
    feedback_memory: {
      schema_version: "1.0",
      updated_at: "2026-02-27T00:00:00.000Z",
      processed_outcome_ids: [],
      operators: {
        "op-boosted": {
          performance_multiplier: 1.15,
          alignment_bonus: 8,
        },
      },
    },
  };

  const result = rankOperatorsForTask(dataset, task);
  const top = result.ranked_results[0];
  assert.equal(top.operator.operator_id, "op-boosted");
  assert.ok(top.scores.feedback_performance_multiplier > 1);
  assert.ok(top.feature_snapshot.feedback_alignment_bonus > 0);
});
