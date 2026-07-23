// Controlled task: command_not_found. A CLI tool is invoked before it exists;
// the fix installs the package that provides it. Hermetic venv so the tool isn't
// present from the base image.
export const task = {
  id: "cli-cowsay",
  errorClass: "command_not_found",
  signature: "bash:command_not_found:cowsay:",
  description: "the cowsay CLI is missing until pip install provides it.",
  steps(arm) {
    const ve = "/tmp/flywheel-cli";
    const setup = [`rm -rf ${ve} && python3 -m venv ${ve}`];
    const fix = arm === "after" ? [`${ve}/bin/pip install -q cowsay`] : [];
    // `-t` is required by modern cowsay; without it an INSTALLED tool exits 2 on
    // bad args. With it, the witness cleanly separates "missing" (exit 127) from
    // "present" (exit 0) — which is the command_not_found signal we're measuring.
    const witness = [`${ve}/bin/cowsay -t hi`];
    return [...setup, ...fix, ...witness];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
