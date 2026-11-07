'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Regex, parse, show, deriv } = require('../src/regex');

const re = (p) => new Regex(p);

test('basic matching', () => {
  const cases = [
    ['abc', 'abc', true],
    ['abc', 'ab', false],
    ['a*', '', true],
    ['a+', '', false],
    ['a?b', 'b', true],
    ['a|bc', 'bc', true],
    ['a|bc', 'abc', false],
    ['[a-c]+', 'abcabc', true],
    ['[^a-c]+', 'abc', false],
    ['[^a-c]+', 'xyz', true],
    ['\\d+\\.\\d+', '3.14', true],
    ['\\d+\\.\\d+', '3x14', false],
    ['\\w+@\\w+\\.com', 'bob@site.com', true],
    ['a.c', 'a\nc', true],
    ['', '', true],
    ['', 'a', false],
    ['\\(x\\)', '(x)', true],
    ['[]', '', false],
    ['[^]', 'z', true],
  ];
  for (const [p, s, want] of cases) assert.equal(re(p).matches(s), want, `/${p}/ on ${JSON.stringify(s)}`);
});

test('counted repetition', () => {
  assert.ok(re('a{3}').matches('aaa'));
  assert.ok(!re('a{3}').matches('aa'));
  assert.ok(re('a{2,4}').matches('aaaa'));
  assert.ok(!re('a{2,4}').matches('aaaaa'));
  assert.ok(re('a{2,}').matches('a'.repeat(50)));
  assert.ok(!re('a{2,}').matches('a'));
  assert.ok(re('(ab){0,2}').matches(''));
  assert.throws(() => re('a{3,2}'), SyntaxError);
  assert.throws(() => re('a{5000}'), SyntaxError);
});

test('intersection and complement', () => {
  // strings over a,b containing "ab" but not ending in "b"
  const r = re('[ab]*ab[ab]*&~([ab]*b)');
  assert.ok(r.matches('aba'));
  assert.ok(r.matches('abaa'));
  assert.ok(!r.matches('ab'));
  assert.ok(!r.matches('baa'));
  // complement of everything is empty, complement of empty is everything
  assert.ok(re('~.*').isEmpty());
  assert.ok(re('~[]').matches('anything at all'));
  // precedence: ~a* means ~(a*)
  assert.ok(!re('~a*').matches('aaa'));
  assert.ok(re('~a*').matches('b'));
  // password-style policy as an intersection of simple constraints
  const policy = re('.{8,}&.*\\d.*&.*[a-z].*&.*[A-Z].*');
  assert.ok(policy.matches('Passw0rdX'));
  assert.ok(!policy.matches('password1'));
  assert.ok(!policy.matches('Sh0rt'));
});

test('derivatives are normalised', () => {
  const abc = parse('abc');
  assert.equal(show(deriv(abc, 97)), 'bc');
  assert.equal(show(deriv(deriv(abc, 97), 98)), 'c');
  assert.equal(deriv(abc, 98), parse('[]')); // dead state is the canonical EMPTY node
  // alternation is flattened, sorted and deduplicated, so these are the same node
  assert.equal(parse('a|b|a'), parse('b|a'));
  assert.equal(parse('(a|b)|c'), parse('a|(b|c)'));
  assert.equal(parse('[ab]'), parse('a|b'));
  assert.equal(parse('a**'), parse('a*'));
  assert.equal(parse('~~a'), parse('a'));
});

test('minimal DFA of (a|b)*abb', () => {
  const r = re('(a|b)*abb');
  const full = r.dfa();
  const min = r.minimalDFA();
  // classic 4-state automaton plus one dead state for characters outside {a,b}
  assert.equal(min.trans.length, 5);
  assert.ok(full.trans.length >= min.trans.length);
  const { runDFA } = require('../src/regex');
  for (const s of ['abb', 'aabb', 'babb', 'ab', 'abba', '', 'abbc', 'bbabb']) {
    assert.equal(runDFA(min, s), r.matches(s), s);
    assert.equal(runDFA(full, s), r.matches(s), s);
  }
});

test('minimization collapses redundant structure', () => {
  assert.equal(re('(a|b)*').minimalDFA().trans.length, 2); // accept loop + dead
  assert.equal(re('a*a*a*').minimalDFA().trans.length, 2);
  assert.equal(re('(aa)*').minimalDFA().trans.length, 3);
});

test('language equivalence', () => {
  const eq = (p, q) => re(p).equivalentTo(re(q));
  assert.ok(eq('(a|b)*', '(a*b*)*').equivalent);
  assert.ok(eq('a(ba)*', '(ab)*a').equivalent);
  assert.ok(eq('~(a|b)', '~a&~b|~a&~b').equivalent);
  assert.ok(eq('~(a|b)', '~a&~b').equivalent); // De Morgan
  assert.ok(eq('~(a&b)', '~a|~b').equivalent);
  const r = eq('a*', 'a+');
  assert.equal(r.equivalent, false);
  assert.equal(r.counterexample, '');
  const r2 = eq('(ab)*', '(ab)*(ab)?');
  assert.ok(r2.equivalent);
  const r3 = eq('(ab)*', '(ab)*a?');
  assert.equal(r3.equivalent, false);
  assert.equal(r3.counterexample, 'a');
  assert.equal(r3.inFirst, false);
});

test('subset', () => {
  assert.ok(re('a+').subsetOf(re('a*')).subset);
  const r = re('a*').subsetOf(re('a+'));
  assert.equal(r.subset, false);
  assert.equal(r.counterexample, '');
});

