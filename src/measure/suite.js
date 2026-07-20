import { sha256hex } from "../hash.js";

export function clusterToTrialSuite(cluster, episodes, opts = {}) {
  try {
    const members = new Set(Array.isArray(cluster?.members) ? cluster.members : []);
    const source = Array.isArray(episodes) ? episodes : [];
    const seen = new Set();
    const trials = [];
    for (const episode of source) {
      if (!episode || typeof episode !== "object" || !members.has(episode.id)) continue;
      const prompt = typeof episode?.request?.text === "string" ? episode.request.text : "";
      if (seen.has(prompt)) continue;
      seen.add(prompt);
      const trial = {
        id: typeof episode.id === "string" ? episode.id : `trial_${trials.length}`,
        prompt,
        cwd: typeof episode.cwd === "string" ? episode.cwd : (typeof opts?.cwd === "string" ? opts.cwd : ""),
        expectedSignature: typeof cluster?.signature === "string" ? cluster.signature : "",
      };
      if (episode.setup !== undefined) trial.setup = episode.setup;
      trials.push(trial);
    }
    return trials;
  } catch {
    return [];
  }
}

export function splitHeldout(trials, options = {}) {
  try {
    const source = Array.isArray(trials) ? trials : [];
    const salt = typeof options?.salt === "string" ? options.salt : "";
    const requested = Number(options?.heldoutPct ?? 40);
    const heldoutPct = Number.isFinite(requested) ? Math.max(0, Math.min(100, requested)) : 40;
    const dev = [];
    const heldout = [];
    for (const trial of source) {
      const id = typeof trial?.id === "string" ? trial.id : "";
      const bucket = Number.parseInt(sha256hex(salt + id).slice(0, 4), 16) % 100;
      (bucket < heldoutPct ? heldout : dev).push(trial);
    }
    const order = (a, b) => String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
    dev.sort(order);
    heldout.sort(order);
    return { dev, heldout };
  } catch {
    return { dev: [], heldout: [] };
  }
}
