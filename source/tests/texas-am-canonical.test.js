'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { TeamAssetResolver } = require('../src/recognition/team-assets');
const { resolveScoreboardTeamIdentity } = require('../src/scoreboard-team-policy');
const {
  applyManualTeamOverrides,
  emptyManualTeamOverrides,
} = require('../src/manual-team-overrides');

const resolver = TeamAssetResolver.fromAppRoot(path.resolve(__dirname, '..'));

test('Texas A&M authored, OCR, and abbreviation variants resolve to the Aggies', () => {
  for (const observed of [
    'Texas A&M', 'TEXAS A&M', 'Texas A and M', 'Texas A M', 'Texas AM', 'TAMU', 'A&M',
  ]) {
    const identity = resolveScoreboardTeamIdentity(resolver, observed);
    assert.equal(String(identity?.asset?.id), '100', observed);
    assert.equal(identity?.asset?.name, 'Texas A&M', observed);
    assert.equal(identity?.asset?.nickname, 'Aggies', observed);
    assert.notEqual(identity?.asset?.name, 'FAU', observed);
  }
});

test('Texas A&M aliases do not steal Texas or the proven AEM scoreboard rule', () => {
  assert.equal(String(resolveScoreboardTeamIdentity(resolver, 'Texas')?.asset?.id), '99');
  assert.equal(String(resolveScoreboardTeamIdentity(resolver, 'AEM')?.asset?.id), '99');
  assert.equal(String(resolveScoreboardTeamIdentity(resolver, 'FAU')?.asset?.id), '31');
});

test('manual Texas A&M selection publishes the canonical team and logo asset', () => {
  const overrides = emptyManualTeamOverrides();
  overrides.away.teamId = '100';
  const payload = applyManualTeamOverrides({
    away: { name: 'Away' }, home: { name: 'Home' }, game: {}, meta: {},
  }, overrides, resolver);
  const asset = resolver.resolveTeamId('100');
  assert.equal(payload.away.name, 'Texas A&M');
  assert.equal(payload.away.nickname, 'Aggies');
  assert.match(asset.logo, /^data:image\/png;base64,/);
});
