#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LISTENER_PATH = path.resolve(__dirname, "realtime-listener.mjs");

let shuttingDown = false;

function requiredEnvCheck() {
  const required = ["PFT_TASKNODE_JWT", "PFT_TASKNODE_WSS_URL"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installGlobalGuards() {
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[daemon] unhandledRejection: ${message}`);
  });
  process.on("uncaughtException", (error) => {
    console.error(`[daemon] uncaughtException: ${error.stack || error.message}`);
  });
}

function installSignalHandlers(activeChildRef) {
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[daemon] Received ${signal}. Stopping child listener...`);
    const child = activeChildRef.current;
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function spawnListener() {
  const child = spawn(process.execPath, [LISTENER_PATH], {
    stdio: "inherit",
    env: process.env,
  });
  return child;
}

async function main() {
  requiredEnvCheck();
  installGlobalGuards();

  const activeChildRef = { current: null };
  installSignalHandlers(activeChildRef);

  let restartAttempt = 0;
  console.log("[daemon] Starting Hive Mind routing daemon...");

  while (!shuttingDown) {
    const child = spawnListener();
    activeChildRef.current = child;

    const exitInfo = await new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });

    if (shuttingDown) break;

    restartAttempt += 1;
    const backoffMs = Math.min(60000, 1000 * 2 ** Math.min(restartAttempt, 6));
    const jitterMs = Math.floor(Math.random() * 400);
    const waitMs = backoffMs + jitterMs;

    console.error(
      `[daemon] listener exited (code=${exitInfo.code}, signal=${exitInfo.signal}). restarting in ${waitMs}ms (attempt ${restartAttempt}).`
    );
    await sleep(waitMs);
  }

  console.log("[daemon] Stopped.");
}

main().catch((error) => {
  console.error(`[daemon] Fatal startup error: ${error.message}`);
  process.exit(1);
});
