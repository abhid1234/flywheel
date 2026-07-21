import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterKey, signatureParts } from "../src/cluster/key.js";
import { clusterEpisodes } from "../src/cluster/group.js";
import { isProposable, isReviewable, rankClusters } from "../src/cluster/rank.js";

function episode(id, signature, errorText, extra = {}) {
  return {
    id,
    session_id: `session-${id}`,
    project: extra.project ?? "project",
    started: extra.started ?? `2026-01-${String(Number(id.replace(/\D/g, "")) || 1).padStart(2, "0")}T00:00:00Z`,
    duration_ms: 1000,
    steps: [{ tool: "bash", input: { command: "npm test" }, ok: false, exitCode: 1, errorText }],
    signals: { errored_tool_results: 1, recovered_signatures: [] },
    outcome: { tier: extra.tier ?? "unknown" },
    failure: {
      signature,
      errorText,
      witness: extra.witness ?? { kind: "command", cmd: `npm test ${id}`, cwd: "/repo", observed_exit_code: 1, replayable: true },
    },
  };
}

test("cluster keys expose signatures and parsed parts safely", () => {
  assert.equal(clusterKey({ failure: { signature: "bash:timeout:npm test:" } }), "bash:timeout:npm test:");
  assert.equal(clusterKey(null), null);
  assert.deepEqual(signatureParts("bash:timeout:npm test:"), { tool: "bash", errorClass: "timeout", cmdHead: "npm test", salient: "" });
});

test("exact signatures form one pure cluster", () => {
  const signature = "bash:test_failure:npm test:2";
  const clusters = clusterEpisodes([1, 2, 3].map((id) => episode(`ep_${id}`, signature, "2 tests failed")));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].size, 3);
  assert.equal(clusters[0].created, null);
});

test("clusters record the most common episode cwd with lexical tie-breaking", () => {
  const signature = "bash:test_failure:npm test:cwd";
  const input = ["/a", "/a", "/a", "/b"].map((cwd, index) => ({ ...episode(`ep_${index + 1}`, signature, "failed"), cwd }));
  assert.equal(clusterEpisodes(input)[0].dominantCwd, "/a");
  const tied = ["/b", "/a"].map((cwd, index) => ({ ...episode(`ep_${index + 1}`, signature, "failed"), cwd }));
  assert.equal(clusterEpisodes(tied, { minSize: 1 })[0].dominantCwd, "/a");
});

test("near-identical errors merge within a tool and error class", () => {
  const common = "command timed out while waiting for worker response after build stage";
  const input = [
    episode("ep_1", "bash:timeout:npm test:a", `${common} alpha`),
    episode("ep_2", "bash:timeout:npm test:b", `${common} beta`),
    episode("ep_3", "bash:timeout:npm test:a", `${common} alpha`),
  ];
  const [cluster] = clusterEpisodes(input, { minSize: 2, jaccardThreshold: 0.8 });
  assert.deepEqual(cluster.mergedSignatures, ["bash:timeout:npm test:a", "bash:timeout:npm test:b"]);
  assert.equal(cluster.size, 3);
});

test("different error classes do not merge by default", () => {
  const input = [
    episode("ep_1", "bash:timeout:npm test:", "same descriptive failure words here"),
    episode("ep_2", "bash:file_not_found:npm test:x", "same descriptive failure words here"),
  ];
  const clusters = clusterEpisodes(input, { minSize: 1 });
  assert.equal(clusters.length, 2);
});

test("clustering is independent of episode input order", () => {
  const input = [
    episode("ep_1", "bash:timeout:npm test:a", "worker process timed out during test execution"),
    episode("ep_2", "bash:timeout:npm test:b", "worker process timed out during test execution"),
    episode("ep_3", "bash:timeout:npm test:a", "worker process timed out during test execution"),
  ];
  const project = (clusters) => clusters.map(({ id, members }) => ({ id, members }));
  assert.deepEqual(project(clusterEpisodes(input, { minSize: 1 })), project(clusterEpisodes([input[2], input[0], input[1]], { minSize: 1 })));
});

test("small groups are retained in one long-tail cluster", () => {
  const clusters = clusterEpisodes([
    episode("ep_1", "bash:timeout:a:", "timed out waiting for alpha"),
    episode("ep_2", "bash:file_not_found:b:x", "missing entirely unrelated beta file"),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].id, "cl_longtail");
  assert.equal(clusters[0].isLongTail, true);
  assert.deepEqual(clusters[0].members, ["ep_1", "ep_2"]);
});

