import { routeCluster } from "./targets.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function redactString(value) {
  return value
    .replace(/\$HOME\b/gi, "<HOME>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<EMAIL>")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9_-]{8,})\b/g, "<SECRET>")
    .replace(/\b(?=[A-Fa-f0-9]{32,}\b)(?=[A-Fa-f0-9]*[A-Fa-f])(?=[A-Fa-f0-9]*\d)[A-Fa-f0-9]+\b/g, "<SECRET>")
    .replace(/\b(?=[A-Za-z0-9+/]{40,}={0,2}\b)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]+={0,2}\b/g, "<SECRET>")
    .replace(/(?:^|(?<=\s|["'=(]))\/(?:[^\s"'`,;:)]+\/?)+/g, "<PATH>");
}

function redact(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
}

function exemplar(episode) {
  const steps = Array.isArray(episode?.steps) ? episode.steps : [];
  const failedAt = steps.findIndex((step) => step?.ok === false);
  const failed = failedAt >= 0 ? steps[failedAt] : {};
  const next = failedAt >= 0 ? steps[failedAt + 1] : undefined;
  return {
    request: typeof episode?.request === "string" ? episode.request : "",
    cmd: failed?.input?.command ?? failed?.command ?? episode?.failure?.witness?.cmd ?? "",
    error: failed?.errorText ?? failed?.error_text ?? episode?.failure?.errorText ?? episode?.failure?.error_text ?? "",
    whatHappenedNext: next?.errorText ?? next?.error_text ?? next?.output ?? episode?.outcome?.reason ?? "",
  };
}

export function buildBrief(cluster, episodes, targetText, opts = {}) {
  const route = routeCluster(cluster);
  const source = Array.isArray(episodes) ? episodes : [];
  const members = new Set(Array.isArray(cluster?.members) ? cluster.members : []);
  const relevant = members.size ? source.filter((episode) => members.has(episode?.id)) : source;
  const occurrences = Number.isFinite(Number(cluster?.size)) ? Number(cluster.size) : relevant.length;
  const terminal = Number(cluster?.cost?.terminal);
  const brief = {
    schema: "flywheel/brief@1",
    clusterId: String(cluster?.id ?? ""),
    signature: String(cluster?.signature ?? ""),
    mode: String(cluster?.mode ?? cluster?.errorClass ?? "other"),
    occurrences,
    terminalRate: occurrences > 0 && Number.isFinite(terminal) ? terminal / occurrences : 0,
    projects: [...new Set(relevant.map((episode) => episode?.project).filter((value) => typeof value === "string"))].sort(),
    exemplars: relevant.slice(0, 3).map(exemplar),
    layer: route.layer,
    target: String(opts?.target ?? route.surfaces[0]),
    targetCurrentText: String(targetText ?? "").slice(0, 4000),
    constraints: {
      maxLinesChanged: 20,
      mustNotTouch: Array.isArray(opts?.mustNotTouch) ? opts.mustNotTouch.map(String) : [],
      style: "imperative, specific, no hedging",
    },
    witness: (Array.isArray(cluster?.witnesses) ? cluster.witnesses : []).find((item) => item?.replayable === true) ?? null,
  };
  const redacted = redact(brief);
  // The target is operational data, not prompt evidence: it must remain exact
  // so the resulting patch points at the file selected by the caller.
  redacted.target = brief.target;
  if (opts?.createsFile === true) redacted.meta = { creates_file: true };
  return redacted;
}
