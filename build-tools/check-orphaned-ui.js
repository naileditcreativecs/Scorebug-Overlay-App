const fs = require('fs');
const dir = 'F:/FromOneDrive/claude/A test for this/source/src/';
const html = fs.readFileSync(dir + 'control.html', 'utf8');
const js = fs.readFileSync(dir + 'control.js', 'utf8');

const present = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const used = [...js.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
const missing = [...new Set(used)].filter((id) => !present.has(id));

console.log('control.js references ' + new Set(used).size + ' ids; ' + missing.length + ' no longer exist in control.html');
console.log();
let crashers = 0;
for (const id of missing) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\$\\(\\s*[\'"]' + esc + '[\'"]\\s*\\)\\s*(\\?\\.|\\.|\\[)', 'g');
  const hits = [...js.matchAll(re)];
  const unguarded = hits.filter((h) => h[1] !== '?.');
  if (unguarded.length) crashers++;
  console.log('  ' + id.padEnd(34) + ' total=' + String(hits.length).padEnd(3) + ' UNGUARDED=' + unguarded.length);
}
console.log();
console.log('ids with at least one unguarded access (would throw): ' + crashers);
