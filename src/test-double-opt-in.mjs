import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  applyHandshakeEvent,
  createHandshakeStore,
  hashProposalPayload,
  signProposalHash,
} from "./double-opt-in.mjs";

function createEd25519PemPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

test("double opt-in handshake reaches locked state on two valid signatures", () => {
  const requester = createEd25519PemPair();
  const operator = createEd25519PemPair();
  const store = createHandshakeStore();

  const proposal = {
    proposal_id: "proposal-1",
    task_id: "task-abc",
    requester_id: "user-1",
    operator_id: "operator-9",
    match_snapshot: {
      overall_match_score: 0.84,
      confidence: 0.87,
      matched_expert_domains: ["video production", "creative scripting"],
    },
    expires_at: "2026-12-31T00:00:00.000Z",
    nonce: "nonce-001",
  };

  const proposed = applyHandshakeEvent(store, {
    event_id: randomUUID(),
    proposal_id: proposal.proposal_id,
    type: "proposal.proposed",
    actor_id: "system",
    occurred_at: "2026-02-27T03:00:00.000Z",
    payload: { proposal },
  });
  assert.equal(proposed.state.status, "proposed");

  const proposalHash = hashProposalPayload(proposal);
  const requesterSig = signProposalHash(proposalHash, requester.privateKeyPem);
  const operatorSig = signProposalHash(proposalHash, operator.privateKeyPem);

  const requesterAccepted = applyHandshakeEvent(
    store,
    {
      event_id: randomUUID(),
      proposal_id: proposal.proposal_id,
      type: "proposal.requester_accepted",
      actor_id: proposal.requester_id,
      occurred_at: "2026-02-27T03:01:00.000Z",
      payload: {
        proposal_hash: proposalHash,
        signature: requesterSig,
        public_key: requester.publicKeyPem,
      },
    },
    { now: "2026-02-27T03:01:00.000Z" }
  );
  assert.equal(requesterAccepted.state.status, "requester_accepted");

  const operatorAccepted = applyHandshakeEvent(
    store,
    {
      event_id: randomUUID(),
      proposal_id: proposal.proposal_id,
      type: "proposal.operator_accepted",
      actor_id: proposal.operator_id,
      occurred_at: "2026-02-27T03:02:00.000Z",
      payload: {
        proposal_hash: proposalHash,
        signature: operatorSig,
        public_key: operator.publicKeyPem,
      },
    },
    { now: "2026-02-27T03:02:00.000Z" }
  );

  assert.equal(operatorAccepted.state.status, "locked");
  assert.equal(operatorAccepted.auto_events.length, 1);
  assert.equal(operatorAccepted.auto_events[0].type, "proposal.locked");
});

test("replay nonce is blocked and duplicate event ids are idempotent", () => {
  const store = createHandshakeStore();

  const proposalA = {
    proposal_id: "proposal-a",
    task_id: "task-a",
    requester_id: "r1",
    operator_id: "o1",
    match_snapshot: { overall_match_score: 0.7 },
    expires_at: "2026-12-31T00:00:00.000Z",
    nonce: "replay-check",
  };
  const eventId = "evt-propose-a";

  const first = applyHandshakeEvent(store, {
    event_id: eventId,
    proposal_id: proposalA.proposal_id,
    type: "proposal.proposed",
    actor_id: "system",
    occurred_at: "2026-02-27T03:00:00.000Z",
    payload: { proposal: proposalA },
  });
  assert.equal(first.idempotent, false);

  const duplicate = applyHandshakeEvent(store, {
    event_id: eventId,
    proposal_id: proposalA.proposal_id,
    type: "proposal.proposed",
    actor_id: "system",
    occurred_at: "2026-02-27T03:00:00.000Z",
    payload: { proposal: proposalA },
  });
  assert.equal(duplicate.idempotent, true);

  const proposalB = {
    ...proposalA,
    proposal_id: "proposal-b",
  };
  assert.throws(
    () =>
      applyHandshakeEvent(store, {
        event_id: "evt-propose-b",
        proposal_id: proposalB.proposal_id,
        type: "proposal.proposed",
        actor_id: "system",
        occurred_at: "2026-02-27T03:01:00.000Z",
        payload: { proposal: proposalB },
      }),
    /Nonce already used/
  );
});
