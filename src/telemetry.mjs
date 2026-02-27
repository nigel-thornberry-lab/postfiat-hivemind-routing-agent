import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_EVENT_VERSION = "1.0";

function toString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toBool(value, fallback = false) {
  const raw = toString(value).trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEvent(input, defaults = {}) {
  return {
    event_id: input.event_id || randomUUID(),
    event_version: input.event_version || DEFAULT_EVENT_VERSION,
    event_type: input.event_type || "unknown",
    emitted_at: input.emitted_at || nowIso(),
    run_id: input.run_id || defaults.run_id || null,
    task_id: input.task_id || null,
    operator_id: input.operator_id || null,
    severity: input.severity || "info",
    payload: input.payload ?? {},
  };
}

function validateEvent(event) {
  const errors = [];
  if (!event.event_type) errors.push("event_type is required");
  if (!event.emitted_at) errors.push("emitted_at is required");
  if (!event.event_id) errors.push("event_id is required");
  if (!event.event_version) errors.push("event_version is required");
  if (!["debug", "info", "warn", "error"].includes(event.severity)) {
    errors.push("severity must be debug|info|warn|error");
  }
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
    errors.push("payload must be an object");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

function ensureDirForFile(targetPath) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
}

export class TelemetryEmitter {
  constructor({
    runId = randomUUID(),
    stdout = true,
    filePath = null,
    webhookUrl = null,
    fetchImpl = fetch,
  } = {}) {
    this.runId = runId;
    this.stdout = stdout;
    this.filePath = filePath;
    this.webhookUrl = webhookUrl;
    this.fetchImpl = fetchImpl;
  }

  async emit(inputEvent) {
    const event = normalizeEvent(inputEvent, { run_id: this.runId });
    const validation = validateEvent(event);
    if (!validation.valid) {
      throw new Error(`Telemetry validation failed: ${validation.errors.join(" | ")}`);
    }

    const line = JSON.stringify(event);
    if (this.stdout) {
      console.log(line);
    }

    if (this.filePath) {
      ensureDirForFile(this.filePath);
      fs.appendFileSync(this.filePath, `${line}\n`, "utf8");
    }

    if (this.webhookUrl) {
      try {
        await this.fetchImpl(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        });
      } catch (error) {
        // Never crash routing pipeline for telemetry transport errors.
        console.error(`[telemetry] webhook transport error: ${error.message}`);
      }
    }

    return event;
  }
}

export function createTelemetryEmitterFromEnv(overrides = {}) {
  const enabled = toBool(process.env.PFT_TELEMETRY_ENABLED, false);
  if (!enabled && !overrides.force) return null;

  const transport = toString(process.env.PFT_TELEMETRY_TRANSPORT || "stdout")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const useStdout = transport.includes("stdout");
  const useFile = transport.includes("file");
  const useWebhook = transport.includes("webhook");

  return new TelemetryEmitter({
    runId: process.env.PFT_TELEMETRY_RUN_ID || randomUUID(),
    stdout: useStdout,
    filePath: useFile ? process.env.PFT_TELEMETRY_FILE || "data/routing-telemetry.log" : null,
    webhookUrl: useWebhook ? process.env.PFT_TELEMETRY_WEBHOOK_URL || null : null,
    ...overrides,
  });
}
