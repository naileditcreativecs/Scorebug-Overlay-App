'use strict';

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function displayKey(display) {
  if (!display) return 'primary';
  return String(display.id ?? 'primary');
}

function sanitizeBounds(saved, display, fallback) {
  // The overlay targets borderless/full-screen gameplay, which uses the full
  // monitor even when the Windows taskbar reduces the desktop work area.
  const workArea = display?.bounds || display?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
  const source = saved || fallback || {};
  // Keep the aspect ratio when a saved size does not fit the display: the
  // overlay window's shape IS the bug's shape, so clamping width and height
  // independently squashed the window and the bug then overflowed and got
  // cropped on one axis (a 3840-wide placement on a 2560 display kept its
  // full height). Shrink both axes by the same factor instead.
  let requestedWidth = Math.max(1, finite(source.width, finite(fallback?.width, 371)));
  let requestedHeight = Math.max(1, finite(source.height, finite(fallback?.height, 433)));
  const maxWidth = Math.max(1, workArea.width);
  const maxHeight = Math.max(1, workArea.height);
  if (requestedWidth > maxWidth || requestedHeight > maxHeight) {
    const ratio = Math.min(maxWidth / requestedWidth, maxHeight / requestedHeight);
    requestedWidth *= ratio;
    requestedHeight *= ratio;
  }
  const width = Math.round(clamp(requestedWidth, Math.min(32, workArea.width), maxWidth));
  const height = Math.round(clamp(requestedHeight, Math.min(32, workArea.height), maxHeight));
  const minimumX = workArea.x;
  const maximumX = workArea.x + workArea.width - width;
  const minimumY = workArea.y;
  const maximumY = workArea.y + workArea.height - height;
  return {
    x: Math.round(clamp(finite(source.x, finite(fallback?.x, minimumX)), minimumX, maximumX)),
    y: Math.round(clamp(finite(source.y, finite(fallback?.y, minimumY)), minimumY, maximumY)),
    width,
    height,
  };
}

function serializePlacement(bounds, layout, display) {
  return {
    displayId: displayKey(display),
    displayBounds: display?.bounds ? { ...display.bounds } : null,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    scale: finite(layout?.scale, 1),
    scaleAt2160: finite(layout?.scaleAt2160, finite(layout?.scale, 1)),
    outputResolution: layout?.outputResolution || null,
    canvasWidth: Math.round(finite(layout?.canvasWidth, bounds.width)),
    canvasHeight: Math.round(finite(layout?.canvasHeight, bounds.height)),
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  displayKey,
  sanitizeBounds,
  serializePlacement,
};
