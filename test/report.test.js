import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAtlas, renderAtlasHtml } from "../src/report/atlas.js";

function episode(id, label, tier, signature, extra = {}) {
  return {
    id, session_id: `session-${id}`, project: extra.project ?? "demo", started: extra.started ?? "2026-01-01T12:00:00Z",
    request: { text: extra.request ?? `request ${id}` }, steps: extra.steps ?? [], signals: extra.signals ?? {},
    outcome: { label, tier, method: "transcript" },
    failure: signature ? { signature, mode: signature.split(":")[1], errorText: extra.error ?? "failed", witness: extra.witness ?? { replayable: false } } : null,
  };
}

test("buildAtlas computes totals, tiers, failure rate, and sorted error classes", () => {
  const episodes = [
    episode("1", "fail", "strong", "Bash:test_failure:npm test"),
    episode("2", "pass", "weak"),
    episode("3", "fail", "gold", "Bash:test_failure:npm test", { witness: { replayable: true } }),
    episode("4", "fail", "strong", "Edit:permission_denied:file"),
    episode("5", "unknown", "unknown"),
  ];
  const atlas = buildAtlas(episodes, []);
  assert.deepEqual(atlas.totals, { episodes: 5, failures: 3, witnessedFailures: 3, weakSignalFailures: 0, passes: 1, unknown: 1, replayableWitnesses: 1, projects: 1, sessions: 5 });
  assert.deepEqual(atlas.tierBreakdown, { gold: 1, strong: 2, weak: 1, unknown: 1 });
  assert.equal(atlas.failureRate, 3 / 4);
  assert.deepEqual(atlas.byErrorClass, [
    { errorClass: "test_failure", count: 2, pct: 2 / 3 },
    { errorClass: "permission_denied", count: 1, pct: 1 / 3 },
  ]);
});

test("buildAtlas separates witnessed failures from weak-signal failures", () => {
  const witnessed = [
    episode("1", "fail", "strong", "Bash:module_not_found:npm test"),
    episode("2", "fail", "strong", "Bash:module_not_found:npm test"),
  ];
  const weak = [
    episode("3", "fail", "weak", null, { signals: { api_errors: 1 } }),
    episode("4", "fail", "weak", null, { signals: { interrupted: true } }),
    episode("5", "fail", "weak", null, { signals: { repeat_command_max: 3 } }),
  ];
  const atlas = buildAtlas([...witnessed, ...weak], []);
  assert.equal(atlas.totals.witnessedFailures, 2);
  assert.equal(atlas.totals.weakSignalFailures, 3);
  assert.equal(atlas.totals.failures, 5);
  assert.deepEqual(atlas.byErrorClass, [{ errorClass: "module_not_found", count: 2, pct: 1 }]);
  assert.deepEqual(atlas.weakSignalBreakdown, [
    { signal: "api_error", count: 1 }, { signal: "interrupted", count: 1 }, { signal: "stuck_retry", count: 1 },
  ]);
  const html = renderAtlasHtml(atlas);
  assert.match(html, /3 weak-signal failures/);
  assert.match(html, /chart shows only WITNESSED failures/);
});

test("cluster exemplars are truncated and redact paths and secrets", () => {
  const planted = episode("1", "fail", "strong", "Bash:test_failure:npm test", {
    request: "inspect /Users/x/secret with sk-1234567890abcdef",
    error: "failure at /Users/x/secret token sk-abcdefghijklmno",
  });
  const cluster = { id: "c", signature: "Bash:test_failure:npm test", errorClass: "test_failure", mode: "test_failure", members: ["1"], size: 1, tierCounts: { strong: 1 }, witnesses: [] };
  const serialized = JSON.stringify(buildAtlas([planted], [cluster]).topClusters);
  assert.doesNotMatch(serialized, /\/Users\/x\/secret|sk-1234567890abcdef|sk-abcdefghijklmno/);
  assert.match(serialized, /<PATH>|<SECRET>/);
});

test("buildAtlas is deterministic", () => {
  const episodes = [episode("1", "fail", "strong", "Bash:test_failure:npm test")];
  const clusters = [{ id: "c", signature: "Bash:test_failure:npm test", members: ["1"], size: 1, tierCounts: { strong: 1 }, witnesses: [], created: new Date().toISOString() }];
  assert.deepEqual(buildAtlas(episodes, clusters), buildAtlas(episodes, clusters));
});

test("HTML surfaces honesty caveats and escapes episode text", () => {
  const malicious = episode("1", "fail", "strong", "Bash:test_failure:npm test", { request: '<script>alert("owned")</script>' });
  const cluster = { signature: "Bash:test_failure:npm test", errorClass: "test_failure", members: ["1"], size: 1, tierCounts: { strong: 1 }, witnesses: [] };
  const html = renderAtlasHtml(buildAtlas([malicious], [cluster]));
  assert.match(html, /labels are transcript-derived proxies/);
  assert.match(html, /0 weak-signal failures/);
  assert.match(html, /chart shows only WITNESSED failures/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});

test("atlas building and rendering never throw on empty or invalid corpora", () => {
  assert.doesNotThrow(() => buildAtlas([], []));
  assert.doesNotThrow(() => buildAtlas(null, { nope: true }));
  const atlas = buildAtlas([], []);
  assert.equal(atlas.totals.episodes, 0);
  assert.equal(atlas.failureRate, 0);
  assert.doesNotThrow(() => renderAtlasHtml(atlas));
});