test("witnesses include only unique replayable failures and are capped at five", () => {
  const signature = "bash:timeout:npm test:";
  const input = Array.from({ length: 8 }, (_, index) => episode(`ep_${index + 1}`, signature, "command timed out", {
    witness: index === 6
      ? { kind: "command", cmd: "blocked", cwd: "/repo", replayable: false }
      : { kind: "command", cmd: index === 7 ? "npm test ep_1" : `npm test ep_${index + 1}`, cwd: "/repo", observed_exit_code: 1, replayable: true },
  }));
  const [cluster] = clusterEpisodes(input);
  assert.equal(cluster.witnesses.length, 5);
  assert.ok(cluster.witnesses.every((witness) => witness.replayable));
  assert.equal(cluster.witnesses[0].observedExitCode, 1);
});

test("ranking ties have a total deterministic order", () => {
  const base = { size: 3, cost: { terminal: 3, wastedMs: 0 }, span: { projects: 1 }, tierCounts: { unknown: 3 }, witnesses: [] };
  const ranked = rankClusters([{ ...base, id: "cl_b", signature: "b" }, { ...base, id: "cl_a", signature: "a" }]);
  assert.deepEqual(ranked.map((cluster) => cluster.signature), ["a", "b"]);
});

test("the longtail residual bucket never outranks a real cluster", () => {
  // The synthetic longtail bucket aggregates every singleton that did not cluster,
  // so its size is large by construction. It must not float above real clusters on
  // priority — every other seam (group append order, isReviewable, isProposable)
  // already treats isLongTail as "not a real cluster."
  const real = { id: "cl_real", signature: "bash:timeout:x", size: 4, cost: { terminal: 4, wastedMs: 0 }, span: { projects: 2 }, tierCounts: { strong: 4 }, witnesses: [{ replayable: true }], isLongTail: false };
  const tail = { id: "cl_longtail", signature: "longtail", size: 21, cost: { terminal: 21, wastedMs: 0 }, span: { projects: 3 }, tierCounts: { strong: 21 }, witnesses: [], isLongTail: true };
  const ranked = rankClusters([tail, real]);
  assert.equal(ranked[0].id, "cl_real");
  assert.equal(ranked.at(-1).id, "cl_longtail");
});

test("multiple longtail buckets still sort after every real cluster", () => {
  const real = { id: "cl_real", signature: "a", size: 3, cost: { terminal: 3, wastedMs: 0 }, span: { projects: 1 }, tierCounts: { strong: 3 }, witnesses: [], isLongTail: false };
  const t1 = { id: "cl_t1", signature: "longtail", size: 40, cost: { terminal: 40, wastedMs: 0 }, span: { projects: 1 }, tierCounts: { strong: 40 }, witnesses: [], isLongTail: true };
  const t2 = { id: "cl_t2", signature: "longtail", size: 30, cost: { terminal: 30, wastedMs: 0 }, span: { projects: 1 }, tierCounts: { strong: 30 }, witnesses: [], isLongTail: true };
  const ranked = rankClusters([t1, real, t2]);
  assert.equal(ranked[0].id, "cl_real");
  assert.ok(ranked.slice(1).every((cluster) => cluster.isLongTail === true));
});

test("unknown-tier clusters cannot be proposed even when large and replayable", () => {
  const cluster = {
    size: 6,
    tierCounts: { gold: 0, strong: 0, weak: 0, unknown: 6 },
    witnesses: [{ replayable: true }],
    isLongTail: false,
  };
  assert.equal(isProposable(cluster), false);
});

test("a recurring trusted cluster without a witness is reviewable but not proposable", () => {
  const cluster = { size: 3, tierCounts: { gold: 3 }, witnesses: [] };
  assert.equal(isReviewable(cluster), true);
  assert.equal(isProposable(cluster), false);
});

test("small and long-tail clusters are neither reviewable nor proposable", () => {
  const small = { size: 2, tierCounts: { gold: 2 }, witnesses: [{ replayable: true }] };
  const tail = { size: 3, tierCounts: { gold: 3 }, witnesses: [{ replayable: true }], isLongTail: true };
  for (const cluster of [small, tail]) {
    assert.equal(isReviewable(cluster), false);
    assert.equal(isProposable(cluster), false);
  }
});
