'use strict';

(function captureStreamGeometryModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Cfb27CaptureGeometry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function captureStreamGeometryFactory() {
  const FULL_FRAME = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

  function finite(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeReadRegion(value = FULL_FRAME) {
    const x = clamp(finite(value?.x, 0), 0, 1);
    const y = clamp(finite(value?.y, 0), 0, 1);
    const width = clamp(finite(value?.width, 1), 0, 1 - x);
    const height = clamp(finite(value?.height, 1), 0, 1 - y);
    if (width <= 0 || height <= 0) return { ...FULL_FRAME };
    return { x, y, width, height };
  }

  /** Resolve a normalized crop against the pixels actually supplied by WebRTC. */
  function readRegionToPixels(regionValue, widthValue, heightValue) {
    const region = normalizeReadRegion(regionValue);
    const width = Math.max(1, Math.floor(finite(widthValue, 1)));
    const height = Math.max(1, Math.floor(finite(heightValue, 1)));
    // Match read-region.js exactly so existing calibration pixels do not shift
    // when production capture moves from NativeImage thumbnails to WebRTC video.
    const left = clamp(Math.round(region.x * width), 0, width - 1);
    const top = clamp(Math.round(region.y * height), 0, height - 1);
    const right = clamp(Math.round((region.x + region.width) * width), left + 1, width);
    const bottom = clamp(Math.round((region.y + region.height) * height), top + 1, height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function sameReadRegion(left, right, epsilon = 1e-9) {
    const a = normalizeReadRegion(left);
    const b = normalizeReadRegion(right);
    return ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) <= epsilon);
  }

  function normalizeCaptureSourceId(value) {
    const sourceId = String(value || '').trim();
    return /^window:\d+:[01]$/i.test(sourceId) ? sourceId : '';
  }

  return {
    FULL_FRAME,
    normalizeCaptureSourceId,
    normalizeReadRegion,
    readRegionToPixels,
    sameReadRegion,
  };
}));
