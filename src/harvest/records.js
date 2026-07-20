function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function classifyRecord(rec) {
  if (!object(rec)) return { kind: "other" };
  const raw = rec.type ?? rec.message?.role;
  const kind = ["user", "assistant", "system"].includes(raw) ? raw : "other";
  return {
    kind,
    promptId: rec.promptId,
    parentUuid: rec.parentUuid,
    uuid: rec.uuid,
    sessionId: rec.sessionId,
    isSidechain: rec.isSidechain,
    timestamp: rec.timestamp,
  };
}

function textContent(rec) {
  const content = rec?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => object(b) && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

export function isNoiseRecord(rec) {
  if (!object(rec)) return false;
  if (rec.isMeta === true) return true;
  if (classifyRecord(rec).kind !== "user") return false;
  const text = textContent(rec).trim();
  if (/^<(?:local-command|command-name|command-message|bash-input|bash-stdout)\b/i.test(text)) return true;
  return /^\/[\w-]+(?:\s+.*)?$/.test(text);
}
