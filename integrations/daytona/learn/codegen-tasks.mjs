// Real code-generation tasks for the live learning experiment. Each is a spec an
// agent must satisfy by writing `solve(...)` in solution.py, graded by a HIDDEN
// check script run in a Daytona sandbox. Each task has a failure mode — the
// recurring mistake a durable lesson repairs — and, for FREE plumbing dry-runs,
// a `cold` (buggy) and `fixed` reference solution so we can validate the grader
// without spending a single LLM token.

export const TASKS = [
  {
    id: "sum-list", failureMode: "edge-empty",
    spec: "Write `solve(nums)` returning the sum of a list of integers. Return 0 for an empty list.",
    check: `from solution import solve
assert solve([1,2,3]) == 6
assert solve([]) == 0
assert solve([-2,2]) == 0`,
    cold: "def solve(nums):\n    return nums[0] + sum(nums[1:])",       // IndexError on []
    fixed: "def solve(nums):\n    return sum(nums)",
  },
  {
    id: "parse-total", failureMode: "type-coercion",
    spec: "Write `solve(rows)` where rows is a list of string amounts like '12','8'. Return their numeric sum.",
    check: `from solution import solve
assert solve(['12','8']) == 20
assert solve([]) == 0
assert solve(['3','3','4']) == 10`,
    cold: "def solve(rows):\n    return sum(rows)",                     // TypeError: str + int
    fixed: "def solve(rows):\n    return sum(int(r) for r in rows)",
  },
  {
    id: "last-item", failureMode: "off-by-one",
    spec: "Write `solve(items)` returning the last element, or None if empty.",
    check: `from solution import solve
assert solve([1,2,3]) == 3
assert solve([]) is None
assert solve(['a']) == 'a'`,
    cold: "def solve(items):\n    return items[len(items)-2] if items else None",  // off-by-one
    fixed: "def solve(items):\n    return items[-1] if items else None",
  },
  {
    id: "safe-field", failureMode: "null-fields",
    spec: "Write `solve(order)` returning order['qty'] as an int, defaulting to 1 if the key is missing or None.",
    check: `from solution import solve
assert solve({'qty': 3}) == 3
assert solve({}) == 1
assert solve({'qty': None}) == 1`,
    cold: "def solve(order):\n    return int(order['qty'])",           // KeyError / None
    fixed: "def solve(order):\n    v = order.get('qty')\n    return 1 if v is None else int(v)",
  },
  {
    id: "money-round", failureMode: "precision",
    spec: "Write `solve(cents)` that takes an integer number of cents and returns a dollars string like '1.05'.",
    check: `from solution import solve
assert solve(105) == '1.05'
assert solve(100) == '1.00'
assert solve(9) == '0.09'`,
    cold: "def solve(cents):\n    return str(cents/100)",              // 1.05 -> '1.05' but 100 -> '1.0'
    fixed: "def solve(cents):\n    return f'{cents//100}.{cents%100:02d}'",
  },
  {
    id: "dedupe-keep-order", failureMode: "edge-empty",
    spec: "Write `solve(xs)` returning the list with duplicates removed, preserving first-seen order. Empty in → empty out.",
    check: `from solution import solve
assert solve([1,1,2,3,2]) == [1,2,3]
assert solve([]) == []
assert solve(['a','a']) == ['a']`,
    cold: "def solve(xs):\n    return list(set(xs))",                  // loses order
    fixed: "def solve(xs):\n    seen=[]\n    for x in xs:\n        if x not in seen: seen.append(x)\n    return seen",
  },
];
