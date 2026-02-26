#!/usr/bin/env node
import { createTaskNodeClientFromEnv } from "./tasknode-client.mjs";
import { ingestNetworkTasks, ingestOperatorProfiles } from "./state-ingestion.mjs";

async function main() {
  if (!process.env.PFT_TASKNODE_JWT) {
    throw new Error("Missing PFT_TASKNODE_JWT. Set auth token before running ingestion test.");
  }

  const client = createTaskNodeClientFromEnv();

  const leaderboard = await client.getLeaderboard();
  const tasksSummary = await client.getTasksSummary();
  const rewarded = await client.getTasksRewarded(5, 0);

  const operatorsFromLeaderboard = ingestOperatorProfiles(leaderboard);
  const tasksFromSummary = ingestNetworkTasks(tasksSummary);
  const tasksFromRewarded = ingestNetworkTasks(rewarded, { statusHint: "rewarded" });

  let operatorsFromPublicProfile = [];
  const firstWallet = operatorsFromLeaderboard[0]?.wallet_address;
  if (firstWallet) {
    try {
      const publicProfile = await client.getProfilePublic(firstWallet);
      operatorsFromPublicProfile = ingestOperatorProfiles(publicProfile);
    } catch {
      // Some wallets are private; skip this branch when forbidden.
      operatorsFromPublicProfile = [];
    }
  }

  const sampleWssTaskEvent = {
    type: "task_created",
    data: {
      task: rewarded.tasks?.[0] ?? null,
    },
  };
  const tasksFromWssStyleEvent = ingestNetworkTasks(sampleWssTaskEvent, {
    statusHint: "pending",
  });

  const summary = {
    ok: true,
    checks: {
      leaderboard_operator_count: operatorsFromLeaderboard.length,
      public_profile_operator_count: operatorsFromPublicProfile.length,
      tasks_summary_count: tasksFromSummary.length,
      tasks_rewarded_count: tasksFromRewarded.length,
      wss_style_task_event_count: tasksFromWssStyleEvent.length,
    },
    samples: {
      operator: operatorsFromLeaderboard[0] ?? null,
      task: tasksFromSummary[0] ?? null,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`Ingestion test failed: ${error.message}`);
  process.exit(1);
});
