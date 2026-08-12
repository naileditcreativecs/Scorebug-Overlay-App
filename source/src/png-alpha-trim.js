'use strict';

const { PNG } = require('pngjs');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isPng(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= PNG_SIGNATURE.length
    && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function alphaBounds(image, alphaThreshold) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[((y * image.width + x) * 4) + 3] <= alphaThreshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

function trimTransparentPng(buffer, options = {}) {
  if (!isPng(buffer)) throw new Error('Logo is not a PNG image.');
  const image = PNG.sync.read(buffer, { skipRescale: true });
  const originalWidth = image.width;
  const originalHeight = image.height;
  const thresholdValue = Number.isFinite(Number(options.alphaThreshold)) ? Number(options.alphaThreshold) : 8;
  const paddingValue = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 0;
  const threshold = Math.max(0, Math.min(254, Math.round(thresholdValue)));
  const requestedPadding = Math.max(0, Math.min(32, Math.round(paddingValue)));
  // Ignore nearly invisible garbage pixels first. If the entire logo is very
  // faint, fall back to every nontransparent pixel rather than rejecting it.
  const visible = alphaBounds(image, threshold) || alphaBounds(image, 0);
  if (!visible) throw new Error('The selected PNG is fully transparent.');
  const bounds = {
    left: Math.max(0, visible.left - requestedPadding),
    top: Math.max(0, visible.top - requestedPadding),
    right: Math.min(originalWidth - 1, visible.right + requestedPadding),
    bottom: Math.min(originalHeight - 1, visible.bottom + requestedPadding),
  };
  const width = bounds.right - bounds.left + 1;
  const height = bounds.bottom - bounds.top + 1;
  const trimmed = width !== originalWidth || height !== originalHeight;
  if (!trimmed) {
    return {
      buffer,
      width,
      height,
      originalWidth,
      originalHeight,
      bounds,
      trimmed: false,
    };
  }
  const output = new PNG({ width, height, colorType: 6 });
  PNG.bitblt(image, output, bounds.left, bounds.top, width, height, 0, 0);
  return {
    buffer: PNG.sync.write(output, { colorType: 6 }),
    width,
    height,
    originalWidth,
    originalHeight,
    bounds,
    trimmed: true,
  };
}

function trimPngDataUrl(value, options = {}) {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const result = trimTransparentPng(Buffer.from(match[1], 'base64'), options);
  return {
    ...result,
    dataUrl: `data:image/png;base64,${result.buffer.toString('base64')}`,
  };
}

module.exports = {
  PNG_SIGNATURE,
  isPng,
  trimPngDataUrl,
  trimTransparentPng,
};
