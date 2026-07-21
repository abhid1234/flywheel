import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const hook = new URL("../hooks/capture.js", import.meta.url).pathname;

function capture(event) {
  const home = mkdtempSync(path.join(tmpdir(), "flywheel-capture-"));
  const result = spawnSync(process.execPath, [hook], {
    input: typeof event === "string" ? event : JSON.stringify(event), encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 5000,
  });
  let lines = [];
  try { lines = readFileSync(path.join(home, ".flywheel", "live-capture.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch {}
  return { result, lines };
}

test("capture records clean Bash failure and success exit codes", () => {
  const failed = capture({ tool_name: "Bash", tool_input: { command: "node --test" }, tool_response: "Exit code 1\nfailed", session_id: "s", cwd: "/tmp" });
  assert.equal(failed.result.status, 0, failed.result.stderr);
  assert.equal(failed.lines[0].ok, false);
  assert.equal(failed.lines[0].exit_code, 1);
  const passed = capture({ tool_name: "Bash", tool_input: { command: "node --test" }, tool_output: { exitCode: 0, stdout: "ok" }, session_id: "s", cwd: "/tmp" });
  assert.equal(passed.lines[0].ok, true);
  assert.equal(passed.lines[0].exit_code, 0);
});

test("capture exits zero on malformed and empty input", () => {
  for (const input of ["", "not json", "[]"]) assert.equal(capture(input).result.status, 0);
});

test("capture redacts paths and secrets from the stored line", () => {
  const { lines } = capture({ tool_name: "Bash", tool_input: { command: "cat /Users/x/secret", token: "sk-abcdefghijklmnop" }, tool_response: "Exit code 0 /Users/x/secret sk-abcdefghijklmnop", session_id: "s", cwd: "/Users/x/secret" });
  const line = JSON.stringify(lines[0]);
  assert.doesNotMatch(line, /\/Users\/x\/secret/);
  assert.doesNotMatch(line, /sk-abcdefghijklmnop/);
});
