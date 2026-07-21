#!/bin/sh
set -eu

# Run from any directory; all inputs are bundled and output is temporary.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FLYWHEEL_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/flywheel-quickstart.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

CLI="$FLYWHEEL_ROOT/bin/flywheel.js"
EPISODES="$WORK_DIR/flywheel/episodes"

# 1. Harvest three tiny, synthetic agent transcripts.
node "$CLI" harvest "$SCRIPT_DIR/sample-projects" --out "$WORK_DIR/flywheel"

# 2. Infer outcome labels, then inspect recurring failure clusters.
node "$CLI" label --in "$EPISODES" --out "$EPISODES"
node "$CLI" clusters --in "$EPISODES" --top 5

# 3. Build the HTML failure atlas.
node "$CLI" report --in "$EPISODES" --out "$WORK_DIR/atlas.html"

# 4. Preview the guarded improvement loop without changing anything.
node "$CLI" loop --in "$EPISODES" --llm echo --dry-run

echo "Quickstart complete: generated a temporary failure atlas and dry-run plan."
