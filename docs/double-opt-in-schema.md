# Double Opt-In Handshake Protocol

## Canonical Proposal Payload Schema

```json
{
  "proposal_id": "proposal-1",
  "task_id": "task-abc",
  "requester_id": "user-1",
  "operator_id": "operator-9",
  "match_snapshot": {
    "overall_match_score": 0.84,
    "confidence": 0.87,
    "matched_expert_domains": ["video production", "creative scripting"]
  },
  "expires_at": "2026-12-31T00:00:00.000Z",
  "nonce": "nonce-001"
}
```

`src/double-opt-in.mjs` canonicalizes this payload deterministically and computes a SHA-256 hash to sign.

## Event Types

- `proposal.proposed`
- `proposal.requester_accepted`
- `proposal.operator_accepted`
- `proposal.locked` (auto-emitted when both parties have accepted)
- `proposal.expired`
- `proposal.declined`

## State Machine

- Start: `proposed`
- Acceptance path:
  - `proposed` -> `requester_accepted` or `operator_accepted`
  - once both signatures are present -> `locked`
- Rejection path: any non-final state -> `declined`
- Timeout path: any non-final state -> `expired` (only after `expires_at`)

Final states:
- `locked`
- `declined`
- `expired`

## Replay + Idempotency

- Nonce replay protection:
  - `proposal.proposed` is rejected if `nonce` was already consumed.
- Event idempotency:
  - duplicate `event_id` returns idempotent result and does not mutate state.
- Expiry guard:
  - accept/decline events are rejected after `expires_at`.
