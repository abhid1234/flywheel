export function renderPrompt(brief) {
  let serialized;
  try { serialized = JSON.stringify(brief, null, 2); } catch { serialized = "{}"; }
  return [
    "Write a narrowly scoped fix for the observed failure described below.",
    "Return exactly one fenced JSON block and no other text, using this shape:",
    "```json",
    '{"summary":"...","layer":"...","target":"...","edit":{"before":"...","after":"..."},"rationale":"...","expectedEffect":"..."}',
    "```",
    brief?.meta?.creates_file === true
      ? "Copy layer and target exactly. This creates a new file, so edit.before must be an empty string."
      : "Copy layer and target exactly. The before text must be one unique verbatim excerpt of targetCurrentText.",
    "Do not add any fields beyond the displayed shape.",
    "Proposal brief:",
    serialized ?? "null",
  ].join("\n");
}
