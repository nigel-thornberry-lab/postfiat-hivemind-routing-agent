# Proposal Handshake E2E Log Snapshot

Date: 2026-02-28  
Command:

```bash
node --test src/test-proposal-e2e.mjs
```

Terminal output snapshot:

```text
TAP version 13
# Subtest: e2e proposal flow: query -> proposed -> dual acceptance -> locked
ok 1 - e2e proposal flow: query -> proposed -> dual acceptance -> locked
  ---
  duration_ms: 9.761875
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 92.252916
```

Proof points validated by this test:

- query result is converted into `proposal.proposed`
- requester signs canonical proposal hash and transitions to `requester_accepted`
- process restart is simulated and state reloads from durable store
- operator signs canonical proposal hash and transitions to `locked`
- `proposal.locked` event is present in persisted event history
