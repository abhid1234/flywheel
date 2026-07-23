// Business scenario: a billing agent finalizes a customer invoice.
// Under the hood this is a test_failure (a validation catches a bad number),
// but the story is one every business recognizes: the bill came out wrong.
export const task = {
  id: "billing-invoice",
  title: "Billing agent — invoice totals",
  fn: "Billing",
  scenario: "An AI agent finalizes a customer's invoice.",
  wentWrong: "It skipped sales tax, so every invoice total came out wrong.",
  theFix: "Correct the calculation to apply the tax rate.",
  errorClass: "test_failure",
  signature: "billing:sales-tax-omitted",
  steps(arm) {
    // control omits tax (total = subtotal); the fix applies it. A validation
    // check compares against the known-correct total of $108.75.
    const calc = arm === "after" ? "total = subtotal * (1 + tax_rate)" : "total = subtotal";
    return [`python3 -c "subtotal=100.0; tax_rate=0.0875; ${calc}; assert abs(total-108.75)<0.01, 'AssertionError: invoice total wrong — sales tax not applied'"`];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
