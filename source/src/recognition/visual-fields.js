'use strict';

const { PNG } = require('pngjs');

const TIMEOUT_LAYOUT = Object.freeze({
  slotX: Object.freeze([0.062, 0.178, 0.294]),
  slotWidth: 0.066,
  awayY: 0.148,
  homeY: 0.504,
  slotHeight: 0.012,
  activeLuminance: 150,
  // A used timeout bar is still visible over a bright team panel. Live
  // captures measured that dim bar at about 160 while remaining bars were
  // about 203. Compare slots within the same row so team-color brightness
  // cannot make the used bar look active.
  maximumActiveDrop: 24,
  // The lower team row is the one most affected by capture rounding and bright
  // team panels. Search only a few pixels around its measured centerline; all
  // three slots must still come from one shared row candidate.
  homeSearchOffsets: Object.freeze([-0.012, -0.008, -0.004, 0, 0.004, 0.008, 0.012]),
  // When the last home timeout is spent, all three indicators can remain as
  // dim neutral bars (about 161 luminance in the captured donor) rather than
  // becoming black. Use the row's white name/score artwork as an exposure
  // reference so those dim bars do not suddenly look like three timeouts.
  homeReferenceRegion: Object.freeze({ x: 0.01, y: 0.356, width: 0.72, height: 0.36 }),
  homeReferenceQuantile: 0.9,
  homeReferenceMinimum: 170,
  homeReferenceRatio: 0.72,
});

const DEFAULT_TIMEOUT_REGIONS = Object.freeze({
  away: Object.freeze({ x: 0.0620155039, y: 0.1301369863, width: 0.2984496124, height: 0.0479452055 }),
  home: Object.freeze({ x: 0.0620155039, y: 0.4863013699, width: 0.2984496124, height: 0.0479452055 }),
});
const TIMEOUT_REGION_SLOT_STARTS = Object.freeze(
  TIMEOUT_LAYOUT.slotX.map((x) => (
    (x - TIMEOUT_LAYOUT.slotX[0]) / (
      (TIMEOUT_LAYOUT.slotX[2] + TIMEOUT_LAYOUT.slotWidth) - TIMEOUT_LAYOUT.slotX[0]
    )
  )),
);
const TIMEOUT_REGION_SLOT_WIDTH = TIMEOUT_LAYOUT.slotWidth / (
  (TIMEOUT_LAYOUT.slotX[2] + TIMEOUT_LAYOUT.slotWidth) - TIMEOUT_LAYOUT.slotX[0]
);

const CALIBRATED_TIMEOUT_LAYOUT = Object.freeze({
  // A calibrated box surrounds all three timeout indicators. Search within
  // each third instead of requiring the user to draw a pixel-perfect box.
  slotWidthRatios: Object.freeze([0.42, 0.54, 0.66, 0.76]),
  slotHeightRatios: Object.freeze([0.2, 0.28, 0.36, 0.46]),
  // Live native captures measured remaining white bars at roughly 0.71-0.87
  // opacity over their team panels and used bars near 0.60. Measuring opacity
  // relative to the local RGB background keeps the split stable on bright
  // gold/light-blue panels as well as dark team colors.
  activeWhiteOpacity: 0.65,
  // Animated donors intermittently blank the whole timeout strip. Live
  // sessions measured those frames at <=0.02 slot opacity over a near-black
  // background, while genuine used bars stay far brighter, so an all-slot
  // reading under this floor on a dark row means "strip not rendered".
  emptyStripOpacity: 0.08,
  hiddenStripLuminance: 8,
  // Remaining bars are WHITE. Used bars can stay rendered in a different
  // color (gold, red, gray) bright enough to clear the opacity split, so a
  // remaining bar must also be near-neutral bright: every channel high and
  // little chroma spread.
  activeMinimumChannel: 140,
  activeMaximumChroma: 70,
});

const POSSESSION_LAYOUT = Object.freeze({
  x: 0.02,
  width: 0.55,
  awayY: 0.19,
  awayHeight: 0.21,
  homeY: 0.55,
  homeHeight: 0.19,
});

function decode(input) {
  if (Buffer.isBuffer(input)) return PNG.sync.read(input);
  if (input?.width && input?.height && input?.data) return input;
  throw new TypeError('visual field input must be a PNG buffer or decoded PNG');
}

