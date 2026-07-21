function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function repoMatches(episode, repo) {
  const expected = text(repo).toLowerCase().replace(/\/+$/, "");
  if (!expected) return false;
  const project = text(episode?.project).toLowerCase().replace(/\/+$/, "");
  const cwd = text(episode?.cwd).toLowerCase().replaceAll("\\", "/").replace(/\/+$/, "");
  const name = expected.split("/").at(-1);
  return project === expected || project === name || project.endsWith(`/${name}`) ||
    cwd === expected || cwd.endsWith(`/${expected}`) || cwd.endsWith(`/${name}`);
}

function searchableText(episode) {
  const parts = [text(episode?.request?.text)];
  for (const step of Array.isArray(episode?.steps) ? episode.steps : []) {
    if (!object(step)) continue;
    parts.push(text(step.text), text(step.command), text(step.errorText));
    if (object(step.input)) parts.push(...Object.values(step.input).filter((value) => typeof value === "string"));
  }
  return parts.join("\n");
}

function issueNumber(pr) {
  const branchMatch = /(?:^|[^a-z0-9])issue[-_/]?(\d+)(?:$|[^0-9])/i.exec(text(pr?.headRefName));
  return branchMatch ? Number(branchMatch[1]) : (Number.isInteger(pr?.number) ? pr.number : null);
}

function referencesIssue(haystack, number) {
  if (!Number.isInteger(number)) return false;
  return new RegExp(`(?:issue[-_/]?${number}(?!\\d)|#${number}(?!\\d))`, "i").test(haystack);
}

function goldOutcome(pr) {
  const pass = pr.merged === true;
  return {
    label: pass ? "pass" : "fail",
    tier: "gold",
    confidence: 1,
    method: "merge",
    evidence: [{ repo: pr.repo, number: pr.number, mergedAt: pr.mergedAt ?? null }],
  };
}

export function goldFromMergeStatus(episodes, prOutcomes) {
  try {
    const source = Array.isArray(episodes) ? episodes : [];
    const prs = (Array.isArray(prOutcomes) ? prOutcomes : []).filter(object);
    let linked = 0;
    let goldPass = 0;
    let goldFail = 0;
    const output = source.map((value) => {
      if (!object(value)) return value;
      const episode = { ...value };
      const branch = text(episode.git_branch);
      let matches = branch ? prs.filter((pr) => text(pr.headRefName) === branch) : [];
      let rule = "branch";
      if (matches.length > 1) {
        episode.gold_link = { linked: false, reason: "ambiguous_branch", candidates: matches.map((pr) => `${pr.repo}#${pr.number}`) };
        return episode;
      }
      if (matches.length === 0) {
        rule = "issue_repo";
        const haystack = searchableText(episode);
        matches = prs.filter((pr) => repoMatches(episode, pr.repo) && referencesIssue(haystack, issueNumber(pr)));
        if (matches.length > 1) {
          episode.gold_link = { linked: false, reason: "ambiguous_issue_repo", candidates: matches.map((pr) => `${pr.repo}#${pr.number}`) };
          return episode;
        }
      }
      const pr = matches[0];
      if (!pr || (pr.merged !== true && pr.closedUnmerged !== true)) return episode;
      episode.outcome = goldOutcome(pr);
      episode.gold_link = { linked: true, rule, repo: pr.repo, number: pr.number };
      linked += 1;
      if (pr.merged === true) goldPass += 1;
      else goldFail += 1;
      return episode;
    });
    return { episodes: output, linked, goldPass, goldFail, unlinked: output.length - linked };
  } catch {
    const safe = Array.isArray(episodes) ? episodes : [];
    return { episodes: safe, linked: 0, goldPass: 0, goldFail: 0, unlinked: safe.length };
  }
}
