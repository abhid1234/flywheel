import { errorSignature } from "../harvest/signature.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const REBUKE = /^\s*(no[,.]|that'?s wrong|you (didn'?t|did not)|still (broken|failing)|undo|revert that|why did you)/i;

function outcome(label, tier, confidence, method, evidence = []) {
  return { label, tier, confidence, method, evidence };
}

function editedFiles(episode) {
  const artifacts = object(episode?.artifacts) ? episode.artifacts : {};
  if ((Array.isArray(artifacts.files_edited) && artifacts.files_edited.length > 0)
    || (Array.isArray(artifacts.files_written) && artifacts.files_written.length > 0)) return true;
  return (Array.isArray(episode?.steps) ? episode.steps : []).some((step) =>
    /^(edit|write|applypatch|apply_patch)$/i.test(typeof step?.tool === "string" ? step.tool : ""));
}

function verificationCommand(command) {
  if (typeof command !== "string") return false;
  // Accept ordinary flags, but not a larger shell expression whose eventual result
  // cannot safely be attributed to the verification command alone.
  const value = command.trim();
  return /^(?:npm test|npm run test|pytest|cargo test|go test|make test|node --test)(?:\s|$)/.test(value)
    || /^tsc(?:\s+[^;&|]*)?\s--noEmit(?:\s|$)/.test(value);
}

function failureEvidence(episode) {
  const signature = typeof episode?.failure?.signature === "string" ? episode.failure.signature : "unknown signature";
  const steps = Array.isArray(episode?.steps) ? episode.steps : [];
  let index = Number.isInteger(episode?.failure?.step) ? episode.failure.step : null;
  if (index === null) {
    const found = steps.findIndex((step) => {
      try { return errorSignature(step) === signature; } catch { return false; }
    });
    if (found >= 0) index = Number.isInteger(steps[found]?.i) ? steps[found].i : found;
  }
  return [{ ...(index === null ? {} : { step: index }), why: signature }];
}

export function labelFromTranscript(episode) {
  try {
    if (!object(episode)) return null;
    const steps = Array.isArray(episode.steps) ? episode.steps : [];
    const signals = object(episode.signals) ? episode.signals : {};

    if (object(episode.failure)) {
      return outcome("fail", "strong", 0.8, "transcript.unrecovered_terminal_error", failureEvidence(episode));
    }

    const green = steps.slice(-3).find((step) =>
      step?.exitCode === 0 && verificationCommand(step?.input?.command));
    if (green && editedFiles(episode)) {
      const index = Number.isInteger(green.i) ? green.i : steps.indexOf(green);
      return outcome("pass", "strong", 0.8, "transcript.verified_green", [{ step: index, why: "recognized verification command exited 0 after file edits" }]);
    }

    const weakReasons = [];
    if (Number(signals.api_errors) > 0) weakReasons.push("API error observed");
    if (signals.interrupted === true) weakReasons.push("episode was interrupted");
    if (Number(signals.repeat_command_max) >= 3) weakReasons.push("same command repeated at least 3 times");
    if (weakReasons.length > 0) return outcome("fail", "weak", 0.4, "transcript.weak_signal", weakReasons.map((why) => ({ why })));

    if (editedFiles(episode) && Number(signals.errored_tool_results) === 0) {
      return outcome("pass", "weak", 0.4, "transcript.clean_edit", [{ why: "file edits with no errored tool results" }]);
    }
    return outcome("unknown", "unknown", 0, "transcript.insufficient", []);
  } catch {
    return null;
  }
}

function requestText(episode) {
  if (typeof episode?.request === "string") return episode.request;
  return typeof episode?.request?.text === "string" ? episode.request.text : "";
}

function withinRebukeWindow(current, next) {
  const from = Date.parse(current?.ended ?? current?.started);
  const to = Date.parse(next?.started);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from && to - from <= 120_000;
}

export function labelSession(episodesInSessionOrder) {
  try {
    if (!Array.isArray(episodesInSessionOrder)) return [];
    return episodesInSessionOrder.map((episode, index) => {
      const labeled = labelFromTranscript(episode)
        ?? outcome("unknown", "unknown", 0, "transcript.insufficient", []);
      const next = episodesInSessionOrder[index + 1];
      // This is deliberately the noisiest signal in the system. A mere change of
      // mind is not an agent defect, so only a prompt-leading, timely rebuke counts.
      if (next && withinRebukeWindow(episode, next) && REBUKE.test(requestText(next))) {
        return outcome("fail", "weak", 0.4, "transcript.user_rebuke", [{ why: "next episode begins with a timely user rebuke" }]);
      }
      return labeled;
    });
  } catch {
    return [];
  }
}

