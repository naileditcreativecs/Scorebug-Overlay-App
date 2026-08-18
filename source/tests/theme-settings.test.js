'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseThemeSettingsDeclaration, resolveThemeSettingValues, coerceValue } = require('../src/theme-settings');

const HTML = `<html><body>
<script type="application/json" data-cfb27-settings>
{ "settings": [
  { "key": "scale", "label": "Resolution", "type": "slider", "min": 50, "max": 150, "step": 5, "default": 100, "unit": "%" },
  { "key": "showRecords", "label": "Show <b>records</b>", "type": "toggle", "default": true },
  { "key": "style", "label": "Style", "type": "choice", "options": ["Classic", "Modern"], "default": "Classic" },
  { "key": "accent", "label": "Accent color", "type": "color", "default": "#FFDE00" },
  { "key": "bad key", "label": "x", "type": "toggle", "default": true },
  { "key": "nochoice", "label": "x", "type": "choice", "options": ["A"], "default": "A" },
  { "key": "scale", "label": "dup", "type": "toggle", "default": false }
] }
</script></body></html>`;

test('theme settings: declaration parses, validates and drops bad entries', () => {
  const controls = parseThemeSettingsDeclaration(HTML);
  assert.deepEqual(controls.map((c) => c.key), ['scale', 'showRecords', 'style', 'accent']);
  assert.equal(controls[1].label, 'Show records');
  assert.equal(controls[3].default, '#ffde00');
  assert.deepEqual(parseThemeSettingsDeclaration('<script type="application/json" data-cfb27-settings>{ nope </script>'), []);
  assert.deepEqual(parseThemeSettingsDeclaration('<p>no block</p>'), []);
});

test('theme settings: values are always legal', () => {
  const controls = parseThemeSettingsDeclaration(HTML);
  const values = resolveThemeSettingValues(controls, { scale: 999, showRecords: 'false', style: 'Retro', accent: 'blue', stale: 1 });
  assert.deepEqual(values, { scale: 150, showRecords: false, style: 'Classic', accent: '#ffde00' });
  assert.deepEqual(resolveThemeSettingValues(controls, null), { scale: 100, showRecords: true, style: 'Classic', accent: '#ffde00' });
  assert.equal(coerceValue(controls[0], 103), 105);
  assert.equal(coerceValue(controls[2], 'Modern'), 'Modern');
});
