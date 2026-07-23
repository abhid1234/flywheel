// Controlled task: Node "Cannot find module" — the module_not_found class, but in
// a different toolchain than py-yaml. Fresh project dir with no node_modules; the
// control arm requires a package that isn't installed; the fix is `npm install`.
export const task = {
  id: "node-lodash",
  errorClass: "module_not_found",
  signature: "bash:module_not_found:node:lodash",
  description: "node -e require('lodash') fails in a fresh project; the fix is npm install lodash.",
  steps(arm) {
    const dir = "/tmp/flywheel-nm";
    const setup = [`rm -rf ${dir} && mkdir -p ${dir} && cd ${dir} && npm init -y >/dev/null 2>&1`];
    const fix = arm === "after" ? [`cd ${dir} && npm install lodash >/dev/null 2>&1`] : [];
    const witness = [`cd ${dir} && node -e "require('lodash')"`];
    return [...setup, ...fix, ...witness];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
