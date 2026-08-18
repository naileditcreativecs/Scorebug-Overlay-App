'use strict';

// "W-L" or "W-L-T" - the same shape the RAM reader publishes, so a manual
// record is indistinguishable from a read one downstream.
const RECORD_PATTERN = /^\d{1,2}-\d{1,2}(?:-\d{1,2})?$/;

function emptyManualTeamOverrides() {
  return {
    away: { teamId: null, rankMode: 'auto', rank: null, recordMode: 'auto', record: null },
    home: { teamId: null, rankMode: 'auto', rank: null, recordMode: 'auto', record: null },
  };
}

function normalizeManualTeamOverride(resolver, payload = {}) {
  const teamId = payload.teamId === null || payload.teamId === undefined || payload.teamId === ''
    ? null
    : String(payload.teamId);
  if (teamId && !resolver?.resolveTeamId(teamId)) {
    throw new Error('The selected team is not in the CFB27 roster or your custom teams.');
  }

  const rankMode = String(payload.rankMode || 'auto').toLowerCase();
  if (!['auto', 'unranked', 'ranked'].includes(rankMode)) {
    throw new Error('The rank override must be Auto, Unranked, or 1-25.');
  }
  let rank = null;
  if (rankMode === 'ranked') {
    rank = Number(payload.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > 25) {
      throw new Error('Manual rankings must be from 1 through 25.');
    }
  }

  const recordMode = String(payload.recordMode || 'auto').toLowerCase();
  if (!['auto', 'custom', 'hidden'].includes(recordMode)) {
    throw new Error('The record override must be Auto, Hidden, or a typed record.');
  }
  let record = null;
  if (recordMode === 'custom') {
    record = String(payload.record || '').trim();
    if (!RECORD_PATTERN.test(record)) {
      throw new Error('Records look like 5-2 or 5-2-1.');
    }
  }
  return { teamId, rankMode, rank, recordMode, record };
}

function applyManualTeamOverrides(sourceState, overrides, resolver) {
  const payload = {
    ...sourceState,
    away: { ...(sourceState?.away || {}) },
    home: { ...(sourceState?.home || {}) },
    game: { ...(sourceState?.game || {}) },
    meta: { ...(sourceState?.meta || {}) },
  };
  const applied = {};

  for (const side of ['away', 'home']) {
    const override = overrides?.[side];
    if (!override) continue;
    if (override.teamId) {
      const asset = resolver?.resolveTeamId(override.teamId);
      if (asset) {
        payload[side].name = asset.name;
        payload[side].nickname = asset.nickname;
        payload[side].color = null;
        payload[side].logo = null;
        applied[side] = {
          ...(applied[side] || {}), teamId: asset.id, name: asset.name, nickname: asset.nickname,
        };
      }
    }
    if (override.rankMode === 'unranked') {
      payload[side].rank = null;
      applied[side] = { ...(applied[side] || {}), rank: null };
    } else if (override.rankMode === 'ranked') {
      payload[side].rank = override.rank;
      applied[side] = { ...(applied[side] || {}), rank: override.rank };
    }
    if (override.recordMode === 'custom' && RECORD_PATTERN.test(String(override.record || ''))) {
      payload[side].record = override.record;
      applied[side] = { ...(applied[side] || {}), record: override.record };
    } else if (override.recordMode === 'hidden') {
      // Show nothing where the record would be - the overlay blanks a
      // null-bound element, so the bug simply has no record text.
      payload[side].record = null;
      applied[side] = { ...(applied[side] || {}), record: null };
    }
  }

  if (Object.keys(applied).length) payload.meta.manualTeamOverrides = applied;
  else delete payload.meta.manualTeamOverrides;
  return payload;
}

module.exports = {
  applyManualTeamOverrides,
  emptyManualTeamOverrides,
  normalizeManualTeamOverride,
};
