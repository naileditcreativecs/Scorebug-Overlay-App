'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { TeamAssetResolver } = require('../src/recognition/team-assets');
const {
  resolveScoreboardTeamIdentity,
  scoreboardTeamOptions,
} = require('../src/scoreboard-team-policy');
const {
  applyManualTeamOverrides,
  emptyManualTeamOverrides,
} = require('../src/manual-team-overrides');

const appRoot = path.resolve(__dirname, '..');
const resolver = TeamAssetResolver.fromAppRoot(appRoot);

test('Western Michigan aliases always publish the full canonical name', () => {
  for (const observed of ['Western Michigan', 'W. Michigan', 'W MICHIGAN', 'WMU']) {
    const identity = resolveScoreboardTeamIdentity(resolver, observed);
    assert.equal(String(identity?.asset?.id), '127', observed);
    assert.equal(identity?.asset?.name, 'Western Michigan', observed);
    assert.equal(identity?.name, 'Western Michigan', observed);
  }
  const option = scoreboardTeamOptions(resolver).find((team) => team.id === '127');
  assert.equal(option?.name, 'Western Michigan');
});

test('Western Michigan canonicalization does not absorb other western teams', () => {
  const westernKentucky = resolveScoreboardTeamIdentity(resolver, 'W. Kentucky');
  assert.equal(String(westernKentucky?.asset?.id), '126');
  assert.equal(westernKentucky?.name, 'W. Kentucky');
  const westernCarolina = resolveScoreboardTeamIdentity(resolver, 'W. Carolina');
  assert.notEqual(String(westernCarolina?.asset?.id || ''), '127');
});

test('manual Western Michigan selection uses the full canonical name everywhere', () => {
  const overrides = emptyManualTeamOverrides();
  overrides.away.teamId = '127';
  const payload = applyManualTeamOverrides({
    away: { name: 'Away' },
    home: { name: 'Home' },
    game: {},
    meta: {},
  }, overrides, resolver);
  assert.equal(payload.away.name, 'Western Michigan');
  assert.equal(payload.meta.manualTeamOverrides.away.name, 'Western Michigan');
  assert.equal(resolver.resolveTeamId('127').name, 'Western Michigan');
});

