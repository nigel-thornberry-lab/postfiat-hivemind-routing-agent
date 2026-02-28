import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  applyHandshakeEvent,
  buildHandshakeState,
  createHandshakeStore,
  hashProposalPayload,
} from "./double-opt-in.mjs";
import { runOnDemandQuery } from "./on-demand-query.mjs";
import { createTelemetryEmitterFromEnv } from "./telemetry.mjs";

function toString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePem(value) {
  const raw = toString(value).trim();
  if (!raw) return "";
  if (raw.startsWith("base64:")) {
    const decoded = Buffer.from(raw.slice("base64:".length), "base64").toString("utf8");
    return decoded;
  }
  return raw.replace(/\\n/g, "\n");
}

function emptyPersistentStore() {
  return {
    schema_version: "1.0",
    updated_at: new Date().toISOString(),
    proposals: {},
    events: [],
  };
}

export function loadPersistentProposalStore(filePath) {
  if (!fs.existsSync(filePath)) return emptyPersistentStore();
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...emptyPersistentStore(),
    ...parsed,
    proposals: parsed?.proposals && typeof parsed.proposals === "object" ? parsed.proposals : {},
    events: Array.isArray(parsed?.events) ? parsed.events : [],
  };
}

export function savePersistentProposalStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

export function persistentToHandshakeStore(persistent) {
  const handshake = createHandshakeStore();
  handshake.proposals = { ...persistent.proposals };
  handshake.event_ids = new Set();
  handshake.consumed_nonces = new Set();
  handshake.events_by_proposal = {};

  for (const proposal of Object.values(handshake.proposals)) {
    if (proposal?.nonce) handshake.consumed_nonces.add(proposal.nonce);
  }
  for (const event of persistent.events) {
    const proposalId = toString(event?.proposal_id);
    if (!proposalId) continue;
    if (!handshake.events_by_proposal[proposalId]) handshake.events_by_proposal[proposalId] = [];
    handshake.events_by_proposal[proposalId].push(event);
    if (event?.event_id) handshake.event_ids.add(event.event_id);
  }
  return handshake;
}

export function handshakeToPersistentStore(handshake, previous = emptyPersistentStore()) {
  const events = Object.values(handshake.events_by_proposal)
    .flatMap((arr) => arr)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  return {
    ...previous,
    updated_at: new Date().toISOString(),
    proposals: { ...handshake.proposals },
    events,
  };
}

