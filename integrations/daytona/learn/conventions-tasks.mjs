// HARD tasks for a live agent — the ones with headroom to learn.
//
// A strong model (codex) aces the easy tasks at baseline (100%), so there is
// nothing to learn. Real learning shows up only at the model's failure frontier.
// These tasks put it there: the spec is deliberately UNDERSPECIFIED on one point,
// and the hidden test enforces a specific CONVENTION the model can't infer. Cold,
// the model guesses (and often guesses wrong); once the lesson reveals the
// convention, it complies. That is exactly how an agent learns a codebase's
// implicit rules from its own mistakes — the honest version of continual learning.
//
// Same shape as codegen-tasks: {id, mode, split, spec, check, cold, fixed}.

export const TASKS = [
  // ---- empty → None, never raise ----
  { id: "max-empty", mode: "empty-none", split: "train",
    spec: "solve(items) → the maximum item in the list.",
    check: "from solution import solve\nassert solve([3,1,2])==3\nassert solve([])is None",
    cold: "def solve(i):\n    return max(i)",
    fixed: "def solve(i):\n    return max(i) if i else None" },
  { id: "min-empty", mode: "empty-none", split: "holdout",
    spec: "solve(items) → the minimum item in the list.",
    check: "from solution import solve\nassert solve([3,1,2])==1\nassert solve([])is None",
    cold: "def solve(i):\n    return min(i)",
    fixed: "def solve(i):\n    return min(i) if i else None" },
  { id: "first-empty", mode: "empty-none", split: "holdout",
    spec: "solve(items) → the first item in the list.",
    check: "from solution import solve\nassert solve([5,6])==5\nassert solve([])is None",
    cold: "def solve(i):\n    return i[0]",
    fixed: "def solve(i):\n    return i[0] if i else None" },

  // ---- parse failure → None, never raise ----
  { id: "parse-int", mode: "parse-none", split: "train",
    spec: "solve(s) → the integer value of string s.",
    check: "from solution import solve\nassert solve('12')==12\nassert solve('abc')is None\nassert solve('')is None",
    cold: "def solve(s):\n    return int(s)",
    fixed: "def solve(s):\n    try:\n        return int(s)\n    except (ValueError, TypeError):\n        return None" },
  { id: "parse-float", mode: "parse-none", split: "holdout",
    spec: "solve(s) → the float value of string s.",
    check: "from solution import solve\nassert solve('1.5')==1.5\nassert solve('x')is None",
    cold: "def solve(s):\n    return float(s)",
    fixed: "def solve(s):\n    try:\n        return float(s)\n    except (ValueError, TypeError):\n        return None" },

  // ---- unique values → SORTED ascending ----
  { id: "unique-sorted", mode: "sorted-unique", split: "train",
    spec: "solve(xs) → the unique values from the list.",
    check: "from solution import solve\nassert solve([3,1,2,1])==[1,2,3]\nassert solve([])==[]",
    cold: "def solve(x):\n    out=[]\n    for v in x:\n        if v not in out: out.append(v)\n    return out",
    fixed: "def solve(x):\n    return sorted(set(x))" },
  { id: "unique-sorted-2", mode: "sorted-unique", split: "holdout",
    spec: "solve(words) → the unique words from the list.",
    check: "from solution import solve\nassert solve(['b','a','b'])==['a','b']",
    cold: "def solve(w):\n    out=[]\n    for v in w:\n        if v not in out: out.append(v)\n    return out",
    fixed: "def solve(w):\n    return sorted(set(w))" },

  // ---- integer ranges are INCLUSIVE of both endpoints ----
  { id: "range-incl", mode: "inclusive-range", split: "train",
    spec: "solve(lo, hi) → the list of integers from lo to hi.",
    check: "from solution import solve\nassert solve(1,3)==[1,2,3]\nassert solve(5,5)==[5]",
    cold: "def solve(a,b):\n    return list(range(a,b))",
    fixed: "def solve(a,b):\n    return list(range(a,b+1))" },
  { id: "range-incl-2", mode: "inclusive-range", split: "holdout",
    spec: "solve(lo, hi) → the count of integers from lo to hi.",
    check: "from solution import solve\nassert solve(1,3)==3\nassert solve(4,4)==1",
    cold: "def solve(a,b):\n    return b-a",
    fixed: "def solve(a,b):\n    return b-a+1" },

  // ---- dates as zero-padded ISO YYYY-MM-DD ----
  { id: "iso-date", mode: "iso-date", split: "train",
    spec: "solve(y, m, d) → the date as a string.",
    check: "from solution import solve\nassert solve(2026,7,3)=='2026-07-03'\nassert solve(2026,12,25)=='2026-12-25'",
    cold: "def solve(y,m,d):\n    return f'{y}-{m}-{d}'",
    fixed: "def solve(y,m,d):\n    return f'{y:04d}-{m:02d}-{d:02d}'" },
  { id: "iso-date-2", mode: "iso-date", split: "holdout",
    spec: "solve(y, m) → the year-month as a string.",
    check: "from solution import solve\nassert solve(2026,7)=='2026-07'\nassert solve(2026,11)=='2026-11'",
    cold: "def solve(y,m):\n    return f'{y}-{m}'",
    fixed: "def solve(y,m):\n    return f'{y:04d}-{m:02d}'" },

  // ---- percentages rounded to exactly 2 decimals ----
  { id: "pct-2dp", mode: "round-2dp", split: "train",
    spec: "solve(part, whole) → part/whole as a percentage number.",
    check: "from solution import solve\nassert solve(1,3)==33.33\nassert solve(1,8)==12.5",
    cold: "def solve(p,w):\n    return p/w*100",
    fixed: "def solve(p,w):\n    return round(p/w*100,2)" },
  { id: "pct-2dp-2", mode: "round-2dp", split: "holdout",
    spec: "solve(a, b) → the ratio a/b as a number.",
    check: "from solution import solve\nassert solve(1,3)==0.33\nassert solve(1,4)==0.25",
    cold: "def solve(a,b):\n    return a/b",
    fixed: "def solve(a,b):\n    return round(a/b,2)" },

  // ---- more tasks per mode → more statistical power (tighter noise floor) ----
  { id: "last-empty", mode: "empty-none", split: "train",
    spec: "solve(items) → the last item in the list.",
    check: "from solution import solve\nassert solve([1,2,3])==3\nassert solve([])is None",
    cold: "def solve(i):\n    return i[-1]",
    fixed: "def solve(i):\n    return i[-1] if i else None" },
  { id: "avg-empty", mode: "empty-none", split: "holdout",
    spec: "solve(nums) → the average of the numbers.",
    check: "from solution import solve\nassert solve([2,4])==3.0\nassert solve([])is None",
    cold: "def solve(n):\n    return sum(n)/len(n)",
    fixed: "def solve(n):\n    return sum(n)/len(n) if n else None" },
  { id: "parse-money", mode: "parse-none", split: "train",
    spec: "solve(s) → the integer number of cents in a dollar string like '1.05'.",
    check: "from solution import solve\nassert solve('1.05')==105\nassert solve('bad')is None",
    cold: "def solve(s):\n    d=float(s)\n    return round(d*100)",
    fixed: "def solve(s):\n    try:\n        return round(float(s)*100)\n    except (ValueError, TypeError):\n        return None" },
  { id: "unique-nums", mode: "sorted-unique", split: "holdout",
    spec: "solve(xs) → the unique numbers from the list.",
    check: "from solution import solve\nassert solve([5,3,5,1])==[1,3,5]\nassert solve([2])==[2]",
    cold: "def solve(x):\n    out=[]\n    for v in x:\n        if v not in out: out.append(v)\n    return out",
    fixed: "def solve(x):\n    return sorted(set(x))" },
  { id: "range-sum", mode: "inclusive-range", split: "holdout",
    spec: "solve(lo, hi) → the sum of all integers from lo to hi.",
    check: "from solution import solve\nassert solve(1,3)==6\nassert solve(5,5)==5",
    cold: "def solve(a,b):\n    return sum(range(a,b))",
    fixed: "def solve(a,b):\n    return sum(range(a,b+1))" },
  { id: "iso-day", mode: "iso-date", split: "train",
    spec: "solve(m, d) → the month-day as a string.",
    check: "from solution import solve\nassert solve(7,3)=='07-03'\nassert solve(12,9)=='12-09'",
    cold: "def solve(m,d):\n    return f'{m}-{d}'",
    fixed: "def solve(m,d):\n    return f'{m:02d}-{d:02d}'" },
  { id: "share-2dp", mode: "round-2dp", split: "holdout",
    spec: "solve(x, total) → x as a fraction of total, as a number.",
    check: "from solution import solve\nassert solve(1,6)==0.17\nassert solve(1,3)==0.33",
    cold: "def solve(x,t):\n    return x/t",
    fixed: "def solve(x,t):\n    return round(x/t,2)" },

  // ---- positions are 1-INDEXED (not Python's 0-indexed) ----
  { id: "nth-item", mode: "one-indexed", split: "train",
    spec: "solve(items, n) → the item at position n.",
    check: "from solution import solve\nassert solve(['a','b','c'],1)=='a'\nassert solve(['a','b','c'],3)=='c'",
    cold: "def solve(i,n):\n    return i[n]",
    fixed: "def solve(i,n):\n    return i[n-1]" },
  { id: "nth-char", mode: "one-indexed", split: "holdout",
    spec: "solve(s, n) → the character at position n.",
    check: "from solution import solve\nassert solve('hello',1)=='h'\nassert solve('hello',5)=='o'",
    cold: "def solve(s,n):\n    return s[n]",
    fixed: "def solve(s,n):\n    return s[n-1]" },
  { id: "nth-line", mode: "one-indexed", split: "holdout",
    spec: "solve(text, n) → line number n of a newline-separated string.",
    check: "from solution import solve\nassert solve('a\\nb\\nc',1)=='a'\nassert solve('a\\nb\\nc',2)=='b'",
    cold: "def solve(t,n):\n    return t.split('\\n')[n]",
    fixed: "def solve(t,n):\n    return t.split('\\n')[n-1]" },

  // ---- out-of-range / negative index → None, never Python wraparound ----
  { id: "at-guard", mode: "range-guard", split: "train",
    spec: "solve(items, i) → the item at index i (0-based), or None if i is out of range.",
    check: "from solution import solve\nassert solve([10,20,30],1)==20\nassert solve([10,20,30],5)is None\nassert solve([10,20,30],-1)is None",
    cold: "def solve(a,i):\n    return a[i]",
    fixed: "def solve(a,i):\n    return a[i] if 0<=i<len(a) else None" },
  { id: "get-guard", mode: "range-guard", split: "holdout",
    spec: "solve(s, i) → character i of string s (0-based), or None if out of range.",
    check: "from solution import solve\nassert solve('abc',0)=='a'\nassert solve('abc',9)is None\nassert solve('abc',-2)is None",
    cold: "def solve(s,i):\n    return s[i]",
    fixed: "def solve(s,i):\n    return s[i] if 0<=i<len(s) else None" },

  // ---- string matching is CASE-INSENSITIVE ----
  { id: "contains-ci", mode: "case-insensitive", split: "train",
    spec: "solve(words, target) → True if target is in the list of words.",
    check: "from solution import solve\nassert solve(['Apple','Pear'],'apple')==True\nassert solve(['Apple'],'PEAR')==False",
    cold: "def solve(w,t):\n    return t in w",
    fixed: "def solve(w,t):\n    return t.lower() in [x.lower() for x in w]" },
  { id: "index-ci", mode: "case-insensitive", split: "holdout",
    spec: "solve(words, target) → the index of target in words, or -1 if absent.",
    check: "from solution import solve\nassert solve(['Cat','Dog'],'dog')==1\nassert solve(['Cat'],'CAT')==0\nassert solve(['Cat'],'x')==-1",
    cold: "def solve(w,t):\n    return w.index(t) if t in w else -1",
    fixed: "def solve(w,t):\n    low=[x.lower() for x in w]\n    return low.index(t.lower()) if t.lower() in low else -1" },
];

export const HOLDOUT = TASKS.filter((t) => t.split === "holdout");
export const TRAIN = TASKS.filter((t) => t.split === "train");
