'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  HELD_FIELDS,
  RAM_FIELD_HOLD_MS,
  applyRamFieldHold,
  createRamFieldHoldCache,
} = require('../src/ram-field-hold');

function payloadWith(state, fields) {
  return {
    state: {
      away: {},
      home: {},
      game: {},
      meta: { ramProcessId: 4242 },
      ...state,
    },
    fields: fields || [],
  };
}

test('a field that drops out for a tick keeps its last verified value', () => {
  const cache = createRamFieldHoldCache();
  applyRamFieldHold(payloadWith({ game: { down: 3, distance: 7 } }), cache, 1000);
  const blink = applyRamFieldHold(payloadWith({ game: {} }), cache, 1200);
  assert.strictEqual(blink.state.game.down, 3);
  assert.strictEqual(blink.state.game.distance, 7);
  assert.ok(blink.fields.includes('game.down'));
  assert.ok(blink.fields.includes('game.distance'));
});

test('a deliberate long withhold still goes blank after the hold window', () => {
  const cache = createRamFieldHoldCache();
  applyRamFieldHold(payloadWith({ away: { possession: true } }), cache, 1000);
  const late = applyRamFieldHold(
    payloadWith({ away: {} }),
    cache,
    1000 + RAM_FIELD_HOLD_MS + 1,
  );
  assert.ok(!('possession' in late.state.away));
  assert.ok(!late.fields.includes('away.possession'));
  // The expired entry is gone: even a tick inside the window cannot revive it.
  const revived = applyRamFieldHold(payloadWith({ away: {} }), cache, 1000 + 100);
  assert.ok(!('possession' in revived.state.away));
});

test('a fresh value replaces the held one and restarts the window', () => {
  const cache = createRamFieldHoldCache();
  applyRamFieldHold(payloadWith({ home: { score: 14 } }), cache, 1000);
  applyRamFieldHold(payloadWith({ home: { score: 21 } }), cache, 5000);
  const blink = applyRamFieldHold(payloadWith({ home: {} }), cache, 5500);
  assert.strictEqual(blink.state.home.score, 21);
});

test('held values never cross a game process change', () => {
  const cache = createRamFieldHoldCache();
  applyRamFieldHold(payloadWith({ home: { score: 35 } }), cache, 1000);
  const next = applyRamFieldHold(
    payloadWith({ home: {}, meta: { ramProcessId: 9999 } }),
    cache,
    1100,
  );
  assert.ok(!('score' in next.state.home));
});

test('a field never seen is never invented, and null payloads pass through', () => {
  const cache = createRamFieldHoldCache();
  const out = applyRamFieldHold(payloadWith({}), cache, 1000);
  assert.deepStrictEqual(out.state.game, {});
  assert.strictEqual(applyRamFieldHold(null, cache, 1000), null);
});

test('holding falsy values works (0 timeouts, empty-string-free fields)', () => {
  const cache = createRamFieldHoldCache();
  applyRamFieldHold(payloadWith({ away: { timeouts: 0, possession: false } }), cache, 1000);
  const blink = applyRamFieldHold(payloadWith({ away: {} }), cache, 1300);
  assert.strictEqual(blink.state.away.timeouts, 0);
  assert.strictEqual(blink.state.away.possession, false);
});

test('the held field list matches what ramScoreboardPayload emits', () => {
  const labels = HELD_FIELDS.map(([section, key]) => `${section}.${key}`);
  for (const label of [
    'away.name', 'away.rank', 'away.record', 'away.score', 'away.timeouts', 'away.possession',
    'home.name', 'home.rank', 'home.record', 'home.score', 'home.timeouts', 'home.possession',
    'game.quarter', 'game.clock', 'game.playClock', 'game.down', 'game.distance',
    'game.downDistance', 'game.downDistanceKind',
  ]) {
    assert.ok(labels.includes(label), `missing held field: ${label}`);
  }
});
