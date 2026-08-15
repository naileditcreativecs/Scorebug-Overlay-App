'use strict';

// Penalty flags from the game's own banner messages, proven by tester probe
// data (2026-08-15 game): the flag banner is messageId 1150630092 with
// displayText "FLAG", infoText "PENALTY", an 8000ms display time, and the
// yellow color slot. The banner does NOT name the penalty kind - the game
// shows only FLAG/PENALTY - so the indicator mirrors exactly that. The text
// match is a fallback in case another game build uses a different id for the
// same banner.
const FLAG_MESSAGE_ID = 1150630092;
const DEFAULT_FLAG_DISPLAY_MS = 8000;
const MAXIMUM_FLAG_DISPLAY_MS = 15000;

function isFlagMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (Number(message.messageId) === FLAG_MESSAGE_ID) return true;
  return /^flag$/i.test(String(message.displayText || '').trim());
}

function flagDisplayMs(message) {
  const declared = Number(message?.displayTime);
  if (!Number.isFinite(declared) || declared <= 0) return DEFAULT_FLAG_DISPLAY_MS;
  return Math.min(declared, MAXIMUM_FLAG_DISPLAY_MS);
}

/**
 * Reduce the feed's recentMessages to the current flag state. A flag is
 * active from the moment the game showed its banner until that banner's own
 * display time elapses, so the overlay's timing mirrors the game's.
 */
function flagStateFromMessages(messages, nowMs) {
  if (!Array.isArray(messages)) return { active: false };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isFlagMessage(message)) continue;
    const shownAtMs = Date.parse(String(message.t || ''));
    if (!Number.isFinite(shownAtMs)) return { active: false };
    const ageMs = nowMs - shownAtMs;
    if (ageMs < 0 || ageMs > flagDisplayMs(message)) return { active: false };
    return { active: true, sinceMs: shownAtMs };
  }
  return { active: false };
}

module.exports = {
  DEFAULT_FLAG_DISPLAY_MS,
  FLAG_MESSAGE_ID,
  MAXIMUM_FLAG_DISPLAY_MS,
  flagStateFromMessages,
  isFlagMessage,
};
