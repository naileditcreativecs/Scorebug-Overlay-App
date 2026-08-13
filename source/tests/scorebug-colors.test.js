'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyScorebugColorPreset,
  applyScorebugColors,
  deleteScorebugColorPreset,
  normalizeScorebugColors,
  upsertScorebugColorPreset,
} = require('../src/scorebug-colors');

function payload() {
  return {
    away: { name: 'USC', color: '#991b1e' },
    home: { name: 'Pittsburgh', color: '#003263' },
    game: {},
    meta: {},
  };
}

test('auto mode leaves the bundled team colors untouched', () => {
  const state = applyScorebugColors(payload(), normalizeScorebugColors(null));
  assert.equal(state.away.color, '#991b1e');
  assert.equal(state.home.color, '#003263');
  assert.equal(state.meta.scorebugColors, undefined);
});

test('a pinned custom color wins over the team primary', () => {
  const state = applyScorebugColors(payload(), {
    away: { mode: 'custom', color: '#FFFFFF' },
    home: { mode: 'auto' },
  });
  assert.equal(state.away.color, '#ffffff');
  assert.equal(state.home.color, '#003263');
  assert.deepEqual(state.meta.scorebugColors, { away: '#ffffff' });
});

test('a custom mode without a usable color falls back to auto', () => {
  const normalized = normalizeScorebugColors({
    away: { mode: 'custom', color: 'not-a-color' },
  });
  assert.deepEqual(normalized.away, { mode: 'auto', color: null });
});

test('presets round-trip: save, apply, delete', () => {
  let colors = normalizeScorebugColors(null);
  colors = upsertScorebugColorPreset(colors, 'Rivalry', '#111111', '#eeeeee');
  assert.equal(colors.presets.length, 1);

  const applied = applyScorebugColorPreset(colors, 'rivalry');
  assert.deepEqual(applied.away, { mode: 'custom', color: '#111111' });
  assert.deepEqual(applied.home, { mode: 'custom', color: '#eeeeee' });

  const removed = deleteScorebugColorPreset(applied, 'Rivalry');
  assert.equal(removed.presets.length, 0);
  assert.throws(() => applyScorebugColorPreset(removed, 'Rivalry'), /no longer exists/);
});

test('saving over an existing preset name replaces it instead of duplicating', () => {
  let colors = upsertScorebugColorPreset(normalizeScorebugColors(null), 'Night', '#111111', '#222222');
  colors = upsertScorebugColorPreset(colors, 'night', '#333333', '#444444');
  assert.equal(colors.presets.length, 1);
  assert.equal(colors.presets[0].away, '#333333');
});

test('a preset without both colors is rejected', () => {
  assert.throws(
    () => upsertScorebugColorPreset(normalizeScorebugColors(null), 'Broken', '#123456', 'nope'),
    /both team colors/i,
  );
});

test('malformed preset entries are dropped on normalization', () => {
  const normalized = normalizeScorebugColors({
    presets: [
      { name: 'Good', away: '#101010', home: '#202020' },
      { name: '', away: '#101010', home: '#202020' },
      { name: 'Bad', away: 'red', home: '#202020' },
      null,
    ],
  });
  assert.equal(normalized.presets.length, 1);
  assert.equal(normalized.presets[0].name, 'Good');
});
