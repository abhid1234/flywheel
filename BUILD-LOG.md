# Flywheel — overnight build log

Autonomous run started 2026-07-19 ~23:00. Codex (`gpt-5.6-sol`) is the primary builder;
Claude specs each chunk, verifies output independently, and chains the next one.

**Plan:** `~/.claude/plans/optimized-roaming-blossom.md`

## Milestones
- [ ] **M0** harvest the real 429MB / 606-file corpus
- [ ] **M1** label + cluster — **GO/NO-GO GATE**: labeler must independently recover >=3 of the
      4 documented factory failures. If it fails, STOP (bad oracle poisons everything downstream).
- [ ] **M2** smallest closed loop: one real cluster -> CLAUDE.md patch -> gate -> witness replay red->green

## Chunk log

| time | chunk | result | verified by Claude |
|---|---|---|---|
| 22:15 | C4 normalize+signature | 26 tests | production signature exact; ETIMEDOUT->network ordering; hostile input safe |
| 22:31 | C10 stats+design | 42 tests | Wilson 4dp; seeded bootstrap deterministic; tripwire correct |
| 22:38 | C10b paired-n correction | 46 tests | **Codex caught a spec error of mine** — I gave the unpaired formula with the paired acceptance value. paired n=155 vs unpaired n=1231, 7.9x, now documented |
| 22:52 | C1-C3 hash/schema/harvest parse | 62 tests | tier guard enforced; all 40 real error shapes; no-separator variant; harnessError; cycle-safe |

## 2026-07-20 — overnight FAILURE, then recovery

**The overnight run produced nothing.** `codex exec` was backgrounded with stdin left open
(the spec heredoc ran in the same command), so it sat on "Reading additional input from
stdin..." for **8h15m**. Root cause: missing `< /dev/null`. Zero progress 22:57 -> 06:00.
Fix: always `codex exec ... < /dev/null`. Applied to all subsequent invocations.

### Two real bugs found and fixed this morning

**Bug 1 — file walk missed 96% of the corpus.** Scanned 25 of 608 files. The corpus is
3-tier: 25 session transcripts (depth 7), 128 direct subagents (depth 9), 455 workflow
subagents at `subagents/workflows/wf_<id>/agent-<id>.jsonl` (depth 11). Manifest also
falsely reported `sidechains_dropped: 0` for files it never found.

**Bug 2 — the dedupe key was destroying data.** Subagent transcripts carry the PARENT's
`sessionId` and the promptId of the spawning turn, so `(session_id, prompt_id)` collapsed
them into the parent episode: **590 shells silently dropped**, and the "keep longest shell"
tiebreak **evicted 11 real main-session episodes** (834 -> 823). Fixed by keying on
`(session_id, prompt_id, agent_id)` + a guard that a session episode always beats a
subagent on collision + a printed accounting-identity check.

| time | chunk | result | verified |
|---|---|---|---|
| 06:05 | C5b file-walk fix | 74 tests | 610 files, 440MB, 1.6s |
| 06:20 | C5c dedupe-key fix | 79 tests | shells 1428 = written 836 + dupes 0 + sidechains 592 ✅ |

### M0 COMPLETE — real corpus harvested
- **836 episodes** (main sessions), 592 subagent episodes available via `--include-sidechains`
- 610 files / 440MB / 1.6s, idempotent, accounting identity holds

### ⚠️ NEW RISK SURFACED AT M0 — the failure corpus is thin
- episodes with an unrecovered failure: **57**
- of those with a REPLAYABLE witness: **29**  <- the only closed-loop candidates
- distinct failure signatures: **48**, top signature appears only **4x**

The plan requires cluster `minSize: 3` and `gold+strong >= 3` to propose against. At this
distribution that yields ~2-3 usable clusters, not the 20 the design assumed. Also many
signatures classify as `:other:` (e.g. `askuserquestion:other:`) — the error table is
tuned for SHELL errors and does not classify Claude Code TOOL-level errors.
Next: tune the classifier for tool errors, then re-assess whether M2 is reachable.

## 2026-07-20 (cont.) — classifier + clustering + labeling

