const DEFAULT_BASE_URL = "https://tasknode.postfiat.org";
const DEFAULT_INTEGRITY_PATH = "/api/routing/integrity";

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export class TaskNodeClient {
  constructor({ jwt, baseUrl = DEFAULT_BASE_URL, timeoutMs = 30000 } = {}) {
    if (!jwt) {
      throw new Error("Missing JWT. Set PFT_TASKNODE_JWT.");
    }
    this.jwt = jwt;
    this.baseUrl = new URL(baseUrl).toString();
    this.timeoutMs = timeoutMs;
  }

  async requestJson(path) {
    const url = new URL(path, this.baseUrl).toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.jwt}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} for ${path}: ${text.slice(0, 300)}`);
      }

      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getLeaderboard() {
    return this.requestJson("/api/leaderboard");
  }

  async getProfilePublic(walletAddress) {
    return this.requestJson(`/api/profile/public/${walletAddress}`);
  }

  async getTasksSummary() {
    return this.requestJson("/api/tasks/summary");
  }

  async getTasksRewarded(limit = 100, offset = 0) {
    return this.requestJson(`/api/tasks/rewarded?limit=${limit}&offset=${offset}`);
  }

  async getTasksRefused(limit = 100, offset = 0) {
    return this.requestJson(`/api/tasks/refused?limit=${limit}&offset=${offset}`);
  }

  async getRoutingIntegrityStatus() {
    const path = process.env.PFT_TASKNODE_INTEGRITY_PATH || DEFAULT_INTEGRITY_PATH;
    return this.requestJson(path);
  }

  mapLeaderboardToOperatorProfile(row) {
    return {
      operator_id: row.user_id ?? null,
      wallet_address: row.wallet_address ?? null,
      wallet_label: null,
      summary: row.summary ?? null,
      capabilities: asArray(row.capabilities),
      expert_knowledge: asArray(row.expert_knowledge).map((entry) => ({
        domain: entry?.domain ?? null,
        confidence: null,
      })),
      sybil_score: toIntOrNull(row.sybil_score),
      sybil_risk: row.sybil_risk ?? null,
      linked_accounts: [],
      alignment_score: toIntOrNull(row.alignment_score),
      alignment_tier: row.alignment_tier ?? null,
      weekly_tasks: toIntOrNull(row.weekly_tasks) ?? 0,
      monthly_tasks: toIntOrNull(row.monthly_tasks) ?? 0,
      weekly_rewards: toNumberOrNull(row.weekly_rewards) ?? 0,
      monthly_rewards: toNumberOrNull(row.monthly_rewards) ?? 0,
      leaderboard_score_week: toIntOrNull(row.leaderboard_score_week),
      leaderboard_score_month: toIntOrNull(row.leaderboard_score_month),
      is_public: Boolean(row.is_public),
      is_published: Boolean(row.is_published),
      published_at: row.published_at ?? null,
      nft_image_url: row.nft_image_url ?? null,
      avatar_image_url: null,
    };
  }

  mergePublicProfile(operator, profilePayload) {
    const profile = profilePayload?.profile ?? {};
    const expertKnowledge = asArray(profile.expert_knowledge).map((entry) => ({
      domain: entry?.domain ?? null,
      confidence: entry?.confidence ?? null,
    }));

    return {
      ...operator,
      operator_id: profile.user_id ?? operator.operator_id,
      wallet_label: profile.wallet_label ?? operator.wallet_label,
      summary: profile.summary ?? operator.summary,
      capabilities:
        asArray(profile.capabilities).length > 0
          ? asArray(profile.capabilities)
          : operator.capabilities,
      expert_knowledge: expertKnowledge.length > 0 ? expertKnowledge : operator.expert_knowledge,
      linked_accounts: asArray(profile?.sybil_score?.linked_accounts),
      alignment_score:
        toIntOrNull(profile?.alignment?.alignment_score) ?? operator.alignment_score,
      alignment_tier: profile?.alignment?.alignment_tier ?? operator.alignment_tier,
      weekly_tasks: toIntOrNull(profile?.alignment?.weekly_counts?.total) ?? operator.weekly_tasks,
      monthly_tasks:
        toIntOrNull(profile?.alignment?.monthly_counts?.total) ?? operator.monthly_tasks,
      weekly_rewards:
        toNumberOrNull(profile?.alignment?.weekly_rewards_total) ?? operator.weekly_rewards,
      monthly_rewards:
        toNumberOrNull(profile?.alignment?.monthly_rewards_total) ?? operator.monthly_rewards,
      sybil_score: toIntOrNull(profile?.sybil_score?.sybil_score) ?? operator.sybil_score,
      sybil_risk: profile?.sybil_score?.sybil_risk ?? operator.sybil_risk,
      is_published: Boolean(profile.is_published ?? operator.is_published),
      avatar_image_url: profile?.avatar?.image_url ?? operator.avatar_image_url,
    };
  }

  mapRawTask(rawTask, statusFallback = null) {
    return {
      task_id: rawTask.id ?? null,
      title: rawTask.title ?? null,
      type: rawTask.type ?? null,
      status: rawTask.status ?? statusFallback,
      requirements: rawTask.requirements ?? null,
      verification_ask: rawTask.verificationAsk ?? null,
      verification_status: rawTask.verificationStatus ?? null,
      pft_offer: toNumberOrNull(rawTask.pft),
      reward_tier: rawTask.rewardTier ?? null,
      reward_score: toIntOrNull(rawTask.rewardScore),
      reward_summary: rawTask.rewardSummary ?? null,
      created_at_ms: toIntOrNull(rawTask.createdAt),
      accepted_at_ms: toIntOrNull(rawTask.acceptedAt),
      submitted_at_ms: toIntOrNull(rawTask.submittedAt),
      rewarded_at_ms: toIntOrNull(rawTask.rewardedAt),
      submission_id: rawTask.submissionId ?? null,
      tx_hash: rawTask.txHash ?? null,
      refusal_category: rawTask.refusalCategory ?? null,
      reason: rawTask.reason ?? null,
    };
  }

  async fetchOperatorProfiles({ limit = 50 } = {}) {
    const leaderboard = await this.getLeaderboard();
    const rows = asArray(leaderboard.rows).slice(0, limit);

    const profiles = [];
    for (const row of rows) {
      const base = this.mapLeaderboardToOperatorProfile(row);
      try {
        const publicProfile = await this.getProfilePublic(base.wallet_address);
        profiles.push(this.mergePublicProfile(base, publicProfile));
      } catch {
        // If profile is private/forbidden, keep leaderboard-shaped fallback.
        profiles.push(base);
      }
    }

    return profiles;
  }

  async fetchNetworkTasks() {
    const summary = await this.getTasksSummary();
    const byId = new Map();

    for (const [statusKey, tasks] of Object.entries(summary?.tasks ?? {})) {
      for (const rawTask of asArray(tasks)) {
        const mapped = this.mapRawTask(rawTask, statusKey);
        if (mapped.task_id) byId.set(mapped.task_id, mapped);
      }
    }

    const rewarded = await this.getTasksRewarded(100, 0);
    for (const rawTask of asArray(rewarded.tasks)) {
      const mapped = this.mapRawTask(rawTask, "rewarded");
      if (!mapped.task_id) continue;
      byId.set(mapped.task_id, { ...(byId.get(mapped.task_id) || {}), ...mapped });
    }

    const refused = await this.getTasksRefused(100, 0);
    for (const rawTask of asArray(refused.tasks)) {
      const mapped = this.mapRawTask(rawTask, "refused");
      if (!mapped.task_id) continue;
      byId.set(mapped.task_id, { ...(byId.get(mapped.task_id) || {}), ...mapped });
    }

    return [...byId.values()];
  }

  async fetchLiveState({ operatorLimit = 50 } = {}) {
    const [operator_profiles, network_tasks] = await Promise.all([
      this.fetchOperatorProfiles({ limit: operatorLimit }),
      this.fetchNetworkTasks(),
    ]);

    return {
      metadata: {
        dataset: "Hive Mind Routing Agent live state snapshot",
        generated_at: new Date().toISOString(),
        source: this.baseUrl,
        operator_count: operator_profiles.length,
        task_count: network_tasks.length,
        match_result_count: 0,
      },
      operator_profiles,
      network_tasks,
      match_results: [],
    };
  }
}

export function createTaskNodeClientFromEnv() {
  return new TaskNodeClient({
    jwt: process.env.PFT_TASKNODE_JWT,
    baseUrl: process.env.PFT_TASKNODE_URL || DEFAULT_BASE_URL,
    timeoutMs: process.env.PFT_TASKNODE_TIMEOUT_MS
      ? Number(process.env.PFT_TASKNODE_TIMEOUT_MS)
      : 30000,
  });
}
