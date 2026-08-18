'use strict';

// Whole-document continuity for the RAM feed. The reader deletes its live
// file on purpose while it re-locates (special layers, health re-proofs, a
// slow name lookup) and the app used to react by hiding the entire scorebug
// the same tick, then showing it again seconds later - the "goes away, comes
// back" flicker. A same-game re-locate is not a reason to blank anything.
//
// Rules:
//  - While the reader is alive and the game process is unchanged, the last
//    good state stays on screen for up to HOLD_MS.
//  - The reader's own status line decides between "same game, re-proving"
//    (hold) and "a NEW game / matchup" (clear immediately - never carry one
//    game's numbers into the next).
//  - A game process change or a manual New game always clears.
const RAM_DOCUMENT_HOLD_MS = 90_000;

// Status text the reader writes when it has decided the game changed. Any
// of these means the held state is a previous game: drop it now.
const NEW_GAME_STATUS = /matchup changed|game state reset|team roles changed|new game|different moving core|labeled team-role binding changed/i;

function createRamDocumentHold() {
  return { payload: null, heldSinceMs: 0, processId: null };
}

/**
 * @returns the payload to publish (fresh, held, or null) and whether the
 * result came from the hold.
 */
function applyRamDocumentHold(hold, payload, { nowMs, readerStatusText, gameProcessId, readerAlive }) {
  if (payload) {
    hold.payload = payload;
    hold.heldSinceMs = 0;
    hold.processId = payload.state?.meta?.ramProcessId ?? null;
    return { payload, held: false };
  }
  if (!hold.payload) return { payload: null, held: false };
  const processChanged = gameProcessId != null && hold.processId != null
    && Number(gameProcessId) !== Number(hold.processId);
  const newGame = NEW_GAME_STATUS.test(String(readerStatusText || ''));
  if (processChanged || newGame || readerAlive === false) {
    hold.payload = null;
    hold.heldSinceMs = 0;
    return { payload: null, held: false, reason: processChanged ? 'process' : (newGame ? 'new-game' : 'reader-down') };
  }
  if (!hold.heldSinceMs) hold.heldSinceMs = nowMs;
  if (nowMs - hold.heldSinceMs > RAM_DOCUMENT_HOLD_MS) {
    hold.payload = null;
    hold.heldSinceMs = 0;
    return { payload: null, held: false, reason: 'expired' };
  }
  return { payload: hold.payload, held: true };
}

// Automatic new-game detection from the feed itself. A game that had
// progressed (past the 1st quarter or with points on the board) and is now
// 1st quarter, 0-0, with a full clock is a different game - a dynasty
// advance or a restart. Same-process switches are where the reader can be
// left holding the previous matchup's names, so the app forces a fresh
// locate instead of trusting the carry-over.
function clockSeconds(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function looksLikeNewGame(previousState, nextState) {
  const prev = previousState?.game;
  const next = nextState?.game;
  if (!prev || !next) return false;
  const prevAway = Number(previousState.away?.score);
  const prevHome = Number(previousState.home?.score);
  const nextAway = Number(nextState.away?.score);
  const nextHome = Number(nextState.home?.score);
  const progressed = (prev.quarter && !/^1st$/i.test(String(prev.quarter)))
    || prevAway > 0 || prevHome > 0;
  if (!progressed) return false;
  const nextClock = clockSeconds(next.clock);
  return /^1st$/i.test(String(next.quarter || ''))
    && nextAway === 0 && nextHome === 0
    && nextClock !== null && nextClock >= 14 * 60 + 30;
}

function clearRamDocumentHold(hold) {
  hold.payload = null;
  hold.heldSinceMs = 0;
  hold.processId = null;
}

module.exports = {
  NEW_GAME_STATUS,
  looksLikeNewGame,
  RAM_DOCUMENT_HOLD_MS,
  applyRamDocumentHold,
  clearRamDocumentHold,
  createRamDocumentHold,
};
