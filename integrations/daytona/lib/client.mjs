// Daytona sandbox client — the impure execution seam for the statistical arm.
//
// This lives OUTSIDE src/ on purpose: src/ is pure, zero-dep, and node-import-free
// except hash.js. All the I/O (network, sandboxes, the official SDK) is quarantined
// here so the core stays testable offline.
//
// Two backends behind one interface:
//   - "mock"    : deterministic, no network, no key. Proves the loop end-to-end.
//   - "daytona" : the real thing, via @daytonaio/sdk (lazy-imported only when used).
//
// A backend exposes exactly one method:
//   run(steps: string[], { cwd, timeoutMs }) -> { exitCode, stdout, stderr }
// where `steps` are shell commands run in order in a FRESH, ISOLATED environment,
// and the result reflects the LAST step (the witness). One sandbox per call.

const DEFAULT_TIMEOUT_MS = 120_000;

// ---- mock backend -----------------------------------------------------------
// Simulates a clean POSIX sandbox for the controlled tasks. It does not execute
// arbitrary shells; it models the specific, known behaviours the PoC tasks rely
// on (package presence, a witness import) so the orchestration logic can be
// verified deterministically. Real behaviour comes from the daytona backend.
function makeMockBackend() {
  return {
    kind: "mock",
    async run(steps, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      // Model a fresh venv: creating one starts with ZERO third-party modules
      // (no system site-packages), matching real venv isolation. Only stdlib.
      const venv = { installed: new Set(["os", "sys", "json"]) };
      const log = [];
      for (const step of steps) {
        const s = String(step);
        // model: `python -m venv <dir>` — a clean, empty third-party env
        if (/python3?\s+-m\s+venv\b/.test(s)) { venv.installed = new Set(["os", "sys", "json"]); log.push("created venv"); continue; }
        // model: pip install adds a package (pyyaml provides the `yaml` module)
        let m = s.match(/pip\s+install\s+(?:-\S+\s+)*([\w.-]+)/);
        if (m) { venv.installed.add(m[1].toLowerCase().replace("pyyaml", "yaml")); log.push(`installed ${m[1]}`); continue; }
        // model: the witness — python importing a module
        m = s.match(/python3?\s+-c\s+["']import\s+([\w.]+)["']/);
        if (m) {
          const mod = m[1].toLowerCase();
          if (venv.installed.has(mod)) return { exitCode: 0, stdout: "", stderr: "", steps: log };
          return { exitCode: 1, stdout: "", stderr: `Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nModuleNotFoundError: No module named '${mod}'`, steps: log };
        }
        // unknown steps succeed quietly (setup noise)
        log.push(`ran: ${s.slice(0, 40)}`);
      }
      return { exitCode: 0, stdout: "", stderr: "", steps: log };
    },
  };
}

// ---- real daytona backend ---------------------------------------------------
function makeDaytonaBackend({ apiKey, apiUrl }) {
  let daytona = null; // lazy SDK handle
  async function sdk() {
    if (daytona) return daytona;
    let Daytona;
    try { ({ Daytona } = await import("@daytonaio/sdk")); }
    catch {
      throw new Error(
        "daytona backend needs the SDK. Install it in this folder:\n" +
        "  cd integrations/daytona && npm install\n" +
        "or run with FLYWHEEL_DAYTONA_BACKEND=mock to use the offline mock."
      );
    }
    daytona = new Daytona({ apiKey, ...(apiUrl ? { apiUrl } : {}) });
    return daytona;
  }
  return {
    kind: "daytona",
    async run(steps, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      const client = await sdk();
      let sandbox;
      try {
        sandbox = await client.create(); // fresh, isolated sandbox per trial
        let last = { exitCode: 0, stdout: "", stderr: "" };
        const ran = [];
        for (const step of steps) {
          const res = await sandbox.process.executeCommand(String(step), undefined, undefined, Math.ceil(timeoutMs / 1000));
          // SDK returns { exitCode, result } (result = combined stdout). Normalize.
          const exitCode = Number.isInteger(res?.exitCode) ? res.exitCode : (res?.result ? 0 : 1);
          last = { exitCode, stdout: String(res?.result ?? res?.stdout ?? ""), stderr: String(res?.stderr ?? (exitCode ? res?.result ?? "" : "")) };
          ran.push(String(step).slice(0, 40));
        }
        return { ...last, steps: ran };
      } finally {
        if (sandbox) { try { await sandbox.delete(); } catch { /* best-effort teardown */ } }
      }
    },
  };
}

// ---- selection --------------------------------------------------------------
// Backend resolution, in order:
//   1. FLYWHEEL_DAYTONA_BACKEND=mock  -> always mock (offline dev/CI)
//   2. a DAYTONA_API_KEY present      -> real daytona
//   3. otherwise                      -> mock, with a visible notice
export function resolveBackend(env = process.env) {
  const forced = (env.FLYWHEEL_DAYTONA_BACKEND || "").toLowerCase();
  if (forced === "mock") return makeMockBackend();
  if (forced === "daytona") {
    if (!env.DAYTONA_API_KEY) throw new Error("FLYWHEEL_DAYTONA_BACKEND=daytona but DAYTONA_API_KEY is unset");
    return makeDaytonaBackend({ apiKey: env.DAYTONA_API_KEY, apiUrl: env.DAYTONA_API_URL });
  }
  if (env.DAYTONA_API_KEY) return makeDaytonaBackend({ apiKey: env.DAYTONA_API_KEY, apiUrl: env.DAYTONA_API_URL });
  return makeMockBackend();
}
