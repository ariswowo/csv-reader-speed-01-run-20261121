// Correctness tests for solve.js vs csv-reader 1.0.0 (the oracle).
// Usage: node tests/test.mjs [fuzzN]
// Exit code 0 when every check passes, 1 otherwise.
import { readFileSync } from 'node:fs';
import { run } from '../solve.js';
import { readCsv } from './vendor/oracle.js';
import { generate } from './generator/csv-cases.mjs';

const kitRoot = new URL('../../kit/', import.meta.url).pathname;

let failures = 0;
let checks = 0;

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function check(name, input) {
  checks += 1;
  const got = run(input);
  const want = readCsv(input);
  if (!eq(got, want)) {
    failures += 1;
    console.log(`FAIL ${name}\n  input: ${JSON.stringify(input)}\n  got:   ${JSON.stringify(got)}\n  want:  ${JSON.stringify(want)}`);
  }
}

// --- 1. Practice cases (the kit's own 6 cases) ---
const cases = JSON.parse(readFileSync(`${kitRoot}practice/input/cases.json`, 'utf8'));
for (const c of cases) check(`practice/${c.id}`, c.input);
console.log(`practice cases: ${cases.length} checked`);

// --- 2. Hand-written edge cases ---
const edge = [
  { text: '', header: true },
  { text: '', header: false },
  { text: '\uFEFF', header: true },
  { text: '\uFEFFa,b\n1,2', header: true },
  { text: 'a,b\n1,2', header: true },
  { text: 'a,b\n1,2', header: false },
  { text: 'a,b\r\n1,2\r\n', header: true },
  { text: 'a,b\r1,2\r', header: true }, // lone CRs: stray_cr, no records? (see oracle)
  { text: 'a,b\n\n1,2\n\n', header: true },
  { text: '\n\n', header: true },
  { text: '\r\n\r\n', header: true },
  { text: '\r\r\n', header: true },
  { text: '\r', header: true },
  { text: 'a\n', header: false },
  { text: 'a', header: false },
  { text: '"a","b"\n"1","2"', header: true },
  { text: '""""\n', header: false }, // one field: a single quote
  { text: '"a""b",c\n', header: false },
  { text: '"a\nb",c\n"d",e\n', header: false }, // LF inside quotes
  { text: '"a\r\nb",c\n"d",e\n', header: false }, // CRLF inside quotes -> LF
  { text: '"a\rb",c\n"d",e\n', header: false }, // lone CR inside quotes -> LF
  { text: '"a"b,c\n', header: false }, // quote_junk
  { text: '"a"kg,c\n', header: false },
  { text: '"a"x"y,c\n', header: false }, // junk holding a quote
  { text: '"a"\r,c\n', header: false }, // junk: lone CR then comma
  { text: '"a"\r', header: false }, // junk: lone CR then EOF
  { text: '"a"', header: false }, // quoted field at EOF
  { text: '"a', header: false }, // unterminated quote
  { text: '"a\nb', header: false }, // unterminated quote spanning a line
  { text: '"abc\ndef,ghi\njkl', header: false },
  { text: 'a"b,c\n', header: false }, // quote inside unquoted field is literal
  { text: 'a"",b\n', header: false },
  { text: ',,\n,,\n', header: false },
  { text: 'a,b,c\n1,2\n3,4,5,6\n', header: true }, // short + long rows
  { text: 'a,b\n1\n', header: true }, // short row
  { text: 'a,b\n1,2,3\n', header: true }, // long row
  { text: 'a,b\n1,2,3,4\n5\n6,7\n', header: true },
  { text: '"a,b",c\n"1","2,3"\n', header: true },
  { text: 'a,b\r\n"1\r2",3\r\n4,5\r\n', header: true }, // CRLF file, CR inside quotes
  { text: 'a,b\n1,2\r3,4\n5,6\n', header: false }, // stray CR mid-field
  { text: 'x\ry\nz\n', header: false }, // line of only stray CRs -> no record
  { text: 'x\r\ry\nz\n', header: false },
  { text: 'a,b\n"unclosed\n', header: true }, // unterminated in 2nd record
  { text: '"a""', header: false }, // doubled quote then EOF -> unterminated
  { text: '"a"""",b\n', header: false },
  { text: '"",x\n"",y\n', header: false }, // empty quoted fields are real records
  { text: '""\n', header: false },
  { text: 'a,b\n"",2\n', header: true },
  { text: 'héllo,wörld\n"Zürich","café"\n', header: true }, // non-ASCII
  { text: 'a,b\n"line1\rline2\rlast",2\n3,4\n', header: false }, // CRs in quotes count lines
  { text: 'a,b\n"line1\r\nline2",2\n3,4\n', header: false }, // CRLF in quotes counts 1 line
  { text: 'a,b\n"x" ,y\n', header: false }, // junk is a space
  { text: 'a,b\n"x"\n', header: true }, // short row after quoted field
  { text: 'a,b,c\n"x","y"\n', header: true },
  { text: 'a\n"b\nc\nd",e\nf\n', header: false }, // multi-line quoted field, line numbers
  { text: '\uFEFF"a","b"\n"1","2"', header: true },
  { text: 'a,b\n1,2\n', header: true },
  { text: 'a,b\n1,2', header: true }, // no trailing line break
  { text: 'a,b\n1,2\r', header: true }, // trailing lone CR
  { text: 'a,b\n1,2\r\n', header: true },
  { text: ',\n', header: false },
  { text: 'a,b\n,\n', header: true },
];
for (let i = 0; i < edge.length; i++) check(`edge/${i}`, edge[i]);
console.log(`edge cases: ${edge.length} checked`);

// --- 3. Fuzz with the kit's own case generator (realistic distribution) ---
function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return {
    float: () => next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
const fuzzN = Number(process.argv[2] ?? 300);
for (let i = 0; i < fuzzN; i++) {
  const input = generate(makeRng(0x9e3779b9 + i * 2654435761), i);
  check(`fuzz/${i}`, input);
}
console.log(`fuzz cases: ${fuzzN} checked`);

// --- 4. Small random byte-soup fuzz (arbitrary breakage) ---
const alphabet = ['a', 'b', ',', '"', '\n', '\r', ' ', 'x', '1', '\uFEFF'];
function soup(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(rng.float() * alphabet.length)];
  return { text: s, header: rng.chance(0.5) };
}
for (let i = 0; i < 2000; i++) {
  check(`soup/${i}`, soup(makeRng(12345 + i), 5 + Math.floor(makeRng(999 + i).float() * 120)));
}
console.log('byte-soup cases: 2000 checked');

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
