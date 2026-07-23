# RL on agent trajectories — the finished loop

The flywheel thesis, run as reinforcement learning at the **context layer**: an
agent attempts coding tasks (rollouts), earns a **verifiable reward** from hidden
tests run in Daytona sandboxes, and its policy improves from its own graded
trajectories. The policy update is a **durable lesson carried in context**, not a
weight change — no GPUs, no gradients.

```
baseline held-out → [ roll out train tasks → reward → cluster failures →
                      distill a lesson → A/A-gate on sealed held-out → keep/reject ] → repeat
```

## The seven pieces (all built)

| # | Piece | File | Backend / cost |
|---|---|---|---|
| 1 | **Rollout engine** — K parallel attempts/task in Daytona | `rollout.mjs` | Daytona compute |
| 2 | **Agent** — writes code from spec + current lessons | `agent.mjs` | `fake` (free) · `codex`/`claude` (tokens) |
| 3 | **Lesson-writer** — distills one lesson per failure cluster | `lesson-writer.mjs` | `fake` (free) · `codex`/`claude` (tokens) |
| 4 | **The loop** — accumulate lessons, A/A-gate each | `rl-loop.mjs` | — |
| 5 | **Task set** — code-gen tasks w/ hidden tests, cold/fixed refs | `codegen-tasks.mjs` | free |
| 6 | **Credit assignment** — snapshot/fork to localize the critical step | `credit-assignment.mjs` | prototyped |
| 7 | **Unattended runner** — nightly rounds on the mini | `deploy/` | free (fake) |

## Run it — free, on real Daytona

The whole pipeline runs end-to-end with **zero token spend**: a `fake` agent
emits each task's cold/fixed reference, but the grading is **real** — real
sandboxes, real `python3` executing the hidden tests. It proves every seam works
before a single LLM call.

```bash
set -a; . ~/.flywheel/daytona.env; set +a
node rl-loop.mjs --rounds 6 --K 8 --agent fake --writer fake
open ~/.flywheel/daytona/learn/rl-loop.html
```

## Run it for real — the token spend

Swap the agent + lesson-writer to a live model. Now the agent actually writes the
code and the LLM actually distills each lesson from the failing transcripts:

```bash
node rl-loop.mjs --rounds 6 --K 8 --agent codex --writer codex
```

This is the only place the system spends. Cost scales with tasks × rounds × K.
Start small (fewer rounds, K=5, a cheap model) to earn a first real curve, then
scale. The banner prints a ⚠ before any token-spending run.

## The honesty guardrails

- **Sealed held-out** — the measured tasks are never learned from; the climb is
  generalization, not memorization.
- **The LLM writes the lesson; it never writes the success criterion** — the
  hidden tests are fixed and out of reach.
- **A/A noise floor** — a lesson whose held-out gain doesn't clear the measured
  band is **not kept**. That is why the curve plateaus below 100%.
- **The plateau is the message.** To push it higher, lower the noise floor: more
  held-out tasks and more rollouts — i.e. more Daytona. The bigger the compute,
  the further the curve can honestly climb.

## Deploy nightly on the mini (#7)

```bash
cp deploy/com.abhi.flywheel-rl.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.abhi.flywheel-rl.plist   # defaults to the free path
```
Daytona runs the sandboxes in the cloud; the mini only coordinates, so the loop
completes with the laptop closed.
