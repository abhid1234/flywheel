// Sole permitted `node:` import in src/: hashing requires Node's crypto primitive.
import { createHash } from "node:crypto";

export function sha256hex(input) {
  let text;
  try {
    text = typeof input === "string" ? input : String(input ?? "");
  } catch {
    text = "";
  }
  return createHash("sha256").update(text).digest("hex");
}

export function canonicalize(value) {
  const seen = new Set();
  function visit(v, inArray = false) {
    if (v === undefined || typeof v === "function" || typeof v === "symbol") {
      return inArray ? "null" : undefined;
    }
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
    if (typeof v === "bigint") return JSON.stringify(String(v));
    if (typeof v !== "object") return JSON.stringify(String(v));
    if (seen.has(v)) return "null";
    seen.add(v);
    let result;
    if (Array.isArray(v)) {
      result = `[${v.map((item) => visit(item, true) ?? "null").join(",")}]`;
    } else {
      const parts = [];
      for (const key of Object.keys(v).sort()) {
        let item;
        try { item = visit(v[key]); } catch { item = undefined; }
        if (item !== undefined) parts.push(`${JSON.stringify(key)}:${item}`);
      }
      result = `{${parts.join(",")}}`;
    }
    seen.delete(v);
    return result;
  }
  try { return visit(value, true) ?? "null"; } catch { return "null"; }
}

export function contentId(prefix, value) {
  const safePrefix = typeof prefix === "string" ? prefix : String(prefix ?? "");
  return `${safePrefix}_sha256:${sha256hex(canonicalize(value)).slice(0, 16)}`;
}
