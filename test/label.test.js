import { test } from "node:test";
import assert from "node:assert/strict";
import { labelFromTranscript, labelSession } from "../src/label/transcript.js";
import { labelFromFactoryEpisode } from "../src/label/factory.js";
import { TIER_RANK, capTierForSidechain, mergeOutcomes } from "../src/label/merge.js";

const base = (extra = {}) => ({
  started: "2026-01-01T00:00:00Z",
  ended: "2026-01-01T00:01:00Z",
  request: { text: "do the work" },
  steps: [],
  artifacts: { files_edited: [], files_written: [] },
  signals: { api_errors: 0, interrupted: false, repeat_command_max: 0, errored_tool_results: 0 },
  failure: null,
  ...extra,
});
const edit = { i: 0, tool: "Edit", input: { file_path: "a.js" }, exitCode: 0, ok: true };
const factory = (extra = {}) => ({
  terminal_state: "shipped", tests_ok: true, override_applied: "none",
  tests_source: "tap-json", review_parse_ok: true, rework_attempt: 0, ...extra,
});

test("transcript rules 1-5 are ordered and auditable", () => {
  const green = { i: 1, tool: "Bash", input: { command: "npm test" }, exitCode: 0, ok: true };
  const failed = { i: 0, tool: "Bash", input: { command: "npm test" }, exitCode: 1, ok: false, errorText: "test assertion failed" };
  const rule1 = labelFromTranscript(base({ steps: [failed, green], artifacts: { files_edited: ["a.js"] }, failure: { signature: "assertion:test" } }));
  assert.equal(rule1.tier, "strong"); assert.equal(rule1.label, "fail"); assert.equal(rule1.method, "transcript.unrecovered_terminal_error");
  const rule2 = labelFromTranscript(base({ steps: [edit, green], artifacts: { files_edited: ["a.js"] } }));
  assert.equal(rule2.tier, "strong"); assert.equal(rule2.method, "transcript.verified_green");
  const rule3 = labelFromTranscript(base({ signals: { api_errors: 1, errored_tool_results: 0 } }));
  assert.equal(rule3.tier, "weak"); assert.equal(rule3.method, "transcript.weak_signal");
  const rule4 = labelFromTranscript(base({ steps: [edit], artifacts: { files_edited: ["a.js"] } }));
  assert.equal(rule4.tier, "weak"); assert.equal(rule4.method, "transcript.clean_edit");
  const rule5 = labelFromTranscript(base());
  assert.equal(rule5.tier, "unknown"); assert.equal(rule5.method, "transcript.insufficient");
});

test("user rebukes are weak-only and expire after 120 seconds", () => {
  const strong = base({ steps: [edit, { tool: "Bash", input: { command: "node --test" }, exitCode: 0 }], artifacts: { files_edited: ["a.js"] } });
  const rebuke = base({ started: "2026-01-01T00:02:30Z", request: { text: "No, that is not right" } });
  const labeled = labelSession([strong, rebuke]);
  assert.equal(labeled[0].tier, "weak"); assert.equal(labeled[0].label, "fail"); assert.equal(labeled[0].method, "transcript.user_rebuke");
  const late = { ...rebuke, started: "2026-01-01T00:03:01Z" };
  assert.equal(labelSession([strong, late])[0].tier, "strong");
});

test("factory labels terminal facts gold and independently demotes leakage risks", () => {
  assert.deepEqual([labelFromFactoryEpisode(factory()).label, labelFromFactoryEpisode(factory()).tier], ["pass", "gold"]);
  assert.deepEqual([labelFromFactoryEpisode(factory({ terminal_state: "needs-human" })).label, labelFromFactoryEpisode(factory({ terminal_state: "needs-human" })).tier], ["fail", "gold"]);
  assert.deepEqual([labelFromFactoryEpisode(factory({ rework_attempt: 1 })).label, labelFromFactoryEpisode(factory({ rework_attempt: 1 })).tier], ["fail", "gold"]);
  for (const risky of [{ override_applied: "empty-blocking-green-tests" }, { tests_source: "prose" }, { review_parse_ok: false }]) {
    const result = labelFromFactoryEpisode(factory(risky));
    assert.equal(result.tier, "weak"); assert.equal(result.method, "factory.demoted_unverifiable");
  }
});

test("merge selects tier, confidence, then ascending method deterministically", () => {
  const make = (tier, confidence, method) => ({ label: "pass", tier, confidence, method, evidence: [] });
  assert.deepEqual(TIER_RANK, { gold: 3, strong: 2, weak: 1, unknown: 0 });
  assert.equal(mergeOutcomes([make("unknown", 1, "z"), make("weak", 0, "z"), make("strong", 0, "z"), make("gold", 0, "z")]).tier, "gold");
  assert.equal(mergeOutcomes([make("strong", 0.4, "a"), make("strong", 0.8, "z")]).confidence, 0.8);
  assert.equal(mergeOutcomes([make("strong", 0.8, "z"), make("strong", 0.8, "a")]).method, "a");
});

test("sidechain cap only lowers gold and public functions never throw on garbage", () => {
  const gold = { label: "pass", tier: "gold", confidence: 1, method: "x", evidence: [] };
  const weak = { ...gold, tier: "weak" };
  assert.equal(capTierForSidechain(gold).tier, "strong");
  assert.strictEqual(capTierForSidechain(weak), weak);
  for (const value of [null, undefined, 3, "bad", {}, []]) {
    assert.doesNotThrow(() => labelFromTranscript(value));
    assert.doesNotThrow(() => labelSession(value));
    assert.doesNotThrow(() => labelFromFactoryEpisode(value));
    assert.doesNotThrow(() => mergeOutcomes(value));
    assert.doesNotThrow(() => capTierForSidechain(value));
  }
});

