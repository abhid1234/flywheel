import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = new URL("../bin/flywheel.js", import.meta.url).pathname;

function fixture(row) {
  const home = mkdtempSync(path.join(tmpdir(), "flywheel-promote-"));
  const episodes = path.join(home, "episodes");
  mkdirSync(path.join(home, ".flywheel")); mkdirSync(episodes);
  const episode = { id: "ep_1", session_id: "s", cwd: "/tmp/project", started: "2026-01-01T00:00:00Z", ended: "2026-01-01T00:01:00Z",
    steps: [{ i: 0, ts: "2026-01-01T00:00:30Z", tool: "Bash", input: { command: "node --test" }, ok: false, exitCode: 1 }],
    outcome: { label: "fail", tier: "weak", confidence: 0.4, method: "transcript.weak_signal", evidence: [] } };
  writeFileSync(path.join(episodes, "demo.jsonl"), `${JSON.stringify(episode)}\n`);
  writeFileSync(path.join(home, ".flywheel", "live-capture.jsonl"), `${JSON.stringify(row)}\n`);
  const result = spawnSync(process.execPath, [cli, "promote", "--in", episodes], { encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 5000 });
  return { result, episode: JSON.parse(readFileSync(path.join(episodes, "demo.jsonl"), "utf8")) };
}

test("promote prefers a matching clean live outcome", () => {
  const { result, episode } = fixture({ ts: "2026-01-01T00:00:31Z", session_id: "s", cwd: "<PATH>", tool: "Bash", ok: true, exit_code: 0, cmd_head: "node" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Promoted 1 episode/);
  assert.deepEqual([episode.steps[0].ok, episode.steps[0].exitCode, episode.steps[0].outcomeConfidence], [true, 0, "strong"]);
  assert.deepEqual([episode.outcome.label, episode.outcome.tier, episode.outcome.method], ["pass", "strong", "live_capture"]);
});

test("promote leaves a non-matching episode unchanged", () => {
  const { result, episode } = fixture({ ts: "2026-01-01T00:00:31Z", session_id: "other", cwd: "<PATH>", tool: "Bash", ok: true, exit_code: 0, cmd_head: "node" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Promoted 0 episodes/);
  assert.equal(episode.outcome.method, "transcript.weak_signal");
  assert.equal(episode.steps[0].exitCode, 1);
});
