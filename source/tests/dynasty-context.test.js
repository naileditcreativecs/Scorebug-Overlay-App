'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { TeamAssetResolver } = require('../src/recognition/team-assets');
const {
  applyManualTeamOverrides,
  emptyManualTeamOverrides,
  normalizeManualTeamOverride,
} = require('../src/manual-team-overrides');
const {
  applyDynastyContext,
  applyDynastyNameFallback,
  applyDynastySideCorrection,
  indexSaveTeams,
  indexSaveTeamsByPresentationId,
  leaderLine,
  registerUnmatchedSaveTeams,
  resolveSaveTeam,
  streakText,
  weekLabel,
} = require('../src/dynasty-context');

const resolver = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));

const context = {
  season: { currentWeek: 12, currentWeekType: 'RegularSeason', seasonYear: 2008, regularSeasonLastWeek: 14, confChampWeek: 15 },
  teams: [
    { index: 95, teamIndex: 75, presentationId: 1186, isTeamBuilder: false, name: 'Pittsburgh', nickname: 'Panthers', wins: 2, losses: 8, ties: 0, confWins: 1, confLosses: 5, mediaRank: 122, coachesRank: 122, cfpRank: 0, streak: -2, offensiveRank: 40, defensiveRank: 103, conferenceIndex: 3, seasonTotals: { games: 10, offYards: 4362, passYards: 2816, rushYards: 1546, firstDowns: 201, penalties: 53, penaltyYards: 400, possessionTime: 16552, thirdDowns: 120, thirdDownConv: 40, turnovers: 10, takeaways: 8, sacks: 20, defPassYards: 2000, defRushYards: 1500 } },
    { index: 20, teamIndex: 21, presentationId: 1120, isTeamBuilder: false, name: 'Cincinnati', nickname: 'Bearcats', wins: 9, losses: 1, ties: 0, confWins: 5, confLosses: 0, mediaRank: 5, coachesRank: 5, cfpRank: 5, streak: 4, offensiveRank: 14, defensiveRank: 13, conferenceIndex: 3, seasonTotals: null },
  ],
  gamesThisWeek: [
    { index: 1, week: 12, weekType: 'RegularSeason', status: 'Unplayed', homeIndex: 20, awayIndex: 95, isRematch: false, gameOfWeek: false, network: 'National', weather: 'Rain', temperature: 48, bowl: null },
  ],
};

test('dynasty context: save teams map to bundled assets and the matchup game is found', () => {
  const byAsset = indexSaveTeams(context, resolver);
  const pitt = resolver.resolve('Pitt') || resolver.resolve('Pittsburgh');
  const cincy = resolver.resolve('Cincinnati');
  assert.ok(pitt && cincy, 'roster has both teams');
  assert.equal(byAsset.get(String(pitt.id))?.name, 'Pittsburgh');
  assert.equal(byAsset.get(String(cincy.id))?.name, 'Cincinnati');
  const payload = { away: { name: 'Pitt', record: null, rank: null }, home: { name: 'Cincinnati', record: null, rank: null }, game: {}, meta: { teamAssets: { away: { id: pitt.id }, home: { id: cincy.id } } } };
  const out = applyDynastyContext(payload, { context, byAsset, leaders: { 20: { qb: { shortName: 'Z. Collaros', passComp: 19, passAtt: 28, passYards: 256, passTds: 3, passInts: 0 } } } });
  assert.equal(out.away.record, '2-8');
  assert.equal(out.away.recordSource, 'dynasty-save');
  assert.equal(out.home.rank, 5);
  assert.equal(out.away.rank, null, 'unranked stays unranked');
  assert.equal(out.away.confRecord, '1-5');
  assert.equal(out.away.streak, 'L2');
  assert.equal(out.home.streak, 'W4');
  assert.equal(out.away.season.offYpg, 436.2);
  assert.equal(out.away.season.thirdDownPct, 33);
  assert.equal(out.home.leaders.qbLine, 'Z. Collaros 19/28, 256 YDS, 3 TD');
  assert.equal(out.game.context.matched, true);
  assert.equal(out.game.context.weekLabel, 'Week 12');
  assert.equal(out.game.context.conferenceGame, true);
  assert.equal(out.game.context.weather, 'Rain');
  // Reader-provided record wins over the save.
  const withRecord = applyDynastyContext({ away: { record: '3-8', rank: 12 }, home: {}, game: {}, meta: { teamAssets: { away: { id: pitt.id }, home: { id: cincy.id } } } }, { context, byAsset });
  assert.equal(withRecord.away.record, '3-8');
  assert.equal(withRecord.away.rank, 12);
  assert.equal(withRecord.away.recordSource, undefined);
});

