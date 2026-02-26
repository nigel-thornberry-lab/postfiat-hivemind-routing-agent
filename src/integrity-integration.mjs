function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseCsv(value) {
  return toString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getSybilPenaltyMultiplier(sybilRisk, sybilScore) {
  const risk = toString(sybilRisk).toLowerCase();
  if (risk === "high risk") return 0.35;
  if (risk === "elevated") return 0.6;
  if (risk === "moderate") return 0.85;
  if (risk === "low risk") return 1.0;

  const score = toNumberOrNull(sybilScore);
  if (score === null) return 0.9;
  if (score < 40) return 0.45;
  if (score < 60) return 0.7;
  if (score < 75) return 0.85;
  return 1.0;
}

export function buildIntegrityContext({
  operatorProfiles = [],
  rawIntegrityPayload = null,
  env = process.env,
} = {}) {
  const payload = rawIntegrityPayload || {};
  const circuit = payload.circuit_breaker || payload.circuitBreaker || {};
  const flagged = payload.flagged || payload.flags || {};

  const blockedOperatorIds = new Set([
    ...asArray(circuit.blocked_operator_ids),
    ...asArray(circuit.blockedOperatorIds),
    ...asArray(flagged.blocked_operator_ids),
    ...asArray(flagged.blockedOperatorIds),
    ...parseCsv(env.PFT_INTEGRITY_BLOCKED_OPERATOR_IDS),
  ]);

  const blockedWalletAddresses = new Set([
    ...asArray(circuit.blocked_wallet_addresses),
    ...asArray(circuit.blockedWalletAddresses),
    ...asArray(flagged.blocked_wallet_addresses),
    ...asArray(flagged.blockedWalletAddresses),
    ...parseCsv(env.PFT_INTEGRITY_BLOCKED_WALLETS),
  ]);

  const unauthorizedOperatorIds = new Set([
    ...asArray(payload.unauthorized_operator_ids),
    ...asArray(payload.unauthorizedOperatorIds),
    ...asArray(flagged.unauthorized_operator_ids),
    ...asArray(flagged.unauthorizedOperatorIds),
    ...parseCsv(env.PFT_INTEGRITY_UNAUTHORIZED_OPERATOR_IDS),
  ]);

  const sybilSnapshot = operatorProfiles.map((operator) => ({
    operator_id: operator.operator_id,
    wallet_address: operator.wallet_address,
    sybil_score: operator.sybil_score,
    sybil_risk: operator.sybil_risk,
    sybil_penalty_multiplier: getSybilPenaltyMultiplier(
      operator.sybil_risk,
      operator.sybil_score
    ),
  }));

  return {
    source: payload ? "live+env" : "env",
    fetched_at: new Date().toISOString(),
    circuit_breaker: {
      open: Boolean(circuit.open || circuit.is_open || false),
      threshold: toNumberOrNull(circuit.threshold ?? circuit.trip_threshold),
      blocked_operator_ids: [...blockedOperatorIds],
      blocked_wallet_addresses: [...blockedWalletAddresses],
      reason: toString(circuit.reason || ""),
    },
    unauthorized_operator_ids: [...unauthorizedOperatorIds],
    sybil_snapshot: sybilSnapshot,
  };
}

export async function fetchLiveIntegrityContext(client, operatorProfiles = []) {
  let payload = null;
  try {
    payload = await client.getRoutingIntegrityStatus();
  } catch {
    payload = null;
  }
  return buildIntegrityContext({ operatorProfiles, rawIntegrityPayload: payload });
}
