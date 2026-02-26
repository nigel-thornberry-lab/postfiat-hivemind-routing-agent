#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getSybilPenaltyMultiplier } from "./integrity-integration.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATASET_PATH = path.resolve(__dirname, "..", "sample-data.json");

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "for",
  "in",
  "on",
  "with",
  "into",
  "from",
  "by",
  "or",
  "at",
  "is",
  "are",
  "be",
  "as",
  "using",
  "use",
  "build",
  "create",
  "design",
  "implement",
]);

const SCORING_WEIGHTS = {
  // Mirrors chunk-4 pseudocode emphasis for this executable:
  // expert tags + alignment + sybil.
  expertise: 0.25,
  alignment: 0.2,
  sybil: 0.15,
};

export function loadDataset(datasetPath = DEFAULT_DATASET_PATH) {
  const raw = fs.readFileSync(datasetPath, "utf8");
  return JSON.parse(raw);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && token.length > 2 && !STOPWORDS.has(token));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function buildIntegrityIndexes(dataset) {
  const integrity = dataset?.integrity || {};
  const circuitBreaker = integrity?.circuit_breaker || {};
  return {
    blockedOperatorIds: new Set(circuitBreaker.blocked_operator_ids || []),
    blockedWalletAddresses: new Set(circuitBreaker.blocked_wallet_addresses || []),
    unauthorizedOperatorIds: new Set(integrity.unauthorized_operator_ids || []),
  };
}

function averageConfidence(expertEntries) {
  const weights = { high: 1.0, medium: 0.75, low: 0.5 };
  const values = expertEntries
    .map((entry) => weights[String(entry.confidence || "").toLowerCase()] ?? 0.6)
    .filter((n) => n > 0);
  if (!values.length) return 0.6;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function findTask(dataset, { taskId, taskTitle }) {
  if (taskId) {
    return dataset.network_tasks.find((task) => task.task_id === taskId) || null;
  }
  if (taskTitle) {
    const target = normalizeText(taskTitle);
    return (
      dataset.network_tasks.find((task) => normalizeText(task.title).includes(target)) || null
    );
  }
  return dataset.network_tasks[0] || null;
}

export function rankOperatorsForTask(dataset, task) {
  const sourceText = `${task.title} ${task.requirements}`;
  const taskTokens = new Set(tokenize(sourceText));
  const taskTokenCount = Math.max(taskTokens.size, 1);

  const active = [];
  const rejected = [];
  const integrity = buildIntegrityIndexes(dataset);

  for (const operator of dataset.operator_profiles) {
    const isHardBlocked =
      integrity.blockedOperatorIds.has(operator.operator_id) ||
      integrity.blockedWalletAddresses.has(operator.wallet_address) ||
      integrity.unauthorizedOperatorIds.has(operator.operator_id);

    if (isHardBlocked) {
      rejected.push({
        operator_id: operator.operator_id,
        wallet_address: operator.wallet_address,
        reason: "Operator blocked by integrity policy (circuit breaker/unauthorized list).",
      });
      continue;
    }

    const domains = operator.expert_knowledge || [];
    const domainText = domains.map((d) => d.domain || "").join(" ");
    const domainTokens = tokenize(domainText);
    const domainTokenSet = new Set(domainTokens);

    const matchedTokens = [...taskTokens].filter((token) => domainTokenSet.has(token));
    const matchedDomains = domains
      .filter((d) => {
        const domainTokensForEntry = new Set(tokenize(d.domain || ""));
        return [...taskTokens].some((token) => domainTokensForEntry.has(token));
      })
      .map((d) => d.domain);

    // Hard filter: only keep operators with at least one expert-tag match.
    if (matchedDomains.length === 0) {
      rejected.push({
        operator_id: operator.operator_id,
        wallet_address: operator.wallet_address,
        reason: "No overlap between task requirements and expert_knowledge domains.",
      });
      continue;
    }

    const confidenceMultiplier = averageConfidence(
      domains.filter((d) => matchedDomains.includes(d.domain))
    );
    const expertiseScore = clamp01((matchedTokens.length / taskTokenCount) * confidenceMultiplier);

    const alignmentScoreNorm = clamp01((operator.alignment_score || 0) / 100);
    const sybilScoreNorm = clamp01((operator.sybil_score || 0) / 100);
    const sybilPenaltyMultiplier = getSybilPenaltyMultiplier(
      operator.sybil_risk,
      operator.sybil_score
    );

    // Normalize weighted sum since this executable uses only these three components.
    const rawWeighted =
      SCORING_WEIGHTS.expertise * expertiseScore +
      SCORING_WEIGHTS.alignment * alignmentScoreNorm +
      SCORING_WEIGHTS.sybil * sybilScoreNorm;
    const normalizationDivisor =
      SCORING_WEIGHTS.expertise + SCORING_WEIGHTS.alignment + SCORING_WEIGHTS.sybil;
    const overallMatchScore = clamp01((rawWeighted / normalizationDivisor) * sybilPenaltyMultiplier);
    const confidence = clamp01(overallMatchScore + (matchedDomains.length >= 2 ? 0.03 : 0));

    active.push({
      match_id: randomUUID(),
      generated_at: new Date().toISOString(),
      task: {
        task_id: task.task_id,
        type: task.type,
        pft_offer: task.pft_offer,
      },
      operator: {
        operator_id: operator.operator_id,
        wallet_address: operator.wallet_address,
        alignment_score: operator.alignment_score,
        sybil_score: operator.sybil_score,
      },
      scores: {
        overall_match_score: Number(overallMatchScore.toFixed(4)),
        expertise_score: Number(expertiseScore.toFixed(4)),
        alignment_score_norm: Number(alignmentScoreNorm.toFixed(4)),
        sybil_score_norm: Number(sybilScoreNorm.toFixed(4)),
        sybil_penalty_multiplier: Number(sybilPenaltyMultiplier.toFixed(4)),
      },
      confidence: Number(confidence.toFixed(4)),
      routing_decision: overallMatchScore >= 0.75 ? "assign" : "defer",
      eligibility: {
        passed_visibility_gate: Boolean(operator.is_public && operator.is_published),
        passed_sybil_gate: !["High Risk"].includes(operator.sybil_risk || ""),
        gate_notes: [],
      },
      feature_snapshot: {
        expert_domains: matchedDomains,
        alignment_tier: operator.alignment_tier,
        sybil_risk: operator.sybil_risk,
        integrity_blocked: false,
      },
      explanation: [
        `Matched expert tags: ${matchedDomains.join(", ")}`,
        `Final score combines expertise overlap with alignment and sybil weighting (sybil penalty x${Number(
          sybilPenaltyMultiplier.toFixed(2)
        )}).`,
      ],
    });
  }

  active.sort((a, b) => b.scores.overall_match_score - a.scores.overall_match_score);
  active.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    task,
    ranked_results: active,
    rejected_operators: rejected,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--task-id") parsed.taskId = argv[i + 1];
    if (arg === "--task-title") parsed.taskTitle = argv[i + 1];
    if (arg === "--dataset") parsed.datasetPath = argv[i + 1];
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = loadDataset(args.datasetPath || DEFAULT_DATASET_PATH);
  const task = findTask(dataset, { taskId: args.taskId, taskTitle: args.taskTitle });

  if (!task) {
    console.error("Task not found. Provide --task-id or --task-title.");
    process.exit(1);
  }

  const output = rankOperatorsForTask(dataset, task);
  console.log(JSON.stringify(output, null, 2));
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main();
}
