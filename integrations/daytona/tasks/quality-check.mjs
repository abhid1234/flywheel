// Business scenario: a quality-assurance agent sanity-checks a shipment before
// it goes out. Under the hood a test_failure — but the story is: a data error
// slipped through until the check was fixed.
export const task = {
  id: "quality-check",
  title: "QA agent — shipment check",
  fn: "Quality",
  scenario: "An AI agent verifies a shipment's recorded weight matches its contents.",
  wentWrong: "A totting-up bug let a mismatched shipment pass the check.",
  theFix: "Correct the check so the totals actually have to agree.",
  errorClass: "test_failure",
  signature: "quality:shipment-weight-mismatch",
  steps(arm) {
    // control records the wrong total (9) vs the true sum of items (2+3+5=10);
    // the fix records the correct total so the QA assertion passes.
    const recorded = arm === "after" ? 10 : 9;
    return [`python3 -c "items=[2,3,5]; recorded_total=${recorded}; assert recorded_total==sum(items), 'AssertionError: shipment weight mismatch — QA check failed'"`];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
