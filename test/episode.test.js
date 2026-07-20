import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { segmentRecords } from "../src/harvest/segment.js";
import { extractSteps } from "../src/harvest/steps.js";
import { buildEpisode } from "../src/harvest/episode.js";
import { errorSignature } from "../src/harvest/signature.js";
import { validateEpisode } from "../src/schema.js";

const fixture = readFileSync(new URL("../fixtures/transcripts/episode-with-errors.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const shell = () => segmentRecords(fixture)[0];
const bash = (command, ok, extra = {}) => ({ tool: "Bash", input: { command }, ok, exitCode: ok ? 0 : 1, errorText: ok ? "" : "1 failing test", harnessError: false, interrupted: false, ...extra });

test("buildEpisode produces a valid episode from the real fixture", () => {
  const group = shell();
  assert.equal(validateEpisode(buildEpisode(group, extractSteps(group), { project: "fixture" })).valid, true);
});

test("a later successful command-head recovers a failing signature", () => {
  const failed = bash("npm test", false);
  const ep = buildEpisode(shell(), [failed, bash("npm test", true)]);
  assert.ok(ep.signals.recovered_signatures.includes(errorSignature(failed)));
  assert.ok(!ep.signals.unrecovered_signatures.includes(errorSignature(failed)));
  assert.equal(ep.failure, null);
});

test("an unretried failure drives failure and gets a replayable witness", () => {
  const failed = bash("npm test", false);
  const ep = buildEpisode(shell(), [failed]);
  assert.ok(ep.signals.unrecovered_signatures.includes(errorSignature(failed)));
  assert.equal(ep.failure.signature, errorSignature(failed));
  assert.equal(ep.failure.witness.replayable, true);
});

test("fresh episodes remain unlabeled at the unknown tier", () => {
  assert.equal(buildEpisode(shell(), []).outcome.tier, "unknown");
});

test("harness refusals are not replayable", () => {
  const ep = buildEpisode(shell(), [bash("rm file", false, { harnessError: true })]);
  assert.equal(ep.failure.witness.replayable, false);
});

test("repeat_command_max only counts consecutive identical command heads", () => {
  const ep = buildEpisode(shell(), [bash("npm test", true), bash("npm test -- --run", true), bash("git status", true), bash("npm test", true)]);
  assert.equal(ep.signals.repeat_command_max, 2);
});

test("episode ids are stable across reruns", () => {
  assert.equal(buildEpisode(shell(), []).id, buildEpisode(shell(), []).id);
});

test("a user-rejected tool result is counted but cannot drive failure", () => {
  const step = bash("deploy", false, { errorText: "The user doesn't want to proceed with this tool use. The tool use was rejected" });
  const ep = buildEpisode(shell(), [step]);
  assert.equal(ep.failure, null);
  assert.ok(ep.signals.errored_tool_results >= 1);
  assert.ok(ep.signals.non_agent_faults >= 1);
  assert.equal(ep.signals.unrecovered_signatures.length, 0);
});

test("a benign non-zero is counted but cannot drive failure", () => {
  const step = bash("grep -c foo file", false, { errorText: "0" });
  const ep = buildEpisode(shell(), [step]);
  assert.equal(ep.failure, null);
  assert.ok(ep.signals.errored_tool_results >= 1);
  assert.ok(ep.signals.benign_nonzero >= 1);
  assert.equal(ep.signals.unrecovered_signatures.length, 0);
});
