# Observability and Audit Telemetry Schema

Structured telemetry events are emitted as newline-delimited JSON (`.jsonl`) so each routing decision can be independently verified.

## Base Event Shape

```json
{
  "event_id": "uuid",
  "event_version": "1.0",
  "event_type": "routing.match_scored",
  "emitted_at": "2026-02-25T12:00:00.000Z",
  "run_id": "2026-02-25T12:00:00.000Z",
  "task_id": "task-004",
  "operator_id": "operator-003",
  "severity": "info",
  "payload": {}
}
```

## Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `event_id` | string (uuid) | yes | Unique event identifier for traceability. |
| `event_version` | string | yes | Event contract version for schema evolution. |
| `event_type` | string | yes | Event category (match/penalty/block/integrity). |
| `emitted_at` | string (ISO timestamp) | yes | Emission time in UTC. |
| `run_id` | string \| null | no | Correlation ID for one routing execution cycle. |
| `task_id` | string \| null | no | Target task identifier for routing events. |
| `operator_id` | string \| null | no | Target operator identifier for operator-scoped events. |
| `severity` | enum | yes | `debug`, `info`, `warn`, `error`. |
| `payload` | object | yes | Event-specific attributes. |

## Event Types

- `integrity.context_built` - snapshot of live integrity context load
- `routing.operator_blocked` - operator hard-blocked by integrity policy
- `routing.operator_rejected` - operator rejected by hard expertise filter
- `routing.sybil_penalty_applied` - operator score penalized by Sybil risk/score
- `routing.match_scored` - scored match candidate for an operator-task pair
- `routing.rank_complete` - rank output summary for a task

## Transport Configuration

Environment variables:

- `PFT_TELEMETRY_ENABLED=true|false` (default `false`)
- `PFT_TELEMETRY_TRANSPORT=stdout,file,webhook` (CSV list)
- `PFT_TELEMETRY_FILE=data/routing-telemetry.log` (used when `file` enabled)
- `PFT_TELEMETRY_WEBHOOK_URL=https://...` (used when `webhook` enabled)
- `PFT_TELEMETRY_RUN_ID=<optional-run-id>`
