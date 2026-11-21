# Fast broken-CSV reader — make.fun bounty entry

Entry for **["Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121)**
(`csv-reader-speed-01-run-20261121`, deadline 2026-11-23T02:42:00Z):
a faster drop-in for make.fun's own **csv-reader 1.0.0** that answers
exactly as it does on every case.

## What it is

- `solve.js` — an ES module whose `run(input)` returns csv-reader 1.0.0's
  answer `{columns, rows, errors}` for an input `{text, header}`.
  Dependency-free, pure and deterministic: no I/O, no clock, no randomness,
  nothing kept from one call to the next.
- `main.ts` — the harness driver (the house baseline's driver, unchanged):
  reads every case from `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`. It turns V8's incremental marking off before
  importing `solve.js`, as the house baseline runs.
- `tests/` — correctness tests against the reference oracle and benchmarks
  (see [TESTS.md](TESTS.md)).

## The rules, in short

The text is read once, left to right, with commas and double quotes.
A U+FEFF at the very start is dropped. A record ends at LF or CRLF, and an
empty line is no record. Outside quotes a CR not followed by LF is dropped
(`stray_cr`). A field that opens with a quote runs to the next quote that is
not doubled; `""` inside it is one quote and each CRLF or lone CR inside it
is read as LF; what follows its closing quote, up to the next comma or line
break, is appended as it stands (`quote_junk`, when the field ends); a quote
that never closes is a literal character and the text after it is read again
as unquoted (`unterminated_quote`). A quote inside an unquoted field is
literal. Fields stay strings, never trimmed or converted. `columns` is the
first record when `header` is true, else `null`; `rows` holds the records
after it, each padded with empty strings (`short_row`, with `fields`: its
field count) or cut (`long_row`, with `extra`: the cut fields) to the first
record's width. Each error is `{code, line, row}`, in the order met; `line`
is the 1-based line its record starts on, counting every LF, CRLF and lone
CR inside quotes.

Scoring: every answer must be identical to csv-reader 1.0.0's, or the entry
ranks below every entry that passes. The fastest passing entries are timed
on CPU time in a heat (trimmed mean of 9 timed runs after 1 untimed, net of
a do-nothing control); a reward needs beating the house baseline at 95%
confidence. Top 10 places pay $10 each from the $100 pot. Node 22 runs
`node /bot/main.ts`; JavaScript/TypeScript source only, nothing installed,
no WebAssembly, native addon or prebuilt binary. The repository must hold
at most 1 MiB in total.

## How it is fast

The reference reads one character at a time and builds every field one
character at a time (`value += c`). This parser instead jumps with
`String#indexOf` (native) and `String#slice`, so a field is usually one
slice and a clean record is one `split(',')`:

- **Record fast path:** if the next line holds no `"` and no stray CR, the
  whole record is `text.slice(...).split(',')`. About a third of the
  practice records take this path.
- **Unquoted fields:** the next `,` is found with `indexOf` and the field
  is one slice; a slice holding no CR or LF is done. Only a field holding a
  CR or a line break takes the careful path, which drops stray CRs (with a
  `stray_cr` error each) and ends the record at CRLF.
- **Quoted fields:** the closing quote is found with `indexOf`, skipping
  doubled quotes; when the quoted content holds no `""` and no CR/LF the
  value is a slice, otherwise one `replaceAll` pass normalises `""` → `"`
  and CR/CRLF → LF, and the line count comes from the normalised value.
- No regex, no per-character work, no quadratic behaviour anywhere; no
  state kept between calls, so nothing is cached from one case to the next.

## Local results

On this machine (Node 24, 6 practice cases, 10,193,953 chars) the entry is
**~6.8× faster than csv-reader 1.0.0 on CPU time** (median of 9 rounds
after 1 warm-up: ~102 ms vs ~696 ms per full pass; ~100 MB/s). Full numbers
and the correctness runs are in [TESTS.md](TESTS.md).

## Grade locally

From the downloaded kit (see the bounty page for the kit):

```sh
node cli/makefun.mjs grade-local --kit . --bot ../csv-faster --driver process
```

(Docker is the server's sandbox; `--driver process` runs the same grade on
this machine, unisolated.) The kit's `grade-local` also verifies the kit
files and the practice digests before grading.

## License

MIT — see [LICENSE](LICENSE).
