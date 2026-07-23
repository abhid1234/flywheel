// Business scenario: a support agent pulls a customer's account to answer a
// ticket. Under the hood a file_not_found — but the story is: the agent
// couldn't find the customer.
export const task = {
  id: "support-record",
  title: "Support agent — customer lookup",
  fn: "Support",
  scenario: "An AI agent opens a customer's account record to resolve a support ticket.",
  wentWrong: "The account record wasn't where the agent expected — it hit a dead end.",
  theFix: "Make the customer record available where the agent looks for it.",
  errorClass: "file_not_found",
  signature: "support:customer-record-missing",
  steps(arm) {
    const dir = "/tmp/crm";
    const f = `${dir}/acme-corp.json`;
    const setup = [`rm -rf ${dir} && mkdir -p ${dir}`];
    const fix = arm === "after" ? [`echo '{"account":"ACME Corp","tier":"enterprise","open_tickets":2}' > ${f}`] : [];
    const witness = [`cat ${f}`];
    return [...setup, ...fix, ...witness];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
