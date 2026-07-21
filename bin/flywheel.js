#!/usr/bin/env node
import { appendFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { segmentRecords } from "../src/harvest/segment.js";
import { extractSteps } from "../src/harvest/steps.js";
import { buildEpisode } from "../src/harvest/episode.js";
import { labelSession } from "../src/label/transcript.js";
import { clusterEpisodes } from "../src/cluster/group.js";
import { isProposable, rankClusters } from "../src/cluster/rank.js";
import { buildBrief } from "../src/propose/brief.js";
import { renderPrompt } from "../src/propose/prompt.js";
import { parseProposal } from "../src/propose/parse.js";
import { buildEvalContract } from "../src/propose/contract.js";
import { toSelfPatch } from "../src/propose/assemble.js";
import { routeCluster } from "../src/propose/targets.js";
import { buildAtlas, renderAtlasHtml } from "../src/report/atlas.js";
import { planLoop } from "../src/loop/orchestrate.js";
import { buildAttestation } from "../src/loop/attest.js";
import { flywheelPolicy } from "../src/loop/policy.js";
import { canonicalize, sha256hex } from "../src/hash.js";
import { goldFromMergeStatus } from "../src/label/merge_status.js";
import { summarizeStability } from "../src/measure/calibrate.js";

function fail(message, code = 1) { process.stderr.write(`flywheel: ${message}\n`); process.exitCode = code; }
const USAGE = `Usage:
  flywheel harvest <projectsDir> --out <outDir> [--exclude-sidechains|--include-sidechains] [--limit N] [--max-group-records N] [--quiet]
  flywheel label --in <episodesDir> --out <episodesDir>
  flywheel gold --in <episodesDir> --repos <owner/repo,owner/repo> [--out <dir>]
  flywheel calibrate --witnesses <clusterFileOrDir> [--repeats 20] [--timeout-ms 5000] [--max-witnesses 20] [--max-total-ms 60000] [--include-timeouts]
  flywheel clusters --in <episodesDir> [--min-size 3] [--top N] [--json]
  flywheel propose --cluster <signatureOrId> --in <episodesDir> --llm <codex|echo> [--out <file>] [--force-demo]
  flywheel measure --patch <patchFile> [--apply] [--runner node] [--keep]
  flywheel report --in <episodesDir> [--out atlas.html] [--open]
  flywheel loop --in <episodesDir> [--llm codex|echo] [--apply] [--max N] [--dry-run]
  flywheel status --in <episodesDir>
`;

function parseHarvest(argv) {
  if (!argv[1]) return null;
  const result = { command: argv[0], projectsDir: argv[1], exclude: true, limit: Infinity, maxGroupRecords: 5000, quiet: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--out") result.outDir = argv[++i];
    else if (argv[i] === "--exclude-sidechains") result.exclude = true;
    else if (argv[i] === "--include-sidechains") result.exclude = false;
    else if (argv[i] === "--quiet") result.quiet = true;
    else if (argv[i] === "--limit") result.limit = Number(argv[++i]);
    else if (argv[i] === "--max-group-records") result.maxGroupRecords = Number(argv[++i]);
    else return null;
  }
  return result.outDir && (result.limit === Infinity || (Number.isFinite(result.limit) && result.limit >= 0))
    && Number.isInteger(result.maxGroupRecords) && result.maxGroupRecords >= 1 ? result : null;
}

function parseFlags(argv, valueFlags, booleanFlags) {
  const result = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];
    if (valueFlags.has(key)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) return null;
      result[valueFlags.get(key)] = argv[++i];
    } else if (booleanFlags.has(key)) result[booleanFlags.get(key)] = true;
    else return null;
  }
  return result;
}

function parseArgs(argv) {
  if (argv[0] === "harvest") return parseHarvest(argv);
  if (argv[0] === "label") return parseFlags(argv, new Map([["--in", "inDir"], ["--out", "outDir"]]), new Map());
  if (argv[0] === "gold") return parseFlags(argv, new Map([["--in", "inDir"], ["--repos", "repos"], ["--out", "outDir"]]), new Map());
  if (argv[0] === "calibrate") return parseFlags(argv, new Map([["--witnesses", "witnesses"], ["--repeats", "repeats"], ["--timeout-ms", "timeoutMs"], ["--max-witnesses", "maxWitnesses"], ["--max-total-ms", "maxTotalMs"]]), new Map([["--include-timeouts", "includeTimeouts"]]));
  if (argv[0] === "clusters") return parseFlags(argv, new Map([["--in", "inDir"], ["--min-size", "minSize"], ["--top", "top"]]), new Map([["--json", "json"]]));
  if (argv[0] === "propose") return parseFlags(argv, new Map([["--cluster", "cluster"], ["--in", "inDir"], ["--llm", "llm"], ["--out", "outFile"], ["--timeout", "timeout"]]), new Map([["--force-demo", "forceDemo"]]));
  if (argv[0] === "measure") return parseFlags(argv, new Map([["--patch", "patchFile"], ["--runner", "runner"]]), new Map([["--apply", "apply"], ["--keep", "keep"]]));
  if (argv[0] === "report") return parseFlags(argv, new Map([["--in", "inDir"], ["--out", "outFile"]]), new Map([["--open", "open"]]));
  if (argv[0] === "loop") return parseFlags(argv, new Map([["--in", "inDir"], ["--llm", "llm"], ["--max", "max"]]), new Map([["--apply", "apply"], ["--dry-run", "dryRun"]]));
  if (argv[0] === "status") return parseFlags(argv, new Map([["--in", "inDir"]]), new Map());
  return null;
}

