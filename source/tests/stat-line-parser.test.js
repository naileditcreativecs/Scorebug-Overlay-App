'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStatLine, parseHudTexts } = require('../src/stat-line-parser');

test('stat lines: every probe-proven format parses, junk does not', () => {
  assert.deepEqual(parseStatLine('T.Dixon 4 Rec, 60 Yds, 1 TD'),
    { kind: 'receiving', player: 'T.Dixon', receptions: 4, yards: 60, tds: 1, text: 'T.Dixon 4 Rec, 60 Yds, 1 TD' });
  assert.equal(parseStatLine('2 RUSH, 33 YDS').kind, 'rushing');
  assert.equal(parseStatLine('2 RUSH, 33 YDS').yards, 33);
  const pass = parseStatLine('29 YDS, 0 TDs, 0 INTs');
  assert.equal(pass.kind, 'passing');
  assert.equal(pass.ints, 0);
  const comp = parseStatLine('J. Smith 18/24, 212 YDS, 2 TDs');
  assert.equal(comp.completions, 18);
  assert.equal(comp.attempts, 24);
  assert.equal(comp.player, 'J. Smith');
  assert.equal(parseStatLine('K.Jones 7 TKL, 1.5 SACKS').sacks, 1.5);
  assert.equal(parseStatLine('FLAG'), null);
  assert.equal(parseStatLine('AbshireCameron_33901'), null);
  assert.equal(parseStatLine(''), null);
});

test('hudTexts reduce: sides ride along, unparsed lines are dropped', () => {
  const out = parseHudTexts([
    { teamSide: 'home', playerId: 7, texts: ['T.Dixon 4 Rec, 60 Yds, 1 TD', 'garbage'] },
    { teamSide: null, texts: ['29 YDS, 0 TDs, 0 INTs'] },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].teamSide, 'home');
  assert.equal(out[0].playerId, 7);
  assert.equal(out[1].kind, 'passing');
});
