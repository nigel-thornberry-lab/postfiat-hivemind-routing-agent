# Feedback Outcome Ingestion Schema

This module ingests terminal task outcomes from live network state and persists operator feedback weights for future routing cycles.

## Outcome Event Schema

```json
{
  "outcome_id": "task-id:completed:2026-02-27T02:11:25.159Z",
  "status": "completed",
  "operator_id": "7271c454-3b39-4c08-8bbc-3049cdf2df53",
  "task_id": "c247f978-5046-4a5b-b048-2021862b1623",
  "detected_at": "2026-02-27T02:20:00.000Z",
  "terminal_at": "2026-02-27T02:11:25.159Z",
  "source_status": "rewarded",
  "source_reward_tier": "exceptional",
  "source_reward_summary": "Operator delivered accepted evidence.",
  "source_tx_hash": "ABC123..."
}
```

## Fields

- `status`: normalized terminal outcome enum:
  - `completed`
  - `refused`
  - `abandoned`
- `operator_id`: operator whose future weighting is updated.
- `task_id`: terminal task that generated this feedback signal.
- `terminal_at`: canonical task terminal timestamp.

## Memory Schema (`data/feedback-memory.json`)

```json
{
  "schema_version": "1.0",
  "updated_at": "2026-02-27T02:20:00.000Z",
  "processed_outcome_ids": ["..."],
  "operators": {
    "7271c454-3b39-4c08-8bbc-3049cdf2df53": {
      "performance_multiplier": 1.06,
      "alignment_bonus": 2,
      "completed_count": 2,
      "refused_count": 0,
      "abandoned_count": 0,
      "last_task_id": "c247f978-5046-4a5b-b048-2021862b1623",
      "last_outcome_at": "2026-02-27T02:11:25.159Z"
    }
  }
}
```

## Weighting Rules

- `completed`: `+0.03` performance multiplier (cap `1.25`), `+1` alignment bonus (cap `+10`)
- `refused`: `-0.08` performance multiplier (floor `0.55`), `-2` alignment bonus (floor `-25`)
- `abandoned`: `-0.12` performance multiplier (floor `0.45`), `-3` alignment bonus (floor `-30`)

These values are applied by `matcher.mjs` during ranking as:

- effective alignment = `(operator.alignment_score + alignment_bonus)`
- final score multiplier = `sybil_penalty_multiplier * performance_multiplier`
