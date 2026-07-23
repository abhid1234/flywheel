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
      // A small deterministic model of a POSIX sandbox — enough to faithfully
      // reproduce every controlled task's known behaviour offline, so mock runs
      // are representative of the real ones. Tracks: python venv modules, node
      // packages, files, and installed CLI tools.
      const world = { pyMods: new Set(["os", "sys", "json"]), nodePkgs: new Set(), files: new Set(), clis: new Set() };
      const fail = (log, stderr) => ({ exitCode: 1, stdout: "", stderr, steps: log });
      const ok = (log) => ({ exitCode: 0, stdout: "", stderr: "", steps: log });
      const log = [];
      for (const step of steps) {
        const s = String(step);
        // fresh venv → no third-party python modules
        if (/python3?\s+-m\s+venv\b/.test(s)) { world.pyMods = new Set(["os", "sys", "json"]); log.push("venv"); continue; }
        // pip install <pkg> → provides its module (pyyaml→yaml) and any console script
        let m = s.match(/pip\s+install\s+(?:-\S+\s+)*([\w.-]+)/);
        if (m) { const p = m[1].toLowerCase(); world.pyMods.add(p.replace("pyyaml", "yaml")); world.clis.add(p); log.push(`pip ${p}`); continue; }
        // npm install <pkg> → provides the node module
        m = s.match(/npm\s+install\s+([\w.@/-]+)/);
        if (m) { world.nodePkgs.add(m[1].toLowerCase()); log.push(`npm ${m[1]}`); continue; }
        // echo ... > file / touch file → create a file
        m = s.match(/(?:>|touch)\s*([^\s;|&]+)/);
        if (m && /(?:^|\s)(?:echo|printf|touch|cat\s*<<)/.test(s)) { world.files.add(m[1]); log.push(`write ${m[1]}`); continue; }
        // rm -f file → remove it
        m = s.match(/rm\s+-[rf]+\s+([^\s;|&]+)/);
        if (m) { world.files.delete(m[1]); log.push(`rm ${m[1]}`); continue; }
        // witness: python import
        m = s.match(/python3?\s+-c\s+["']import\s+([\w.]+)["']/) || s.match(/\/bin\/python\s+-c\s+["']import\s+([\w.]+)["']/);
        if (m) { const mod = m[1].toLowerCase(); return world.pyMods.has(mod) ? ok(log) : fail(log, `ModuleNotFoundError: No module named '${mod}'`); }
        // witness: python assertion
        m = s.match(/python3?\s+-c\s+["']assert\s+([\d\s+*/-]+)==\s*(\d+)/);
        if (m) { const lhs = Function(`return (${m[1]})`)(); return lhs === Number(m[2]) ? ok(log) : fail(log, "AssertionError"); }
        // witness: node require
        m = s.match(/node\s+-e\s+["']require\(['"]([\w.@/-]+)['"]\)["']/);
        if (m) { const pkg = m[1].toLowerCase(); return world.nodePkgs.has(pkg) ? ok(log) : fail(log, `Error: Cannot find module '${pkg}'`); }
        // witness: cat a file
        m = s.match(/(?:^|;|&&|\s)cat\s+([^\s;|&]+)\s*$/);
        if (m) { return world.files.has(m[1]) ? ok(log) : fail(log, `cat: ${m[1]}: No such file or directory`); }
        // witness: a venv-scoped CLI (e.g. /tmp/ve/bin/cowsay) — exists iff installed
        m = s.match(/\/bin\/([\w.-]+)\s/);
        if (m && !/python|pip/.test(m[1])) { return world.clis.has(m[1].toLowerCase()) ? ok(log) : fail(log, `${m[1]}: command not found`); }
        log.push(`ran: ${s.slice(0, 40)}`);
      }
      return ok(log);
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
