# What I learned building a self-improvement loop for AI agents

*A weekend research build. The honest version — including what doesn't work.*

The pitch is seductive: an agent harvests its own production traces, notices what keeps going wrong, proposes a fix, and gets a little better each time. A flywheel. I built the whole loop — harvest → label → cluster → propose → gate → measure → attest — ran it on ~1,700 real episodes of my own agent work, and here is what actually held up.

## The one design decision that matters

Almost every "self-improving agent" demo has the same hole: the agent writes both the fix *and* the test that judges the fix. That optimizes for the model's imagination, not reality. So the rule here is absolute:

> The LLM writes the fix. It never writes the success criterion.

The success criterion is derived deterministically from the observed failure — a **witness**: the exact command, in the exact directory, that failed in production. A fix is "verified" only when replaying that witness goes red → green. The model can propose anything; it cannot move the goalposts.

This turned out to be the load-bearing idea, and also the source of the project's most important limitation (below).

## Finding 1: the labeler works, and I can prove it

The scary part of any trace-mining system is the oracle — if "did this fail?" is wrong, everything downstream is confident nonsense. So I validated it against ground truth: I ran the labeler on transcripts from my autonomous agent factory and cross-checked its verdicts against GitHub merge outcomes. It recovered **3 of 4** documented failures.

The one it missed is the interesting one. That failure was a *review-stage semantic defect* — a test that passed without actually testing the thing it claimed to. It's invisible from exit codes, and the labeler correctly **did not fabricate a signal it couldn't see**. A system that honestly reports "I can't tell" is worth more than one that guesses.

## Finding 2: witness replay only validates *environmental* fixes

This is the finding I didn't expect and the one that reframes the whole project.

Witness replay is a beautiful oracle for a specific class of problem. `python3 -c "import yaml"` fails with `ModuleNotFoundError`; you `pip install pyyaml`; you replay the exact command; it goes green. Deterministic, falsifiable, trustworthy at n=1 — and I measured the noise to confirm it: replaying deterministic witnesses has **~0 variance**.

But most agent failures aren't environmental. They're *behavioural* — the agent should background a long command, or check a file exists before editing it, or not loop on a failing test. You can't validate a behavioural fix by replaying a command, because the command that timed out will just time out again. The fix changes what the agent *does*, not what the environment *is*.

So: the fixes I can verify cheaply and causally are the ones that matter least, and the fixes that matter most need a statistical arm I can't yet run.

## Finding 3: the statistical arm is blocked, and the block is honest

To prove a behavioural fix helps, you need to run the agent on many tasks, before and after, and beat the run-to-run noise (which is 2–6 percentage points even at temperature 0). That needs gold-labeled tasks — and lots of them. The math says n ≥ 60 for a 5-point effect, paired.

I have ~18. My agent factory produces work, but its telemetry was never designed to link a transcript episode to its outcome — the branch metadata is mostly `main`, so retroactive gold linkage mostly fails. That's a real finding about instrumenting agents: **if you want to learn from outcomes, you have to record the episode→outcome link at decision time.** Bolting it on afterward doesn't work.

This is the pre-registered kill-criterion the plan called KC-6, and hitting it is not failure — it's the result. *The mechanism works; whether it moves the outcome is unproven.* Anyone who tells you their agent self-improvement loop "works" without showing you the outcome-level statistics, on a held-out set, past the noise band, is showing you the mechanism and calling it the outcome.

## Finding 4: eleven packages that had never actually been composed

The loop is built on three of my own zero-dependency packages — `selfpatch` (gate), `truecall` (oracle), `provenant` (ledger). They were designed to compose. They had never been composed. Feeding one's output into the next surfaced **four consecutive interface mismatches** — artifact shape, timestamp ownership, "parents are attestation ids not references," "checks are objects not strings." Each was a real adapter requirement. "It's designed to integrate" and "it integrates" are different claims, and only running the bytes through tells you which you have.

## What compounds

The part that keeps working after the writeup: the system runs continuously on my Mac mini, harvesting its own agent transcripts every two hours, regenerating a **failure atlas** — an honest map of what actually breaks across a growing corpus. That time series can't be created retroactively. Every day it runs, it's the only record of what an agent fleet got wrong on that day, and how that changed. The loop that closes may be modest; the measurement asset underneath it is the thing that lasts.

## The honest bottom line

I set out to build an agent that improves itself and measure whether it worked. What I built is a rigorous instrument for asking that question, a validated failure oracle, a proven-but-narrow closed loop, and a clear map of exactly what's needed to answer the real question (outcome-level gold at scale). The negative space — witness replay can't see behaviour, the gold isn't there yet, the packages didn't actually compose — is the most useful thing in here.

That's a weekend well spent.

---

*Built with Claude Code, Codex, Cursor, and Google Antigravity. Code: github.com/abhid1234/flywheel. MIT.*
