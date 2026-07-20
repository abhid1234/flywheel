import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractSteps } from "../src/harvest/steps.js";
import { segmentRecords } from "../src/harvest/segment.js";

const records = readFileSync(new URL("../fixtures/transcripts/episode-with-errors.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);

test("real tool calls join to their result records", () => {
  const steps = extractSteps(segmentRecords(records)[0]);
  assert.equal(steps.length, 4);
  assert.deepEqual(steps.map((s) => s.i), [0, 1, 2, 3]);
  assert.ok(steps.every((s) => s.tool && s.uuid));
  const error = steps.find((s) => s.exitCode === 1);
  assert.equal(error.ok, false); assert.ok(error.errorText.length > 0);
});

test("missing results remain unknown rather than failed", () => {
  const steps = extractSteps({ records: [{ uuid: "u", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } }] });
  assert.equal(steps[0].ok, null);
});

test("error text retains head and tail with truncation marker", () => {
  const output = `Exit code 1\n${"a".repeat(3000)}`;
  const shell = { records: [{ uuid: "a", timestamp: "1", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } }, { uuid: "b", timestamp: "2", toolUseResult: {}, message: { content: [{ type: "tool_result", tool_use_id: "t", content: output, is_error: true }] } }] };
  const text = extractSteps(shell)[0].errorText;
  assert.ok(text.includes("…[truncated]…"));
  assert.ok(text.startsWith("a".repeat(1024))); assert.ok(text.endsWith("a".repeat(1024)));
});
