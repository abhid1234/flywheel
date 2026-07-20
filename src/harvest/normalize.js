const CLASS_MATCHERS = [
  ["user_rejected", [/The user doesn't want to proceed with this tool use/i, /tool use was rejected/i]],
  ["tool_unavailable", [/No such tool available:/i, /tool exists but is not enabled in this context/i]],
  ["harness_precondition", [/File has not been read yet\. Read it first before writing to it\./i]],
  ["stale_reference", [/Task\s+\S+\s+is not running\s*\(status:\s*completed\)/i]],
  ["wrong_invocation", [/is a UI command, not a skill/i, /Ask the user to run \/[^\s]+ themselves/i]],
  ["edit_no_match", [/String to replace not found/i, /oldString.*not found/i]],
  ["module_not_found", [
    /ModuleNotFoundError:\s*No module named\s*['"]?([\w.\-]+)/i,
    /Cannot find module\s*['"]?([\w.\-/@]+)/i,
    /ImportError/i,
  ]],
  ["command_not_found", [
    /([\w.\-]+):\s*command not found/i,
    /command not found:\s*([\w.\-]+)/i,
    /:\s*not found\s*$/im,
  ]],
  ["file_not_found", [
    /File does not exist(?:\.|\b)/i,
    /ENOENT(?:[^\r\n]*?['"](?:[^'"/\\]*[/\\])*([^'"/\\]+)['"])?/i,
    /No such file or directory(?:[^\r\n]*?['"](?:[^'"/\\]*[/\\])*([^'"/\\]+)['"])?/i,
  ]],
  ["permission", [/EACCES/i, /EPERM/i, /Permission denied/i]],
  ["test_failure", [
    /(\d+)\s+(?:tests?|specs?)\s+failed/i,
    /^# fail\s+(\d+)/im,
    /AssertionError/i,
    /FAIL\s/i,
  ]],
  ["type_error", [/TS(\d{4})/i, /TypeError/i]],
  ["syntax_error", [/SyntaxError/i, /ParseError/i, /unexpected token/i]],
  ["network", [/ENOTFOUND/i, /ECONNREFUSED/i, /ETIMEDOUT/i, /getaddrinfo/i]],
  ["git_conflict", [/CONFLICT/i, /merge conflict/i, /non-fast-forward/i]],
  ["timeout", [/timed out/i, /Command timed out/i]],
  ["lint", [/eslint/i, /prettier/i, /lint error/i]],
];

export const ERROR_CLASSES = [
  "user_rejected",
  "tool_unavailable",
  "harness_precondition",
  "stale_reference",
  "wrong_invocation",
  "edit_no_match",
  "module_not_found",
  "command_not_found",
  "file_not_found",
  "permission",
  "test_failure",
  "type_error",
  "syntax_error",
  "network",
  "git_conflict",
  "timeout",
  "lint",
  "other",
];

// User rejection reflects a deliberate user choice, not an agent defect.
// Tool unavailability is an environment capability gap that an agent patch cannot fix.
// A stale reference is a timing race, not a defect in the agent's behavior.
export const AGENT_FAULT_CLASSES = new Set(ERROR_CLASSES.filter((errorClass) =>
  !["user_rejected", "tool_unavailable", "stale_reference"].includes(errorClass)));

const ERROR_SHAPED = /error|fail|not found|No such file|denied|Traceback|Exception|cannot|refused|invalid/i;
const BENIGN_COMMAND = /(?:^|[|;])\s*(?:grep\b|test\b|\[\s|diff\b|command\s+-v\b|which\b|pgrep\b|cmp\b)|\|\||;\s*true(?:\s|$)/i;
const STACK_TRACE_SHAPED = /(?:^|\n)\s*(?:at\s+\S+|File\s+["'][^"']+["'],\s+line\s+\d+)/;

export function isBenignNonZero({ exitCode, errorText, command } = {}) {
  try {
    if (![1, 2].includes(exitCode) || typeof errorText !== "string") return false;
    // The command can contain error-shaped text as data (for example,
    // `grep -v "No such"`). Only actual output is evidence of an error.
    const output = errorText.trim();
    if (ERROR_SHAPED.test(output)) return false;

    const lines = output.split(/\r?\n/).filter((line) => line.trim());
    const isDirectoryListing = lines.some((line) =>
      /^total \d+/.test(line) || /^[-dlbcps][rwx-]{9}/.test(line));
    const isBannerOnly = lines.length > 0 && lines.every((line) =>
      /^(?:---.*|===.*===|shell: .*)$/.test(line.trim()));
    const ordinary = lines.filter((line) => /^[\w./:@%+~=?,\-]+(?:\s+[\w./:@%+~=?,\-]+)*$/.test(line.trim()));
    const isShortPlainListing = lines.length > 0 && lines.length <= 40 &&
      !STACK_TRACE_SHAPED.test(output) && ordinary.length / lines.length >= 0.8;

    // Ordinary output is independently sufficient: chained diagnostics often
    // end with a missing grep match or optional path despite useful output.
    if (!output || isDirectoryListing || isBannerOnly || isShortPlainListing) return true;

    if (typeof command !== "string" || !BENIGN_COMMAND.test(command)) return false;
    if (/===.*===/.test(output)) return true;

    // Bias toward retaining failures: suppress only clearly ordinary listing/tabular output.
    return ordinary.length > 0 && ordinary.length / lines.length >= 0.8;
  } catch {
    return false;
  }
}

export function normalizeErrorText(s) {
  if (typeof s !== "string") return "";

  return s
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/(?:\/[\w.@%+,:=~-]+)+/g, "<PATH>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<HASH>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<TS>")
    .replace(/\b\d{3,}\b/g, "<N>")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyError(text) {
  if (typeof text !== "string") {
    return { errorClass: "other", salient: "" };
  }

  for (const [errorClass, matchers] of CLASS_MATCHERS) {
    for (const matcher of matchers) {
      const match = matcher.exec(text);
      if (match) {
        return {
          errorClass,
          salient: (match[1] || "").toLowerCase(),
        };
      }
    }
  }

  return { errorClass: "other", salient: "" };
}
