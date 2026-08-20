'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatBoard, updateStatBoard } = require('../src/stat-board');

test('stat board accumulates, updates in place, resets on new matchup', () => {
  const board = createStatBoard();
  let out = updateStatBoard(board, 'Pitt@Cal', [
    { kind: 'receiving', player: 'T.Dixon', receptions: 4, yards: 60, tds: 1 },
  ], 1000);
  assert.equal(out.length, 1);

  // Same player again: the entry updates rather than duplicating.
  out = updateStatBoard(board, 'Pitt@Cal', [
    { kind: 'receiving', player: 'T.Dixon', receptions: 5, yards: 71, tds: 1 },
  ], 2000);
  assert.equal(out.length, 1);
  assert.equal(out[0].receptions, 5);

  // A nameless rushing line still lands (keyed by kind).
  out = updateStatBoard(board, 'Pitt@Cal', [
    { kind: 'rushing', player: null, carries: 3, yards: 21 },
  ], 3000);
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, 'rushing'); // newest first

  // Quiet ticks keep the board.
  out = updateStatBoard(board, 'Pitt@Cal', [], 4000);
  assert.equal(out.length, 2);

  // New matchup wipes it.
  out = updateStatBoard(board, 'OSU@Mich', [], 5000);
  assert.equal(out.length, 0);
});

test('playerId keys nameless lines apart', () => {
  const board = createStatBoard();
  const out = updateStatBoard(board, 'A@B', [
    { kind: 'rushing', player: null, playerId: 101, carries: 3, yards: 21 },
    { kind: 'rushing', player: null, playerId: 202, carries: 9, yards: 55 },
  ], 1000);
  assert.equal(out.length, 2);
});
