'use strict';

// The reader is fail-closed: any field it cannot verify on a given tick is
// withheld, and the scorebug blanked that number for the one or two ticks it
// took to re-verify (down/distance while a special layer resolves, possession
// across a dead ball, a clone disagreeing mid-write). Value -> null -> value
// a few times a drive reads as flicker. Holding the last verified value for a
// short window smooths those blinks while leaving deliberate withholds - which
// last many seconds - visibly blank. Values never cross a game process change.
const RAM_FIELD_HOLD_MS = 1500;
// Identity fields never change inside a game - only a new matchup changes
// them, and that path clears the whole cache. So they hold until replaced:
// a name/rank/record that has been read once stays on the bug through every
// re-proof, special layer and slow lookup instead of blinking to AWAY/HOME.
const IDENTITY_HOLD_MS = Number.POSITIVE_INFINITY;

// Every field ramScoreboardPayload can emit, with its hold window. A field
// absent from this list would blink again, so keep it in step with that
// function.
const HELD_FIELDS = [
  ['away', 'name', IDENTITY_HOLD_MS],
  ['away', 'rank', IDENTITY_HOLD_MS],
  ['away', 'record', IDENTITY_HOLD_MS],
  ['away', 'score', RAM_FIELD_HOLD_MS],
  ['away', 'timeouts', RAM_FIELD_HOLD_MS],
  ['away', 'possession', RAM_FIELD_HOLD_MS],
  ['home', 'name', IDENTITY_HOLD_MS],
  ['home', 'rank', IDENTITY_HOLD_MS],
  ['home', 'record', IDENTITY_HOLD_MS],
  ['home', 'score', RAM_FIELD_HOLD_MS],
  ['home', 'timeouts', RAM_FIELD_HOLD_MS],
  ['home', 'possession', RAM_FIELD_HOLD_MS],
  ['game', 'quarter', RAM_FIELD_HOLD_MS],
  ['game', 'clock', RAM_FIELD_HOLD_MS],
  ['game', 'playClock', RAM_FIELD_HOLD_MS],
  ['game', 'down', RAM_FIELD_HOLD_MS],
  ['game', 'distance', RAM_FIELD_HOLD_MS],
  ['game', 'downDistance', RAM_FIELD_HOLD_MS],
  ['game', 'downDistanceKind', RAM_FIELD_HOLD_MS],
];

function createRamFieldHoldCache() {
  return { processId: undefined, entries: new Map() };
}

function clearRamFieldHold(cache) {
  if (!cache) return;
  cache.processId = undefined;
  cache.entries = new Map();
}

function applyRamFieldHold(payload, cache, nowMs, holdOverrideMs = null) {
  if (!payload || !payload.state || !cache) return payload;
  const processId = payload.state.meta?.ramProcessId ?? null;
  if (cache.processId !== processId) {
    cache.processId = processId;
    cache.entries = new Map();
  }
  const entries = cache.entries;
  for (const [section, key, fieldHoldMs] of HELD_FIELDS) {
    const holdMs = holdOverrideMs ?? fieldHoldMs;
    const target = payload.state[section];
    if (!target || typeof target !== 'object') continue;
    const label = `${section}.${key}`;
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      entries.set(label, { value: target[key], atMs: nowMs });
      continue;
    }
    const held = entries.get(label);
    if (!held) continue;
    const ageMs = nowMs - held.atMs;
    if (ageMs >= 0 && ageMs <= holdMs) {
      target[key] = held.value;
      payload.fields.push(label);
    } else {
      entries.delete(label);
    }
  }
  return payload;
}

module.exports = {
  HELD_FIELDS,
  IDENTITY_HOLD_MS,
  RAM_FIELD_HOLD_MS,
  applyRamFieldHold,
  clearRamFieldHold,
  createRamFieldHoldCache,
};
