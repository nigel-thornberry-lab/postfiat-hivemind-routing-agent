#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSchemaSummary } from "./schema-summary.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STARTED_AT = new Date();
const DEFAULT_PORT = Number(process.env.PFT_ROUTING_HEALTH_PORT || 8787);
const SAMPLE_DATA_PATH = path.resolve(__dirname, "..", "sample-data.json");
const LIVE_DATA_PATH = path.resolve(__dirname, "..", "data", "live-state.json");

function buildOperationalStatus() {
  const env = {
    has_tasknode_jwt: Boolean(process.env.PFT_TASKNODE_JWT),
    has_tasknode_url: Boolean(process.env.PFT_TASKNODE_URL),
    has_wss_url: Boolean(process.env.PFT_TASKNODE_WSS_URL),
  };

  const data_sources = {
    sample_data_exists: fs.existsSync(SAMPLE_DATA_PATH),
    live_state_exists: fs.existsSync(LIVE_DATA_PATH),
  };

  const ready = data_sources.sample_data_exists;

  return {
    status: ready ? "ok" : "degraded",
    ready,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT.getTime()) / 1000),
    started_at: STARTED_AT.toISOString(),
    checks: {
      env,
      data_sources,
    },
  };
}

function buildHealthResponse() {
  return {
    service: "hivemind-routing-agent",
    endpoint: "/health",
    operational: buildOperationalStatus(),
    schema_summary: getSchemaSummary(),
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, buildHealthResponse());
      return;
    }
    sendJson(res, 404, {
      error: "Not Found",
      message: "Use GET /health",
    });
  });
}

function main() {
  const server = createServer();
  server.listen(DEFAULT_PORT, "0.0.0.0", () => {
    console.log(`[health] listening on http://0.0.0.0:${DEFAULT_PORT}/health`);
  });
}

main();
