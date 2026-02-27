#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskNodeClientFromEnv } from "./tasknode-client.mjs";
import { createDispatchRouterFromEnv, DispatchError } from "./dispatch-routing.mjs";
import { fetchLiveIntegrityContext } from "./integrity-integration.mjs";
import { rankOperatorsForTask } from "./matcher.mjs";
import { ingestNetworkTasks } from "./state-ingestion.mjs";
import { createTelemetryEmitterFromEnv } from "./telemetry.mjs";
import { ingestLiveFeedbackOutcomes } from "./feedback-ingestion.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_TOPICS = ["task_created", "task_updated"];
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, "..", "data", "latest-match-result.json");

function getWebSocketCtor() {
  if (typeof WebSocket !== "undefined") {
    return WebSocket;
  }
  throw new Error("Global WebSocket is unavailable in this Node runtime.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getEventType(payload) {
  return payload?.type || payload?.event || payload?.name || payload?.topic || null;
}

function getTaskPayload(payload) {
  return payload?.task || payload?.data?.task || payload?.payload?.task || payload?.data || null;
}

function normalizeEventTask(rawTask) {
  if (!rawTask || typeof rawTask !== "object") return null;
  return {
    id: rawTask.id ?? rawTask.task_id ?? null,
    title: rawTask.title ?? null,
    type: rawTask.type ?? null,
    status: rawTask.status ?? null,
    requirements: rawTask.requirements ?? rawTask.description ?? null,
    verificationAsk: rawTask.verificationAsk ?? rawTask.verification_ask ?? null,
    verificationStatus: rawTask.verificationStatus ?? rawTask.verification_status ?? null,
    pft: rawTask.pft ?? rawTask.pft_offer ?? null,
    rewardTier: rawTask.rewardTier ?? rawTask.reward_tier ?? null,
    rewardScore: rawTask.rewardScore ?? rawTask.reward_score ?? null,
    rewardSummary: rawTask.rewardSummary ?? rawTask.reward_summary ?? null,
    createdAt: rawTask.createdAt ?? rawTask.created_at_ms ?? null,
    acceptedAt: rawTask.acceptedAt ?? rawTask.accepted_at_ms ?? null,
    submittedAt: rawTask.submittedAt ?? rawTask.submitted_at_ms ?? null,
    rewardedAt: rawTask.rewardedAt ?? rawTask.rewarded_at_ms ?? null,
    submissionId: rawTask.submissionId ?? rawTask.submission_id ?? null,
    txHash: rawTask.txHash ?? rawTask.tx_hash ?? null,
    refusalCategory: rawTask.refusalCategory ?? rawTask.refusal_category ?? null,
    reason: rawTask.reason ?? null,
  };
}

async function buildTaskForRouting(client, rawTask, statusHint = null) {
  const normalized = normalizeEventTask(rawTask);
  if (normalized) {
    try {
      const tasks = ingestNetworkTasks({ task: normalized }, { statusHint });
      const mapped = tasks[0];
      if (mapped?.task_id && mapped?.title && mapped?.requirements) {
        return mapped;
      }
    } catch {
      // fall through to task lookup fallback
    }
  }

  if (normalized?.id) {
    const tasks = await client.fetchNetworkTasks();
    const existing = tasks.find((task) => task.task_id === normalized.id);
    if (existing) return existing;
  }

  return null;
}

function writeOutput(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function processTaskEvent(client, payload, outputPath) {
  const telemetry = createTelemetryEmitterFromEnv();
  const runId = new Date().toISOString();
  const feedbackMemoryPath = process.env.PFT_FEEDBACK_MEMORY_PATH || null;
  if (feedbackMemoryPath) {
    try {
      await ingestLiveFeedbackOutcomes({
        memoryPath: feedbackMemoryPath,
        operatorId: process.env.PFT_FEEDBACK_OPERATOR_ID || null,
        telemetry,
      });
    } catch (error) {
      console.error(`[listener] Feedback ingestion failed: ${error.message}`);
    }
  }
  const eventType = getEventType(payload) || "task_event";
  const statusHint =
    eventType === "task_created" ? "pending" : eventType === "task_updated" ? null : null;

  const task = await buildTaskForRouting(client, getTaskPayload(payload), statusHint);
  if (!task) {
    console.error(`[listener] Ignored ${eventType}: missing routable task payload.`);
    return;
  }

  const operatorProfiles = await client.fetchOperatorProfiles({ limit: 50 });
  const integrity = await fetchLiveIntegrityContext(client, operatorProfiles, { telemetry, runId });
  const dataset = {
    metadata: {
      dataset: "realtime-event-snapshot",
      generated_at: new Date().toISOString(),
      source_event: eventType,
      operator_count: operatorProfiles.length,
      task_count: 1,
      match_result_count: 0,
    },
    operator_profiles: operatorProfiles,
    network_tasks: [task],
    match_results: [],
    integrity,
    telemetry,
  };

  const ranking = rankOperatorsForTask(dataset, task);
  const top = ranking.ranked_results[0];

  let dispatch = null;
  if (top) {
    dispatch = await dispatchTopMatch(top);
  }

  const output = {
    event_type: eventType,
    received_at: new Date().toISOString(),
    task_id: task.task_id,
    ranking,
    dispatch,
  };
  writeOutput(outputPath, output);

  if (top) {
    console.log(
      `[listener] ${eventType} -> ranked ${ranking.ranked_results.length} operators for task ${task.task_id}. top=${top.operator.operator_id} score=${top.scores.overall_match_score} dispatch=${dispatch?.ok ? "ok" : "error"}`
    );
  } else {
    console.log(
      `[listener] ${eventType} -> no eligible operators after filtering for task ${task.task_id}.`
    );
  }
}

const dispatchRouter = createDispatchRouterFromEnv();

function isRateLimitError(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return message.includes("429") || message.includes("rate limit");
}

async function dispatchTopMatch(matchResult) {
  const maxAttempts = Number(process.env.PFT_DISPATCH_MAX_ATTEMPTS || 3);
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await dispatchRouter.dispatchMatch(matchResult, {
        assignmentSource: "hivemind-realtime-listener",
      });
      return {
        ok: true,
        attempt,
        dry_run: Boolean(result?.dry_run),
        status: result?.status ?? null,
        response: result?.response ?? null,
      };
    } catch (error) {
      const retryable = error instanceof DispatchError ? error.retryable : false;
      const code = error instanceof DispatchError ? error.code : "UNKNOWN";
      console.error(
        `[listener] Dispatch failed attempt=${attempt} code=${code} retryable=${retryable}: ${error.message}`
      );
      if (!retryable || attempt >= maxAttempts) {
        return {
          ok: false,
          attempt,
          dry_run: false,
          status: error.status ?? null,
          error_code: code,
          error_message: error.message,
        };
      }
      const backoffMs = Math.min(20000, 1000 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 200);
      await sleep(backoffMs + jitterMs);
    }
  }
  return {
    ok: false,
    error_code: "DISPATCH_RETRY_EXHAUSTED",
    error_message: "Dispatch retries exhausted.",
  };
}

