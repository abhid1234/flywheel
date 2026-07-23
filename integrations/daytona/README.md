# flywheel × Daytona — the statistical arm's execution substrate

This is the answer to flywheel's one honest wall.

The core finding ([KC-6](../../FINDINGS.md)) is that proving a fix moves the **outcome**
— not just the mechanism — needs gold-labeled trials at volume (**n ≥ 60**), and the
agent factory can't supply them because it never recorded the episode→outcome link *at
decision time*. You can't bolt that on afterward.

This harness records it **by construction**. It runs a controlled task in a fresh,
isolated [Daytona](https://www.daytona.io) sandbox, executes both arms (control vs. the
fix), and reads the outcome from a deterministic oracle. Every trial is born gold, and
the whole thing reuses flywheel's **real** scorer — the same paired-bootstrap verdict the
rest of the tool uses. No parallel statistics.

```
controlled task → N isolated sandboxes → gold oracle → flywheel's scoreTrialResults → verdict
                     (Daytona, parallel)                  (+ A/A noise floor)
```

## Why it's a genuine fit, not a bolt-on

`src/measure/runner.js` already had an **injectable agent seam** (`fake`/`codex`/`claude`).
Daytona slots in as a new backend behind the same interface. The pure, zero-dependency
core is untouched — all the I/O (network, sandboxes, the official SDK) is quarantined in
this folder, which is the only place that depends on `@daytonaio/sdk`.

## Anti-self-fooling: the A/A noise floor

Before the harness will call anything **helped**, it measures run-to-run noise by racing
the control arm against *itself*. The 95th-percentile of the paired A/A deltas is the band
a real effect must clear. Without that measurement the scorer stays **inconclusive** — it
will not certify an improvement it can't distinguish from noise. That gate is the whole
point: it's what separates this from every "my agent self-improves" demo.

## Run it

```bash
cd integrations/daytona
npm install                              # installs @daytonaio/sdk here only

# load your key (kept out of the repo)
set -a; . ~/.flywheel/daytona.env; set +a   # DAYTONA_API_KEY=dtn_…

node smoke.mjs                           # one sandbox: verify key + round-trip
node run.mjs --task env-yaml --n 60      # the statistical arm, for real

# no key? the whole loop still runs offline on a deterministic mock:
FLYWHEEL_DAYTONA_BACKEND=mock node run.mjs --task env-yaml --n 60
```

Output: a `helped` / `no_effect` / `inconclusive` verdict with a measured noise floor,
plus `daytona-episodes.jsonl` — gold episodes recorded at decision time, the artifact the
factory could never produce.

## Tasks

- **`env-yaml`** — the deterministic plumbing-proof: a missing-package failure isolated in
  a fresh virtualenv (control fails, fix passes, every time). Zero variance — it verifies
  the loop is wired correctly before spending LLM tokens on the noisy behavioural arm.
- **behavioural tasks** (next) — give a real agent (`codex`/`claude`) a prompt that tends
  to trigger a behavioural failure, run it inside the sandbox with and without a candidate
  `CLAUDE.md` fix, and let the A/A-gated verdict say whether the fix actually moves the
  outcome. This is the arm the whole project was blocked on.

## Where it runs

Developed on the MacBook; **meant to run on the always-on Mac mini** as a scheduled job so
the loop completes with the laptop closed. The Daytona sandboxes execute in the cloud
regardless; the mini is just the coordinator that kicks them off, harvests results, and
tears them down.
