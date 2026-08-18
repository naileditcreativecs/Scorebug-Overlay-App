'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  RAM_DOCUMENT_HOLD_MS,
  applyRamDocumentHold,
  createRamDocumentHold,
  looksLikeNewGame,
} = require('../src/ram-document-hold');

const payload = (pid = 500) => ({ state: { meta: { ramProcessId: pid }, away: {}, home: {}, game: {} }, fields: ['x'] });
const ctx = (over = {}) => ({ nowMs: 10_000, readerStatusText: 'RAM export: confirming synchronized scoreboard (1/3)', gameProcessId: 500, readerAlive: true, ...over });

test('a same-game re-locate keeps the last document on screen', () => {
  const hold = createRamDocumentHold();
  applyRamDocumentHold(hold, payload(), ctx());
  const r = applyRamDocumentHold(hold, null, ctx({ nowMs: 12_000 }));
  assert.strictEqual(r.held, true);
  assert.ok(r.payload);
});

test('a new-game status clears immediately; hold never crosses games', () => {
  const hold = createRamDocumentHold();
  applyRamDocumentHold(hold, payload(), ctx());
  const r = applyRamDocumentHold(hold, null, ctx({ readerStatusText: 'RAM export: matchup changed; automatic read-only locator refreshed' }));
  assert.deepStrictEqual([r.payload, r.reason], [null, 'new-game']);
  const again = applyRamDocumentHold(hold, null, ctx({ nowMs: 10_100 }));
  assert.strictEqual(again.payload, null);
});

test('a game process change or a dead reader clears', () => {
  const hold = createRamDocumentHold();
  applyRamDocumentHold(hold, payload(), ctx());
  assert.strictEqual(applyRamDocumentHold(hold, null, ctx({ gameProcessId: 777 })).reason, 'process');
  applyRamDocumentHold(hold, payload(), ctx());
  assert.strictEqual(applyRamDocumentHold(hold, null, ctx({ readerAlive: false })).reason, 'reader-down');
});

test('the hold expires', () => {
  const hold = createRamDocumentHold();
  applyRamDocumentHold(hold, payload(), ctx());
  assert.strictEqual(applyRamDocumentHold(hold, null, ctx({ nowMs: 20_000 })).held, true);
  assert.strictEqual(applyRamDocumentHold(hold, null, ctx({ nowMs: 20_000 + RAM_DOCUMENT_HOLD_MS + 1 })).reason, 'expired');
});

test('new-game detection: progressed game -> 1st, 0-0, full clock', () => {
  const inProgress = { game: { quarter: '3rd', clock: '4:12' }, away: { score: 14 }, home: { score: 7 } };
  const fresh = { game: { quarter: '1st', clock: '15:00' }, away: { score: 0 }, home: { score: 0 } };
  assert.ok(looksLikeNewGame(inProgress, fresh));
  // Early in the same game: never a new game.
  const early = { game: { quarter: '1st', clock: '13:00' }, away: { score: 0 }, home: { score: 0 } };
  assert.ok(!looksLikeNewGame(early, fresh));
  // Halftime/OT transitions are not 1st quarter.
  assert.ok(!looksLikeNewGame(inProgress, { game: { quarter: '3rd', clock: '15:00' }, away: { score: 14 }, home: { score: 7 } }));
  // A 1st-quarter score reset with a full clock (restart) does count.
  const scored1st = { game: { quarter: '1st', clock: '9:00' }, away: { score: 7 }, home: { score: 0 } };
  assert.ok(looksLikeNewGame(scored1st, fresh));
  assert.ok(!looksLikeNewGame(null, fresh));
});
