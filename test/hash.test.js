import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, contentId, sha256hex } from "../src/hash.js";

test("canonicalize recursively sorts object keys and preserves arrays", () => {
  assert.equal(canonicalize({ b: 1, a: { d: 4, c: 3 }, gone: undefined }), canonicalize({ a: { c: 3, d: 4 }, b: 1 }));
  assert.equal(canonicalize([2, 1]), "[2,1]");
});

test("contentId is stable and uses a truncated sha256", () => {
  const id = contentId("ep", { b: 1, a: 2 });
  assert.equal(id, contentId("ep", { a: 2, b: 1 }));
  assert.match(id, /^ep_sha256:[0-9a-f]{16}$/);
  assert.equal(sha256hex("x").length, 64);
});

test("hash helpers tolerate non-object and cyclic input", () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.doesNotThrow(() => canonicalize(cyclic));
  assert.doesNotThrow(() => contentId(null, null));
});
