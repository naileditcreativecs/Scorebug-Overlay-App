'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyScorebugColorPreset,
  applyScorebugColors,
  deleteScorebugColorPreset,
  normalizeScorebugColors,
  upsertScorebugColorPreset,
} = require('../src/scorebug-colors');

function payload() {
  return {
    away: { name: 'USC', color: '#991b1e' },
    home: { name: 'Pittsburgh', color: '#003263' },
    game: {},
    meta: {},
  };
}

test('auto mode leaves the bundled team colors untouched', () => {
  const state = applyScorebugColors(payload(), normalizeScorebugColors(null));
  assert.equal(state.away.color, '#991b1e');
  assert.equal(state.home.color, '#003263');
  assert.equal(state.meta.scorebugColors, undefined);
});

test('a pinned custom color wins over the team primary', () => {
  const state = applyScorebugColors(payload(), {
    away: { mode: 'custom', color: '#FFFFFF' },
    home: { mode: 'auto' },
  });
  assert.equal(state.away.color, '#ffffff');
  assert.equal(state.home.color, '#003263');
  assert.deepEqual(state.meta.scorebugColors, { away: '#ffffff' });
});

test('a custom mode without a usable color falls back to auto', () => {
  const normalized = normalizeScorebugColors({
    away: { mode: 'custom', color: 'not-a-color' },
  });
  assert.deepEqual(normalized.away, { mode: 'auto', color: null });
});

test('presets round-trip: save, apply, delete', () => {
  let colors = normalizeScorebugColors(null);
  colors = upsertScorebugColorPreset(colors, 'Rivalry', '#111111', '#eeeeee');
  assert.equal(colors.presets.length, 1);

  const applied = applyScorebugColorPreset(colors, 'rivalry');
  assert.deepEqual(applied.away, { mode: 'custom', color: '#111111' });
  assert.deepEqual(applied.home, { mode: 'custom', color: '#eeeeee' });

  const removed = deleteScorebugColorPreset(applied, 'Rivalry');
  assert.equal(removed.presets.length, 0);
  assert.throws(() => applyScorebugColorPreset(removed, 'Rivalry'), /no longer exists/);
});

test('saving over an existing preset name replaces it instead of duplicating', () => {
  let colors = upsertScorebugColorPreset(normalizeScorebugColors(null), 'Night', '#111111', '#222222');
  colors = upsertScorebugColorPreset(colors, 'night', '#333333', '#444444');
  assert.equal(colors.presets.length, 1);
  assert.equal(colors.presets[0].away, '#333333');
});

test('a preset without both colors is rejected', () => {
  assert.throws(
    () => upsertScorebugColorPreset(normalizeScorebugColors(null), 'Broken', '#123456', 'nope'),
    /both team colors/i,
  );
});

test('malformed preset entries are dropped on normalization', () => {
  const normalized = normalizeScorebugColors({
    presets: [
      { name: 'Good', away: '#101010', home: '#202020' },
      { name: '', away: '#101010', home: '#202020' },
      { name: 'Bad', away: 'red', home: '#202020' },
      null,
    ],
  });
  assert.equal(normalized.presets.length, 1);
  assert.equal(normalized.presets[0].name, 'Good');
});


const {
  applyScorebugColors: applyWithRules,
  removeScorebugColorRule,
  resolveScorebugColors,
  upsertScorebugColorRule,
} = require('../src/scorebug-colors');

test('team rules follow the team; matchup beats team; theme is the fallback; pin below all', () => {
  let colors = upsertScorebugColorRule(null, { scope: 'team', teamId: 'army', color: '#111111' });
  colors = upsertScorebugColorRule(colors, { scope: 'theme', themeId: 'fox', away: '#222222', home: '#333333' });
  // Army away on the FOX bug: team rule wins for away; theme rule fills home.
  let r = resolveScorebugColors(colors, { awayTeamId: 'army', homeTeamId: 'bama', themeId: 'fox' });
  assert.deepStrictEqual([r.away, r.home], [{ color: '#111111', source: 'team' }, { color: '#333333', source: 'theme' }]);
  // Same team playing at home: the rule follows it.
  r = resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'army', themeId: 'other' });
  assert.deepStrictEqual(r.home, { color: '#111111', source: 'team' });
  assert.deepStrictEqual(r.away, { color: null, source: 'auto' });
  // A matchup rule beats the team rule for exactly that pairing only.
  colors = upsertScorebugColorRule(colors, { scope: 'matchup', awayTeamId: 'army', homeTeamId: 'bama', away: '#444444', home: '#555555' });
  r = resolveScorebugColors(colors, { awayTeamId: 'army', homeTeamId: 'bama', themeId: 'fox' });
  assert.deepStrictEqual([r.away.source, r.home.source], ['matchup', 'matchup']);
  r = resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'army', themeId: 'fox' });
  assert.deepStrictEqual([r.away.source, r.home.source], ['theme', 'team']);
  // Legacy side pin sits below every rule but above auto.
  colors.away = { mode: 'custom', color: '#666666' };
  r = resolveScorebugColors(colors, { awayTeamId: 'nobody', homeTeamId: 'nobody2', themeId: 'plain' });
  assert.deepStrictEqual(r.away, { color: '#666666', source: 'pin' });
});

