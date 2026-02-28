import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { ProposalService } from "./proposal-service.mjs";
import { signProposalHash } from "./double-opt-in.mjs";

function makeKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

test("e2e proposal flow: query -> proposed -> dual acceptance -> locked", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-proposal-e2e-"));
  const storePath = path.join(tempDir, "proposal-events.json");

  const queryRunner = async () => ({
    ok: true,
    request_id: "query-1",
    generated_at: "2026-02-27T04:00:00.000Z",
    query: {
      user_request_text: "Need help with video production",
      required_skills: ["video production"],
      constraints: {},
      top_k: 3,
    },
    task: {
      task_id: "query-query-1",
      title: "Need help with video production",
      type: "network",
      status: "on_demand_query",
      requirements: "Need help with video production",
    },
    candidates_considered: 2,
    rejected_count: 0,
    top_matches: [
      {
        rank: 1,
        operator_id: "operator-1",
        wallet_address: "r123",
        confidence: 0.86,
        overall_match_score: 0.84,
        matched_expert_domains: ["video production and editing"],
        alignment_score: 88,
        sybil_score: 91,
        sybil_risk: "Low Risk",
        reasoning: ["Matched expert tags: video production and editing"],
      },
    ],
  });

  const requesterKeys = makeKeyPair();
  const operatorKeys = makeKeyPair();
  const requesterId = "requester-1";
  const operatorId = "operator-1";

  const serviceA = new ProposalService({ storePath, queryRunner });
  const proposed = await serviceA.createProposalFromQuery({
    requester_id: requesterId,
    query: {
      user_request_text: "Need help with video production",
      required_skills: ["video production"],
    },
    operator_id: operatorId,
    expires_in_seconds: 7200,
  });

  assert.equal(proposed.state.status, "proposed");
  assert.equal(proposed.proposal.operator_id, operatorId);

  const requesterSignature = signProposalHash(proposed.proposal_hash, requesterKeys.privateKeyPem);
  const afterRequesterAccept = await serviceA.acceptProposal(proposed.proposal.proposal_id, {
    actor_id: requesterId,
    proposal_hash: proposed.proposal_hash,
    signature: requesterSignature,
    public_key: requesterKeys.publicKeyPem,
  });
  assert.equal(afterRequesterAccept.state.status, "requester_accepted");

  // Simulate restart: rehydrate from durable event store and continue flow.
  const serviceB = new ProposalService({ storePath, queryRunner });
  const reloaded = await serviceB.getProposal(proposed.proposal.proposal_id);
  assert.equal(reloaded.state.status, "requester_accepted");

  const operatorSignature = signProposalHash(reloaded.proposal_hash, operatorKeys.privateKeyPem);
  const locked = await serviceB.acceptProposal(proposed.proposal.proposal_id, {
    actor_id: operatorId,
    proposal_hash: reloaded.proposal_hash,
    signature: operatorSignature,
    public_key: operatorKeys.publicKeyPem,
  });

  assert.equal(locked.state.status, "locked");
  assert.ok(locked.events.some((evt) => evt.type === "proposal.locked"));
});
