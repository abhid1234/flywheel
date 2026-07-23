// Controlled task: file_not_found. A step reads a config file that isn't there;
// the fix creates it. The cheapest task in the suite (no installs) — a fast,
// high-signal member for scaling volume.
export const task = {
  id: "file-missing",
  errorClass: "file_not_found",
  signature: "bash:file_not_found:cat:",
  description: "cat of a required config file fails when absent; the fix writes the file.",
  steps(arm) {
    const f = "/tmp/flywheel-config.json";
    const clean = [`rm -f ${f}`];
    const fix = arm === "after" ? [`echo '{"ok":true}' > ${f}`] : [];
    const witness = [`cat ${f}`];
    return [...clean, ...fix, ...witness];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