function formatProposalView(proposal, events) {
  const state = buildHandshakeState(events, proposal);
  return {
    proposal,
    proposal_hash: hashProposalPayload(proposal),
    state,
    events: [...events].sort(
      (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    ),
  };
}

function isTerminalStatus(status) {
  return ["locked", "declined", "expired"].includes(toString(status));
}

export class ProposalService {
  constructor({
    storePath,
    queryRunner = runOnDemandQuery,
    telemetry = null,
    actorPublicKeys = {},
    requireRegisteredKeys = false,
    clockSkewMs = 5000,
    lockTimeoutMs = 5000,
    lockPollMs = 50,
    lockStaleMs = 30000,
  } = {}) {
    if (!storePath) throw new Error("storePath is required");
    this.storePath = storePath;
    this.lockPath = `${storePath}.lock`;
    this.queryRunner = queryRunner;
    this.telemetry = telemetry || createTelemetryEmitterFromEnv();
    this.actorPublicKeys = { ...actorPublicKeys };
    this.requireRegisteredKeys = Boolean(requireRegisteredKeys);
    this.clockSkewMs = Math.max(0, Number(clockSkewMs) || 0);
    this.lockTimeoutMs = Math.max(500, Number(lockTimeoutMs) || 5000);
    this.lockPollMs = Math.max(10, Number(lockPollMs) || 50);
    this.lockStaleMs = Math.max(1000, Number(lockStaleMs) || 30000);
  }

  load() {
    return loadPersistentProposalStore(this.storePath);
  }

  save(store) {
    savePersistentProposalStore(this.storePath, store);
  }

  emitLifecycle(eventType, payload = {}) {
    this.telemetry?.emit({
      event_type: eventType,
      severity: "info",
      payload,
    });
  }

  async withStoreLock(fn) {
    const start = Date.now();
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    while (true) {
      try {
        const fd = fs.openSync(this.lockPath, "wx");
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
        try {
          return await fn();
        } finally {
          try {
            fs.closeSync(fd);
          } catch {
            // no-op
          }
          try {
            fs.unlinkSync(this.lockPath);
          } catch {
            // no-op
          }
        }
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const stat = fs.statSync(this.lockPath);
          if (Date.now() - stat.mtimeMs > this.lockStaleMs) {
            fs.unlinkSync(this.lockPath);
            continue;
          }
        } catch {
          // lock might have been released between checks
          continue;
        }

        if (Date.now() - start > this.lockTimeoutMs) {
          throw new Error("Timed out waiting for proposal store lock.");
        }
        await sleep(this.lockPollMs);
      }
    }
  }

  createProposalPayload({ requesterId, operatorMatch, queryResult, expiresInSeconds, nonce, proposalId }) {
    const ttl = Math.max(60, Math.min(60 * 60 * 24 * 7, toNumber(expiresInSeconds, 3600) || 3600));
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    return {
      proposal_id: toString(proposalId || randomUUID()),
      task_id: toString(queryResult.task.task_id),
      requester_id: toString(requesterId),
      operator_id: toString(operatorMatch.operator_id),
      match_snapshot: {
        confidence: operatorMatch.confidence,
        overall_match_score: operatorMatch.overall_match_score,
        matched_expert_domains: operatorMatch.matched_expert_domains,
        reasoning: operatorMatch.reasoning,
        query_request_id: queryResult.request_id,
        candidates_considered: queryResult.candidates_considered,
      },
      expires_at: expiresAt,
      nonce: toString(nonce || randomUUID()),
    };
  }

  async createProposalFromQuery(input) {
    const body = asObject(input);
    const requesterId = toString(body.requester_id).trim();
    if (!requesterId) throw new Error("requester_id is required");
    const query = asObject(body.query);
    if (!query.user_request_text) throw new Error("query.user_request_text is required");

    const queryResult = await this.queryRunner(query, body.query_options || {});
    if (!queryResult?.top_matches?.length) {
      const error = new Error("No eligible operators matched query constraints.");
      error.code = "NO_MATCH";
      throw error;
    }

    const selectedOperatorId = toString(body.operator_id).trim();
    const operatorMatch =
      queryResult.top_matches.find((item) => item.operator_id === selectedOperatorId) ||
      queryResult.top_matches[0];

    if (!operatorMatch) {
      const error = new Error("Selected operator_id not found in query top_matches.");
      error.code = "INVALID_OPERATOR_SELECTION";
      throw error;
    }

    const proposal = this.createProposalPayload({
      requesterId,
      operatorMatch,
      queryResult,
      expiresInSeconds: body.expires_in_seconds,
      nonce: body.nonce,
      proposalId: body.proposal_id,
    });

    const resultView = await this.withStoreLock(async () => {
      const persistent = this.load();
      const handshake = persistentToHandshakeStore(persistent);
      const proposedEvent = {
        event_id: toString(body.event_id || randomUUID()),
        proposal_id: proposal.proposal_id,
        type: "proposal.proposed",
        actor_id: "system",
        occurred_at: new Date().toISOString(),
        payload: { proposal },
      };
      const result = applyHandshakeEvent(handshake, proposedEvent, {
        allowedClockSkewMs: this.clockSkewMs,
      });
      const nextPersistent = handshakeToPersistentStore(handshake, persistent);
      this.save(nextPersistent);
      const events = handshake.events_by_proposal[proposal.proposal_id] || [];
      return {
        result,
        view: formatProposalView(proposal, events),
      };
    });

    this.emitLifecycle("proposal.created", {
      proposal_id: proposal.proposal_id,
      requester_id: proposal.requester_id,
      operator_id: proposal.operator_id,
      task_id: proposal.task_id,
      status: resultView.result.state.status,
    });

    return resultView.view;
  }

  async applyTransition(proposalId, event) {
    const id = toString(proposalId).trim();
    if (!id) throw new Error("proposal id is required");

    const wrapped = await this.withStoreLock(async () => {
      const persistent = this.load();
      const handshake = persistentToHandshakeStore(persistent);
      const proposal = handshake.proposals[id];
      if (!proposal) {
        const error = new Error("Proposal not found.");
        error.code = "NOT_FOUND";
        throw error;
      }
      const events = handshake.events_by_proposal[id] || [];
      const state = buildHandshakeState(events, proposal);
      if (isTerminalStatus(state.status) && event.type !== "proposal.expired") {
        throw new Error(`Cannot transition terminal proposal state: ${state.status}`);
      }

      const result = applyHandshakeEvent(
        handshake,
        {
          ...event,
          proposal_id: id,
          event_id: toString(event.event_id || randomUUID()),
          occurred_at: event.occurred_at || new Date().toISOString(),
        },
        { allowedClockSkewMs: this.clockSkewMs }
      );
      const nextPersistent = handshakeToPersistentStore(handshake, persistent);
      this.save(nextPersistent);
      const proposalEvents = handshake.events_by_proposal[id] || [];
      return {
        result,
        view: formatProposalView(proposal, proposalEvents),
      };
    });

    this.emitLifecycle("proposal.lifecycle_event", {
      proposal_id: id,
      type: event.type,
      actor_id: event.actor_id || null,
      status: wrapped.result.state?.status || null,
      idempotent: Boolean(wrapped.result.idempotent),
    });

    return wrapped.view;
  }

  async acceptProposal(proposalId, input) {
    const body = asObject(input);
    const actorId = toString(body.actor_id).trim();
    if (!actorId) throw new Error("actor_id is required");

    const persistent = this.load();
    const handshake = persistentToHandshakeStore(persistent);
    const proposal = handshake.proposals[toString(proposalId)];
    if (!proposal) {
      const error = new Error("Proposal not found.");
      error.code = "NOT_FOUND";
      throw error;
    }
    const type =
      actorId === proposal.requester_id
        ? "proposal.requester_accepted"
        : actorId === proposal.operator_id
          ? "proposal.operator_accepted"
          : null;
    if (!type) throw new Error("actor_id must match requester_id or operator_id");

    const registeredPublicKey = normalizePem(this.actorPublicKeys[actorId] || "");
    if (this.requireRegisteredKeys && !registeredPublicKey) {
      throw new Error("Actor does not have a registered public key.");
    }
    const publicKey = registeredPublicKey || normalizePem(body.public_key);
    if (!publicKey) {
      throw new Error("public_key is required.");
    }

    return this.applyTransition(proposalId, {
      type,
      actor_id: actorId,
      payload: {
        proposal_hash: toString(body.proposal_hash),
        signature: toString(body.signature),
        public_key: publicKey,
      },
    });
  }

  async declineProposal(proposalId, input) {
    const body = asObject(input);
    const actorId = toString(body.actor_id).trim();
    if (!actorId) throw new Error("actor_id is required");
    return this.applyTransition(proposalId, {
      type: "proposal.declined",
      actor_id: actorId,
      payload: {
        reason: toString(body.reason || ""),
      },
    });
  }

  async getProposal(proposalId) {
    const id = toString(proposalId).trim();
    const wrapped = await this.withStoreLock(async () => {
      const persistent = this.load();
      const handshake = persistentToHandshakeStore(persistent);
      const proposal = handshake.proposals[id];
      if (!proposal) {
        const error = new Error("Proposal not found.");
        error.code = "NOT_FOUND";
        throw error;
      }

      let events = handshake.events_by_proposal[id] || [];
      let state = buildHandshakeState(events, proposal);
      if (
        !isTerminalStatus(state.status) &&
        Date.now() - this.clockSkewMs > new Date(proposal.expires_at).getTime()
      ) {
        const result = applyHandshakeEvent(
          handshake,
          {
            event_id: randomUUID(),
            proposal_id: id,
            type: "proposal.expired",
            actor_id: "system",
            occurred_at: new Date().toISOString(),
            payload: {},
          },
          { allowedClockSkewMs: this.clockSkewMs }
        );
        const nextPersistent = handshakeToPersistentStore(handshake, persistent);
        this.save(nextPersistent);
        events = handshake.events_by_proposal[id] || [];
        state = result.state || buildHandshakeState(events, proposal);
        this.emitLifecycle("proposal.lifecycle_event", {
          proposal_id: id,
          type: "proposal.expired",
          actor_id: "system",
          status: state.status,
        });
      }

      return {
        proposal,
        proposal_hash: hashProposalPayload(proposal),
        state,
        events: [...events].sort(
          (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
        ),
      };
    });
    return wrapped;
  }

  async scanStuckProposals({ stuckAfterMs = 10 * 60 * 1000, expiringWithinMs = 2 * 60 * 1000 } = {}) {
    const persistent = this.load();
    const handshake = persistentToHandshakeStore(persistent);
    const now = Date.now();
    const alerts = [];

    for (const [proposalId, proposal] of Object.entries(handshake.proposals)) {
      const events = handshake.events_by_proposal[proposalId] || [];
      if (!events.length) continue;
      const state = buildHandshakeState(events, proposal);
      if (isTerminalStatus(state.status)) continue;

      const lastEventTs = new Date(state.last_event_at || events[events.length - 1].occurred_at).getTime();
      const expiresTs = new Date(proposal.expires_at).getTime();
      const stale = now - lastEventTs > stuckAfterMs;
      const expiring = expiresTs - now <= expiringWithinMs;
      if (!stale && !expiring) continue;

      const alert = {
        proposal_id: proposalId,
        status: state.status,
        requester_id: proposal.requester_id,
        operator_id: proposal.operator_id,
        expires_at: proposal.expires_at,
        last_event_at: state.last_event_at,
        stale,
        expiring_soon: expiring,
      };
      alerts.push(alert);
      this.telemetry?.emit({
        event_type: stale ? "proposal.stuck_detected" : "proposal.timeout_warning",
        severity: stale ? "warn" : "info",
        payload: alert,
      });
    }

    return {
      ok: true,
      generated_at: new Date().toISOString(),
      alert_count: alerts.length,
      alerts,
    };
  }
}

export function createProposalServiceFromEnv(options = {}) {
  const storePath =
    options.storePath ||
    process.env.PFT_PROPOSAL_STORE_PATH ||
    path.resolve(process.cwd(), "data", "proposal-events.json");
  const actorPublicKeys = asObject(options.actorPublicKeys || {});
  const envActorKeys = asObject(
    process.env.PFT_PROPOSAL_ACTOR_PUBLIC_KEYS
      ? JSON.parse(process.env.PFT_PROPOSAL_ACTOR_PUBLIC_KEYS)
      : {}
  );
  const mergedActorKeys = { ...envActorKeys, ...actorPublicKeys };

  return new ProposalService({
    storePath,
    queryRunner: options.queryRunner || runOnDemandQuery,
    telemetry: options.telemetry || createTelemetryEmitterFromEnv(),
    actorPublicKeys: mergedActorKeys,
    requireRegisteredKeys:
      options.requireRegisteredKeys ??
      String(process.env.PFT_PROPOSAL_REQUIRE_REGISTERED_KEYS || "").toLowerCase() === "true",
    clockSkewMs:
      options.clockSkewMs ??
      Math.max(0, Number(process.env.PFT_PROPOSAL_CLOCK_SKEW_MS || 5000)),
    lockTimeoutMs:
      options.lockTimeoutMs ??
      Math.max(500, Number(process.env.PFT_PROPOSAL_LOCK_TIMEOUT_MS || 5000)),
    lockPollMs:
      options.lockPollMs ??
      Math.max(10, Number(process.env.PFT_PROPOSAL_LOCK_POLL_MS || 50)),
    lockStaleMs:
      options.lockStaleMs ??
      Math.max(1000, Number(process.env.PFT_PROPOSAL_LOCK_STALE_MS || 30000)),
  });
}