test('dynasty context: labels and lines', () => {
  assert.equal(weekLabel({ currentWeek: 15, confChampWeek: 15 }, null), 'Conference Championship');
  assert.equal(weekLabel({ currentWeek: 18, currentWeekType: 'BowlSeason2' }, { week: 18, weekType: 'BowlSeason2', bowl: { name: 'Rose Bowl' } }), 'Rose Bowl');
  assert.equal(weekLabel({}, { weekType: 'NationalChampionship' }), 'National Championship');
  assert.equal(leaderLine('rb', { shortName: 'D. Rogers', rushAtt: 14, rushYards: 120, rushTds: 1 }), 'D. Rogers 14 CAR, 120 YDS, 1 TD');
  assert.equal(streakText({ streak: 0 }), null);
});

test('dynasty context: names fall back to the save game, never over a real reader name', () => {
  const ctx = JSON.parse(JSON.stringify(context));
  ctx.userGameIndex = 1;
  ctx.teams[0].isUser = true;
  const byAsset = indexSaveTeams(ctx, resolver);
  const dynasty = { context: ctx, byAsset };
  // Neither name known -> user's game, save orientation (Pitt away at Cincinnati).
  const none = applyDynastyNameFallback({ away: {}, home: {}, game: {}, meta: {} }, dynasty, resolver);
  assert.equal(none.away.nameSource, 'dynasty-save');
  assert.equal(none.home.nameSource, 'dynasty-save');
  assert.match(none.away.name, /Pitt/);
  assert.equal(none.home.name, 'Cincinnati');
  // One name known and flipped relative to the save -> the other side follows, flipped.
  const one = applyDynastyNameFallback({ away: { name: 'Cincinnati' }, home: {}, game: {}, meta: {} }, dynasty, resolver);
  assert.equal(one.away.name, 'Cincinnati');
  assert.equal(one.away.nameSource, undefined);
  assert.match(one.home.name, /Pitt/);
  assert.equal(one.meta.dynastyNameFallback.flipped, true);
  // Both real -> untouched.
  const both = applyDynastyNameFallback({ away: { name: 'Ohio State' }, home: { name: 'Michigan' }, game: {}, meta: {} }, dynasty, resolver);
  assert.equal(both.away.name, 'Ohio State');
  assert.equal(both.meta.dynastyNameFallback, undefined);
});

test('dynasty context: a manual team choice never changes the untouched side', () => {
  const ctx = JSON.parse(JSON.stringify(context));
  ctx.userGameIndex = 1;
  ctx.gamesThisWeek.push({ index: 2, awayIndex: 76, homeIndex: 52, week: 12, weekType: 'RegularSeason' });
  ctx.teams.push(
    { index: 76, presentationId: 1450, isTeamBuilder: false, name: 'Ohio State', nickname: 'Buckeyes' },
    { index: 52, presentationId: 1263, isTeamBuilder: false, name: 'Michigan', nickname: 'Wolverines' },
  );
  const dynasty = { context: ctx, byAsset: indexSaveTeams(ctx, resolver) };

  // The reader has not identified either side yet. Before the override, the
  // save correctly fills the user's Pitt-at-Cincinnati matchup.
  const automatic = applyDynastyNameFallback({ away: {}, home: {}, game: {}, meta: {} }, dynasty, resolver);
  assert.match(automatic.away.name, /Pitt/);
  assert.equal(automatic.home.name, 'Cincinnati');

  // Choosing Ohio State on the away side is display-only. It must not infer
  // Ohio State's scheduled opponent (Michigan) onto the untouched home side.
  const manualAway = applyDynastyNameFallback({
    away: { name: 'Ohio State' }, home: {}, game: {},
    meta: { manualTeamOverrides: { away: { teamId: resolver.resolve('Ohio State').id } } },
  }, dynasty, resolver);
  assert.equal(manualAway.away.name, 'Ohio State');
  assert.equal(manualAway.home.name, 'Cincinnati');
  assert.notEqual(manualAway.home.name, 'Michigan');
  assert.equal(manualAway.meta.dynastyNameFallback.gameIndex, 1);

  // The same side isolation applies in the other direction.
  const manualHome = applyDynastyNameFallback({
    away: {}, home: { name: 'Michigan' }, game: {},
    meta: { manualTeamOverrides: { home: { teamId: resolver.resolve('Michigan').id } } },
  }, dynasty, resolver);
  assert.match(manualHome.away.name, /Pitt/);
  assert.equal(manualHome.home.name, 'Michigan');
  assert.equal(manualHome.meta.dynastyNameFallback.gameIndex, 1);
});