function pixelBounds(image, region) {
  const left = Math.max(0, Math.min(image.width - 1, Math.round(region.x * image.width)));
  const top = Math.max(0, Math.min(image.height - 1, Math.round(region.y * image.height)));
  const right = Math.max(left + 1, Math.min(image.width, Math.round((region.x + region.width) * image.width)));
  const bottom = Math.max(top + 1, Math.min(image.height, Math.round((region.y + region.height) * image.height)));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function luminance(red, green, blue) {
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function meanLuminance(image, region) {
  const bounds = pixelBounds(image, region);
  let total = 0;
  let count = 0;
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const index = ((y * image.width) + x) * 4;
      total += luminance(image.data[index], image.data[index + 1], image.data[index + 2]);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function createRgbIntegral(image) {
  const stride = image.width + 1;
  const size = stride * (image.height + 1);
  const red = new Float64Array(size);
  const green = new Float64Array(size);
  const blue = new Float64Array(size);
  for (let y = 1; y <= image.height; y += 1) {
    let rowRed = 0;
    let rowGreen = 0;
    let rowBlue = 0;
    for (let x = 1; x <= image.width; x += 1) {
      const source = ((((y - 1) * image.width) + (x - 1)) * 4);
      rowRed += image.data[source];
      rowGreen += image.data[source + 1];
      rowBlue += image.data[source + 2];
      const target = (y * stride) + x;
      red[target] = red[target - stride] + rowRed;
      green[target] = green[target - stride] + rowGreen;
      blue[target] = blue[target - stride] + rowBlue;
    }
  }
  return { width: image.width, height: image.height, stride, red, green, blue };
}

function integralMeanRgb(integral, rectangle) {
  const left = Math.max(0, Math.min(integral.width - 1, Math.round(rectangle.left)));
  const top = Math.max(0, Math.min(integral.height - 1, Math.round(rectangle.top)));
  const right = Math.max(left + 1, Math.min(integral.width, Math.round(rectangle.right)));
  const bottom = Math.max(top + 1, Math.min(integral.height, Math.round(rectangle.bottom)));
  const count = (right - left) * (bottom - top);
  const sum = (channel) => (
    channel[(bottom * integral.stride) + right]
    - channel[(top * integral.stride) + right]
    - channel[(bottom * integral.stride) + left]
    + channel[(top * integral.stride) + left]
  );
  return [sum(integral.red) / count, sum(integral.green) / count, sum(integral.blue) / count];
}

function rgbLuminance(rgb) {
  return luminance(rgb[0], rgb[1], rgb[2]);
}

/** Estimate how strongly foreground is composited toward white over background. */
function whiteBlendOpacity(foreground, background) {
  let numerator = 0;
  let denominator = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const whiteDirection = 255 - background[channel];
    numerator += (foreground[channel] - background[channel]) * whiteDirection;
    denominator += whiteDirection * whiteDirection;
  }
  if (denominator < 1) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function uniquePixelSizes(values, maximum) {
  return [...new Set(values.map((value) => Math.max(2, Math.min(maximum, Math.round(value)))))]
    .sort((left, right) => left - right);
}

function localBackgroundCandidates(integral, rectangle, calibratedBounds) {
  const height = rectangle.bottom - rectangle.top;
  const gap = Math.max(1, Math.round(height * 0.45));
  const candidates = [];
  const aboveBottom = rectangle.top - gap;
  const aboveTop = Math.max(0, aboveBottom - height);
  if (aboveBottom - aboveTop >= 1) {
    candidates.push(integralMeanRgb(integral, {
      left: rectangle.left,
      top: aboveTop,
      right: rectangle.right,
      bottom: aboveBottom,
    }));
  }
  const belowTop = rectangle.bottom + gap;
  const belowBottom = Math.min(integral.height, belowTop + height);
  if (belowBottom - belowTop >= 1) {
    candidates.push(integralMeanRgb(integral, {
      left: rectangle.left,
      top: belowTop,
      right: rectangle.right,
      bottom: belowBottom,
    }));
  }

  // Near an image edge, prefer a same-panel sample from inside the calibrated
  // box rather than treating black outside the capture as team background.
  if (!candidates.length) {
    const fallbackTop = rectangle.top <= calibratedBounds.top + 1
      ? rectangle.bottom
      : Math.max(calibratedBounds.top, rectangle.top - height);
    const fallbackBottom = Math.min(
      calibratedBounds.bottom,
      fallbackTop + Math.max(1, height),
    );
    candidates.push(integralMeanRgb(integral, {
      left: rectangle.left,
      top: fallbackTop,
      right: rectangle.right,
      bottom: Math.max(fallbackTop + 1, fallbackBottom),
    }));
  }
  return candidates;
}

function calibratedSlotCandidate(integral, rectangle, calibratedBounds) {
  const foreground = integralMeanRgb(integral, rectangle);
  const backgrounds = localBackgroundCandidates(integral, rectangle, calibratedBounds);
  let best = null;
  for (const background of backgrounds) {
    const opacity = whiteBlendOpacity(foreground, background);
    if (!best || opacity > best.opacity) best = { opacity, background };
  }
  return {
    ...best,
    foreground,
    luminance: rgbLuminance(foreground),
  };
}

function detectCalibratedTimeouts(image, region, options = {}) {
  const integral = options.integral || createRgbIntegral(image);
  const bounds = pixelBounds(image, region);
  const slotCellWidth = bounds.width / 3;
  const slotWidths = uniquePixelSizes(
    CALIBRATED_TIMEOUT_LAYOUT.slotWidthRatios.map((ratio) => slotCellWidth * ratio),
    Math.max(2, Math.floor(slotCellWidth)),
  );
  const slotHeights = uniquePixelSizes(
    CALIBRATED_TIMEOUT_LAYOUT.slotHeightRatios.map((ratio) => bounds.height * ratio),
    Math.max(2, bounds.height),
  );
  let selected = null;

  for (const height of slotHeights) {
    for (let top = bounds.top; top <= bounds.bottom - height; top += 1) {
      const slots = [];
      for (let slot = 0; slot < 3; slot += 1) {
        const cellLeft = Math.round(bounds.left + (slot * slotCellWidth));
        const cellRight = Math.round(bounds.left + ((slot + 1) * slotCellWidth));
        let bestSlot = null;
        for (const width of slotWidths) {
          if (width > cellRight - cellLeft) continue;
          for (let left = cellLeft; left <= cellRight - width; left += 1) {
            const rectangle = { left, top, right: left + width, bottom: top + height };
            const candidate = calibratedSlotCandidate(integral, rectangle, bounds);
            if (!bestSlot || candidate.opacity > bestSlot.opacity) {
              bestSlot = { ...candidate, rectangle };
            }
          }
        }
        slots.push(bestSlot || {
          opacity: 0,
          foreground: [0, 0, 0],
          background: [0, 0, 0],
          luminance: 0,
          rectangle: { left: cellLeft, top, right: cellRight, bottom: top + height },
        });
      }
      const rowStrength = slots.reduce((sum, slot) => sum + slot.opacity, 0) / slots.length;
      if (!selected || rowStrength > selected.rowStrength) {
        selected = { top, height, slots, rowStrength };
      }
    }
  }

  const slotOpacity = selected.slots.map((slot) => slot.opacity);
  const rowBackgroundLuminance = selected.slots.reduce(
    (sum, slot) => sum + rgbLuminance(slot.background),
    0,
  ) / selected.slots.length;
  // A blanked (animated-away) strip is not a zero-timeout reading: every slot
  // measures near-zero opacity over a near-black row. Genuine used bars and
  // team panels stay measurably brighter, so report indeterminate and let the
  // validator retain the last known count instead of publishing 0.
  if (Math.max(...slotOpacity) < CALIBRATED_TIMEOUT_LAYOUT.emptyStripOpacity
    && rowBackgroundLuminance < CALIBRATED_TIMEOUT_LAYOUT.hiddenStripLuminance) {
    return {
      value: null,
      confidence: 0,
      patternValid: false,
      stripHidden: true,
      detectionMode: 'calibrated-local-white-opacity',
      detectionThreshold: CALIBRATED_TIMEOUT_LAYOUT.activeWhiteOpacity,
      opacityThreshold: CALIBRATED_TIMEOUT_LAYOUT.activeWhiteOpacity,
      slotOpacity: slotOpacity.map((value) => Number(value.toFixed(3))),
      slotLuminance: selected.slots.map((slot) => Number(slot.luminance.toFixed(1))),
      sampleY: Number((selected.top / image.height).toFixed(4)),
      sampleX: selected.slots.map((slot) => Number((slot.rectangle.left / image.width).toFixed(4))),
      referenceLuminance: Number(rowBackgroundLuminance.toFixed(1)),
    };
  }
  // A remaining bar must read as WHITE, not merely bright: used bars that
  // stay rendered in a team or accent color keep high contrast against the
  // panel but carry chroma that white bars never do.
  const whiteish = selected.slots.map((slot) => {
    const max = Math.max(slot.foreground[0], slot.foreground[1], slot.foreground[2]);
    const min = Math.min(slot.foreground[0], slot.foreground[1], slot.foreground[2]);
    return min >= CALIBRATED_TIMEOUT_LAYOUT.activeMinimumChannel
      && (max - min) <= CALIBRATED_TIMEOUT_LAYOUT.activeMaximumChroma;
  });
  const active = slotOpacity.map((value, index) => (
    value >= CALIBRATED_TIMEOUT_LAYOUT.activeWhiteOpacity && whiteish[index]
  ));
  const activeIndexes = active
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  const patternValid = activeIndexes.length < 2
    || activeIndexes[activeIndexes.length - 1] - activeIndexes[0] + 1 === activeIndexes.length;
  const certainty = slotOpacity.reduce((sum, value) => (
    sum + Math.min(1, Math.abs(value - CALIBRATED_TIMEOUT_LAYOUT.activeWhiteOpacity) / 0.35)
  ), 0) / slotOpacity.length;
  const confidence = !patternValid
    ? 0.2
    : activeIndexes.length === 0
      ? Math.min(0.7, 0.64 + (certainty * 0.06))
      : Math.min(0.98, 0.72 + (certainty * 0.26));

  return {
    value: patternValid ? activeIndexes.length : null,
    confidence,
    patternValid,
    detectionMode: 'calibrated-local-white-opacity',
    detectionThreshold: CALIBRATED_TIMEOUT_LAYOUT.activeWhiteOpacity,
    opacityThreshold: CALIBRATED_TIMEOUT_LAYOUT.activeWhiteOpacity,
    slotOpacity: slotOpacity.map((value) => Number(value.toFixed(3))),
    slotWhiteish: whiteish,
    slotRgb: selected.slots.map((slot) => slot.foreground.map((value) => Math.round(value))),
    slotLuminance: selected.slots.map((slot) => Number(slot.luminance.toFixed(1))),
    sampleY: Number((selected.top / image.height).toFixed(4)),
    sampleX: selected.slots.map((slot) => Number((slot.rectangle.left / image.width).toFixed(4))),
    referenceLuminance: Number((selected.slots.reduce(
      (sum, slot) => sum + rgbLuminance(slot.background),
      0,
    ) / selected.slots.length).toFixed(1)),
  };
}

function timeoutSlotLuminance(image, y) {
  return TIMEOUT_LAYOUT.slotX.map((x) => meanLuminance(image, {
    x,
    y,
    width: TIMEOUT_LAYOUT.slotWidth,
    height: TIMEOUT_LAYOUT.slotHeight,
  }));
}

function validTimeoutRegion(region) {
  if (!region || typeof region !== 'object') return null;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(region[key]));
  if (!values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
    return null;
  }
  return { x, y, width, height };
}

function timeoutSlotLuminanceInRegion(image, region, sampleY) {
  const slotWidth = region.width * TIMEOUT_REGION_SLOT_WIDTH;
  const slotHeight = Math.min(
    region.height,
    Math.max(2 / image.height, Math.min(TIMEOUT_LAYOUT.slotHeight, region.height)),
  );
  return TIMEOUT_REGION_SLOT_STARTS.map((start) => meanLuminance(image, {
    x: region.x + (start * region.width),
    y: sampleY,
    width: slotWidth,
    height: slotHeight,
  }));
}

function neutralLuminanceReference(image, region, quantile = 0.9) {
  const bounds = pixelBounds(image, region);
  const values = [];
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const index = ((y * image.width) + x) * 4;
      if (image.data[index + 3] < 200) continue;
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 45) continue;
      values.push(luminance(red, green, blue));
    }
  }
  if (!values.length) return null;
  values.sort((left, right) => left - right);
  const position = Math.round((values.length - 1) * Math.max(0, Math.min(1, quantile)));
  return values[position];
}

