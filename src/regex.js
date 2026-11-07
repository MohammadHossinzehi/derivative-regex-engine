'use strict';
/**
 * Regular expressions by Brzozowski derivatives.
 *
 * Expressions are hash-consed immutable nodes. Smart constructors keep every
 * alternation and intersection in a canonical (flattened, sorted, deduplicated)
 * form, which is exactly the "similarity" Brzozowski needs to guarantee that
 * a regex has finitely many distinct derivatives. That makes the derivative
 * automaton finite, so matching is linear time with no backtracking, and
 * intersection (&) and complement (~) come for free.
 */

const MAX_CP = 0x10ffff;

// ---------------------------------------------------------------- interning

const table = new Map();
let nextId = 0;

function intern(t, fields, key) {
  const k = t + ':' + key;
  let n = table.get(k);
  if (!n) {
    n = Object.freeze({ id: nextId++, t, ...fields });
    table.set(k, n);
  }
  return n;
}

function internedCount() {
  return table.size;
}

// --------------------------------------------------------------- range helpers

function normRanges(rs) {
  const sorted = rs.filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) {
      if (b > last[1]) last[1] = b;
    } else {
      out.push([a, b]);
    }
  }
  return out;
}

function negRanges(rs) {
  const out = [];
  let p = 0;
  for (const [a, b] of normRanges(rs)) {
    if (a > p) out.push([p, a - 1]);
    p = b + 1;
  }
  if (p <= MAX_CP) out.push([p, MAX_CP]);
  return out;
}

function inRanges(ranges, c) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid];
    if (c < a) hi = mid - 1;
    else if (c > b) lo = mid + 1;
    else return true;
  }
  return false;
}

// ------------------------------------------------------ smart constructors

const EMPTY = intern('empty', {}, '');
const EPS = intern('eps', {}, '');

function set(rs) {
  const ranges = normRanges(rs);
  if (ranges.length === 0) return EMPTY;
  return intern('set', { ranges }, ranges.map((r) => r[0] + '-' + r[1]).join(','));
}

function not(a) {
  if (a.t === 'not') return a.a;
  return intern('not', { a }, String(a.id));
}

const UNIVERSAL = not(EMPTY); // all strings

function cat(a, b) {
  if (a === EMPTY || b === EMPTY) return EMPTY;
  if (a === EPS) return b;
  if (b === EPS) return a;
  if (a.t === 'cat') return cat(a.a, cat(a.b, b)); // right-associate
  return intern('cat', { a, b }, a.id + ',' + b.id);
}

function alt(xs) {
  const ranges = [];
  const rest = new Map();
  const stack = [...xs];
  while (stack.length) {
    const x = stack.pop();
    if (x === EMPTY) continue;
    if (x === UNIVERSAL) return UNIVERSAL;
    if (x.t === 'alt') stack.push(...x.xs);
    else if (x.t === 'set') ranges.push(...x.ranges);
    else rest.set(x.id, x);
  }
  const items = [...rest.values()];
  if (ranges.length) items.push(set(ranges));
  items.sort((p, q) => p.id - q.id);
  if (items.length === 0) return EMPTY;
  if (items.length === 1) return items[0];
  return intern('alt', { xs: items }, items.map((i) => i.id).join(','));
}

function and(xs) {
  const rest = new Map();
  const stack = [...xs];
  while (stack.length) {
    const x = stack.pop();
    if (x === EMPTY) return EMPTY;
    if (x === UNIVERSAL) continue;
    if (x.t === 'and') stack.push(...x.xs);
    else rest.set(x.id, x);
  }
  const items = [...rest.values()].sort((p, q) => p.id - q.id);
  if (items.length === 0) return UNIVERSAL;
  if (items.length === 1) return items[0];
  return intern('and', { xs: items }, items.map((i) => i.id).join(','));
}

function star(a) {
  if (a === EMPTY || a === EPS) return EPS;
  if (a.t === 'star') return a;
  return intern('star', { a }, String(a.id));
}

function repeat(r, m, n) {
  if (n !== Infinity && n < m) throw new SyntaxError(`bad repetition {${m},${n}}`);
  if (m > 1000 || (n !== Infinity && n > 1000)) throw new SyntaxError('repetition count too large (max 1000)');
  let out;
  if (n === Infinity) {
    out = star(r);
  } else {
    out = EPS;
    for (let k = 0; k < n - m; k++) out = alt([EPS, cat(r, out)]);
  }
  for (let k = 0; k < m; k++) out = cat(r, out);
  return out;
}

