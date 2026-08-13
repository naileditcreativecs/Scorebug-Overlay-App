'use strict';

// Scorebug team colors. 'auto' leaves the color the bundled team asset
// provides (the team's primary); 'custom' pins any hex the user picked -
// from the team's real primary/secondary swatches, white/black, or the
// color wheel. Presets are named away+home pairs that persist in settings.

const MAXIMUM_PRESETS = 24;
const MAXIMUM_PRESET_NAME = 40;

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function normalizeHex(value) {
  return isHexColor(value) ? value.trim().toLowerCase() : null;
}

function normalizeSide(value) {
  const mode = String(value?.mode || 'auto').toLowerCase() === 'custom' ? 'custom' : 'auto';
  const color = normalizeHex(value?.color);
  // A custom mode without a usable color is meaningless; fall back to auto
  // rather than publishing an empty override.
  return mode === 'custom' && color ? { mode, color } : { mode: 'auto', color: null };
}

function normalizePreset(value) {
  const name = String(value?.name || '').trim().slice(0, MAXIMUM_PRESET_NAME);
  const away = normalizeHex(value?.away);
  const home = normalizeHex(value?.home);
  return name && away && home ? { name, away, home } : null;
}

function normalizeScorebugColors(value) {
  const presets = Array.isArray(value?.presets)
    ? value.presets.map(normalizePreset).filter(Boolean).slice(0, MAXIMUM_PRESETS)
    : [];
  return {
    away: normalizeSide(value?.away),
    home: normalizeSide(value?.home),
    presets,
  };
}

function defaultScorebugColors() {
  return normalizeScorebugColors(null);
}

// Runs after applyBundledTeamAssets so a pinned color wins over the asset's
// primary. Only ever touches the color field; names, ranks, and logos are
// untouched, so a wrong color can never put data on the wrong team.
function applyScorebugColors(payload, colors) {
  const normalized = normalizeScorebugColors(colors);
  const applied = {};
  for (const side of ['away', 'home']) {
    const choice = normalized[side];
    if (choice.mode !== 'custom') continue;
    if (!payload[side] || typeof payload[side] !== 'object') payload[side] = {};
    payload[side].color = choice.color;
    applied[side] = choice.color;
  }
  if (Object.keys(applied).length) payload.meta.scorebugColors = applied;
  else if (payload.meta) delete payload.meta.scorebugColors;
  return payload;
}

function upsertScorebugColorPreset(colors, name, awayColor, homeColor) {
  const normalized = normalizeScorebugColors(colors);
  const preset = normalizePreset({ name, away: awayColor, home: homeColor });
  if (!preset) throw new Error('A preset needs a name and both team colors.');
  const existingIndex = normalized.presets.findIndex(
    (candidate) => candidate.name.toLowerCase() === preset.name.toLowerCase(),
  );
  if (existingIndex >= 0) normalized.presets[existingIndex] = preset;
  else if (normalized.presets.length >= MAXIMUM_PRESETS) {
    throw new Error(`Preset limit reached (${MAXIMUM_PRESETS}). Delete one first.`);
  } else normalized.presets.push(preset);
  return normalized;
}

function deleteScorebugColorPreset(colors, name) {
  const normalized = normalizeScorebugColors(colors);
  const key = String(name || '').trim().toLowerCase();
  normalized.presets = normalized.presets.filter(
    (candidate) => candidate.name.toLowerCase() !== key,
  );
  return normalized;
}

function applyScorebugColorPreset(colors, name) {
  const normalized = normalizeScorebugColors(colors);
  const key = String(name || '').trim().toLowerCase();
  const preset = normalized.presets.find(
    (candidate) => candidate.name.toLowerCase() === key,
  );
  if (!preset) throw new Error('That color preset no longer exists.');
  normalized.away = { mode: 'custom', color: preset.away };
  normalized.home = { mode: 'custom', color: preset.home };
  return normalized;
}

module.exports = {
  MAXIMUM_PRESETS,
  applyScorebugColorPreset,
  applyScorebugColors,
  defaultScorebugColors,
  deleteScorebugColorPreset,
  isHexColor,
  normalizeScorebugColors,
  upsertScorebugColorPreset,
};