test('dynasty context: live presentation ids choose the exact scheduled save teams', () => {
  const local = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));
  const ctx = JSON.parse(JSON.stringify(context));
  registerUnmatchedSaveTeams(ctx, local);
  const dynasty = {
    context: ctx,
    byAsset: indexSaveTeams(ctx, local),
    byPresentationId: indexSaveTeamsByPresentationId(ctx),
  };
  const out = applyDynastyNameFallback({
    away: { presentationId: 1186, isTeamBuilder: false },
    home: { presentationId: 1120, isTeamBuilder: false },
    game: {},
    meta: {},
  }, dynasty, local);
  assert.match(out.away.name, /Pitt/);
  assert.equal(out.home.name, 'Cincinnati');
  assert.equal(out.away.nameSource, 'dynasty-save');
  assert.equal(out.meta.dynastyNameFallback.method, 'presentation-id');
  assert.equal(out.meta.dynastyNameFallback.gameIndex, 1);
  assert.equal(out.meta.dynastyTeamAssets.away.id, local.resolve('Pittsburgh').id);
  assert.equal(out.meta.dynastyTeamAssets.home.id, local.resolve('Cincinnati').id);

  const conflictingNames = applyDynastyNameFallback({
    away: { name: 'Alabama', nameSource: 'ram', presentationId: 1186, isTeamBuilder: false },
    home: { name: 'Auburn', nameSource: 'ram', presentationId: 1120, isTeamBuilder: false },
    game: {}, meta: {},
  }, dynasty, local);
  assert.match(conflictingNames.away.name, /Pitt/);
  assert.equal(conflictingNames.home.name, 'Cincinnati');
  assert.equal(conflictingNames.away.nameSource, 'dynasty-save');

  // A stale save, duplicate id, or disagreeing TeamBuilder bit cannot rename
  // the scorebug. With no userGame fallback these stay completely untouched.
  const staleContext = JSON.parse(JSON.stringify(context));
  staleContext.gamesThisWeek = [];
  const stale = applyDynastyNameFallback({
    away: { presentationId: 1186, isTeamBuilder: false },
    home: { presentationId: 1120, isTeamBuilder: false },
    game: {}, meta: {},
  }, { context: staleContext, byAsset: dynasty.byAsset, byPresentationId: indexSaveTeamsByPresentationId(staleContext) }, local);
  assert.equal(stale.away.name, undefined);
  assert.equal(stale.meta.dynastyNameFallback, undefined);
  const wrongFlag = applyDynastyNameFallback({
    away: { presentationId: 1186, isTeamBuilder: true },
    home: { presentationId: 1120, isTeamBuilder: false },
    game: {}, meta: {},
  }, dynasty, local);
  assert.equal(wrongFlag.away.name, undefined);
  const ambiguousContext = JSON.parse(JSON.stringify(context));
  ambiguousContext.teams.push({ ...ambiguousContext.teams[0], index: 999 });
  assert.equal(indexSaveTeamsByPresentationId(ambiguousContext).has(1186), false);
  assert.equal(indexSaveTeamsByPresentationId({ teams: [{ presentationId: 2048 }] }).size, 0);
});

