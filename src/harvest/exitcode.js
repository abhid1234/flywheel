function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => typeof b === "string" ? b : (typeof b?.text === "string" ? b.text : typeof b?.content === "string" ? b.content : "")).filter(Boolean).join("\n");
}

export function parseToolResult(content, toolUseResult, isError) {
  try {
    let body = textOf(content);
    const harness = body.match(/^\s*<tool_use_error>([\s\S]*?)<\/tool_use_error>\s*$/i);
    if (harness) return { exitCode: null, body: harness[1], interrupted: false, harnessError: true };
    const interrupted = toolUseResult?.interrupted === true;
    if (interrupted) return { exitCode: null, body, interrupted: true, harnessError: false };
    const match = body.match(/^Exit code (\d+)(?:\s*\n---\n|\s*\n|$)/);
    if (match) {
      body = body.slice(match[0].length);
      return { exitCode: Number(match[1]), body, interrupted: false, harnessError: false };
    }
    if (!body && typeof toolUseResult?.stdout === "string") body = [toolUseResult.stdout, toolUseResult.stderr].filter(Boolean).join("\n");
    return { exitCode: isError === true ? 1 : 0, body, interrupted: false, harnessError: false };
  } catch {
    return { exitCode: isError === true ? 1 : 0, body: "", interrupted: false, harnessError: false };
  }
}
