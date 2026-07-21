import { contentId, canonicalize } from "../hash.js";
import { normalizeErrorText } from "../harvest/normalize.js";
import { errorSignature } from "../harvest/signature.js";
import { clusterEpisodes } from "./group.js";
import { clusterKey, signatureParts } from "./key.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function errorText(episode) {
  const direct = episode?.failure?.errorText ?? episode?.failure?.error_text;
  if (typeof direct === "string") return direct;
  const signature = clusterKey(episode);
  const failed = (Array.isArray(episode?.steps) ? episode.steps : [])
    .filter((step) => object(step) && step.ok === false && (!signature || errorSignature(step) === signature));
  return text(failed.at(-1)?.errorText ?? failed.at(-1)?.error_text ?? episode?.outcome?.reason);
}

function requestText(episode) {
  return typeof episode?.request === "string" ? episode.request : text(episode?.request?.text);
}

function redact(value) {
  return normalizeErrorText(text(value))
    .replace(/\$HOME\b/gi, "<HOME>")
    .replace(/~\/(?:[^\s"'`,;:)]+\/?)+/g, "<PATH>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<EMAIL>")
    .replace(/\b(?:(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9_-]{8,})\b/g, "<SECRET>")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/\s*[:=]/, 1)[0]}=<SECRET>`)
    .replace(/\b(?=[A-Fa-f0-9]{32,}\b)(?=[A-Fa-f0-9]*[A-Fa-f])(?=[A-Fa-f0-9]*\d)[A-Fa-f0-9]+\b/g, "<SECRET>")
    .replace(/\b(?=[A-Za-z0-9+/]{40,}={0,2}\b)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]+={0,2}\b/g, "<SECRET>")
    .slice(0, 240);
}

function tokens(value) {
  const normalized = normalizeErrorText(value).replace(/<[A-Z][A-Z0-9_]*>/gi, " ").toLowerCase();
  return new Set(normalized.split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function ordered(episodes) {
  return [...episodes].sort((a, b) => text(a?.started).localeCompare(text(b?.started))
    || text(a?.id).localeCompare(text(b?.id)) || canonicalize(a).localeCompare(canonicalize(b)));
}

function components(items, threshold) {
  const parent = items.map((_, index) => index);
  const root = (index) => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  const sets = items.map((episode) => tokens(errorText(episode)));
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      if (jaccard(sets[left], sets[right]) < threshold) continue;
      const a = root(left);
      const b = root(right);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const result = new Map();
  items.forEach((item, index) => {
    const key = root(index);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(item);
  });
  return [...result.values()];
}

function makeGroup(episodes, tool, errorClass) {
  const sorted = ordered(episodes);
  const members = sorted.map((episode) => text(episode?.id, "unknown"));
  return {
    key: contentId("lt", { tool, errorClass, members }),
    tool,
    errorClass,
    size: sorted.length,
    members,
    exemplars: sorted.slice(0, 2).map((episode) => ({ request: redact(requestText(episode)), error: redact(errorText(episode)) })),
    span: {
      sessions: new Set(sorted.map((episode) => text(episode?.session_id, "unknown"))).size,
      projects: new Set(sorted.map((episode) => text(episode?.project, "unknown"))).size,
    },
  };
}

export function mineLongtail(episodes, opts = {}) {
  try {
    const source = Array.isArray(episodes) ? episodes.filter((episode) => object(episode) && object(episode.failure) && clusterKey(episode) !== null) : [];
    const minSize = Math.max(1, Math.floor(finite(opts?.minSize, 3)));
    const threshold = Math.min(1, Math.max(0, finite(opts?.jaccardThreshold ?? opts?.jaccard, 0.5)));
    const realMembers = new Set(clusterEpisodes(source, { minSize })
      .filter((cluster) => cluster?.isLongTail !== true)
      .flatMap((cluster) => Array.isArray(cluster?.members) ? cluster.members : []));
    const tail = ordered(source.filter((episode) => !realMembers.has(text(episode?.id, "unknown"))));
    const buckets = new Map();
    for (const episode of tail) {
      const parts = signatureParts(clusterKey(episode));
      const tool = text(parts?.tool, "unknown") || "unknown";
      const errorClass = text(parts?.errorClass, "unknown") || "unknown";
      const key = `${tool}\u0000${errorClass}`;
      if (!buckets.has(key)) buckets.set(key, { tool, errorClass, episodes: [] });
      buckets.get(key).episodes.push(episode);
    }
    const groups = [];
    const lonerCounts = new Map();
    for (const bucket of [...buckets.values()].sort((a, b) => a.tool.localeCompare(b.tool) || a.errorClass.localeCompare(b.errorClass))) {
      for (const component of components(bucket.episodes, threshold)) {
        if (component.length >= 2) groups.push(makeGroup(component, bucket.tool, bucket.errorClass));
        else {
          const key = `${bucket.tool}\u0000${bucket.errorClass}`;
          lonerCounts.set(key, { tool: bucket.tool, errorClass: bucket.errorClass, count: (lonerCounts.get(key)?.count ?? 0) + 1 });
        }
      }
    }
    groups.sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
    const byToolClass = [...lonerCounts.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool) || a.errorClass.localeCompare(b.errorClass));
    return { groups, loners: { byToolClass, total: byToolClass.reduce((sum, row) => sum + row.count, 0) } };
  } catch {
    return { groups: [], loners: { byToolClass: [], total: 0 } };
  }
}
