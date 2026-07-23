// Code-generation tasks for the RL-on-trajectories experiment. Each is a spec the
// agent satisfies by writing `solve(...)` in solution.py, graded by a HIDDEN check
// run in a Daytona sandbox. Each carries a `mode` (the recurring mistake a durable
// lesson repairs) and — for FREE plumbing runs — `cold` (buggy) and `fixed`
// reference solutions so the whole pipeline can run end-to-end on real Daytona
// grading without spending an LLM token.
//
// Modes and their prevalence set up a realistic long tail: null-fields and
// type-coercion are common (big early gains); precision and ordering are rare
// (their gains fall under the noise floor — the honest plateau).

export const TASKS = [
  // ---- null-fields (common) ----
  { id: "safe-qty", mode: "null-fields", split: "train",
    spec: "solve(order) → order['qty'] as int, default 1 if missing or None.",
    check: "from solution import solve\nassert solve({'qty':3})==3\nassert solve({})==1\nassert solve({'qty':None})==1",
    cold: "def solve(o):\n    return int(o['qty'])",
    fixed: "def solve(o):\n    v=o.get('qty')\n    return 1 if v is None else int(v)" },
  { id: "safe-name", mode: "null-fields", split: "holdout",
    spec: "solve(user) → user['name'] stripped, default 'guest' if missing/None/blank.",
    check: "from solution import solve\nassert solve({'name':' Al '})=='Al'\nassert solve({})=='guest'\nassert solve({'name':None})=='guest'\nassert solve({'name':'  '})=='guest'",
    cold: "def solve(u):\n    return u['name'].strip()",
    fixed: "def solve(u):\n    v=u.get('name')\n    v=(v or '').strip()\n    return v if v else 'guest'" },
  { id: "safe-price", mode: "null-fields", split: "train",
    spec: "solve(item) → float(item['price']), default 0.0 if missing or None.",
    check: "from solution import solve\nassert solve({'price':'2.5'})==2.5\nassert solve({})==0.0\nassert solve({'price':None})==0.0",
    cold: "def solve(i):\n    return float(i['price'])",
    fixed: "def solve(i):\n    v=i.get('price')\n    return 0.0 if v is None else float(v)" },
  { id: "safe-tags", mode: "null-fields", split: "holdout",
    spec: "solve(post) → number of tags in post['tags'], default 0 if key missing or None.",
    check: "from solution import solve\nassert solve({'tags':['a','b']})==2\nassert solve({})==0\nassert solve({'tags':None})==0",
    cold: "def solve(p):\n    return len(p['tags'])",
    fixed: "def solve(p):\n    v=p.get('tags')\n    return 0 if v is None else len(v)" },

  // ---- type-coercion (common) ----
  { id: "sum-strings", mode: "type-coercion", split: "train",
    spec: "solve(rows) → numeric sum of a list of string integers like '12','8'.",
    check: "from solution import solve\nassert solve(['12','8'])==20\nassert solve([])==0\nassert solve(['3','3','4'])==10",
    cold: "def solve(r):\n    return sum(r)",
    fixed: "def solve(r):\n    return sum(int(x) for x in r)" },
  { id: "max-string-num", mode: "type-coercion", split: "holdout",
    spec: "solve(vals) → the largest value in a list of numeric strings, as int.",
    check: "from solution import solve\nassert solve(['2','10','7'])==10\nassert solve(['5'])==5",
    cold: "def solve(v):\n    return int(max(v))",
    fixed: "def solve(v):\n    return max(int(x) for x in v)" },
  { id: "avg-scores", mode: "type-coercion", split: "train",
    spec: "solve(scores) → integer average (floor) of a list of numeric strings.",
    check: "from solution import solve\nassert solve(['10','20'])==15\nassert solve(['3','3','4'])==3",
    cold: "def solve(s):\n    return sum(s)//len(s)",
    fixed: "def solve(s):\n    n=[int(x) for x in s]\n    return sum(n)//len(n)" },

  // ---- edge-empty (medium) ----
  { id: "sum-list", mode: "edge-empty", split: "train",
    spec: "solve(nums) → sum of a list of ints; 0 for empty.",
    check: "from solution import solve\nassert solve([1,2,3])==6\nassert solve([])==0\nassert solve([-2,2])==0",
    cold: "def solve(n):\n    return n[0]+sum(n[1:])",
    fixed: "def solve(n):\n    return sum(n)" },
  { id: "first-or-default", mode: "edge-empty", split: "holdout",
    spec: "solve(xs) → first element, or None if empty.",
    check: "from solution import solve\nassert solve([9,8])==9\nassert solve([])is None",
    cold: "def solve(x):\n    return x[0]",
    fixed: "def solve(x):\n    return x[0] if x else None" },
  { id: "mean-safe", mode: "edge-empty", split: "train",
    spec: "solve(nums) → average as float, or 0.0 for empty list.",
    check: "from solution import solve\nassert solve([2,4])==3.0\nassert solve([])==0.0",
    cold: "def solve(n):\n    return sum(n)/len(n)",
    fixed: "def solve(n):\n    return sum(n)/len(n) if n else 0.0" },

  // ---- off-by-one (medium) ----
  { id: "last-item", mode: "off-by-one", split: "holdout",
    spec: "solve(items) → last element, or None if empty.",
    check: "from solution import solve\nassert solve([1,2,3])==3\nassert solve([])is None\nassert solve(['a'])=='a'",
    cold: "def solve(i):\n    return i[len(i)-2] if i else None",
    fixed: "def solve(i):\n    return i[-1] if i else None" },
  { id: "last-n", mode: "off-by-one", split: "train",
    spec: "solve(xs, n) → the last n elements in order.",
    check: "from solution import solve\nassert solve([1,2,3,4],2)==[3,4]\nassert solve([1],3)==[1]",
    cold: "def solve(x,n):\n    return x[len(x)-n+1:]",
    fixed: "def solve(x,n):\n    return x[-n:] if n<=len(x) else x[:]" },

  // ---- precision (rare → gains under the noise floor) ----
  { id: "money-round", mode: "precision", split: "train",
    spec: "solve(cents) → dollars string like '1.05' from an integer number of cents.",
    check: "from solution import solve\nassert solve(105)=='1.05'\nassert solve(100)=='1.00'\nassert solve(9)=='0.09'",
    cold: "def solve(c):\n    return str(c/100)",
    fixed: "def solve(c):\n    return f'{c//100}.{c%100:02d}'" },
  { id: "pct-of", mode: "precision", split: "holdout",
    spec: "solve(part, whole) → percentage rounded to 1 decimal, as a string like '33.3'.",
    check: "from solution import solve\nassert solve(1,3)=='33.3'\nassert solve(1,2)=='50.0'",
    cold: "def solve(p,w):\n    return str(p/w*100)",
    fixed: "def solve(p,w):\n    return f'{round(p/w*100,1):.1f}'" },

  // ---- ordering (rare) ----
  { id: "dedupe-order", mode: "ordering", split: "holdout",
    spec: "solve(xs) → duplicates removed, first-seen order preserved; empty→empty.",
    check: "from solution import solve\nassert solve([1,1,2,3,2])==[1,2,3]\nassert solve([])==[]\nassert solve(['a','a'])==['a']",
    cold: "def solve(x):\n    return list(set(x))",
    fixed: "def solve(x):\n    s=[]\n    for v in x:\n        if v not in s: s.append(v)\n    return s" },

  // ---- easy (no mode — the agent handles these cold) ----
  { id: "double", mode: null, split: "train",
    spec: "solve(n) → n doubled.",
    check: "from solution import solve\nassert solve(4)==8\nassert solve(0)==0\nassert solve(-3)==-6",
    cold: "def solve(n):\n    return n*2",
    fixed: "def solve(n):\n    return n*2" },
  { id: "upper", mode: null, split: "holdout",
    spec: "solve(s) → s uppercased.",
    check: "from solution import solve\nassert solve('hi')=='HI'\nassert solve('')==''",
    cold: "def solve(s):\n    return s.upper()",
    fixed: "def solve(s):\n    return s.upper()" },
];

export const HOLDOUT = TASKS.filter((t) => t.split === "holdout");
export const TRAIN = TASKS.filter((t) => t.split === "train");
