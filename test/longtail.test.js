import { test } from "node:test";
import assert from "node:assert/strict";
import { mineLongtail } from "../src/cluster/longtail.js";

function episode(id, tool, errorClass, error, extra = {}) {
  const signature = `${tool}:${errorClass}:command:${id}`;
  return {
    id,
    session_id: extra.session ?? `session-${id}`,
    project: extra.project ?? "demo",
    started: extra.started ?? `2026-01-${String(Number(id.replace(/\D/g, "")) || 1).padStart(2, "0")}T00:00:00Z`,
    request: { text: extra.request ?? `fix ${id}` },
    steps: [{ tool, ok: false, errorText: error }],
    outcome: { label: "fail", tier: "unknown" },
    failure: { signature, errorText: error },
  };
}

test("longtail loosely groups rare failures and summarizes true singletons", () => {
  const similar = [
    "worker cache failed during package build alpha",
    "worker cache failed during package build beta",
    "worker cache failed during package build gamma",
  ];
  const result = mineLongtail([
    ...similar.map((error, index) => episode(`ep_${index + 1}`, "bash", "runtime_error", error)),
    episode("ep_4", "bash", "runtime_error", "database socket refused immediately"),
    episode("ep_5", "read", "file_not_found", "configuration file vanished"),
    episode("ep_6", "write", "permission", "cannot overwrite protected target"),
  ]);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].size, 3);
  assert.deepEqual(result.groups[0].members, ["ep_1", "ep_2", "ep_3"]);
  assert.equal(result.loners.total, 3);
  assert.deepEqual(result.loners.byToolClass, [
    { tool: "bash", errorClass: "runtime_error", count: 1 },
    { tool: "read", errorClass: "file_not_found", count: 1 },
    { tool: "write", errorClass: "permission", count: 1 },
  ]);
});

test("longtail threshold is looser than exact-signature clustering", () => {
  const input = [
    episode("ep_1", "bash", "timeout", "worker cache failed during package build alpha"),
    episode("ep_2", "bash", "timeout", "worker cache failed during package build beta"),
  ];
  assert.equal(mineLongtail(input, { minSize: 3, jaccardThreshold: 0.5 }).groups.length, 1);
  assert.equal(mineLongtail(input, { minSize: 3, jaccardThreshold: 0.8 }).groups.length, 0);
});

test("longtail excludes episodes already belonging to a real cluster", () => {
  const recurring = [1, 2, 3].map((id) => ({
    ...episode(`real_${id}`, "bash", "timeout", "identical recurring timeout"),
    failure: { signature: "bash:timeout:command:same", errorText: "identical recurring timeout" },
  }));
  const result = mineLongtail([...recurring, episode("rare_1", "bash", "timeout", "unrelated lone timeout")]);
  assert.equal(result.groups.length, 0);
  assert.equal(result.loners.total, 1);
});

test("longtail is redacted, deterministic, and never throws", () => {
  const input = [
    episode("ep_2", "bash", "runtime_error", "build failed in /Users/alice/private sk-1234567890abcdef", { request: "inspect /Users/alice/private" }),
    episode("ep_1", "bash", "runtime_error", "build failed in /Users/bob/private sk-abcdefghijklmnop", { request: "inspect /Users/bob/private" }),
  ];
  const first = mineLongtail(input);
  assert.deepEqual(first, mineLongtail([...input].reverse()));
  assert.doesNotMatch(JSON.stringify(first), /Users|alice|bob|sk-123|sk-abc/);
  assert.deepEqual(mineLongtail(null), { groups: [], loners: { byToolClass: [], total: 0 } });
});