test('dynasty context: a reversed playoff identity pair is corrected before publication', () => {
  const local = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));
  const ctx = JSON.parse(JSON.stringify(context));
  ctx.season.currentWeekType = 'Playoff';
  ctx.gamesThisWeek[0].weekType = 'Playoff';
  ctx.gamesThisWeek[0].bowl = { name: 'College Football Playoff', isPlayoff: true };
  registerUnmatchedSaveTeams(ctx, local);
  const dynasty = {
    context: ctx,
    byAsset: indexSaveTeams(ctx, local),
    byPresentationId: indexSaveTeamsByPresentationId(ctx),
  };
  const reversed = {
    away: {
      name: 'Cincinnati', presentationId: 1120, isTeamBuilder: false,
      rank: 5, record: '9-1', timeouts: 2, possession: false, score: 14,
    },
    home: {
      name: 'Pittsburgh', presentationId: 1186, isTeamBuilder: false,
      rank: null, record: '2-8', timeouts: 3, possession: true, score: 7,
    },
    game: {
      clock: '12:34', penaltyFlag: 'home', penaltyTeam: 'home',
      penalty: { type: 'Holding', team: 'home' },
      hudTexts: [{ kind: 'stat', texts: ['B. Stull'], teamSide: 'home' }],
    },
    meta: {
      ramTeamIdentity: {
        away: { presentationId: 1120, isTeamBuilder: false, source: 'ram-scorehud' },
        home: { presentationId: 1186, isTeamBuilder: false, source: 'ram-scorehud' },
      },
    },
  };

  // Two independent reader starts produce the same correction; there is no
  // cache or previous-game orientation involved.
  for (let restart = 0; restart < 2; restart += 1) {
    const corrected = applyDynastySideCorrection(JSON.parse(JSON.stringify(reversed)), dynasty);
    assert.match(corrected.away.name, /Pitt/);
    assert.equal(corrected.home.name, 'Cincinnati');
    assert.equal(corrected.away.presentationId, 1186);
    assert.equal(corrected.home.presentationId, 1120);
    assert.equal(corrected.away.rank, null);
    assert.equal(corrected.home.rank, 5);
    assert.equal(corrected.away.record, '2-8');
    assert.equal(corrected.home.record, '9-1');
    assert.equal(corrected.away.timeouts, 3);
    assert.equal(corrected.home.timeouts, 2);
    assert.equal(corrected.away.possession, true);
    assert.equal(corrected.home.possession, false);
    assert.equal(corrected.away.score, 14, 'core score stays on its original side');
    assert.equal(corrected.home.score, 7, 'core score stays on its original side');
    assert.equal(corrected.game.clock, '12:34');
    assert.equal(corrected.game.penaltyFlag, 'away');
    assert.equal(corrected.game.penaltyTeam, 'away');
    assert.equal(corrected.game.penalty.team, 'away');
    assert.equal(corrected.game.hudTexts[0].teamSide, 'away');
    assert.equal(corrected.meta.ramTeamIdentity.away.presentationId, 1186);
    assert.equal(corrected.meta.dynastySideCorrection.gameIndex, 1);
    assert.deepEqual(corrected.meta.dynastySideCorrection.rawPresentationIds, { away: 1120, home: 1186 });

    const published = applyDynastyNameFallback(corrected, dynasty, local);
    assert.match(published.away.name, /Pitt/);
    assert.equal(published.home.name, 'Cincinnati');
    assert.equal(published.meta.dynastyNameFallback.flipped, false);
  }

  const alreadyCorrect = {
    away: { presentationId: 1186, isTeamBuilder: false },
    home: { presentationId: 1120, isTeamBuilder: false }, game: {}, meta: {},
  };
  assert.equal(applyDynastySideCorrection(alreadyCorrect, dynasty), alreadyCorrect, 'correct orientation is untouched');
  const wrongFlag = {
    away: { presentationId: 1120, isTeamBuilder: true },
    home: { presentationId: 1186, isTeamBuilder: false }, game: {}, meta: {},
  };
  assert.equal(applyDynastySideCorrection(wrongFlag, dynasty), wrongFlag, 'flag mismatch fails closed');

  const partial = applyDynastySideCorrection({
    away: { presentationId: 1120, isTeamBuilder: false, record: '9-1' },
    home: { presentationId: 1186, isTeamBuilder: false }, game: {}, meta: {},
  }, dynasty);
  assert.equal(partial.away.record, undefined, 'a one-sided field is removed from the wrong side');
  assert.equal(partial.home.record, '9-1', 'a one-sided field moves to its scheduled side');

  const corrected = applyDynastySideCorrection(JSON.parse(JSON.stringify(reversed)), dynasty);
  const overrides = emptyManualTeamOverrides();
  overrides.away = normalizeManualTeamOverride(local, { teamId: local.resolve('Ohio State').id });
  const withManualAway = applyDynastyNameFallback(
    applyManualTeamOverrides(corrected, overrides, local), dynasty, local,
  );
  assert.equal(withManualAway.away.name, 'Ohio State', 'manual side remains the top layer');
  assert.equal(withManualAway.home.name, 'Cincinnati', 'orientation correction does not disturb the untouched side');
});

