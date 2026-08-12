(function exposeRoiAutoFit(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Cfb27RoiAutoFit = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function roiAutoFitFactory() {
  'use strict';

  const TEXT_BINDINGS = Object.freeze([
    'away.name',
    'away.record',
    'away.score',
    'home.name',
    'home.record',
    'home.score',
    'game.quarter',
    'game.clock',
    'game.playClock',
    'game.downDistance',
  ]);
  const TEXT_BINDING_SET = new Set(TEXT_BINDINGS);

  const HORIZONTAL_EXPANSION = Object.freeze({
    'away.name': 2.5,
    'home.name': 2.5,
    'game.downDistance': 1.75,
    'away.record': 1.25,
    'home.record': 1.25,
    'away.score': 1,
    'home.score': 1,
    'game.quarter': 1,
    'game.clock': 1,
    'game.playClock': 1,
  });
  const GAP_FACTOR = Object.freeze({
    'away.name': 0.55,
    'home.name': 0.55,
    'game.downDistance': 0.55,
    'away.record': 0.42,
    'home.record': 0.42,
    'away.score': 0.25,
    'home.score': 0.25,
    'game.quarter': 0.35,
    'game.clock': 0.35,
    'game.playClock': 0.35,
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function validImage(image) {
    return Boolean(
      image
      && Number.isInteger(image.width)
      && Number.isInteger(image.height)
      && image.width > 0
      && image.height > 0
      && image.data
      && image.data.length >= image.width * image.height * 4,
    );
  }

  function normalizeRegion(value) {
    if (!value || typeof value !== 'object') return null;
    const width = Number(value.width);
    const height = Number(value.height);
    if (![value.x, value.y, width, height].every((part) => Number.isFinite(Number(part)))
      || width <= 0
      || height <= 0) {
      return null;
    }
    const x = clamp(Number(value.x), 0, 0.999999);
    const y = clamp(Number(value.y), 0, 0.999999);
    return {
      x,
      y,
      width: clamp(width, 0.000001, 1 - x),
      height: clamp(height, 0.000001, 1 - y),
    };
  }

  function toPixelRect(regionValue, width, height) {
    const region = normalizeRegion(regionValue);
    if (!region) return null;
    const left = clamp(Math.floor(region.x * width), 0, width - 1);
    const top = clamp(Math.floor(region.y * height), 0, height - 1);
    const right = clamp(Math.ceil((region.x + region.width) * width), left + 1, width);
    const bottom = clamp(Math.ceil((region.y + region.height) * height), top + 1, height);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  function fromPixelRect(rect, width, height) {
    return {
      x: rect.left / width,
      y: rect.top / height,
      width: (rect.right - rect.left) / width,
      height: (rect.bottom - rect.top) / height,
    };
  }

  function luminanceAt(image, x, y) {
    const offset = ((y * image.width) + x) * 4;
    if (image.data[offset + 3] < 32) return null;
    return Math.round(
      (image.data[offset] * 0.2126)
      + (image.data[offset + 1] * 0.7152)
      + (image.data[offset + 2] * 0.0722),
    );
  }

  function luminanceRange(image, rect) {
    const histogram = new Uint32Array(256);
    let count = 0;
    for (let y = rect.top; y < rect.bottom; y += 1) {
      for (let x = rect.left; x < rect.right; x += 1) {
        const value = luminanceAt(image, x, y);
        if (value === null) continue;
        histogram[value] += 1;
        count += 1;
      }
    }
    if (!count) return null;

    function percentile(fraction) {
      const target = Math.max(1, Math.ceil(count * fraction));
      let total = 0;
      for (let value = 0; value < histogram.length; value += 1) {
        total += histogram[value];
        if (total >= target) return value;
      }
      return 255;
    }

    const low = percentile(0.02);
    const high = percentile(0.98);
    return {
      low,
      high,
      contrast: high - low,
      threshold: (low + high) / 2,
    };
  }

  function density(image, rect, threshold, polarity) {
    let foreground = 0;
    let total = 0;
    for (let y = rect.top; y < rect.bottom; y += 1) {
      for (let x = rect.left; x < rect.right; x += 1) {
        const value = luminanceAt(image, x, y);
        if (value === null) continue;
        total += 1;
        if (polarity === 'light' ? value > threshold : value < threshold) foreground += 1;
      }
    }
    return total ? foreground / total : 0;
  }

  /**
   * Median luminance of a thin ring just outside the seed - the local
   * background level.
   */
  function surroundingLuminance(image, seed, band = 3) {
    const samples = [];
    const left = Math.max(0, seed.left - band);
    const right = Math.min(image.width, seed.right + band);
    const top = Math.max(0, seed.top - band);
    const bottom = Math.min(image.height, seed.bottom + band);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const insideSeed = x >= seed.left && x < seed.right && y >= seed.top && y < seed.bottom;
        if (insideSeed) continue;
        const value = luminanceAt(image, x, y);
        if (value !== null) samples.push(value);
      }
    }
    if (samples.length < 8) return null;
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  }

  /**
   * Decide which side of the threshold is ink.
   *
   * The density heuristic below assumes text occupies a minority of its box and
   * rejects anything covering more than 48% of it. That assumption breaks for a
   * box drawn tightly around bold glyphs: the ink is then the MAJORITY, gets
   * rejected, and the only surviving candidate is the background. On the ESPN
   * donor's white info strip that made the strip itself the "text", so the run
   * tracer followed the band and grew game.downDistance from 360px to 973px -
   * nearly the whole frame - and pulled the cell divider into game.clock, which
   * OCR then reported as a leading 1 ("11:22" for "1:22").
   *
   * Ink is whatever contrasts with the surroundings, so ask the surroundings
   * first. Density only decides it when the ring is unavailable or ambiguous.
   */
  function choosePolarity(image, seed, threshold, range) {
    const byDensity = ['light', 'dark']
      .map((polarity) => ({ polarity, density: density(image, seed, threshold, polarity) }))
      .filter((candidate) => candidate.density >= 0.01 && candidate.density <= 0.48)
      .sort((left, right) => (
        Math.abs(left.density - 0.2) - Math.abs(right.density - 0.2)
      ));

    const background = surroundingLuminance(image, seed);
    if (background !== null && range) {
      // Only trust the ring when it sits decisively on one side of the range,
      // so a seed straddling a panel edge falls back rather than guessing.
      const span = Math.max(1, range.high - range.low);
      const position = (background - range.low) / span;
      if (position >= 0.65 || position <= 0.35) {
        const polarity = position >= 0.65 ? 'dark' : 'light';
        const inkDensity = density(image, seed, threshold, polarity);
        // A seed that contains no ink of that polarity is not text at all.
        if (inkDensity >= 0.01) {
          return { polarity, density: inkDensity, source: 'surroundings' };
        }
      }
    }
    return byDensity[0] || null;
  }

  function isForeground(image, x, y, threshold, polarity) {
    const value = luminanceAt(image, x, y);
    if (value === null) return false;
    return polarity === 'light' ? value > threshold : value < threshold;
  }

  function constrainSearchByNeighbors(seed, search, neighbors, imageWidth, imageHeight) {
    const constrained = { ...search };
    for (const neighborRegion of neighbors || []) {
      const neighbor = toPixelRect(neighborRegion, imageWidth, imageHeight);
      if (!neighbor) continue;
      const horizontalOverlap = Math.max(
        0,
        Math.min(seed.right, neighbor.right) - Math.max(seed.left, neighbor.left),
      );
      const sameColumn = horizontalOverlap >= Math.min(seed.width, neighbor.width) * 0.35;
      const verticalOverlap = Math.max(
        0,
        Math.min(seed.bottom, neighbor.bottom) - Math.max(seed.top, neighbor.top),
      );
      const sameRow = verticalOverlap >= Math.min(seed.height, neighbor.height) * 0.35;

      // A horizontal scorebug lays quarter, clock and play clock out side by
      // side, so a field's nearest neighbor is left/right rather than above or
      // below. With no horizontal limit a fitted box grows sideways until it
      // swallows the next field: live logs show the clock box reading
      // "14:5614" (clock plus play clock) and the quarter box reading the
      // clock. The midpoint keeps historical box edges from acting as hard
      // boundaries - a field may still claim most of the gap - while making it
      // impossible for two adjacent fields to fit over the same pixels.
      if (sameRow && neighbor.right <= seed.left) {
        constrained.left = Math.max(
          constrained.left,
          Math.floor((neighbor.right + seed.left) / 2),
        );
      }
      if (sameRow && neighbor.left >= seed.right) {
        constrained.right = Math.min(
          constrained.right,
          Math.ceil((seed.right + neighbor.left) / 2),
        );
      }

      // Vertical separation keeps stacked scoreboard rows apart.
      if (sameColumn && neighbor.bottom <= seed.top) {
        constrained.top = Math.max(
          constrained.top,
          Math.floor((neighbor.bottom + seed.top) / 2),
        );
      }
      if (sameColumn && neighbor.top >= seed.bottom) {
        constrained.bottom = Math.min(
          constrained.bottom,
          Math.ceil((seed.bottom + neighbor.top) / 2),
        );
      }
    }
    constrained.left = Math.min(constrained.left, seed.left);
    constrained.top = Math.min(constrained.top, seed.top);
    constrained.right = Math.max(constrained.right, seed.right);
    constrained.bottom = Math.max(constrained.bottom, seed.bottom);
    constrained.width = constrained.right - constrained.left;
    constrained.height = constrained.bottom - constrained.top;
    return constrained;
  }

  function projection(image, rect, axis, threshold, polarity) {
    const length = axis === 'x' ? rect.width : rect.height;
    const crossLength = axis === 'x' ? rect.height : rect.width;
    const minimum = Math.max(1, Math.ceil(crossLength * 0.055));
    const maximum = Math.max(minimum, Math.floor(crossLength * 0.88));
    const active = new Array(length).fill(false);
    const counts = new Array(length).fill(0);
    for (let index = 0; index < length; index += 1) {
      let count = 0;
      for (let cross = 0; cross < crossLength; cross += 1) {
        const x = axis === 'x' ? rect.left + index : rect.left + cross;
        const y = axis === 'x' ? rect.top + cross : rect.top + index;
        if (isForeground(image, x, y, threshold, polarity)) count += 1;
      }
      counts[index] = count;
      active[index] = count >= minimum && count <= maximum;
    }
    return { active, counts };
  }

  function connectedProjectionExtent(
    active,
    anchorStart,
    anchorEnd,
    maximumGap,
    minimumSpan = 1,
  ) {
    const segments = [];
    let start = -1;
    let lastActive = -1;
    for (let index = 0; index < active.length; index += 1) {
      if (active[index]) {
        if (start < 0) start = index;
        lastActive = index;
        continue;
      }
      if (start >= 0 && index - lastActive > maximumGap) {
        segments.push({ start, end: lastActive + 1 });
        start = -1;
        lastActive = -1;
      }
    }
    if (start >= 0) segments.push({ start, end: lastActive + 1 });
    if (!segments.length) return null;

    const scored = segments
      .map((segment) => ({
        ...segment,
        overlap: Math.max(
          0,
          Math.min(segment.end, anchorEnd) - Math.max(segment.start, anchorStart),
        ),
      }))
      .filter((segment) => segment.overlap > 0 && segment.end - segment.start >= minimumSpan)
      .sort((left, right) => (
        right.overlap - left.overlap
        || (right.end - right.start) - (left.end - left.start)
      ));
    return scored[0] || null;
  }

  function sameRegion(left, right, epsilon = 0.0000001) {
    return ['x', 'y', 'width', 'height']
      .every((key) => Math.abs(Number(left[key]) - Number(right[key])) <= epsilon);
  }

  function fitTextSeedRoi(image, seedRegion, options = {}) {
    const seedNormalized = normalizeRegion(seedRegion);
    if (!validImage(image) || !seedNormalized) {
      return { roi: seedNormalized || seedRegion, changed: false, reason: 'invalid-input' };
    }
    const seed = toPixelRect(seedNormalized, image.width, image.height);
    const horizontalFactor = Number.isFinite(Number(options.horizontalExpansion))
      ? Number(options.horizontalExpansion)
      : 1.5;
    const horizontalPadding = Math.max(4, Math.ceil(seed.width * horizontalFactor));
    // The new black/white scorebug moves the top text row materially higher
    // than the original profile. Search far enough to recover that row; the
    // vertical neighbor limits below still keep separate scoreboard rows out.
    const verticalPadding = Math.max(4, Math.ceil(seed.height * 1.25));
    const initialSearch = {
      left: Math.max(0, seed.left - horizontalPadding),
      top: Math.max(0, seed.top - verticalPadding),
      right: Math.min(image.width, seed.right + horizontalPadding),
      bottom: Math.min(image.height, seed.bottom + verticalPadding),
    };
    initialSearch.width = initialSearch.right - initialSearch.left;
    initialSearch.height = initialSearch.bottom - initialSearch.top;
    const search = constrainSearchByNeighbors(
      seed,
      initialSearch,
      options.neighboringRegions,
      image.width,
      image.height,
    );
    const range = luminanceRange(image, search);
    if (!range || range.contrast < 56) {
      return {
        roi: seedNormalized,
        changed: false,
        reason: 'low-contrast',
        contrast: range?.contrast || 0,
      };
    }
    const foreground = choosePolarity(image, seed, range.threshold, range);
    if (!foreground) {
      return {
        roi: seedNormalized,
        changed: false,
        reason: 'no-text-polarity',
        contrast: range.contrast,
      };
    }

    const xAnchorStart = seed.left - search.left;
    const xAnchorEnd = seed.right - search.left;
    const maximumGap = Math.max(
      2,
      Math.ceil(seed.height * (Number(options.maximumGapFactor) || 0.55)),
    );
    // Scan for horizontal extent across the text ROW, not the whole padded
    // search box. The vertical padding exists to recover a row that moved, but
    // including it here means any foreground pixel in those extra rows keeps a
    // column active. On the donor's info strip the rows above and below the
    // white band are dark, so a (correct) dark polarity marked every column as
    // text and the run spread the full width of the frame.
    const rowSlack = Math.ceil(seed.height * 0.25);
    const xScanBands = [
      {
        left: search.left,
        right: search.right,
        top: Math.max(search.top, seed.top - rowSlack),
        bottom: Math.min(search.bottom, seed.bottom + rowSlack),
      },
      // Fall back to the full search height so a materially displaced row is
      // still recoverable, exactly as before.
      search,
    ];
    let xExtent = null;
    for (const band of xScanBands) {
      band.width = band.right - band.left;
      band.height = band.bottom - band.top;
      if (band.height <= 0) continue;
      const candidate = connectedProjectionExtent(
        projection(image, band, 'x', range.threshold, foreground.polarity).active,
        xAnchorStart,
        xAnchorEnd,
        maximumGap,
      );
      if (candidate) { xExtent = candidate; break; }
    }
    if (!xExtent) {
      return {
        roi: seedNormalized,
        changed: false,
        reason: 'seed-has-no-text-run',
        contrast: range.contrast,
        polarity: foreground.polarity,
      };
    }

    // Auto-fit is meant to refine a calibrated box onto glyph edges, not to go
    // looking for the text somewhere else. The search window is 1.5x the seed
    // width on each side, which for a wide field reaches well outside the
    // scorebug and onto grass or crowd - and stadium pixels of the matching
    // polarity keep the run going. Measured on the corpus, game.downDistance
    // fitted from 360px to the full 1080px frame that way. Cap how far the
    // result may travel from the seed so a bad run degrades to the calibration
    // instead of to the whole screen.
    // Defaults to the caller's declared search allowance, so a caller that
    // deliberately asks for a wide expansion still gets one. The multi-field
    // production path overrides it with something tighter, because there the
    // window reaches outside the scorebug entirely.
    const maximumGrowth = Math.ceil(seed.width * (
      Number.isFinite(Number(options.maximumGrowth))
        ? Number(options.maximumGrowth)
        : horizontalFactor
    ));
    const horizontal = {
      left: Math.max(search.left, seed.left - maximumGrowth, search.left + xExtent.start - 2),
      right: Math.min(search.right, seed.right + maximumGrowth, search.left + xExtent.end + 2),
      top: search.top,
      bottom: search.bottom,
    };
    horizontal.width = horizontal.right - horizontal.left;
    horizontal.height = horizontal.bottom - horizontal.top;
    const yProjection = projection(
      image,
      horizontal,
      'y',
      range.threshold,
      foreground.polarity,
    );
    const yExtent = connectedProjectionExtent(
      yProjection.active,
      seed.top - horizontal.top,
      seed.bottom - horizontal.top,
      Math.max(1, Math.ceil(seed.height * 0.18)),
      Math.max(3, Math.ceil(seed.height * 0.3)),
    );

    const fittedPixels = {
      left: horizontal.left,
      top: seed.top,
      right: horizontal.right,
      bottom: seed.bottom,
    };
    if (yExtent) {
      fittedPixels.top = Math.max(search.top, horizontal.top + yExtent.start - 1);
      fittedPixels.bottom = Math.min(search.bottom, horizontal.top + yExtent.end + 1);
    }
    const fitted = fromPixelRect(fittedPixels, image.width, image.height);
    return {
      roi: fitted,
      changed: !sameRegion(seedNormalized, fitted),
      reason: 'high-contrast-text-run',
      contrast: range.contrast,
      polarity: foreground.polarity,
      seedDensity: Number(foreground.density.toFixed(4)),
      addedPixels: {
        left: seed.left - fittedPixels.left,
        top: seed.top - fittedPixels.top,
        right: fittedPixels.right - seed.right,
        bottom: fittedPixels.bottom - seed.bottom,
      },
    };
  }

  function fitTextSeedRois(image, regions = {}, options = {}) {
    const source = Object.fromEntries(
      Object.entries(regions)
        .map(([binding, region]) => [binding, normalizeRegion(region)])
        .filter(([, region]) => region),
    );
    const rois = { ...source };
    const diagnostics = {};
    for (const binding of TEXT_BINDINGS) {
      const seed = source[binding];
      if (!seed) continue;
      const neighboringRegions = Object.entries(source)
        .filter(([name]) => name !== binding)
        .map(([, region]) => region);
      const result = fitTextSeedRoi(image, seed, {
        neighboringRegions,
        horizontalExpansion: options.horizontalExpansion?.[binding]
          ?? HORIZONTAL_EXPANSION[binding]
          ?? 1.5,
        maximumGapFactor: options.maximumGapFactor?.[binding]
          ?? GAP_FACTOR[binding]
          ?? 0.55,
        // Measured on the frame corpus: without this, game.downDistance fits
        // from a 360px seed to the full 1080px frame, because its search
        // window runs off the scorebug onto grass that matches the polarity.
        // Refine the calibrated box; do not go hunting for the text elsewhere.
        maximumGrowth: options.maximumGrowth?.[binding] ?? 0.5,
      });
      rois[binding] = result.roi;
      diagnostics[binding] = {
        changed: result.changed,
        reason: result.reason,
        contrast: result.contrast || 0,
        polarity: result.polarity || null,
        addedPixels: result.addedPixels || { left: 0, top: 0, right: 0, bottom: 0 },
      };
    }
    return { rois, diagnostics };
  }

  function isTextBinding(binding) {
    return TEXT_BINDING_SET.has(binding);
  }

  return {
    HORIZONTAL_EXPANSION,
    GAP_FACTOR,
    TEXT_BINDINGS,
    fitTextSeedRoi,
    fitTextSeedRois,
    isTextBinding,
  };
}));
