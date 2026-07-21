import { classifyRecord, isNoiseRecord } from "./records.js";

function blocks(rec) { return Array.isArray(rec?.message?.content) ? rec.message.content : []; }
function useful(rec) {
  if (blocks(rec).some((b) => b?.type === "tool_use")) return true;
  if (classifyRecord(rec).kind !== "assistant") return false;
  if (typeof rec?.message?.content === "string") return rec.message.content.trim().length > 0;
  return blocks(rec).some((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim());
}

export function segmentRecords(records, opts = {}) {
  if (!Array.isArray(records)) return [];
  const maxGroupRecords = Number.isInteger(opts?.maxGroupRecords) && opts.maxGroupRecords >= 1 ? opts.maxGroupRecords : Infinity;
  const valid = records.filter((r) => r !== null && typeof r === "object" && !Array.isArray(r));
  const byUuid = new Map(valid.filter((r) => typeof r.uuid === "string").map((r) => [r.uuid, r]));
  const memo = new Map();
  function resolve(rec) {
    if (rec.promptId != null) return String(rec.promptId);
    if (memo.has(rec)) return memo.get(rec);
    const visited = [];
    const seen = new Set();
    let cur = rec;
    let answer;
    for (let depth = 0; depth < 200; depth += 1) {
      if (!cur || seen.has(cur)) break;
      if (memo.has(cur)) { answer = memo.get(cur); break; }
      seen.add(cur); visited.push(cur);
      if (cur.promptId != null) { answer = String(cur.promptId); break; }
      cur = typeof cur.parentUuid === "string" ? byUuid.get(cur.parentUuid) : undefined;
    }
    for (const item of visited) memo.set(item, answer);
    return answer;
  }
  const groups = new Map();
  for (const rec of valid) {
    const info = classifyRecord(rec);
    const promptId = resolve(rec) ?? `_orphan:${info.sessionId ?? "unknown"}`;
    if (!groups.has(promptId)) groups.set(promptId, { promptId, records: [], sessionId: info.sessionId, truncated: false });
    const group = groups.get(promptId);
    if (group.records.length < maxGroupRecords) group.records.push(rec);
    else group.truncated = true;
    if (group.sessionId == null && info.sessionId != null) group.sessionId = info.sessionId;
  }
  return [...groups.values()].map((g) => ({ promptId: g.promptId, records: g.records.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? ""))), sessionId: g.sessionId, ...(g.truncated ? { truncated: true } : {}) }))
    .filter((g) => !g.records.every(isNoiseRecord) && g.records.some(useful));
}
