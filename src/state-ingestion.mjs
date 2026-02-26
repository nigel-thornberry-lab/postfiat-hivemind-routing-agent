import {
  OPERATOR_PROFILE_FIELDS,
  NETWORK_TASK_FIELDS,
  MATCH_RESULT_FIELDS,
} from "./schema-summary.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonPayload(rawPayload) {
  if (typeof rawPayload === "string") {
    return JSON.parse(rawPayload);
  }
  return rawPayload;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function normalizeExpertKnowledge(value) {
  return asArray(value).map((entry) => {
    if (typeof entry === "string") {
      return { domain: entry, confidence: null };
    }
    return {
      domain: toStringOrNull(entry?.domain),
      confidence: toStringOrNull(entry?.confidence),
    };
  });
}

function normalizeCapabilities(value) {
  return asArray(value)
    .map((capability) => toStringOrNull(capability))
    .filter(Boolean);
}

function mapRawOperatorPayload(rawOperator) {
  const src = isObject(rawOperator?.profile) ? rawOperator.profile : rawOperator;
  const sybil = isObject(src?.sybil_score) ? src.sybil_score : {};
  const alignment = isObject(src?.alignment) ? src.alignment : {};

  return {
    operator_id: toStringOrNull(src?.operator_id ?? src?.user_id ?? src?.id),
    wallet_address: toStringOrNull(src?.wallet_address ?? src?.address),
    wallet_label: toStringOrNull(src?.wallet_label ?? src?.label),
    summary: toStringOrNull(src?.summary),
    capabilities: normalizeCapabilities(src?.capabilities),
    expert_knowledge: normalizeExpertKnowledge(src?.expert_knowledge),
    sybil_score: toIntOrNull(src?.sybil_score ?? sybil?.sybil_score),
    sybil_risk: toStringOrNull(src?.sybil_risk ?? sybil?.sybil_risk),
    linked_accounts: asArray(src?.linked_accounts ?? sybil?.linked_accounts)
      .map((item) => toStringOrNull(item))
      .filter(Boolean),
    alignment_score: toIntOrNull(src?.alignment_score ?? alignment?.alignment_score),
    alignment_tier: toStringOrNull(src?.alignment_tier ?? alignment?.alignment_tier),
    weekly_tasks: toIntOrNull(src?.weekly_tasks ?? alignment?.weekly_counts?.total) ?? 0,
    monthly_tasks: toIntOrNull(src?.monthly_tasks ?? alignment?.monthly_counts?.total) ?? 0,
    weekly_rewards: toNumberOrNull(src?.weekly_rewards ?? alignment?.weekly_rewards_total) ?? 0,
    monthly_rewards:
      toNumberOrNull(src?.monthly_rewards ?? alignment?.monthly_rewards_total) ?? 0,
    leaderboard_score_week: toIntOrNull(src?.leaderboard_score_week),
    leaderboard_score_month: toIntOrNull(src?.leaderboard_score_month),
    is_public: toBoolean(src?.is_public, false),
    is_published: toBoolean(src?.is_published, false),
    published_at: toStringOrNull(src?.published_at),
    nft_image_url: toStringOrNull(src?.nft_image_url),
    avatar_image_url: toStringOrNull(src?.avatar_image_url ?? src?.avatar?.image_url),
  };
}

function mapRawTaskPayload(rawTask, statusHint = null) {
  const src = isObject(rawTask?.task) ? rawTask.task : rawTask;
  return {
    task_id: toStringOrNull(src?.task_id ?? src?.id),
    title: toStringOrNull(src?.title),
    type: toStringOrNull(src?.type),
    status: toStringOrNull(src?.status ?? statusHint),
    requirements: toStringOrNull(src?.requirements ?? src?.description),
    verification_ask: toStringOrNull(src?.verification_ask ?? src?.verificationAsk),
    verification_status: toStringOrNull(
      src?.verification_status ?? src?.verificationStatus
    ),
    pft_offer: toNumberOrNull(src?.pft_offer ?? src?.pft),
    reward_tier: toStringOrNull(src?.reward_tier ?? src?.rewardTier),
    reward_score: toIntOrNull(src?.reward_score ?? src?.rewardScore),
    reward_summary: toStringOrNull(src?.reward_summary ?? src?.rewardSummary),
    created_at_ms: toIntOrNull(src?.created_at_ms ?? src?.createdAt),
    accepted_at_ms: toIntOrNull(src?.accepted_at_ms ?? src?.acceptedAt),
    submitted_at_ms: toIntOrNull(src?.submitted_at_ms ?? src?.submittedAt),
    rewarded_at_ms: toIntOrNull(src?.rewarded_at_ms ?? src?.rewardedAt),
    submission_id: toStringOrNull(src?.submission_id ?? src?.submissionId),
    tx_hash: toStringOrNull(src?.tx_hash ?? src?.txHash),
    refusal_category: toStringOrNull(src?.refusal_category ?? src?.refusalCategory),
    reason: toStringOrNull(src?.reason),
  };
}