async function processTaskEventWithRetry(client, payload, outputPath) {
  const maxAttempts = Number(process.env.PFT_EVENT_PROCESS_MAX_ATTEMPTS || 3);
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await processTaskEvent(client, payload, outputPath);
      return;
    } catch (error) {
      const rateLimited = isRateLimitError(error);
      console.error(
        `[listener] Event processing failed attempt=${attempt} rate_limited=${rateLimited}: ${error.message}`
      );
      if (!rateLimited || attempt >= maxAttempts) {
        throw error;
      }
      const backoffMs = Math.min(15000, 1000 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 200);
      await sleep(backoffMs + jitterMs);
    }
  }
}

function buildSubscriptionTopics() {
  const raw = process.env.PFT_TASKNODE_WSS_TOPICS;
  if (!raw) return DEFAULT_TOPICS;
  return raw
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

async function main() {
  if (!process.env.PFT_TASKNODE_JWT) {
    throw new Error("Missing PFT_TASKNODE_JWT.");
  }

  const wssUrl = process.env.PFT_TASKNODE_WSS_URL;
  if (!wssUrl) {
    throw new Error("Missing PFT_TASKNODE_WSS_URL.");
  }

  const outputPath = process.env.PFT_ROUTING_EVENT_OUTPUT || DEFAULT_OUTPUT_PATH;
  const topics = buildSubscriptionTopics();
  const jwt = process.env.PFT_TASKNODE_JWT;
  const client = createTaskNodeClientFromEnv();
  const WS = getWebSocketCtor();

  let shouldRun = true;
  let reconnectAttempt = 0;
  let activeSocket = null;

  const shutdown = () => {
    shouldRun = false;
    if (activeSocket && activeSocket.readyState === activeSocket.OPEN) {
      activeSocket.close(1000, "shutdown");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (shouldRun) {
    try {
      console.log(`[listener] Connecting to ${wssUrl} (attempt ${reconnectAttempt + 1})`);
      const socket = new WS(wssUrl);
      activeSocket = socket;

      await new Promise((resolve, reject) => {
        let settled = false;
        const onOpen = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const onError = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        socket.addEventListener("open", onOpen);
        socket.addEventListener("error", onError, { once: true });
      });

      reconnectAttempt = 0;
      console.log("[listener] Connected.");

      // Attempt token auth + topic subscription. Server may ignore unknown messages.
      socket.send(JSON.stringify({ type: "auth", token: jwt }));
      socket.send(JSON.stringify({ type: "subscribe", topics }));

      await new Promise((resolve) => {
        socket.addEventListener("message", async (event) => {
          const payload = parseJsonSafe(String(event.data));
          if (!payload) return;

          const eventType = getEventType(payload);
          if (!eventType) return;
          if (!topics.includes(eventType)) return;

          try {
            await processTaskEventWithRetry(client, payload, outputPath);
          } catch (error) {
            console.error(`[listener] Failed to process ${eventType}: ${error.message}`);
          }
        });

        socket.addEventListener("close", (event) => {
          console.error(
            `[listener] Connection closed code=${event.code} reason=${event.reason || "none"}`
          );
          resolve();
        });

        socket.addEventListener("error", (error) => {
          console.error(`[listener] Socket error: ${error.message || error.type || "unknown"}`);
        });
      });
    } catch (error) {
      console.error(`[listener] Connect/process error: ${error.message}`);
    }

    if (!shouldRun) break;
    reconnectAttempt += 1;
    const backoffMs = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
    const jitterMs = Math.floor(Math.random() * 250);
    const waitMs = backoffMs + jitterMs;
    console.log(`[listener] Reconnecting in ${waitMs}ms...`);
    await sleep(waitMs);
  }

  console.log("[listener] Stopped.");
}

main().catch((error) => {
  console.error(`[listener] Fatal error: ${error.message}`);
  process.exit(1);
});
