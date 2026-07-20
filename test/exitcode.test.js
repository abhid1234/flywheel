import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseToolResult } from "../src/harvest/exitcode.js";

const shapes = JSON.parse(readFileSync(new URL("../fixtures/transcripts/error-shapes.json", import.meta.url), "utf8"));

test("all forty real error shapes parse without throwing", () => {
  assert.equal(shapes.length, 40);
  for (const shape of shapes) {
    const parsed = parseToolResult(shape, null, true);
    assert.equal(typeof parsed, "object");
    assert.ok(Object.hasOwn(parsed, "exitCode"));
  }
});

test("explicit exit codes parse with and without separators", () => {
  assert.deepEqual(parseToolResult("Exit code 1\n---\ndev", null, true), { exitCode: 1, body: "dev", interrupted: false, harnessError: false });
  assert.equal(parseToolResult("Exit code 1\ntotal 0", null, true).exitCode, 1);
  assert.equal(parseToolResult("Exit code 1\nTraceback (most recent call last):", null, true).exitCode, 1);
  assert.equal(parseToolResult("Exit code 2\nshell: /bin/bash\n---", null, true).exitCode, 2);
});

test("harness refusal and interruption are distinct from shell exits", () => {
  const harness = parseToolResult("<tool_use_error>File has not been read yet.</tool_use_error>", null, true);
  assert.equal(harness.exitCode, null); assert.equal(harness.harnessError, true); assert.equal(harness.body, "File has not been read yet.");
  const interrupted = parseToolResult("partial", { interrupted: true }, true);
  assert.equal(interrupted.exitCode, null); assert.equal(interrupted.interrupted, true);
});

test("is_error infers failure and ordinary output infers success", () => {
  assert.equal(parseToolResult("failure", null, true).exitCode, 1);
  assert.equal(parseToolResult("success", null, false).exitCode, 0);
  assert.equal(parseToolResult([{ type: "text", text: "ok" }], null, false).body, "ok");
});
