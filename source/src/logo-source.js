'use strict';

/**
 * Update an HTML or SVG image only when its source actually changes.
 * Reassigning an identical data URL can restart decoding/painting in Chromium,
 * which makes frequently published scoreboard state look like a logo refresh.
 */
function setLogoSourceIfChanged(image, source) {
  if (!image || typeof image.getAttribute !== 'function') return false;
  const attribute = String(image.tagName || '').toUpperCase() === 'IMG' ? 'src' : 'href';
  const nextSource = typeof source === 'string' ? source.trim() : '';
  const currentSource = image.getAttribute(attribute);

  if (!nextSource) {
    if (currentSource === null) return false;
    image.removeAttribute(attribute);
    return true;
  }
  if (currentSource === nextSource) return false;
  image.setAttribute(attribute, nextSource);
  return true;
}

const api = Object.freeze({ setLogoSourceIfChanged });

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.CFB27LogoSource = api;
