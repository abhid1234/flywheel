# Continuous deployment (the compounding measurement asset)

`flywheel-tick.sh` harvests the host's own agent transcripts, labels, clusters, and regenerates the
failure atlas, appending one row to `~/.flywheel/history.jsonl` — a time series that can't be built
retroactively. Runs every 2h via launchd.

## Install (macOS)
```bash
cp flywheel-tick.sh ~/Workspace/flywheel/         # next to the repo
# edit paths in the plist for your user + node location, then:
cp com.abhi.flywheel-tick.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.abhi.flywheel-tick.plist
```

## Gotcha (learned the hard way)
launchd runs with a minimal PATH — `node` is NOT on it. The tick resolves node absolutely
(`/opt/homebrew/opt/node@22/bin/node`) AND the plist sets `EnvironmentVariables > PATH`. Without
both, the tick fires but silently fails with `node: command not found`. Verify with:
`tail ~/.flywheel/tick.launchd.err` (should be empty) and `tail ~/.flywheel/history.jsonl` (should grow).