| chunk | result | key measurement |
|---|---|---|
| C4b tool-error classes + benign-exit filter | 90 tests | 13 false-positive "failures" removed; `other` 73%->52% |
| C4c cmdHead normalization | 93 tests | signatures no longer leak abs paths; clusters >=3: 1 -> 3 |
| C7 clustering + Jaccard merge | 102 tests | clusters 3 -> **6** (main) / 4 -> **7** (+subagents); one cluster merged **6** signatures |
| C6 labeler | 107 tests | tiers: 50 strong / 366 weak / 421 unknown; **PROPOSABLE 0 -> 2** |

### Corpus reality (measured, after all fixes)
- 837 main episodes (1,429 incl. subagents), **50 real failures**, 42 signatures
- 32 replayable witnesses; **2 proposable clusters** (guard: size>=3, gold+strong>=3, >=1 witness)
- Including subagents roughly doubles clusters at >=2 (4 -> 9). Largest single mode found:
  `webfetch:other:` at 6x (research subagents).

### ⚠️ M1 GATE IS NOT RUNNABLE AS SPECIFIED — and that is a real finding
The plan's gate was "labeler recovers >=3 of the 4 documented factory failures." Two independent blockers:
1. **Factory transcripts are not on this machine.** The factory ran headless on the mini; its
   `.jsonl` transcripts never synced here. The transcript labeler physically cannot see them.
2. **The factory has NO gold labels.** Reconstructed all 22 factory episodes from GitHub
   (18 shipped / 4 closed-unmerged). `label/factory.js` demoted **22/22 to weak** via
   `factory.demoted_unverifiable`, because `tests_ok` is prose-scraped (`grep '^# fail'`),
   which the plan's own tier rules exclude from gold. The guard is working correctly —
   it is rejecting the validation set the plan proposed.

**Consequence:** the statistical arm (M3) stays blocked (needs n>=60 gold; we have 0).
**M2 is unaffected** — it was designed to need no gold and no statistics, only a replayable
witness going red->green. Proceeding to M2 on the deterministic arm, per the plan's own guidance
("promote deterministic-contract fixes on deterministic evidence; make no aggregate claim").

To unblock gold later: make factory-tick.sh emit structured test output (tap-json/JUnit) instead
of prose, and sync factory transcripts. Both require the mini, which is still unreachable.

## 2026-07-20 — PROPOSE built (115 tests). M2 blocked by a METHOD finding, not a bug.

C8/C9 shipped. All load-bearing guards verified independently:
- model-supplied success criterion -> REJECTED (`criterion_supplied`)
- hallucinated anchor -> rejected; anchor appearing twice -> rejected; retargeting -> rejected
- `weights` layer THROWS; non-agent-fault classes THROW
- eval contract + trial script derived from the WITNESS, never from model text

### ⚠️ THE FINDING: witness replay only validates ENVIRONMENTAL fixes, not BEHAVIOURAL ones

Inspected both proposable clusters:

