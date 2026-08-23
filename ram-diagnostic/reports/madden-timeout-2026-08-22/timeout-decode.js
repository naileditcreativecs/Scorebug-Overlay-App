// Decode Madden timeouts-remaining slots from madden-timeout-probe.jsonl
// Ground truth (tester): user team called timeouts at Q1 4:39 (279s) and Q1 1:12 (72s).
// Expected user counter: 3 before ~23:36:57Z, 2 between breaks, 1 after ~23:38:58Z.
// Expected CPU counter: 3 throughout.
const fs = require('fs');
const path = process.argv[2];
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);

// timeline: winOffset -> [{t, v}]
const timeline = new Map();
function record(off, t, v) {
  if (!timeline.has(off)) timeline.set(off, []);
  timeline.get(off).push({ t, v });
}

for (const line of lines) {
  const e = JSON.parse(line);
  const t = Date.parse(e.t);
  const base = parseInt(e.offset, 16);
  record(base, t - 1, e.from); // value just before the transition
  record(base, t, e.to);
  for (const k of Object.keys(e.around)) {
    record(base + parseInt(k, 10), t, e.around[k]);
  }
}

const T1 = Date.parse('2026-08-22T23:36:55Z'); // just before 4:39 timeout
const T1END = Date.parse('2026-08-22T23:37:40Z'); // after break settles
const T2 = Date.parse('2026-08-22T23:38:57Z'); // 1:12 timeout moment

const results = [];
for (const [off, samples] of timeline) {
  samples.sort((a, b) => a.t - b.t);
  const before = samples.filter(s => s.t < T1);
  const mid = samples.filter(s => s.t >= T1END && s.t < T2);
  const after = samples.filter(s => s.t >= T2);
  if (!before.length || !mid.length) continue;

  const allEq = (arr, v) => arr.every(s => s.v === v);
  // user pattern: 3 -> 2 -> (1 if observed after T2)
  if (allEq(before, 3) && allEq(mid, 2)) {
    const afterOk = !after.length || allEq(after, 1) || allEq(after, 2);
    results.push({
      off: '0x' + off.toString(16).toUpperCase(),
      kind: after.length ? (allEq(after, 1) ? 'USER-PERFECT' : 'USER-3to2-only') : 'USER-3to2 (no post-T2 sample)',
      nBefore: before.length, nMid: mid.length, nAfter: after.length,
      afterVals: [...new Set(after.map(s => s.v))].join(','),
    });
  }
  // CPU pattern: 3 everywhere, sampled across the whole span
  else if (allEq(before, 3) && allEq(mid, 3) && (!after.length || allEq(after, 3))
           && before.length + mid.length + after.length >= 6) {
    results.push({
      off: '0x' + off.toString(16).toUpperCase(), kind: 'CPU-CONST3',
      nBefore: before.length, nMid: mid.length, nAfter: after.length, afterVals: '3',
    });
  }
}

results.sort((a, b) => a.kind.localeCompare(b.kind) || parseInt(a.off, 16) - parseInt(b.off, 16));
for (const r of results) {
  console.log(`${r.kind.padEnd(28)} ${r.off.padStart(7)}  samples before/mid/after: ${r.nBefore}/${r.nMid}/${r.nAfter}  afterVals=[${r.afterVals}]`);
}
console.log(`\ntotal watched offsets: ${timeline.size}, matches: ${results.length}`);
