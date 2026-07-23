// The Daytona grader — the safe executor for untrusted, agent-generated code.
// Ships a candidate solution + a hidden check script into an isolated sandbox,
// runs it, and returns pass/fail. This is the piece that makes the whole
// experiment trustworthy: the agent's code never runs on our machine, and the
// success criterion (the check) is fixed and out of the agent's reach.
//
// Grading costs only sandbox compute (~free). The LLM call that WRITES the code
// is the only token cost, and it lives in the agent, not here.

import { resolveBackend } from "../lib/client.mjs";

// base64 write avoids all shell-escaping hazards with arbitrary code.
function writeFileCmd(remotePath, content) {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  return `printf %s '${b64}' | base64 -d > ${remotePath}`;
}

// Grade one candidate solution against one task's hidden check.
// Returns { passed, output, error }. On any sandbox error, passed:false + error.
export async function grade(backend, task, code, { timeoutMs = 60_000 } = {}) {
  const dir = "/tmp/grade";
  const steps = [
    `rm -rf ${dir} && mkdir -p ${dir}`,
    writeFileCmd(`${dir}/solution.py`, code),
    writeFileCmd(`${dir}/check.py`, `${task.check}\nprint("ALL_CHECKS_PASSED")`),
    `cd ${dir} && python3 check.py`,
  ];
  try {
    const res = await backend.run(steps, { timeoutMs });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
    const passed = (res.exitCode ?? 1) === 0 && /ALL_CHECKS_PASSED/.test(out);
    return { passed, output: out.slice(0, 800) };
  } catch (error) {
    return { passed: false, output: "", error: error?.message ?? "grade error" };
  }
}

// Convenience: resolve the backend once (real Daytona if keyed, else mock).
export function graderBackend() { return resolveBackend(); }
