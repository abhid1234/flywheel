// The agent (#2) — writes code for a task given the current accumulated lessons.
// The lessons are the "policy": as the agent learns, they steer it away from its
// recurring mistakes. One interface, several backends:
//
//   fake   — free, no LLM. Emits a task's `cold` (buggy) reference until the
//            lesson for its failure mode is in the policy, then `fixed`. With a
//            little noise. This lets the WHOLE pipeline run end-to-end on real
//            Daytona grading without spending a token — a true plumbing proof.
//   codex  — real: `codex exec` writes the solution from the spec + lessons.
//   claude — real: `claude -p` does the same.
//
// Real backends cost LLM tokens; that is the only spend in the system.

import { spawn } from "node:child_process";

function buildPrompt(task, lessons) {
  const policy = lessons.length
    ? `\n\nLessons learned from your past mistakes — follow them:\n${lessons.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
    : "";
  return `Write a Python file with a single function per this spec. Output ONLY the code, no prose, no markdown fences.\n\nSpec: ${task.spec}${policy}`;
}

// Strip markdown fences / prose an LLM might wrap around code.
function extractCode(text) {
  const fence = text.match(/```(?:python)?\s*([\s\S]*?)```/i);
  const code = (fence ? fence[1] : text).trim();
  return code;
}

// Detect a rate-limit / quota / transient CLI failure so the caller can RETRY
// instead of scoring the error text as a wrong answer (which would corrupt an
// overnight run). Throwing lets rl-loop's runArm back off and retry.
const RATE_LIMIT = /rate.?limit|quota|too many requests|429|usage limit|overloaded|try again later|temporarily unavailable|please wait|capacity/i;
// A valid solution must contain a function definition; anything without one that
// also matches the rate-limit shape is almost certainly not code.
function guardCode(out) {
  const code = extractCode(out);
  if (!/\bdef\s+\w+\s*\(/.test(code) && RATE_LIMIT.test(out)) {
    throw new Error(`agent rate-limited: ${out.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  return code;
}

async function runCLI(cmd, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("agent timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => { clearTimeout(timer); resolve(out || err); });
    if (input !== undefined) { child.stdin.write(input); child.stdin.end(); }
  });
}

export function resolveAgent(kind = "fake", { noise = 0.08 } = {}) {
  if (kind === "fake") {
    return {
      kind: "fake", costsTokens: false,
      async generate(task, lessons, rand = Math.random) {
        const solved = task.mode == null || lessons.some((l) => l.mode === task.mode);
        // noise: occasionally slip even with the lesson, or get lucky without it
        const slip = rand() < noise;
        const useFixed = solved ? !slip : slip;
        return useFixed ? task.fixed : task.cold;
      },
    };
  }
  if (kind === "codex") {
    return {
      kind: "codex", costsTokens: true,
      async generate(task, lessons) {
        const prompt = buildPrompt(task, lessons.map((l) => l.text));
        const out = await runCLI("codex", ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-m", "gpt-5.6-sol", prompt], "", 120_000);
        return guardCode(out);
      },
    };
  }
  if (kind === "claude") {
    return {
      kind: "claude", costsTokens: true,
      async generate(task, lessons) {
        const prompt = buildPrompt(task, lessons.map((l) => l.text));
        const out = await runCLI("claude", ["-p", prompt], "", 120_000);
        return guardCode(out);
      },
    };
  }
  throw new Error(`unknown agent backend: ${kind}`);
}
