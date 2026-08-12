'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyScoreboardDataSource,
  normalizeRamInteger,
  normalizeScoreboardDataSource,
  usesRamReader,
} = require('../src/scoreboard-data-source');
const { screenCaptureEnabled } = require('../src/capture-policy');

const screen = {
  away: { name: 'OCR AWAY', score: 6, record: '1-0' },
  home: { name: 'OCR HOME', score: 7, record: '2-0' },
  game: { clock: '4:50', quarter: '2nd' },
  meta: { source: 'local-ocr', visible: true, confidence: 0.9, updatedAt: 'screen-time' },
};
const ram = {
  away: { name: 'RAM AWAY', score: 7 },
  home: { name: 'RAM HOME', score: 14 },
  game: { clock: '4:51', quarter: '2nd' },
  meta: { source: 'ram', ramUpdatedAt: 'ram-time' },
};

test('normalizes unknown choices to automatic', () => {
  assert.equal(normalizeScoreboardDataSource('RAM'), 'ram');
  assert.equal(normalizeScoreboardDataSource('something-else'), 'auto');
  assert.equal(usesRamReader('screen'), false);
  assert.equal(usesRamReader('auto'), true);
});

test('does not coerce missing RAM numbers to zero', () => {
  assert.equal(normalizeRamInteger(null, { min: 0, max: 3 }), null);
  assert.equal(normalizeRamInteger(undefined, { min: 0, max: 3 }), null);
  assert.equal(normalizeRamInteger('', { min: 0, max: 3 }), null);
  assert.equal(normalizeRamInteger('2', { min: 0, max: 3 }), 2);
  assert.equal(normalizeRamInteger(4, { min: 0, max: 3 }), null);
});

test('screen mode publishes only screen-reader values', () => {
  assert.equal(applyScoreboardDataSource(screen, ram, 'screen'), screen);
});

test('automatic mode overlays RAM values and keeps screen-only fields', () => {
  const result = applyScoreboardDataSource(screen, ram, 'auto');
  assert.equal(result.away.name, 'RAM AWAY');
  assert.equal(result.away.record, '1-0');
  assert.equal(result.game.clock, '4:51');
  assert.equal(result.meta.source, 'ram+screen');
  assert.equal(result.meta.visible, true);
});

test('RAM mode publishes RAM values without OCR field fallback', () => {
  const result = applyScoreboardDataSource(screen, ram, 'ram');
  assert.equal(result.away.name, 'RAM AWAY');
  assert.equal(result.away.record, undefined);
  assert.equal(result.meta.source, 'ram');
  assert.equal(result.meta.visible, true);
  assert.equal(result.meta.confidence, 1);
});

test('live RAM is visible even when the screen reader is disabled', () => {
  const hiddenScreen = { away: {}, home: {}, game: {}, meta: { visible: false, confidence: 0 } };
  const result = applyScoreboardDataSource(hiddenScreen, ram, 'ram');
  assert.equal(result.meta.visible, true);
  assert.equal(result.meta.confidence, 1);
});

test('RAM mode reports a waiting state until RAM data is live', () => {
  const result = applyScoreboardDataSource(screen, null, 'ram');
  assert.deepEqual(result.away, {});
  assert.equal(result.meta.source, 'ram-waiting');
});

test('RAM-only mode disables screen capture and OCR', () => {
  assert.equal(screenCaptureEnabled({
    capture: { enabled: true },
    recognition: { mode: 'local-ocr' },
    dataExtraction: { scoreboardSource: 'ram' },
  }), false);
  assert.equal(screenCaptureEnabled({
    capture: { enabled: true },
    recognition: { mode: 'local-ocr' },
    dataExtraction: { scoreboardSource: 'auto' },
  }), true);
});
