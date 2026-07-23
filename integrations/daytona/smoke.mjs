#!/usr/bin/env node
// One-sandbox smoke test: prove the key + SDK + create/exec/delete round-trip
// works before spending on a full trial run. Reads DAYTONA_API_KEY from the env.
import { Daytona } from "@daytonaio/sdk";

if (!process.env.DAYTONA_API_KEY) { console.error("DAYTONA_API_KEY not set"); process.exit(1); }

const t0 = Date.now();
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, ...(process.env.DAYTONA_API_URL ? { apiUrl: process.env.DAYTONA_API_URL } : {}) });

let sandbox;
try {
  process.stdout.write("creating sandbox…\n");
  sandbox = await daytona.create();
  const created = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`✓ sandbox up in ${created}s (id: ${sandbox.id})\n`);

  // the controlled failure, live: before-arm should fail, after-arm should pass
  const before = await sandbox.process.executeCommand(`python3 -c "import yaml"`, undefined, undefined, 60);
  process.stdout.write(`before-arm  → exit ${before.exitCode}  (expect non-zero: ModuleNotFoundError)\n`);

  await sandbox.process.executeCommand(`pip install pyyaml`, undefined, undefined, 120);
  const after = await sandbox.process.executeCommand(`python3 -c "import yaml"`, undefined, undefined, 60);
  process.stdout.write(`after-arm   → exit ${after.exitCode}  (expect 0: fix worked)\n`);

  const ok = before.exitCode !== 0 && after.exitCode === 0;
  process.stdout.write(`\n${ok ? "✓ CONTROLLED SEPARATION CONFIRMED" : "⚠ unexpected: before=" + before.exitCode + " after=" + after.exitCode} on a real Daytona sandbox\n`);
} finally {
  if (sandbox) { process.stdout.write("tearing down…\n"); try { await sandbox.delete(); process.stdout.write("✓ deleted\n"); } catch (e) { process.stdout.write(`⚠ delete failed: ${e.message}\n`); } }
  process.stdout.write(`total: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}
