#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTaskNodeClientFromEnv } from "./tasknode-client.mjs";
import { createTelemetryEmitterFromEnv } from "./telemetry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MEMORY_PATH = path.resolve(__dirname, "..", "data", "feedback-memory.json");

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toIsoFromMs(value, fallbackIso) {
  const ms = toNumber(value, 0);
  if (ms > 0) return new Date(ms).toISOString();
  return fallbackIso;
}

function classifyOutcome(task) {
  const status = String(task.status || "").toLowerCase();
  if (status === "refused") return "refused";
  if (status === "cancelled") return "abandoned";

  const tier = String(task.reward_tier || "").toLowerCase();
  const pftRaw = task.pft_offer ?? task.pft ?? null;
  const pft = toNumber(pftRaw, 0);
  if (status === "rewarded" && (tier === "rejected" || (pftRaw !== null && pft <= 0))) {
    return "refused";
  }
  if (status === "rewarded") return "completed";

  return null;
}

export function mapTerminalTasksToOutcomes(tasks, { operatorId = null, detectedAt = null } = {}) {
  const detectedAtIso = detectedAt || new Date().toISOString();
  const outcomes = [];

  for (const task of tasks) {
    const outcomeStatus = classifyOutcome(task);
    if (!outcomeStatus || !task?.task_id) continue;

    const terminalAt = toIsoFromMs(
      task.rewarded_at_ms || task.submitted_at_ms || task.accepted_at_ms || task.created_at_ms,
      detectedAtIso
    );

    outcomes.push({
      outcome_id: `${task.task_id}:${outcomeStatus}:${terminalAt}`,
      status: outcomeStatus,
      operator_id: operatorId,
      task_id: task.task_id,
      detected_at: detectedAtIso,
      terminal_at: terminalAt,
      source_status: task.status || null,
      source_reward_tier: task.reward_tier || null,
      source_reward_summary: task.reward_summary || null,
      source_tx_hash: task.tx_hash || null,
    });
  }

  return outcomes;
}

function emptyMemory() {
  return {
    schema_version: "1.0",
    updated_at: new Date().toISOString(),
    processed_outcome_ids: [],
    operators: {},
  };
}

export function loadFeedbackMemory(filePath = DEFAULT_MEMORY_PATH) {
  if (!fs.existsSync(filePath)) return emptyMemory();
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...emptyMemory(),
    ...parsed,
    processed_outcome_ids: Array.isArray(parsed?.processed_outcome_ids)
      ? parsed.processed_outcome_ids
      : [],
    operators: parsed?.operators && typeof parsed.operators === "object" ? parsed.operators : {},
  };
}

export function saveFeedbackMemory(memory, filePath = DEFAULT_MEMORY_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf8");
}

function initialOperatorMemory() {
  return {
    performance_multiplier: 1.0,
    alignment_bonus: 0,
    completed_count: 0,
    refused_count: 0,
    abandoned_count: 0,
    last_task_id: null,
    last_outcome_at: null,
  };
}

function applySingleOutcome(operatorMemory, outcome) {
  const next = { ...initialOperatorMemory(), ...operatorMemory };
  if (outcome.status === "completed") {
    next.performance_multiplier = Math.min(1.25, next.performance_multiplier + 0.03);
    next.alignment_bonus = Math.min(10, next.alignment_bonus + 1);
    next.completed_count += 1;
  } else if (outcome.status === "refused") {
    next.performance_multiplier = Math.max(0.55, next.performance_multiplier - 0.08);
    next.alignment_bonus = Math.max(-25, next.alignment_bonus - 2);
    next.refused_count += 1;
  } else if (outcome.status === "abandoned") {
    next.performance_multiplier = Math.max(0.45, next.performance_multiplier - 0.12);
    next.alignment_bonus = Math.max(-30, next.alignment_bonus - 3);
    next.abandoned_count += 1;
  }

  next.last_task_id = outcome.task_id;
  next.last_outcome_at = outcome.terminal_at;
  next.performance_multiplier = Number(next.performance_multiplier.toFixed(4));
  next.alignment_bonus = Number(next.alignment_bonus.toFixed(2));
  return next;
}

export function applyOutcomeAdjustments(memory, outcomes) {
  const next = {
    ...memory,
    processed_outcome_ids: [...memory.processed_outcome_ids],
    operators: { ...memory.operators },
    updated_at: new Date().toISOString(),
  };

  const processed = new Set(next.processed_outcome_ids);
  let applied = 0;

  for (const outcome of outcomes) {
    if (!outcome.operator_id) continue;
    if (processed.has(outcome.outcome_id)) continue;

    const current = next.operators[outcome.operator_id] || initialOperatorMemory();
    next.operators[outcome.operator_id] = applySingleOutcome(current, outcome);
    next.processed_outcome_ids.push(outcome.outcome_id);
    processed.add(outcome.outcome_id);
    applied += 1;
  }

  return { memory: next, applied };
}

export async function ingestLiveFeedbackOutcomes({
  memoryPath = DEFAULT_MEMORY_PATH,
  operatorId = null,
  telemetry = null,
} = {}) {
  const client = createTaskNodeClientFromEnv();
  const tasks = await client.fetchNetworkTasks();
  const outcomes = mapTerminalTasksToOutcomes(tasks, { operatorId });
  const memory = loadFeedbackMemory(memoryPath);
  const { memory: updated, applied } = applyOutcomeAdjustments(memory, outcomes);
  saveFeedbackMemory(updated, memoryPath);

  telemetry?.emit({
    event_type: "feedback.outcomes_ingested",
    severity: "info",
    payload: {
      fetched_tasks: tasks.length,
      terminal_outcomes_detected: outcomes.length,
      applied_adjustments: applied,
      memory_path: memoryPath,
    },
  });

  return {
    memory_path: memoryPath,
    fetched_tasks: tasks.length,
    terminal_outcomes_detected: outcomes.length,
    applied_adjustments: applied,
    operators_tracked: Object.keys(updated.operators).length,
  };
}

async function main() {
  if (!process.env.PFT_TASKNODE_JWT) {
    throw new Error("Missing PFT_TASKNODE_JWT.");
  }

  const telemetry = createTelemetryEmitterFromEnv();
  const memoryPath = process.env.PFT_FEEDBACK_MEMORY_PATH || DEFAULT_MEMORY_PATH;
  const operatorId = process.env.PFT_FEEDBACK_OPERATOR_ID || null;
  const summary = await ingestLiveFeedbackOutcomes({ memoryPath, operatorId, telemetry });
  console.log(JSON.stringify(summary, null, 2));
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((error) => {
    console.error(`[feedback] Fatal error: ${error.message}`);
    process.exit(1);
  });
}
