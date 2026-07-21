import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planLoop } from "../src/loop/orchestrate.js";
import { CONTEXT_LINE_BUDGET } from "../src/loop/policy.js";

const cli = fileURLToPath(new URL("../bin/flywheel.js", import.meta.url));
const echoGuidance = "Flywheel note: replay the recorded witness before completing this task.";

function cluster(overrides = {}) {
  const id = overrides.id ?? "cl_context";
  return {
    id,
    signature: overrides.signature ?? `Bash:file_not_found:${id}`,
    errorClass: "file_not_found",
    size: 3,
    tierCounts: { gold: 1, strong: 2, weak: 0, unknown: 0 },
    witnesses: [{ replayable: true, kind: "shell", cmd: "node witness.mjs", cwd: "/tmp", observedExitCode: 1 }],
    cost: { terminal: 1, wastedMs: 0 },
    span: { projects: 1 },
    linesAdded: 1,
    members: ["ep_1", "ep_2", "ep_3"],
    ...overrides,
  };
}

function sandbox(t, prefix = "flywheel-loop-") {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
}

function writeLoopFixture(t, { replayHelps = false } = {}) {
  const root = sandbox(t);
  const episodesDir = path.join(root, "episodes");
  mkdirSync(episodesDir);
  writeFileSync(path.join(episodesDir, "demo.jsonl"), `${JSON.stringify({ id: "ep_1", session_id: "s_1", project: "demo", steps: [], signals: {} })}\n`);
  writeFileSync(path.join(root, "CLAUDE.md"), "Project instructions\nExisting guidance.\n");

  const witness = path.join(root, "witness.mjs");
  writeFileSync(witness, replayHelps
    ? `import { readFileSync } from "node:fs";\nconst text = readFileSync(${JSON.stringify(path.join(root, "CLAUDE.md"))}, "utf8");\nprocess.exit(text.includes(${JSON.stringify(echoGuidance)}) ? 0 : 1);\n`
    : "process.exit(1);\n");
  const savedCluster = cluster({
    id: "cl_fixture",
    signature: "Bash:file_not_found:missing-guidance",
    dominantCwd: root,
    witnesses: [{ replayable: true, kind: "shell", cmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(witness)}`, cwd: root, observedExitCode: 1 }],
  });
  writeFileSync(path.join(root, "clusters.json"), `${JSON.stringify([savedCluster], null, 2)}\n`);
  return { root, episodesDir };
}

test("planLoop schedules a proposable context cluster", () => {
  const candidate = cluster();
  const plan = planLoop([candidate]);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].cluster.id, candidate.id);
  assert.equal(plan.actions[0].layer, "context");
  assert.equal(plan.skipped.length, 0);
});

test("planLoop layer-gates an otherwise proposable scaffolding cluster", () => {
  const candidate = cluster({ id: "cl_timeout", errorClass: "timeout" });
  const plan = planLoop([candidate]);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, "layer_gated");
  assert.equal(plan.skipped[0].layer, "scaffolding");
});

test("planLoop review mode schedules reviewable scaffolding for human review", () => {
  const candidate = cluster({ id: "cl_timeout", errorClass: "timeout" });
  const reviewed = planLoop([candidate], { mode: "review" });
  assert.equal(reviewed.actions.length, 1);
  assert.equal(reviewed.actions[0].layer, "scaffolding");
  assert.equal(reviewed.actions[0].disposition, "human-review");
  assert.equal(reviewed.skipped.length, 0);

  const automatic = planLoop([candidate], { mode: "auto" });
  assert.equal(automatic.actions.length, 0);
  assert.equal(automatic.skipped[0].reason, "layer_gated");
});

test("planLoop identifies a missing causal witness", () => {
  const candidate = cluster({ id: "cl_no_witness", witnesses: [] });
  const plan = planLoop([candidate]);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.skipped[0].reason, "no_causal_witness");
});

test("planLoop review mode schedules a reviewable behavioral cluster for human review", () => {
  const candidate = cluster({ id: "cl_behavioral", errorClass: "harness_blocked", witnesses: [] });
  const reviewed = planLoop([candidate], { mode: "review" });
  assert.equal(reviewed.actions.length, 1);
  assert.equal(reviewed.actions[0].disposition, "human-review");
  assert.equal(reviewed.actions[0].auto_apply, false);
  assert.equal(planLoop([candidate]).skipped[0].reason, "no_causal_witness");
});

test("CLI review mode queues a behavioral patch and never applies it", (t) => {
  const { root, episodesDir } = writeLoopFixture(t);
  const clustersFile = path.join(root, "clusters.json");
  const [saved] = JSON.parse(readFileSync(clustersFile, "utf8"));
  saved.errorClass = "harness_blocked";
  saved.witnesses = [];
  writeFileSync(clustersFile, `${JSON.stringify([saved], null, 2)}\n`);
  const target = path.join(root, "CLAUDE.md");
  const before = readFileSync(target, "utf8");
  const result = runCli(root, ["loop", "--mode", "review", "--llm", "echo", "--apply", "--in", episodesDir]);
  assert.equal(result.status, 0, result.stderr);
  const queued = JSON.parse(readFileSync(path.join(root, "review-queue", `${saved.id}.json`), "utf8"));
  const ledger = readFileSync(path.join(root, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(queued.requires, "human-gate");
  assert.equal(queued.meta.eval_strength, "behavioral");
  assert.equal(ledger.at(-1).disposition, "human-review");
  assert.equal(ledger.at(-1).applied, false);
  assert.equal(readFileSync(target, "utf8"), before);
  assert.match(result.stdout, /cluster\s+layer\s+gate\s+eval-strength\s+queued-for-review/);
});

test("planLoop rejects a non-proposable cluster", () => {
  const candidate = cluster({
    id: "cl_tiny",
    size: 1,
    tierCounts: { gold: 0, strong: 0, weak: 0, unknown: 1 },
    witnesses: [],
  });
  const plan = planLoop([candidate]);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.skipped[0].reason, "not_proposable");
});

test("planLoop max caps actions rather than scanned clusters", () => {
  const candidates = [
    cluster({ id: "cl_skipped_unknown", signature: "sig_1", tierCounts: { gold: 0, strong: 0, weak: 0, unknown: 3 } }),
    cluster({ id: "cl_skipped_tail", signature: "sig_2", isLongTail: true }),
    cluster({ id: "cl_action_first", signature: "sig_3" }),
    cluster({ id: "cl_action_second", signature: "sig_4" }),
    cluster({ id: "cl_action_third", signature: "sig_5" }),
  ];
  for (const mode of ["auto", "review"]) {
    const plan = planLoop(candidates, { ranked: true, max: 1, mode });
    assert.deepEqual(plan.actions.map((item) => item.cluster.id), ["cl_action_first"]);
    assert.deepEqual(plan.skipped.map((item) => item.cluster.id), ["cl_skipped_unknown", "cl_skipped_tail"]);
  }
});

test("planLoop skips later context actions after exhausting the line budget", () => {
  const lines = Math.floor(CONTEXT_LINE_BUDGET / 2) + 1;
  const candidates = [0, 1, 2].map((index) => cluster({ id: `cl_budget_${index}`, signature: `sig_${index}`, linesAdded: lines }));
  const plan = planLoop(candidates, { ranked: true });
  assert.deepEqual(plan.actions.map((item) => item.cluster.id), ["cl_budget_0"]);
  assert.deepEqual(plan.skipped.map((item) => item.reason), ["budget_exceeded", "budget_exceeded"]);
});

test("planLoop is deterministic", () => {
  const candidates = [
    cluster({ id: "cl_b", signature: "sig_b" }),
    cluster({ id: "cl_a", signature: "sig_a", errorClass: "timeout" }),
  ];
  assert.deepEqual(planLoop(candidates), planLoop(candidates));
});

test("CLI loop dry-run prints a plan without writing patches or a ledger", (t) => {
  const { root, episodesDir } = writeLoopFixture(t);
  const beforeClusters = readFileSync(path.join(root, "clusters.json"), "utf8");
  const result = runCli(root, ["loop", "--dry-run", "--llm", "echo", "--in", episodesDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan: 1 action\(s\), 0 skipped/);
  assert.match(result.stdout, /dry-run changed nothing/);
  assert.equal(existsSync(path.join(root, "patches")), false);
  assert.equal(existsSync(path.join(root, "ledger.jsonl")), false);
  assert.equal(readFileSync(path.join(root, "clusters.json"), "utf8"), beforeClusters);
});

test("CLI loop apply keeps a helpful echo patch and is idempotent", (t) => {
  const { root, episodesDir } = writeLoopFixture(t, { replayHelps: true });
  const first = runCli(root, ["loop", "--apply", "--llm", "echo", "--in", episodesDir]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /1->0\tapplied/);
  assert.equal(readdirSync(path.join(root, "patches")).filter((name) => name.endsWith(".json")).length, 1);
  assert.match(readFileSync(path.join(root, "CLAUDE.md"), "utf8"), new RegExp(echoGuidance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const firstLedger = readFileSync(path.join(root, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(firstLedger.length, 1);
  assert.equal(firstLedger[0].applied, true);
  assert.equal(firstLedger[0].measure.helped, true);

  const targetAfterFirst = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  const second = runCli(root, ["loop", "--apply", "--llm", "echo", "--in", episodesDir]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already_applied/);
  assert.equal(readFileSync(path.join(root, "CLAUDE.md"), "utf8"), targetAfterFirst);
  const secondLedger = readFileSync(path.join(root, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(secondLedger.filter((entry) => entry.applied === true).length, 1);
  assert.equal(secondLedger.at(-1).reason, "already_applied");
});

test("CLI status prints labeled episode, cluster, and ledger counts", (t) => {
  const root = sandbox(t, "flywheel-status-");
  const episodesDir = path.join(root, "episodes");
  mkdirSync(episodesDir);
  const episodes = [
    { id: "ep_gold", outcome: { tier: "gold", label: "pass", method: "test" } },
    { id: "ep_strong", outcome: { tier: "strong", label: "fail", method: "test" }, failure: { signature: "sig" } },
  ];
  writeFileSync(path.join(episodesDir, "labeled.jsonl"), `${episodes.map(JSON.stringify).join("\n")}\n`);
  writeFileSync(path.join(root, "clusters.json"), `${JSON.stringify([cluster()])}\n`);
  writeFileSync(path.join(root, "ledger.jsonl"), `${JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", applied: true, gate_decision: "approve" })}\n`);

  const result = runCli(root, ["status", "--in", episodesDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /episodes: 2/);
  assert.match(result.stdout, /failures: 1/);
  assert.match(result.stdout, /tiers: \{"gold":1,"strong":1,"weak":0,"unknown":0\}/);
  assert.match(result.stdout, /proposable clusters: 1/);
  assert.match(result.stdout, /patches applied: 1/);
});
