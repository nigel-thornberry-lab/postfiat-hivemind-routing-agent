import test from "node:test";
import assert from "node:assert/strict";
import {
  DispatchError,
  DispatchRouter,
  formatDispatchPayload,
} from "./dispatch-routing.mjs";

const SAMPLE_MATCH_RESULT = {
  generated_at: "2026-02-27T00:00:00.000Z",
  task: { task_id: "task-123", type: "network", pft_offer: 2400 },
  operator: {
    operator_id: "op-abc",
    wallet_address: "rTESTWALLET123",
    alignment_score: 84,
    sybil_score: 92,
  },
  scores: {
    overall_match_score: 0.87,
    expertise_score: 0.9,
    alignment_score_norm: 0.84,
    sybil_score_norm: 0.92,
  },
  confidence: 0.89,
  routing_decision: "assign",
  rank: 1,
  eligibility: { passed_visibility_gate: true, passed_sybil_gate: true, gate_notes: [] },
  feature_snapshot: { expert_domains: ["API integration"] },
  explanation: ["Strong expert overlap."],
};

test("formatDispatchPayload creates assignment schema", () => {
  const payload = formatDispatchPayload(SAMPLE_MATCH_RESULT);
  assert.equal(payload.task_id, "task-123");
  assert.equal(payload.assignee.operator_id, "op-abc");
  assert.equal(payload.routing.decision, "assign");
  assert.equal(payload.routing.score, 0.87);
  assert.deepEqual(payload.context.explanation, ["Strong expert overlap."]);
});

test("dispatchMatch submits authenticated payload successfully", async () => {
  let capturedRequest = null;
  const fakeFetch = async (url, init) => {
    capturedRequest = { url, init };
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ assignment_id: "assign-1", status: "accepted" });
      },
    };
  };

  const router = new DispatchRouter({
    jwt: "test-jwt",
    baseUrl: "https://tasknode.postfiat.org",
    dispatchPath: "/api/routing/dispatch",
    fetchImpl: fakeFetch,
  });

  const result = await router.dispatchMatch(SAMPLE_MATCH_RESULT);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.response.assignment_id, "assign-1");
  assert.equal(capturedRequest.url, "https://tasknode.postfiat.org/api/routing/dispatch");
  assert.equal(capturedRequest.init.method, "POST");
  assert.equal(capturedRequest.init.headers.Authorization, "Bearer test-jwt");

  const body = JSON.parse(capturedRequest.init.body);
  assert.equal(body.task_id, "task-123");
  assert.equal(body.assignee.wallet_address, "rTESTWALLET123");
});

test("dispatchMatch maps 429 to rate-limit retryable error", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 429,
    async text() {
      return JSON.stringify({ error: "rate limited" });
    },
  });

  const router = new DispatchRouter({ jwt: "test-jwt", fetchImpl: fakeFetch });
  await assert.rejects(
    () => router.dispatchMatch(SAMPLE_MATCH_RESULT),
    (error) =>
      error instanceof DispatchError &&
      error.code === "RATE_LIMIT" &&
      error.retryable === true
  );
});

test("dispatchMatch dry-run skips POST and returns payload", async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
    throw new Error("Should not call fetch in dry-run mode");
  };

  const router = new DispatchRouter({
    jwt: "test-jwt",
    dryRun: true,
    fetchImpl: fakeFetch,
  });

  const result = await router.dispatchMatch(SAMPLE_MATCH_RESULT);
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.response.reason, "dry_run_enabled");
  assert.equal(called, false);
});
