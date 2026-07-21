import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildEpisode } from "../src/harvest/episode.js";
import { extractSteps } from "../src/harvest/steps.js";
import { buildAtlas, renderAtlasHtml } from "../src/report/atlas.js";

const cli = new URL("../bin/flywheel.js", import.meta.url).pathname;

function workspace(prefix = "flywheel-fuzz-") {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const projects = path.join(root, "projects");
  const project = path.join(projects, "demo");
  const out = path.join(root, "out");
  mkdirSync(project, { recursive: true });
  return { root, projects, project, out };
}

function runHarvest(projects, out, extra = [], timeout = 30_000) {
  return spawnSync(process.execPath, [cli, "harvest", projects, "--out", out, "--quiet", ...extra], { encoding: "utf8", timeout });
}

function usefulRecords(promptId = "good") {
  return [
    { uuid: `${promptId}-u`, sessionId: "session", promptId, type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "request" } },
    { uuid: `${promptId}-a`, sessionId: "session", promptId, type: "assistant", timestamp: "2026-01-01T00:00:01Z", message: { content: "answer" } },
  ];
}

function episodes(out) {
  return readFileSync(path.join(out, "episodes", "demo.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

test("harvest survives malformed-line fuzz and counts rejected lines", () => {
  const { projects, project, out } = workspace();
  let deep = { harmless: true };
  for (let index = 0; index < 1000; index += 1) deep = { nested: deep };
  const chunks = [
    Buffer.from(`\ufeff${JSON.stringify(usefulRecords()[0])}\n`),
    Buffer.from(`${JSON.stringify(usefulRecords()[1])}\n`),
    Buffer.from('{"truncated":\n'),
    Buffer.from(`${"x".repeat(5 * 1024 * 1024)}\n`),
    Buffer.from('nul\0byte\n'),
    Buffer.from([0xff, 0xfe, 0x0a]),
    Buffer.from('42\n[1,2]\n"string"\n'),
    Buffer.from(`${JSON.stringify(deep)}\n`),
  ];
  writeFileSync(path.join(project, "fuzz.jsonl"), Buffer.concat(chunks));
  const result = runHarvest(projects, out, [], 30_000);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const manifest = JSON.parse(readFileSync(path.join(out, "harvest-manifest.json"), "utf8"));
  assert.equal(manifest.lines_unparseable, 7);
  assert.equal(episodes(out).length, 1);
});

test("50k records complete quickly and oversized groups carry the truncation signal", () => {
  const { projects, project, out } = workspace("flywheel-large-");
  const records = Array.from({ length: 49_998 }, (_, index) => ({
    uuid: `large-${index}`, sessionId: "session", promptId: "large", type: "assistant",
    timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}Z`, message: { content: "answer" },
  }));
  records.push(...usefulRecords("normal"));
  writeFileSync(path.join(project, "large.jsonl"), `${records.map(JSON.stringify).join("\n")}\n`);
  const started = Date.now();
  const result = runHarvest(projects, out, ["--max-group-records", "100"], 30_000);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.ok(Date.now() - started < 30_000);
  const values = episodes(out);
  assert.equal(values.find((episode) => episode.prompt_id === "large").signals.truncated_group, true);
  assert.equal(values.find((episode) => episode.prompt_id === "normal").signals.truncated_group, undefined);
});

test("adversarial request and error text stay bounded and cannot inject atlas markup", () => {
  const attack = '<script>globalThis.owned=true</script>${process.env.SECRET}\u0000\u0001';
  const blob = `Error: ${attack}${"z".repeat(100 * 1024)}`;
  const shell = { promptId: "p", sessionId: "s", records: [
    { uuid: "u", type: "user", message: { content: `${attack}${"q".repeat(100 * 1024)}` } },
    { uuid: "a", type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "false" } }] } },
    { uuid: "r", type: "user", toolUseResult: {}, message: { content: [{ type: "tool_result", tool_use_id: "t", content: `Exit code 1\n${blob}`, is_error: true }] } },
  ] };
  const episode = buildEpisode(shell, extractSteps(shell), { project: "demo" });
  assert.equal(episode.request.text.length, 2048);
  assert.equal(episode.steps[0].errorText.length, 2048);
  const cluster = { id: "c", signature: episode.failure.signature, members: [episode.id], size: 1, tierCounts: {}, witnesses: [] };
  const html = renderAtlasHtml(buildAtlas([episode], [cluster]));
  assert.doesNotMatch(html, /<script>globalThis\.owned/);
  assert.match(html, /&lt;script&gt;globalThis\.owned/);
});

test("harvesting twice produces byte-identical episode JSONL", () => {
  const { projects, project, out } = workspace("flywheel-idempotent-");
  writeFileSync(path.join(project, "session.jsonl"), `${usefulRecords().map(JSON.stringify).join("\n")}\n`);
  const hash = () => createHash("sha256").update(readdirSync(path.join(out, "episodes")).sort().map((name) => readFileSync(path.join(out, "episodes", name))).join("\0")).digest("hex");
  const first = runHarvest(projects, out);
  assert.equal(first.status, 0, first.stderr);
  const firstHash = hash();
  const second = runHarvest(projects, out);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(hash(), firstHash);
});

test("an empty projects directory exits cleanly with a clear message", () => {
  const { projects, out } = workspace("flywheel-empty-dir-");
  const result = runHarvest(projects, out);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /zero \.jsonl files found/);
  assert.equal(result.signal, null);
});

test("a directory containing only empty JSONL files harvests cleanly", () => {
  const { projects, project, out } = workspace("flywheel-empty-file-");
  writeFileSync(path.join(project, "empty.jsonl"), "");
  const result = runHarvest(projects, out);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(out, "harvest-manifest.json"), "utf8"));
  assert.equal(manifest.episodes_written, 0);
  assert.equal(manifest.lines_read, 0);
});

test("a directory containing only non-JSONL files exits cleanly", () => {
  const { projects, project, out } = workspace("flywheel-weird-file-");
  writeFileSync(path.join(project, "notes.txt"), "not a transcript");
  const result = runHarvest(projects, out);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /zero \.jsonl files found/);
  assert.equal(result.signal, null);
});
