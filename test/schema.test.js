import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEpisode } from "../src/schema.js";

const valid = () => ({ id: "ep_1", schema: "flywheel.episode.v1", session_id: "s", prompt_id: "p", agent_id: "main", cwd: "/tmp", started: "2026-01-01T00:00:00Z", steps: [], signals: {}, outcome: { label: "pass", tier: "gold" } });

test("a structurally valid episode passes", () => assert.deepEqual(validateEpisode(valid()), { valid: true, errors: [] }));

test("missing outcome.tier fails as a structural guard", () => {
  const ep = valid(); delete ep.outcome.tier;
  const result = validateEpisode(ep);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "outcome.tier" && e.code === "required"));
});

test("episode validation collects all errors and never throws", () => {
  const result = validateEpisode({ id: "", schema: 2, outcome: { label: "maybe", extra: true }, surprise: 1 });
  assert.ok(result.errors.length >= 9);
  assert.ok(result.errors.some((e) => e.code === "unknown_field"));
  assert.deepEqual(validateEpisode(null).errors[0].code, "not_object");
});
