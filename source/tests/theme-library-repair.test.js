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

test('known FOX-family bundle receives live name bridge and renders Texas A&M', () => {
  const template = `<!DOCTYPE html><html><body>
    <div data-cfb27-bind="away.name"></div>
    <div data-cfb27-bind="home.name"></div>
    <div data-cfb27-bind="away.rank"></div>
    <script type="text/x-dc" data-props="awayNameText homeNameText rankLeftText rankRightText"></script>
  </body></html>`;
  const encoded = JSON.stringify(template).replace(/<\//g, '<\\u002F');
  const source = `<html><body><script type="__bundler/template">${encoded}</script></body></html>`;
  const repaired = repairKnownThemeHtml(Buffer.from(source));
  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.repairs, ['fox-v7-live-identity']);

  const stored = repaired.bytes.toString('utf8');
  const decoded = JSON.parse(stored.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
  assert.match(decoded, /data-cfb27-fox-v7-live-identity/);
  const bridge = decoded.match(/<script data-cfb27-fox-v7-live-identity>([\s\S]*?)<\/script>/)[1];
  const elements = new Map([
    ['away.name', { textContent: 'NOTRE DAME' }],
    ['home.name', { textContent: 'ILLINOIS' }],
    ['away.rank', { textContent: '21' }],
  ]);
  const listeners = {};
  const window = {
    addEventListener: (name, listener) => { listeners[name] = listener; },
  };
  const document = {
    querySelectorAll: (selector) => {
      const binding = selector.match(/data-cfb27-bind="([^"]+)"/)?.[1];
      return elements.has(binding) ? [elements.get(binding)] : [];
    },
  };
  Function('window', 'document', bridge)(window, document);
  listeners['cfb27-scoreboard-state']({
    detail: {
      away: { name: 'Texas A&M', shortName: 'Texas A&M', rank: 7 },
      home: { name: 'Pittsburgh' },
    },
  });
  assert.equal(elements.get('away.name').textContent, 'Texas A&M');
  assert.equal(elements.get('home.name').textContent, 'Pittsburgh');
  assert.equal(elements.get('away.rank').textContent, '7');

  const secondPass = repairKnownThemeHtml(repaired.bytes);
  assert.equal(secondPass.changed, false, 'repair is idempotent');
});

test('ESPN 2020 flag hookup: stored copies gain the flagUp field and neutral-flag fallback', () => {
  const legacy = Buffer.from(`<html><body><script>
    var F = {
    penaltyFlag: '', penaltyType: '', penaltyYards: ''
  };
  alias('penaltyFlag',    ['penalty_flag','penalty-flag','flagTeam','flag_team','penaltyTeam','penalty_team']);
  function flagPaint() {
    var side = F.penaltyFlag;
    if (side === true || side === 'true') side = 'flag';
    var cap = 'flagCapOn';
  }
  </script></body></html>`);
  const repaired = repairKnownThemeHtml(legacy);
  assert.equal(repaired.changed, true);
  assert.ok(repaired.repairs.includes('espn-2020-flag-hookup'));
  const html = repaired.bytes.toString('utf8');
  assert.match(html, /flagUp: false/);
  assert.match(html, /alias\('flagUp'/);
  assert.match(html, /truthy\(F\.flagUp\)\) side = 'flag';/);
  const secondPass = repairKnownThemeHtml(repaired.bytes);
  assert.equal(secondPass.repairs.includes('espn-2020-flag-hookup'), false, 'flag hookup repair is idempotent');
});

test('the shipped ESPN 2020 default already carries the flag hookup and needs no repair', () => {
  const shipped = fs.readFileSync(path.join(__dirname, '..', 'themes', 'defaults', 'ESPN 2020.html'));
  assert.match(shipped.toString('utf8'), /alias\('flagUp'/);
  const pass = repairKnownThemeHtml(shipped);
  assert.equal(pass.repairs.includes('espn-2020-flag-hookup'), false);
});

test('ESPN 2020 flag side guard: neutral flags cannot break the retraction', () => {
  const legacy = Buffer.from(`<html><body><script>
    var F = {
    penaltyFlag: '', penaltyType: '', penaltyYards: ''
  };
  alias('penaltyFlag',    ['penalty_flag','penalty-flag','flagTeam','flag_team','penaltyTeam','penalty_team']);
  function flagPaint() {
    var side = F.penaltyFlag;
    if (side === true || side === 'true') side = 'flag';
    var cap = 'flagCapOn';
    lastFlagActive = active;
    if (active) lastFlagSide = side;
  }
  </script></body></html>`);
  const fresh = repairKnownThemeHtml(legacy);
  assert.ok(fresh.repairs.includes('espn-2020-flag-hookup'));
  assert.ok(fresh.repairs.includes('espn-2020-flag-side-guard'), 'guard applies in the same pass as the hookup');
  const html = fresh.bytes.toString('utf8');
  assert.match(html, /lastFlagSide = \(side === 'away' \|\| side === 'home'\) \? side : '';/);
  assert.doesNotMatch(html, /lastFlagSide = side;/);

  // A copy already repaired by the buggy first hookup: flagUp present, side
  // line unguarded. The guard must still fire on its own.
  const buggyRepaired = Buffer.from(`<html><body><script>
    var F = { penaltyFlag: '', flagUp: false };
  function flagPaint() {
    var cap = 'flagCapOn';
    if (active) lastFlagSide = side;
  }
  </script></body></html>`);
  const reRepaired = repairKnownThemeHtml(buggyRepaired);
  assert.equal(reRepaired.repairs.includes('espn-2020-flag-hookup'), false);
  assert.ok(reRepaired.repairs.includes('espn-2020-flag-side-guard'));
  const secondPass = repairKnownThemeHtml(reRepaired.bytes);
  assert.equal(secondPass.repairs.includes('espn-2020-flag-side-guard'), false, 'side guard is idempotent');
});

test('ESPN 2020 flag timing: legacy copies get all three flag repairs in one pass', () => {
  const legacy = Buffer.from(`<html><body><script>
    var F = {
    penaltyFlag: '', penaltyType: '', penaltyYards: ''
  };
  alias('penaltyFlag',    ['penalty_flag','penalty-flag','flagTeam','flag_team','penaltyTeam','penalty_team']);
  var lastFlagActive = false, lastFlagSide = '', flagOffTimer = null;
  function flagPaint() {
    var side = F.penaltyFlag;
    if (side === true || side === 'true') side = 'flag';
    var cap = 'flagCapOn';
    lastFlagActive = active;
    if (active) lastFlagSide = side;
  }
  </script></body></html>`);
  const repaired = repairKnownThemeHtml(legacy);
  for (const tag of ['espn-2020-flag-hookup', 'espn-2020-flag-side-guard', 'espn-2020-flag-timing']) {
    assert.ok(repaired.repairs.includes(tag), tag);
  }
  const html = repaired.bytes.toString('utf8');
  assert.match(html, /flagShownAtMs = Date\.now\(\)/);
  assert.match(html, /> 5000/);
  const secondPass = repairKnownThemeHtml(repaired.bytes);
  assert.equal(secondPass.changed, false, 'all flag repairs are idempotent together');
});