function timeoutRowCandidates(image, y, side, region = null) {
  const calibrated = validTimeoutRegion(region);
  if (calibrated) {
    const slotHeight = Math.min(
      calibrated.height,
      Math.max(2 / image.height, Math.min(TIMEOUT_LAYOUT.slotHeight, calibrated.height)),
    );
    const startPixel = Math.max(0, Math.round(calibrated.y * image.height));
    const lastPixel = Math.max(startPixel, Math.round(
      (calibrated.y + calibrated.height - slotHeight) * image.height,
    ));
    const candidates = [];
    for (let pixelY = startPixel; pixelY <= lastPixel; pixelY += 1) {
      const sampleY = Math.max(0, Math.min(1 - slotHeight, pixelY / image.height));
      const slotLuminance = timeoutSlotLuminanceInRegion(image, calibrated, sampleY);
      const rowStrength = slotLuminance.reduce((sum, value) => sum + value, 0) / slotLuminance.length;
      candidates.push({ sampleY, slotLuminance, rowStrength });
    }
    return candidates;
  }
  const offsets = side === 'home' ? TIMEOUT_LAYOUT.homeSearchOffsets : [0];
  return offsets.map((offset) => {
    const sampleY = Math.max(0, Math.min(1 - TIMEOUT_LAYOUT.slotHeight, y + offset));
    const slotLuminance = timeoutSlotLuminance(image, sampleY);
    const rowStrength = slotLuminance.reduce((sum, value) => sum + value, 0) / slotLuminance.length;
    return { sampleY, slotLuminance, rowStrength };
  });
}

