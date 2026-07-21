import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { planTrials, scoreTrialResults } from "../src/measure/runner.js";

const cli = path.resolve("bin/flywheel.js");

function fixtures(count = 4, cwd = "/tmp") {
  const episodes = Array.from({ length: count }, (_, index) => ({ id: `ep_${index}`, cwd,
    request: { text: `task ${index}` } }));
  return { cluster: { id: "cl_trial", signature: "Bash|test_failure|expected shape", members: episodes.map((item) => item.id) }, episodes };
}

test("planTrials is deterministic, sealed, interleaved, and enforces five repeats", () => {
  const { cluster, episodes } = fixtures();
  const first = planTrials(cluster, episodes, null, { repeats: 1 });
  const second = planTrials(cluster, episodes, null, { repeats: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.repeats, 5);
  assert.deepEqual(first.order.slice(0, 4).map((item) => item.arm), ["before", "after", "before", "after"]);
  assert.deepEqual(new Set([...first.dev, ...first.heldout].map((item) => item.id)), new Set(first.suite.map((item) => item.id)));
});

test("scoreTrialResults judges a powered, clearly improved paired run", () => {
  const { cluster } = fixtures(60);
  const results = [];
  for (let index = 0; index < 60; index += 1) {
    results.push({ trialId: `ep_${index}`, arm: "before", completed: true, output: cluster.signature });
    results.push({ trialId: `ep_${index}`, arm: "after", completed: true, output: "clean" });
  }
  const score = scoreTrialResults(results, cluster, { noiseBand: 0, iters: 1000 });
  assert.equal(score.powered, true);
  assert.equal(score.verdict, "helped");
  assert.equal(score.delta, 1);
});

test("scoreTrialResults caps every underpowered verdict at inconclusive", () => {
  const { cluster } = fixtures(2);
  const results = [
    { trialId: "ep_0", arm: "before", completed: true, output: "clean" },
    { trialId: "ep_0", arm: "after", completed: true, output: "clean" },
  ];
  const score = scoreTrialResults(results, cluster, { noiseBand: 0 });
  assert.equal(score.powered, false);
  assert.equal(score.verdict, "inconclusive");
});

function cliFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-trial-"));
  const episodesDir = path.join(root, "episodes");
  mkdirSync(episodesDir);
  const target = path.join(root, "target.txt");
  writeFileSync(target, "broken\n");
  const { cluster, episodes } = fixtures(1, root);
  writeFileSync(path.join(episodesDir, "episodes.jsonl"), `${JSON.stringify(episodes[0])}\n`);
  writeFileSync(path.join(root, "clusters.json"), JSON.stringify([cluster]));
  const patchFile = path.join(root, "patch.json");
  writeFileSync(patchFile, JSON.stringify({ target, diff: { format: "before_after", before: "broken", after: "fixed" } }));
  return { root, episodesDir, target, patchFile };
}

test("trial-run fake executes both arms, records a decision, and restores the patch", () => {
  const item = cliFixture();
  const run = spawnSync(process.execPath, [cli, "trial-run", "--cluster", "cl_trial", "--in", item.episodesDir,
    "--patch", item.patchFile, "--agent", "fake", "--repeats", "5"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /before: 0\/5 passed/);
  assert.match(run.stdout, /after: 5\/5 passed/);
  assert.match(run.stdout, /n=1, underpowered; no statistical claim/);
  assert.equal(readFileSync(item.target, "utf8"), "broken\n");
  assert.equal(JSON.parse(readFileSync(path.join(item.root, "ledger.jsonl"), "utf8")).executed, 10);
});

test("trial-run stops exactly at max-trials", () => {
  const item = cliFixture();
  const run = spawnSync(process.execPath, [cli, "trial-run", "--cluster", "cl_trial", "--in", item.episodesDir,
    "--agent", "fake", "--max-trials", "2"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /stopped: limit/);
  assert.equal(JSON.parse(readFileSync(path.join(item.root, "ledger.jsonl"), "utf8")).executed, 2);
});

test("trial-run zero budget stops before executing any trial", () => {
  const item = cliFixture();
  const run = spawnSync(process.execPath, [cli, "trial-run", "--cluster", "cl_trial", "--in", item.episodesDir,
    "--agent", "fake", "--budget-usd", "0"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /stopped: budget/);
  assert.equal(JSON.parse(readFileSync(path.join(item.root, "ledger.jsonl"), "utf8")).executed, 0);
});