test('dynasty context: a TeamBuilder named like a roster school keeps a separate stable identity', () => {
  const local = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));
  const bundledAlabama = local.resolve('Alabama');
  assert.ok(bundledAlabama);
  const ctx = {
    season: { currentWeek: 1, currentWeekType: 'RegularSeason' },
    teams: [
      { index: 1, presentationId: 1102, isTeamBuilder: false, name: 'Alabama', nickname: 'Crimson Tide' },
      { index: 2, presentationId: 1901, originalId: 1102, isTeamBuilder: true, name: 'Alabama', nickname: 'Forge', abbreviation: 'FORG', primary: '#123456', secondary: '#abcdef' },
      { index: 3, presentationId: 1109, isTeamBuilder: false, name: 'Auburn', nickname: 'Tigers' },
    ],
    gamesThisWeek: [{ index: 8, awayIndex: 2, homeIndex: 3, week: 1, weekType: 'RegularSeason' }],
  };
  const synthesized = registerUnmatchedSaveTeams(ctx, local);
  assert.deepEqual(synthesized.map((team) => team.index), [2]);
  const teamBuilder = local.resolveDynastyTeam(ctx.teams[1]);
  assert.ok(teamBuilder);
  assert.equal(teamBuilder.id, 'dyn-pid-1901');
  assert.equal(teamBuilder.isTeamBuilder, true);
  assert.equal(teamBuilder.primary, '#123456');
  assert.equal(local.resolve('Alabama').id, bundledAlabama.id, 'global roster alias is not stolen');
  const byAsset = indexSaveTeams(ctx, local);
  assert.equal(byAsset.size, 3);
  assert.equal(byAsset.get(teamBuilder.id).index, 2);

  const out = applyDynastyNameFallback({
    away: { presentationId: 1901, isTeamBuilder: true },
    home: { presentationId: 1109, isTeamBuilder: false },
    game: {}, meta: {},
  }, { context: ctx, byAsset, byPresentationId: indexSaveTeamsByPresentationId(ctx) }, local);
  assert.equal(out.meta.dynastyTeamAssets.away.id, 'dyn-pid-1901');
  assert.equal(out.meta.dynastyTeamAssets.home.id, local.resolve('Auburn').id);
});

