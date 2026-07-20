import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENT_FAULT_CLASSES, ERROR_CLASSES, classifyError, isBenignNonZero, normalizeErrorText } from "../src/harvest/normalize.js";

test("normalization makes volatile runs identical", () => {
  const first = "Failed at /Users/alice/project/app.js pid 1234 on 2026-07-19T12:00:00.000Z";
  const second = "Failed at /Users/bob/project/app.js pid 9876 on 2027-08-20T13:01:02.999Z";
  assert.equal(normalizeErrorText(first), normalizeErrorText(second));
});

test("UUID is replaced as one token before hex blobs", () => {
  assert.equal(normalizeErrorText("id 550e8400-e29b-41d4-a716-446655440000"), "id <UUID>");
});

test("normalization rejects non-string input", () => {
  assert.equal(normalizeErrorText(null), "");
  assert.equal(normalizeErrorText({}), "");
});

const classificationCases = [
  ["user_rejected", "The user doesn't want to proceed with this tool use. The tool use was rejected", ""],
  ["tool_unavailable", "Error: No such tool available: SendUserFile. SendUserFile exists but is not enabled in this context.", ""],
  ["harness_precondition", "File has not been read yet. Read it first before writing to it.", ""],
  ["stale_reference", "Task bygd9yt3o is not running (status: completed)", ""],
  ["wrong_invocation", "remote-control is a UI command, not a skill. Ask the user to run /remote-control themselves", ""],
  ["edit_no_match", "String to replace not found in file. String: ...", ""],
  ["module_not_found", "ModuleNotFoundError: No module named 'yaml'", "yaml"],
  ["command_not_found", "deployctl: command not found", "deployctl"],
  ["file_not_found", "ENOENT: no such file or directory, open '/srv/app/config.json'", "config.json"],
  ["permission", "EACCES: permission denied, open '/etc/hosts'", ""],
  ["test_failure", "12 tests failed in integration suite", "12"],
  ["type_error", "src/index.ts(4,2): error TS2345: invalid argument", "2345"],
  ["syntax_error", "SyntaxError: unexpected end of input", ""],
  ["network", "connect ECONNREFUSED 127.0.0.1:5432", ""],
  ["git_conflict", "CONFLICT (content): Merge conflict in README.md", ""],
  ["timeout", "Command timed out after 30 seconds", ""],
  ["lint", "eslint found 3 problems", ""],
  ["other", "worker exited for an unknown reason", ""],
];

for (const [errorClass, text, salient] of classificationCases) {
  test(`classifies realistic ${errorClass} output`, () => {
    assert.deepEqual(classifyError(text), { errorClass, salient });
  });
}

test("all ordered error classes have a classification case", () => {
  assert.deepEqual(classificationCases.map(([name]) => name), ERROR_CLASSES);
});

test("file_not_found recognizes both shell and tool-level wording", () => {
  assert.equal(classifyError("ENOENT: no such file or directory").errorClass, "file_not_found");
  assert.equal(classifyError("File does not exist. Note: your current working directory is /Users/...").errorClass, "file_not_found");
});

test("non-agent fault classes exclude user choices, unavailable tools, and races", () => {
  assert.equal(AGENT_FAULT_CLASSES.has("user_rejected"), false);
  assert.equal(AGENT_FAULT_CLASSES.has("tool_unavailable"), false);
  assert.equal(AGENT_FAULT_CLASSES.has("stale_reference"), false);
});

test("recognizes conservative benign exit-one cases", () => {
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "0", command: "grep -c foo file" }), true);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "=== git state ===\n?? ops/script.sh", command: "git status | grep changed" }), true);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "missing", command: "command -v x || echo missing" }), true);
  assert.equal(isBenignNonZero({ exitCode: 2, errorText: "shell: /bin/bash\n---", command: 'echo "shell: $SHELL"; ls -la ~/.zshrc 2>/dev/null; echo "---"; grep -nE "KEY" ~/.zshrc' }), true);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "total 552\ndrwxr-xr-x@  6 abhijitdas  staff  192 19 Jul 13:54 .\ndrwx------@ 18 ...", command: 'ls -la ~/Desktop/"Founder Letters"/ 2>/dev/null; echo "---SCRATCHPAD---"; ls -la /tmp/missing' }), true);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "=== x ===\n---", command: "diagnostic" }), true);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "   \n", command: "diagnostic" }), true);
});

test("scans output, not diagnostic commands, for error-shaped tokens", () => {
  assert.equal(isBenignNonZero({
    exitCode: 1,
    errorText: "total 552\ndrwxr-xr-x@ 6 ...",
    command: 'ls -la ~/.bash_profile ~/.zshrc 2>&1 | grep -v "No such"; echo "---"; grep -n x f',
  }), true);
  assert.equal(isBenignNonZero({
    exitCode: 1,
    errorText: "/Users/example/.claude/skills/browse/SKILL.md",
    command: 'ls ~/.claude/skills/browse/ 2>/dev/null | head; grep -l "goto" ~/.claude/skills/browse/*',
  }), true);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "0", command: 'grep -c "Error" logfile' }), true);
});

test("retains error-shaped and unexpected non-zero exits", () => {
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "Traceback", command: "grep foo file" }), false);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "Permission denied", command: "grep foo file" }), false);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "No such file or directory", command: "ls missing" }), false);
  assert.equal(isBenignNonZero({ exitCode: 127, errorText: "plain output", command: "grep foo file" }), false);
  assert.equal(isBenignNonZero({ exitCode: 2, errorText: "Traceback", command: "grep foo file" }), false);
  assert.equal(isBenignNonZero({ exitCode: 1, errorText: "Error: broken", command: "grep foo file" }), false);
});

test("ETIMEDOUT is network rather than generic timeout", () => {
  assert.equal(classifyError("request failed: ETIMEDOUT").errorClass, "network");
});

test("unmatched text has other class and empty salient", () => {
  assert.deepEqual(classifyError("the operation failed mysteriously"), {
    errorClass: "other",
    salient: "",
  });
});
