import { createHash, sign, verify, timingSafeEqual } from "node:crypto";

const ALLOWED_STATUSES = new Set([
  "proposed",
  "requester_accepted",
  "operator_accepted",
  "locked",
  "expired",
  "declined",
]);

function toString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toIso(value) {
  const asString = toString(value).trim();
  if (!asString) return null;
  const date = new Date(asString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function canonicalizeValue(value) {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(value[key])}`)
      .join(",")}}`;
  }
  return "null";
}

export function normalizeProposalPayload(input) {
  const payload = asObject(input);
  const normalized = {
    proposal_id: toString(payload.proposal_id).trim(),
    task_id: toString(payload.task_id).trim(),
    requester_id: toString(payload.requester_id).trim(),
    operator_id: toString(payload.operator_id).trim(),
    match_snapshot: asObject(payload.match_snapshot),
    expires_at: toIso(payload.expires_at),
    nonce: toString(payload.nonce).trim(),
  };
  return normalized;
}

export function validateProposalPayload(input) {
  const payload = normalizeProposalPayload(input);
  const errors = [];

  if (!payload.proposal_id) errors.push("proposal_id is required");
  if (!payload.task_id) errors.push("task_id is required");
  if (!payload.requester_id) errors.push("requester_id is required");
  if (!payload.operator_id) errors.push("operator_id is required");
  if (!payload.nonce) errors.push("nonce is required");
  if (!payload.expires_at) errors.push("expires_at must be a valid ISO timestamp");
  if (Object.keys(payload.match_snapshot).length === 0) {
    errors.push("match_snapshot is required");
  }

  return { valid: errors.length === 0, errors, payload };
}

export function canonicalizeProposalPayload(input) {
  const { valid, errors, payload } = validateProposalPayload(input);
  if (!valid) {
    throw new Error(`Invalid proposal payload: ${errors.join("; ")}`);
  }
  return canonicalizeValue(payload);
}

export function hashProposalPayload(input) {
  const canonical = canonicalizeProposalPayload(input);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function signProposalHash(proposalHashHex, privateKeyPem) {
  const digest = Buffer.from(proposalHashHex, "hex");
  const signature = sign(null, digest, privateKeyPem);
  return signature.toString("base64");
}

export function verifyProposalHashSignature(proposalHashHex, signatureBase64, publicKeyPem) {
  try {
    const digest = Buffer.from(proposalHashHex, "hex");
    const signature = Buffer.from(signatureBase64, "base64");
    return verify(null, digest, publicKeyPem, signature);
  } catch {
    return false;
  }
}

function emptyState(proposal) {
  return {
    proposal,
    status: "proposed",
    requester_signed: false,
    operator_signed: false,
    locked_at: null,
    declined_by: null,
    decline_reason: null,
    last_event_at: null,
  };
}

export function buildHandshakeState(events, proposal) {
  const state = emptyState(proposal);
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );

  for (const event of sorted) {
    const type = event.type;
    if (type === "proposal.proposed") {
      state.status = "proposed";
    } else if (type === "proposal.requester_accepted") {
      state.requester_signed = true;
      state.status = state.operator_signed ? "locked" : "requester_accepted";
    } else if (type === "proposal.operator_accepted") {
      state.operator_signed = true;
      state.status = state.requester_signed ? "locked" : "operator_accepted";
    } else if (type === "proposal.locked") {
      state.status = "locked";
      state.locked_at = event.occurred_at;
    } else if (type === "proposal.expired") {
      state.status = "expired";
    } else if (type === "proposal.declined") {
      state.status = "declined";
      state.declined_by = toString(event.actor_id || "");
      state.decline_reason = toString(event.payload?.reason || "");
    }
    state.last_event_at = event.occurred_at;
  }

  if (state.requester_signed && state.operator_signed && state.status !== "declined") {
    state.status = "locked";
  }
  return state;
}

export function createHandshakeStore() {
  return {
    proposals: {},
    events_by_proposal: {},
    event_ids: new Set(),
    consumed_nonces: new Set(),
  };
}

function assertValidStatus(status) {
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`Unknown status: ${status}`);
  }
}

function assertNotExpired(proposal, nowIso) {
  if (!proposal?.expires_at) {
    throw new Error("Proposal missing expires_at.");
  }
  const now = new Date(nowIso).getTime();
  const exp = new Date(proposal.expires_at).getTime();
  if (now > exp) {
    throw new Error("Proposal is expired.");
  }
}

