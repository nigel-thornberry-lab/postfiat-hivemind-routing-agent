#!/usr/bin/env node
import http from "node:http";
import { runOnDemandQuery } from "./on-demand-query.mjs";

const DEFAULT_PORT = 8790;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function main() {
  const port = Number(process.env.PFT_QUERY_PORT || DEFAULT_PORT);
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true, service: "on-demand-query", status: "ready" });
    }

    if (req.method === "POST" && req.url === "/query") {
      try {
        const payload = await parseBody(req);
        const result = await runOnDemandQuery(payload);
        return sendJson(res, 200, result);
      } catch (error) {
        const code = error?.code === "INVALID_QUERY" ? 400 : 500;
        return sendJson(res, code, {
          ok: false,
          error: error.message || "query_failed",
        });
      }
    }

    return sendJson(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[query-server] listening on http://0.0.0.0:${port}`);
    console.log(`[query-server] POST /query`);
  });
}

main().catch((error) => {
  console.error(`[query-server] Fatal error: ${error.message}`);
  process.exit(1);
});
