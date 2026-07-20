import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { segmentRecords } from "../src/harvest/segment.js";

const fixture = readFileSync(new URL("../fixtures/transcripts/episode-with-errors.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);

test("real episode remains one prompt group with all records", () => {
  const groups = segmentRecords(fixture);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].promptId, "3ce1f813-c708-42bd-8fbf-65709c956ee8");
  assert.equal(groups[0].records.length, 16);
  assert.ok(groups[0].records.some((r) => r.type === "assistant" && !r.promptId));
});

test("parent UUID cycles terminate", () => {
  const cycle = [{ uuid: "a", parentUuid: "b", sessionId: "s", type: "assistant", timestamp: "1", message: { content: [{ type: "text", text: "a" }] } }, { uuid: "b", parentUuid: "a", sessionId: "s", type: "assistant", timestamp: "2", message: { content: [{ type: "text", text: "b" }] } }];
  const groups = segmentRecords(cycle);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].promptId, "_orphan:s");
});

test("entirely noisy groups are dropped", () => {
  const noisy = { uuid: "n", promptId: "p", sessionId: "s", type: "user", message: { content: "/login" } };
  assert.deepEqual(segmentRecords([noisy]), []);
});
