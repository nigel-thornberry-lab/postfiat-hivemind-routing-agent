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
  if (clean === "/alerts/stuck") return { route: "alerts" };
  if (clean === "/health") return { route: "health" };
  return { route: "unknown" };
}

function parseAuthRegistry() {
  const raw = process.env.PFT_PROPOSAL_AUTH_TOKENS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("Invalid PFT_PROPOSAL_AUTH_TOKENS JSON.");
  }
}

function authenticateRequest(req, authRegistry) {
  const keys = Object.keys(authRegistry);
  if (!keys.length) return { actor_id: null, auth_enabled: false };
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    const error = new Error("Missing bearer token.");
    error.http_status = 401;
    throw error;
  }
  const token = header.slice("Bearer ".length).trim();
  const actorId = keys.find((candidate) => authRegistry[candidate] === token);
  if (!actorId) {
    const error = new Error("Unauthorized token.");
    error.http_status = 401;
    throw error;
  }
  return { actor_id: actorId, auth_enabled: true };
}

function assertActorBinding(auth, expectedActorId, { allowSystem = false } = {}) {
  if (!auth.auth_enabled) return;
  const actor = String(auth.actor_id || "");
  if (!actor) {
    const error = new Error("Authenticated actor is missing.");
    error.http_status = 401;
    throw error;
  }
  if (allowSystem && (actor === "system" || actor === "admin")) return;
  if (actor !== String(expectedActorId || "")) {
    const error = new Error("Authenticated actor does not match payload actor.");
    error.http_status = 403;
    throw error;
  }
}

function errorStatus(error) {
  if (Number(error?.http_status)) return Number(error.http_status);
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
  const authRegistry = parseAuthRegistry();
  const port = Number(process.env.PFT_PROPOSAL_API_PORT || DEFAULT_PORT);
  const alertIntervalMs = Math.max(0, Number(process.env.PFT_PROPOSAL_ALERT_INTERVAL_MS || 0));
  const stuckAfterMs = Math.max(1000, Number(process.env.PFT_PROPOSAL_STUCK_AFTER_MS || 600000));
  const expiringWithinMs = Math.max(
    1000,
    Number(process.env.PFT_PROPOSAL_EXPIRING_WITHIN_MS || 120000)
  );

  const server = http.createServer(async (req, res) => {
    const { route, proposalId } = parsePath(req.url);

    try {
      if (req.method === "GET" && route === "health") {
        const authEnabled = Object.keys(authRegistry).length > 0;
        return sendJson(res, 200, {
          ok: true,
          service: "proposal-api",
          status: "ready",
          auth_enabled: authEnabled,
        });
      }

      const auth = authenticateRequest(req, authRegistry);

      if (req.method === "POST" && route === "create") {
        const payload = await parseBody(req);
        assertActorBinding(auth, payload.requester_id, { allowSystem: true });
        const result = await service.createProposalFromQuery(payload);
        return sendJson(res, 201, { ok: true, ...result });
      }

      if (req.method === "POST" && route === "accept") {
        const payload = await parseBody(req);
        assertActorBinding(auth, payload.actor_id, { allowSystem: false });
        const result = await service.acceptProposal(proposalId, payload);
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (req.method === "POST" && route === "decline") {
        const payload = await parseBody(req);
        assertActorBinding(auth, payload.actor_id, { allowSystem: false });
        const result = await service.declineProposal(proposalId, payload);
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (req.method === "GET" && route === "alerts") {
        const result = await service.scanStuckProposals({ stuckAfterMs, expiringWithinMs });
        return sendJson(res, 200, result);
      }

      if (req.method === "GET" && route === "get") {
        const result = await service.getProposal(proposalId);
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
    console.log(`[proposal-api] GET /alerts/stuck`);
  });

  if (alertIntervalMs > 0) {
    setInterval(() => {
      service
        .scanStuckProposals({ stuckAfterMs, expiringWithinMs })
        .then((result) => {
          if (result.alert_count > 0) {
            console.warn(`[proposal-api] stuck/timeout alerts: ${result.alert_count}`);
          }
        })
        .catch((error) => {
          console.error(`[proposal-api] alert scan error: ${error.message}`);
        });
    }, alertIntervalMs).unref();
  }
}

main().catch((error) => {
  console.error(`[proposal-api] Fatal error: ${error.message}`);
  process.exit(1);
});
