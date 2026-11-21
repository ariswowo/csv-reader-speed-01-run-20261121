// Benchmark: solve.js (this entry) vs the house baseline (csv-reader 1.0.0)
// on the kit's 6 practice cases (~10.2 MB of CSV). Reports wall ms and CPU ms
// per full pass over the set, median of N rounds after 1 warm-up round.
// Usage: node tests/bench.mjs [rounds]
import { readFileSync } from 'node:fs';
import { run as fast } from '../solve.js';
import { run as baseline } from './vendor/baseline-solve.js';

const kitRoot = new URL('../../kit/', import.meta.url).pathname;
const cases = JSON.parse(readFileSync(`${kitRoot}practice/input/cases.json`, 'utf8'));
const inputs = cases.map((c) => c.input);
const totalChars = inputs.reduce((s, i) => s + i.text.length, 0);
console.log(`cases: ${inputs.length}, total chars: ${totalChars}`);

function timeIt(fn, rounds) {
  const walls = [];
  const cpus = [];
  for (let r = 0; r < rounds + 1; r++) {
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    for (const input of inputs) fn(input);
    const c1 = process.cpuUsage(c0);
    const t1 = performance.now();
    if (r === 0) continue; // warm-up
    walls.push(t1 - t0);
    cpus.push((c1.user + c1.system) / 1000);
  }
  walls.sort((a, b) => a - b);
  cpus.sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];
  return { wall: med(walls), cpu: med(cpus) };
}

const rounds = Number(process.argv[2] ?? 7);
const b = timeIt(baseline, rounds);
const f = timeIt(fast, rounds);
console.log(`baseline csv-reader 1.0.0: wall ${b.wall.toFixed(0)} ms, CPU ${b.cpu.toFixed(0)} ms`);
console.log(`this entry            : wall ${f.wall.toFixed(0)} ms, CPU ${f.cpu.toFixed(0)} ms`);
console.log(`speedup (CPU): ${(b.cpu / f.cpu).toFixed(2)}x, (wall): ${(b.wall / f.wall).toFixed(2)}x`);
console.log(`throughput: ${(totalChars / 1e6 / (f.cpu / 1000)).toFixed(1)} MB/s CPU`);
