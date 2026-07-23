// Controlled task: the missing-package failure, run in an isolated sandbox.
//
// This is the DETERMINISTIC plumbing-proof task. Its outcome is gold BY
// CONSTRUCTION — we set up the failure, we know the fix, and the witness's exit
// code is an unambiguous oracle. before-arm MUST fail; after-arm MUST pass. That
// determinism is the point: it verifies the whole harvest→label→score loop is
// wired correctly before we spend LLM tokens on the noisy behavioural arm.
//
// A task exposes:
//   id, signature                — identity + the failure signature we expect
//   steps(arm) -> string[]       — shell steps for one isolated trial
//   reproducedFailure(result)    — the gold oracle: did the failure happen?

export const task = {
  id: "env-yaml",
  signature: "bash:module_not_found:python3:yaml",
  description: "python3 -c 'import yaml' fails without pyyaml; the fix is to install it.",

  // Hermetic control via a fresh virtualenv. A venv does NOT inherit system
  // site-packages, so the control arm genuinely fails regardless of what the base
  // image ships (Daytona's default image has PyYAML preinstalled and read-only —
  // uninstalling it fails, which is exactly why we isolate instead). The treatment
  // arm is the same venv plus the fix (`pip install pyyaml`). One venv per trial;
  // each trial already runs in its own sandbox.
  steps(arm) {
    const ve = "/tmp/flywheel-ve";
    const setup = [`rm -rf ${ve} && python3 -m venv ${ve}`];
    const fix = arm === "after" ? [`${ve}/bin/pip install -q pyyaml`] : [];
    const witness = [`${ve}/bin/python -c "import yaml"`];
    return [...setup, ...fix, ...witness];
  },

  // gold oracle: the witness's exit code. Non-zero => the failure reproduced.
  reproducedFailure(result) {
    return (result?.exitCode ?? 1) !== 0;
  },
};