// ------------------------------------------------- nullability, derivatives

const nullMemo = new Map();

function nullable(n) {
  let v = nullMemo.get(n.id);
  if (v !== undefined) return v;
  switch (n.t) {
    case 'eps':
    case 'star':
      v = true;
      break;
    case 'cat':
      v = nullable(n.a) && nullable(n.b);
      break;
    case 'alt':
      v = n.xs.some(nullable);
      break;
    case 'and':
      v = n.xs.every(nullable);
      break;
    case 'not':
      v = !nullable(n.a);
      break;
    default:
      v = false; // empty, set
  }
  nullMemo.set(n.id, v);
  return v;
}

const derivMemo = new Map();

/** Brzozowski derivative of n with respect to code point c. */
function deriv(n, c) {
  const key = n.id * 1114112 + c;
  let d = derivMemo.get(key);
  if (d !== undefined) return d;
  switch (n.t) {
    case 'set':
      d = inRanges(n.ranges, c) ? EPS : EMPTY;
      break;
    case 'cat': {
      const left = cat(deriv(n.a, c), n.b);
      d = nullable(n.a) ? alt([left, deriv(n.b, c)]) : left;
      break;
    }
    case 'alt':
      d = alt(n.xs.map((x) => deriv(x, c)));
      break;
    case 'and':
      d = and(n.xs.map((x) => deriv(x, c)));
      break;
    case 'star':
      d = cat(deriv(n.a, c), n);
      break;
    case 'not':
      d = not(deriv(n.a, c));
      break;
    default:
      d = EMPTY; // empty, eps
  }
  derivMemo.set(key, d);
  return d;
}

// ------------------------------------------------------------------ parser

const SPACE = [[9, 13], [32, 32]];
const DIGIT = [[48, 57]];
const WORD = [[48, 57], [65, 90], [95, 95], [97, 122]];

function classEscape(ch) {
  switch (ch) {
    case 'd': return DIGIT;
    case 'D': return negRanges(DIGIT);
    case 'w': return WORD;
    case 'W': return negRanges(WORD);
    case 's': return SPACE;
    case 'S': return negRanges(SPACE);
    default: return null;
  }
}

const SIMPLE_ESCAPES = { n: 10, t: 9, r: 13, f: 12, v: 11, 0: 0 };

/**
 * Grammar (lowest to highest precedence):
 *   alt     := and ('|' and)*
 *   and     := cat ('&' cat)*          intersection
 *   cat     := unary*
 *   unary   := '~' unary | postfix     complement (so ~a* is ~(a*))
 *   postfix := atom ('*' | '+' | '?' | '{m}' | '{m,}' | '{m,n}')*
 *   atom    := '(' alt ')' | '[' class ']' | '.' | '\' escape | literal
 */
