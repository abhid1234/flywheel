import { test } from "node:test";
import assert from "node:assert/strict";
import { routeCluster, LAYER_STATUS } from "../src/propose/targets.js";
import { buildBrief } from "../src/propose/brief.js";
import { renderPrompt } from "../src/propose/prompt.js";
import { parseProposal } from "../src/propose/parse.js";
import { buildEvalContract } from "../src/propose/contract.js";
import { toSelfPatch } from "../src/propose/assemble.js";

const candidate = (extra = {}) => ({
  summary: "Clarify the instruction",
  layer: "context",
  target: "CLAUDE.md",
  edit: { before: "old line", after: "new line" },
  rationale: "Prevents recurrence",
  expectedEffect: "The agent uses the available file",
  ...extra,
});
const fenced = (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
const brief = (text = "old line") => ({ layer: "context", target: "CLAUDE.md", targetCurrentText: text, constraints: { maxLinesChanged: 20 } });

test("routeCluster maps every error class and makes weights unconstructible", () => {
  for (const errorClass of ["module_not_found", "command_not_found", "file_not_found"]) assert.equal(routeCluster({ errorClass }).layer, "context");
  for (const errorClass of ["edit_no_match", "test_failure", "harness_precondition", "git_conflict"]) assert.equal(routeCluster({ errorClass }).layer, "skill");
  for (const errorClass of ["permission", "timeout", "network"]) assert.deepEqual(routeCluster({ errorClass }), { layer: "scaffolding", surfaces: ["scaffolding"], requires: "human-gate" });
  for (const errorClass of ["user_rejected", "tool_unavailable", "stale_reference"]) assert.throws(() => routeCluster({ errorClass }));
  assert.throws(() => routeCluster({ layer: "weights", errorClass: "other" }));
  assert.equal(LAYER_STATUS.weights, "unavailable");
});

test("brief caps text and exemplars and redacts outbound strings", () => {
  const episodes = Array.from({ length: 4 }, (_, index) => ({
    id: `ep_${index}`, project: `/Users/alice/project${index}`, request: "email me at alice@example.com",
    steps: [{ ok: false, input: { command: "use sk-FAKESECRET123456789" }, errorText: "hf_abcdefghijklmnop" }],
  }));
  const targetText = Array.from({ length: 2500 }, () => "x\n").join("");
  const result = buildBrief({ id: "cl_1", signature: "sig", errorClass: "file_not_found", size: 4, cost: { terminal: 3 }, members: episodes.map((item) => item.id), witnesses: [] }, episodes, targetText);
  assert.equal(result.exemplars.length, 3);
  assert.equal(result.targetCurrentText.length, 4000);
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /FAKESECRET|abcdefghijklmnop|alice@example|\/Users\/alice/);
});

test("prompt rendering is deterministic and assigns only fix authorship", () => {
  const value = brief();
  assert.equal(renderPrompt(value), renderPrompt(value));
  assert.doesNotMatch(renderPrompt(value).split("Proposal brief:")[0], /success criterion|write (?:a )?(?:test|command)|supply (?:a )?(?:test|command)/i);
});

test("strict proposal parsing accepts a valid unique-anchor edit", () => {
  assert.deepEqual(parseProposal(fenced(candidate()), brief()), { ok: true, candidate: candidate() });
});

test("proposal parsing distinguishes anchor failures and rejects retargeting", () => {
  assert.ok(parseProposal(fenced(candidate()), brief("different")).errors.some((error) => error.code === "anchor_not_found"));
  assert.ok(parseProposal(fenced(candidate()), brief("old line\nold line")).errors.some((error) => error.code === "anchor_ambiguous"));
  const result = parseProposal(fenced(candidate({ layer: "skill", target: "SKILL.md" })), brief());
  assert.ok(result.errors.filter((error) => error.code === "mismatch").length === 2);
});

test("proposal parsing enforces line budget and rejects model-authored criteria", () => {
  const over = candidate({ edit: { before: "old line", after: Array.from({ length: 22 }, (_, index) => `line ${index}`).join("\n") } });
  assert.ok(parseProposal(fenced(over), brief()).errors.some((error) => error.code === "line_budget_exceeded"));
  for (const extra of [{ eval_contract: {} }, { command: "pretend" }]) {
    assert.ok(parseProposal(fenced(candidate(extra)), brief()).errors.some((error) => error.code === "criterion_supplied"));
  }
});

test("eval contract prefers replay, while weaker strategies require a human gate", () => {
  const replay = buildEvalContract({ id: "cl_1", witnesses: [{ replayable: true, cmd: 'echo "model text absent"', cwd: "/tmp/work" }] }, candidate());
  assert.equal(replay.strategy, "witness_replay");
  assert.equal(replay.strength, "causal");
  assert.match(replay.trialScript, /echo/);
  assert.doesNotMatch(replay.trialScript, /Clarify the instruction/);
  assert.equal(buildEvalContract({ id: "cl_2", size: 2, witnesses: [] }, candidate()).requires, "human-gate");
  const fallback = buildEvalContract({ id: "cl_3", witnesses: [] }, candidate());
  assert.equal(fallback.strategy, "regression_only");
  assert.equal(fallback.requires, "human-gate");
});

test("selfpatch assembly preserves purity, counts blast radius, and chooses strictest gate", () => {
  const cluster = { id: "cl_1", errorClass: "file_not_found", members: ["ep_1"], recurrenceRate: { rate: 0.2 } };
  const contract = { strategy: "recurrence_probe", strength: "behavioral", requires: "human-gate", evalContract: { kind: "command", command: "probe" }, checks: ["probe"] };
  const patch = toSelfPatch(candidate(), contract, cluster, { author: "agent" });
  assert.equal(patch.created, null);
  assert.equal(patch.requires, "human-gate");
  assert.deepEqual(patch.blast_radius, { surfaces: ["CLAUDE.md"], files_changed: 1, lines_changed: 2 });
  assert.equal(patch.meta.flywheel.clusterId, "cl_1");
});
