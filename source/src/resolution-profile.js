(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Cfb27ResolutionProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createResolutionProfileApi() {
  'use strict';

  const DEFAULT_OUTPUT_RESOLUTION = '2160p';
  const RESOLUTION_FACTORS = Object.freeze({
    '720p': 1 / 3,
    '1080p': 0.5,
    '1080p-ultrawide': 0.5,
    '1440p': 2 / 3,
    '1440p-ultrawide': 2 / 3,
    '1440p-super-ultrawide': 2 / 3,
    '1600p-ultrawide': 20 / 27,
    '2160p': 1,
  });

  function positiveNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  function normalizeOutputResolution(value, fallback = DEFAULT_OUTPUT_RESOLUTION) {
    if (Object.prototype.hasOwnProperty.call(RESOLUTION_FACTORS, value)) return value;
    return Object.prototype.hasOwnProperty.call(RESOLUTION_FACTORS, fallback)
      ? fallback
      : DEFAULT_OUTPUT_RESOLUTION;
  }

  function resolutionFactor(outputResolution) {
    return RESOLUTION_FACTORS[normalizeOutputResolution(outputResolution)];
  }

  function effectiveScale(scaleAt2160, outputResolution, fallback = 0.5) {
    return positiveNumber(scaleAt2160, fallback) * resolutionFactor(outputResolution);
  }

  function scaleAt2160FromEffective(scale, outputResolution, fallback = 0.5) {
    return positiveNumber(scale, fallback) / resolutionFactor(outputResolution);
  }

  function resolveScaleSettings(overlay = {}, fallback = 0.5) {
    const outputResolution = normalizeOutputResolution(overlay.outputResolution);
    const legacyScale = positiveNumber(overlay.scale, fallback);
    const scaleAt2160 = positiveNumber(
      overlay.scaleAt2160,
      scaleAt2160FromEffective(legacyScale, outputResolution, fallback),
    );
    return {
      outputResolution,
      scaleAt2160,
      scale: effectiveScale(scaleAt2160, outputResolution, fallback),
    };
  }

  function dimensionsFor(canvasWidth, canvasHeight, scaleAt2160, outputResolution) {
    const scale = effectiveScale(scaleAt2160, outputResolution);
    return {
      width: Math.round(positiveNumber(canvasWidth, 371) * scale),
      height: Math.round(positiveNumber(canvasHeight, 433) * scale),
      scale,
    };
  }

  function resizeBoundsAroundAnchor(bounds, width, height, anchor = 'bottom-center') {
    const source = bounds || {};
    const oldX = Number(source.x) || 0;
    const oldY = Number(source.y) || 0;
    const oldWidth = positiveNumber(source.width, width);
    const oldHeight = positiveNumber(source.height, height);
    const nextWidth = Math.round(positiveNumber(width, oldWidth));
    const nextHeight = Math.round(positiveNumber(height, oldHeight));
    const normalizedAnchor = ['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left'].includes(anchor)
      ? anchor
      : 'bottom-center';
    const onRight = normalizedAnchor.endsWith('right');
    const onCenter = normalizedAnchor.endsWith('center');
    const onBottom = normalizedAnchor.startsWith('bottom');
    return {
      x: Math.round(onCenter ? oldX + ((oldWidth - nextWidth) / 2) : onRight ? oldX + oldWidth - nextWidth : oldX),
      y: Math.round(onBottom ? oldY + oldHeight - nextHeight : oldY),
      width: nextWidth,
      height: nextHeight,
    };
  }

  return Object.freeze({
    DEFAULT_OUTPUT_RESOLUTION,
    RESOLUTION_FACTORS,
    dimensionsFor,
    effectiveScale,
    normalizeOutputResolution,
    resolutionFactor,
    resolveScaleSettings,
    resizeBoundsAroundAnchor,
    scaleAt2160FromEffective,
  });
}));