function filesUnder(root) {
  const files = [];
  const visited = new Set();
  function walk(directory) {
    const realDirectory = realpathSync(directory);
    if (visited.has(realDirectory)) return;
    visited.add(realDirectory);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const logicalPath = path.join(directory, entry.name);
      const target = entry.isSymbolicLink() ? statSync(logicalPath) : entry;
      if (target.isDirectory()) { walk(logicalPath); continue; }
      if (!target.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const realFile = realpathSync(logicalPath);
      if (visited.has(realFile)) continue;
      visited.add(realFile);
      const parts = path.relative(root, logicalPath).split(path.sep);
      const sourceKind = parts.includes("subagents") ? "subagent" : (parts.length === 2 ? "session" : "other");
      const relativePath = parts.join("/");
      let agentId;
      if (sourceKind === "session") agentId = "main";
      else if (sourceKind === "subagent") {
        const match = /^agent-(.+)\.jsonl$/.exec(path.basename(logicalPath));
        const workflow = parts.find((part) => part.startsWith("wf_"));
        agentId = match ? `${workflow ? `${workflow}/` : ""}${match[1]}` : relativePath;
      } else agentId = relativePath;
      files.push({ file: realFile, project: parts.length > 1 ? parts[0] : path.basename(root), sourceKind, agentId });
    }
  }
  walk(root);
  return files;
}

