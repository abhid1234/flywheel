// The lesson-writer (#3) — the policy-update step. Given a cluster of failing
// trajectories (same failure mode), it distills ONE durable lesson the agent will
// carry forward. This is the only place the model is allowed to write the policy;
// it never writes the success criterion (the hidden tests are fixed and out of
// reach). Backends:
//
//   fake   — free. Returns the mode's canonical lesson from a bank. Lets the loop
//            run end-to-end offline / on the free plumbing path.
//   codex/claude — real: the LLM reads the failing code + test output and writes
//            a general lesson. Costs a small amount of tokens (one call per round).

import { spawn } from "node:child_process";

const BANK = {
  "null-fields": "Treat missing or null fields as expected input — read them defensively and default them; never index a key that may be absent.",
  "type-coercion": "Parse and validate input types explicitly; never assume a string is already a number before doing arithmetic.",
  "edge-empty": "Handle the empty-input case explicitly before the main logic; don't index element 0 of a possibly-empty sequence.",
  "off-by-one": "Re-check loop and slice bounds for off-by-one errors; prefer negative indexing for 'last' and verify the last element is included.",
  "precision": "Format money and percentages with explicit rounding/integer arithmetic; never rely on default float-to-string.",
  "ordering": "Preserve first-seen order when de-duplicating; never rely on set() to keep order.",
};

async function runCLI(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("lesson-writer timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => { clearTimeout(timer); resolve(out || err); });
    child.stdin.end();
  });
}

function prompt(cluster) {
  const samples = cluster.samples.slice(0, 3).map((s, i) =>
    `Failure ${i + 1}:\n  spec: ${s.spec}\n  the agent wrote:\n${s.code}\n  test output: ${s.output}`).join("\n\n");
  return `An AI coding agent keeps failing tasks in the same way. Below are ${cluster.samples.length} failing attempts. Write ONE short, general, durable lesson (one sentence) that would prevent this class of mistake in the future. Output ONLY the lesson sentence.\n\n${samples}`;
}

export function resolveLessonWriter(kind = "fake") {
  if (kind === "fake") {
    return { kind: "fake", costsTokens: false, async write(cluster) { return BANK[cluster.mode] ?? `Avoid the recurring ${cluster.mode} mistake.`; } };
  }
  if (kind === "codex" || kind === "claude") {
    const cmd = kind === "codex"
      ? (p) => ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-m", "gpt-5.6-sol", p]
      : (p) => ["-p", p];
    return {
      kind, costsTokens: true,
      async write(cluster) {
        const out = await runCLI(kind, cmd(prompt(cluster)), 120_000);
        return out.trim().split("\n").filter(Boolean).slice(-1)[0]?.replace(/^["'\-\s]+|["']+$/g, "") ?? BANK[cluster.mode];
      },
    };
  }
  throw new Error(`unknown lesson-writer backend: ${kind}`);
}
