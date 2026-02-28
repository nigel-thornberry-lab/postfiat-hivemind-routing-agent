import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { applyHandshakeEvent, createHandshakeStore, hashProposalPayload, signProposalHash } from "./double-opt-in.mjs";
import { ProposalService } from "./proposal-service.mjs";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

function mkProposal() {
  return {
    proposal_id: "p1",
    task_id: "task-1",
    requester_id: "requester-1",
    operator_id: "operator-1",
    match_snapshot: { overall_match_score: 0.8 },
    expires_at: "2026-02-27T04:00:00.000Z",
    nonce: "nonce-1",
  };
}

test("clock skew tolerance allows slight over-expiry but rejects beyond skew", () => {
  const requester = keyPair();
  const operator = keyPair();
  const proposal = mkProposal();
  const hash = hashProposalPayload(proposal);
  const store = createHandshakeStore();

  applyHandshakeEvent(
    store,
    {
      event_id: randomUUID(),
      proposal_id: proposal.proposal_id,
      type: "proposal.proposed",
      actor_id: "system",
      occurred_at: "2026-02-27T03:00:00.000Z",
      payload: { proposal },
    },
    { now: "2026-02-27T03:00:00.000Z", allowedClockSkewMs: 5000 }
  );

  applyHandshakeEvent(
    store,
    {
      event_id: randomUUID(),
      proposal_id: proposal.proposal_id,
      type: "proposal.requester_accepted",
      actor_id: "requester-1",
      occurred_at: "2026-02-27T04:00:02.000Z",
      payload: {
        proposal_hash: hash,
        signature: signProposalHash(hash, requester.privateKeyPem),
        public_key: requester.publicKeyPem,
      },
    },
    { now: "2026-02-27T04:00:02.000Z", allowedClockSkewMs: 5000 }
  );

  assert.throws(
    () =>
      applyHandshakeEvent(
        store,
        {
          event_id: randomUUID(),
          proposal_id: proposal.proposal_id,
          type: "proposal.operator_accepted",
          actor_id: "operator-1",
          occurred_at: "2026-02-27T04:00:07.000Z",
          payload: {
            proposal_hash: hash,
            signature: signProposalHash(hash, operator.privateKeyPem),
            public_key: operator.publicKeyPem,
          },
        },
        { now: "2026-02-27T04:00:07.000Z", allowedClockSkewMs: 5000 }
      ),
    /expired/i
  );
});

test("proposal service enforces registered actor key binding", async () => {
  const requester = keyPair();
  const operator = keyPair();
  const attacker = keyPair();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-hardening-"));
  const storePath = path.join(tempDir, "proposal-events.json");

  const queryRunner = async () => ({
    ok: true,
    request_id: "q",
    generated_at: new Date().toISOString(),
    query: { user_request_text: "help", required_skills: [], constraints: {}, top_k: 1 },
    task: { task_id: "task-q", title: "help", type: "network", status: "on_demand_query", requirements: "help" },
    candidates_considered: 1,
    rejected_count: 0,
    top_matches: [
      {
        rank: 1,
        operator_id: "operator-1",
        wallet_address: "r-1",
        confidence: 0.8,
        overall_match_score: 0.79,
        matched_expert_domains: ["help"],
        alignment_score: 80,
        sybil_score: 90,
        sybil_risk: "Low Risk",
        reasoning: ["ok"],
      },
    ],
  });

  const service = new ProposalService({
    storePath,
    queryRunner,
    actorPublicKeys: {
      "requester-1": requester.publicKeyPem,
      "operator-1": operator.publicKeyPem,
    },
    requireRegisteredKeys: true,
  });

  const proposed = await service.createProposalFromQuery({
    requester_id: "requester-1",
    query: { user_request_text: "help" },
    operator_id: "operator-1",
  });

  const requesterSig = signProposalHash(proposed.proposal_hash, requester.privateKeyPem);
  await service.acceptProposal(proposed.proposal.proposal_id, {
    actor_id: "requester-1",
    proposal_hash: proposed.proposal_hash,
    signature: requesterSig,
  });

  const badSig = signProposalHash(proposed.proposal_hash, attacker.privateKeyPem);
  await assert.rejects(
    () =>
      service.acceptProposal(proposed.proposal.proposal_id, {
        actor_id: "operator-1",
        proposal_hash: proposed.proposal_hash,
        signature: badSig,
      }),
    /Invalid cryptographic signature/
  );
});

test("stuck proposal scan emits alert candidates", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-stuck-"));
  const storePath = path.join(tempDir, "proposal-events.json");
  const now = new Date();
  const stalePast = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const futureExp = new Date(now.getTime() + 20 * 60 * 1000).toISOString();

  const seeded = {
    schema_version: "1.0",
    updated_at: now.toISOString(),
    proposals: {
      p1: {
        proposal_id: "p1",
        task_id: "t1",
        requester_id: "r1",
        operator_id: "o1",
        match_snapshot: { overall_match_score: 0.7 },
        expires_at: futureExp,
        nonce: "n1",
      },
    },
    events: [
      {
        event_id: "e1",
        proposal_id: "p1",
        type: "proposal.proposed",
        actor_id: "system",
        occurred_at: stalePast,
        payload: {},
      },
    ],
  };
  fs.writeFileSync(storePath, JSON.stringify(seeded, null, 2), "utf8");

  const service = new ProposalService({
    storePath,
    queryRunner: async () => {
      throw new Error("unused");
    },
  });
  const result = await service.scanStuckProposals({
    stuckAfterMs: 5 * 60 * 1000,
    expiringWithinMs: 60 * 1000,
  });
  assert.equal(result.alert_count, 1);
  assert.equal(result.alerts[0].proposal_id, "p1");
  assert.equal(result.alerts[0].stale, true);
});