function detectTimeouts(image, y, options = {}) {
  const side = options.side === 'home'
    || (options.side !== 'away' && Math.abs(y - TIMEOUT_LAYOUT.homeY) < 0.05)
    ? 'home'
    : 'away';
  const calibrated = validTimeoutRegion(options.region);
  if (calibrated) {
    return detectCalibratedTimeouts(image, calibrated, options);
  }
  const candidates = timeoutRowCandidates(image, y, side);
  const selected = candidates.reduce((best, candidate) => (
    !best || candidate.rowStrength > best.rowStrength ? candidate : best
  ), null);
  const slotLuminance = selected.slotLuminance;
  const brightest = Math.max(...slotLuminance);
  const referenceLuminance = side === 'home'
    ? neutralLuminanceReference(
      image,
      TIMEOUT_LAYOUT.homeReferenceRegion,
      TIMEOUT_LAYOUT.homeReferenceQuantile,
    )
    : null;
  const adaptiveFloor = side === 'home'
    && referenceLuminance !== null
    && referenceLuminance >= TIMEOUT_LAYOUT.homeReferenceMinimum
    ? referenceLuminance * TIMEOUT_LAYOUT.homeReferenceRatio
    : TIMEOUT_LAYOUT.activeLuminance;
  const detectionThreshold = Math.max(
    adaptiveFloor,
    brightest - TIMEOUT_LAYOUT.maximumActiveDrop,
  );
  const active = slotLuminance.map((value) => value >= detectionThreshold);
  const activeIndexes = active
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  const patternValid = activeIndexes.length < 2
    || activeIndexes[activeIndexes.length - 1] - activeIndexes[0] + 1 === activeIndexes.length;
  const certainty = slotLuminance.reduce((sum, value) => (
    sum + Math.min(1, Math.abs(value - detectionThreshold) / 80)
  ), 0) / slotLuminance.length;
  // Zero remaining bars is a valid football state, but an all-dark crop is
  // also what menus and cutscenes look like. Keep it above the default field
  // threshold while accurately expressing that it is weaker evidence than
  // one or more clearly illuminated bars; the state validator supplies the
  // temporal/visibility proof before publishing it.
  const confidence = !patternValid
    ? 0.2
    : activeIndexes.length === 0
      ? Math.min(0.7, 0.64 + (certainty * 0.06))
      : Math.min(0.98, 0.72 + (certainty * 0.26));
  return {
    value: patternValid ? activeIndexes.length : null,
    confidence,
    patternValid,
    detectionThreshold: Number(detectionThreshold.toFixed(1)),
    slotLuminance: slotLuminance.map((value) => Number(value.toFixed(1))),
    sampleY: Number(selected.sampleY.toFixed(4)),
    referenceLuminance: referenceLuminance === null
      ? null
      : Number(referenceLuminance.toFixed(1)),
  };
}

