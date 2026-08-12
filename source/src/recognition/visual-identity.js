'use strict';

const crypto = require('node:crypto');
const { PNG } = require('pngjs');

const REFERENCE_SIZE = Object.freeze({ width: 258, height: 292 });
const HORIZONTAL_REFERENCE_SIZE = Object.freeze({ width: 398, height: 108 });

// Fixed regions measured from the stock vertical CFB27 scorebug read area.
// They intentionally avoid the clock/down rows and the outer game background.
const TEAM_LAYOUT = Object.freeze({
  away: Object.freeze({
    panel: Object.freeze({ x: 8, y: 7, width: 242, height: 99 }),
    logoSearch: Object.freeze({ x: 174, y: 48, width: 70, height: 52 }),
  }),
  home: Object.freeze({
    panel: Object.freeze({ x: 8, y: 109, width: 242, height: 100 }),
    logoSearch: Object.freeze({ x: 174, y: 157, width: 70, height: 45 }),
  }),
});

// The current stock horizontal scorebug is read from a roughly 398x108 crop at
// 1080p. Team color panels live on either side of the clock/down area. The
// horizontal donor does not contain a dependable, isolated logo region; team
// logos therefore continue to come from the bundled high-resolution assets.
const HORIZONTAL_TEAM_LAYOUT = Object.freeze({
  away: Object.freeze({
    panel: Object.freeze({ x: 8, y: 32, width: 133, height: 56 }),
    logoSearch: null,
  }),
  home: Object.freeze({
    panel: Object.freeze({ x: 257, y: 32, width: 133, height: 56 }),
    logoSearch: null,
  }),
});

// A 1080p capture of the stock read region is approximately 185-193x219.
// Keep a conservative floor below that while still rejecting thumbnails and
// malformed capture results that do not contain enough scoreboard detail.
const MINIMUM_SIZE = Object.freeze({ width: 180, height: 210 });
const HORIZONTAL_MINIMUM_SIZE = Object.freeze({ width: 240, height: 64 });

const VISUAL_LAYOUTS = Object.freeze({
  vertical: Object.freeze({
    id: 'vertical',
    referenceSize: REFERENCE_SIZE,
    minimumSize: MINIMUM_SIZE,
    teams: TEAM_LAYOUT,
  }),
  horizontal: Object.freeze({
    id: 'horizontal',
    referenceSize: HORIZONTAL_REFERENCE_SIZE,
    minimumSize: HORIZONTAL_MINIMUM_SIZE,
    teams: HORIZONTAL_TEAM_LAYOUT,
  }),
});

// The supported native crops are deliberately far apart: the legacy scorebug
// is portrait-ish (~0.88:1), while the current one is wide (~3.69:1). Keeping
// the decision between those families explicit prevents a wide crop from
// being stretched into the legacy vertical geometry.
const HORIZONTAL_ASPECT_RATIO_FLOOR = 1.5;
const HORIZONTAL_REFERENCE_ASPECT_RATIO = HORIZONTAL_REFERENCE_SIZE.width
  / HORIZONTAL_REFERENCE_SIZE.height;
const HORIZONTAL_ASPECT_RATIO_TOLERANCE = 0.12;
const COLOR_BUCKET_SIZE = 8;
const LOGO_FOREGROUND_DISTANCE = 18;
const LOGO_ALPHA_START = 12;
const LOGO_ALPHA_END = 44;

function decode(input) {
  let image;
  if (Buffer.isBuffer(input)) {
    try {
      image = PNG.sync.read(input);
    } catch (error) {
      throw new Error(`Visual identity input must be a valid PNG: ${error.message}`);
    }
  } else if (input && Number.isInteger(input.width) && Number.isInteger(input.height) && input.data) {
    image = input;
  } else {
    throw new TypeError('Visual identity input must be a PNG buffer or decoded RGBA image');
  }

  const requiredBytes = image.width * image.height * 4;
  if (image.width <= 0
    || image.height <= 0
    || !Number.isInteger(image.data.length)
    || image.data.length < requiredBytes) {
    throw new Error('Visual identity input has malformed RGBA dimensions');
  }
  return image;
}