async function readJsonl(file, manifest) {
  const records = [];
  const input = createReadStream(file, { encoding: "utf8", highWaterMark: 64 * 1024 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let first = true;
  for await (const rawLine of lines) {
    manifest.lines_read += 1;
    const line = first && rawLine.charCodeAt(0) === 0xfeff ? rawLine.slice(1) : rawLine;
    first = false;
    try {
      const record = JSON.parse(line);
      if (record !== null && typeof record === "object" && !Array.isArray(record)) records.push(record);
      else manifest.lines_unparseable += 1;
    } catch { manifest.lines_unparseable += 1; }
  }
  return records;
}

async function harvest(options) {
  const startTime = process.hrtime.bigint();
  if (!existsSync(options.projectsDir) || !statSync(options.projectsDir).isDirectory()) return fail(`missing projects directory: ${options.projectsDir}`);
  let files;
  try { files = filesUnder(options.projectsDir).slice(0, options.limit); } catch (error) { return fail(`cannot read projects directory: ${error.message}`); }
  if (!files.length) return fail("zero .jsonl files found");
  try { mkdirSync(path.join(options.outDir, "episodes"), { recursive: true }); } catch (error) { return fail(`output directory is not writable: ${error.message}`); }
  const started = new Date().toISOString();
  const manifest = { started, ended: "", wall_clock_ms: 0, files_scanned: 0, files_by_kind: { session: 0, subagent: 0, other: 0 }, bytes_read: 0, lines_read: 0, lines_unparseable: 0, shells: 0, shells_seen: 0, episodes_written: 0, episodes_by_kind: { session: 0, subagent: 0, other: 0 }, episodes_by_source_kind: { session: 0, subagent: 0, other: 0 }, duplicates_dropped: 0, sidechains_dropped: 0, by_project: {} };
  const deduped = new Map();
  for (const item of files) {
    let records;
    try { records = await readJsonl(item.file, manifest); } catch (error) { return fail(`cannot read ${item.file}: ${error.message}`); }
    manifest.files_scanned += 1;
    manifest.files_by_kind[item.sourceKind] += 1;
    manifest.bytes_read += statSync(item.file).size;
    for (const shell of segmentRecords(records, { maxGroupRecords: options.maxGroupRecords })) {
      manifest.shells += 1;
      manifest.shells_seen += 1;
      const key = `${shell.sessionId ?? ""}\u0000${shell.promptId ?? ""}\u0000${item.agentId}`;
      const candidate = { shell, project: item.project, sourceKind: item.sourceKind, agentId: item.agentId };
      const prior = deduped.get(key);
      const candidateIsPreferred = prior && (
        (item.sourceKind === "session" && prior.sourceKind !== "session") ||
        (item.sourceKind === prior.sourceKind && shell.records.length > prior.shell.records.length) ||
        (item.sourceKind !== "session" && prior.sourceKind !== "session" && shell.records.length > prior.shell.records.length)
      );
      if (!prior || candidateIsPreferred) {
        if (prior) manifest.duplicates_dropped += 1;
        deduped.set(key, candidate);
      } else manifest.duplicates_dropped += 1;
    }
  }
  const byProject = new Map();
  for (const { shell, project, sourceKind, agentId } of deduped.values()) {
    const episode = buildEpisode(shell, extractSteps(shell), { project, agentId });
    episode.source_kind = sourceKind;
    episode.agent_id = agentId;
    if (sourceKind === "subagent") episode.is_sidechain = true;
    manifest.episodes_by_kind[sourceKind] += 1;
    if (options.exclude && episode.is_sidechain) { manifest.sidechains_dropped += 1; continue; }
    manifest.episodes_by_source_kind[sourceKind] += 1;
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(episode);
  }
  try {
    for (const [project, episodes] of [...byProject].sort(([a], [b]) => a.localeCompare(b))) {
      episodes.sort((a, b) => a.id.localeCompare(b.id));
      const safeProject = project.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
      const output = path.join(options.outDir, "episodes", `${safeProject}.jsonl`);
      const stream = createWriteStream(output, { encoding: "utf8" });
      for (const episode of episodes) stream.write(`${JSON.stringify(episode)}\n`);
      await new Promise((resolve, reject) => { stream.on("error", reject); stream.end(resolve); });
      manifest.by_project[project] = episodes.length;
      manifest.episodes_written += episodes.length;
    }
    manifest.ended = new Date().toISOString();
    manifest.wall_clock_ms = Number((process.hrtime.bigint() - startTime) / 1_000_000n);
    writeFileSync(path.join(options.outDir, "harvest-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) { return fail(`output directory is not writable: ${error.message}`); }
  const accounted = manifest.episodes_written + manifest.duplicates_dropped + manifest.sidechains_dropped;
  if (accounted !== manifest.shells_seen) process.stderr.write(`WARNING: harvest accounting mismatch: episodes_written + duplicates_dropped + sidechains_dropped = ${accounted}, but shells_seen = ${manifest.shells_seen} (discrepancy ${manifest.shells_seen - accounted}).\n`);
  if (!options.quiet) process.stdout.write(`Harvested ${manifest.episodes_written} episodes from ${manifest.files_scanned} files (${manifest.duplicates_dropped} duplicates, ${manifest.sidechains_dropped} sidechains dropped, ${manifest.lines_unparseable} unparseable lines).\n`);
}

function episodeFiles(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`missing episodes directory: ${root}`);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json")))
    .map((entry) => path.join(root, entry.name)).sort();
}

function loadEpisodes(root) {
  const records = [];
  for (const file of episodeFiles(root)) {
    const text = readFileSync(file, "utf8");
    if (file.endsWith(".json")) {
      const value = JSON.parse(text);
      const values = Array.isArray(value) ? value : [value];
      values.forEach((episode, index) => records.push({ episode, file, format: "json", index, wasArray: Array.isArray(value) }));
    } else {
      text.split(/\r?\n/).filter((line) => line.trim()).forEach((line, index) => records.push({ episode: JSON.parse(line), file, format: "jsonl", index }));
    }
  }
  return records;
}

function writeEpisodeRecords(records, outDir) {
  mkdirSync(outDir, { recursive: true });
  const groups = new Map();
  for (const record of records) {
    const output = path.join(outDir, path.basename(record.file));
    if (!groups.has(output)) groups.set(output, []);
    groups.get(output).push(record);
  }
  for (const [file, items] of groups) {
    const episodes = items.sort((a, b) => a.index - b.index).map((item) => item.episode);
    const content = items[0].format === "json"
      ? `${JSON.stringify(items[0].wasArray ? episodes : episodes[0], null, 2)}\n`
      : `${episodes.map(JSON.stringify).join("\n")}\n`;
    writeFileSync(file, content);
  }
}

function readJson(file, description) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`cannot read ${description} ${file}: ${error.message}`); }
}

async function label(options) {
  if (!options.inDir || !options.outDir) throw new Error("label requires --in <episodesDir> and --out <episodesDir>");
  const records = loadEpisodes(options.inDir);
  const sessions = new Map();
  for (const record of records) {
    const key = String(record.episode?.session_id ?? "unknown");
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(record);
  }
  for (const session of sessions.values()) {
    session.sort((a, b) => String(a.episode?.started ?? "").localeCompare(String(b.episode?.started ?? "")));
    const outcomes = labelSession(session.map((item) => item.episode));
    session.forEach((item, index) => { item.episode.outcome = outcomes[index]; });
  }
  writeEpisodeRecords(records, options.outDir);
  const tiers = { gold: 0, strong: 0, weak: 0, unknown: 0 };
  const labels = {};
  for (const { episode } of records) {
    const tier = Object.hasOwn(tiers, episode?.outcome?.tier) ? episode.outcome.tier : "unknown";
    const value = String(episode?.outcome?.label ?? "unknown");
    tiers[tier] += 1;
    labels[value] = (labels[value] ?? 0) + 1;
  }
  process.stdout.write(`tiers ${JSON.stringify(tiers)}\nlabels ${JSON.stringify(labels)}\n`);
}

async function gold(options) {
  if (!options.inDir || !options.repos) throw new Error("gold requires --in <episodesDir> and --repos <owner/repo,owner/repo>");
  const repos = options.repos.split(",").map((repo) => repo.trim()).filter(Boolean);
  if (!repos.length) throw new Error("--repos must contain at least one owner/repo");
  const outcomes = [];
  for (const repo of repos) {
    let result;
    try { result = await runChild("gh", ["pr", "list", "--repo", repo, "--state", "all", "--json", "number,headRefName,state,mergedAt,createdAt"], 180000); }
    catch (error) { fail(`cannot fetch merge status: gh is missing or unavailable (${error.message}). Install and authenticate GitHub CLI, then retry.`, 2); return; }
    if (result.code !== 0) { fail(`cannot fetch merge status for ${repo}: gh is not authenticated or failed: ${result.stderr.trim() || `exit ${result.code}`}`, 2); return; }
    let prs;
    try { prs = JSON.parse(result.stdout); } catch { fail(`cannot fetch merge status for ${repo}: gh returned invalid JSON`, 2); return; }
    for (const pr of Array.isArray(prs) ? prs : []) outcomes.push({ ...pr, repo, merged: Boolean(pr?.mergedAt) || pr?.state === "MERGED", closedUnmerged: pr?.state === "CLOSED" && !pr?.mergedAt });
  }
  const records = loadEpisodes(options.inDir);
  const result = goldFromMergeStatus(records.map((record) => record.episode), outcomes);
  records.forEach((record, index) => { record.episode = result.episodes[index]; });
  writeEpisodeRecords(records, options.outDir ?? options.inDir);
  process.stdout.write(`linked ${result.linked}\ngold pass ${result.goldPass}, fail ${result.goldFail}\ngold labels: ${result.linked} / 60 needed for the statistical floor\nunlinked ${result.unlinked}\n`);
}

function loadWitnesses(target) {
  const resolved = path.resolve(target);
  const files = statSync(resolved).isDirectory()
    ? readdirSync(resolved).filter((name) => name.endsWith(".json")).map((name) => path.join(resolved, name)).sort()
    : [resolved];
  const values = files.flatMap((file) => { const value = readJson(file, "witness file"); return Array.isArray(value) ? value : [value]; });
  const witnesses = [];
  for (const value of values) {
    if (value?.replayable === true) witnesses.push(value);
    for (const witness of Array.isArray(value?.witnesses) ? value.witnesses : []) {
      if (witness?.replayable === true) witnesses.push({ ...witness, errorClass: witness.errorClass ?? witness.mode ?? value.errorClass ?? value.mode });
    }
  }
  return witnesses.filter((witness) => typeof witness?.cmd === "string" && witness.cmd.length > 0);
}

function replayWitness(witness, timeoutMs) {
  return new Promise((resolve) => {
    const windows = process.platform === "win32";
    let child;
    try {
      child = spawn(windows ? "cmd" : "/bin/sh", windows ? ["/d", "/s", "/c", witness.cmd] : ["-c", witness.cmd], {
        stdio: "ignore", detached: !windows,
        ...(typeof witness.cwd === "string" && witness.cwd ? { cwd: witness.cwd } : {}),
      });
    } catch { resolve({ code: 1, spawnError: true }); return; }
    let settled = false;
    let timedOut = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (!windows && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
    }, timeoutMs);
    child.once("error", () => finish({ code: 1, spawnError: true }));
    child.once("close", (code) => finish({ code: timedOut ? 124 : (code ?? 1), timedOut }));
  });
}

