'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyManualTeamOverrides,
  emptyManualTeamOverrides,
  finalizeManualTeamOverrides,
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

test('hidden record mode blanks the record on the scorebug', () => {
  const overrides = emptyManualTeamOverrides();
  overrides.home = normalizeManualTeamOverride(null, { recordMode: 'hidden' });
  const published = applyManualTeamOverrides({
    away: { name: 'USC', record: '4-1' },
    home: { name: 'Pittsburgh', record: '3-2' },
    game: {}, meta: {},
  }, overrides, null);
  assert.equal(published.home.record, null);
  assert.equal(published.away.record, '4-1');
  assert.equal(published.meta.manualTeamOverrides.home.record, null);
});

test('hidden record mode needs no record text', () => {
  const override = normalizeManualTeamOverride(null, { recordMode: 'hidden', record: 'ignored' });
  assert.equal(override.recordMode, 'hidden');
  assert.equal(override.record, null);
});

test('manual team replaces the previous short name used by scorebug themes', () => {
  const resolver = {
    resolveTeamId(id) {
      return String(id) === '100'
        ? { id: '100', name: 'Texas A&M', nickname: 'Aggies', abbreviation: null }
        : null;
    },
  };
  const overrides = emptyManualTeamOverrides();
  overrides.away = normalizeManualTeamOverride(resolver, { teamId: '100' });
  const published = applyManualTeamOverrides({
    away: { name: 'Appalachian State', shortName: 'APP ST', nickname: 'Mountaineers' },
    home: { name: 'Pittsburgh', shortName: 'PITT' }, game: {}, meta: {},
  }, overrides, resolver);

  assert.equal(published.away.name, 'Texas A&M');
  assert.equal(published.away.shortName, 'Texas A&M');
  assert.equal(published.away.nickname, 'Aggies');
  assert.equal(published.away.nameSource, 'manual-override');
  assert.equal(published.home.shortName, 'PITT', 'the untouched side stays unchanged');
});

test('final manual pass wins over later automatic team and ranked reads', () => {
  const resolver = {
    resolveTeamId(id) {
      return String(id) === '100'
        ? { id: '100', name: 'Texas A&M', nickname: 'Aggies', abbreviation: 'TAMU' }
        : null;
    },
  };
  const overrides = emptyManualTeamOverrides();
  overrides.away = normalizeManualTeamOverride(resolver, {
    teamId: '100', rankMode: 'ranked', rank: 8,
  });
  const afterAutomaticLayers = {
    away: {
      name: 'Appalachian State', shortName: 'APP ST', nickname: 'Mountaineers',
      rank: 21, nameSource: 'ram', rankSource: 'dynasty-save',
      color: '#5d2d2f', logo: 'data:image/png;base64,processed-logo',
    },
    home: { name: 'Pittsburgh', shortName: 'PITT', rank: 6 },
    game: {}, meta: {},
  };
  const published = finalizeManualTeamOverrides(afterAutomaticLayers, overrides, resolver);

  assert.equal(published.away.name, 'Texas A&M');
  assert.equal(published.away.shortName, 'TAMU');
  assert.equal(published.away.rank, 8);
  assert.equal(published.away.nameSource, 'manual-override');
  assert.equal(published.away.rankSource, 'manual-override');
  assert.equal(published.away.color, '#5d2d2f');
  assert.equal(published.away.logo, 'data:image/png;base64,processed-logo');
  assert.equal(published.home.name, 'Pittsburgh');
  assert.equal(published.home.rank, 6);
});

test('final manual unranked and hidden choices cannot be refilled automatically', () => {
  const overrides = emptyManualTeamOverrides();
  overrides.home = normalizeManualTeamOverride(null, {
    rankMode: 'unranked', recordMode: 'hidden',
  });
  const published = finalizeManualTeamOverrides({
    away: { name: 'Texas' },
    home: { name: 'Texas A&M', rank: 12, rankSource: 'ram', record: '10-1', recordSource: 'dynasty-save' },
    game: {}, meta: {},
  }, overrides, null);

  assert.equal(published.home.rank, null);
  assert.equal(published.home.rankSource, 'manual-override');
  assert.equal(published.home.record, null);
  assert.equal(published.home.recordSource, 'manual-override');
});