function resolveVisualLayout(image) {
  const aspectRatio = image.width / image.height;
  const layout = aspectRatio >= HORIZONTAL_ASPECT_RATIO_FLOOR
    ? VISUAL_LAYOUTS.horizontal
    : VISUAL_LAYOUTS.vertical;
  if (layout === VISUAL_LAYOUTS.horizontal) {
    const relativeDelta = Math.abs(aspectRatio - HORIZONTAL_REFERENCE_ASPECT_RATIO)
      / HORIZONTAL_REFERENCE_ASPECT_RATIO;
    if (relativeDelta > HORIZONTAL_ASPECT_RATIO_TOLERANCE) {
      throw new Error(
        'Visual identity input does not match the protected horizontal reader aspect ratio',
      );
    }
  }
  const { minimumSize } = layout;

  if (image.width < minimumSize.width || image.height < minimumSize.height) {
    throw new Error(
      `Visual identity input is too small for the ${layout.id} layout; expected at least ${minimumSize.width}x${minimumSize.height}`,
    );
  }
  return layout;
}

function resizeNearestNeighbor(image, width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const sourceOffset = pixelOffset(image, sourceX, sourceY);
      const targetOffset = ((y * width) + x) * 4;
      data[targetOffset] = image.data[sourceOffset];
      data[targetOffset + 1] = image.data[sourceOffset + 1];
      data[targetOffset + 2] = image.data[sourceOffset + 2];
      data[targetOffset + 3] = image.data[sourceOffset + 3];
    }
  }
  return { width, height, data };
}

function normalizeAnalysisImage(image, layout = VISUAL_LAYOUTS.vertical) {
  const { referenceSize } = layout;
  if (image.width >= referenceSize.width && image.height >= referenceSize.height) {
    return image;
  }

  // Upscale small captures uniformly. Regions remain resolution-independent,
  // and the source aspect ratio is never distorted to match another layout.
  const scale = Math.max(
    referenceSize.width / image.width,
    referenceSize.height / image.height,
  );
  return resizeNearestNeighbor(
    image,
    Math.max(referenceSize.width, Math.round(image.width * scale)),
    Math.max(referenceSize.height, Math.round(image.height * scale)),
  );
}

function scaleRegion(image, region, referenceSize = REFERENCE_SIZE) {
  const scaleX = image.width / referenceSize.width;
  const scaleY = image.height / referenceSize.height;
  const x = Math.max(0, Math.min(image.width - 1, Math.round(region.x * scaleX)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(region.y * scaleY)));
  const width = Math.max(
    1,
    Math.min(image.width - x, Math.round(region.width * scaleX)),
  );
  const height = Math.max(
    1,
    Math.min(image.height - y, Math.round(region.height * scaleY)),
  );
  return { x, y, width, height };
}

function pixelOffset(image, x, y) {
  return ((y * image.width) + x) * 4;
}