async function calibrate(options) {
  if (!options.witnesses) throw new Error("calibrate requires --witnesses <clusterFileOrDir>");
  const repeats = options.repeats === undefined ? 20 : Number(options.repeats);
  if (!Number.isInteger(repeats) || repeats < 2) throw new Error("--repeats must be an integer of at least 2");
  const timeoutMs = options.timeoutMs === undefined ? 5000 : Number(options.timeoutMs);
  const maxWitnesses = options.maxWitnesses === undefined ? 20 : Number(options.maxWitnesses);
  const maxTotalMs = options.maxTotalMs === undefined ? 60000 : Number(options.maxTotalMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("--timeout-ms must be a positive integer");
  if (!Number.isInteger(maxWitnesses) || maxWitnesses < 1) throw new Error("--max-witnesses must be a positive integer");
  if (!Number.isInteger(maxTotalMs) || maxTotalMs < 1) throw new Error("--max-total-ms must be a positive integer");
  const witnesses = loadWitnesses(options.witnesses);
  if (!witnesses.length) throw new Error("no replayable witnesses found");
  const timeoutWitnesses = options.includeTimeouts ? [] : witnesses.filter((witness) => witness.mode === "timeout" || witness.errorClass === "timeout");
  const candidates = options.includeTimeouts ? witnesses : witnesses.filter((witness) => witness.mode !== "timeout" && witness.errorClass !== "timeout");
  const perWitness = [];
  const incompleteWitnesses = [];
  const started = Date.now();
  for (const [witnessIndex, witness] of candidates.entries()) {
    if (witnessIndex >= maxWitnesses || Date.now() - started >= maxTotalMs) break;
    const codes = [];
    for (let index = 0; index < repeats; index += 1) {
      const remaining = maxTotalMs - (Date.now() - started);
      if (remaining <= 0) break;
      const result = await replayWitness(witness, Math.min(timeoutMs, remaining));
      codes.push(result.code);
    }
    if (codes.length === repeats) perWitness.push({ witness, codes, stable: codes.every((code) => code === codes[0]) });
    else if (codes.length) incompleteWitnesses.push({ witness, codes });
  }
  const summary = summarizeStability(perWitness);
  const stabilityValues = perWitness.map((entry) => entry.stable ? 1 : 0);
  const stabilityMean = stabilityValues.length ? stabilityValues.reduce((sum, value) => sum + value, 0) / stabilityValues.length : 0;
  const stabilitySd = stabilityValues.length < 2 ? 0 : Math.sqrt(stabilityValues.reduce((sum, value) => sum + ((value - stabilityMean) ** 2), 0) / (stabilityValues.length - 1));
  process.stdout.write(`DETERMINISTIC A/A\n`);
  if (timeoutWitnesses.length) process.stdout.write(`skipped ${timeoutWitnesses.length} timeout witnesses (use --include-timeouts to replay)\n`);
  perWitness.forEach(({ witness, codes, stable }, index) => process.stdout.write(`witness ${index + 1}: exit codes ${codes.join(",")} — ${stable ? "stable" : "unstable"}${codes.every((code) => code === 124) ? " timeout(124)" : ""} — ${witness.cmd}\n`));
  incompleteWitnesses.forEach(({ witness, codes }) => process.stdout.write(`incomplete witness: ${codes.length} / ${repeats} repeats before budget — ${witness.cmd}\n`));
  process.stdout.write(`covered ${summary.witnesses} / ${candidates.length} witnesses (budget)\nmean stability: ${summary.cleanPct.toFixed(2)}%\nsd: ${(stabilitySd * 100).toFixed(2)}pp\ndeterministic arm calibration-clean: ${summary.witnesses > 0 && summary.unstable === 0 ? "yes" : "no"}\nAgent-trial A/A for behavioural fixes needs gold and is a separate, heavier run.\n`);
}

async function clusters(options) {
  if (!options.inDir) throw new Error("clusters requires --in <episodesDir>");
  const minSize = options.minSize === undefined ? 3 : Number(options.minSize);
  const top = options.top === undefined ? Infinity : Number(options.top);
  if (!Number.isInteger(minSize) || minSize < 1) throw new Error("--min-size must be a positive integer");
  if (!(top === Infinity || (Number.isInteger(top) && top >= 1))) throw new Error("--top must be a positive integer");
  const episodes = loadEpisodes(options.inDir).map((item) => item.episode);
  const ranked = rankClusters(clusterEpisodes(episodes, { minSize })).map((cluster) => ({ ...cluster, created: new Date().toISOString() }));
  const output = path.join(path.dirname(path.resolve(options.inDir)), "clusters.json");
  writeFileSync(output, `${JSON.stringify(ranked, null, 2)}\n`);
  const shown = ranked.slice(0, top);
  if (options.json) process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
  else {
    process.stdout.write("rank\tsize\tgold+strong\twitnesses\tproposable\tsignature\n");
    shown.forEach((cluster, index) => process.stdout.write(`${index + 1}\t${cluster.size}\t${(cluster.tierCounts?.gold ?? 0) + (cluster.tierCounts?.strong ?? 0)}\t${cluster.witnesses?.length ?? 0}\t${isProposable(cluster) ? "✓" : "✗"}\t${cluster.signature}\n`));
  }
}

function nonProposableReason(cluster) {
  const strong = (cluster?.tierCounts?.gold ?? 0) + (cluster?.tierCounts?.strong ?? 0);
  const witness = Array.isArray(cluster?.witnesses) && cluster.witnesses.some((item) => item?.replayable === true);
  return `size ${cluster?.size ?? 0}/3; gold+strong ${strong}/3; replayable witness ${witness ? "present" : "missing"}${cluster?.isLongTail ? "; long-tail clusters are not proposable" : ""}`;
}

function runChild(command, args, timeoutMs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...(typeof cwd === "string" && cwd ? { cwd } : {}) });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`command timed out after ${timeoutMs}ms`));
      else resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function propose(options) {
  if (!options.cluster || !options.inDir || !options.llm) throw new Error("propose requires --cluster, --in, and --llm <codex|echo>");
  if (!["codex", "echo"].includes(options.llm)) throw new Error("--llm must be codex or echo");
  const episodes = loadEpisodes(options.inDir).map((item) => item.episode);
  const clustersFile = path.join(path.dirname(path.resolve(options.inDir)), "clusters.json");
  const allClusters = readJson(clustersFile, "clusters file");
  const cluster = allClusters.find((item) => item?.id === options.cluster || item?.signature === options.cluster);
  if (!cluster) throw new Error(`cluster not found: ${options.cluster}`);
  if (!isProposable(cluster) && !options.forceDemo) throw new Error(`cluster is not proposable: ${nonProposableReason(cluster)}`);
  const target = routeCluster(cluster).surfaces[0];
  const targetFile = path.resolve(target);
  if (!existsSync(targetFile) || !statSync(targetFile).isFile()) throw new Error(`proposal target does not exist: ${target}`);
  const brief = buildBrief(cluster, episodes, readFileSync(targetFile, "utf8"));
  const prompt = renderPrompt(brief);
  let llmText;
  if (options.llm === "echo") {
    const anchor = brief.targetCurrentText.split(/\r?\n/)[0];
    if (!anchor) throw new Error(`proposal target is empty: ${brief.target}`);
    llmText = `\`\`\`json\n${JSON.stringify({ summary: "Add deterministic flywheel guidance", layer: brief.layer, target: brief.target, edit: { before: anchor, after: `${anchor}\nFlywheel note: replay the recorded witness before completing this task.` }, rationale: "Address the recurring witnessed failure.", expectedEffect: "The failure is prevented on replay." })}\n\`\`\``;
  } else {
    const timeout = options.timeout === undefined ? 180000 : Number(options.timeout) * 1000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout must be a positive number of seconds");
    const result = await runChild("codex", ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-m", "gpt-5.6-sol", prompt], timeout);
    if (result.code !== 0) throw new Error(`codex exited ${result.code}: ${result.stderr.trim()}`);
    llmText = result.stdout;
  }
  const parsed = parseProposal(llmText, brief);
  if (!parsed.ok) throw new Error(`proposal validation failed:\n${parsed.errors.map((error) => `- ${error.path || "proposal"}: ${error.message}`).join("\n")}`);
  const contract = buildEvalContract(cluster, parsed.candidate);
  const parent = path.dirname(path.resolve(options.inDir));
  if (contract.strategy === "witness_replay") {
    const trialsDir = path.join(parent, "trials");
    mkdirSync(trialsDir, { recursive: true });
    writeFileSync(path.join(trialsDir, `${cluster.id}.mjs`), contract.trialScript);
  }
  const patch = { ...toSelfPatch(parsed.candidate, contract, cluster), created: new Date().toISOString() };
  const outFile = path.resolve(options.outFile ?? path.join(parent, "patches", `${cluster.id}.json`));
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(patch, null, 2)}\n`);
  process.stdout.write(`layer: ${patch.layer}\ntarget: ${patch.target}\nrequires: ${patch.requires}\neval: ${contract.strategy} (${contract.strength})\ndiff:\n- ${patch.diff.before}\n+ ${patch.diff.after}\n`);
}

async function measure(options) {
  if (!options.patchFile) throw new Error("measure requires --patch <patchFile>");
  if (options.runner !== undefined && options.runner !== "node") throw new Error("--runner must be node");
  const patchFile = path.resolve(options.patchFile);
  const patch = readJson(patchFile, "patch");
  const strategy = patch?.meta?.flywheel?.evalStrategy;
  if (strategy !== "witness_replay") {
    fail(`measure supports only witness_replay in this build; strategy ${strategy ?? "unknown"} needs the statistical arm`, 2);
    return;
  }
  const clusterId = patch?.meta?.flywheel?.clusterId;
  const trialScript = path.resolve(path.dirname(patchFile), "..", "trials", `${clusterId}.mjs`);
  if (!existsSync(trialScript)) throw new Error(`trial script does not exist: ${trialScript}`);
  const target = path.resolve(patch.target);
  if (!existsSync(target)) throw new Error(`patch target does not exist: ${patch.target}`);
  const beforeRun = await runChild(process.execPath, [trialScript], 180000);
  let original;
  let changed = false;
  try {
    if (options.apply) {
      original = readFileSync(target, "utf8");
      const anchor = patch?.diff?.before;
      if (patch?.diff?.format !== "before_after" || typeof anchor !== "string" || !anchor) throw new Error("patch must contain a non-empty before_after diff");
      const first = original.indexOf(anchor);
      if (first < 0 || original.indexOf(anchor, first + anchor.length) >= 0) throw new Error("patch anchor drifted: before text must occur verbatim exactly once");
      writeFileSync(target, original.slice(0, first) + patch.diff.after + original.slice(first + anchor.length));
      changed = true;
    }
    const afterRun = await runChild(process.execPath, [trialScript], 180000);
    const report = { before: beforeRun.code, after: afterRun.code, regressed: beforeRun.code === 0 && afterRun.code !== 0, helped: beforeRun.code !== 0 && afterRun.code === 0 };
    const color = (code) => code === 0 ? "GREEN" : "RED";
    process.stdout.write(`MECHANISM DEMO (n=1, causal witness): before=${color(report.before)} after=${color(report.after)}\n${JSON.stringify(report)}\n`);
  } finally {
    if (changed && !options.keep) writeFileSync(target, original);
  }
}

async function report(options) {
  if (!options.inDir) throw new Error("report requires --in <episodesDir>");
  const records = loadEpisodes(options.inDir);
  const episodes = records.map((item) => item.episode);
  if (episodes.some((episode) => !objectOutcome(episode?.outcome) || episode.outcome.method === "unlabeled")) {
    throw new Error(`episodes are not labeled; run flywheel label --in ${options.inDir} --out ${options.inDir} first`);
  }
  const clustersFile = path.join(path.dirname(path.resolve(options.inDir)), "clusters.json");
  if (!existsSync(clustersFile)) throw new Error(`missing clusters file: ${clustersFile}; run flywheel clusters --in ${options.inDir} first`);
  const clusterData = readJson(clustersFile, "clusters file");
  if (!Array.isArray(clusterData)) throw new Error(`clusters file must contain an array: ${clustersFile}`);
  const atlas = buildAtlas(episodes, clusterData);
  atlas.generatedAtNote = `Generated ${new Date().toISOString()}`;
  const outFile = path.resolve(options.outFile ?? "atlas.html");
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, renderAtlasHtml(atlas));
  if (options.open) {
    const command = process.platform === "darwin" ? "open" : (process.platform === "win32" ? "cmd" : "xdg-open");
    const args = process.platform === "win32" ? ["/c", "start", "", outFile] : [outFile];
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => process.stderr.write(`flywheel: could not open report: ${error.message}\n`));
    child.unref();
  }
  process.stdout.write(`${outFile}\n`);
}

function labelInMemory(records) {
  const sessions = new Map();
  for (const record of records) {
    const key = String(record.episode?.session_id ?? "unknown");
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(record);
  }
  for (const session of sessions.values()) {
    session.sort((a, b) => String(a.episode?.started ?? "").localeCompare(String(b.episode?.started ?? "")));
    const outcomes = labelSession(session.map((item) => item.episode));
    session.forEach((item, index) => { item.episode.outcome = outcomes[index]; });
  }
  return records;
}

function jsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function echoProposal(brief) {
  const anchor = brief.targetCurrentText.split(/\r?\n/)[0];
  if (!anchor) throw new Error(`proposal target is empty: ${brief.target}`);
  return { summary: "Add deterministic flywheel guidance", layer: brief.layer, target: brief.target,
    edit: { before: anchor, after: `${anchor}\nFlywheel note: replay the recorded witness before completing this task.` },
    rationale: "Address the recurring witnessed failure.", expectedEffect: "The failure is prevented on replay." };
}

async function makeLoopPatch(cluster, episodes, llm) {
  const target = routeCluster(cluster).surfaces[0];
  const targetFile = path.resolve(target);
  if (!existsSync(targetFile) || !statSync(targetFile).isFile()) throw new Error(`proposal target does not exist: ${target}`);
  const brief = buildBrief(cluster, episodes, readFileSync(targetFile, "utf8"));
  let llmText;
  if (llm === "echo") llmText = `\`\`\`json\n${JSON.stringify(echoProposal(brief))}\n\`\`\``;
  else {
    const result = await runChild("codex", ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-m", "gpt-5.6-sol", renderPrompt(brief)], 180000);
    if (result.code !== 0) throw new Error(`codex exited ${result.code}: ${result.stderr.trim()}`);
    llmText = result.stdout;
  }
  const parsed = parseProposal(llmText, brief);
  if (!parsed.ok) throw new Error(`proposal validation failed: ${parsed.errors.map((error) => error.message).join("; ")}`);
  const contract = buildEvalContract(cluster, parsed.candidate);
  return { patch: { ...toSelfPatch(parsed.candidate, contract, cluster), created: new Date().toISOString() }, contract };
}

let selfpatchModule;
async function selfpatch() {
  if (selfpatchModule !== undefined) return selfpatchModule;
  try { selfpatchModule = await import(new URL("../../selfpatch/src/index.js", import.meta.url)); }
  catch { selfpatchModule = null; }
  return selfpatchModule;
}

function protectedTarget(target) {
  const normalized = String(target ?? "").replaceAll("\\", "/").toLowerCase();
  const base = path.basename(normalized);
  return base === ".env" || base.endsWith(".key") || base.startsWith("id_") || base === "settings.json" ||
    base === "package.json" || base.startsWith("credentials") || normalized.includes("/.ssh/") || normalized.includes("/.git/");
}

async function gatePatch(patch) {
  if (protectedTarget(patch?.target)) return { decision: "block", reason: `touches protected surface "${patch.target}"` };
  const module = await selfpatch();
  if (typeof module?.gate === "function") {
    try { return module.gate(patch, flywheelPolicy()); } catch (error) { return { decision: "block", reason: error.message }; }
  }
  const limits = flywheelPolicy().blast_radius_limits;
  if ((patch?.blast_radius?.surfaces?.length ?? 0) > limits.max_surfaces ||
      (patch?.blast_radius?.files_changed ?? 0) > limits.max_files_changed ||
      (patch?.blast_radius?.lines_changed ?? 0) > limits.max_lines_changed) return { decision: "block", reason: "blast radius exceeds policy" };
  return patch?.requires === "auto" && ["context", "skill"].includes(patch?.layer)
    ? { decision: "approve", reason: "within policy" } : { decision: "human-gate", reason: "approval required" };
}

async function linkedDecision(record, entries) {
  const base = { ...record, seq: entries.length, prev: entries.at(-1)?.hash ?? null };
  const module = await selfpatch();
  try { return { ...base, hash: typeof module?.hashEntry === "function" ? module.hashEntry(base) : `sha256:${sha256hex(canonicalize(base))}` }; }
  catch { return { ...base, hash: `sha256:${sha256hex(canonicalize(base))}` }; }
}

async function attestApplied(patch, measureResult, cluster, parent) {
  const built = buildAttestation(patch, { ...measureResult, verdict: "helped", strategy: "witness_replay" }, cluster);
  try {
    const provenant = await import(new URL("../../provenant/src/index.js", import.meta.url));
    const record = provenant.attest(built.artifact.hash, { ...built.meta, created: new Date().toISOString() });
    appendFileSync(path.join(parent, "attestations.jsonl"), `${JSON.stringify(record)}\n`);
    return record.id;
  } catch { return undefined; }
}

async function replayPatch(patch, cluster, apply) {
  const witness = cluster.witnesses.find((item) => item?.replayable === true && typeof item?.cmd === "string");
  if (!witness) return { before: 1, after: 1, helped: false, regressed: false };
  const runWitness = () => process.platform === "win32"
    ? runChild("cmd", ["/d", "/s", "/c", witness.cmd], 180000, witness.cwd)
    : runChild("/bin/sh", ["-c", witness.cmd], 180000, witness.cwd);
  const beforeRun = await runWitness().catch(() => ({ code: 1 }));
  const target = path.resolve(patch.target);
  const original = readFileSync(target, "utf8");
  const anchor = patch?.diff?.before;
  const first = typeof anchor === "string" && anchor ? original.indexOf(anchor) : -1;
  if (patch?.diff?.format !== "before_after" || first < 0 || original.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error("patch anchor drifted: before text must occur verbatim exactly once");
  }
  const changed = original.slice(0, first) + patch.diff.after + original.slice(first + anchor.length);
  writeFileSync(target, changed);
  let afterRun;
  try { afterRun = await runWitness().catch(() => ({ code: 1 })); }
  finally {
    const helped = beforeRun.code !== 0 && afterRun?.code === 0;
    if (!(apply && helped)) writeFileSync(target, original);
    else writeFileSync(`${target}.flywheel.bak`, original);
  }
  return { before: beforeRun.code, after: afterRun.code, helped: beforeRun.code !== 0 && afterRun.code === 0, regressed: beforeRun.code === 0 && afterRun.code !== 0 };
}

function summaryRow(signature, gate, measureResult, result, reason = "") {
  const measured = measureResult ? `${measureResult.before}->${measureResult.after}` : "-";
  process.stdout.write(`${signature}\t${gate}\t${measured}\t${result}${reason ? `\t${reason}` : ""}\n`);
}

async function loop(options) {
  if (!options.inDir) throw new Error("loop requires --in <episodesDir>");
  const llm = options.llm ?? "codex";
  if (!["codex", "echo"].includes(llm)) throw new Error("--llm must be codex or echo");
  const max = options.max === undefined ? Infinity : Number(options.max);
  if (!(max === Infinity || (Number.isInteger(max) && max >= 1))) throw new Error("--max must be a positive integer");
  const records = labelInMemory(loadEpisodes(options.inDir));
  const episodes = records.map((item) => item.episode);
  let ranked = rankClusters(clusterEpisodes(episodes, { minSize: 3 }));
  let plan = planLoop(ranked, { ranked: true, max });
  // A precomputed synthetic cluster is useful for mechanism demos where the
  // raw corpus was deliberately minimized. Prefer freshly derived data unless
  // it yields no actionable cluster.
  const priorClusters = path.join(path.dirname(path.resolve(options.inDir)), "clusters.json");
  if (plan.actions.length === 0 && existsSync(priorClusters)) {
    const saved = readJson(priorClusters, "clusters file");
    if (Array.isArray(saved) && saved.length) {
      const savedPlan = planLoop(saved, { max });
      if (savedPlan.actions.length > 0) { ranked = rankClusters(saved); plan = savedPlan; }
    }
  }
  process.stdout.write("cluster\tgate\tmeasure\tresult\treason\n");
  for (const item of plan.skipped) summaryRow(item.cluster_signature, "-", null, "skipped", item.reason);
  if (options.dryRun) {
    for (const action of plan.actions) summaryRow(action.cluster_signature, "planned", null, "queued", "dry-run");
    process.stdout.write(`Plan: ${plan.actions.length} action(s), ${plan.skipped.length} skipped; dry-run changed nothing.\n`);
    return;
  }
  const parent = path.dirname(path.resolve(options.inDir));
  writeEpisodeRecords(records, options.inDir);
  writeFileSync(path.join(parent, "clusters.json"), `${JSON.stringify(ranked.map((cluster) => ({ ...cluster, created: new Date().toISOString() })), null, 2)}\n`);
  const ledgerFile = path.join(parent, "ledger.jsonl");
  const entries = jsonl(ledgerFile);
  const applied = new Set(entries.filter((entry) => entry.applied === true).map((entry) => entry.cluster_signature));
  const decisions = [];
  for (const item of plan.skipped) decisions.push({ item, gate: "skipped", reason: item.reason, measure: null, applied: false });
  for (const action of plan.actions) {
    if (applied.has(action.cluster_signature)) {
      summaryRow(action.cluster_signature, "approve", null, "skipped", "already_applied");
      decisions.push({ item: action, gate: "approve", reason: "already_applied", measure: null, applied: false });
      continue;
    }
    try {
      const { patch, contract } = await makeLoopPatch(action.cluster, episodes, llm);
      const patchesDir = path.join(parent, "patches");
      const trialsDir = path.join(parent, "trials");
      mkdirSync(patchesDir, { recursive: true });
      mkdirSync(trialsDir, { recursive: true });
      writeFileSync(path.join(patchesDir, `${action.cluster.id}.json`), `${JSON.stringify(patch, null, 2)}\n`);
      writeFileSync(path.join(trialsDir, `${action.cluster.id}.mjs`), contract.trialScript);
      const gated = await gatePatch(patch);
      if (gated.decision !== "approve") {
        summaryRow(action.cluster_signature, gated.decision, null, "queued", gated.reason);
        decisions.push({ item: action, gate: gated.decision, reason: gated.reason, measure: null, applied: false });
        continue;
      }
      const measured = await replayPatch(patch, action.cluster, options.apply === true);
      const didApply = options.apply === true && measured.helped;
      const attestationId = didApply ? await attestApplied(patch, measured, action.cluster, parent) : undefined;
      const result = didApply ? "applied" : "queued";
      const reason = measured.helped ? (options.apply ? "" : "--apply not set") : (measured.regressed ? "regressed" : "not_helped");
      summaryRow(action.cluster_signature, gated.decision, measured, result, reason);
      decisions.push({ item: action, gate: gated.decision, reason, measure: measured, applied: didApply, attestationId });
    } catch (error) {
      summaryRow(action.cluster_signature, "block", null, "queued", error.message);
      decisions.push({ item: action, gate: "block", reason: error.message, measure: null, applied: false });
    }
  }
  for (const decision of decisions) {
    const record = await linkedDecision({ ts: new Date().toISOString(), cluster_signature: decision.item.cluster_signature,
      layer: decision.item.layer, gate_decision: decision.gate, eval_strategy: decision.item.eval_strategy ?? null,
      measure: decision.measure ?? { before: null, after: null, helped: false, regressed: false }, applied: decision.applied,
      ...(decision.attestationId ? { attestation_id: decision.attestationId } : {}), ...(decision.reason ? { reason: decision.reason } : {}) }, entries);
    appendFileSync(ledgerFile, `${JSON.stringify(record)}\n`);
    entries.push(record);
  }
}

async function status(options) {
  if (!options.inDir) throw new Error("status requires --in <episodesDir>");
  const episodes = loadEpisodes(options.inDir).map((item) => item.episode);
  const tiers = { gold: 0, strong: 0, weak: 0, unknown: 0 };
  let failures = 0;
  for (const episode of episodes) {
    const tier = Object.hasOwn(tiers, episode?.outcome?.tier) ? episode.outcome.tier : "unknown";
    tiers[tier] += 1;
    if (episode?.outcome?.label === "fail" || episode?.failure) failures += 1;
  }
  const parent = path.dirname(path.resolve(options.inDir));
  const clusterData = existsSync(path.join(parent, "clusters.json")) ? readJson(path.join(parent, "clusters.json"), "clusters file") : [];
  const ledger = jsonl(path.join(parent, "ledger.jsonl"));
  process.stdout.write(`episodes: ${episodes.length}\nfailures: ${failures}\ntiers: ${JSON.stringify(tiers)}\nproposable clusters: ${clusterData.filter(isProposable).length}\npatches applied: ${ledger.filter((entry) => entry.applied === true).length}\nqueued: ${ledger.filter((entry) => entry.applied === false && entry.gate_decision !== "skipped" && entry.reason !== "already_applied").length}\nlast run: ${ledger.at(-1)?.ts ?? "never"}\n`);
}

function objectOutcome(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

const argv = process.argv.slice(2);
if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) process.stdout.write(USAGE);
else {
  const options = parseArgs(argv);
  if (!options) { process.stderr.write(USAGE); fail("unknown subcommand or invalid arguments", 2); }
  else {
    try {
      if (options.command === "harvest") await harvest(options);
      else if (options.command === "label") await label(options);
      else if (options.command === "gold") await gold(options);
      else if (options.command === "calibrate") await calibrate(options);
      else if (options.command === "clusters") await clusters(options);
      else if (options.command === "propose") await propose(options);
      else if (options.command === "measure") await measure(options);
      else if (options.command === "report") await report(options);
      else if (options.command === "loop") await loop(options);
      else if (options.command === "status") await status(options);
    } catch (error) { fail(error.message); }
  }
}
