// List every watched offset whose value history is monotonically non-increasing
// starting at 3 (i.e. behaves like a timeouts-remaining counter), with drop times.
const fs = require('fs');
const path = process.argv[2];
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);

const timeline = new Map();
function record(off, t, v) {
  if (!timeline.has(off)) timeline.set(off, []);
  timeline.get(off).push({ t, v });
}
for (const line of lines) {
  const e = JSON.parse(line);
  const t = Date.parse(e.t);
  const base = parseInt(e.offset, 16);
  record(base, t - 1, e.from);
  record(base, t, e.to);
  for (const k of Object.keys(e.around)) record(base + parseInt(k, 10), t, e.around[k]);
}

const fmt = t => new Date(t).toISOString().slice(11, 19);
for (const [off, samples] of [...timeline.entries()].sort((a, b) => a[0] - b[0])) {
  samples.sort((a, b) => a.t - b.t);
  // dedupe consecutive equal values, keep first time each value appeared
  const seq = [];
  for (const s of samples) {
    if (!seq.length || seq[seq.length - 1].v !== s.v) seq.push({ v: s.v, t: s.t });
  }
  const vals = seq.map(s => s.v);
  const mono = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
  if (mono && vals[0] === 3 && vals.length >= 2 && vals.length <= 4 && samples.length >= 8) {
    const desc = seq.map(s => `${s.v}@${fmt(s.t)}`).join(' -> ');
    console.log(`0x${off.toString(16).toUpperCase().padStart(4, '0')}  n=${String(samples.length).padStart(3)}  ${desc}`);
  }
}
