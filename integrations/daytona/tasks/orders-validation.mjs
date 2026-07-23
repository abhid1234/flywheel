// Business scenario: an order-processing agent validates an incoming order.
// Under the hood a Node module_not_found (the data-handling library isn't
// installed) — but the story is: orders couldn't be processed.
export const task = {
  id: "orders-validation",
  title: "Operations agent — order intake",
  fn: "Operations",
  scenario: "An AI agent validates an incoming customer order before processing it.",
  wentWrong: "The data-handling library was missing, so order validation crashed.",
  theFix: "Install the data-handling library the agent depends on.",
  errorClass: "module_not_found",
  signature: "operations:order-validation-library-missing",
  steps(arm) {
    const dir = "/tmp/orders";
    const setup = [`rm -rf ${dir} && mkdir -p ${dir} && cd ${dir} && npm init -y >/dev/null 2>&1`];
    const fix = arm === "after" ? [`cd ${dir} && npm install lodash >/dev/null 2>&1`] : [];
    const witness = [`cd ${dir} && node -e "const _=require('lodash'); const order={items:[1,2,3]}; if(!_.isArray(order.items)) process.exit(1)"`];
    return [...setup, ...fix, ...witness];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
