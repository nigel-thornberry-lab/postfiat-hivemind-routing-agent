#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createTaskNodeClientFromEnv } from "./tasknode-client.mjs";
import { fetchLiveIntegrityContext } from "./integrity-integration.mjs";
import { rankOperatorsForTask } from "./matcher.mjs";
import { createTelemetryEmitterFromEnv } from "./telemetry.mjs";

function toString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const SYBIL_RISK_RANK = {
  "low risk": 1,
  moderate: 2,
  elevated: 3,
  "high risk": 4,
};

export function normalizeQueryPayload(payload) {
  const requestText = toString(payload?.user_request_text || payload?.request || "").trim();
  const requiredSkills = asArray(payload?.required_skills)
    .map((item) => toString(item).trim())
    .filter(Boolean);

  const constraints = payload?.constraints && typeof payload.constraints === "object"
    ? payload.constraints
    : {};

  return {
    request_id: toString(payload?.request_id || randomUUID()),
    user_request_text: requestText,
    required_skills: requiredSkills,
    constraints: {
      max_sybil_risk: toString(constraints.max_sybil_risk || "").trim() || null,
      min_alignment_score: toNumber(constraints.min_alignment_score, null),
      public_only: Boolean(constraints.public_only),
      exclude_operator_ids: asArray(constraints.exclude_operator_ids)
        .map((item) => toString(item).trim())
        .filter(Boolean),
    },
    top_k: Math.max(1, Math.min(10, toNumber(payload?.top_k, 3) ?? 3)),
  };
}

export function validateQueryPayload(payload) {
  const errors = [];
  if (!payload.user_request_text) {
    errors.push("user_request_text is required");
  }
  if (payload.required_skills.length === 0 && payload.user_request_text.length < 4) {
    errors.push("request text is too short without required_skills");
  }
  if (
    payload.constraints.min_alignment_score !== null &&
    (payload.constraints.min_alignment_score < 0 || payload.constraints.min_alignment_score > 100)
  ) {
    errors.push("constraints.min_alignment_score must be between 0 and 100");
  }
  if (
    payload.constraints.max_sybil_risk &&
    !(toString(payload.constraints.max_sybil_risk).toLowerCase() in SYBIL_RISK_RANK)
  ) {
    errors.push("constraints.max_sybil_risk must be one of: Low Risk, Moderate, Elevated, High Risk");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildTaskFromQuery(payload) {
  const requirementsParts = [payload.user_request_text];
  if (payload.required_skills.length) {
    requirementsParts.push(`Required skills: ${payload.required_skills.join(", ")}`);
  }

  return {
    task_id: `query-${payload.request_id}`,
    title: payload.user_request_text.slice(0, 120),
    type: "network",
    status: "on_demand_query",
    requirements: requirementsParts.join("\n"),
    pft_offer: null,
  };
}

function applyOperatorConstraints(operators, constraints) {
  const excluded = new Set(constraints.exclude_operator_ids);
  const maxRiskRank = constraints.max_sybil_risk
    ? SYBIL_RISK_RANK[toString(constraints.max_sybil_risk).toLowerCase()]
    : null;

  return operators.filter((operator) => {
    if (excluded.has(operator.operator_id)) return false;
    if (constraints.public_only && !(operator.is_public && operator.is_published)) return false;

    if (
      constraints.min_alignment_score !== null &&
      Number(operator.alignment_score || 0) < constraints.min_alignment_score
    ) {
      return false;
    }

    if (maxRiskRank !== null) {
      const rank = SYBIL_RISK_RANK[toString(operator.sybil_risk).toLowerCase()] ?? 99;
      if (rank > maxRiskRank) return false;
    }
    return true;
  });
}

export function runOnDemandQueryWithDataset(queryPayload, dataset, options = {}) {
  const normalized = normalizeQueryPayload(queryPayload);
  const validation = validateQueryPayload(normalized);
  if (!validation.valid) {
    const error = new Error(`Invalid query payload: ${validation.errors.join("; ")}`);
    error.code = "INVALID_QUERY";
    throw error;
  }

  const telemetry = options.telemetry || dataset?.telemetry || createTelemetryEmitterFromEnv();
  const task = buildTaskFromQuery(normalized);
  const constrainedOperators = applyOperatorConstraints(
    asArray(dataset?.operator_profiles),
    normalized.constraints
  );

  const ranking = rankOperatorsForTask(
    {
      ...dataset,
      operator_profiles: constrainedOperators,
      network_tasks: [task],
      telemetry,
    },
    task
  );

  const top = ranking.ranked_results.slice(0, normalized.top_k).map((item) => ({
    rank: item.rank,
    operator_id: item.operator.operator_id,
    wallet_address: item.operator.wallet_address,
    confidence: item.confidence,
    overall_match_score: item.scores.overall_match_score,
    matched_expert_domains: item.feature_snapshot.expert_domains,
    alignment_score: item.operator.alignment_score,
    sybil_score: item.operator.sybil_score,
    sybil_risk: item.feature_snapshot.sybil_risk,
    reasoning: item.explanation,
  }));

  telemetry?.emit({
    event_type: "query.on_demand_completed",
    severity: "info",
    task_id: task.task_id,
    payload: {
      request_id: normalized.request_id,
      candidate_count: constrainedOperators.length,
      returned_count: top.length,
      top_operator_id: top[0]?.operator_id || null,
    },
  });

  return {
    ok: true,
    request_id: normalized.request_id,
    generated_at: new Date().toISOString(),
    query: normalized,
    task,
    candidates_considered: constrainedOperators.length,
    rejected_count: ranking.rejected_operators.length,
    top_matches: top,
  };
}

export async function runOnDemandQuery(queryPayload, options = {}) {
  const client = options.client || createTaskNodeClientFromEnv();
  const telemetry = options.telemetry || createTelemetryEmitterFromEnv();
  const operatorLimit = Math.max(1, Math.min(200, Number(options.operatorLimit || 50)));
  const operatorProfiles = await client.fetchOperatorProfiles({ limit: operatorLimit });
  const integrity = await fetchLiveIntegrityContext(client, operatorProfiles, { telemetry }).catch(
    () => null
  );

  return runOnDemandQueryWithDataset(
    queryPayload,
    {
      metadata: {
        dataset: "on-demand-live-query",
        generated_at: new Date().toISOString(),
      },
      operator_profiles: operatorProfiles,
      network_tasks: [],
      match_results: [],
      integrity: integrity || undefined,
      telemetry,
    },
    { telemetry }
  );
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error("Pass JSON query payload as first argument.");
  }
  const payload = JSON.parse(raw);
  const result = await runOnDemandQuery(payload);
  console.log(JSON.stringify(result, null, 2));
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((error) => {
    console.error(`[query] Fatal error: ${error.message}`);
    process.exit(1);
  });
}