test('shortest witnesses', () => {
  assert.equal(re('a{2,3}').shortestMatch(), 'aa');
  assert.equal(re('b*').shortestMatch(), '');
  assert.equal(re('[a-c]{3}x').shortestMatch(), 'aaax');
  assert.equal(re('a&b').shortestMatch(), null);
  assert.ok(re('a&b').isEmpty());
  assert.equal(re('~(a*)').shortestMatch().length, 1);
  assert.equal(re('.{3}').shortestMatch().length, 3);
});

test('counting strings of a given length', () => {
  assert.equal(re('[ab]{3}').count(3), 8n);
  assert.equal(re('[ab]*').count(10), 1024n);
  assert.equal(re('.').count(1), 1114112n);
  // binary strings with no two consecutive a's: Fibonacci numbers
  const noAA = re('[ab]*&~(.*aa.*)');
  assert.deepEqual([0, 1, 2, 3, 4, 10].map((n) => noAA.count(n)), [1n, 2n, 3n, 5n, 8n, 144n]);
  // exact big arithmetic
  assert.equal(re('[ab]*').count(100), 2n ** 100n);
});

test('search and findAll (leftmost-longest)', () => {
  assert.deepEqual(re('a+').search('baaac'), { index: 1, end: 4, match: 'aaa' });
  assert.equal(re('x').search('abc'), null);
  assert.deepEqual(
    re('\\d+').findAll('a12b345c6').map((m) => m.match),
    ['12', '345', '6']
  );
  // leftmost-longest differs from Perl-style leftmost-first
  assert.equal(re('a|ab').search('ab').match, 'ab');
  // empty matches advance
  assert.equal(re('x*').findAll('abc').length, 4);
  // astral code points are one character
  assert.equal(re('^'.slice(1) + '.').findAll('a\u{1F600}b').length, 3);
});

test('unicode', () => {
  assert.ok(re('.').matches('\u{1F600}'));
  assert.ok(!re('..').matches('\u{1F600}'));
  assert.ok(re('[\u{1F600}-\u{1F64F}]+').matches('\u{1F601}\u{1F602}'));
  assert.ok(re('café').matches('café'));
});

test('syntax errors', () => {
  for (const p of ['(a', 'a)', '*a', 'a|*', '[abc', '[z-a]', 'a\\', 'a{2', 'a{,3}', '+']) {
    assert.throws(() => re(p), SyntaxError, p);
  }
});

test('no catastrophic backtracking', () => {
  const evil = [
    ['(a*)*b', 'a'.repeat(20000)],
    ['(a|aa)+$'.replace('$', 'c'), 'a'.repeat(20000)],
    ['(a+)+(b|c)*d', 'a'.repeat(20000) + 'x'],
    ['(x+x+)+y', 'x'.repeat(20000)],
  ];
  const t0 = Date.now();
  for (const [p, s] of evil) assert.equal(re(p).matches(s), false);
  assert.ok(Date.now() - t0 < 5000, 'pathological patterns must run in linear time');
});

// ---------------------------------------------------------------- fuzzing

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomPattern(rand, depth) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  if (depth <= 0 || rand() < 0.25) {
    return pick(['a', 'b', 'c', '.', '[ab]', '[^a]', '[a-c]', 'a', 'b']);
  }
  switch (Math.floor(rand() * 6)) {
    case 0:
      return randomPattern(rand, depth - 1) + randomPattern(rand, depth - 1);
    case 1:
      return '(' + randomPattern(rand, depth - 1) + '|' + randomPattern(rand, depth - 1) + ')';
    case 2:
      return '(' + randomPattern(rand, depth - 1) + ')*';
    case 3:
      return '(' + randomPattern(rand, depth - 1) + ')+';
    case 4:
      return '(' + randomPattern(rand, depth - 1) + ')?';
    default:
      return '(' + randomPattern(rand, depth - 1) + '){1,3}';
  }
}

test('differential fuzz against the built-in RegExp', () => {
  const rand = rng(12345);
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const p = randomPattern(rand, 4);
    const mine = re(p);
    const theirs = new RegExp('^(?:' + p + ')$', 's');
    for (let j = 0; j < 40; j++) {
      const len = Math.floor(rand() * 8);
      let s = '';
      for (let k = 0; k < len; k++) s += 'abcd'[Math.floor(rand() * 4)];
      assert.equal(mine.matches(s), theirs.test(s), `/${p}/ on ${JSON.stringify(s)}`);
      checked++;
    }
  }
  assert.equal(checked, 16000);
});

test('differential fuzz: minimal DFA agrees with lazy derivative matching', () => {
  const rand = rng(777);
  const { runDFA } = require('../src/regex');
  for (let i = 0; i < 150; i++) {
    const p = randomPattern(rand, 4);
    const r = re(p);
    const min = r.minimalDFA();
    assert.ok(min.trans.length <= r.dfa().trans.length);
    for (let j = 0; j < 30; j++) {
      let s = '';
      for (let k = Math.floor(rand() * 8); k > 0; k--) s += 'abcd'[Math.floor(rand() * 4)];
      assert.equal(runDFA(min, s), r.matches(s), `/${p}/ on ${JSON.stringify(s)}`);
    }
  }
});

test('boolean algebra laws hold on random patterns', () => {
  const rand = rng(4242);
  for (let i = 0; i < 60; i++) {
    const p = randomPattern(rand, 3);
    const q = randomPattern(rand, 3);
    const lhs = re(`~((${p})|(${q}))`);
    const rhs = re(`~(${p})&~(${q})`);
    assert.ok(lhs.equivalentTo(rhs).equivalent, `De Morgan for ${p} , ${q}`);
    assert.ok(re(`~~(${p})`).equivalentTo(re(p)).equivalent);
    assert.ok(re(`(${p})&(${q})`).subsetOf(re(p)).subset);
  }
});
