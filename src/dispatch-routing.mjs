const DEFAULT_BASE_URL = "https://tasknode.postfiat.org";
const DEFAULT_DISPATCH_PATH = "/api/routing/dispatch";

export class DispatchError extends Error {
  constructor(message, { status = null, code = "DISPATCH_FAILED", retryable = false } = {}) {
    super(message);
    this.name = "DispatchError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function requireField(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    throw new DispatchError(`Missing required field: ${fieldName}`, {
      code: "INVALID_DISPATCH_PAYLOAD",
      retryable: false,
    });
  }
  return value;
}

export function formatDispatchPayload(matchResult, { assignmentSource = "hivemind-routing-agent" } = {}) {
  const taskId = requireField(matchResult?.task?.task_id, "task.task_id");
  const operatorId = requireField(matchResult?.operator?.operator_id, "operator.operator_id");
  const walletAddress = requireField(matchResult?.operator?.wallet_address, "operator.wallet_address");

  return {
    task_id: taskId,
    assignee: {
      operator_id: operatorId,
      wallet_address: walletAddress,
    },
    routing: {
      decision: toStringOrNull(matchResult?.routing_decision) ?? "assign",
      rank: matchResult?.rank ?? 1,
      confidence: toNumberOrNull(matchResult?.confidence),
      score: toNumberOrNull(matchResult?.scores?.overall_match_score),
      component_scores: {
        expertise: toNumberOrNull(matchResult?.scores?.expertise_score),
        alignment: toNumberOrNull(matchResult?.scores?.alignment_score_norm),
        sybil: toNumberOrNull(matchResult?.scores?.sybil_score_norm),
      },
    },
    context: {
      assignment_source: assignmentSource,
      generated_at: toStringOrNull(matchResult?.generated_at) ?? new Date().toISOString(),
      explanation: Array.isArray(matchResult?.explanation) ? matchResult.explanation : [],
      feature_snapshot: matchResult?.feature_snapshot ?? {},
      eligibility: matchResult?.eligibility ?? {},
    },
  };
}

export class DispatchRouter {
  constructor({
    jwt,
    baseUrl = DEFAULT_BASE_URL,
    dispatchPath = DEFAULT_DISPATCH_PATH,
    timeoutMs = 30000,
    dryRun = false,
    fetchImpl = fetch,
  } = {}) {
    if (!jwt) {
      throw new DispatchError("Missing JWT. Set PFT_TASKNODE_JWT.", {
        code: "MISSING_AUTH",
        retryable: false,
      });
    }
    this.jwt = jwt;
    this.baseUrl = new URL(baseUrl).toString();
    this.dispatchPath = dispatchPath;
    this.timeoutMs = timeoutMs;
    this.dryRun = dryRun;
    this.fetchImpl = fetchImpl;
  }

  async dispatchMatch(matchResult, options = {}) {
    const payload = formatDispatchPayload(matchResult, options);
    const dryRun = options.dryRun ?? this.dryRun;
    if (dryRun) {
      return {
        ok: true,
        dry_run: true,
        status: 200,
        payload,
        response: {
          accepted: false,
          dispatched: false,
          reason: "dry_run_enabled",
        },
      };
    }
    const url = new URL(this.dispatchPath, this.baseUrl).toString();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.jwt}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      const maybeJson = text ? safeJsonParse(text) : null;

      if (!res.ok) {
        throw mapHttpError(res.status, text, maybeJson);
      }

      return {
        ok: true,
        status: res.status,
        payload,
        response: maybeJson ?? text,
      };
    } catch (error) {
      if (error instanceof DispatchError) throw error;
      if (error?.name === "AbortError") {
        throw new DispatchError("Dispatch request timed out.", {
          code: "TIMEOUT",
          retryable: true,
        });
      }
      throw new DispatchError(`Dispatch request failed: ${error.message}`, {
        code: "NETWORK_ERROR",
        retryable: true,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapHttpError(status, text, json) {
  const lower = String(text || "").toLowerCase();

  if (status === 401 || status === 403) {
    return new DispatchError("Unauthorized dispatch request.", {
      status,
      code: "UNAUTHORIZED",
      retryable: false,
    });
  }
  if (status === 429) {
    return new DispatchError("Rate limit exceeded during dispatch.", {
      status,
      code: "RATE_LIMIT",
      retryable: true,
    });
  }

  // Handle explicit circuit-breaker style responses.
  if (
    status === 503 ||
    status === 502 ||
    lower.includes("circuit breaker") ||
    lower.includes("circuit_breaker") ||
    String(json?.error || "").toLowerCase().includes("circuit")
  ) {
    return new DispatchError("Dispatch rejected by circuit breaker.", {
      status,
      code: "CIRCUIT_BREAKER",
      retryable: true,
    });
  }

  return new DispatchError(`Dispatch failed with HTTP ${status}.`, {
    status,
    code: "HTTP_ERROR",
    retryable: status >= 500,
  });
}

export function createDispatchRouterFromEnv(overrides = {}) {
  return new DispatchRouter({
    jwt: process.env.PFT_TASKNODE_JWT,
    baseUrl: process.env.PFT_TASKNODE_URL || DEFAULT_BASE_URL,
    dispatchPath: process.env.PFT_TASKNODE_DISPATCH_PATH || DEFAULT_DISPATCH_PATH,
    timeoutMs: process.env.PFT_TASKNODE_TIMEOUT_MS
      ? Number(process.env.PFT_TASKNODE_TIMEOUT_MS)
      : 30000,
    dryRun: String(process.env.PFT_DISPATCH_DRY_RUN || "").toLowerCase() === "true",
    ...overrides,
  });
}
