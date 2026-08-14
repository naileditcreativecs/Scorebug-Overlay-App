'use strict';

// The reader is fail-closed: any field it cannot verify on a given tick is
// withheld, and the scorebug blanked that number for the one or two ticks it
// took to re-verify (down/distance while a special layer resolves, possession
// across a dead ball, a clone disagreeing mid-write). Value -> null -> value
// a few times a drive reads as flicker. Holding the last verified value for a
// short window smooths those blinks while leaving deliberate withholds - which
// last many seconds - visibly blank. Values never cross a game process change.
const RAM_FIELD_HOLD_MS = 1500;

// Every field ramScoreboardPayload can emit. A field absent from this list
// would blink again, so keep it in step with that function.
const HELD_FIELDS = [
  ['away', 'name'],
  ['away', 'rank'],
  ['away', 'record'],
  ['away', 'score'],
  ['away', 'timeouts'],
  ['away', 'possession'],
  ['home', 'name'],
  ['home', 'rank'],
  ['home', 'record'],
  ['home', 'score'],
  ['home', 'timeouts'],
  ['home', 'possession'],
  ['game', 'quarter'],
  ['game', 'clock'],
  ['game', 'playClock'],
  ['game', 'down'],
  ['game', 'distance'],
  ['game', 'downDistance'],
  ['game', 'downDistanceKind'],
];

function createRamFieldHoldCache() {
  return { processId: undefined, entries: new Map() };
}

function applyRamFieldHold(payload, cache, nowMs, holdMs = RAM_FIELD_HOLD_MS) {
  if (!payload || !payload.state || !cache) return payload;
  const processId = payload.state.meta?.ramProcessId ?? null;
  if (cache.processId !== processId) {
    cache.processId = processId;
    cache.entries = new Map();
  }
  const entries = cache.entries;
  for (const [section, key] of HELD_FIELDS) {
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
  RAM_FIELD_HOLD_MS,
  applyRamFieldHold,
  createRamFieldHoldCache,
};
