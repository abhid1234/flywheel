import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildTrend, sparkline } from "../src/report/trend.js";
import { buildAtlas, renderAtlasHtml } from "../src/report/atlas.js";

const rows = [
  { ts: "2026-01-01T08:00:00Z", episodes: 10, fail_labels: 2 },
  { ts: "2026-01-01T20:00:00Z", episodes: 13, fail_labels: 3 },
  { ts: "2026-01-02T08:00:00Z", episodes: 18, fail_labels: 4 },
];

test("buildTrend computes deltas and groups multiple measurements per day", () => {
  const trend = buildTrend(rows);
  assert.equal(trend.points.length, 2);
  assert.deepEqual(trend.points.map((point) => point.newEpisodes), [3, 5]);
  assert.equal(trend.points[0].episodes, 13);
  assert.equal(trend.points[0].failRate, 3 / 13);
  assert.equal(trend.summary.netNewEpisodes, 8);
  assert.ok(trend.summary.sparkline.length > 0);
});

test("buildTrend clamps a corpus reset to zero new episodes", () => {
  const trend = buildTrend([{ ts: "2026-01-01T00:00:00Z", episodes: 10, fail_labels: 1 }, { ts: "2026-01-02T00:00:00Z", episodes: 2, fail_labels: 0 }]);
  assert.deepEqual(trend.points.map((point) => point.newEpisodes), [0, 0]);
});

test("buildTrend returns a valid degenerate result for empty input", () => {
  assert.deepEqual(buildTrend([]), { points: [], summary: { firstTs: null, lastTs: null, spanDays: 0, totalEpisodes: 0, netNewEpisodes: 0, meanFailRate: 0, sparkline: "" } });
  assert.doesNotThrow(() => buildTrend(null));
});

test("sparkline is deterministic and has one block per value", () => {
  assert.equal(sparkline([0, 2, 4, 8]), sparkline([0, 2, 4, 8]));
  assert.equal([...sparkline([0, 2, 4, 8])].length, 4);
  assert.match(sparkline([0, 2, 4, 8]), /^[▁▂▃▄▅▆▇█]+$/u);
});

test("CLI trend JSON reads a supplied history file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "flywheel-trend-"));
  const history = path.join(root, "history.jsonl");
  writeFileSync(history, `${rows.map(JSON.stringify).join("\n")}\n`);
  const cli = new URL("../bin/flywheel.js", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, "trend", "--history", history, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).points.length, 2);
});

test("CLI trend treats missing history as an empty, friendly state", () => {
  const cli = new URL("../bin/flywheel.js", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, "trend", "--history", "/definitely/missing/flywheel-history.jsonl"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no history yet.*tick populates it every run/i);
});

test("atlas includes escaped trend markup only when history is present", () => {
  const withTrend = renderAtlasHtml(buildAtlas([], [], { historyRows: [...rows, { ts: "2026-01-03T00:00:00Z", episodes: 20, fail_labels: '<script>alert(1)</script>' }] }));
  assert.match(withTrend, /Corpus over time/);
  assert.doesNotMatch(withTrend, /<script>alert/);
  assert.doesNotMatch(renderAtlasHtml(buildAtlas([], [])), /Corpus over time/);
});
