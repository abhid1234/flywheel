const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const add = (errors, path, code, message) => errors.push({ path, code, message });

function criterionKey(value) {
  return /(^|_)(?:eval(?:_contract)?|command|test|check)(_|$)/i.test(value);
}

function hasCriterion(value) {
  if (Array.isArray(value)) return value.some(hasCriterion);
  if (!object(value)) return false;
  return Object.entries(value).some(([key, item]) => criterionKey(key) || hasCriterion(item));
}

function changedLines(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  return (left.length - prefix - suffix) + (right.length - prefix - suffix);
}

export function parseProposal(llmText, brief) {
  const errors = [];
  try {
    if (typeof llmText !== "string") {
      add(errors, "", "format", "proposal must be text");
      return { ok: false, errors };
    }
    const blocks = [...llmText.matchAll(/```json\s*\n([\s\S]*?)\n```/gi)];
    if (blocks.length !== 1 || llmText.replace(blocks[0]?.[0] ?? "", "").trim()) {
      add(errors, "", "format", "expected exactly one fenced json block and no other text");
      return { ok: false, errors };
    }
    let candidate;
    try { candidate = JSON.parse(blocks[0][1]); } catch {
      add(errors, "", "invalid_json", "fenced block is not valid JSON");
      return { ok: false, errors };
    }
    if (!object(candidate)) {
      add(errors, "", "type", "candidate must be an object");
      return { ok: false, errors };
    }
    for (const key of ["summary", "layer", "target", "rationale", "expectedEffect"]) {
      if (typeof candidate[key] !== "string" || !candidate[key]) add(errors, key, "required", `${key} must be a non-empty string`);
    }
    if (!object(candidate.edit)) add(errors, "edit", "required", "edit must be an object");
    const createsFile = brief?.meta?.creates_file === true;
    if (!object(candidate.edit) || typeof candidate.edit?.before !== "string" || (!createsFile && !candidate.edit.before)) {
      add(errors, "edit.before", "required", `edit.before must be ${createsFile ? "a string" : "a non-empty string"}`);
    }
    if (!object(candidate.edit) || typeof candidate.edit?.after !== "string" || !candidate.edit.after) add(errors, "edit.after", "required", "edit.after must be a non-empty string");
    if (createsFile && candidate.edit?.before !== "") add(errors, "edit.before", "new_file_anchor", "before must be empty when creating a file");
    if (hasCriterion(candidate)) add(errors, "", "criterion_supplied", "candidate must not supply a success criterion");
    if (candidate.layer !== brief?.layer) add(errors, "layer", "mismatch", "layer must match the brief");
    if (candidate.target !== brief?.target) add(errors, "target", "mismatch", "target must match the brief");
    const before = candidate.edit?.before;
    const after = candidate.edit?.after;
    if (typeof before === "string" && before) {
      const text = String(brief?.targetCurrentText ?? "");
      let count = 0;
      let position = 0;
      while ((position = text.indexOf(before, position)) !== -1) { count += 1; position += Math.max(1, before.length); }
      if (count === 0) add(errors, "edit.before", "anchor_not_found", "before text does not appear in the target");
      else if (count > 1) add(errors, "edit.before", "anchor_ambiguous", "before text appears more than once in the target");
    }
    if (typeof before === "string" && typeof after === "string") {
      if (before === after) add(errors, "edit.after", "unchanged", "after must differ from before");
      const limit = Number(brief?.constraints?.maxLinesChanged);
      if (Number.isFinite(limit) && changedLines(before, after) > limit) add(errors, "edit", "line_budget_exceeded", `edit exceeds ${limit} changed lines`);
    }
    return errors.length ? { ok: false, errors } : { ok: true, candidate };
  } catch {
    add(errors, "", "invalid_proposal", "proposal could not be validated");
    return { ok: false, errors };
  }
}
