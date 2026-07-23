// Business scenario: an analytics agent turns raw sales data into a readable
// report. Under the hood a command_not_found (the reporting tool isn't
// installed) — but the story is: the monthly report couldn't be generated.
export const task = {
  id: "analytics-report",
  title: "Analytics agent — sales report",
  fn: "Analytics",
  scenario: "An AI agent formats the month's sales data into a readable report.",
  wentWrong: "The reporting tool wasn't installed, so the report couldn't be generated.",
  theFix: "Install the reporting tool the agent uses.",
  errorClass: "command_not_found",
  signature: "analytics:reporting-tool-missing",
  steps(arm) {
    const ve = "/tmp/rpt-ve";
    const setup = [
      `rm -rf ${ve} && python3 -m venv ${ve}`,
      `printf 'region,revenue\\nWest,120000\\nEast,98000\\n' > /tmp/sales.csv`,
    ];
    const fix = arm === "after" ? [`${ve}/bin/pip install -q csvkit`] : [];
    const witness = [`${ve}/bin/csvlook /tmp/sales.csv`];
    return [...setup, ...fix, ...witness];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