test('dynasty context: duplicate TeamBuilder names remain two teams by presentation id', () => {
  const local = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));
  const ctx = {
    teams: [
      { index: 10, presentationId: 1601, isTeamBuilder: true, name: 'Metro Owls', nickname: 'Owls', primary: '#111111' },
      { index: 11, presentationId: 1602, isTeamBuilder: true, name: 'Metro Owls', nickname: 'Owls', primary: '#222222' },
    ],
    gamesThisWeek: [{ index: 1, awayIndex: 10, homeIndex: 11 }],
  };
  assert.equal(registerUnmatchedSaveTeams(ctx, local).length, 2);
  const first = local.resolveDynastyTeam(ctx.teams[0]);
  const second = local.resolveDynastyTeam(ctx.teams[1]);
  assert.ok(first && second);
  assert.notEqual(first.id, second.id);
  assert.equal(first.primary, '#111111');
  assert.equal(second.primary, '#222222');
  assert.equal(indexSaveTeams(ctx, local).size, 2);
  assert.equal(local.resolve('Metro Owls'), null, 'ambiguous dynamic name has no global alias');

  const legacyContext = {
    teams: [
      ...ctx.teams,
      { index: 12, presentationId: 1109, isTeamBuilder: false, name: 'Auburn', nickname: 'Tigers' },
      { index: 13, presentationId: 1131, isTeamBuilder: false, name: 'Florida', nickname: 'Gators' },
    ],
    gamesThisWeek: [
      { index: 1, awayIndex: 10, homeIndex: 12 },
      { index: 2, awayIndex: 11, homeIndex: 13 },
    ],
  };
  registerUnmatchedSaveTeams(legacyContext, local);
  const legacy = applyDynastyNameFallback({
    away: { name: 'Metro Owls', nameSource: 'ram' }, home: {}, game: {}, meta: {},
  }, {
    context: legacyContext,
    byAsset: indexSaveTeams(legacyContext, local),
    byPresentationId: indexSaveTeamsByPresentationId(legacyContext),
  }, local);
  assert.equal(legacy.home.name, undefined, 'one ambiguous name cannot choose either opponent');
});

test('dynasty context: reloading custom teams before the save gives custom art precedence', () => {
  const saveTeam = { index: 5, presentationId: 1605, isTeamBuilder: true, name: 'Idaho', nickname: 'Vandals', abbreviation: 'IDHO' };
  for (const customFirst of [false, true]) {
    const local = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));
    if (!customFirst) {
      registerUnmatchedSaveTeams({ teams: [saveTeam] }, local);
      assert.equal(local.resolveDynastyTeam(saveTeam)?.source, 'dynasty-save');
      local.setDynastyTeams([]);
    }
    local.setCustomTeams([{ id: 'custom-idaho', name: 'Idaho', nickname: 'Vandals', abbreviation: 'IDHO', primary: '#ff0000' }]);
    const synthesized = registerUnmatchedSaveTeams({ teams: [saveTeam] }, local);
    assert.deepEqual(synthesized, []);
    assert.equal(resolveSaveTeam(saveTeam, local)?.id, 'custom-idaho');
    assert.equal(local.resolve('Idaho')?.id, 'custom-idaho');
  }
});

test('dynasty context: one custom asset never guesses between multiple claiming save teams', () => {
  const scenarios = [
    [
      { index: 10, presentationId: 1601, isTeamBuilder: true, name: 'Metro Owls', nickname: 'Owls' },
      { index: 11, presentationId: 1602, isTeamBuilder: true, name: 'Metro Owls', nickname: 'Owls' },
    ],
    [
      { index: 10, presentationId: 1601, isTeamBuilder: true, name: 'Metro East', longName: 'Metro Owls', nickname: 'Owls' },
      { index: 11, presentationId: 1602, isTeamBuilder: true, name: 'Metro West', longName: 'Metro Owls', nickname: 'Owls' },
    ],
    [
      { index: 10, presentationId: 1601, isTeamBuilder: true, name: 'Metro East', abbreviation: 'MOW', nickname: 'Owls' },
      { index: 11, presentationId: 1602, isTeamBuilder: true, name: 'Metro West', abbreviation: 'MOW', nickname: 'Owls' },
    ],
  ];
  for (const rows of scenarios) {
    for (const teams of [rows, [...rows].reverse()]) {
      const local = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));
      local.setCustomTeams([{ id: 'custom-metro', name: 'Metro Owls', abbreviation: 'MOW', nickname: 'Owls', primary: '#ff00ff' }]);
      const synthesized = registerUnmatchedSaveTeams({ teams }, local);
      assert.equal(synthesized.length, 2);
      for (const team of rows) {
        const asset = resolveSaveTeam(team, local);
        assert.equal(asset?.source, 'dynasty-save');
        assert.notEqual(asset?.id, 'custom-metro');
      }
    }
  }
});