function validateObjectShape(objectName, value, fieldList, requiredCoreFields) {
  const errors = [];
  if (!isObject(value)) {
    return {
      valid: false,
      errors: [`${objectName} must be an object.`],
    };
  }

  const allowed = new Set(fieldList);
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    errors.push(`${objectName} has unexpected keys: ${unexpected.join(", ")}`);
  }

  for (const field of fieldList) {
    if (!(field in value)) {
      errors.push(`${objectName} is missing field: ${field}`);
    }
  }

  for (const requiredField of requiredCoreFields) {
    const requiredValue = value[requiredField];
    if (
      requiredValue === null ||
      requiredValue === undefined ||
      (typeof requiredValue === "string" && requiredValue.trim() === "")
    ) {
      errors.push(`${objectName} required field is empty: ${requiredField}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateOperatorProfile(operatorProfile) {
  return validateObjectShape(
    "OperatorProfile",
    operatorProfile,
    OPERATOR_PROFILE_FIELDS,
    ["operator_id", "wallet_address", "expert_knowledge", "sybil_score", "alignment_score"]
  );
}

function validateNetworkTask(networkTask) {
  return validateObjectShape(
    "NetworkTask",
    networkTask,
    NETWORK_TASK_FIELDS,
    ["task_id", "title", "type", "status", "requirements", "pft_offer"]
  );
}

function validateMatchResult(matchResult) {
  return validateObjectShape(
    "MatchResult",
    matchResult,
    MATCH_RESULT_FIELDS,
    ["match_id", "task", "operator", "scores", "confidence", "routing_decision"]
  );
}

function assertValid(result, contextLabel) {
  if (!result.valid) {
    throw new Error(`${contextLabel} validation failed: ${result.errors.join(" | ")}`);
  }
}

function extractOperatorCandidates(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.operator_profiles)) return payload.operator_profiles;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (isObject(payload?.profile)) return [payload.profile];
  if (isObject(payload?.operator)) return [payload.operator];
  if (isObject(payload?.data?.operator)) return [payload.data.operator];
  if (Array.isArray(payload?.data?.operators)) return payload.data.operators;
  if (isObject(payload)) return [payload];
  return [];
}

function extractTaskCandidates(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.network_tasks)) return payload.network_tasks;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (isObject(payload?.tasks)) {
    return Object.values(payload.tasks).flatMap((group) => asArray(group));
  }
  if (isObject(payload?.task)) return [payload.task];
  if (isObject(payload?.data?.task)) return [payload.data.task];
  if (Array.isArray(payload?.data?.tasks)) return payload.data.tasks;
  if (isObject(payload)) return [payload];
  return [];
}

export function ingestOperatorProfiles(rawPayload) {
  const payload = parseJsonPayload(rawPayload);
  const mapped = extractOperatorCandidates(payload).map(mapRawOperatorPayload);

  mapped.forEach((operator, index) => {
    assertValid(validateOperatorProfile(operator), `OperatorProfile[${index}]`);
  });

  return mapped;
}

export function ingestNetworkTasks(rawPayload, { statusHint = null } = {}) {
  const payload = parseJsonPayload(rawPayload);
  const mapped = extractTaskCandidates(payload).map((task) =>
    mapRawTaskPayload(task, statusHint)
  );

  mapped.forEach((task, index) => {
    assertValid(validateNetworkTask(task), `NetworkTask[${index}]`);
  });

  return mapped;
}

export function validateMappedMatchResults(matchResults) {
  asArray(matchResults).forEach((matchResult, index) => {
    assertValid(validateMatchResult(matchResult), `MatchResult[${index}]`);
  });
}

export const StateIngestion = {
  ingestOperatorProfiles,
  ingestNetworkTasks,
  validateMappedMatchResults,
  validateOperatorProfile,
  validateNetworkTask,
  validateMatchResult,
};
