# Flywheel overnight queue (2026-07-20 → 21)

Autonomous run. Codex builds, Claude specs + verifies + commits + pushes each item.
State of truth: git@github.com:abhid1234/flywheel (private). Every item = commit + push when green.
RULE: `codex exec ... < /dev/null` ALWAYS (open stdin hung 8h once). Verify independently; never trust a self-report of test counts.

## Current: 145 tests, M0/M1/M2 done, real selfpatch+provenant integration, README+LICENSE, atlas, loop.

## Queue (work top-down; check off in this file; commit each)
- [ ] G1  Forward-looking GOLD: patch mini `factory-tick.sh` to append the episode↔outcome tuple
        (issue,pr,tests_ok,verdict,codex_verdict,terminal_state, tests_source) to ~/.flywheel/factory-episodes.jsonl.
        Then restart the factory launchd jobs so it generates gold-labeled work overnight.
- [x] G2  `flywheel gold` command: read factory-episodes.jsonl + GitHub merge-status, emit gold labels,
        merge into episode outcomes. Report gold count vs the n>=60 floor honestly.
- [x] G3  A/A calibration harness (`flywheel calibrate`): run the deterministic witnesses N times,
        confirm ~0 variance; scaffold the agent-trial A/A (bounded) for when gold arrives. KC-2.
- [x] G4  Deploy flywheel to the mini; a launchd/cron that harvests+labels+reports every few hours
        so the corpus + atlas compound (the "measurement asset").
- [ ] G5  M5 live-capture: wire truecall handleHookEvent as a PostToolUse hook so new labels are born strong.
- [ ] G6  Robustness pass: 1000+ file corpus streaming, malformed-line fuzzing, cross-file parentUuid.
- [x] G7  Honest findings writeup (blog draft) — the KC-6 result, the 4-fix integration story, the atlas.
- [ ] G8  npm packaging polish + `flywheel --help` completeness + examples/.

## Log

- 2026-07-21 ~00:45 — G2 gold (merge-status, 18 linked/60), G3 calibrate (deterministic arm clean;
  network witnesses flap — real finding), G4 DEPLOYED: com.abhi.flywheel-tick on the mini runs
  harvest+label+cluster+report every 2h. Mini corpus = 907 episodes, a size-14 proposable cluster.
  160 tests, pushed. Remaining: G1 (factory gold emit — production, careful), G5 live-capture,
  G6 robustness, G7 writeup, G8 npm polish.