function isNeutralBright(image, x, y) {
  const index = ((y * image.width) + x) * 4;
  const red = image.data[index];
  const green = image.data[index + 1];
  const blue = image.data[index + 2];
  return luminance(red, green, blue) >= 180
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= 55;
}

function connectedComponents(image, region) {
  const bounds = pixelBounds(image, region);
  const mask = new Uint8Array(bounds.width * bounds.height);
  const seen = new Uint8Array(mask.length);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      if (isNeutralBright(image, bounds.left + x, bounds.top + y)) mask[(y * bounds.width) + x] = 1;
    }
  }

  const components = [];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || seen[seed]) continue;
    const stack = [seed];
    seen[seed] = 1;
    let area = 0;
    let left = bounds.width;
    let top = bounds.height;
    let right = 0;
    let bottom = 0;
    while (stack.length) {
      const value = stack.pop();
      const x = value % bounds.width;
      const y = Math.floor(value / bounds.width);
      area += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= bounds.width || nextY < 0 || nextY >= bounds.height) continue;
          const next = (nextY * bounds.width) + nextX;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    const width = right - left + 1;
    const height = bottom - top + 1;
    components.push({
      x: bounds.left + left,
      y: bounds.top + top,
      width,
      height,
      area,
      fill: area / (width * height),
    });
  }
  return components;
}

function triangleCandidates(image, y, height) {
  const totalPixels = image.width * image.height;
  return connectedComponents(image, {
    x: POSSESSION_LAYOUT.x,
    y,
    width: POSSESSION_LAYOUT.width,
    height,
  }).filter((component) => {
    const aspect = component.height / component.width;
    return component.width >= image.width * 0.03
      && component.width <= image.width * 0.085
      && component.height >= image.height * 0.04
      && component.height <= image.height * 0.095
      && component.area >= totalPixels * 0.0008
      && component.area <= totalPixels * 0.006
      && component.fill >= 0.45
      && component.fill <= 0.75
      && aspect >= 1
      && aspect <= 2.2;
  });
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function meanRgb(values) {
  if (!values.length) return [0, 0, 0];
  const total = values.reduce((sum, value) => [
    sum[0] + value.red,
    sum[1] + value.green,
    sum[2] + value.blue,
  ], [0, 0, 0]);
  return total.map((value) => value / values.length);
}

function calibratedPossessionSamples(image, region) {
  const bounds = pixelBounds(image, region);
  const samples = [];
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const index = ((y * image.width) + x) * 4;
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      samples.push({
        x,
        y,
        red,
        green,
        blue,
        alpha: image.data[index + 3],
        luminance: luminance(red, green, blue),
        chroma: Math.max(red, green, blue) - Math.min(red, green, blue),
      });
    }
  }
  const opaque = samples.filter((sample) => sample.alpha >= 200);
  const darkest = [...opaque]
    .sort((left, right) => left.luminance - right.luminance)
    .slice(0, Math.max(1, Math.ceil(opaque.length * 0.35)));
  return {
    bounds,
    samples,
    opaque,
    background: meanRgb(darkest),
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

function possessionForegroundMask(sampleSet, strength) {
  const { bounds, samples, background } = sampleSet;
  const mask = new Uint8Array(bounds.width * bounds.height);
  const backgroundLuminance = rgbLuminance(background);
  let foregroundPixels = 0;
  for (const sample of samples) {
    if (sample.alpha < 200) continue;
    const opacity = whiteBlendOpacity(
      [sample.red, sample.green, sample.blue],
      background,
    );
    const contrast = sample.luminance - backgroundLuminance;
    const isForeground = strength === 'strong'
      ? opacity >= 0.34
        && contrast >= 16
        && sample.luminance >= Math.max(112, backgroundLuminance + 18)
        && sample.chroma <= 90
      : opacity >= 0.14
        && contrast >= 8
        && sample.luminance >= Math.max(62, backgroundLuminance + 9)
        && sample.chroma <= 110;
    if (!isForeground) continue;
    const localX = sample.x - bounds.left;
    const localY = sample.y - bounds.top;
    mask[(localY * bounds.width) + localX] = 1;
    foregroundPixels += 1;
  }
  return {
    mask,
    coverage: foregroundPixels / Math.max(1, bounds.width * bounds.height),
  };
}

function maskConnectedComponents(mask, bounds) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || seen[seed]) continue;
    const stack = [seed];
    const pixels = [];
    seen[seed] = 1;
    let left = bounds.width;
    let top = bounds.height;
    let right = 0;
    let bottom = 0;
    while (stack.length) {
      const value = stack.pop();
      const x = value % bounds.width;
      const y = Math.floor(value / bounds.width);
      pixels.push({ x, y });
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= bounds.width || nextY < 0 || nextY >= bounds.height) continue;
          const next = (nextY * bounds.width) + nextX;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    const width = right - left + 1;
    const height = bottom - top + 1;
    const rowWidths = new Array(height).fill(0);
    for (const pixel of pixels) rowWidths[pixel.y - top] += 1;
    components.push({
      x: bounds.left + left,
      y: bounds.top + top,
      width,
      height,
      area: pixels.length,
      fill: pixels.length / (width * height),
      rowWidths,
    });
  }
  return components;
}

