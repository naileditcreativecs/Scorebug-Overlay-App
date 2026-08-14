(function exposeChromaKey(globalScope) {
  'use strict';

  const DEFAULT_GREEN_SCREEN = Object.freeze({
    enabled: false,
    color: '#00ff00',
    tolerance: 0.06,
    softness: 0.04,
    backdrop: 'transparent',
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
      // "green" paints the overlay window solid key color behind the bug so
      // capture paths that composite transparency as black (OBS window
      // capture, some GPU drivers) get real green pixels to key instead.
      backdrop: source.backdrop === 'green' ? 'green' : 'transparent',
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

  /**
   * Script that installs (or removes) the chroma-key filter INSIDE the theme
   * document. Filtering the <webview> element from the host is unreliable:
   * the guest renders in its own process, and on some GPU paths Chromium
   * cannot run an SVG filter over that out-of-process surface - the whole
   * element composites as a solid black box. Running the same filter on the
   * guest's own <body> keeps it an ordinary in-process SVG filter, which
   * renders correctly everywhere. Idempotent; safe to re-run on every change.
   */
  function guestFilterScript(value) {
    const settings = normalizeGreenScreen(value);
    const config = JSON.stringify({
      enabled: settings.enabled,
      color: settings.color,
      matrix: matrixValues(settings),
    });
    return `(() => {
      const config = ${config};
      const svgId = 'cfb27-guest-chroma-svg';
      const styleId = 'cfb27-guest-chroma-style';
      const oldSvg = document.getElementById(svgId);
      const oldStyle = document.getElementById(styleId);
      if (!config.enabled) {
        if (oldSvg) oldSvg.remove();
        if (oldStyle) oldStyle.remove();
        return 'chroma-off';
      }
      const ns = 'http://www.w3.org/2000/svg';
      if (!oldSvg) {
        const svg = document.createElementNS(ns, 'svg');
        svg.id = svgId;
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        const filter = document.createElementNS(ns, 'filter');
        filter.id = 'cfb27-guest-chroma-filter';
        filter.setAttribute('x', '-20%');
        filter.setAttribute('y', '-20%');
        filter.setAttribute('width', '140%');
        filter.setAttribute('height', '140%');
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        const flood = document.createElementNS(ns, 'feFlood');
        flood.id = 'cfb27-guest-chroma-color';
        flood.setAttribute('result', 'key-color');
        const blend = document.createElementNS(ns, 'feBlend');
        blend.setAttribute('in', 'SourceGraphic');
        blend.setAttribute('in2', 'key-color');
        blend.setAttribute('mode', 'difference');
        blend.setAttribute('result', 'key-difference');
        const matrix = document.createElementNS(ns, 'feColorMatrix');
        matrix.id = 'cfb27-guest-chroma-matrix';
        matrix.setAttribute('in', 'key-difference');
        matrix.setAttribute('type', 'matrix');
        matrix.setAttribute('result', 'key-mask');
        const composite = document.createElementNS(ns, 'feComposite');
        composite.setAttribute('in', 'SourceGraphic');
        composite.setAttribute('in2', 'key-mask');
        composite.setAttribute('operator', 'in');
        filter.appendChild(flood);
        filter.appendChild(blend);
        filter.appendChild(matrix);
        filter.appendChild(composite);
        svg.appendChild(filter);
        document.documentElement.appendChild(svg);
      }
      document.getElementById('cfb27-guest-chroma-color')
        .setAttribute('flood-color', config.color);
      document.getElementById('cfb27-guest-chroma-matrix')
        .setAttribute('values', config.matrix);
      let style = oldStyle;
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        document.documentElement.appendChild(style);
      }
      style.textContent = 'body { filter: url("#cfb27-guest-chroma-filter"); } '
        + '#' + svgId + ' { position: fixed; width: 0; height: 0; }';
      return 'chroma-on';
    })()`;
  }

  const api = Object.freeze({
    DEFAULT_GREEN_SCREEN,
    alphaForRgb,
    guestFilterScript,
    matrixValues,
    normalizeColor,
    normalizeGreenScreen,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.CFB27ChromaKey = api;
})(typeof window !== 'undefined' ? window : globalThis);
