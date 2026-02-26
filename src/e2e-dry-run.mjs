#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskNodeClientFromEnv } from "./tasknode-client.mjs";
import { ingestNetworkTasks, ingestOperatorProfiles } from "./state-ingestion.mjs";
import { rankOperatorsForTask } from "./matcher.mjs";
import { createDispatchRouterFromEnv } from "./dispatch-routing.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LOG_PATH = path.resolve(__dirname, "..", "data", "e2e-dry-run-log.json");
const DEFAULT_TOPICS = ["task_created", "task_updated"];

function flattenSummaryTasks(summaryPayload) {
  const byStatus = summaryPayload?.tasks ?? {};
  return Object.values(byStatus).flatMap((tasks) => (Array.isArray(tasks) ? tasks : []));
}

async function bootstrapWssSession({ jwt, wssUrl, topics }) {
  if (!wssUrl) {
    return { attempted: false, connected: false, reason: "missing_wss_url" };
  }
  if (typeof WebSocket === "undefined") {
    return { attempted: false, connected: false, reason: "websocket_unavailable" };
  }

  return await new Promise((resolve) => {
    const ws = new WebSocket(wssUrl);
    const startedAt = Date.now();
    let settled = false;
    let firstMessage = null;

    const done = (result) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // no-op
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      done({
        attempted: true,
        connected: true,
        acknowledged: false,
        elapsed_ms: Date.now() - startedAt,
        first_message: firstMessage,
        reason: "no_message_before_timeout",
      });
    }, 1500);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "auth", token: jwt }));
      ws.send(JSON.stringify({ type: "subscribe", topics }));
    });

    ws.addEventListener("message", (event) => {
      firstMessage = String(event.data).slice(0, 400);
      clearTimeout(timeout);
      done({
        attempted: true,
        connected: true,
        acknowledged: true,
        elapsed_ms: Date.now() - startedAt,
        first_message: firstMessage,
      });
    });

    ws.addEventListener("error", (error) => {
      clearTimeout(timeout);
      done({
        attempted: true,
        connected: false,
        acknowledged: false,
        elapsed_ms: Date.now() - startedAt,
        reason: error?.message || error?.type || "websocket_error",
      });
    });
  });
}

function chooseTaskAndRanking(operators, mappedTasks) {
  for (const task of mappedTasks) {
    if (!task?.task_id || !task?.requirements) continue;
    const dataset = {
      metadata: { dataset: "e2e-dry-run" },
      operator_profiles: operators,
      network_tasks: [task],
      match_results: [],
    };
    const ranking = rankOperatorsForTask(dataset, task);
    if (ranking.ranked_results.length > 0) {
      return { task, ranking };
    }
  }
  return null;
}

async function main() {
  if (!process.env.PFT_TASKNODE_JWT) {
    throw new Error("Missing PFT_TASKNODE_JWT.");
  }

  const logPath = process.env.PFT_E2E_DRY_RUN_LOG || DEFAULT_LOG_PATH;
  const topics = String(process.env.PFT_TASKNODE_WSS_TOPICS || DEFAULT_TOPICS.join(","))
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const client = createTaskNodeClientFromEnv();
  const dispatchRouter = createDispatchRouterFromEnv({ dryRun: true });

  const wss = await bootstrapWssSession({
    jwt: process.env.PFT_TASKNODE_JWT,
    wssUrl: process.env.PFT_TASKNODE_WSS_URL,
    topics,
  });

  const [leaderboard, tasksSummary] = await Promise.all([
    client.getLeaderboard(),
    client.getTasksSummary(),
  ]);

  const operators = ingestOperatorProfiles(leaderboard);
  const mappedTasks = ingestNetworkTasks(tasksSummary);

  // Simulate WSS-style ingestion path using one live task payload.
  const rawSummaryTasks = flattenSummaryTasks(tasksSummary);
  const rawEventTask = rawSummaryTasks.find((task) => task?.id && task?.requirements) ?? null;
  const wssIngestedTasks = rawEventTask
    ? ingestNetworkTasks({ type: "task_created", data: { task: rawEventTask } }, { statusHint: "pending" })
    : [];

  const selected = chooseTaskAndRanking(operators, mappedTasks);
  if (!selected) {
    throw new Error("No routable task produced non-empty ranked results.");
  }

  const topMatch = selected.ranking.ranked_results[0];
  const dispatchResult = await dispatchRouter.dispatchMatch(topMatch, {
    assignmentSource: "hivemind-e2e-dry-run",
    dryRun: true,
  });

  const logPayload = {
    ok: true,
    generated_at: new Date().toISOString(),
    components: {
      api_client_initialized: true,
      wss_listener_bootstrap: wss,
      state_ingestion: {
        operators_mapped: operators.length,
        tasks_mapped: mappedTasks.length,
        wss_style_tasks_mapped: wssIngestedTasks.length,
      },
      matching_engine: {
        selected_task_id: selected.task.task_id,
        ranked_results: selected.ranking.ranked_results.length,
        top_operator_id: topMatch.operator.operator_id,
        top_score: topMatch.scores.overall_match_score,
      },
      dispatch: {
        dry_run: Boolean(dispatchResult?.dry_run),
        status: dispatchResult?.status ?? null,
        payload_preview: dispatchResult?.payload ?? null,
        response: dispatchResult?.response ?? null,
      },
    },
  };

  fs.writeFileSync(logPath, JSON.stringify(logPayload, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        log_path: logPath,
        selected_task_id: selected.task.task_id,
        top_operator_id: topMatch.operator.operator_id,
        top_score: topMatch.scores.overall_match_score,
        dispatch_dry_run: dispatchResult.dry_run,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`E2E dry-run failed: ${error.message}`);
  process.exit(1);
});