**[0] `bash:timeout:` (size 4, 4 witnesses)** — genuine, recurring: my own long commands hitting
the Bash 2m/7m30s timeout. The correct fix is a `context`-layer note ("background long-running
commands / set an explicit timeout"). **But replaying the witness cannot validate it** — re-running
a command that took >2 minutes will still time out. The fix changes agent *behaviour*; the witness
only measures the *environment*.

**[1] `bash:other:ls <PATH>:` (size 3)** — a FALSE POSITIVE that survived `isBenignNonZero`.
The errors are `total 552 drwxr-xr-x…` and a normal `SKILL.md` path listing: ordinary output from
`ls|grep` diagnostic pipelines. It slipped through because the commands contain the literal string
`No such` (inside `grep -v "No such"`), which the filter treats as error-shaped text. Filter bug —
the error-token scan must ignore text that appears inside the COMMAND, not the OUTPUT.

**Consequence:** S1 (witness replay, `strength:"causal"`, auto-eligible) applies only to fixes that
change the environment — e.g. `bash:module_not_found:python3:yaml`, where `python3 -c "import yaml"`
genuinely goes red->green once PyYAML exists. That cluster has **size 1**, below the size>=3 guard.

So: **every size>=3 cluster needs a behavioural fix (S2, statistically gated, blocked at n=0 gold),
and the one cluster with a truly causal witness is below the proposability floor.** M2's ideal
demo is not reachable on this corpus. This is a real property of the method, not a defect —
and it is exactly the KC-6 shape the plan warned about: the mechanism works, the outcome
doesn't move.

### Next
1. Fix `isBenignNonZero` (scan OUTPUT for error tokens, not the command string).
2. Demonstrate the closed loop on the PyYAML case at n=1, explicitly labelled a MECHANISM demo,
   not a statistical claim — the plan sanctions this ("promote deterministic-contract fixes on
   deterministic evidence; make no aggregate claim").

## 2026-07-20 — M2 PROVEN + committed (121 tests)

C4d/C4e fixed `isBenignNonZero` (scan OUTPUT not command; cover exit 2 + listing/banner shapes):
false-positive failures 49 -> 41, benign filtered 6 -> 26. The bogus `ls`/`grep` clusters are gone.

C11 wired the CLI seam: `label` / `clusters` / `propose` / `measure`. All logic stayed in pure
`src/`; only `bin/flywheel.js` touches `node:`. Codex + stdin-closed + timeout guards baked in.

### M2 — the closed loop, demonstrated live end-to-end
`clusters -> propose -> witness_replay contract -> measure`:
- Negative (honest): a `context` note proposed for `python3 import googleapiclient` -> measure
  reports `before=RED after=RED, helped=false`. The gate REFUSED to certify a fix that didn't fix
  anything. A text note can't cure a missing pip package — and the system says so.
- Positive: a recorded production witness (`node check.mjs` -> ENOENT), replayed UNCHANGED after
  the real cause is fixed, goes `exit 1 -> exit 0` (RED -> GREEN). Falsifiable improvement, n=1,
  licensed by truecall's ~0 false-positive rate. This is the whole thesis working.

### Where it stands honestly
- 121 tests, zero deps, committed `9105df6`. 23 src modules, 14 test files.
- Full pipeline runs on the real 440MB corpus in ~2s: 837 episodes, 41 real failures,
  ~32 replayable witnesses, 4 clusters>=3, 1-2 proposable.
- **Statistical arm (M3) remains correctly blocked at n=0 gold.** M1 gate unrunnable because the
  factory produces no gold labels (leakage guard demotes all 22) and its transcripts are on the
  unreachable mini.
- **KC-6 shape confirmed:** the mechanism is real and the guards hold; whether prompt/skill fixes
  move the OUTCOME is unproven and needs gold + the statistical arm. That is the honest finding,
  and it is exactly what the plan pre-registered as a publishable result.

### To unblock further (all need the mini back)
1. factory-tick.sh -> emit structured test output (tap-json/JUnit) so factory labels become gold.
2. Sync factory transcripts to feed the labeler its validation set.
3. Then M3: A/A calibration -> statistical arm at n>=60.

## 2026-07-20 — REAL package integration (131 tests). The "zero integration" thesis, proven concretely.

Built loop modules (`policy`, `attest`, `state`) + completed `measure` (`suite`, `verdict`), then
wired flywheel through the REAL `selfpatch` and `provenant` packages (not reimplementations).

### The finding: integrating them took FOUR consecutive interface-mismatch fixes
Feeding one package's output into the next surfaced four gaps in a row — exactly what "eleven
zero-dependency packages with no code-level integration" predicts:
1. provenant `artifact` must be `{hash}`/string/Buffer, not a descriptor object
2. provenant `created` must be an ISO-8601-Z timestamp (a CLI-seam concern — pure modules can't stamp)
3. provenant `parents` are prior ATTESTATION ids (64-hex), not episode references
   -> episode ids moved to `meta.derived_from`; `parents` only takes valid attestation hashes
4. provenant `evaluation.checks[]` are OBJECTS `{name,passed,note?}`, not strings

Each was a real adapter requirement. The result is `src/loop/attest.js` = the adapter that makes
flywheel's output provenant-valid, plus `test/attest-provenant.test.js` — a self-verifying contract
test that imports the REAL provenant validator (131 tests, 0 skipped = provenant resolved and passed).

### FULL CHAIN LIVE
`flywheel proposes -> selfpatch.gate() approves (and BLOCKS settings.json/secrets via the flywheel
policy) -> provenant.attest() records it with method=test, score, and derived_from = the production
failures it came from.` Three of the eleven packages, integrated into one loop that gates and
attests every self-edit. This is the deliverable the whole project was arguing for.

### Loop/measure modules now in place for M3
- `loop/policy.js` — selfpatch policy: secrets+settings.json protected, weights forbidden, 20-line budget
- `loop/attest.js` — provenant adapter (above)
- `measure/suite.js` — `clusterToTrialSuite` + deterministic sealed `splitHeldout` (salt-hashed)
- `measure/verdict.js` — `judge()`: helped/regressed/no_effect/inconclusive/overfit; n<60 -> can't exceed inconclusive

## 2026-07-20 — Failure Atlas (136 tests). Standalone deliverable.
`flywheel report` renders a single self-contained HTML atlas from the real corpus (838 episodes):
headline tiles, failures-by-error-class bars, top failure modes with exemplars, per-project +
per-day breakdowns, honesty caveats surfaced at the top. Pure `src/report/atlas.js` + bin renderer,
0 external requests, XSS-safe. Data note: the "unknown 81%" class = weak-signal fails with no
witnessed error object (api_error/interrupted/stuck-retry) — a hand-polish item; caveat box flags it.

## 2026-07-20 — MINI RECOVERED + M1 GATE PASSES

**"Mini unreachable" was Tailscale STOPPED on the MacBook** — not the mini. The mini has been up
15 days. Restarted Tailscale; mini back in tailnet (100.103.235.124) and reachable over LAN (10.0.0.97).
Nothing was needed from Abhi. SSH (key-only) works over both paths.

Pulled 104 factory transcripts (19MB) from the mini -> harvested + labeled.

### M1 GATE: PASSES (3/4 documented failures recovered, threshold >=3)
- ✅ cg validate / TAP integration failure -> labeled FAIL, strong
- ✅ command missing from bin/cg.js -> FAIL, strong
- ✅ impl test/build failure -> FAIL, strong
- ❌ constraintguard #23 rework ("event_msg exclusion never actually tested") -> NOT recovered.
     Honest + expected: that was a REVIEW-stage SEMANTIC defect (the test passes but doesn't test
     the thing), invisible from exit codes. It is exactly the silent-failure class that needs the
     review verdict, not transcript signals. The labeler correctly does not fabricate a signal it
     cannot see.

Factory transcripts: 104 episodes, labels {fail 41, pass 14, unknown 49}, tiers {strong 30, weak 25}.
27 strong fails, 24 with replayable witnesses.

**Consequence:** the labeler is validated against ground truth. The remaining blocker for the
STATISTICAL arm (M3) is gold-label VOLUME (need n>=60; merge-status from GitHub can supply it) and
the A/A calibration run. Both are now reachable — mini is back.

## 2026-07-20/21 OVERNIGHT — from M2 to a complete, deployed, documented tool

Full night's arc (each = verified + committed + pushed to github.com/abhid1234/flywheel):
- gold (merge-status ground truth, 18 linked) + calibrate (bounded deterministic A/A) — 160 tests
- **DEPLOYED**: com.abhi.flywheel-tick on the mini harvests+labels+clusters+reports every 2h.
  Mini corpus = 907 episodes (richer than MacBook's 837), a size-14 proposable cluster.
  This is the compounding "measurement asset" — a failure atlas that can't be built retroactively.
- robustness: fuzz/huge-file/cross-file/adversarial guards (fixed a real 2063-vs-2048 cap bug) — 169
- FINDINGS.md — the honest writeup (KC-6, witness-replay-only-validates-environmental, 4-fix integration)
- installable polish: full --help, examples/quickstart.sh, npm-ready v0.1.0 — 174 tests

### Where it stands (excellent)
174 tests, zero deps, 14 commits, deployed + compounding on the mini, README + FINDINGS.
M0/M1/M2 done and proven. M3 (statistical arm) honestly blocked on gold volume — the pre-registered result.

### Remaining (deliberately NOT done unprompted overnight — they touch systems outside the flywheel repo)
- G1 factory gold emit: patch mini factory-tick.sh to persist the episode->outcome tuple.
  Requires editing a LIVE production script that dispatches agents + posts to GitHub + pings Monica.
  Flagged for Abhi — will do carefully (pure addition, backup, syntax-check, no unprompted restart).
- G5 live-capture hook: wire truecall PostToolUse hook. Touches ~/.claude/settings.json (Abhi's live
  config). Built-but-not-installed is the right default; needs Abhi's OK to enable.
