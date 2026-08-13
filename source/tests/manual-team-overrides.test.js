'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyManualTeamOverrides,
  emptyManualTeamOverrides,
  normalizeManualTeamOverride,
} = require('../src/manual-team-overrides');

function state() {
  return {
    away: { name: 'USC', record: '4-1' },
    home: { name: 'Pittsburgh', record: '3-2' },
    game: {},
    meta: {},
  };
}

test('a custom record override replaces the published record', () => {
  const overrides = emptyManualTeamOverrides();
  overrides.away = normalizeManualTeamOverride(null, { recordMode: 'custom', record: '7-0' });
  const published = applyManualTeamOverrides(state(), overrides, null);
  assert.equal(published.away.record, '7-0');
  assert.equal(published.home.record, '3-2');
  assert.equal(published.meta.manualTeamOverrides.away.record, '7-0');
});

test('auto record mode leaves the reader record untouched', () => {
  const published = applyManualTeamOverrides(state(), emptyManualTeamOverrides(), null);
  assert.equal(published.away.record, '4-1');
  assert.equal(published.meta.manualTeamOverrides, undefined);
});

test('records accept W-L and W-L-T shapes only', () => {
  assert.equal(normalizeManualTeamOverride(null, { recordMode: 'custom', record: '10-2-1' }).record, '10-2-1');
  assert.throws(() => normalizeManualTeamOverride(null, { recordMode: 'custom', record: '7' }), /5-2/);
  assert.throws(() => normalizeManualTeamOverride(null, { recordMode: 'custom', record: 'seven-0' }), /5-2/);
  assert.throws(() => normalizeManualTeamOverride(null, { recordMode: 'custom', record: '' }), /5-2/);
});

test('rank and record overrides are independent', () => {
  const override = normalizeManualTeamOverride(null, {
    rankMode: 'ranked', rank: 12, recordMode: 'custom', record: '6-1',
  });
  assert.equal(override.rank, 12);
  assert.equal(override.record, '6-1');
  const autoRecord = normalizeManualTeamOverride(null, { rankMode: 'ranked', rank: 12 });
  assert.equal(autoRecord.recordMode, 'auto');
  assert.equal(autoRecord.record, null);
});
