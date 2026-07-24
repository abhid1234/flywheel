#!/bin/bash
# OVERNIGHT ORCHESTRATOR — runs on the always-on Mac mini, produces launch-ready
# evidence for the RL-on-trajectories result. Three phases:
#
#   1. SCALING SWEEP   — the same learning run at increasing rollout counts K.
#                        More rollouts → lower noise floor → more lessons credited
#                        → higher final. This is the scaling law: compute (Daytona)
#                        buys measurable agent improvement.
#   2. REPLICATION     — the strong config run many times → tight reproducibility.
#   3. CREDIT (codex)  — the live-agent credit-assignment run.
#
# Then it keeps accumulating replications until a wall-clock budget, so it uses the
# whole night. Robust: each run isolated, sandboxes cleaned between runs, rate
# limits absorbed by the harness's retry, one failure never kills the batch.
#
# Launch:  nohup bash overnight.sh > /tmp/overnight.out 2>&1 &
set -u
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin"
[ -f "$HOME/.flywheel/daytona.env" ] && { set -a; . "$HOME/.flywheel/daytona.env"; set +a; }

REPO="$HOME/Workspace/flywheel"
LEARN="$REPO/integrations/daytona/learn"
OUT="$HOME/.flywheel/daytona/overnight"
RES="$OUT/results"
LOG="$OUT/overnight.log"
mkdir -p "$RES"
BUDGET_SECONDS="${OVERNIGHT_BUDGET:-25200}"   # 7 hours default

log(){ echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }

cleanup_sandboxes(){
  [ -z "${DAYTONA_API_KEY:-}" ] && return
  for id in $(curl -sS "https://app.daytona.io/api/sandbox" -H "Authorization: Bearer $DAYTONA_API_KEY" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);(Array.isArray(a)?a:(a.items||[])).filter(x=>x.state!=="destroyed").forEach(x=>console.log(x.id))}catch(e){}})' 2>/dev/null); do
    curl -sS -X DELETE "https://app.daytona.io/api/sandbox/$id" -H "Authorization: Bearer $DAYTONA_API_KEY" -o /dev/null 2>/dev/null
  done
}

run_curve(){  # label K rounds
  local label="$1" K="$2" rounds="$3"
  [ -f "$RES/$label.json" ] && { log "SKIP $label (already done)"; return; }
  log "START $label (K=$K rounds=$rounds)"
  node "$LEARN/rl-loop.mjs" --taskset conventions --rounds "$rounds" --K "$K" --concurrency 6 \
    --agent codex --writer codex --out "$OUT/$label" >> "$LOG" 2>&1 \
    && cp "$OUT/$label/rl-loop.json" "$RES/$label.json" 2>/dev/null \
    && log "DONE  $label → $(node -e 'const r=require("'"$RES/$label.json"'");console.log(Math.round(r.baseline*100)+"%→"+Math.round(r.final*100)+"% ("+r.lessons_kept+" lessons)")' 2>/dev/null)" \
    || log "FAIL  $label (see log)"
  cleanup_sandboxes
  sleep 30
}

cd "$REPO" && git pull -q --ff-only 2>/dev/null || true
log "=== OVERNIGHT BATCH START · budget ${BUDGET_SECONDS}s ==="
cleanup_sandboxes

# Phase 1 — scaling sweep (K = 4, 8, 12, 16): the scaling law
run_curve sweep-k04 4 5
run_curve sweep-k08 8 5
run_curve sweep-k12 12 5
run_curve sweep-k16 16 5

# Phase 2 — replication at a strong config (K=10)
for i in 1 2 3 4; do run_curve "rep-k10-$i" 10 5; done

# Phase 3 — credit assignment with a live codex continuation
if [ ! -f "$RES/credit-codex.json" ]; then
  log "START credit-codex"
  node "$LEARN/credit-codex.mjs" --forks 5 --concurrency 4 --out "$OUT/credit" >> "$LOG" 2>&1 \
    && cp "$OUT/credit/credit-codex.json" "$RES/credit-codex.json" 2>/dev/null && log "DONE credit-codex" || log "FAIL credit-codex"
  cleanup_sandboxes; sleep 30
fi

# Phase 4 — keep accumulating K=10 replications until the wall-clock budget
i=5
while [ "$SECONDS" -lt "$BUDGET_SECONDS" ]; do
  run_curve "rep-k10-$i" 10 5
  i=$((i+1))
done

cleanup_sandboxes
log "=== OVERNIGHT BATCH COMPLETE · $((SECONDS/60)) min · $(ls "$RES"/*.json 2>/dev/null | wc -l | tr -d ' ') result files ==="
