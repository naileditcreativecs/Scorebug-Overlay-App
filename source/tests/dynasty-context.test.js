'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { TeamAssetResolver } = require('../src/recognition/team-assets');
const { applyDynastyContext, indexSaveTeams, weekLabel, leaderLine, streakText } = require('../src/dynasty-context');

const resolver = TeamAssetResolver.fromAppRoot(path.join(__dirname, '..'));

const context = {
  season: { currentWeek: 12, currentWeekType: 'RegularSeason', seasonYear: 2008, regularSeasonLastWeek: 14, confChampWeek: 15 },
  teams: [
    { index: 95, teamIndex: 75, name: 'Pittsburgh', nickname: 'Panthers', wins: 2, losses: 8, ties: 0, confWins: 1, confLosses: 5, mediaRank: 122, coachesRank: 122, cfpRank: 0, streak: -2, offensiveRank: 40, defensiveRank: 103, conferenceIndex: 3, seasonTotals: { games: 10, offYards: 4362, passYards: 2816, rushYards: 1546, firstDowns: 201, penalties: 53, penaltyYards: 400, possessionTime: 16552, thirdDowns: 120, thirdDownConv: 40, turnovers: 10, takeaways: 8, sacks: 20, defPassYards: 2000, defRushYards: 1500 } },
    { index: 20, teamIndex: 21, name: 'Cincinnati', nickname: 'Bearcats', wins: 9, losses: 1, ties: 0, confWins: 5, confLosses: 0, mediaRank: 5, coachesRank: 5, cfpRank: 5, streak: 4, offensiveRank: 14, defensiveRank: 13, conferenceIndex: 3, seasonTotals: null },
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
