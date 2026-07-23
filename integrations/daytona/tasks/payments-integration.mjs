// Business scenario: a billing agent charges a customer through the payments
// provider. Under the hood a module_not_found (the Stripe SDK isn't installed) —
// but the story is: the agent couldn't reach the payment system.
export const task = {
  id: "payments-integration",
  title: "Payments agent — charge a customer",
  fn: "Payments",
  scenario: "An AI agent connects to the payments provider to charge a customer.",
  wentWrong: "The payments integration wasn't installed, so the charge never went through.",
  theFix: "Install the payments provider's integration.",
  errorClass: "module_not_found",
  signature: "payments:integration-not-installed",
  steps(arm) {
    const ve = "/tmp/pay-ve";
    const setup = [`rm -rf ${ve} && python3 -m venv ${ve}`];
    const fix = arm === "after" ? [`${ve}/bin/pip install -q stripe`] : [];
    const witness = [`${ve}/bin/python -c "import stripe"`];
    return [...setup, ...fix, ...witness];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
