'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyClaudeDcScoreboardState } = require('../src/claude-dc-bridge');

test('FOX V7 text prop aliases receive live Texas A&M identity and rank', () => {
  const propsMeta = {
    awayNameText: { tsType: 'string', default: 'NOTRE DAME' },
    homeNameText: { tsType: 'string', default: 'ILLINOIS' },
    rankLeftText: { tsType: 'string', default: '#21' },
    rankRightText: { tsType: 'string', default: '#23' },
    scoreLeftText: { tsType: 'string', default: '17' },
    scoreRightText: { tsType: 'string', default: '24' },
    awayColor: { tsType: 'string', default: '#8c2d2e' },
    homeColor: { tsType: 'string', default: '#1e2e45' },
  };
  let received = null;
  const entry = { propsMeta, propOverrides: {} };
  const scope = {
    __dcRegistry: new Map([['FoxV7', entry]]),
    __dcRootName: () => 'FoxV7',
    __dcSetProps: (_root, values) => {
      received = values;
      entry.propOverrides = values;
    },
  };

  const report = applyClaudeDcScoreboardState(scope, {
    away: { name: 'Texas A&M', rank: 7, score: 14, color: '#500000' },
    home: { name: 'Pittsburgh', rank: 12, score: 10, color: '#003594' },
    game: {},
  });

  assert.equal(report.applied, true);
  assert.equal(received.awayNameText, 'Texas A&M');
  assert.equal(received.homeNameText, 'Pittsburgh');
  assert.equal(received.rankLeftText, '7');
  assert.equal(received.rankRightText, '12');
  assert.equal(received.scoreLeftText, '14');
  assert.equal(received.scoreRightText, '10');
});