test('rules upsert by identity, remove by identity, and apply through applyScorebugColors', () => {
  let colors = upsertScorebugColorRule(null, { scope: 'team', teamId: 'army', color: '#111111' });
  colors = upsertScorebugColorRule(colors, { scope: 'team', teamId: 'army', color: '#999999' });
  assert.strictEqual(colors.rules.length, 1);
  assert.strictEqual(colors.rules[0].color, '#999999');
  const payload = { away: { color: '#abcdef' }, home: {}, game: {}, meta: { teamAssets: { away: { id: 'army' }, home: { id: 'bama' } } } };
  applyWithRules(payload, colors, { themeId: 'fox' });
  assert.strictEqual(payload.away.color, '#999999');
  assert.strictEqual(payload.home.color, undefined);
  colors = removeScorebugColorRule(colors, { scope: 'team', teamId: 'army' });
  assert.strictEqual(colors.rules.length, 0);
  // Garbage rules are dropped, never thrown at publish time.
  assert.deepStrictEqual(require('../src/scorebug-colors').normalizeScorebugColors({ rules: [{ scope: 'team' }, { scope: 'nope', teamId: 'x', color: '#000000' }] }).rules, []);
});

test('mix and match: qualified team rules beat plain ones and only apply in their context', () => {
  const { resolveScorebugColors, upsertScorebugColorRule, ruleAppliesInContext } = require('../src/scorebug-colors');
  let colors = upsertScorebugColorRule(null, { scope: 'team', teamId: 'bama', color: '#111111' });
  colors = upsertScorebugColorRule(colors, { scope: 'team', teamId: 'bama', color: '#222222', themeId: 'espn' });
  colors = upsertScorebugColorRule(colors, { scope: 'team', teamId: 'bama', color: '#333333', awayTeamId: 'bama', homeTeamId: 'aub' });
  colors = upsertScorebugColorRule(colors, { scope: 'team', teamId: 'bama', color: '#444444', awayTeamId: 'bama', homeTeamId: 'aub', themeId: 'espn' });
  colors = upsertScorebugColorRule(colors, { scope: 'matchup', awayTeamId: 'bama', homeTeamId: 'aub', home: '#555555', themeId: 'fox' });
  assert.equal(colors.rules.length, 5, 'qualified rules are distinct identities');
  // Plain context: only the unqualified team rule.
  assert.equal(resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'lsu', themeId: 'fox' }).away.color, '#111111');
  // On the ESPN bug the bug-qualified rule wins.
  assert.equal(resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'lsu', themeId: 'espn' }).away.color, '#222222');
  // Matchup-qualified beats bug-qualified; matchup+bug beats both.
  assert.equal(resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'aub', themeId: 'fox' }).away.color, '#333333');
  assert.equal(resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'aub', themeId: 'espn' }).away.color, '#444444');
  // Bug-qualified matchup rule for the home side only on FOX.
  assert.equal(resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'aub', themeId: 'fox' }).home.color, '#555555');
  assert.equal(resolveScorebugColors(colors, { awayTeamId: 'bama', homeTeamId: 'aub', themeId: 'espn' }).home.color, null);
  // Context filter used by the editor's tag list.
  assert.equal(ruleAppliesInContext(colors.rules[1], { awayTeamId: 'bama', homeTeamId: 'lsu', themeId: 'fox' }), false);
  assert.equal(ruleAppliesInContext(colors.rules[1], { awayTeamId: 'bama', homeTeamId: 'lsu', themeId: 'espn' }), true);
  // Legacy shape (no qualifiers) still normalizes unchanged.
  const legacy = upsertScorebugColorRule(null, { scope: 'matchup', awayTeamId: 'a', homeTeamId: 'b', away: '#abcdef', home: null });
  assert.deepEqual(legacy.rules[0], { scope: 'matchup', awayTeamId: 'a', homeTeamId: 'b', away: '#abcdef', home: null });
});