function possessionTriangleScore(component, bounds) {
  if (component.width < 2 || component.height < 4 || component.area < 6) return 0;
  if (component.width > bounds.width * 0.96 || component.height > bounds.height * 0.98) return 0;
  const aspect = component.height / component.width;
  if (aspect < 0.55 || aspect > 3.2) return 0;
  const maximumWidth = Math.max(...component.rowWidths);
  const edgeRows = Math.max(1, Math.round(component.height * 0.2));
  const edgeWidths = [
    ...component.rowWidths.slice(0, edgeRows),
    ...component.rowWidths.slice(-edgeRows),
  ];
  const edgeWidth = edgeWidths.reduce((sum, value) => sum + value, 0) / edgeWidths.length;
  const taper = maximumWidth ? 1 - (edgeWidth / maximumWidth) : 0;
  const peakIndex = component.rowWidths.indexOf(maximumWidth);
  const peakPosition = component.height <= 1 ? 0.5 : peakIndex / (component.height - 1);
  const centeredPeak = clampUnit(1 - (Math.abs(peakPosition - 0.5) / 0.5));
  let changedRows = 0;
  for (let index = 1; index < component.rowWidths.length; index += 1) {
    if (component.rowWidths[index] !== component.rowWidths[index - 1]) changedRows += 1;
  }
  const progression = clampUnit((changedRows / Math.max(1, component.height - 1) - 0.08) / 0.42);
  const fillScore = component.fill < 0.3
    ? 0
    : component.fill < 0.48
      ? (component.fill - 0.3) / 0.18
      : component.fill <= 0.82
        ? 1
        : clampUnit((0.96 - component.fill) / 0.14);
  const taperScore = clampUnit((taper - 0.08) / 0.42);
  const aspectScore = aspect < 0.8
    ? clampUnit((aspect - 0.55) / 0.25)
    : aspect <= 2.4
      ? 1
      : clampUnit((3.2 - aspect) / 0.8);
  return clampUnit(
    (fillScore * 0.3)
    + (taperScore * 0.25)
    + (progression * 0.25)
    + (centeredPeak * 0.1)
    + (aspectScore * 0.1),
  );
}

// Donors draw the possession indicator as a triangle, football, bar, or glow,
// and the calibrated box is user-drawn around the indicator's lane. Any
// compact, solidly filled object occupying a meaningful fraction of that box
// therefore counts as the indicator; the classic triangle profile only adds
// score on top.
function possessionIndicatorScore(component, bounds) {
  const widthFraction = component.width / Math.max(1, bounds.width);
  const heightFraction = component.height / Math.max(1, bounds.height);
  if (widthFraction < 0.12 || heightFraction < 0.15) return 0;
  if (widthFraction > 0.97 && heightFraction > 0.97) return 0;
  if (component.area < 12) return 0;
  // Solid indicators (footballs, bars, arrows) fill their bounding box far
  // more densely than text glyphs or artwork noise; the steep fill ramp keeps
  // borderline blobs below the weak-evidence threshold so genuine absence is
  // still inferred on busy panels.
  const fillScore = clampUnit((component.fill - 0.45) / 0.3);
  const sizeScore = clampUnit((Math.min(widthFraction, heightFraction) - 0.15) / 0.3);
  const aspect = component.height / Math.max(1, component.width);
  const aspectScore = aspect >= 0.3 && aspect <= 3.6 ? 1 : 0;
  return clampUnit((fillScore * 0.55) + (sizeScore * 0.3) + (aspectScore * 0.15));
}

