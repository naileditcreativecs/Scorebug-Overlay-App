'use strict';

function emptyManualTeamOverrides() {
  return {
    away: { teamId: null, rankMode: 'auto', rank: null },
    home: { teamId: null, rankMode: 'auto', rank: null },
  };
}

function normalizeManualTeamOverride(resolver, payload = {}) {
  const teamId = payload.teamId === null || payload.teamId === undefined || payload.teamId === ''
    ? null
    : String(payload.teamId);
  if (teamId && !resolver?.resolveTeamId(teamId)) {
    throw new Error('The selected team is not in the bundled CFB27 roster.');
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
  return { teamId, rankMode, rank };
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
