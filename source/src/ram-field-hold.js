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
  ['away', 'presentationId', IDENTITY_HOLD_MS],
  ['away', 'isTeamBuilder', IDENTITY_HOLD_MS],
  ['away', 'name', IDENTITY_HOLD_MS],
  ['away', 'rank', IDENTITY_HOLD_MS],
  ['away', 'record', IDENTITY_HOLD_MS],
  ['away', 'score', RAM_FIELD_HOLD_MS],
  // Timeouts follow the reader like every other live field (the long hold
  // tried in v1.4.48 left stale counts on screen for testers).
  ['away', 'timeouts', RAM_FIELD_HOLD_MS],
  ['away', 'possession', RAM_FIELD_HOLD_MS],
  ['home', 'presentationId', IDENTITY_HOLD_MS],
  ['home', 'isTeamBuilder', IDENTITY_HOLD_MS],
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
  return { processId: undefined, teamIdentitySignature: null, entries: new Map() };
}

function clearRamFieldHold(cache) {
  if (!cache) return;
  cache.processId = undefined;
  cache.teamIdentitySignature = null;
  cache.entries = new Map();
}

function teamIdentitySignature(state) {
  const parts = [];
  for (const side of ['away', 'home']) {
    const team = state?.[side];
    if (!Number.isInteger(team?.presentationId) || typeof team?.isTeamBuilder !== 'boolean') return null;
    parts.push(`${team.presentationId}:${team.isTeamBuilder ? 1 : 0}`);
  }
  return parts.join('|');
}

function clearTeamIdentityEntries(entries) {
  for (const side of ['away', 'home']) {
    for (const key of ['presentationId', 'isTeamBuilder', 'name', 'rank', 'record']) {
      entries.delete(`${side}.${key}`);
    }
  }
}

function applyRamFieldHold(payload, cache, nowMs, holdOverrideMs = null) {
  if (!payload || !payload.state || !cache) return payload;
  const processId = payload.state.meta?.ramProcessId ?? null;
  if (cache.processId !== processId) {
    cache.processId = processId;
    cache.teamIdentitySignature = null;
    cache.entries = new Map();
  }
  const entries = cache.entries;
  const identitySignature = teamIdentitySignature(payload.state);
  if (identitySignature && cache.teamIdentitySignature && identitySignature !== cache.teamIdentitySignature) {
    // A newly verified ScoreHud pair is a new identity epoch. Never combine
    // its ids with the previous matchup's infinitely-held names/ranks/records.
    clearTeamIdentityEntries(entries);
  }
  if (identitySignature) cache.teamIdentitySignature = identitySignature;
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

// Drop specific held fields (e.g. timeouts at the half, when the game hands
// both teams three fresh ones and the old count would be wrong).
function forgetRamFieldHold(cache, labels) {
  if (!cache?.entries) return;
  for (const label of labels || []) cache.entries.delete(label);
}

module.exports = {
  forgetRamFieldHold,
  HELD_FIELDS,
  IDENTITY_HOLD_MS,
  RAM_FIELD_HOLD_MS,
  applyRamFieldHold,
  clearRamFieldHold,
  createRamFieldHoldCache,
};
