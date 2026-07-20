import { classifyError } from "./normalize.js";

function commandSegments(command) {
  const segments = [];
  let start = 0;
  let quote = "";

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === "\\" && quote === '"') index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    const pair = command.slice(index, index + 2);
    if (char === ";" || char === "|" || pair === "&&") {
      segments.push(command.slice(start, index));
      index += pair === "&&" || pair === "||" ? 1 : 0;
      start = index + 1;
    }
  }
  segments.push(command.slice(start));
  return segments;
}

export function normalizeCommand(cmd) {
  try {
    if (typeof cmd !== "string") return "";
    let command = cmd;
    while (/^\s*[A-Z_][A-Z0-9_]*=\S+\s+/.test(command)) {
      command = command.replace(/^\s*[A-Z_][A-Z0-9_]*=\S+\s+/, "");
    }
    command = command.replace(/^\s*sudo(?:\s+|$)/, "");
    command = command.replace(/(?:\d+)?(?:>>?|<<?|>&)\s*(?:&\d+|[^\s;&|]+)|&>\s*[^\s;&|]+/g, "");

    const segments = commandSegments(command).map((segment) => segment.trim()).filter(Boolean);
    const useful = segments.find((segment) => !/^cd(?:\s|$)/.test(segment));
    const selected = useful ?? (segments.some((segment) => /^cd(?:\s|$)/.test(segment)) ? "cd" : "");
    return selected.trim().replace(/;+\s*$/, "").trim();
  } catch {
    return "";
  }
}

function scrubHead(head) {
  return head
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
    .replace(/~\/(?:[^\s]+)?/g, "<PATH>")
    .replace(/(?:\/[\w.@%+,:=~-]+)+/g, "<PATH>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<HASH>")
    .replace(/\b\d+\b/g, "<N>");
}

function shellTokens(command) {
  const tokens = [];
  const pattern = /"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g;
  let match;

  while ((match = pattern.exec(command)) !== null) {
    const raw = match[0];
    tokens.push({ value: raw.replace(/^(['"])([\s\S]*)\1$/, "$2"), quoted: /^["']/.test(raw) });
  }

  return tokens;
}

function basename(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return "";
  const parts = filePath.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || "";
}

export function cmdHead(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return "";
  if (typeof step.tool !== "string") return "";

  if (step.tool.toLowerCase() === "bash") {
    const command = step.input?.command;
    if (typeof command !== "string") return "";
    const tokens = shellTokens(normalizeCommand(command));

    const argv = [];
    for (let index = 0; index < tokens.length && argv.length < 2; index += 1) {
      const token = tokens[index];
      if (token.value.startsWith("-")) {
        // Interpreter -c flags consume the following source-code argument; it
        // describes the invocation but is not part of its stable command head.
        if (token.value === "-c") index += 1;
        continue;
      }
      argv.push(token.value);
    }
    return scrubHead(argv.join(" "));
  }

  if (["edit", "write", "read"].includes(step.tool.toLowerCase())) {
    const filePath = step.input?.file_path ?? step.input?.path ?? step.file_path ?? step.path;
    return basename(filePath);
  }

  return step.tool.toLowerCase();
}

export function errorSignature(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) return "";

  const tool = typeof step.tool === "string" ? step.tool.toLowerCase() : "";
  const errorText = typeof step.errorText === "string"
    ? step.errorText
    : (typeof step.error_text === "string" ? step.error_text : "");
  const { errorClass, salient } = classifyError(errorText);

  return `${tool}:${errorClass}:${cmdHead(step)}:${salient}`;
}

export function parseSignature(sig) {
  if (typeof sig !== "string") {
    return { tool: "", errorClass: "", cmdHead: "", salient: "" };
  }

  const parts = sig.split(":");
  if (parts.length <= 4) {
    const [tool = "", errorClass = "", head = "", salient = ""] = parts;
    return { tool, errorClass, cmdHead: head, salient };
  }

  // Tool and class are fixed at the front and salient is fixed at the end;
  // any unexpected extra colon-separated fields therefore belong to cmdHead.
  return {
    tool: parts[0],
    errorClass: parts[1],
    cmdHead: parts.slice(2, -1).join(":"),
    salient: parts.at(-1),
  };
}
