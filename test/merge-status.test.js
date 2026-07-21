import { test } from "node:test";
import assert from "node:assert/strict";
import { goldFromMergeStatus } from "../src/label/merge_status.js";

const prior = { label: "fail", tier: "strong", method: "transcript", confidence: 0.9, evidence: [] };
const episode = (extra = {}) => ({ id: "e1", project: "repo", cwd: "/tmp/repo", request: { text: "work" }, steps: [], outcome: prior, ...extra });
const pr = (extra = {}) => ({ repo: "owner/repo", number: 10, headRefName: "impl-issue-10", merged: true, closedUnmerged: false, ...extra });

test("merge status branch linkage mints merged pass gold", () => {
  const result = goldFromMergeStatus([episode({ git_branch: "impl-issue-10" })], [pr()]);
  assert.equal(result.linked, 1);
  assert.deepEqual([result.goldPass, result.goldFail, result.unlinked], [1, 0, 0]);
  assert.deepEqual([result.episodes[0].outcome.label, result.episodes[0].outcome.tier, result.episodes[0].outcome.method], ["pass", "gold", "merge"]);
});

test("merge status issue/repo linkage mints closed-unmerged fail gold", () => {
  const result = goldFromMergeStatus([episode({ request: { text: "please fix #10" } })], [pr({ merged: false, closedUnmerged: true })]);
  assert.equal(result.goldFail, 1);
  assert.equal(result.episodes[0].outcome.label, "fail");
});

test("unlinked merge status preserves the transcript outcome", () => {
  const result = goldFromMergeStatus([episode()], [pr()]);
  assert.equal(result.unlinked, 1);
  assert.strictEqual(result.episodes[0].outcome, prior);
});

test("ambiguous branch stays unlinked and records why", () => {
  const result = goldFromMergeStatus([episode({ git_branch: "impl-issue-10" })], [pr(), pr({ repo: "other/repo", number: 11 })]);
  assert.equal(result.linked, 0);
  assert.equal(result.episodes[0].gold_link.reason, "ambiguous_branch");
  assert.strictEqual(result.episodes[0].outcome, prior);
});

test("merge-status labeling never throws on malformed inputs", () => {
  assert.doesNotThrow(() => goldFromMergeStatus(null, null));
  assert.doesNotThrow(() => goldFromMergeStatus([null, 3, {}], [null, 4]));
});
