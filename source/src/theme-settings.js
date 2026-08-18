'use strict';

// Scorebug-declared settings (see THEME-SETTINGS.md). A bug declares
// controls in a JSON block; the app builds a menu for them in the in-game
// editor and delivers validated values under `themeSettings` in the state
// object. Everything here is defensive: a bad declaration yields no
// controls, and a delivered value never violates its declaration.

const MAX_SETTINGS = 20;
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TYPES = new Set(['slider', 'toggle', 'choice', 'color']);

function cleanLabel(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeControl(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const key = String(entry.key || '');
  const type = String(entry.type || '').toLowerCase();
  const label = cleanLabel(entry.label) || key;
  if (!KEY_PATTERN.test(key) || !TYPES.has(type) || !label) return null;
  if (type === 'slider') {
    const min = finiteNumber(entry.min);
    const max = finiteNumber(entry.max);
    const fallback = finiteNumber(entry.default);
    if (min === null || max === null || fallback === null || max <= min) return null;
    let step = finiteNumber(entry.step);
    if (step === null || step <= 0) step = 1;
    const unit = String(entry.unit ?? '').trim().slice(0, 8);
    return { key, type, label, min, max, step, unit, default: Math.min(max, Math.max(min, fallback)) };
  }
  if (type === 'toggle') {
    if (typeof entry.default !== 'boolean') return null;
    return { key, type, label, default: entry.default };
  }
  if (type === 'choice') {
    const options = Array.isArray(entry.options)
      ? [...new Set(entry.options.map((option) => String(option ?? '').trim().slice(0, 40)).filter(Boolean))]
      : [];
    if (options.length < 2 || options.length > 12) return null;
    const fallback = String(entry.default ?? '').trim();
    if (!options.includes(fallback)) return null;
    return { key, type, label, options, default: fallback };
  }
  const fallback = String(entry.default ?? '').trim().toLowerCase();
  if (!HEX_COLOR.test(fallback)) return null;
  return { key, type, label, default: fallback };
}

// The declaration is a <script type="application/json" data-cfb27-settings>
// block. Returns [] for anything malformed - the bug keeps working.
function parseThemeSettingsDeclaration(html) {
  const source = String(html || '');
  const match = source.match(/<script\b[^>]*\bdata-cfb27-settings\b[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.settings) ? parsed.settings : []);
  const controls = [];
  const seen = new Set();
  for (const entry of list) {
    const control = normalizeControl(entry);
    if (!control || seen.has(control.key)) continue;
    seen.add(control.key);
    controls.push(control);
    if (controls.length >= MAX_SETTINGS) break;
  }
  return controls;
}

function coerceValue(control, raw) {
  if (!control) return undefined;
  if (control.type === 'slider') {
    const number = finiteNumber(raw);
    if (number === null) return control.default;
    const clamped = Math.min(control.max, Math.max(control.min, number));
    const stepped = control.min + Math.round((clamped - control.min) / control.step) * control.step;
    const digits = String(control.step).includes('.') ? String(control.step).split('.')[1].length : 0;
    return Math.min(control.max, Math.max(control.min, Number(stepped.toFixed(digits))));
  }
  if (control.type === 'toggle') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === 'false' || raw === 0 || raw === '0') return false;
    return control.default;
  }
  if (control.type === 'choice') {
    const text = String(raw ?? '').trim();
    return control.options.includes(text) ? text : control.default;
  }
  const text = String(raw ?? '').trim().toLowerCase();
  return HEX_COLOR.test(text) ? text : control.default;
}

// Saved values (possibly stale keys, possibly bad values) -> the exact object
// delivered to the bug: every declared key present, every value legal.
function resolveThemeSettingValues(declaration, saved) {
  const values = {};
  const stored = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  for (const control of declaration || []) {
    values[control.key] = Object.hasOwn(stored, control.key) ? coerceValue(control, stored[control.key]) : control.default;
  }
  return values;
}

module.exports = {
  MAX_SETTINGS,
  coerceValue,
  parseThemeSettingsDeclaration,
  resolveThemeSettingValues,
};
