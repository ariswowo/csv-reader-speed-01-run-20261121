# Tests — local results

Run from the repository root:

```sh
node tests/test.mjs [fuzzN]   # correctness vs the csv-reader 1.0.0 oracle
node tests/bench.mjs [rounds] # timing vs the house baseline on the practice set
```

`tests/vendor/oracle.js` is a copy of the kit's `baselines/csv-reader/vendor/
csv-reader/index.js` (csv-reader 1.0.0, the oracle) and
`tests/generator/csv-cases.mjs` a copy of the kit's case generator, both used
only by the tests. `tests/vendor/baseline-solve.js` is the house baseline's
`solve.js` rewired to that oracle copy, used only by the benchmark.

## Correctness

All comparisons are exact JSON equality (`JSON.stringify` comparison of the
whole `{columns, rows, errors}` answer) against the oracle.

| Suite | Cases | Result |
|---|---|---|
| Kit practice cases (`practice/input/cases.json`, 6 cases, 10,193,953 chars) | 6 | 6 pass |
| Hand-written edge cases (empty input, BOM only, lone CRs, blank lines, CRLF/LF mixes, quoted fields with embedded LF/CRLF/lone CR, doubled quotes, quote junk incl. junk with quotes and stray CRs, unterminated quotes incl. spanning lines, quotes inside unquoted fields, empty quoted fields, short/long rows, header on/off, missing trailing line break, trailing lone CR, non-ASCII) | 62 | 62 pass |
| Fuzz with the kit's own case generator (seeded RNG, realistic distribution: 1.4–2.0 M chars, 8–18 columns, short/long rows, stray CRs, quote junk, blank lines, unterminated quotes, BOM, CRLF/LF) | 1,000 | 1,000 pass |
| Byte-soup fuzz (random strings over `a b , " \n \r space x 1 U+FEFF`, 5–125 chars, header on/off) | 2,000 | 2,000 pass |
| **Total** | **3,068** | **3,068 pass, 0 failures** |

One bug was caught and fixed by the byte-soup fuzz during development: a
field holding stray CRs *and* ending with CRLF was treated as a clean CRLF
ending (the CRs were kept instead of dropped, and the `stray_cr` errors
were missing). The fix checks that the only CR in the field is the trailing
one before falling into the CRLF path; anything else goes to the careful
reader. After the fix the full suite passes.

## Timing

`node tests/bench.mjs 9` on this machine (Node v24.22.1, shared 1.5 CPU),
median of 9 rounds after 1 warm-up round, full pass over the 6 practice
cases (10,193,953 chars):

| Implementation | Wall | CPU | |
|---|---|---|---|
| Baseline csv-reader 1.0.0 (house `solve.js`) | 776 ms | 696 ms | |
| This entry (`solve.js`) | 163 ms | 102 ms | |
| **Speedup** | **4.75×** | **6.82×** | **~100 MB/s CPU** |

An earlier run measured 318 ms wall / 241 ms CPU for this entry vs 1185 ms /
743 ms for the baseline (3.08× CPU); after the unquoted-scanner rewrite the
same machine measures 6.82× CPU. Absolute times vary with machine load; the
ratio is what matters, and the kit's own `grade-local` (below) is the
authoritative local check.

## Kit grade-local

```sh
node cli/makefun.mjs grade-local --kit . --bot ../csv-faster --driver process
```

Result (2026-11-21, from the downloaded kit):

```
kit csv-reader-speed-01-run-20261121 dev: verified 31 files
practice instance aab71c23d2bdd664ede20c43b59541ce2f459d61cd99fc3d94079b146d05f81a
  (drawn from round 34140941)
scores    {"cases_passed":6,"cases_total":6,"passed":1}
checks    6 of 6 points over 1 check
  generated/generated  6 of 6: Cases drawn from the seed
L1 regrade        reproduced byte for byte
```

Note: the kit notes this `result_sha256` cannot equal the server's because
the server's harness runs Node v26.13.1 and this machine runs v24.22.1, and
the process driver records no image digest (the Docker driver does). No
transcripts were passed, so cost/authorship show as unpriced/none — that is
expected before bundling; it does not affect the correctness score.

## Repository size

Total 41,970 bytes — well under the 1 MiB repository cap.
