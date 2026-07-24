#!/bin/bash
# flywheel RL loop — unattended runner for the Mac mini (#7).
#
# Runs one RL-on-trajectories session and refreshes the learning-curve artifact.
# Scheduled by com.abhi.flywheel-rl.plist. The Daytona sandboxes run in the cloud,
# so this only needs the mini awake as the coordinator — the whole point of the
# "cockpit authors, mini executes" split. The agent/writer backend is chosen by
# env so a token-spending run is an explicit opt-in, never the default.
set -euo pipefail

# launchd gives a minimal PATH — pin node + load the Daytona key.
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
REPO="${FLYWHEEL_REPO:-$HOME/Workspace/flywheel}"
LEARN="$REPO/integrations/daytona/learn"
LOG_DIR="$HOME/.flywheel/daytona/learn"
mkdir -p "$LOG_DIR"

# Daytona credentials (kept out of the repo).
[ -f "$HOME/.flywheel/daytona.env" ] && { set -a; . "$HOME/.flywheel/daytona.env"; set +a; }

# Backends default to the FREE path (fake agent, real Daytona grading). To run the
# real token-spending experiment, set these in the plist or the environment:
#   FLYWHEEL_RL_AGENT=codex  FLYWHEEL_RL_WRITER=codex
AGENT="${FLYWHEEL_RL_AGENT:-fake}"
WRITER="${FLYWHEEL_RL_WRITER:-fake}"
ROUNDS="${FLYWHEEL_RL_ROUNDS:-6}"
K="${FLYWHEEL_RL_K:-8}"

# The conventions task set is where a strong model actually has headroom to learn
# (it aces the easy codegen tasks at baseline → nothing to learn). Default to it.
TASKSET="${FLYWHEEL_RL_TASKSET:-conventions}"
CONCURRENCY="${FLYWHEEL_RL_CONCURRENCY:-6}"

cd "$REPO" && git pull -q --ff-only 2>/dev/null || true

echo "$(date -u +%FT%TZ) starting RL loop (taskset=$TASKSET agent=$AGENT writer=$WRITER rounds=$ROUNDS K=$K)" >> "$LOG_DIR/rl.log"
node "$LEARN/rl-loop.mjs" --taskset "$TASKSET" --rounds "$ROUNDS" --K "$K" --concurrency "$CONCURRENCY" \
  --agent "$AGENT" --writer "$WRITER" --out "$LOG_DIR" \
  >> "$LOG_DIR/rl.log" 2>> "$LOG_DIR/rl.err" || echo "$(date -u +%FT%TZ) run failed" >> "$LOG_DIR/rl.err"
echo "$(date -u +%FT%TZ) done → $LOG_DIR/rl-loop.html" >> "$LOG_DIR/rl.log"
