'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeCustomTeams,
  removeCustomTeam,
  upsertCustomTeam,
} = require('../src/custom-teams');
const { TeamAssetResolver } = require('../src/recognition/team-assets');
const { scoreboardTeamOptions, resolveScoreboardTeamIdentity } = require('../src/scoreboard-team-policy');
const { applyManualTeamOverrides, normalizeManualTeamOverride } = require('../src/manual-team-overrides');

const appRoot = path.join(__dirname, '..');
const makeId = () => 'abcdef123456';

test('custom teams: upsert mints an id, validates, and rejects duplicates', () => {
  const created = upsertCustomTeam([], {
    name: '  Kansas City  Roos ', nickname: 'Roos', abbreviation: 'kc', primary: '#1E3A8A', secondary: '',
  }, { makeId });
  assert.equal(created.team.id, 'ct-abcdef123456');
  assert.equal(created.team.name, 'Kansas City Roos');
  assert.equal(created.team.abbreviation, 'KC');
  assert.equal(created.team.primary, '#1e3a8a');
  assert.equal(created.team.secondary, null);
  assert.equal(created.team.logoFile, null);

  assert.throws(() => upsertCustomTeam(created.teams, { name: 'kansas city roos' }, { makeId: () => 'ffffffffffff' }), /already have/);
  assert.throws(() => upsertCustomTeam(created.teams, { name: 'X', primary: 'blue' }, { makeId: () => 'ffffffffffff' }), /#1a2b3c/);
  assert.throws(() => upsertCustomTeam(created.teams, { name: '   ' }, { makeId: () => 'ffffffffffff' }), /name/);
  assert.throws(() => upsertCustomTeam(created.teams, { id: 'ct-nope00000000', name: 'X' }), /no longer exists/);

  // Editing keeps unspecified fields (logo survives a name change).
  const withLogo = upsertCustomTeam(created.teams, { id: created.team.id, name: 'Roos', logoFile: 'ct-abcdef123456.png', logoWidth: 100, logoHeight: 80 });
  const renamed = upsertCustomTeam(withLogo.teams, { id: created.team.id, name: 'UMKC Roos' });
  assert.equal(renamed.team.logoFile, 'ct-abcdef123456.png');
  assert.equal(renamed.team.logoWidth, 100);
  assert.equal(renamed.team.name, 'UMKC Roos');
  assert.equal(renamed.teams.length, 1);

  const removed = removeCustomTeam(renamed.teams, created.team.id);
  assert.equal(removed.removed.name, 'UMKC Roos');
  assert.deepEqual(removed.teams, []);
});

test('custom teams: normalize drops malformed rows and duplicates', () => {
  const teams = normalizeCustomTeams([
    { id: 'ct-abcdef123456', name: 'A', logoFile: '../evil.png' },
    { id: 'ct-abcdef123456', name: 'A again' },
    { id: 'bad', name: 'B' },
    null,
    { id: 'ct-abcdef123457', name: '', primary: '#000000' },
  ]);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].logoFile, null);
});

test('custom teams: resolver exposes them like roster teams, exact-name only', () => {
  const resolver = TeamAssetResolver.fromAppRoot(appRoot);
  const before = resolver.byId.size;
  const logoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb27-custom-'));
  // A 1x1 transparent PNG so the data URL path is exercised.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(logoRoot, 'ct-abcdef123456.png'), png);
  const teams = [
    { id: 'ct-abcdef123456', name: 'Kansas City Roos', abbreviation: 'KC', primary: '#1e3a8a', secondary: '#ffffff', logoFile: 'ct-abcdef123456.png', logoWidth: 1, logoHeight: 1 },
    // Same name as a bundled team: selectable by id, but must NOT steal the roster alias.
    { id: 'ct-abcdef123457', name: 'Alabama', primary: '#000000' },
  ];
  resolver.setCustomTeams(teams, logoRoot);
  assert.equal(resolver.byId.size, before + 2);
  assert.ok(resolver.isCustomTeam('ct-abcdef123456'));

  const asset = resolver.resolveTeamId('ct-abcdef123456');
  assert.equal(asset.name, 'Kansas City Roos');
  assert.equal(asset.primary, '#1e3a8a');
  assert.equal(asset.source, 'custom');
  assert.match(asset.logo, /^data:image\/png;base64,/);
  assert.equal(resolver.resolve('kansas city roos')?.id, 'ct-abcdef123456');
  assert.equal(resolver.resolve('KC')?.id, 'ct-abcdef123456');
  assert.notEqual(resolver.resolve('Alabama')?.id, 'ct-abcdef123457');

  // Scoreboard identity (what publishing uses) resolves the custom name exactly.
  const identity = resolveScoreboardTeamIdentity(resolver, 'Kansas City Roos', null);
  assert.equal(identity.asset.id, 'ct-abcdef123456');
  assert.equal(identity.match, 'exact');

  // Options list flags them so the editor can group them.
  const options = scoreboardTeamOptions(resolver);
  assert.ok(options.find((team) => team.id === 'ct-abcdef123456' && team.custom === true));
  assert.ok(options.find((team) => team.name === 'Alabama' && team.custom === false));

  // Manual override accepts the custom id and publishes its name.
  const override = normalizeManualTeamOverride(resolver, { teamId: 'ct-abcdef123456' });
  const payload = applyManualTeamOverrides({ away: { name: 'Air Force' }, home: {}, game: {}, meta: {} }, { away: override }, resolver);
  assert.equal(payload.away.name, 'Kansas City Roos');

  // Replacing the set removes the old ones cleanly.
  resolver.setCustomTeams([], logoRoot);
  assert.equal(resolver.byId.size, before);
  assert.equal(resolver.resolveTeamId('ct-abcdef123456'), null);
  assert.equal(resolver.resolve('KC'), null);
  fs.rmSync(logoRoot, { recursive: true, force: true });
});
