import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAttestation } from "../src/loop/attest.js";

test("buildAttestation produces a provenant-valid attestation", async (t) => {
  let provenant;
  try {
    provenant = await import("../../provenant/src/index.js");
  } catch {
    t.skip("provenant is not available at ../../provenant/src/index.js");
    return;
  }

  const built = buildAttestation(
    {
      id: "sp_contract",
      target: "AGENTS.md",
      layer: "context",
      meta: {
        flywheel: {
          evalStrategy: "witness_replay",
          checks: ["node trial.mjs", "", "   ", null],
        },
      },
    },
    { verdict: "helped" },
    { signature: "bash:test", members: ["ep_1"] },
  );

  const validation = provenant.validateEvaluation(built.meta.evaluation);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  const record = provenant.attest(built.artifact.hash, {
    ...built.meta,
    created: "2026-07-20T00:00:00.000Z",
    agent: "flywheel/test@1",
  });

  assert.match(record.id, /^[a-f0-9]{64}$/);
  assert.ok(provenant.EVAL_METHODS.includes(record.evaluation.method));
  assert.equal(provenant.validateEvaluation(record.evaluation).valid, true);
  assert.deepEqual(record.evaluation.checks, [
    { name: "node trial.mjs", passed: true },
  ]);
});
