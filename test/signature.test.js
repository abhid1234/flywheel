import { test } from "node:test";
import assert from "node:assert/strict";

import { cmdHead, errorSignature, normalizeCommand, parseSignature } from "../src/harvest/signature.js";

const productionStep = {
  tool: "Bash",
  input: { command: "python3 -c \"import yaml; yaml.safe_load(open('~/.hermes/config.yaml'))\"" },
  errorText: "ModuleNotFoundError: No module named 'yaml'",
};

test("reproduces the production signature exactly", () => {
  assert.equal(errorSignature(productionStep), "bash:module_not_found:python3:yaml");
});

test("cmdHead drops flags and their quoted command bodies", () => {
  assert.equal(cmdHead({ tool: "Bash", input: { command: "python3 -c \"print('ok')\"" } }), "python3");
});

test("cmdHead retains an ordinary quoted argv token", () => {
  assert.equal(cmdHead({ tool: "Bash", input: { command: "echo \"hello world\"" } }), "echo hello world");
});

test("cmdHead strips a leading sudo", () => {
  assert.equal(cmdHead({ tool: "Bash", input: { command: "sudo git push --force" } }), "git push");
});

test("cmdHead normalizes real shell command forms", () => {
  const cases = [
    ["SCRATCH=/private/tmp/claude-501/xyz node build.js", "node build.js"],
    ["cd ~/Developer/Workspace/Claude/cockpit && git status", "git status"],
    ["systemsetup -getremotelogin 2>/dev/null; echo done", "systemsetup"],
    ["sleep 25; node bin/x.js", "sleep <N>"],
    ["python3 -c \"import yaml\" && echo ok", "python3"],
    ["sudo npm test", "npm test"],
    ["grep -c foo /Users/dev/x.txt", "grep <PATH>"],
    ["cd /tmp", "cd"],
  ];
  for (const [command, expected] of cases) {
    assert.equal(cmdHead({ tool: "Bash", input: { command } }), expected);
  }
});

test("signatures never expose machine-specific absolute paths", () => {
  const commands = [
    "/Users/dev/bin/tool /private/tmp/input.txt",
    "FOO=/private/cache cd /Users/dev/work && grep value /private/data/file",
    "sudo cat /Users/dev/secret",
  ];
  for (const command of commands) {
    const signature = errorSignature({ tool: "Bash", input: { command }, errorText: "failed" });
    assert.doesNotMatch(signature, /\/Users\/|\/private\//);
  }
});

test("normalizeCommand never throws on degenerate input", () => {
  for (const command of [null, undefined, "", ";;&&", "FOO=bar"]) {
    assert.doesNotThrow(() => normalizeCommand(command));
  }
});

test("Edit and Write use the file basename", () => {
  assert.equal(cmdHead({ tool: "Edit", input: { file_path: "/srv/app/index.js" } }), "index.js");
  assert.equal(cmdHead({ tool: "Write", input: { file_path: "C:\\work\\notes.txt" } }), "notes.txt");
});

test("parseSignature round-trips errorSignature", () => {
  assert.deepEqual(parseSignature(errorSignature(productionStep)), {
    tool: "bash",
    errorClass: "module_not_found",
    cmdHead: "python3",
    salient: "yaml",
  });
});

test("non-object signature input returns empty string without throwing", () => {
  assert.equal(errorSignature(null), "");
  assert.equal(errorSignature("bad input"), "");
  assert.equal(cmdHead(undefined), "");
});