test('dynasty context: every save team gets an identity - unknown schools are synthesized from the save', () => {
  const ctx = JSON.parse(JSON.stringify(context));
  ctx.teams.push(
    { index: 30, teamIndex: 30, name: 'FCS East', nickname: 'Sentinels', abbreviation: 'FCSE', longName: 'FCS East', primary: '#000a26', secondary: '#af975a', wins: 0, losses: 0 },
    { index: 124, teamIndex: 111, name: 'Idaho', nickname: 'Vandals', abbreviation: 'IDHO', longName: 'Idaho', primary: '#8a2432', secondary: '#ffffff', wins: 1, losses: 0 },
    // A roster team present in the save keeps its bundled identity.
    { index: 140, teamIndex: 140, name: 'Ohio State', nickname: 'Buckeyes', abbreviation: 'OSU', primary: '#bb0000', secondary: '#666666' },
  );
  ctx.gamesThisWeek.push({ index: 2, week: 12, weekType: 'RegularSeason', status: 'Unplayed', homeIndex: 124, awayIndex: 30, bowl: null });
  const synthesized = registerUnmatchedSaveTeams(ctx, resolver);
  assert.deepEqual(synthesized.map((t) => t.name), ['FCS East', 'Idaho']);
  const byAsset = indexSaveTeams(ctx, resolver);
  assert.equal(byAsset.size, ctx.teams.length, 'every save team is indexed');
  const idaho = resolver.resolve('Idaho');
  assert.ok(idaho, 'Idaho now resolves');
  assert.equal(idaho.source, 'dynasty-save');
  assert.equal(idaho.primary, '#8a2432');
  assert.equal(idaho.abbreviation, 'IDHO');
  assert.equal(idaho.logo, null, 'no logo is invented');
  assert.equal(resolver.resolve('IDHO')?.name, 'Idaho', 'abbreviation resolves too');
  assert.equal(resolver.resolve('FCS East')?.nickname, 'Sentinels');
  assert.equal(resolver.resolve('Ohio State')?.id, '76', 'roster team untouched');
  // A reader name no team owns is filled from the save game of the known side.
  const dynasty = { context: ctx, byAsset };
  const out = applyDynastyNameFallback({ away: { name: 'FCS East' }, home: { name: '###@@' }, game: {}, meta: {} }, dynasty, resolver);
  assert.equal(out.home.name, 'Idaho');
  assert.equal(out.home.nameSource, 'dynasty-save');
  assert.equal(out.away.nameSource, undefined);
  // Re-registering clears the old synthesized set.
  registerUnmatchedSaveTeams({ teams: [] }, resolver);
  assert.equal(resolver.resolve('Idaho'), null);
});

test('dynasty context: save names never drift to a look-alike roster team', () => {
  const name = (n, k) => resolveSaveTeam({ name: n, nickname: k }, resolver)?.name ?? null;
  // Game spellings of roster teams resolve.
  assert.equal(name('NIU', 'Huskies'), 'Northern Illinois');
  assert.equal(name('App St.', 'Mountaineers'), 'Appalachian State');
  assert.equal(name('Miami (OH)', 'RedHawks'), 'Miami of Ohio');
  assert.equal(name('C. Carolina', 'Chanticleers'), 'Coastal Carolina');
  assert.equal(name('FLA Atlantic', 'Owls'), 'FAU');
  assert.equal(name('Louisiana', "Ragin' Cajuns"), 'UL Lafayette');
  assert.equal(name('UConn', 'Huskies'), 'Connecticut');
  // Schools the roster does not have stay unmatched (they become save-only teams).
  assert.equal(name('Eastern Washington', 'Eagles'), null);
  assert.equal(name('South Dakota', 'Gamecocks'), null);
  assert.equal(name('Delaware State', 'Hornets'), null);
  assert.equal(name('Weber State', 'Wildcats'), null);
  assert.equal(name('Idaho', 'Vandals'), null);
});
