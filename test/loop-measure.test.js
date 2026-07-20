import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAttestation } from "../src/loop/attest.js";
import { CONTEXT_LINE_BUDGET, flywheelPolicy, withinBudget } from "../src/loop/policy.js";
import { advanceCursor, mergeManifest, newRunManifest } from "../src/loop/state.js";
import { clusterToTrialSuite, splitHeldout } from "../src/measure/suite.js";
import { judge } from "../src/measure/verdict.js";

test("loop policy protects credentials and reserves dangerous layers", () => {
  const policy = flywheelPolicy();
  assert.ok(policy.protected_surfaces.includes("**/settings.json"));
  assert.ok(policy.protected_surfaces.includes("**/.env"));
  assert.deepEqual(policy.approvals.find((item) => item.layer === "weights"), { layer: "weights", requires: "forbidden" });
  assert.deepEqual(policy.approvals.find((item) => item.layer === "scaffolding"), { layer: "scaffolding", requires: "human-gate" });
  assert.equal(CONTEXT_LINE_BUDGET, 20);
  assert.equal(withinBudget(12, 8), true);
  assert.equal(withinBudget(12, 9), false);
});

test("attestations translate evaluation strategy, result, and ancestry", () => {
  const patch = { id: "sp_1", target: "AGENTS.md", layer: "context", meta: { flywheel: { evalStrategy: "witness_replay", checks: ["node trial.mjs"] } } };
  const cluster = { signature: "bash:test", members: ["ep_2", "ep_1"] };
  const helped = buildAttestation(patch, { verdict: "helped" }, cluster);
  assert.match(helped.artifact.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(helped.artifact), ["hash"]);
  assert.deepEqual(helped.meta.artifact_descriptor, {
    kind: "flywheel-patch",
    patch_id: "sp_1",
    target: "AGENTS.md",
    layer: "context",
    signature: "bash:test",
  });
  assert.equal(buildAttestation(patch, { verdict: "helped" }, cluster).artifact.hash, helped.artifact.hash);
  assert.equal(helped.meta.evaluation.method, "test");
  assert.equal(helped.meta.evaluation.score, 1);
  assert.deepEqual(helped.meta.evaluation.checks, [
    { name: "node trial.mjs", passed: true },
  ]);
  assert.deepEqual(helped.meta.parents, []);
  assert.deepEqual(helped.meta.derived_from, ["ep_2", "ep_1"]);
  const parent = "a".repeat(64);
  assert.deepEqual(buildAttestation(patch, { verdict: "helped" }, cluster, {
    parentAttestations: [parent, "ep_sha256:not-an-attestation"],
  }).meta.parents, [parent]);
  assert.equal(buildAttestation(patch, { verdict: "regressed" }, cluster).meta.evaluation.score, 0);
  assert.deepEqual(buildAttestation({
    ...patch,
    meta: { flywheel: { evalStrategy: "regression_only", checks: ["npm test", "  ", 7] } },
  }, { verdict: "regressed" }, cluster).meta.evaluation.checks, [
    { name: "npm test", passed: false, note: "aggregate" },
  ]);
});

test("run manifests advance immutably and merge by maximum cursor", () => {
  const original = newRunManifest("run_1");
  const advanced = advanceCursor(original, "a.jsonl", 12);
  assert.deepEqual(original.cursor, {});
  assert.deepEqual(mergeManifest(advanced, { run_id: "run_1", cursor: { "a.jsonl": 8, "b.jsonl": 4 }, counts: {} }), {
    run_id: "run_1", created: null, cursor: { "a.jsonl": 12, "b.jsonl": 4 }, counts: {},
  });
});

test("trial suites select cluster episodes and deduplicate prompts", () => {
  const episodes = [
    { id: "ep_1", cwd: "/one", request: { text: "fix it" } },
    { id: "ep_2", cwd: "/two", request: { text: "fix it" } },
    { id: "ep_3", cwd: "/three", request: { text: "different" } },
  ];
  const suite = clusterToTrialSuite({ members: ["ep_1", "ep_2"], signature: "sig" }, episodes);
  assert.deepEqual(suite, [{ id: "ep_1", prompt: "fix it", cwd: "/one", expectedSignature: "sig" }]);
});

test("heldout split is deterministic, shuffle-stable, disjoint, and near forty percent", () => {
  const trials = Array.from({ length: 1000 }, (_, index) => ({ id: `trial_${index}` }));
  const first = splitHeldout(trials, { salt: "sealed" });
  const shuffled = splitHeldout([...trials].reverse(), { salt: "sealed" });
  assert.deepEqual(first, shuffled);
  assert.ok(first.heldout.length > 350 && first.heldout.length < 450);
  const devIds = new Set(first.dev.map((trial) => trial.id));
  assert.ok(first.heldout.every((trial) => !devIds.has(trial.id)));
});

test("powered positive lift helps while the same underpowered lift cannot", () => {
  const before = Array(60).fill(0.2);
  const after = Array(60).fill(0.6);
  assert.equal(judge(before, after, { noiseBand: 0 }).verdict, "helped");
  const small = judge(before.slice(0, 59), after.slice(0, 59), { noiseBand: 0 });
  assert.equal(small.verdict, "inconclusive");
  assert.equal(small.powered, false);
});

test("a hard regression wins regardless of average delta", () => {
  const before = [1, ...Array(59).fill(0)];
  const after = [0.9, ...Array(59).fill(1)];
  assert.equal(judge(before, after, { noiseBand: 0 }).verdict, "regressed");
});

test("dev-only improvement is overfit", () => {
  const before = { dev: Array(60).fill(0.2), heldout: Array(60).fill(0.5) };
  const after = { dev: Array(60).fill(0.6), heldout: Array(60).fill(0.5) };
  assert.equal(judge(before, after, { noiseBand: 0 }).verdict, "overfit");
});

test("new public functions never throw on garbage", () => {
  for (const call of [
    () => buildAttestation(Symbol(), null, null),
    () => advanceCursor(null, Symbol(), NaN),
    () => mergeManifest(Symbol(), null),
    () => clusterToTrialSuite(null, Symbol()),
    () => splitHeldout(null, null),
    () => judge(Symbol(), null, null),
  ]) assert.doesNotThrow(call);
});
