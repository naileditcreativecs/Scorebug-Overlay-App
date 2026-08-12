'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_TRANSIENT_JSON_GRACE_MS,
  TransientJsonReader,
} = require('../src/transient-json-reader');

function fixture(graceMs = 750) {
  let now = 0;
  let text = '{"sequence":1}';
  let failure = null;
  let pathExists = true;
  const reader = new TransientJsonReader({
    graceMs,
    now: () => now,
    readFile: () => {
      if (failure) throw failure;
      return text;
    },
    exists: () => pathExists,
  });
  return {
    reader,
    advance(milliseconds) { now += milliseconds; },
    fail(error = Object.assign(new Error('sharing violation'), { code: 'EBUSY' })) {
      failure = error;
    },
    recover(nextText = text) {
      failure = null;
      text = nextText;
    },
    remove() { pathExists = false; },
    restore() { pathExists = true; },
  };
}

test('retains the last parsed document through a short read failure', () => {
  const value = fixture();
  const first = value.reader.read('live-game-data.json');
  value.advance(500);
  value.fail();
  assert.strictEqual(value.reader.read('live-game-data.json'), first);
});

test('intentional deletion clears immediately and cannot reuse the old document', () => {
  const value = fixture();
  value.reader.read('live-game-data.json');
  value.advance(100);
  value.fail();
  value.remove();
  assert.equal(value.reader.read('live-game-data.json'), null);
  value.restore();
  assert.equal(value.reader.read('live-game-data.json'), null);
});

test('a read failure older than the grace period clears the cache', () => {
  const value = fixture();
  value.reader.read('live-game-data.json');
  value.advance(751);
  value.fail();
  assert.equal(value.reader.read('live-game-data.json'), null);
});

test('a successful recovery replaces the cached document', () => {
  const value = fixture();
  value.reader.read('live-game-data.json');
  value.advance(200);
  value.fail();
  assert.equal(value.reader.read('live-game-data.json').sequence, 1);
  value.recover('{"sequence":2}');
  assert.equal(value.reader.read('live-game-data.json').sequence, 2);
});

test('a same-call retry accepts the replacement document without using cache', () => {
  let attempts = 0;
  const reader = new TransientJsonReader({
    now: () => 0,
    readFile: () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('sharing violation'), { code: 'EBUSY' });
      return '{"sequence":2}';
    },
    exists: () => true,
  });
  assert.equal(reader.read('live-game-data.json').sequence, 2);
  assert.equal(attempts, 2);
});

test('configured grace cannot exceed one second', () => {
  const value = fixture(10_000);
  assert.equal(value.reader.graceMs, MAX_TRANSIENT_JSON_GRACE_MS);
});
