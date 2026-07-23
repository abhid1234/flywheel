# The Learning Curve — flywheel's continual-learning experiment

The static benchmark next door proves flywheel can **measure** whether a fix
helped. This proves the thing the whole project is named for: **an agent that
improves from its own production traces, round over round, and compounds.**

## What "continual learning" actually requires

A single before/after isn't learning — a human supplied both sides. Real
continual learning is a loop that closes *autonomously* and *compounds*:

```
   ┌─────────────────────────────────────────────────────────┐
   │  agent attempts real tasks in isolated Daytona sandboxes │
   │            ↓                                             │
   │  some fail → harvest transcripts → cluster the recurring │
   │  mistake → the LLM writes a DURABLE LESSON → append it   │
   │  to the agent's standing instructions (its memory)       │
   │            ↓                                             │
   │  re-measure on a SEALED held-out set → success climbs    │
   └────────────────────────── repeat ───────────────────────┘
```

The deliverable is a **curve that climbs**, not a bar that moves. Run
`node experiment.mjs` to see it (simulated agent, offline, reproducible).

## Why this needs Daytona, and at scale

The tasks that make continual learning meaningful are ones where the agent's
output must be **executed** to know if it's right — code against a hidden test
suite, a script against real inputs, a query against real data. That execution
is untrusted (an agent wrote it) and has to run in parallel by the hundreds.
That is exactly what Daytona is for: sub-second isolated sandboxes, massively
parallel, disposable. The bigger the experiment, the more it needs that.

## The two backends

- **`--agent simulated`** (default) — a faithful *model* of how an agent improves
  as relevant lessons enter its instructions, with real run-to-run noise. It is
  clearly labelled as a mechanism demonstration; it proves the loop, the sealing,
  and the visualization without spending a cent.
- **`--agent daytona`** (the real experiment) — each attempt spins a sandbox,
  runs a live coding agent (`codex`/`claude`) on the problem with the current
  instruction set, executes its code against the hidden tests, and grades it.
  The lesson at each round is written by the LLM from the clustered failing
  transcripts. **This costs LLM tokens, not just sandbox compute** — see below.

## The honesty guardrails (inherited from the core project)

1. **Sealed held-out set** — the problems used to measure improvement are never
   seen during learning. The climb is generalization, not memorization.
2. **The LLM writes the lesson; it never writes the success criterion.** The
   criterion is the held-out tests — fixed, and out of the model's reach.
3. **Only held-out gains count.** Training-set improvement is ignored.
4. **A/A noise floor** — the same gate as the benchmark: an improvement smaller
   than run-to-run noise is not credited.
5. **Pre-registered kill criterion** — if the curve doesn't climb past the noise
   band, that's the honest KC-6 result, reported as-is. A flat curve is a finding.

## The bigger experiment (design)

| dimension | demonstration (now) | the real experiment |
|---|---|---|
| agent | simulated model | live `codex`/`claude` in Daytona |
| tasks | 40 abstract problems | 100–500 real code-gen-to-spec tasks with hidden tests |
| grading | failure-mode model | actual test-suite pass/fail in the sandbox |
| lessons | from a lesson bank | written by the LLM from clustered transcripts |
| scale | instant, free | thousands of graded agent-runs, parallel in Daytona |
| output | the learning curve | the same curve — but earned |

**Cost note (honest):** Daytona sandbox compute for even a large run is a few
dollars. The real spend is the **LLM API tokens** for the agent attempts and the
lesson-writer — that scales with tasks × rounds × repeats and can reach real
money. The design is built to start small (a dozen tasks, 3 rounds, a cheap
model) to earn a first real curve, then scale once it's proven.

## Run it

```bash
node experiment.mjs --rounds 6 --repeats 8      # simulated, free, reproducible
open ~/.flywheel/daytona/learn/learning-curve.html
```
