function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function safePosition(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function newRunManifest(runId) {
  return { run_id: safeText(runId), created: null, cursor: {}, counts: {} };
}

export function advanceCursor(manifest, file, bytePos) {
  try {
    const base = object(manifest) ? manifest : newRunManifest("");
    const name = safeText(file);
    const cursor = object(base.cursor) ? { ...base.cursor } : {};
    if (name) cursor[name] = Math.max(safePosition(cursor[name]), safePosition(bytePos));
    return { ...base, created: null, cursor, counts: object(base.counts) ? { ...base.counts } : {} };
  } catch {
    return newRunManifest("");
  }
}

export function mergeManifest(a, b) {
  try {
    const left = object(a) ? a : newRunManifest("");
    const right = object(b) ? b : newRunManifest("");
    const cursor = {};
    const keys = [...new Set([
      ...Object.keys(object(left.cursor) ? left.cursor : {}),
      ...Object.keys(object(right.cursor) ? right.cursor : {}),
    ])].sort();
    for (const key of keys) cursor[key] = Math.max(safePosition(left.cursor?.[key]), safePosition(right.cursor?.[key]));
    const counts = {};
    const countKeys = [...new Set([
      ...Object.keys(object(left.counts) ? left.counts : {}),
      ...Object.keys(object(right.counts) ? right.counts : {}),
    ])].sort();
    for (const key of countKeys) counts[key] = Math.max(safePosition(left.counts?.[key]), safePosition(right.counts?.[key]));
    const runIds = [safeText(left.run_id), safeText(right.run_id)].filter(Boolean).sort();
    return {
      run_id: runIds[0] ?? "",
      created: null,
      cursor,
      counts,
    };
  } catch {
    return newRunManifest("");
  }
}
