import { canonicalize, sha256hex } from "../hash.js";

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function strategyOf(patch, measureResult) {
  return text(measureResult?.strategy) || text(measureResult?.evalStrategy) ||
    text(patch?.meta?.flywheel?.evalStrategy) || "regression_only";
}

export function buildAttestation(patch, measureResult, cluster, opts = {}) {
  try {
    const safePatch = patch && typeof patch === "object" ? patch : {};
    const safeResult = measureResult && typeof measureResult === "object" ? measureResult : {};
    const strategy = strategyOf(safePatch, safeResult);
    const judged = safeResult.llmJudge === true || safeResult.llm_judge === true ||
      safeResult.judgedBy === "llm" || safeResult.method === "judge";
    const verdict = text(safeResult.verdict, text(safeResult.result));
    const checkNames = Array.isArray(safeResult.checks)
      ? safeResult.checks
      : (Array.isArray(safePatch?.meta?.flywheel?.checks)
        ? safePatch.meta.flywheel.checks : []);
    const passed = verdict === "helped";
    const checks = checkNames
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((name) => strategy === "witness_replay"
        ? { name, passed }
        : { name, passed, note: "aggregate" });
    const signature = text(cluster?.signature, text(safePatch?.signature));
    const members = Array.isArray(cluster?.members)
      ? cluster.members.filter((item) => typeof item === "string") : [];
    const parentAttestations = Array.isArray(opts?.parentAttestations)
      ? opts.parentAttestations.filter((item) =>
        typeof item === "string" && /^[a-f0-9]{64}$/i.test(item))
      : [];
    const descriptor = {
      kind: "flywheel-patch",
      patch_id: text(safePatch.patch_id, text(safePatch.id)),
      target: text(safePatch.target),
      layer: text(safePatch.layer, text(safePatch?.meta?.flywheel?.layer)),
      signature,
    };
    return {
      artifact: { hash: sha256hex(canonicalize(descriptor)) },
      meta: {
        artifact_descriptor: descriptor,
        agent: "flywheel/measure@1",
        intent: `${signature} reduce recurrence`.trim(),
        evaluation: {
          score: verdict === "helped" ? 1 : verdict === "regressed" ? 0 : 0.5,
          method: judged ? "judge" : "test",
          checks,
          evaluator: strategy,
        },
        parents: parentAttestations,
        derived_from: members,
      },
    };
  } catch {
    const descriptor = { kind: "flywheel-patch", patch_id: "", target: "", layer: "", signature: "" };
    return {
      artifact: { hash: sha256hex(canonicalize(descriptor)) },
      meta: { artifact_descriptor: descriptor, agent: "flywheel/measure@1", intent: "reduce recurrence", evaluation: { score: 0.5, method: "test", checks: [], evaluator: "regression_only" }, parents: [], derived_from: [] },
    };
  }
}
