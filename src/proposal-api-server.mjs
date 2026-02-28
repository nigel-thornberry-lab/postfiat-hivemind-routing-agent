#!/usr/bin/env node
import http from "node:http";
import { createProposalServiceFromEnv } from "./proposal-service.mjs";

const DEFAULT_PORT = 8791;

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

function parsePath(urlPath) {
  const clean = String(urlPath || "").split("?")[0];
  const matchAccept = clean.match(/^\/proposals\/([^/]+)\/accept$/);
  if (matchAccept) return { route: "accept", proposalId: decodeURIComponent(matchAccept[1]) };
  const matchDecline = clean.match(/^\/proposals\/([^/]+)\/decline$/);
  if (matchDecline) return { route: "decline", proposalId: decodeURIComponent(matchDecline[1]) };
  const matchGet = clean.match(/^\/proposals\/([^/]+)$/);
  if (matchGet) return { route: "get", proposalId: decodeURIComponent(matchGet[1]) };
  if (clean === "/proposals") return { route: "create" };
  if (clean === "/health") return { route: "health" };
  return { route: "unknown" };
}

function errorStatus(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  if (code === "NOT_FOUND" || message.includes("not found")) return 404;
  if (code === "NO_MATCH") return 409;
  if (
    message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("mismatch") ||
    message.includes("Unknown") ||
    message.includes("Cannot transition")
  ) {
    return 400;
  }
  return 500;
}

async function main() {
  const service = createProposalServiceFromEnv();
  const port = Number(process.env.PFT_PROPOSAL_API_PORT || DEFAULT_PORT);

  const server = http.createServer(async (req, res) => {
    const { route, proposalId } = parsePath(req.url);

    try {
      if (req.method === "GET" && route === "health") {
        return sendJson(res, 200, {
          ok: true,
          service: "proposal-api",
          status: "ready",
        });
      }

      if (req.method === "POST" && route === "create") {
        const payload = await parseBody(req);
        const result = await service.createProposalFromQuery(payload);
        return sendJson(res, 201, { ok: true, ...result });
      }

      if (req.method === "POST" && route === "accept") {
        const payload = await parseBody(req);
        const result = service.acceptProposal(proposalId, payload);
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (req.method === "POST" && route === "decline") {
        const payload = await parseBody(req);
        const result = service.declineProposal(proposalId, payload);
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (req.method === "GET" && route === "get") {
        const result = service.getProposal(proposalId);
        return sendJson(res, 200, { ok: true, ...result });
      }

      return sendJson(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      return sendJson(res, errorStatus(error), { ok: false, error: String(error.message || error) });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[proposal-api] listening on http://0.0.0.0:${port}`);
    console.log(`[proposal-api] POST /proposals`);
    console.log(`[proposal-api] POST /proposals/:id/accept`);
    console.log(`[proposal-api] POST /proposals/:id/decline`);
    console.log(`[proposal-api] GET /proposals/:id`);
  });
}

main().catch((error) => {
  console.error(`[proposal-api] Fatal error: ${error.message}`);
  process.exit(1);
});
