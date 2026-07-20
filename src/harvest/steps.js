import { parseToolResult } from "./exitcode.js";

function blocks(rec) { return Array.isArray(rec?.message?.content) ? rec.message.content : []; }
function cap(text) {
  if (typeof text !== "string") return "";
  return text.length <= 2048 ? text : `${text.slice(0, 1024)} …[truncated]… ${text.slice(-1024)}`;
}

export function extractSteps(shell) {
  if (!shell || !Array.isArray(shell.records)) return [];
  const results = new Map();
  for (const rec of shell.records) for (const block of blocks(rec)) {
    if (block?.type === "tool_result" && typeof block.tool_use_id === "string" && !results.has(block.tool_use_id)) results.set(block.tool_use_id, { block, rec });
  }
  const steps = [];
  const usedResults = new Set();
  for (const rec of shell.records) for (const block of blocks(rec)) {
    if (block?.type !== "tool_use") continue;
    const found = results.get(block.id);
    if (!found) {
      steps.push({ i: steps.length, uuid: rec.uuid, parentUuid: rec.parentUuid, tool: block.name, input: block.input, ok: null, exitCode: null, interrupted: false, harnessError: false, errorText: "", bytesOut: 0, ts: rec.timestamp });
      continue;
    }
    usedResults.add(block.id);
    const parsed = parseToolResult(found.block.content, found.rec.toolUseResult, found.block.is_error);
    const body = typeof parsed.body === "string" ? parsed.body : "";
    const ok = parsed.exitCode === 0 && !parsed.harnessError && !parsed.interrupted;
    steps.push({ i: steps.length, uuid: rec.uuid, parentUuid: rec.parentUuid, tool: block.name, input: block.input, ok, exitCode: parsed.exitCode, interrupted: parsed.interrupted, harnessError: parsed.harnessError, errorText: ok ? "" : cap(body), bytesOut: new TextEncoder().encode(body).length, ts: rec.timestamp });
  }
  // A harvested window can begin after the originating call. Keep such result
  // failures rather than silently discarding useful evidence.
  for (const [id, found] of results) {
    if (usedResults.has(id)) continue;
    const parsed = parseToolResult(found.block.content, found.rec.toolUseResult, found.block.is_error);
    const body = typeof parsed.body === "string" ? parsed.body : "";
    const ok = parsed.exitCode === 0 && !parsed.harnessError && !parsed.interrupted;
    steps.push({ i: 0, uuid: found.rec.uuid, parentUuid: found.rec.parentUuid, tool: "unknown", input: null, ok, exitCode: parsed.exitCode, interrupted: parsed.interrupted, harnessError: parsed.harnessError, errorText: ok ? "" : cap(body), bytesOut: new TextEncoder().encode(body).length, ts: found.rec.timestamp });
  }
  steps.sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  steps.forEach((step, i) => { step.i = i; });
  return steps;
}
