'use strict';

// Parses the game's own stat lower-third strings into structured fields.
// Formats proven in probe data (2026-08-18):
//   "T.Dixon 4 Rec, 60 Yds, 1 TD"   receiving, with player
//   "2 RUSH, 33 YDS"                rushing
//   "29 YDS, 0 TDs, 0 INTs"         passing
// plus common broadcast variants (completions "18/24", CAR for carries).
// Anything unrecognized returns null - the raw text stays available in
// game.hudTexts, and the statbanner probe records it for a future format.

const NAME = /^\s*((?:[A-Z][a-z]*\.?\s?)?[A-Z][A-Za-z.'-]+(?:\s(?:Jr|Sr|II|III|IV)\.?)?)\s+(?=\d)/;

function parseStatLine(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 90) return null;
  let player = null;
  let rest = raw;
  const name = NAME.exec(raw);
  if (name) {
    player = name[1].trim();
    rest = raw.slice(name[0].length);
  }
  let match = /(\d+)\s*(?:REC(?:EPTIONS?)?|CATCH(?:ES)?)\s*,\s*(\d+)\s*Y(?:AR)?DS?(?:\s*,\s*(\d+)\s*TDS?)?/i.exec(rest);
  if (match) {
    return { kind: 'receiving', player, receptions: Number(match[1]), yards: Number(match[2]), tds: match[3] !== undefined ? Number(match[3]) : null, text: raw };
  }
  match = /(\d+)\s*(?:RUSH(?:ES)?|CAR(?:RIES)?)\s*,\s*(\d+)\s*Y(?:AR)?DS?(?:\s*,\s*(\d+)\s*TDS?)?/i.exec(rest);
  if (match) {
    return { kind: 'rushing', player, carries: Number(match[1]), yards: Number(match[2]), tds: match[3] !== undefined ? Number(match[3]) : null, text: raw };
  }
  match = /(?:(\d+)\s*\/\s*(\d+)\s*,\s*)?(\d+)\s*Y(?:AR)?DS?\s*,\s*(\d+)\s*TDS?\s*,\s*(\d+)\s*INTS?/i.exec(rest);
  if (match) {
    return {
      kind: 'passing', player,
      completions: match[1] !== undefined ? Number(match[1]) : null,
      attempts: match[2] !== undefined ? Number(match[2]) : null,
      yards: Number(match[3]), tds: Number(match[4]), ints: Number(match[5]), text: raw,
    };
  }
  match = /(\d+)\s*\/\s*(\d+)\s*,\s*(\d+)\s*Y(?:AR)?DS?(?:\s*,\s*(\d+)\s*TDS?)?/i.exec(rest);
  if (match) {
    return { kind: 'passing', player, completions: Number(match[1]), attempts: Number(match[2]), yards: Number(match[3]), tds: match[4] !== undefined ? Number(match[4]) : null, ints: null, text: raw };
  }
  match = /(\d+)\s*(?:TKL|TACKLES?)\s*(?:,\s*(\d+(?:\.\d)?)\s*SACKS?)?/i.exec(rest);
  if (match) {
    return { kind: 'defense', player, tackles: Number(match[1]), sacks: match[2] !== undefined ? Number(match[2]) : null, text: raw };
  }
  return null;
}

// Reduce a hudTexts array into the parsed stat lines it carries.
function parseHudTexts(hudTexts) {
  const out = [];
  for (const item of Array.isArray(hudTexts) ? hudTexts : []) {
    for (const text of Array.isArray(item?.texts) ? item.texts : []) {
      const parsed = parseStatLine(text);
      if (parsed) out.push({ ...parsed, teamSide: item.teamSide ?? null, playerId: item.playerId ?? null });
    }
  }
  return out;
}

module.exports = { parseStatLine, parseHudTexts };