function scoredPossessionCandidates(maskResult, sampleSet) {
  const bounds = sampleSet.bounds;
  // A tight, indicator-sized box is its own shape prior: whatever solid
  // object renders inside it is the indicator, whether the donor draws a
  // triangle, football, bar, or glow. A wide or generously padded box can
  // also contain score digits and artwork, so it keeps the strict triangle
  // profile that distinguishes the indicator from text.
  const tightBox = bounds.width <= sampleSet.imageWidth * 0.25
    && bounds.height <= sampleSet.imageHeight * 0.5;
  // Tight boxes use gates relative to the CALIBRATED box — image-relative
  // caps rejected every candidate on the horizontal donor, whose indicator is
  // much taller than the legacy layout assumed. Wide boxes keep the original
  // image-relative gates exactly: their size ceiling is what filters score
  // digits out before shape scoring.
  return maskConnectedComponents(maskResult.mask, bounds)
    .filter((component) => (tightBox
      ? (component.width >= Math.max(2, bounds.width * 0.05)
        && component.height >= Math.max(3, bounds.height * 0.08)
        && component.area >= Math.max(8, bounds.width * bounds.height * 0.008)
        && component.area <= bounds.width * bounds.height * 0.9)
      : (component.width >= sampleSet.imageWidth * 0.025
        && component.width <= sampleSet.imageWidth * 0.09
        && component.height >= sampleSet.imageHeight * 0.035
        && component.height <= sampleSet.imageHeight * 0.105
        && component.area >= sampleSet.imageWidth * sampleSet.imageHeight * 0.00055
        && component.area <= sampleSet.imageWidth * sampleSet.imageHeight * 0.007)))
    .map((component) => ({
      ...component,
      score: Math.max(
        possessionTriangleScore(component, sampleSet.bounds),
        tightBox ? possessionIndicatorScore(component, bounds) : 0,
      ),
    }))
    .filter((component) => component.score > 0)
    .sort((left, right) => right.score - left.score);
}

function roundEvidence(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function detectCalibratedPossession(image, region, side = 'away', options = {}) {
  const observedSide = side === 'home' ? 'home' : 'away';
  const oppositeSide = observedSide === 'away' ? 'home' : 'away';
  const sampleSet = calibratedPossessionSamples(image, region);
  const strongMask = possessionForegroundMask(sampleSet, 'strong');
  const weakMask = possessionForegroundMask(sampleSet, 'weak');
  const strongCandidates = scoredPossessionCandidates(strongMask, sampleSet);
  const weakCandidates = scoredPossessionCandidates(weakMask, sampleSet);
  const bestStrong = strongCandidates[0]?.score || 0;
  const secondStrong = strongCandidates[1]?.score || 0;
  const bestWeak = weakCandidates[0]?.score || 0;
  const opaqueCoverage = sampleSet.opaque.length / Math.max(1, sampleSet.samples.length);
  const visiblePixels = sampleSet.opaque.filter((sample) => (
    Math.max(sample.red, sample.green, sample.blue) >= 48 || sample.chroma >= 28
  ));
  const visibleCoverage = visiblePixels.length / Math.max(1, sampleSet.samples.length);
  const backgroundChroma = Math.max(...sampleSet.background) - Math.min(...sampleSet.background);
  const backgroundSignal = clampUnit(Math.max(
    Math.max(...sampleSet.background) / 75,
    backgroundChroma / 55,
  ));
  const visibilityConfidence = clampUnit(
    opaqueCoverage * Math.min(1, visibleCoverage / 0.72) * backgroundSignal,
  );
  const uniqueStrongCandidate = bestStrong >= 0.7
    && (secondStrong < 0.62 || bestStrong - secondStrong >= 0.08);
  const presenceConfidence = uniqueStrongCandidate
    ? clampUnit(0.69 + (bestStrong * 0.28))
    : clampUnit(bestStrong * 0.65);
  const weakTriangleEvidence = bestWeak >= 0.58;
  const absenceConfidence = weakTriangleEvidence
    ? clampUnit(visibilityConfidence * (1 - (bestWeak * 0.75)))
    : clampUnit(visibilityConfidence * 0.84);

  let state = 'ambiguous';
  let value = null;
  let confidence = Math.min(0.55, Math.max(presenceConfidence, absenceConfidence * 0.65));
  if (uniqueStrongCandidate) {
    state = 'present';
    value = observedSide;
    confidence = presenceConfidence;
  } else if (visibilityConfidence >= 0.66 && !weakTriangleEvidence && secondStrong < 0.5) {
    state = 'absent';
    value = oppositeSide;
    confidence = absenceConfidence;
  } else if (options.emptyDarkMeansOpposite === true
    && opaqueCoverage >= 0.95
    && visibleCoverage <= 0.02
    && bestWeak < 0.2
    && secondStrong < 0.2) {
    // The black-and-white donor clears the away indicator lane to pure black
    // when possession moves to the home team. The surrounding OCR anchor and
    // the validator's two-frame inferred-absence hold provide the transition
    // safety that brightness cannot provide inside this intentionally black
    // calibrated box.
    state = 'absent';
    value = oppositeSide;
    confidence = 0.84;
  }

  const summarize = (component) => ({
    x: component.x,
    y: component.y,
    width: component.width,
    height: component.height,
    area: component.area,
    fill: roundEvidence(component.fill),
    score: roundEvidence(component.score),
  });
  return {
    value,
    confidence: roundEvidence(confidence),
    state,
    observedSide,
    presenceConfidence: roundEvidence(presenceConfidence),
    absenceConfidence: roundEvidence(absenceConfidence),
    detectionMode: state === 'absent' && visibilityConfidence < 0.66
      ? 'calibrated-single-side-dark-empty'
      : 'calibrated-single-side',
    candidates: {
      away: observedSide === 'away' ? strongCandidates.map(summarize) : [],
      home: observedSide === 'home' ? strongCandidates.map(summarize) : [],
    },
    evidence: {
      backgroundRgb: sampleSet.background.map((value) => roundEvidence(value, 1)),
      backgroundLuminance: roundEvidence(rgbLuminance(sampleSet.background), 1),
      visibleCoverage: roundEvidence(visibleCoverage),
      visibilityConfidence: roundEvidence(visibilityConfidence),
      strongForegroundCoverage: roundEvidence(strongMask.coverage),
      weakForegroundCoverage: roundEvidence(weakMask.coverage),
      bestStrongTriangleScore: roundEvidence(bestStrong),
      bestWeakTriangleScore: roundEvidence(bestWeak),
      darkEmptyInferenceEnabled: options.emptyDarkMeansOpposite === true,
    },
  };
}

function detectPossession(image, options = {}) {
  const suppliedRegion = options.region || options.possessionRegion;
  const calibratedRegion = validTimeoutRegion(suppliedRegion);
  if (calibratedRegion) {
    return detectCalibratedPossession(
      image,
      calibratedRegion,
      options.side || options.possessionSide,
      options,
    );
  }
  const away = triangleCandidates(image, POSSESSION_LAYOUT.awayY, POSSESSION_LAYOUT.awayHeight);
  const home = triangleCandidates(image, POSSESSION_LAYOUT.homeY, POSSESSION_LAYOUT.homeHeight);
  if (away.length === 1 && home.length === 0) {
    return { value: 'away', confidence: 0.78, candidates: { away, home } };
  }
  if (home.length === 1 && away.length === 0) {
    return { value: 'home', confidence: 0.78, candidates: { away, home } };
  }
  return { value: null, confidence: 0, candidates: { away, home } };
}

const VISUAL_ANALYSIS_MINIMUM = Object.freeze({ width: 120, height: 140 });
const VISUAL_ANALYSIS_FLOOR = Object.freeze({ width: 64, height: 48 });

// Valid read-region crops can be smaller than the analysis minimum: the
// capture stream accepts crops down to 96x40, and a 1080p game window yields
// a factory crop only ~108px tall. Timeout pills and the possession triangle
// are solid color blocks, so a nearest-neighbor upscale preserves their
// structure and keeps these fields working instead of failing every frame.
function upscaleForVisualAnalysis(image) {
  const factor = Math.max(
    1,
    Math.ceil(VISUAL_ANALYSIS_MINIMUM.width / image.width),
    Math.ceil(VISUAL_ANALYSIS_MINIMUM.height / image.height),
  );
  if (factor === 1) return image;
  const width = image.width * factor;
  const height = image.height * factor;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = Math.floor(y / factor) * image.width;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceRow + Math.floor(x / factor)) * 4;
      const target = ((y * width) + x) * 4;
      data[target] = image.data[source];
      data[target + 1] = image.data[source + 1];
      data[target + 2] = image.data[source + 2];
      data[target + 3] = image.data[source + 3];
    }
  }
  return { width, height, data };
}

