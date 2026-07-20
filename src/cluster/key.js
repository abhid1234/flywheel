import { parseSignature } from "../harvest/signature.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function clusterKey(episode) {
  try {
    if (!isObject(episode) || !isObject(episode.failure)) return null;
    return typeof episode.failure.signature === "string" ? episode.failure.signature : null;
  } catch {
    return null;
  }
}

export function signatureParts(sig) {
  try {
    return parseSignature(sig);
  } catch {
    return { tool: "", errorClass: "", cmdHead: "", salient: "" };
  }
}
