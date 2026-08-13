'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { TeamAssetResolver, preferredTeamLogo } = require('../src/recognition/team-assets');
const { TeamLogoVariantResolver } = require('../src/team-logo-variants');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/team-logos/manifest.json'), 'utf8'));
const nicknames = JSON.parse(fs.readFileSync(path.join(root, 'assets/team-nicknames.json'), 'utf8'));
const variantManifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/team-logo-variants/manifest.json'), 'utf8'));
const resolver = new TeamAssetResolver(manifest, path.join(root, 'assets/team-logos'), nicknames);
const variants = new TeamLogoVariantResolver(variantManifest, path.join(root, 'assets/team-logo-variants'));

test('every bundled team resolves by name and by id', () => {
  const failures = [];
  for (const team of manifest.teams) {
    if (!resolver.resolveTeamId(String(team.id))) failures.push(`${team.name} (by id)`);
    if (!resolver.resolve(team.name)) failures.push(`${team.name} (by name)`);
  }
  assert.deepEqual(failures, []);
});

test('every bundled team with a logo file produces a usable logo end to end', () => {
  const failures = [];
  for (const team of manifest.teams) {
    if (!team.file) continue; // detection-only roster additions have no art
    const asset = resolver.resolveTeamId(String(team.id));
    if (!asset?.logo || asset.logo.length < 500) {
      failures.push(`${team.name}: base logo missing or tiny`);
      continue;
    }
    if (!preferredTeamLogo(asset, null)) failures.push(`${team.name}: preferred logo null`);
    const choices = variants.choicesForTeam(String(team.id), resolver);
    const fallback = choices.find((choice) => choice.id === 'default');
    if (!fallback?.logo) failures.push(`${team.name}: no default variant choice`);
  }
  assert.deepEqual(failures, []);
});

test('every bundled logo file exists and parses as a PNG with sane dimensions', () => {
  const failures = [];
  for (const team of manifest.teams) {
    if (!team.file) continue;
    const file = path.join(root, 'assets/team-logos', team.file);
    if (!fs.existsSync(file)) { failures.push(`${team.name}: file missing`); continue; }
    const bytes = fs.readFileSync(file);
    const isPng = bytes.length > 33 && bytes.readUInt32BE(0) === 0x89504e47;
    const width = isPng ? bytes.readUInt32BE(16) : 0;
    const height = isPng ? bytes.readUInt32BE(20) : 0;
    if (!isPng || width < 16 || height < 16 || bytes.length < 500) {
      failures.push(`${team.name}: ${team.file} not a usable PNG (${bytes.length}b ${width}x${height})`);
    }
  }
  assert.deepEqual(failures, []);
});
