'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AutomaticDataExtractor,
  classifyScreenText,
  exportableScoreboardState,
  normalizedScoreboardState,
} = require('../src/automatic-data-extractor');

test('normalizes the scoreboard without logos or renderer-only metadata', () => {
  assert.deepEqual(normalizedScoreboardState({
    away: { name: 'Texas', score: 7, possession: true, logo: 'large-data-url' },
    home: { name: 'Ohio State', score: 3 },
    game: { quarter: '2nd', clock: '4:17', down: 3, distance: 7 },
    meta: { visible: true, confidence: 0.9, updatedAt: '2026-08-09T00:00:00.000Z' },
  }), {
    capturedAt: '2026-08-09T00:00:00.000Z',
    awayRank: null,
    awayName: 'Texas',
    awayRecord: null,
    awayScore: 7,
    awayTimeouts: null,
    homeRank: null,
    homeName: 'Ohio State',
    homeRecord: null,
    homeScore: 3,
    homeTimeouts: null,
    quarter: '2nd',
    gameClock: '4:17',
    playClock: null,
    down: 3,
    distance: 7,
    downDistance: null,
    ballOn: null,
    gameStatus: null,
    possession: 'away',
    visible: true,
    confidence: 0.9,
  });
});

test('classifies touchdown, penalty, and statistics text', () => {
  assert.deepEqual(classifyScreenText('TOUCHDOWN\nA. PLAYER 12 YARDS').categories, ['touchdown']);
  const penalty = classifyScreenText('PENALTY - HOLDING - 10 YARDS - ACCEPTED');
  assert.ok(penalty.categories.includes('penalty'));
  assert.equal(penalty.penaltyType, 'holding');
  assert.equal(penalty.penaltyDecision, 'accepted');
  assert.equal(penalty.penaltyYards, 10);
  assert.ok(classifyScreenText('PASSING ATT CMP YDS TD INT').categories.includes('passing-stats'));
  assert.ok(classifyScreenText('RUSHING CAR YDS AVG TD').categories.includes('rushing-stats'));
});

test('keeps future scoreboard fields in JSON while removing embedded image data', () => {
  const value = exportableScoreboardState({
    away: { name: 'Texas', score: 7, logo: 'data:image/png;base64,large' },
    game: { clock: '4:17', futureField: 'kept' },
    meta: { updatedAt: '2026-08-09T00:00:00.000Z' },
  });
  assert.equal(value.away.logo, undefined);
  assert.equal(value.game.futureField, 'kept');
});

test('writes changed scoreboard rows and creates a touchdown context event', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb27-data-extractor-'));
  let now = Date.parse('2026-08-09T00:00:00.000Z');
  const extractor = new AutomaticDataExtractor({ rootPath: root, now: () => now, sessionId: 'test-session' });
  const state = (score) => ({
    away: { name: 'Texas', score, possession: true },
    home: { name: 'Ohio State', score: 0 },
    game: { quarter: '1st', clock: '12:00' },
    meta: { visible: true, updatedAt: new Date(now).toISOString() },
  });
  extractor.observeScoreboard(state(0));
  now += 1_000;
  extractor.observeScoreboard(state(6));
  extractor.observeScoreboard(state(6));
  assert.equal(extractor.snapshot().counts.scoreboardRows, 2);
  assert.equal(extractor.snapshot().counts.events, 1);
  assert.equal(extractor.needsContextCapture(now), true);
  const csv = fs.readFileSync(extractor.scoreboardPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(csv.length, 3);
  const jsonl = fs.readFileSync(extractor.scoreboardJsonlPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(jsonl.length, 2);
  assert.equal(jsonl[1].scoreboard.away.score, 6);
  assert.equal(JSON.parse(fs.readFileSync(extractor.latestScoreboardPath, 'utf8')).away.score, 6);
  const live = JSON.parse(fs.readFileSync(extractor.liveScoreboardPath, 'utf8'));
  assert.equal(live.away.name, 'Texas');
  assert.equal(live.away.score, 6);
  assert.equal(live.away.possession, true);
  assert.equal(live.home.name, 'Ohio State');
  assert.equal(live.home.score, 0);
  assert.equal(live.game.quarter, '1st');
  assert.equal(live.game.clock, '12:00');
  assert.equal(extractor.snapshot().liveScoreboardPath, path.join(root, 'live-scoreboard.json'));
  const events = fs.readFileSync(extractor.eventsPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events[1].likelyType, 'touchdown-candidate');
});

test('keeps a separate always-current screen seed for RAM discovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb27-screen-seed-'));
  const extractor = new AutomaticDataExtractor({ rootPath: root, sessionId: 'screen-seed-session' });
  extractor.observeScreenScoreboard({
    away: { name: 'Marshall', score: 7 },
    home: { name: 'TCU', score: 3 },
    game: { quarter: '2nd', clock: '4:17', playClock: 28, down: 2, distance: 7 },
    meta: { visible: true, updatedAt: '2026-08-09T00:00:00.000Z' },
  });
  const live = JSON.parse(fs.readFileSync(extractor.liveScreenScoreboardPath, 'utf8'));
  assert.equal(live.away.name, 'Marshall');
  assert.equal(live.home.name, 'TCU');
  assert.equal(live.game.clock, '4:17');
  assert.equal(extractor.snapshot().liveScreenScoreboardPath, path.join(root, 'live-screen-scoreboard.json'));
});

test('deduplicates repeated flag signals while keeping event context active', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb27-data-signal-'));
  let now = Date.parse('2026-08-09T00:00:00.000Z');
  const extractor = new AutomaticDataExtractor({ rootPath: root, now: () => now, sessionId: 'signal-session' });
  assert.ok(extractor.observeSignal('flag-detected', { capturedAt: now, rawText: 'FLAG' }));
  now += 1_000;
  assert.equal(extractor.observeSignal('flag-detected', { capturedAt: now, rawText: 'FLAG' }), null);
  assert.equal(extractor.snapshot().counts.events, 1);
  assert.equal(extractor.needsContextCapture(now), true);
});
