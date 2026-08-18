'use strict';

const { compactTeamName } = require('./recognition/team-assets');

const BLOCKED_SCOREBOARD_ABBREVIATIONS = new Set(['FS', 'FSU']);

// Proven scoreboard-specific OCR slips. Keep these narrow: the complete
// `TEXAS A&M` label still resolves to Texas A&M through the ordinary roster,
// while the isolated `AEM` smear produced by the TEXAS wordmark resolves to
// Texas instead of being published as raw OCR text.
const SCOREBOARD_READING_OVERRIDES = new Map([
  ['AEM', 'TEXAS'],
]);

const SCOREBOARD_CANONICAL_TEAM_NAMES = new Map([
  ['127', 'Western Michigan'],
]);

function normalizeRank(value) {
  const rank = Number(value);
  return Number.isInteger(rank) && rank >= 1 && rank <= 99 ? rank : null;
}

/**
 * Apply rules for the text that is actually authored on the CFB27 scorebug.
 * Florida State is written as FLORIDA STATE, so FS/FSU are not valid authored
 * names. LSU is authored as LSU, and a clipped two-letter LS read must retain
 * that identity while the final U is missing.
 */
function resolveScoreboardTeamIdentity(resolver, name, rank = null) {
  if (!resolver) return null;
  const displayName = String(name || '').trim().replace(/\s+/g, ' ');
  const compact = compactTeamName(displayName);

  if (compact === 'LS') {
    const lsu = resolver.resolveIdentity('LSU', rank);
    if (!lsu?.asset) return lsu || null;
    return {
      ...lsu,
      name: 'LSU',
      match: 'scoreboard-rule',
    };
  }

  const override = SCOREBOARD_READING_OVERRIDES.get(compact);
  if (override) {
    const identity = resolver.resolveIdentity(override, rank);
    if (!identity?.asset) return identity || null;
    return {
      ...identity,
      name: identity.asset.name,
      match: 'scoreboard-rule',
    };
  }

  if (BLOCKED_SCOREBOARD_ABBREVIATIONS.has(compact)) {
    return {
      name: displayName || null,
      rank: normalizeRank(rank),
      asset: null,
      match: null,
    };
  }

  const identity = resolver.resolveIdentity(displayName, rank);
  const canonicalName = SCOREBOARD_CANONICAL_TEAM_NAMES.get(String(identity?.asset?.id || ''));
  if (identity?.asset && canonicalName && identity.name !== canonicalName) {
    return {
      ...identity,
      name: canonicalName,
      match: 'scoreboard-canonical',
    };
  }
  return identity;
}

function scoreboardTeamOptions(resolver) {
  if (!resolver?.byId) return [];
  return [...resolver.byId.values()]
    .map((team) => ({
      id: String(team.id),
      name: String(team.name || '').trim(),
      nickname: String(team.nickname || '').trim(),
      custom: Boolean(resolver.isCustomTeam?.(team.id)),
    }))
    .filter((team) => team.id && team.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

module.exports = {
  BLOCKED_SCOREBOARD_ABBREVIATIONS,
  SCOREBOARD_CANONICAL_TEAM_NAMES,
  SCOREBOARD_READING_OVERRIDES,
  resolveScoreboardTeamIdentity,
  scoreboardTeamOptions,
};
