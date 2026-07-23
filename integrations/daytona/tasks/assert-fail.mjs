// Controlled task: test_failure. A check asserts something false; the fix makes
// it true. A distinct error class from the install/file tasks — an actual failing
// assertion, the way a broken test presents.
export const task = {
  id: "assert-fail",
  errorClass: "test_failure",
  signature: "bash:test_failure:python3:",
  description: "an assertion fails until the checked value is corrected.",
  steps(arm) {
    const expected = arm === "after" ? 4 : 5; // control asserts the wrong answer
    return [`python3 -c "assert 2 + 2 == ${expected}, 'AssertionError: math check failed'"`];
  },
  reproducedFailure(result) { return (result?.exitCode ?? 1) !== 0; },
};
