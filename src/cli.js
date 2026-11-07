#!/usr/bin/env node
'use strict';
const { Regex } = require('./regex');

const USAGE = `usage: node src/cli.js <command> ...

  match   <pattern> <string>      full-string match (exit code 0 if it matches)
  search  <pattern> <string>      leftmost-longest matches, all of them
  dfa     <pattern>               derivative DFA size and minimal DFA size
  equiv   <pattern1> <pattern2>   language equivalence, with a counterexample if not
  subset  <pattern1> <pattern2>   is L(pattern1) a subset of L(pattern2)?
  example <pattern>               shortest string in the language
  count   <pattern> <n>           number of length-n strings in the language
  show    <pattern>               normalised form of the pattern

Operators beyond the usual: a&b (intersection), ~a (complement).`;

function main(argv) {
  const [cmd, ...a] = argv;
  try {
    switch (cmd) {
      case 'match': {
        const ok = new Regex(a[0]).matches(a[1] ?? '');
        console.log(ok ? 'match' : 'no match');
        return ok ? 0 : 1;
      }
      case 'search': {
        const ms = new Regex(a[0]).findAll(a[1] ?? '');
        for (const m of ms) console.log(`${m.index}-${m.end}\t${JSON.stringify(m.match)}`);
        return ms.length ? 0 : 1;
      }
      case 'dfa': {
        const re = new Regex(a[0]);
        const full = re.dfa();
        const min = re.minimalDFA();
        console.log(`derivative DFA: ${full.trans.length} states, ${full.classes.length} alphabet classes`);
        console.log(`minimal DFA:    ${min.trans.length} states`);
        return 0;
      }
      case 'equiv': {
        const r = new Regex(a[0]).equivalentTo(new Regex(a[1]));
        if (r.equivalent) console.log('equivalent');
        else
          console.log(
            `not equivalent: ${JSON.stringify(r.counterexample)} is in ${r.inFirst ? 'the first' : 'the second'} language only`
          );
        return r.equivalent ? 0 : 1;
      }
      case 'subset': {
        const r = new Regex(a[0]).subsetOf(new Regex(a[1]));
        console.log(r.subset ? 'subset' : `not a subset: ${JSON.stringify(r.counterexample)}`);
        return r.subset ? 0 : 1;
      }
      case 'example': {
        const w = new Regex(a[0]).shortestMatch();
        console.log(w === null ? '(language is empty)' : JSON.stringify(w));
        return w === null ? 1 : 0;
      }
      case 'count': {
        console.log(new Regex(a[0]).count(Number(a[1])).toString());
        return 0;
      }
      case 'show': {
        console.log(new Regex(a[0]).toString());
        return 0;
      }
      default:
        console.error(USAGE);
        return 2;
    }
  } catch (e) {
    console.error(e.message);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
