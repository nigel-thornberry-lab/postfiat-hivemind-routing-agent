# On-Demand Query Schema

## Query Payload

```json
{
  "request_id": "optional-client-id",
  "user_request_text": "Need help with video production for conversion ads",
  "required_skills": ["video production", "creative scripting"],
  "constraints": {
    "max_sybil_risk": "Moderate",
    "min_alignment_score": 60,
    "public_only": true,
    "exclude_operator_ids": ["operator-abc"]
  },
  "top_k": 3
}
```

## Field Notes

- `user_request_text` (required): free-form user request.
- `required_skills` (optional): explicit skill hints to increase tag overlap precision.
- `constraints.max_sybil_risk` (optional): `Low Risk | Moderate | Elevated | High Risk`.
- `constraints.min_alignment_score` (optional): `0..100`.
- `constraints.public_only` (optional): if `true`, only public + published operators are considered.
- `constraints.exclude_operator_ids` (optional): hard excludes.
- `top_k` (optional): output size cap, clamped to `1..10`, default `3`.

## Response Payload

```json
{
  "ok": true,
  "request_id": "q-123",
  "generated_at": "2026-02-27T03:00:00.000Z",
  "query": {},
  "task": {
    "task_id": "query-q-123",
    "title": "Need help with video production for conversion ads",
    "type": "network",
    "status": "on_demand_query",
    "requirements": "..."
  },
  "candidates_considered": 34,
  "rejected_count": 11,
  "top_matches": [
    {
      "rank": 1,
      "operator_id": "7271c454-3b39-4c08-8bbc-3049cdf2df53",
      "wallet_address": "rPo8GkCA9YMKzuJGTHbj11kdVfPqSJHxNx",
      "confidence": 0.81,
      "overall_match_score": 0.79,
      "matched_expert_domains": ["Video production and creative scripting"],
      "alignment_score": 84,
      "sybil_score": 88,
      "sybil_risk": "Low Risk",
      "reasoning": ["..."]
    }
  ]
}
```
