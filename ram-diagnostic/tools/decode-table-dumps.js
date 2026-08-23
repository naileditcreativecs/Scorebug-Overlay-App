#!/usr/bin/env node
// Decode the 2026-08-23 table-capture dataset: find the record layout that
// holds for BOTH players of each position type. A layout is a set of byte
// deltas from an anchor stat; only layouts that fit every ground-truthed
// player of that type survive.
//
// Usage: node decode-table-dumps.js <valuehunt-dumps.jsonl>
'use strict';
const fs = require('fs');

const file = process.argv[2] || `${__dirname}/../reports/table-capture-2026-08-23/valuehunt-dumps.jsonl`;
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

const TRUTH = {
  'tuple:MANUAL CalQB': { kind: 'QB', anchor: 16, fields: { comp: 8, yds: 118 } },
  'tuple:MANUAL PittQB': { kind: 'QB', anchor: 21, fields: { comp: 9, yds: 64 } },
  'tuple:MANUAL TurnerRB': { kind: 'RB', anchor: 10, fields: { yds: 30, lng: 9 } },
  'tuple:MANUAL MohamedRB': { kind: 'RB', anchor: 6, fields: { yds: 80, lng: 40 } },
};

function isRamp(a, i) {
  let up = 0;
  for (let k = 1; k <= 4; k++) if (a[i + k] === a[i] + k) up++;
  let down = 0;
  for (let k = 1; k <= 4; k++) if (a[i + k] === a[i] - k) down++;
  return up >= 3 || down >= 3;
}

function isTextish(a, i) {
  // int16 view of UTF-16 text: values 0x20..0x7A dominating the span
  let printable = 0, nonzero = 0;
  for (let k = -8; k <= 24; k++) {
    const v = a[i + k];
    if (v === undefined || v === 0) continue;
    nonzero++;
    if (v >= 0x20 && v <= 0x7A) printable++;
  }
  return nonzero >= 8 && printable / nonzero >= 0.75;
}

// For one dump, all anchor occurrences with their surrounding delta->value map.
function anchorContexts(dump, anchorValue, windowInts) {
  const a = dump.int16s;
  const out = [];
  for (let i = windowInts; i < a.length - windowInts; i++) {
    if (a[i] !== anchorValue) continue;
    if (isRamp(a, i)) continue;
    const ctx = new Map();
    for (let k = -windowInts; k <= windowInts; k++) ctx.set(k * 2, a[i + k]);
    out.push({ address: dump.address, atInt: i, ctx });
  }
  return out;
}

// Candidate layouts per player: for each anchor occurrence, the delta sets
// where each truth field's value appears.
function layoutsForPlayer(label, windowInts) {
  const truth = TRUTH[label];
  const dumps = lines.filter((d) => d.label === label);
  const layouts = [];
  for (const dump of dumps) {
    for (const occ of anchorContexts(dump, truth.anchor, windowInts)) {
      const deltasByField = {};
      let complete = true;
      for (const [field, wanted] of Object.entries(truth.fields)) {
        const deltas = [];
        for (const [delta, value] of occ.ctx) {
          if (delta !== 0 && value === wanted) deltas.push(delta);
        }
        if (!deltas.length) { complete = false; break; }
        deltasByField[field] = deltas;
      }
      if (complete) layouts.push({ label, address: occ.address, deltasByField, ctx: occ.ctx });
    }
  }
  return layouts;
}

function main() {
  const windowInts = Number(process.argv[3]) || 48; // +-96 bytes
  for (const kind of ['QB', 'RB']) {
    const labels = Object.keys(TRUTH).filter((l) => TRUTH[l].kind === kind);
    const perPlayer = labels.map((l) => layoutsForPlayer(l, windowInts));
    console.log(`\n==== ${kind}: candidate rows per player: ${perPlayer.map((p, i) => `${labels[i].replace('tuple:MANUAL ', '')}=${p.length}`).join(', ')}`);
    // Intersect: delta tuples (one delta per field) present for EVERY player.
    const fieldNames = Object.keys(TRUTH[labels[0]].fields);
    const tupleCounts = new Map(); // "dComp,dYds" -> {count per player}
    perPlayer.forEach((playerLayouts, playerIndex) => {
      const seen = new Set();
      for (const layout of playerLayouts) {
        // expand cartesian product of field deltas (capped)
        const expand = (idx, acc) => {
          if (idx === fieldNames.length) { seen.add(acc.join(',')); return; }
          for (const d of layout.deltasByField[fieldNames[idx]].slice(0, 8)) expand(idx + 1, acc.concat(d));
        };
        expand(0, []);
      }
      for (const key of seen) {
        if (!tupleCounts.has(key)) tupleCounts.set(key, new Set());
        tupleCounts.get(key).add(playerIndex);
      }
    });
    const universal = [...tupleCounts.entries()].filter(([, players]) => players.size === labels.length);
    console.log(`layout tuples (${fieldNames.join(',')}) valid for ALL ${kind}s: ${universal.length}`);
    for (const [key] of universal.slice(0, 20)) console.log(`   deltas ${key}`);
    // For each universal layout, show one player's matching row with context.
    for (const [key] of universal.slice(0, 6)) {
      const deltas = key.split(',').map(Number);
      const example = perPlayer[0].find((layout) =>
        fieldNames.every((f, i) => layout.deltasByField[f].includes(deltas[i])));
      if (!example) continue;
      const row = [];
      for (let d = -32; d <= 96; d += 2) row.push(`${d}:${example.ctx.get(d)}`);
      console.log(` example ${example.label} ${example.address} [${key}]`);
      console.log(`   ${row.join(' ')}`);
    }
  }
}

main();
