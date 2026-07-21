import { contentId } from "../hash.js";
import { cmdHead, errorSignature, parseSignature } from "./signature.js";
import { AGENT_FAULT_CLASSES, classifyError, isBenignNonZero } from "./normalize.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value, fallback = "") => typeof value === "string" ? value : fallback;

function recordText(record) {
  const content = record?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => object(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n");
}

function capRequest(text) {
  const value = string(text);
  return value.length <= 2048 ? value : value.slice(0, 2048);
}

function patchLines(patch) {
  const hunks = Array.isArray(patch) ? patch : patch?.hunks;
  if (!Array.isArray(hunks)) return 0;
  let total = 0;
  for (const hunk of hunks) {
    if (!object(hunk)) continue;
    if (Array.isArray(hunk.lines)) total += hunk.lines.length;
    else if (Number.isFinite(hunk.lines)) total += Math.max(0, hunk.lines);
    else {
      const oldLines = Number(hunk.oldLines ?? hunk.old_lines ?? 0);
      const newLines = Number(hunk.newLines ?? hunk.new_lines ?? 0);
      if (Number.isFinite(oldLines)) total += Math.max(0, oldLines);
      if (Number.isFinite(newLines)) total += Math.max(0, newLines);
    }
  }
  return total;
}

function artifacts(steps) {
  const written = new Set();
  const edited = new Set();
  let linesChanged = 0;
  for (const step of steps) {
    const tool = string(step?.tool).toLowerCase();
    const path = step?.input?.file_path ?? step?.input?.path;
    if (typeof path === "string" && path) {
      if (tool === "write") written.add(path);
      if (tool === "edit") edited.add(path);
    }
    linesChanged += patchLines(step?.input?.structuredPatch ?? step?.input?.structured_patch ?? step?.structuredPatch);
  }
  return { files_written: [...written].sort(), files_edited: [...edited].sort(), lines_changed: linesChanged };
}

function isBashLike(step) {
  return /^(bash|shell|terminal)$/i.test(string(step?.tool));
}

function witness(step, episodeCwd) {
  const command = string(step?.input?.command);
  if (!isBashLike(step)) return { kind: "none", replayable: false };
  return {
    kind: "command",
    cmd: command,
    cwd: string(step?.input?.cwd ?? step?.cwd ?? episodeCwd),
    observed_exit_code: Number.isInteger(step?.exitCode) ? step.exitCode : null,
    replayable: command.trim().length > 0 && step?.harnessError !== true,
  };
}

export function buildEpisode(shell, steps, opts = {}) {
  try {
    const records = Array.isArray(shell?.records) ? shell.records : [];
    const safeSteps = Array.isArray(steps) ? steps.filter(object) : [];
    const first = records[0] ?? {};
    const sessionId = string(shell?.sessionId ?? shell?.session_id ?? records.find((r) => r?.sessionId != null)?.sessionId, "unknown");
    const promptId = string(shell?.promptId ?? shell?.prompt_id, "unknown");
    const agentId = string(opts?.agentId ?? shell?.agentId ?? shell?.agent_id, "main");
    const timestamps = records.map((r) => r?.timestamp).filter((v) => typeof v === "string" && !Number.isNaN(Date.parse(v))).sort();
    const started = timestamps[0] ?? string(first.timestamp, new Date(0).toISOString());
    const ended = timestamps.at(-1) ?? started;
    const duration = Math.max(0, Date.parse(ended) - Date.parse(started));
    const userRecord = records.find((r) => (r?.type === "user" || r?.message?.role === "user") && recordText(r).trim());
    const requestText = capRequest(recordText(userRecord));

    let repeatCommandMax = 0;
    let run = 0;
    let previous;
    for (const step of safeSteps) {
      const head = cmdHead(step);
      run = head && head === previous ? run + 1 : (head ? 1 : 0);
      previous = head || undefined;
      repeatCommandMax = Math.max(repeatCommandMax, run);
    }

    const recovered = new Set();
    const unrecovered = new Set();
    const distinct = new Set();
    const unrecoveredSteps = [];
    let benignNonzero = 0;
    let nonAgentFaults = 0;
    for (let index = 0; index < safeSteps.length; index += 1) {
      const step = safeSteps[index];
      if (step.ok !== false) continue;
      const command = string(step?.input?.command);
      const errorText = string(step?.errorText ?? step?.error_text);
      if (isBenignNonZero({ exitCode: step.exitCode, errorText, command })) {
        benignNonzero += 1;
        continue;
      }
      const { errorClass } = classifyError(errorText);
      if (!AGENT_FAULT_CLASSES.has(errorClass)) {
        nonAgentFaults += 1;
        continue;
      }
      const signature = errorSignature(step);
      if (!signature) continue;
      distinct.add(signature);
      const head = cmdHead(step);
      const didRecover = Boolean(head) && safeSteps.slice(index + 1).some((later) => later.ok === true && cmdHead(later) === head);
      if (didRecover) recovered.add(signature);
      else { unrecovered.add(signature); unrecoveredSteps.push({ step, signature }); }
    }
    const lastFailure = unrecoveredSteps.at(-1);
    const systemRecords = records.filter((r) => r?.type === "system" || r?.message?.role === "system");

    const cwd = string(shell?.cwd ?? records.find((r) => typeof r?.cwd === "string")?.cwd, "unknown");
    return {
      id: contentId("ep", { session_id: sessionId, prompt_id: promptId, agent_id: agentId }),
      schema: "flywheel/episode@1",
      session_id: sessionId,
      prompt_id: promptId,
      agent_id: agentId,
      project: string(opts?.project ?? shell?.project ?? first.project, "unknown"),
      cwd,
      git_branch: string(shell?.gitBranch ?? shell?.git_branch ?? records.find((r) => typeof r?.gitBranch === "string")?.gitBranch),
      started,
      ended,
      duration_ms: Number.isFinite(duration) ? duration : 0,
      is_sidechain: records.some((r) => r?.isSidechain === true) || shell?.isSidechain === true,
      request: { text: requestText, chars: requestText.length },
      steps: safeSteps,
      artifacts: artifacts(safeSteps),
      signals: {
        ...(shell?.truncated === true ? { truncated_group: true } : {}),
        tool_calls: safeSteps.length,
        errored_tool_results: safeSteps.filter((s) => s.ok === false).length,
        benign_nonzero: benignNonzero,
        non_agent_faults: nonAgentFaults,
        harness_errors: safeSteps.filter((s) => s.harnessError === true).length,
        interrupted: safeSteps.some((s) => s.interrupted === true),
        compacted: systemRecords.some((r) => r?.subtype === "compact_boundary" || r?.type === "compact_boundary"),
        api_errors: systemRecords.filter((r) => r?.subtype === "api_error" || r?.type === "api_error").length,
        repeat_command_max: repeatCommandMax,
        distinct_error_signatures: [...distinct].sort(),
        recovered_signatures: [...recovered].sort(),
        unrecovered_signatures: [...unrecovered].sort(),
      },
      outcome: { label: "unknown", tier: "unknown", method: "unlabeled", evidence: [] },
      failure: lastFailure ? { signature: lastFailure.signature, mode: parseSignature(lastFailure.signature).errorClass, witness: witness(lastFailure.step, cwd) } : null,
    };
  } catch {
    return buildEpisode({}, [], {});
  }
}
