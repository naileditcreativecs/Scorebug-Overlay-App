'use strict';

// Accumulates every parsed stat line the broadcast ever shows into a
// per-player board that survives between banners - the bug can render a
// growing stat table instead of only the most recent flash. The board
// resets when the matchup changes (new game), never mid-game.
//
// Keying: player name when the line carries one, otherwise the numeric
// playerId, otherwise the kind alone (a nameless "3 RUSH, 21 YDS" still
// updates the "latest rushing" slot rather than vanishing).

function statBoardKey(entry) {
  if (entry.player) return entry.kind + '|' + entry.player;
  if (entry.playerId !== null && entry.playerId !== undefined && entry.playerId > 0) {
    return entry.kind + '|#' + entry.playerId;
  }
  return entry.kind;
}

function createStatBoard() {
  return { matchupKey: null, entries: new Map() };
}

function updateStatBoard(board, matchupKey, parsedStats, nowMs) {
  if (board.matchupKey !== matchupKey) {
    board.matchupKey = matchupKey;
    board.entries.clear();
  }
  for (const entry of Array.isArray(parsedStats) ? parsedStats : []) {
    if (!entry || !entry.kind) continue;
    board.entries.set(statBoardKey(entry), { ...entry, seenAtMs: nowMs });
  }
  const out = [...board.entries.values()];
  out.sort((a, b) => b.seenAtMs - a.seenAtMs);
  return out;
}

module.exports = { createStatBoard, updateStatBoard, statBoardKey };
