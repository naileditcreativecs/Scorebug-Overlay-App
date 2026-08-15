'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  alphaForRgb,
  guestFilterScript,
  matrixValues,
  normalizeGreenScreen,
} = require('../src/chroma-key');

test('backdrop normalizes to transparent unless explicitly green', () => {
  assert.strictEqual(normalizeGreenScreen().backdrop, 'transparent');
  assert.strictEqual(normalizeGreenScreen({ backdrop: 'green' }).backdrop, 'green');
  assert.strictEqual(normalizeGreenScreen({ backdrop: 'black' }).backdrop, 'transparent');
  assert.strictEqual(normalizeGreenScreen({ backdrop: 42 }).backdrop, 'transparent');
});

test('existing chroma settings survive normalization with backdrop present', () => {
  const settings = normalizeGreenScreen({
    enabled: true, color: '#12ab34', tolerance: 0.1, softness: 0.05, backdrop: 'green',
  });
  assert.strictEqual(settings.enabled, true);
  assert.strictEqual(settings.color, '#12ab34');
  assert.strictEqual(settings.tolerance, 0.1);
  assert.strictEqual(settings.softness, 0.05);
});

test('enabled guest script carries the key color and filter matrix', () => {
  const value = { enabled: true, color: '#00cc00', tolerance: 0.08, softness: 0.05 };
  const script = guestFilterScript(value);
  assert.ok(script.includes('"#00cc00"'));
  assert.ok(script.includes(JSON.stringify(matrixValues(value))));
  assert.ok(script.includes('cfb27-guest-chroma-filter'));
  // The style targets the guest body, never the webview element.
  assert.ok(script.includes('body { filter:'));
});

test('guest script defeats canvas background propagation', () => {
  const script = guestFilterScript({ enabled: true });
  // An html/body background paints the page CANVAS, outside every element
  // filter - it must be forced transparent and repainted on an in-body shim
  // the filter can key, or body-background green survives keying entirely.
  assert.ok(script.includes('html, body { background: transparent !important; }'));
  assert.ok(script.includes('cfb27-guest-chroma-shim'));
  assert.ok(script.includes('insertBefore(shim, document.body.firstChild)'));
  // Region must not derive from body's box: zero-height bodies (all-absolute
  // themes) would collapse an objectBoundingBox region and clip everything.
  assert.ok(script.includes("'filterUnits', 'userSpaceOnUse'"));
  // Removal restores the theme: all three artifacts are torn down.
  const off = guestFilterScript({ enabled: false });
  for (const id of ['cfb27-guest-chroma-svg', 'cfb27-guest-chroma-style', 'cfb27-guest-chroma-shim']) {
    assert.ok(off.includes(id), `off script must remove ${id}`);
  }
});

test('disabled guest script removes the filter instead of installing it', () => {
  const script = guestFilterScript({ enabled: false });
  assert.ok(script.includes('"enabled":false'));
  assert.ok(script.includes("return 'chroma-off'"));
});

test('key math still keys pure green out and keeps white', () => {
  assert.strictEqual(alphaForRgb([0, 255, 0], { enabled: true }), 0);
  assert.strictEqual(alphaForRgb([255, 255, 255], { enabled: true }), 1);
});