function dominantPanelColor(image, region) {
  const buckets = new Map();
  let sampledPixels = 0;

  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = pixelOffset(image, x, y);
      if (image.data[offset + 3] < 200) continue;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const key = `${Math.floor(red / COLOR_BUCKET_SIZE)},${Math.floor(green / COLOR_BUCKET_SIZE)},${Math.floor(blue / COLOR_BUCKET_SIZE)}`;
      const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
      bucket.count += 1;
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      buckets.set(key, bucket);
      sampledPixels += 1;
    }
  }

  const winner = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  if (!winner || !sampledPixels) throw new Error('Could not sample a native team panel color');

  const rgb = {
    r: Math.round(winner.red / winner.count),
    g: Math.round(winner.green / winner.count),
    b: Math.round(winner.blue / winner.count),
  };
  const hex = `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
  return {
    hex,
    rgb,
    confidence: winner.count / sampledPixels,
    sampledPixels,
  };
}

function colorDistance(red, green, blue, background) {
  return Math.hypot(
    red - background.r,
    green - background.g,
    blue - background.b,
  );
}

function findLogoContentBounds(image, search, background) {
  let left = search.x + search.width;
  let top = search.y + search.height;
  let right = search.x - 1;
  let bottom = search.y - 1;
  let foregroundPixels = 0;

  for (let y = search.y; y < search.y + search.height; y += 1) {
    for (let x = search.x; x < search.x + search.width; x += 1) {
      const offset = pixelOffset(image, x, y);
      if (image.data[offset + 3] < 128) continue;
      const distance = colorDistance(
        image.data[offset],
        image.data[offset + 1],
        image.data[offset + 2],
        background,
      );
      if (distance <= LOGO_FOREGROUND_DISTANCE) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      foregroundPixels += 1;
    }
  }

  if (foregroundPixels < 20 || right < left || bottom < top) {
    throw new Error('Could not isolate a native team logo in its fixed region');
  }
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
    foregroundPixels,
  };
}

function extractLogo(image, search, background, referenceSize = REFERENCE_SIZE) {
  const content = findLogoContentBounds(image, search, background);
  const padding = Math.max(
    1,
    Math.round(Math.min(
      image.width / referenceSize.width,
      image.height / referenceSize.height,
    )),
  );
  const bounds = {
    x: Math.max(search.x, content.x - padding),
    y: Math.max(search.y, content.y - padding),
    width: 0,
    height: 0,
  };
  const right = Math.min(search.x + search.width, content.x + content.width + padding);
  const bottom = Math.min(search.y + search.height, content.y + content.height + padding);
  bounds.width = right - bounds.x;
  bounds.height = bottom - bounds.y;

  const output = new PNG({ width: bounds.width, height: bounds.height, colorType: 6 });
  let visiblePixels = 0;
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceOffset = pixelOffset(image, bounds.x + x, bounds.y + y);
      const targetOffset = pixelOffset(output, x, y);
      const red = image.data[sourceOffset];
      const green = image.data[sourceOffset + 1];
      const blue = image.data[sourceOffset + 2];
      const sourceAlpha = image.data[sourceOffset + 3];
      const distance = colorDistance(red, green, blue, background);
      const keyedAlpha = Math.max(
        0,
        Math.min(1, (distance - LOGO_ALPHA_START) / (LOGO_ALPHA_END - LOGO_ALPHA_START)),
      );
      const alpha = Math.round(sourceAlpha * keyedAlpha);
      output.data[targetOffset] = red;
      output.data[targetOffset + 1] = green;
      output.data[targetOffset + 2] = blue;
      output.data[targetOffset + 3] = alpha;
      if (alpha > 0) visiblePixels += 1;
    }
  }

  const buffer = PNG.sync.write(output, { colorType: 6 });
  return {
    value: `data:image/png;base64,${buffer.toString('base64')}`,
    confidence: Math.min(1, content.foregroundPixels / (content.width * content.height)),
    width: output.width,
    height: output.height,
    hash: crypto.createHash('sha256').update(buffer).digest('hex'),
    bounds,
    contentBounds: {
      x: content.x,
      y: content.y,
      width: content.width,
      height: content.height,
    },
    foregroundPixels: content.foregroundPixels,
    visiblePixels,
  };
}

function analyzeVisualIdentity(input) {
  const sourceImage = decode(input);
  const layout = resolveVisualLayout(sourceImage);
  const image = normalizeAnalysisImage(sourceImage, layout);
  const result = {
    source: { width: sourceImage.width, height: sourceImage.height },
    layout: layout.id,
  };

  for (const team of ['away', 'home']) {
    const teamLayout = layout.teams[team];
    const panelRegion = scaleRegion(image, teamLayout.panel, layout.referenceSize);
    const panel = dominantPanelColor(image, panelRegion);
    result[team] = {
      color: {
        value: panel.hex,
        confidence: panel.confidence,
        rgb: panel.rgb,
      },
      logo: teamLayout.logoSearch
        ? extractLogo(
          image,
          scaleRegion(image, teamLayout.logoSearch, layout.referenceSize),
          panel.rgb,
          layout.referenceSize,
        )
        : null,
    };
  }
  return result;
}

module.exports = {
  REFERENCE_SIZE,
  HORIZONTAL_REFERENCE_SIZE,
  TEAM_LAYOUT,
  HORIZONTAL_TEAM_LAYOUT,
  VISUAL_LAYOUTS,
  analyzeVisualIdentity,
  dominantPanelColor,
  extractLogo,
  resolveVisualLayout,
  scaleRegion,
};
