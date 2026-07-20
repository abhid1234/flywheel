import { contentId, canonicalize } from "../hash.js";
import { normalizeErrorText } from "../harvest/normalize.js";
import { errorSignature } from "../harvest/signature.js";
import { clusterKey, signatureParts } from "./key.js";

const TIERS = ["gold", "strong", "weak", "unknown"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = "") => typeof value === "string" ? value : fallback;

function errorText(episode, signature) {
  const direct = episode?.failure?.errorText ?? episode?.failure?.error_text;
  if (typeof direct === "string") return direct;
  const matches = (Array.isArray(episode?.steps) ? episode.steps : [])
    .filter((step) => object(step) && step.ok === false && errorSignature(step) === signature)
    .map((step) => step.errorText ?? step.error_text)
    .filter((value) => typeof value === "string");
  return matches.at(-1) ?? "";
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

function representative(group) {
  const values = group.episodes.map((episode) => normalizeErrorText(errorText(episode, group.signature))).filter(Boolean).sort();
  return tokens(values[0] ?? "");
}

function unionFind(length) {
  const parent = Array.from({ length }, (_, index) => index);
  const root = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  return {
    root,
    union(left, right) {
      const a = root(left);
      const b = root(right);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    },
  };
}

function orderedEpisodes(episodes) {
  return [...episodes].sort((a, b) =>
    text(a?.started).localeCompare(text(b?.started)) || text(a?.id).localeCompare(text(b?.id)) || canonicalize(a).localeCompare(canonicalize(b)));
}

function witnessFrom(episode) {
  const witness = episode?.failure?.witness;
  if (!object(witness) || witness.replayable !== true) return null;
  return {
    kind: text(witness.kind, "none"),
    cmd: text(witness.cmd),
    cwd: text(witness.cwd),
    observedExitCode: Number.isInteger(witness.observedExitCode)
      ? witness.observedExitCode
      : (Number.isInteger(witness.observed_exit_code) ? witness.observed_exit_code : null),
    replayable: true,
  };
}

function makeCluster(episodes, signatures, episodesTotal, isLongTail = false) {
  const ordered = orderedEpisodes(episodes);
  const mergedSignatures = [...new Set(signatures)].sort();
  const signature = mergedSignatures[0] ?? "";
  const parts = signatureParts(signature);
  const members = ordered.map((episode) => text(episode.id, "unknown"));
  const tierCounts = { gold: 0, strong: 0, weak: 0, unknown: 0 };
  for (const episode of ordered) {
    const tier = TIERS.includes(episode?.outcome?.tier) ? episode.outcome.tier : "unknown";
    tierCounts[tier] += 1;
  }
  const dates = ordered.map((episode) => text(episode?.started)).filter(Boolean).sort();
  const sessions = new Set(ordered.map((episode) => text(episode?.session_id, "unknown")));
  const projects = new Set(ordered.map((episode) => text(episode?.project, "unknown")));
  const seenWitnesses = new Set();
  const witnesses = [];
  for (const episode of ordered) {
    const witness = witnessFrom(episode);
    if (!witness) continue;
    const key = canonicalize(witness);
    if (!seenWitnesses.has(key)) {
      seenWitnesses.add(key);
      witnesses.push(witness);
    }
    if (witnesses.length === 5) break;
  }
  const wastedSteps = ordered.reduce((sum, episode) => sum + Math.max(0, finite(episode?.signals?.errored_tool_results)), 0);
  const wastedMs = ordered.reduce((sum, episode) => sum + Math.max(0, finite(episode?.duration_ms)), 0);
  const recoveredInEpisode = ordered.filter((episode) => {
    const recovered = episode?.signals?.recovered_signatures;
    return Array.isArray(recovered) && recovered.some((item) => mergedSignatures.includes(item));
  }).length;
  const size = ordered.length;
  const recurrenceRate = episodesTotal > 0 ? Math.round((size / episodesTotal) * 10000) / 10000 : 0;
  return {
    id: isLongTail ? "cl_longtail" : contentId("cl", { signature, members }),
    schema: "flywheel/cluster@1",
    signature: isLongTail ? "longtail" : signature,
    mergedSignatures,
    tool: isLongTail ? "mixed" : parts.tool,
    errorClass: isLongTail ? "mixed" : parts.errorClass,
    mode: isLongTail ? "mixed" : parts.errorClass,
    members,
    size,
    tierCounts,
    span: { first: dates[0] ?? null, last: dates.at(-1) ?? null, sessions: sessions.size, projects: projects.size },
    cost: { wastedSteps, wastedMs, terminal: size, recoveredInEpisode },
    witnesses,
    recurrenceRate: { episodesWithSignature: size, episodesTotal, rate: recurrenceRate },
    priority: 0,
    isLongTail,
    created: null,
  };
}

export function clusterEpisodes(episodes, opts = {}) {
  try {
    const source = Array.isArray(episodes) ? episodes.filter(object) : [];
    const minSize = Math.max(1, Math.floor(finite(opts?.minSize, 3)));
    const threshold = Math.min(1, Math.max(0, finite(opts?.jaccardThreshold, 0.8)));
    const exact = new Map();
    for (const episode of source) {
      const signature = clusterKey(episode);
      if (signature === null) continue;
      if (!exact.has(signature)) exact.set(signature, []);
      exact.get(signature).push(episode);
    }

    const groups = [...exact].map(([signature, grouped]) => ({
      signature,
      episodes: orderedEpisodes(grouped),
      parts: signatureParts(signature),
    })).sort((a, b) => b.episodes.length - a.episodes.length || a.signature.localeCompare(b.signature));

    const buckets = new Map();
    for (let index = 0; index < groups.length; index += 1) {
      const parts = groups[index].parts;
      const bucket = opts?.mergeAcrossErrorClass === true ? parts.tool : `${parts.tool}:${parts.errorClass}`;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(index);
    }
    const unions = unionFind(groups.length);
    const representatives = groups.map(representative);
    for (const indexes of buckets.values()) {
      for (let left = 0; left < indexes.length; left += 1) {
        for (let right = left + 1; right < indexes.length; right += 1) {
          const a = groups[indexes[left]];
          const b = groups[indexes[right]];
          if (a.parts.tool !== b.parts.tool) continue;
          if (opts?.mergeAcrossErrorClass !== true && a.parts.errorClass !== b.parts.errorClass) continue;
          if (jaccard(representatives[indexes[left]], representatives[indexes[right]]) >= threshold) {
            unions.union(indexes[left], indexes[right]);
          }
        }
      }
    }

    const merged = new Map();
    for (let index = 0; index < groups.length; index += 1) {
      const root = unions.root(index);
      if (!merged.has(root)) merged.set(root, { episodes: [], signatures: [] });
      merged.get(root).episodes.push(...groups[index].episodes);
      merged.get(root).signatures.push(groups[index].signature);
    }
    const regular = [];
    const tailEpisodes = [];
    const tailSignatures = [];
    for (const group of merged.values()) {
      if (group.episodes.length >= minSize) regular.push(makeCluster(group.episodes, group.signatures, source.length));
      else {
        tailEpisodes.push(...group.episodes);
        tailSignatures.push(...group.signatures);
      }
    }
    regular.sort((a, b) => b.size - a.size || a.signature.localeCompare(b.signature));
    if (tailEpisodes.length) regular.push(makeCluster(tailEpisodes, tailSignatures, source.length, true));
    return regular;
  } catch {
    return [];
  }
}
