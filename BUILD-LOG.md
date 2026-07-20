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
