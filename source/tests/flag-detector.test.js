'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  FLAG_MESSAGE_ID,
  flagStateFromMessages,
  isFlagMessage,
} = require('../src/flag-detector');

// The exact banner the tester's probe captured on 2026-08-15.
const PROBE_FLAG = {
  t: '2026-08-15T03:59:03.2006196Z',
  messageId: 1150630092,
  displayText: 'FLAG',
  infoText: 'PENALTY',
  playerId: -1,
  teamId: 0,
  color: 3,
  displayTime: 8000,
};

const SHOWN_AT = Date.parse(PROBE_FLAG.t);

test('the probe-captured flag banner is recognized and timed by its own display window', () => {
  assert.ok(isFlagMessage(PROBE_FLAG));
  assert.deepStrictEqual(
    flagStateFromMessages([PROBE_FLAG], SHOWN_AT + 100),
    { active: true, sinceMs: SHOWN_AT, side: null },
  );
  // teamSide from the reader resolves the arrow side for themes.
  assert.strictEqual(
    flagStateFromMessages([{ ...PROBE_FLAG, teamSide: 'home' }], SHOWN_AT + 100).side,
    'home',
  );
  assert.deepStrictEqual(
    flagStateFromMessages([PROBE_FLAG], SHOWN_AT + 8001),
    { active: false },
  );
});

test('an unknown id with FLAG text still counts; other banners never do', () => {
  assert.ok(isFlagMessage({ messageId: 42, displayText: 'Flag' }));
  assert.ok(!isFlagMessage({ messageId: 42, displayText: 'TOUCHDOWN' }));
  assert.ok(!isFlagMessage({ messageId: 42, displayText: 'Halftime' }));
  assert.ok(!isFlagMessage({ messageId: 42, displayText: 'TWO-MINUTE TIMEOUT' }));
});

test('the newest flag in the list wins and stale ones stay inactive', () => {
  const older = { ...PROBE_FLAG, t: '2026-08-15T03:00:00.000Z' };
  const state = flagStateFromMessages(
    [older, { messageId: 7, displayText: 'TOUCHDOWN', t: PROBE_FLAG.t }, PROBE_FLAG],
    SHOWN_AT + 500,
  );
  assert.deepStrictEqual(state, { active: true, sinceMs: SHOWN_AT, side: null });
});

test('garbage input never activates', () => {
  assert.deepStrictEqual(flagStateFromMessages(null, 0), { active: false });
  assert.deepStrictEqual(flagStateFromMessages([], 0), { active: false });
  assert.deepStrictEqual(
    flagStateFromMessages([{ messageId: FLAG_MESSAGE_ID, t: 'not a date' }], 0),
    { active: false },
  );
  // A zero/negative declared display time falls back to the default window
  // instead of never showing.
  const noTime = { ...PROBE_FLAG, displayTime: -1 };
  assert.strictEqual(flagStateFromMessages([noTime], SHOWN_AT + 100).active, true);
});
