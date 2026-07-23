# RL on agent trajectories — what actually happened

*A live experiment, run on real infrastructure, reported including the parts that
don't fully hold. The honest version.*

The question: can an AI coding agent get measurably better at its job by learning
from its own graded mistakes — with no weight updates, only durable lessons
carried in context? This is reinforcement learning at the context layer:

```
rollout → verifiable reward (hidden tests, run in Daytona) → cluster failures →
distill a durable lesson → A/A-gate on a sealed held-out set → keep/reject → repeat
```

Below is the arc, in the order it actually unfolded — including two dead ends that
turned out to be the most informative results.

## Finding 0: a strong model has no headroom on easy tasks

The first live run used simple code-gen tasks (sum a list, handle an empty input).
Codex scored **100% at baseline**. The loop harvested no failures and **converged
with zero lessons.** That's not a disappointment — it's the system's integrity.
It refused to manufacture learning where the model already succeeds. Any framework
that shows a climbing curve on tasks the model already passes is measuring its own
imagination.

## Finding 1: real learning needs the model's failure frontier

To get headroom we built **conventions tasks**: the spec is deliberately
underspecified on one point, and a hidden test enforces a convention the model
can't infer (empty input → `None` not an exception; unique values → *sorted*, not
input order; ranges inclusive of both ends; ISO dates; 2-decimal rounding). Cold,
a competent model guesses — and often guesses wrong. This is exactly how an agent
meets a codebase's implicit rules: by getting them wrong first.

On these, codex's baseline dropped to **27%** — and stayed 27% across every run we
did. Reliable failure is as important as reliable success: it's a stable floor to
measure improvement from.

## Finding 2: the loop will not credit a real gain it can't resolve

The first powered attempt (K=4 rollouts/task) produced a **real +17.9pp** from the
first lesson — which landed *just under* the 18.5pp noise band and was **rejected.**
The effect was real; the measurement was underpowered. This is the single most
important result in the project: **the gate fired against a true positive.** A loop
that credited it would be optimizing against noise. The honest system takes the
loss.

The fix is not cleverer code — it's more measurement. More rollouts and more
held-out tasks lower the noise floor. We raised K to 6 (band → 12.1pp) and the real
gains started clearing.

## Finding 3: the curve climbs — and it reproduces

With adequate power, a live codex agent improved on the **sealed** held-out set
across four rounds, learning lessons **it wrote itself** from the clustered failing
transcripts (e.g. *"infer output ordering from the tests as part of the contract,
instead of assuming 'unique' means preserving input order"*).

Run three times, same config (codex is non-deterministic, so each is an independent
draw):

| run | baseline | final | gain |
|---|---|---|---|
| 1 | 27% | 76% | +48pp |
| 2 | 27% | 62% | +35pp |
| 3 | 27% | 55% | +27pp |

**Every run climbed.** Baseline was identical (27%) all three times. The mechanism
— an agent improving from its own graded failures — reproduces.

## Finding 4: what reproduces is the climb, not the individual lesson

Here is the honest limit. **No single lesson was kept in all three runs.** The
per-lesson gains (~15–17pp on average) sit right around the 12.1pp noise band, so
codex's run-to-run variance flips them above or below the threshold:

| lesson | kept | reliability |
|---|---|---|
| empty-none | 2/3 | flaky |
| sorted-unique | 2/3 | flaky |
| parse-none | 1/3 | flaky |
| round-2dp | 0/3 | never cleared |

So the defensible claim is precise: **"an agent learning from its own failures
reproducibly improves"** is supported (n=3, every run). **"Lesson X reliably helps"**
is *not yet* supported at this sample size — the measurement can't resolve
individual lessons whose effect is close to the noise floor. To earn that claim you
drop the band well below the true gains: more rollouts, more held-out tasks. The
same lever, again.

## The bottom line

We set out to see whether an agent can do RL on its own trajectories at the context
layer, and measure it honestly. What we have: a stable, reproducible baseline; a
gate that refuses true positives it can't resolve; a climb that reproduces across
independent runs; and a clear, quantified boundary on what the current measurement
can and can't attribute. The negative space — no headroom on easy tasks, a real
gain rejected, individual lessons that don't reproduce — is the most trustworthy
part.

That's the difference between a demo and a result.

---

*Live runs: codex (`gpt-5.6-sol`) writing solutions, graded against hidden tests in
isolated Daytona sandboxes. Reproduce: `node rl-loop.mjs --taskset conventions
--agent codex --writer codex`. Full run data in `results/`.*
