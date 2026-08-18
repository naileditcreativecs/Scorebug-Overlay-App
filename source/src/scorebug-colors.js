'use strict';

// Scorebug team colors. 'auto' leaves the color the bundled team asset
// provides (the team's primary); 'custom' pins any hex the user picked -
// from the team's real primary/secondary swatches, white/black, or the
// color wheel. Presets are named away+home pairs that persist in settings.

const MAXIMUM_PRESETS = 24;
const MAXIMUM_PRESET_NAME = 40;
// Scoped color rules. A 'team' rule follows a team wherever it appears (this
// is what a swatch click saves when the team is known); a 'matchup' rule
// applies both colors only when exactly that pairing is on the bug; a
// 'theme' rule applies both colors only on one scorebug HTML. Precedence
// when several match: matchup > team > theme > legacy side pin > auto.
const MAXIMUM_RULES = 400;
const MAXIMUM_ID = 120;

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

function normalizeId(value) {
  const id = String(value ?? '').trim().slice(0, MAXIMUM_ID);
  return id || null;
}

function normalizeRule(value) {
  const scope = String(value?.scope || '').toLowerCase();
  if (scope === 'team') {
    const teamId = normalizeId(value.teamId);
    const color = normalizeHex(value.color);
    return teamId && color ? { scope, teamId, color } : null;
  }
  if (scope === 'matchup') {
    const awayTeamId = normalizeId(value.awayTeamId);
    const homeTeamId = normalizeId(value.homeTeamId);
    const away = normalizeHex(value.away);
    const home = normalizeHex(value.home);
    return awayTeamId && homeTeamId && (away || home)
      ? { scope, awayTeamId, homeTeamId, away, home } : null;
  }
  if (scope === 'theme') {
    const themeId = normalizeId(value.themeId);
    const away = normalizeHex(value.away);
    const home = normalizeHex(value.home);
    return themeId && (away || home) ? { scope, themeId, away, home } : null;
  }
  return null;
}

function normalizeScorebugColors(value) {
  const presets = Array.isArray(value?.presets)
    ? value.presets.map(normalizePreset).filter(Boolean).slice(0, MAXIMUM_PRESETS)
    : [];
  const rules = Array.isArray(value?.rules)
    ? value.rules.map(normalizeRule).filter(Boolean).slice(0, MAXIMUM_RULES)
    : [];
  return {
    away: normalizeSide(value?.away),
    home: normalizeSide(value?.home),
    presets,
    rules,
  };
}

function sameRuleKey(left, right) {
  if (!left || !right || left.scope !== right.scope) return false;
  if (left.scope === 'team') return left.teamId === right.teamId;
  if (left.scope === 'matchup') return left.awayTeamId === right.awayTeamId && left.homeTeamId === right.homeTeamId;
  if (left.scope === 'theme') return left.themeId === right.themeId;
  return false;
}

/** Add or replace a rule (matched by scope + identity). */
function upsertScorebugColorRule(colors, rule) {
  const normalized = normalizeScorebugColors(colors);
  const next = normalizeRule(rule);
  if (!next) throw new Error('That color rule is incomplete.');
  const index = normalized.rules.findIndex((candidate) => sameRuleKey(candidate, next));
  if (index >= 0) normalized.rules[index] = next;
  else if (normalized.rules.length >= MAXIMUM_RULES) throw new Error('Too many saved color rules.');
  else normalized.rules.push(next);
  return normalized;
}

/** Remove every rule matching scope + identity. */
function removeScorebugColorRule(colors, rule) {
  const normalized = normalizeScorebugColors(colors);
  const key = normalizeRule({ ...rule, color: rule?.color || '#000000', away: '#000000', home: '#000000' });
  if (!key) return normalized;
  normalized.rules = normalized.rules.filter((candidate) => !sameRuleKey(candidate, key));
  return normalized;
}

/**
 * Resolve the color each side should show, with the reason.
 * context: { awayTeamId, homeTeamId, themeId }
 * Returns { away: {color, source}, home: {color, source} } where source is
 * 'matchup' | 'team' | 'theme' | 'pin' | 'auto'.
 */
function resolveScorebugColors(colors, context = {}) {
  const normalized = normalizeScorebugColors(colors);
  const awayTeamId = normalizeId(context.awayTeamId);
  const homeTeamId = normalizeId(context.homeTeamId);
  const themeId = normalizeId(context.themeId);
  const matchup = awayTeamId && homeTeamId
    ? normalized.rules.find((rule) => rule.scope === 'matchup'
      && rule.awayTeamId === awayTeamId && rule.homeTeamId === homeTeamId)
    : null;
  const theme = themeId
    ? normalized.rules.find((rule) => rule.scope === 'theme' && rule.themeId === themeId)
    : null;
  const result = {};
  for (const side of ['away', 'home']) {
    const teamId = side === 'away' ? awayTeamId : homeTeamId;
    const teamRule = teamId
      ? normalized.rules.find((rule) => rule.scope === 'team' && rule.teamId === teamId)
      : null;
    if (matchup && matchup[side]) result[side] = { color: matchup[side], source: 'matchup' };
    else if (teamRule) result[side] = { color: teamRule.color, source: 'team' };
    else if (theme && theme[side]) result[side] = { color: theme[side], source: 'theme' };
    else if (normalized[side].mode === 'custom') result[side] = { color: normalized[side].color, source: 'pin' };
    else result[side] = { color: null, source: 'auto' };
  }
  return result;
}

function defaultScorebugColors() {
  return normalizeScorebugColors(null);
}

// Runs after applyBundledTeamAssets so a pinned color wins over the asset's
// primary. Only ever touches the color field; names, ranks, and logos are
// untouched, so a wrong color can never put data on the wrong team.
function applyScorebugColors(payload, colors, context = {}) {
  const resolved = resolveScorebugColors(colors, {
    awayTeamId: context.awayTeamId ?? payload?.meta?.teamAssets?.away?.id,
    homeTeamId: context.homeTeamId ?? payload?.meta?.teamAssets?.home?.id,
    themeId: context.themeId,
  });
  const applied = {};
  for (const side of ['away', 'home']) {
    const choice = resolved[side];
    if (!choice.color) continue;
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
  MAXIMUM_RULES,
  applyScorebugColorPreset,
  removeScorebugColorRule,
  resolveScorebugColors,
  upsertScorebugColorRule,
  applyScorebugColors,
  defaultScorebugColors,
  deleteScorebugColorPreset,
  isHexColor,
  normalizeScorebugColors,
  upsertScorebugColorPreset,
};