function parse(src) {
  const cps = Array.from(src, (c) => c.codePointAt(0));
  let i = 0;
  const code = (s) => s.codePointAt(0);
  const peekIs = (s) => i < cps.length && cps[i] === code(s);
  const fail = (msg) => {
    throw new SyntaxError(`${msg} at position ${i} in /${src}/`);
  };

  function parseAlt() {
    const xs = [parseAnd()];
    while (peekIs('|')) {
      i++;
      xs.push(parseAnd());
    }
    return xs.length === 1 ? xs[0] : alt(xs);
  }

  function parseAnd() {
    const xs = [parseCat()];
    while (peekIs('&')) {
      i++;
      xs.push(parseCat());
    }
    return xs.length === 1 ? xs[0] : and(xs);
  }

  function parseCat() {
    let r = EPS;
    while (i < cps.length && !peekIs('|') && !peekIs('&') && !peekIs(')')) {
      r = cat(r, parseUnary());
    }
    return r;
  }

  function parseUnary() {
    if (peekIs('~')) {
      i++;
      return not(parseUnary());
    }
    return parsePostfix();
  }

  function parseInt10() {
    const start = i;
    let v = 0;
    while (i < cps.length && cps[i] >= 48 && cps[i] <= 57) v = v * 10 + (cps[i++] - 48);
    if (i === start) fail('expected a number');
    return v;
  }

  function parsePostfix() {
    let r = parseAtom();
    for (;;) {
      if (peekIs('*')) {
        i++;
        r = star(r);
      } else if (peekIs('+')) {
        i++;
        r = cat(r, star(r));
      } else if (peekIs('?')) {
        i++;
        r = alt([EPS, r]);
      } else if (peekIs('{')) {
        i++;
        const m = parseInt10();
        let n = m;
        if (peekIs(',')) {
          i++;
          n = peekIs('}') ? Infinity : parseInt10();
        }
        if (!peekIs('}')) fail("expected '}'");
        i++;
        r = repeat(r, m, n);
      } else {
        return r;
      }
    }
  }

  function parseEscape() {
    // called with i just past the backslash
    if (i >= cps.length) fail('dangling backslash');
    const ch = String.fromCodePoint(cps[i++]);
    const cls = classEscape(ch);
    if (cls) return { ranges: cls };
    if (Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, ch)) return { cp: SIMPLE_ESCAPES[ch] };
    return { cp: code(ch) };
  }

  function parseClass() {
    // called with i just past '['
    let negate = false;
    if (peekIs('^')) {
      negate = true;
      i++;
    }
    let ranges = [];
    while (!peekIs(']')) {
      if (i >= cps.length) fail("unterminated '['");
      let lo;
      if (peekIs('\\')) {
        i++;
        const e = parseEscape();
        if (e.ranges) {
          ranges.push(...e.ranges);
          continue;
        }
        lo = e.cp;
      } else {
        lo = cps[i++];
      }
      if (peekIs('-') && i + 1 < cps.length && cps[i + 1] !== code(']')) {
        i++;
        let hi;
        if (peekIs('\\')) {
          i++;
          const e = parseEscape();
          if (e.ranges) fail('bad range end');
          hi = e.cp;
        } else {
          hi = cps[i++];
        }
        if (hi < lo) fail('range out of order');
        ranges.push([lo, hi]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    i++; // ']'
    return set(negate ? negRanges(ranges) : ranges);
  }

  function parseAtom() {
    if (i >= cps.length) fail('unexpected end of pattern');
    const c = cps[i];
    if (c === code('(')) {
      i++;
      const r = parseAlt();
      if (!peekIs(')')) fail("missing ')'");
      i++;
      return r;
    }
    if (c === code('[')) {
      i++;
      return parseClass();
    }
    if (c === code('.')) {
      i++;
      return set([[0, MAX_CP]]);
    }
    if (c === code('\\')) {
      i++;
      const e = parseEscape();
      return e.ranges ? set(e.ranges) : set([[e.cp, e.cp]]);
    }
    if (c === code('*') || c === code('+') || c === code('?') || c === code('{')) {
      fail('nothing to repeat');
    }
    i++;
    return set([[c, c]]);
  }

  const result = parseAlt();
  if (i < cps.length) fail("unmatched ')'");
  return result;
}

// ------------------------------------------------------------- pretty print

function showCp(c) {
  if (c >= 0x20 && c < 0x7f) {
    const ch = String.fromCharCode(c);
    return '\\.[]()*+?{}|&~^-'.includes(ch) ? '\\' + ch : ch;
  }
  return '\\u{' + c.toString(16) + '}';
}

function show(n, prec = 0) {
  // prec: 0 top, 1 inside and, 2 inside cat, 3 inside postfix
  const wrap = (s, need) => (need ? '(' + s + ')' : s);
  switch (n.t) {
    case 'empty': return '[]';
    case 'eps': return '()';
    case 'set': {
      const { ranges } = n;
      if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === MAX_CP) return '.';
      if (ranges.length === 1 && ranges[0][0] === ranges[0][1]) return showCp(ranges[0][0]);
      return '[' + ranges.map(([a, b]) => (a === b ? showCp(a) : showCp(a) + '-' + showCp(b))).join('') + ']';
    }
    case 'cat': return wrap(show(n.a, 2) + show(n.b, 2), prec > 2);
    case 'alt': return wrap(n.xs.map((x) => show(x, 1)).join('|'), prec > 0);
    case 'and': return wrap(n.xs.map((x) => show(x, 2)).join('&'), prec > 1);
    case 'star': return show(n.a, 3) + '*';
    case 'not': return '~' + show(n.a, 3);
    default: return '?';
  }
}

// -------------------------------------------------------- alphabet classes

function collectBoundaries(n, acc, seen) {
  if (seen.has(n.id)) return;
  seen.add(n.id);
  if (n.t === 'set') {
    for (const [a, b] of n.ranges) {
      acc.add(a);
      acc.add(b + 1);
    }
  } else if (n.t === 'cat') {
    collectBoundaries(n.a, acc, seen);
    collectBoundaries(n.b, acc, seen);
  } else if (n.t === 'alt' || n.t === 'and') {
    for (const x of n.xs) collectBoundaries(x, acc, seen);
  } else if (n.t === 'star' || n.t === 'not') {
    collectBoundaries(n.a, acc, seen);
  }
}

/** Partition of the code point space into ranges that no set in `nodes` can tell apart. */
function alphabetClasses(nodes) {
  const acc = new Set([0]);
  const seen = new Set();
  for (const n of nodes) collectBoundaries(n, acc, seen);
  const bs = [...acc].filter((x) => x <= MAX_CP).sort((a, b) => a - b);
  return bs.map((lo, k) => [lo, k + 1 < bs.length ? bs[k + 1] - 1 : MAX_CP]);
}

// ------------------------------------------------------------ DFA building

/**
 * Explicit DFA whose states are derivative classes of `node`.
 * Transitions are over alphabet classes, not individual code points.
 */
function buildDFA(node, { maxStates = 100000 } = {}) {
  const classes = alphabetClasses([node]);
  const index = new Map([[node.id, 0]]);
  const states = [node];
  const trans = [];
  for (let q = 0; q < states.length; q++) {
    const row = new Int32Array(classes.length);
    for (let k = 0; k < classes.length; k++) {
      const d = deriv(states[q], classes[k][0]);
      let j = index.get(d.id);
      if (j === undefined) {
        if (states.length >= maxStates) throw new RangeError(`DFA exceeds ${maxStates} states`);
        j = states.length;
        index.set(d.id, j);
        states.push(d);
      }
      row[k] = j;
    }
    trans.push(row);
  }
  return { classes, states, trans, accept: states.map(nullable), start: 0 };
}

/** Moore partition refinement. Returns a new DFA with the minimum number of states. */
function minimize(dfa) {
  const n = dfa.trans.length;
  const k = dfa.classes.length;
  let part = dfa.accept.map((a) => (a ? 1 : 0));
  let count = new Set(part).size;
  for (;;) {
    const sig = new Map();
    const next = new Array(n);
    for (let q = 0; q < n; q++) {
      const key = part[q] + ':' + Array.from(dfa.trans[q], (t) => part[t]).join(',');
      let id = sig.get(key);
      if (id === undefined) {
        id = sig.size;
        sig.set(key, id);
      }
      next[q] = id;
    }
    part = next;
    if (sig.size === count) break;
    count = sig.size;
  }
  const rep = new Map();
  for (let q = 0; q < n; q++) if (!rep.has(part[q])) rep.set(part[q], q);
  const order = new Map([[part[dfa.start], 0]]);
  const queue = [part[dfa.start]];
  const trans = [];
  const accept = [];
  for (let h = 0; h < queue.length; h++) {
    const q = rep.get(queue[h]);
    accept.push(dfa.accept[q]);
    const row = new Int32Array(k);
    for (let c = 0; c < k; c++) {
      const tb = part[dfa.trans[q][c]];
      let id = order.get(tb);
      if (id === undefined) {
        id = queue.length;
        order.set(tb, id);
        queue.push(tb);
      }
      row[c] = id;
    }
    trans.push(row);
  }
  return { classes: dfa.classes, trans, accept, start: 0 };
}

function classIndex(classes, c) {
  let lo = 0;
  let hi = classes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (classes[mid][0] <= c) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function runDFA(dfa, s) {
  let q = dfa.start;
  for (const ch of s) q = dfa.trans[q][classIndex(dfa.classes, ch.codePointAt(0))];
  return dfa.accept[q];
}

// ------------------------------------------------------ language analysis

function pickRepresentative(lo, hi) {
  if (hi >= 0x20 && lo <= 0x7e) return Math.max(lo, 0x20); // prefer printable ASCII
  return lo;
}

/** Shortest string in the language (smallest by class order among ties), or null if empty. */
function witness(node) {
  if (nullable(node)) return '';
  const classes = alphabetClasses([node]);
  const nodes = [node];
  const parent = [-1];
  const via = [0];
  const seen = new Set([node.id]);
  for (let q = 0; q < nodes.length; q++) {
    for (const [lo, hi] of classes) {
      const c = pickRepresentative(lo, hi);
      const d = deriv(nodes[q], c);
      if (seen.has(d.id) || d === EMPTY) continue;
      seen.add(d.id);
      nodes.push(d);
      parent.push(q);
      via.push(c);
      if (nullable(d)) {
        const out = [];
        for (let x = nodes.length - 1; x > 0; x = parent[x]) out.push(via[x]);
        return String.fromCodePoint(...out.reverse());
      }
    }
  }
  return null;
}

/** Decide L(a) = L(b). When they differ, returns a shortest string in the symmetric difference. */
function equivalent(a, b) {
  const diff = alt([and([a, not(b)]), and([not(a), b])]);
  const w = witness(diff);
  if (w === null) return { equivalent: true, counterexample: null };
  return { equivalent: false, counterexample: w, inFirst: matchNode(a, w) };
}

/** Decide L(a) is a subset of L(b). */
function subset(a, b) {
  const w = witness(and([a, not(b)]));
  return { subset: w === null, counterexample: w };
}

/** Number of strings of exactly length n in the language (over all Unicode code points). */
function countStrings(node, n) {
  const dfa = buildDFA(node);
  const widths = dfa.classes.map(([lo, hi]) => BigInt(hi - lo + 1));
  let cur = new Array(dfa.trans.length).fill(0n);
  cur[0] = 1n;
  for (let step = 0; step < n; step++) {
    const nxt = new Array(cur.length).fill(0n);
    for (let q = 0; q < cur.length; q++) {
      if (cur[q] === 0n) continue;
      for (let c = 0; c < widths.length; c++) nxt[dfa.trans[q][c]] += cur[q] * widths[c];
    }
    cur = nxt;
  }
  return cur.reduce((sum, v, q) => (dfa.accept[q] ? sum + v : sum), 0n);
}

// ---------------------------------------------------------------- matching

function matchNode(node, s) {
  let q = node;
  for (const ch of s) {
    q = deriv(q, ch.codePointAt(0));
    if (q === EMPTY) return false;
  }
  return nullable(q);
}

function toCodePoints(s) {
  const cps = [];
  const offs = [];
  for (let u = 0; u < s.length; ) {
    const cp = s.codePointAt(u);
    cps.push(cp);
    offs.push(u);
    u += cp > 0xffff ? 2 : 1;
  }
  offs.push(s.length);
  return { cps, offs };
}

class Regex {
  constructor(pattern) {
    this.pattern = pattern;
    this.node = parse(pattern);
  }

  /** Full-string match. */
  matches(s) {
    return matchNode(this.node, s);
  }

  /** Leftmost-longest match at or after code unit offset `from`, or null. */
  search(s, from = 0) {
    const { cps, offs } = toCodePoints(s);
    let start = 0;
    while (start < cps.length && offs[start] < from) start++;
    for (; start <= cps.length; start++) {
      let q = this.node;
      let best = nullable(q) ? start : -1;
      for (let e = start; e < cps.length && q !== EMPTY; e++) {
        q = deriv(q, cps[e]);
        if (nullable(q)) best = e + 1;
      }
      if (best >= 0) {
        return { index: offs[start], end: offs[best], match: s.slice(offs[start], offs[best]) };
      }
    }
    return null;
  }

  /** All non-overlapping leftmost-longest matches. */
  findAll(s) {
    const out = [];
    let from = 0;
    while (from <= s.length) {
      const m = this.search(s, from);
      if (!m) break;
      out.push(m);
      from = m.end > m.index ? m.end : m.end + (s.codePointAt(m.end) > 0xffff ? 2 : 1);
    }
    return out;
  }

  dfa() {
    return buildDFA(this.node);
  }

  minimalDFA() {
    return minimize(buildDFA(this.node));
  }

  shortestMatch() {
    return witness(this.node);
  }

  isEmpty() {
    return witness(this.node) === null;
  }

  equivalentTo(other) {
    return equivalent(this.node, other.node);
  }

  subsetOf(other) {
    return subset(this.node, other.node);
  }

  count(n) {
    return countStrings(this.node, n);
  }

  toString() {
    return show(this.node);
  }
}

module.exports = {
  Regex,
  parse,
  show,
  nullable,
  deriv,
  buildDFA,
  minimize,
  runDFA,
  witness,
  equivalent,
  subset,
  countStrings,
  internedCount,
};
