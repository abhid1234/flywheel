import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function record(sessionId, promptId, uuid, timestamp, isSidechain = false) {
  return { sessionId, promptId, uuid, type: "user", timestamp, cwd: "/tmp", isSidechain, message: { role: "user", content: "hello" } };
}

function shellRecords(sessionId, promptId, prefix, isSidechain = false) {
  return [
    record(sessionId, promptId, `${prefix}-user`, "2026-01-01T00:00:00Z", isSidechain),
    { ...record(sessionId, promptId, `${prefix}-assistant`, "2026-01-01T00:00:01Z", isSidechain), type: "assistant", message: { role: "assistant", content: "done" } },
  ];
}

function runFixture(files, extraArgs = []) {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-cli-"));
  const projects = path.join(root, "projects");
  const project = path.join(projects, "demo");
  const out = path.join(root, "out");
  mkdirSync(project, { recursive: true });
  for (const [name, records] of Object.entries(files)) {
    const file = path.join(project, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${records.map(JSON.stringify).join("\n")}\n`);
  }
  const result = spawnSync(process.execPath, [new URL("../bin/flywheel.js", import.meta.url).pathname, "harvest", projects, "--out", out, "--quiet", ...extraArgs], { encoding: "utf8", timeout: 5000 });
  const output = path.join(out, "episodes", "demo.jsonl");
  const episodes = result.status === 0 && (() => { try { return readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch { return []; } })();
  return { result, episodes, manifest: result.status === 0 ? JSON.parse(readFileSync(path.join(out, "harvest-manifest.json"), "utf8")) : null };
}

const cli = new URL("../bin/flywheel.js", import.meta.url).pathname;
function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 5000 });
}

test("CLI deduplicates session and prompt pairs, keeping the longer shell", () => {
  const short = [record("s", "p", "a", "2026-01-01T00:00:00Z"), { ...record("s", "p", "b", "2026-01-01T00:00:01Z"), type: "assistant", message: { role: "assistant", content: "done" } }];
  const long = [...short, { ...record("s", "p", "c", "2026-01-01T00:00:02Z"), type: "assistant", message: { role: "assistant", content: "more" } }];
  const { result, episodes, manifest } = runFixture({ "one.jsonl": short, "two.jsonl": long });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(episodes.length, 1);
  assert.equal(manifest.duplicates_dropped, 1);
});

test("CLI keeps a session and subagent with the same session and prompt", () => {
  const main = shellRecords("s", "p", "main");
  const subagent = shellRecords("s", "p", "sub");
  const { result, episodes, manifest } = runFixture({
    "session.jsonl": main,
    "session/subagents/agent-worker.jsonl": subagent,
  }, ["--include-sidechains"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.map((episode) => episode.agent_id).sort(), ["main", "worker"]);
  assert.equal(manifest.duplicates_dropped, 0);
});

test("CLI deduplicates the same agent's resumed turn across files", () => {
  const short = shellRecords("s", "p", "short");
  const long = [...short, { ...record("s", "p", "b", "2026-01-01T00:00:01Z"), type: "assistant" }];
  const { result, episodes, manifest } = runFixture({ "one.jsonl": short, "two.jsonl": long });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].agent_id, "main");
  assert.equal(manifest.duplicates_dropped, 1);
});

test("CLI never lets a longer subagent collision evict a session", () => {
  const main = shellRecords("s", "p", "main");
  const subagent = [
    ...shellRecords("s", "p", "sub"),
    { ...record("s", "p", "sub-extra", "2026-01-01T00:00:02Z"), type: "assistant", message: { role: "assistant", content: "more" } },
  ];
  const { result, episodes, manifest } = runFixture({
    "session.jsonl": main,
    "session/subagents/agent-main.jsonl": subagent,
  }, ["--include-sidechains"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].source_kind, "session");
  assert.equal(manifest.duplicates_dropped, 1);
});

test("CLI distinguishes matching agent ids in different workflows", () => {
  const first = shellRecords("s", "p", "first");
  const second = shellRecords("s", "p", "second");
  const { result, episodes } = runFixture({
    "session/subagents/workflows/wf_one/agent-shared.jsonl": first,
    "session/subagents/workflows/wf_two/agent-shared.jsonl": second,
  }, ["--include-sidechains"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.map((episode) => episode.agent_id).sort(), ["wf_one/shared", "wf_two/shared"]);
});

test("CLI manifest accounts for every shell", () => {
  const duplicate = [record("s", "p", "a", "2026-01-01T00:00:00Z")];
  const sidechain = [record("s", "side", "b", "2026-01-01T00:00:01Z", true)];
  const { result, manifest } = runFixture({ "one.jsonl": duplicate, "two.jsonl": duplicate, "side.jsonl": sidechain });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest.episodes_written + manifest.duplicates_dropped + manifest.sidechains_dropped, manifest.shells_seen);
});

test("CLI excludes sidechains by default", () => {
  const user = record("s", "side", "a", "2026-01-01T00:00:00Z", true);
  const assistant = { ...record("s", "side", "b", "2026-01-01T00:00:01Z", true), type: "assistant", message: { role: "assistant", content: "done" } };
  const { result, episodes, manifest } = runFixture({ "side.jsonl": [user, assistant] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(episodes.length, 0);
  assert.equal(manifest.sidechains_dropped, 1);
});

test("CLI recursively finds sessions and nested subagents, excluding subagents honestly by default", () => {
  const main = [record("main", "p", "a", "2026-01-01T00:00:00Z"), { ...record("main", "p", "b", "2026-01-01T00:00:01Z"), type: "assistant", message: { role: "assistant", content: "done" } }];
  const subagent = [record("sub", "p", "c", "2026-01-01T00:00:02Z"), { ...record("sub", "p", "d", "2026-01-01T00:00:03Z"), type: "assistant", message: { role: "assistant", content: "done" } }];
  const { result, episodes, manifest } = runFixture({
    "session-uuid.jsonl": main,
    "session-uuid/subagents/agent-x.jsonl": subagent,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest.files_scanned, 2);
  assert.deepEqual(manifest.files_by_kind, { session: 1, subagent: 1, other: 0 });
  assert.equal(manifest.sidechains_dropped, 1);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].source_kind, "session");
  assert.ok(manifest.bytes_read > 0);
});

test("CLI includes path-classified subagents with sidechain metadata", () => {
  const { result, episodes, manifest } = runFixture({
    "session-uuid.jsonl": [record("main", "p", "a", "2026-01-01T00:00:00Z"), { ...record("main", "p", "b", "2026-01-01T00:00:01Z"), type: "assistant", message: { role: "assistant", content: "done" } }],
    "session-uuid/subagents/agent-x.jsonl": [record("sub", "p", "c", "2026-01-01T00:00:02Z"), { ...record("sub", "p", "d", "2026-01-01T00:00:03Z"), type: "assistant", message: { role: "assistant", content: "done" } }],
  }, ["--include-sidechains"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(episodes.length, 2);
  const subagent = episodes.find((episode) => episode.source_kind === "subagent");
  assert.ok(subagent);
  assert.equal(subagent.is_sidechain, true);
  assert.deepEqual(manifest.episodes_by_kind, { session: 1, subagent: 1, other: 0 });
  assert.equal(manifest.sidechains_dropped, 0);
});

test("CLI does not follow symlink directory loops forever", () => {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-cli-loop-"));
  const project = path.join(root, "projects", "demo");
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, "session.jsonl"), `${JSON.stringify(record("s", "p", "a", "2026-01-01T00:00:00Z"))}\n`);
  symlinkSync(project, path.join(project, "loop"), "dir");
  const result = spawnSync(process.execPath, [new URL("../bin/flywheel.js", import.meta.url).pathname, "harvest", path.join(root, "projects"), "--out", path.join(root, "out"), "--quiet"], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(root, "out", "harvest-manifest.json"), "utf8"));
  assert.equal(manifest.files_scanned, 1);
});

test("CLI label then clusters writes ranked clusters", () => {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-label-"));
  const episodesDir = path.join(root, "episodes");
  mkdirSync(episodesDir);
  const episodes = [0, 1, 2].map((index) => ({
    id: `ep_${index}`, session_id: `s_${index}`, started: `2026-01-01T00:00:0${index}Z`, project: "demo",
    steps: [], signals: {}, failure: { signature: "Bash:test_failure:npm test", errorText: "tests failed", witness: { kind: "shell", cmd: "node --test", cwd: root, observedExitCode: 1, replayable: true } },
  }));
  writeFileSync(path.join(episodesDir, "demo.jsonl"), `${episodes.map(JSON.stringify).join("\n")}\n`);
  const labeled = runCli(["label", "--in", episodesDir, "--out", episodesDir], root);
  assert.equal(labeled.status, 0, labeled.stderr);
  const clustered = runCli(["clusters", "--in", episodesDir], root);
  assert.equal(clustered.status, 0, clustered.stderr);
  assert.match(clustered.stdout, /rank\s+size\s+gold\+strong/);
  const saved = JSON.parse(readFileSync(path.join(root, "clusters.json"), "utf8"));
  assert.equal(saved[0].size, 3);
  assert.equal(saved[0].created.endsWith("Z"), true);
});

function proposalFixture(proposable = true) {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-propose-"));
  const episodesDir = path.join(root, "episodes");
  mkdirSync(episodesDir);
  writeFileSync(path.join(episodesDir, "demo.jsonl"), `${JSON.stringify({ id: "ep_1", project: "demo" })}\n`);
  writeFileSync(path.join(root, "SKILL.md"), "Unique heading\nExisting guidance.\n");
  const cluster = { id: "cl_demo", signature: "Bash:test_failure:npm test", errorClass: "test_failure", mode: "test_failure", members: ["ep_1"], size: proposable ? 3 : 1, tierCounts: { gold: 0, strong: proposable ? 3 : 1, weak: 0, unknown: 0 }, cost: { terminal: 1 }, recurrenceRate: { episodesWithSignature: 1, episodesTotal: 1, rate: 1 }, witnesses: proposable ? [{ replayable: true, kind: "shell", cmd: "node --test", cwd: root, observedExitCode: 1 }] : [], created: null };
  writeFileSync(path.join(root, "clusters.json"), `${JSON.stringify([cluster])}\n`);
  return { root, episodesDir };
}

test("CLI propose echo writes a witness-replay self-patch", () => {
  const { root, episodesDir } = proposalFixture(true);
  const out = path.join(root, "patch.json");
  const result = runCli(["propose", "--cluster", "cl_demo", "--in", episodesDir, "--llm", "echo", "--out", out], root);
  assert.equal(result.status, 0, result.stderr);
  const patch = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(patch.diff.format, "before_after");
  assert.equal(patch.diff.before, "Unique heading");
  assert.equal(patch.meta.flywheel.evalStrategy, "witness_replay");
});

test("CLI propose explains a non-proposable cluster", () => {
  const { root, episodesDir } = proposalFixture(false);
  const result = runCli(["propose", "--cluster", "cl_demo", "--in", episodesDir, "--llm", "echo"], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /size 1\/3; gold\+strong 1\/3; replayable witness missing/);
});

test("CLI measure reports n=1 help and restores the target", () => {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-measure-"));
  const patches = path.join(root, "patches");
  const trials = path.join(root, "trials");
  mkdirSync(patches); mkdirSync(trials);
  const target = path.join(root, "target.txt");
  writeFileSync(target, "broken\n");
  writeFileSync(path.join(trials, "cl_demo.mjs"), `import { readFileSync } from "node:fs"; process.exit(readFileSync(${JSON.stringify(target)}, "utf8").includes("fixed") ? 0 : 1);\n`);
  const patchFile = path.join(patches, "cl_demo.json");
  writeFileSync(patchFile, JSON.stringify({ target, diff: { format: "before_after", before: "broken", after: "fixed" }, meta: { flywheel: { clusterId: "cl_demo", evalStrategy: "witness_replay" } } }));
  const result = runCli(["measure", "--patch", patchFile, "--apply"], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /before=RED after=GREEN/);
  assert.match(result.stdout, /"regressed":false,"helped":true/);
  assert.equal(readFileSync(target, "utf8"), "broken\n");
});

test("CLI measure rejects statistical strategies with exit 2", () => {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-statistical-"));
  const patchFile = path.join(root, "patch.json");
  writeFileSync(patchFile, JSON.stringify({ meta: { flywheel: { evalStrategy: "recurrence_probe" } } }));
  const result = runCli(["measure", "--patch", patchFile], root);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /supports only witness_replay.*strategy recurrence_probe needs the statistical arm/);
});
