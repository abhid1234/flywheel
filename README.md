# flywheel

**Agents that improve from their own production traces.** Harvest what an agent actually did, label which turns failed, cluster the recurring failures, propose a fix, gate it, and — the part everyone skips — *measure whether the fix actually helped* by replaying the exact command that failed in production.

Zero dependencies. Pure core, thin CLI seam. Built to be honest about what it can and can't prove.

```
harvest → label → cluster → propose → gate → measure → attest → report
```

---

## The one rule everything is built around

> **The LLM writes the fix. It never writes the success criterion.**

If a model can author its own passing test, a self-improvement loop optimizes for the model's imagination instead of reality. So the eval contract is derived *deterministically from the observed production failure* — a **witness**: the exact command, in the exact directory, that failed. A fix is only "verified" when replaying that witness goes **red → green**. Three guards enforce this in code, not prompt:

1. The success criterion comes from a recorded failure — the model can't move the goalposts.
2. A proposed edit's anchor must appear **verbatim, exactly once** in the target file, or it's rejected before gating.
3. The improvement claim is falsifiable by replaying the command that failed.

## What it composes

flywheel doesn't reinvent the safety machinery — it wires together three existing zero-dep packages:

| stage | package | role |
|---|---|---|
| gate | [`selfpatch`](https://github.com/abhid1234/selfpatch) | every self-edit is gated (blocks secrets/`settings.json`), verified before/after, and revertible |
| oracle | [`truecall`](https://github.com/abhid1234/truecall) | deterministic post-conditions (τ²-bench: ~0 false positives) — licenses trusting a red→green at n=1 |
| ledger | [`provenant`](https://github.com/abhid1234/provenant) | each applied fix is attested, recording what it derived from |

Integrating them took a four-fix adapter (artifact shape, timestamp seam, parents-are-attestation-ids, checks-are-objects) — concrete evidence these packages were built in isolation and had never actually been composed. A self-verifying contract test imports the real `provenant` validator so the integration can't silently rot.

## Install & run

```bash
git clone https://github.com/abhid1234/flywheel && cd flywheel
node --test                                   # 145 tests, zero deps

# harvest your own Claude Code transcripts into episodes
node bin/flywheel.js harvest ~/.claude/projects --out ~/.flywheel
node bin/flywheel.js label    --in ~/.flywheel/episodes --out ~/.flywheel/episodes
node bin/flywheel.js clusters --in ~/.flywheel/episodes --top 15
node bin/flywheel.js report   --in ~/.flywheel/episodes --out atlas.html   # the failure atlas
node bin/flywheel.js loop     --in ~/.flywheel/episodes --llm echo --dry-run
```

## The pieces

- **harvest** — segments transcripts into episodes by `promptId` (98.4% coverage on real data), joins tool calls to results, parses exit codes and Claude Code tool-level errors, and applies the *recovery rule*: a failure the agent later fixes in the same episode doesn't count. Filters benign non-zero exits (a `grep` with no match is not a failure) and non-agent-faults (a user declining a tool is not a defect the agent could fix).
- **label** — assigns trust tiers: `gold` (adjudicated / structured outcome), `strong` (deterministic post-condition or unrecovered terminal error), `weak` (proxy signals), `unknown`. `tier` is a required, non-defaulting field — a label without it fails validation, so weak signals can never silently become training signal.
- **cluster** — groups failures by exact signature, then merges near-identical ones (token-set Jaccard, same tool + error class). No embeddings — machine-generated error text is already near-canonical. `isProposable` gates: size ≥ 3, ≥ 3 gold/strong, ≥ 1 replayable witness.
- **propose** — a deterministic brief → the LLM writes a fix → strict parse → a witness-derived eval contract. `weights` layer throws (unbuildable, honestly unconstructible rather than fake-pluggable).
- **measure** — the deterministic arm (witness replay, ~0 variance) ships first; the statistical arm (paired cluster-bootstrap, held-out split, n ≥ 60 hard floor) is scaffolded and gated behind gold-label volume.
- **loop** — auto-applies *only* gated S1 context/skill fixes that pass witness replay; everything else queues for a human. Append-only hash-linked `ledger.jsonl`.

## Honest status

This is a research build, and its findings include what *doesn't* work yet:

- ✅ **M0 — harvest** works on a real 440 MB / 610-file corpus in ~2 s → 837 episodes.
- ✅ **M1 — the labeler is validated.** Run against the author's real agent-factory transcripts and cross-checked with GitHub ground truth, it recovered **3 of 4** documented failures. The one it missed was a review-stage *semantic* defect (a test that passes without testing the thing) — invisible from exit codes, and it correctly did not fabricate a signal it couldn't see.
- ✅ **M2 — the closed loop is proven,** both ways: a proposed context note that *couldn't* fix a missing dependency was reported `helped:false` (the gate refused to certify it), and a recorded production witness, replayed unchanged after the real cause was fixed, went red → green.
- ⏳ **M3 — the statistical arm is blocked, honestly.** Whether prompt/skill fixes move the *outcome* (not just the mechanism) needs gold-label volume the current corpus doesn't have. This is the pre-registered [KC-6 finding](#): *the mechanism works; that it moves the outcome is unproven.* Witness replay validates **environmental** fixes; **behavioural** fixes need the statistical arm. That distinction is the honest core of the project.

## Design invariants

- **Zero dependencies.** Nothing under `src/` imports a `node:` module except `src/hash.js`; `bin/flywheel.js` is the only I/O seam. The entire core is pure and testable offline.
- **No clock, no randomness in `src/`.** Content-hash ids make every stage idempotent.
- **Deterministic bootstrap** (seeded), so statistical results are reproducible.

Built primarily by Codex (`gpt-5.6-sol`), specified and independently verified chunk by chunk. MIT.
