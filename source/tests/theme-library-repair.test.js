'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LIBRARY_SCHEMA,
  ThemeLibrary,
  repairKnownThemeHtml,
  sha256,
} = require('../src/theme-library');

const badRule = 'var NAME_REJECT = /&|\\d{1,2}:\\d{2}|\\b(1ST|2ND|3RD|4TH|GOAL|INCHES)\\b/i;';

test('known ESPN name guard keeps Texas A&M while still rejecting clock/down text', () => {
  const repaired = repairKnownThemeHtml(Buffer.from(`
    // A team name never contains "&", a clock, or an ordinal down — those are stray writes.
    ${badRule}
  `));
  const html = repaired.bytes.toString('utf8');
  assert.equal(repaired.changed, true);
  assert.doesNotMatch(html, /NAME_REJECT = \/&\|/);
  const literal = html.match(/var NAME_REJECT = (\/.*\/i);/)?.[1];
  const reject = Function(`return ${literal}`)();
  assert.equal(reject.test('Texas A&M'), false);
  assert.equal(reject.test('3rd & 7'), true);
  assert.equal(reject.test('12:34'), true);
});

test('saved theme repair updates integrity metadata without changing its library id or path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb27-theme-repair-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = 'legacy-espn-2020';
  const relativePath = `themes/${id}/index.html`;
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = Buffer.from(`<html><body data-cfb27-scorebug><script>${badRule}</script></body></html>`);
  fs.writeFileSync(file, before);
  fs.writeFileSync(path.join(root, 'library.json'), `${JSON.stringify({
    schema: LIBRARY_SCHEMA,
    themes: [{ id, name: 'ESPN 2020', fileName: 'ESPN 2020.html', relativePath, sha256: sha256(before), bytes: before.length }],
  }, null, 2)}\n`);

  const library = new ThemeLibrary(root);
  const repaired = library.repairKnownThemes();
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].id, id);
  assert.equal(repaired[0].path, file);
  assert.notEqual(repaired[0].oldSha256, repaired[0].newSha256);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));
  assert.equal(manifest.themes[0].id, id);
  assert.equal(manifest.themes[0].relativePath, relativePath);
  assert.equal(manifest.themes[0].sha256, repaired[0].newSha256);
  assert.equal(library.list().length, 1, 'updated integrity metadata remains valid');
});