function analyzeVisualFields(input, options = {}) {
  let image = decode(input);
  if (image.width < VISUAL_ANALYSIS_FLOOR.width || image.height < VISUAL_ANALYSIS_FLOOR.height) {
    throw new Error('Read-region image is too small for visual field detection');
  }
  if (image.width < VISUAL_ANALYSIS_MINIMUM.width || image.height < VISUAL_ANALYSIS_MINIMUM.height) {
    image = upscaleForVisualAnalysis(image);
  }
  const timeoutIntegral = validTimeoutRegion(options.timeoutRegions?.away)
    || validTimeoutRegion(options.timeoutRegions?.home)
    ? createRgbIntegral(image)
    : null;
  return {
    awayTimeouts: detectTimeouts(image, TIMEOUT_LAYOUT.awayY, {
      side: 'away',
      region: options.timeoutRegions?.away,
      integral: timeoutIntegral,
    }),
    homeTimeouts: detectTimeouts(image, TIMEOUT_LAYOUT.homeY, {
      side: 'home',
      region: options.timeoutRegions?.home,
      integral: timeoutIntegral,
    }),
    possession: detectPossession(image, {
      region: options.possessionRegion || options.possession?.region,
      side: options.possessionSide || options.possession?.side,
      emptyDarkMeansOpposite: options.emptyDarkMeansOpposite === true
        || options.possession?.emptyDarkMeansOpposite === true,
    }),
  };
}

module.exports = {
  CALIBRATED_TIMEOUT_LAYOUT,
  POSSESSION_LAYOUT,
  DEFAULT_TIMEOUT_REGIONS,
  TIMEOUT_LAYOUT,
  analyzeVisualFields,
  connectedComponents,
  createRgbIntegral,
  detectCalibratedTimeouts,
  detectCalibratedPossession,
  detectPossession,
  detectTimeouts,
  meanLuminance,
  neutralLuminanceReference,
  timeoutSlotLuminance,
  timeoutSlotLuminanceInRegion,
  whiteBlendOpacity,
};
