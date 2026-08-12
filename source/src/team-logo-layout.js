'use strict';

const DEFAULT_LOGO_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  scale: 1.13,
  rotation: 0,
});

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeLogoTransform(value = {}) {
  return {
    x: Math.round(clamp(value?.x, -2000, 2000, DEFAULT_LOGO_TRANSFORM.x) * 10) / 10,
    y: Math.round(clamp(value?.y, -2000, 2000, DEFAULT_LOGO_TRANSFORM.y) * 10) / 10,
    scale: Math.round(clamp(value?.scale, 0.1, 5, DEFAULT_LOGO_TRANSFORM.scale) * 1000) / 1000,
    rotation: Math.round(clamp(value?.rotation, -180, 180, DEFAULT_LOGO_TRANSFORM.rotation) * 10) / 10,
  };
}

function normalizedLogoLayouts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, layout] of Object.entries(value)) {
    if (!key || key.length > 256 || key === '__proto__' || key === 'constructor') continue;
    result[key] = normalizeLogoTransform(layout);
  }
  return result;
}

function logoLayoutKey(themeKey, teamId, variantId, side) {
  const normalizedSide = side === 'home' ? 'home' : 'away';
  const safeTheme = String(themeKey || 'theme:unknown').slice(0, 160);
  const safeTeam = String(teamId || 'unknown').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'unknown';
  const safeVariant = String(variantId || 'default').replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'default';
  return `${safeTheme}::${safeTeam}::${safeVariant}::${normalizedSide}`;
}

module.exports = {
  DEFAULT_LOGO_TRANSFORM,
  logoLayoutKey,
  normalizeLogoTransform,
  normalizedLogoLayouts,
};
