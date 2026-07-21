#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { createHash } from "node:crypto";
import { cmdHead } from "../src/harvest/signature.js";

const LIMIT = 50 * 1024 * 1024;

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function redact(value) {
  if (typeof value === "string") return value
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, "<SECRET>")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=<SECRET>")
    .replace(/(?:\/[A-Za-z0-9_.@%+,:=~-]+)+/g, "<PATH>");
  if (Array.isArray(value)) return value.map(redact);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
}

function outputText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(outputText).filter(Boolean).join("\n");
  if (!object(value)) return "";
  for (const key of ["output", "stdout", "stderr", "content", "text", "message"]) {
    const text = outputText(value[key]);
    if (text) return text;
  }
  return "";
}

function findField(value, names, seen = new Set()) {
  if (!object(value) || seen.has(value)) return undefined;
  seen.add(value);
  for (const name of names) if (Object.hasOwn(value, name)) return value[name];
  for (const child of Object.values(value)) {
    if (object(child)) {
      const found = findField(child, names, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function exitCode(result, isError) {
  const structured = findField(result, ["exitCode", "exit_code"]);
  if (Number.isInteger(structured)) return structured;
  if (typeof structured === "string" && /^-?\d+$/.test(structured.trim())) return Number(structured);
  const match = /^\s*Exit code\s+(-?\d+)\b/i.exec(outputText(result));
  if (match) return Number(match[1]);
  return isError ? 1 : 0;
}

function digest(value) {
  const safe = JSON.stringify(redact(value ?? null));
  return createHash("sha256").update(safe).digest("hex").slice(0, 16);
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return;
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  if (!object(event)) return;
  const tool = typeof event.tool_name === "string" ? event.tool_name : (typeof event.tool === "string" ? event.tool : "unknown");
  const input = object(event.tool_input) ? event.tool_input : (object(event.input) ? event.input : {});
  const result = event.tool_response ?? event.tool_output ?? event.result ?? event.output;
  const isError = event.is_error === true || findField(result, ["is_error", "isError"]) === true;
  const code = /^(bash|shell|terminal)$/i.test(tool) ? exitCode(result, isError) : (isError ? 1 : 0);
  const row = redact({
    ts: typeof event.timestamp === "string" && Number.isFinite(Date.parse(event.timestamp)) ? event.timestamp : new Date().toISOString(),
    session_id: String(event.session_id ?? event.sessionId ?? "unknown"),
    cwd: String(event.cwd ?? input.cwd ?? "unknown"),
    tool,
    ok: code === 0 && !isError,
    exit_code: code,
    is_error: isError,
    cmd_head: cmdHead({ tool, input }),
    input_digest: digest(input),
  });
  const home = process.env.HOME;
  if (!home) return;
  const directory = path.join(home, ".flywheel");
  const file = path.join(directory, "live-capture.jsonl");
  mkdirSync(directory, { recursive: true });
  if (existsSync(file) && statSync(file).size > LIMIT) {
    try { renameSync(file, `${file}.1`); } catch {}
  }
  appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: "utf8" });
}

try { await main(); } catch {}
process.exitCode = 0;
