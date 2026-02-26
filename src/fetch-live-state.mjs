#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskNodeClientFromEnv } from "./tasknode-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUT = path.resolve(__dirname, "..", "data", "live-state.json");

function parseArgs(argv) {
  const parsed = { out: DEFAULT_OUT, operatorLimit: 25 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") parsed.out = argv[i + 1];
    if (arg === "--operator-limit") parsed.operatorLimit = Number(argv[i + 1]);
  }
  return parsed;
}

async function main() {
  if (!process.env.PFT_TASKNODE_JWT) {
    console.error("Missing PFT_TASKNODE_JWT environment variable.");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const client = createTaskNodeClientFromEnv();
  const liveState = await client.fetchLiveState({ operatorLimit: args.operatorLimit });

  fs.writeFileSync(args.out, JSON.stringify(liveState, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        wrote: args.out,
        operator_count: liveState.metadata.operator_count,
        task_count: liveState.metadata.task_count,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`Failed to fetch live state: ${error.message}`);
  process.exit(1);
});
