'use strict';

const { resolveReadRegion } = require('./read-region');
const { adaptReaderCalibrationReadRegion } = require('./reader-calibration-file');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Re-center a normalized read region for a source whose aspect ratio differs
 * from the aspect the region was authored against. The native scorebug scales
 * with the game window's HEIGHT and stays horizontally centered, so vertical
 * fractions are preserved while the width fraction and the horizontal offset
 * from center shrink or grow by referenceAspect / targetAspect — the same
 * source-height-v1 model used for saved .cfb27reader calibrations.
 *
 * A matching aspect returns the region untouched, so 16:9 sources keep their
 * exact factory fractions.
 */
function adaptRegionToAspectRatio(region, referenceAspectRatio, targetAspectRatio) {
  const reference = Number(referenceAspectRatio);
  const target = Number(targetAspectRatio);
  const source = {
    x: Number(region?.x) || 0,
    y: Number(region?.y) || 0,
    width: Number(region?.width) || 0,
    height: Number(region?.height) || 0,
  };
  if (!(reference > 0) || !(target > 0)) return source;
  const factor = reference / target;
  if (Math.abs(factor - 1) < 1e-9) return source;
  const width = clamp(source.width * factor, 0.0001, 1);
  const centerX = 0.5 + (((source.x + (source.width / 2)) - 0.5) * factor);
  const unclampedX = centerX - (width / 2);
  return {
    x: width <= 1 ? clamp(unclampedX, 0, 1 - width) : unclampedX,
    y: source.y,
    width,
    height: source.height,
  };
}

/**
 * Resolve the outer read region the live reader must crop for a given source
 * shape.
 *
 * Custom aspect-adaptive profiles (saved/imported .cfb27reader calibrations)
 * adapt through the calibration file exactly as before. Everything else —
 * factory profiles and legacy custom overrides — previously used its raw
 * normalized fractions even on ultrawide or otherwise non-16:9 sources, which
 * silently cropped different pixels than the calibration preview showed.
 * Those regions now go through the same height-proportional aspect
 * adaptation, keeping 16:9 sources bit-for-bit unchanged.
 */
function effectiveReadRegionForSource(resolvedProfile, calibration, sourceWidth, sourceHeight) {
  const profile = resolvedProfile?.profile || resolvedProfile || {};
  const base = resolveReadRegion(profile);
  if (calibration
    && resolvedProfile?.origin === 'custom'
    && profile?.aspectAdaptive === true) {
    try {
      return adaptReaderCalibrationReadRegion(calibration, sourceWidth, sourceHeight);
    } catch {
      // An unusable calibration falls back to the profile region below rather
      // than crashing the capture tick.
    }
  }
  const referenceWidth = Number(profile.captureWidth);
  const referenceHeight = Number(profile.captureHeight);
  const width = Number(sourceWidth);
  const height = Number(sourceHeight);
  if (!(referenceWidth > 0) || !(referenceHeight > 0) || !(width > 0) || !(height > 0)) {
    return base;
  }
  // A full-frame region carries no scorebug placement to re-center.
  if (base.x === 0 && base.y === 0 && base.width === 1 && base.height === 1) {
    return base;
  }
  return adaptRegionToAspectRatio(base, referenceWidth / referenceHeight, width / height);
}

module.exports = {
  adaptRegionToAspectRatio,
  effectiveReadRegionForSource,
};
