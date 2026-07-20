import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POWER_FLOOR,
  deltaSd,
  isPowered,
  repeatsNeeded,
  trialsNeeded,
  trialsNeededPaired,
  zFor,
} from "../src/measure/design.js";

test("paired repeats calculation matches the hand derivation", () => {
  assert.equal(repeatsNeeded(0.06, 0.05), 12);
});

test("inverse normal recovers standard design quantiles", () => {
  assert.ok(Math.abs(zFor(0.95) - 1.645) < 0.001);
  assert.ok(Math.abs(zFor(0.975) - 1.96) < 0.001);
  assert.ok(Math.abs(zFor(0.8) - 0.842) < 0.001);
});

test("trials calculation follows the stated Bernoulli variance formula", () => {
  const result = trialsNeeded(0.5, 0.05);
  assert.ok(result >= 1225 && result <= 1235, `received ${result}`);
  assert.equal(trialsNeeded(0.5, 0), Infinity);
});

test("paired trials calculation matches the hand derivation", () => {
  const result = trialsNeededPaired(0.25, 0.05);
  assert.ok(result >= 150 && result <= 160, `received ${result}`);
});

test("per-task delta SD combines repeat noise and task heterogeneity", () => {
  const result = deltaSd(0.5, 12);
  assert.ok(Math.abs(result - 0.25) <= 0.02, `received ${result}`);
});

test("paired design needs roughly eight times fewer tasks", () => {
  const ratio = trialsNeeded(0.5, 0.05) / trialsNeededPaired(0.25, 0.05);
  assert.ok(ratio >= 7.5 && ratio <= 8.5, `received ratio ${ratio}`);
});

test("paired design helpers return Infinity for degenerate inputs", () => {
  for (const value of [0, -1, null, NaN]) {
    assert.doesNotThrow(() => trialsNeededPaired(value, 0.05));
    assert.equal(trialsNeededPaired(value, 0.05), Infinity);
    assert.doesNotThrow(() => trialsNeededPaired(0.25, value));
    assert.equal(trialsNeededPaired(0.25, value), Infinity);
    assert.doesNotThrow(() => deltaSd(value, 12));
    assert.equal(deltaSd(value, 12), Infinity);
    assert.doesNotThrow(() => deltaSd(0.5, value));
    assert.equal(deltaSd(0.5, value), Infinity);
  }
});

test("power floor is a hard gate at 60 held-out tasks", () => {
  assert.equal(POWER_FLOOR, 60);
  assert.equal(isPowered(59), false);
  assert.equal(isPowered(60), true);
});

test("design exports do not throw on null, zero, and NaN inputs", () => {
  assert.doesNotThrow(() => repeatsNeeded(null, 0));
  assert.doesNotThrow(() => repeatsNeeded(NaN, NaN));
  assert.doesNotThrow(() => trialsNeeded(null, 0, null));
  assert.doesNotThrow(() => trialsNeeded(NaN, NaN));
  assert.doesNotThrow(() => trialsNeededPaired(null, 0, null));
  assert.doesNotThrow(() => deltaSd(null, 0));
  assert.doesNotThrow(() => zFor(NaN));
  assert.doesNotThrow(() => isPowered(null));
});
