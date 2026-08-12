(function exposeChromaKey(globalScope) {
  'use strict';

  const DEFAULT_GREEN_SCREEN = Object.freeze({
    enabled: false,
    color: '#00ff00',
    tolerance: 0.06,
    softness: 0.04,
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeColor(value) {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_GREEN_SCREEN.color;
  }

  function normalizeGreenScreen(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.freeze({
      enabled: source.enabled === true,
      color: normalizeColor(source.color),
      tolerance: clamp(
        finiteNumber(source.tolerance, DEFAULT_GREEN_SCREEN.tolerance),
        0,
        0.3,
      ),
      softness: clamp(
        finiteNumber(source.softness, DEFAULT_GREEN_SCREEN.softness),
        0.005,
        0.2,
      ),
    });
  }

  function cleanNumber(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  /**
   * Build the alpha row for an SVG filter. The filter first differences the
   * rendered theme against the key color, then sums the RGB distance here.
   * Pixels inside tolerance become transparent; softness feathers the edge.
   */
  function matrixValues(value = {}) {
    const settings = normalizeGreenScreen(value);
    const gain = cleanNumber(1 / (3 * settings.softness));
    const bias = cleanNumber(-settings.tolerance / settings.softness);
    return [
      '0 0 0 0 1',
      '0 0 0 0 1',
      '0 0 0 0 1',
      `${gain} ${gain} ${gain} 0 ${bias}`,
    ].join(' ');
  }

  function colorChannels(color) {
    const normalized = normalizeColor(color);
    return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  }

  /** Pure mirror of the SVG mask math, used for diagnostics and tests. */
  function alphaForRgb(rgb, value = {}) {
    const settings = normalizeGreenScreen(value);
    const key = colorChannels(settings.color);
    const source = Array.isArray(rgb) ? rgb : [rgb?.red, rgb?.green, rgb?.blue];
    const channels = source.map((channel) => clamp(finiteNumber(channel, 0), 0, 255));
    const distance = channels.reduce((sum, channel, index) => (
      sum + (Math.abs(channel - key[index]) / 255)
    ), 0) / 3;
    return clamp((distance - settings.tolerance) / settings.softness, 0, 1);
  }

  const api = Object.freeze({
    DEFAULT_GREEN_SCREEN,
    alphaForRgb,
    matrixValues,
    normalizeColor,
    normalizeGreenScreen,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.CFB27ChromaKey = api;
})(typeof window !== 'undefined' ? window : globalThis);
