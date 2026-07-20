function replayableWitness(cluster) {
  return (Array.isArray(cluster?.witnesses) ? cluster.witnesses : []).find((witness) =>
    witness?.replayable === true && typeof witness?.cmd === "string" && witness.cmd.length > 0);
}

function trialSource(witness) {
  const command = JSON.stringify(witness.cmd);
  const cwd = JSON.stringify(typeof witness.cwd === "string" && witness.cwd ? witness.cwd : ".");
  const childProcessSpecifier = "node" + ":child_process";
  return `// Generated deterministically from the recorded production witness.\nimport { spawn } from ${JSON.stringify(childProcessSpecifier)};\nconst child = spawn(${command}, { cwd: ${cwd}, shell: true, stdio: "inherit" });\nchild.on("error", () => process.exit(1));\nchild.on("exit", (code) => process.exit(code === 0 ? 0 : 1));\n`;
}

export function buildEvalContract(cluster, candidate) {
  void candidate;
  const id = String(cluster?.id ?? "unknown");
  const witness = replayableWitness(cluster);
  if (witness) {
    const command = `node <trialsDir>/${id}.mjs`;
    return { strategy: "witness_replay", evalContract: { kind: "command", command }, checks: [command], strength: "causal", requires: "auto", trialScript: trialSource(witness) };
  }
  const recurrence = cluster?.recurrenceRate != null || (Array.isArray(cluster?.members) && cluster.members.length > 0) || Number(cluster?.size) > 0;
  if (recurrence) {
    const command = `flywheel measure --cluster ${id} --assert-improved`;
    return { strategy: "recurrence_probe", evalContract: { kind: "command", command }, checks: [command], strength: "behavioral", requires: "human-gate" };
  }
  const command = "npm test";
  return { strategy: "regression_only", evalContract: { kind: "command", command }, checks: [command], strength: "regression_only", requires: "human-gate" };
}