function proposalHashEquals(aHex, bHex) {
  try {
    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function allowedNextEventTypes(state) {
  if (state.status === "locked" || state.status === "declined" || state.status === "expired") {
    return [];
  }
  return [
    "proposal.requester_accepted",
    "proposal.operator_accepted",
    "proposal.declined",
    "proposal.expired",
  ];
}

export function applyHandshakeEvent(store, event, options = {}) {
  const nowIso = toIso(options.now || new Date().toISOString()) || new Date().toISOString();
  const incoming = {
    event_id: toString(event?.event_id).trim(),
    proposal_id: toString(event?.proposal_id).trim(),
    type: toString(event?.type).trim(),
    actor_id: toString(event?.actor_id).trim() || null,
    occurred_at: toIso(event?.occurred_at) || nowIso,
    payload: asObject(event?.payload),
  };

  if (!incoming.event_id) throw new Error("event_id is required");
  if (!incoming.proposal_id) throw new Error("proposal_id is required");
  if (!incoming.type) throw new Error("type is required");

  if (store.event_ids.has(incoming.event_id)) {
    const proposal = store.proposals[incoming.proposal_id];
    const events = store.events_by_proposal[incoming.proposal_id] || [];
    return {
      idempotent: true,
      event: incoming,
      state: proposal ? buildHandshakeState(events, proposal) : null,
    };
  }

  if (incoming.type === "proposal.proposed") {
    const proposedPayload = incoming.payload?.proposal;
    const { valid, errors, payload } = validateProposalPayload(proposedPayload);
    if (!valid) throw new Error(`Invalid proposal payload: ${errors.join("; ")}`);

    if (store.proposals[payload.proposal_id]) {
      throw new Error("Proposal already exists.");
    }
    if (store.consumed_nonces.has(payload.nonce)) {
      throw new Error("Nonce already used (replay blocked).");
    }

    store.proposals[payload.proposal_id] = payload;
    store.events_by_proposal[payload.proposal_id] = [incoming];
    store.event_ids.add(incoming.event_id);
    store.consumed_nonces.add(payload.nonce);

    return {
      idempotent: false,
      event: incoming,
      state: buildHandshakeState(store.events_by_proposal[payload.proposal_id], payload),
    };
  }

  const proposal = store.proposals[incoming.proposal_id];
  if (!proposal) {
    throw new Error("Unknown proposal_id.");
  }
  const existingEvents = store.events_by_proposal[incoming.proposal_id] || [];
  const state = buildHandshakeState(existingEvents, proposal);
  assertValidStatus(state.status);

  const allowed = allowedNextEventTypes(state);
  if (!allowed.includes(incoming.type)) {
    throw new Error(`Event ${incoming.type} not allowed from status ${state.status}.`);
  }

  if (incoming.type === "proposal.expired") {
    const exp = new Date(proposal.expires_at).getTime();
    const now = new Date(nowIso).getTime();
    if (now < exp) throw new Error("Proposal has not expired yet.");
  }

  if (incoming.type === "proposal.requester_accepted" || incoming.type === "proposal.operator_accepted") {
    assertNotExpired(proposal, nowIso);

    const signerType =
      incoming.type === "proposal.requester_accepted" ? "requester" : "operator";
    const expectedSignerId =
      signerType === "requester" ? proposal.requester_id : proposal.operator_id;
    if (incoming.actor_id !== expectedSignerId) {
      throw new Error(`Actor mismatch for ${signerType} acceptance.`);
    }

    const proposalHash = hashProposalPayload(proposal);
    const suppliedHash = toString(incoming.payload?.proposal_hash).trim();
    if (!proposalHashEquals(proposalHash, suppliedHash)) {
      throw new Error("proposal_hash mismatch.");
    }

    const signature = toString(incoming.payload?.signature).trim();
    const publicKey = toString(incoming.payload?.public_key).trim();
    if (!signature || !publicKey) {
      throw new Error("signature and public_key are required.");
    }
    const ok = verifyProposalHashSignature(proposalHash, signature, publicKey);
    if (!ok) throw new Error("Invalid cryptographic signature.");
  }

  if (incoming.type === "proposal.declined") {
    assertNotExpired(proposal, nowIso);
    if (![proposal.requester_id, proposal.operator_id].includes(toString(incoming.actor_id))) {
      throw new Error("Decline actor must be requester or operator.");
    }
  }

  store.events_by_proposal[incoming.proposal_id].push(incoming);
  store.event_ids.add(incoming.event_id);
  const nextState = buildHandshakeState(store.events_by_proposal[incoming.proposal_id], proposal);

  if (nextState.status === "locked") {
    const alreadyLocked = store.events_by_proposal[incoming.proposal_id].some(
      (evt) => evt.type === "proposal.locked"
    );
    if (!alreadyLocked) {
      const lockedEvent = {
        event_id: `lock-${incoming.event_id}`,
        proposal_id: incoming.proposal_id,
        type: "proposal.locked",
        actor_id: "system",
        occurred_at: nowIso,
        payload: {
          reason: "double_opt_in_complete",
        },
      };
      store.events_by_proposal[incoming.proposal_id].push(lockedEvent);
      store.event_ids.add(lockedEvent.event_id);
      return {
        idempotent: false,
        event: incoming,
        auto_events: [lockedEvent],
        state: buildHandshakeState(store.events_by_proposal[incoming.proposal_id], proposal),
      };
    }
  }

  return {
    idempotent: false,
    event: incoming,
    state: nextState,
  };
}
