#!/bin/bash
# flywheel continuous tick: harvest the mini own agent transcripts, label, cluster,
# regenerate the failure atlas, and append one history row. Read-only over ~/.claude.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/Users/macmini/.hermes/node/bin:/Users/macmini/.bun/bin:/Users/macmini/.local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/bin:/bin:/usr/sbin:/sbin"
FLYWHEEL_NODE="/opt/homebrew/opt/node@22/bin/node"
[ -x "$FLYWHEEL_NODE" ] || FLYWHEEL_NODE=node
FW="$HOME/Workspace/flywheel"
OUT="$HOME/.flywheel"
LOG="$OUT/tick.log"
HIST="$OUT/history.jsonl"
mkdir -p "$OUT"
cd "$FW" || exit 1
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "=== tick $TS ==="
  "$FLYWHEEL_NODE" bin/flywheel.js harvest "$HOME/.claude/projects" --out "$OUT" --quiet 2>&1 | tail -1
  "$FLYWHEEL_NODE" bin/flywheel.js label    --in "$OUT/episodes" --out "$OUT/episodes" 2>&1 | tail -1
  "$FLYWHEEL_NODE" bin/flywheel.js clusters --in "$OUT/episodes" --min-size 3 2>&1 | tail -1
  "$FLYWHEEL_NODE" bin/flywheel.js report   --in "$OUT/episodes" --out "$OUT/atlas.html" 2>&1 | tail -1
} >> "$LOG" 2>&1
# append a compact history row (episodes, failures, proposable) for the compounding time-series
EP=$(ls "$OUT"/episodes/*.jsonl 2>/dev/null | xargs cat 2>/dev/null | wc -l | tr -d " ")
FAIL=$(ls "$OUT"/episodes/*.jsonl 2>/dev/null | xargs cat 2>/dev/null | grep -c "\"label\":\"fail\"" )
printf "{\"ts\":\"%s\",\"episodes\":%s,\"fail_labels\":%s}\n" "$TS" "${EP:-0}" "${FAIL:-0}" >> "$HIST"
echo "tick $TS: episodes=$EP fail=$FAIL" >> "$LOG"
