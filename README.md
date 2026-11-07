# derivative-regex-engine

A regular expression engine built on **Brzozowski derivatives**, in zero dependency JavaScript. It never backtracks, so every match runs in linear time. Because derivatives handle boolean operations natively, it also supports **intersection (`&`)** and **complement (`~`)**, which lets you decide whether two patterns describe the same language, find the shortest string a pattern accepts, and count exactly how many strings of length n a pattern matches.

## Why this is interesting

Most engines (including the one in your browser) compile a pattern to a backtracking matcher. Patterns like `(a*)*b` on a long string of `a`s take exponential time, which is the root of ReDoS bugs. The derivative approach is different:

- The derivative of a language L by a character c is the set of suffixes `w` such that `cw` is in L. For a regex it is itself a regex, computed by a few structural rules.
- To match a string, take the derivative once per character, then check whether the final regex accepts the empty string. No backtracking, no stack of choices.
- Brzozowski showed that, if alternations are kept in canonical form (flattened, sorted, deduplicated), a regex has only finitely many distinct derivatives. Those derivatives are the states of a DFA, so the engine is secretly lazily building a DFA as it goes.
- Since a regex is just a state of that DFA, `a & b` and `~a` need only one extra derivative rule each. That makes the language equivalence problem decidable by exploring the product automaton, which is what `equivalentTo` does.

## Features

- Syntax: literals, `.`, classes `[a-z]`, `[^...]`, `\d \w \s \D \W \S`, escapes, groups, `| * + ? {m} {m,} {m,n}`, plus `&` and `~`.
- Full Unicode code point support (`.` matches one code point, astral characters included).
- Hash consed AST with smart constructors that normalise as they build, so equal languages in the same similarity class are the same object.
- Explicit DFA construction over alphabet classes (not 1.1 million individual code points) and Moore partition refinement minimisation.
- Language equivalence and subset checks that return a shortest counterexample.
- `shortestMatch()` and `isEmpty()`.
- Exact counting of the strings of length n in a language, with BigInt.
- Leftmost-longest `search` and `findAll`.
- A small CLI.

## Quick start

Requires Node 18 or newer. There is nothing to install.

```
npm test
node src/cli.js match '(a|b)*abb' 'babb'
node src/cli.js dfa '(a|b)*abb'
node src/cli.js equiv '~(a|b)' '~a&~b'
node src/cli.js equiv 'a*' 'a+'
node src/cli.js example '[a-c]{3}x'
node src/cli.js count '[ab]*&~(.*aa.*)' 20
node src/cli.js search '\d+' 'a12b345c6'
```

Example output:

```
$ node src/cli.js dfa '(a|b)*abb'
derivative DFA: 5 states, 4 alphabet classes
minimal DFA:    5 states

$ node src/cli.js equiv 'a*' 'a+'
not equivalent: "" is in the first language only

$ node src/cli.js count '[ab]*&~(.*aa.*)' 20
17711
```

That last one counts the binary strings of length 20 with no two consecutive `a`s, and 17711 is the Fibonacci number you would expect. The textbook 4 state automaton for `(a|b)*abb` shows up as 5 states here because characters outside `{a,b}` go to an explicit dead state.

## Library use

```js
const { Regex } = require('./src/regex');

const r = new Regex('[ab]*ab[ab]*&~([ab]*b)'); // contains "ab", does not end in b
r.matches('abaa');          // true
r.shortestMatch();          // "aba"

new Regex('(a|b)*').equivalentTo(new Regex('(a*b*)*')); // { equivalent: true, counterexample: null }
new Regex('a+').subsetOf(new Regex('a*'));              // { subset: true, counterexample: null }

new Regex('\\d+').findAll('a12b345c6').map((m) => m.match); // ['12', '345', '6']
new Regex('[ab]*').count(100);                              // 2n ** 100n

const dfa = new Regex('(a|b)*abb').minimalDFA(); // { classes, trans, accept, start }
```

Intersection is also a neat way to express constraints that are awkward in a single pattern, for example a password policy: `.{8,}&.*\d.*&.*[a-z].*&.*[A-Z].*`. To restrict an alphabet when counting, intersect with a class: `(pattern)&[a-z]*`.

## Syntax notes

Precedence from lowest to highest: `|`, then `&`, then concatenation, then prefix `~`, then postfix operators. So `~a*` means `~(a*)`. Matching is always anchored to the whole string; `search` and `findAll` use leftmost-longest semantics (POSIX style), not Perl's leftmost-first, so `a|ab` finds `ab` in `ab`. `\s` is ASCII whitespace only, and `\w` is `[A-Za-z0-9_]`. There are no backreferences or lookaround, because those would take the language out of the regular class and break everything above.

## Design decisions

- **Hash consing** means the node for a given normalised expression is unique, so derivative results can be memoised by id and DFA states compared by identity.
- **Canonical alternation and intersection** (flatten, drop duplicates, sort by id, merge character sets) is what gives finiteness. Without it, `a*` has infinitely many syntactically distinct derivatives.
- **Alphabet classes**: all the character sets in a pattern cut the code point range into a handful of intervals, and the DFA has one transition per interval. Equivalence checking uses the same trick on the combined pattern.
- **Shortest witnesses** come from a breadth first search over derivative states, so counterexamples are as short as possible. Representatives prefer printable ASCII where the class allows it.
- Caches are global and grow with use. This is fine for tools and tests, but a long running service that compiles unbounded user patterns would want to clear them periodically.

## Testing

`npm test` runs 17 tests with the built in `node:test` runner:

- Unit tests for every operator, counted repetition, Unicode, and syntax errors.
- Structural tests that check normalisation, for example that `a|b|a`, `b|a` and `[ab]` are the same node.
- Hand verified automata sizes (minimal DFA for `(a|b)*abb`).
- Equivalence, subset, witness, and counting checks, including De Morgan's laws and a Fibonacci count.
- Pathological patterns such as `(a*)*b` and `(x+x+)+y` against 20,000 character inputs, which would hang a backtracking engine.
- A **differential fuzzer** that generates 400 random patterns and checks 16,000 strings against JavaScript's built in `RegExp`.
- Fuzzing that the minimised DFA agrees with the lazy matcher, and that Boolean algebra laws hold on random pattern pairs.

## Layout

```
src/regex.js        engine: AST, derivatives, parser, DFA, minimisation, analyses
src/cli.js          command line interface
test/regex.test.js  test suite
```

## References

- J. A. Brzozowski, *Derivatives of Regular Expressions*, JACM 1964.
- S. Owens, J. Reppy, A. Turon, *Regular-expression derivatives re-examined*, JFP 2009.

## License

MIT
