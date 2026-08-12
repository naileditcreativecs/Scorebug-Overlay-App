(function exposePresetReadRegion(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Cfb27PresetReadRegion = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function presetReadRegionFactory() {
  'use strict';

  const FRAME_CENTER = Object.freeze({ x: 0.5, y: 0.5 });

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function assertFactoryReadRegion(value) {
    const region = {
      x: Number(value?.x),
      y: Number(value?.y),
      width: Number(value?.width),
      height: Number(value?.height),
    };
    const partsAreFinite = Object.values(region).every(Number.isFinite);
    const fitsFrame = region.x >= 0
      && region.y >= 0
      && region.width > 0
      && region.height > 0
      && region.x + region.width <= 1 + Number.EPSILON * 8
      && region.y + region.height <= 1 + Number.EPSILON * 8;
    if (!partsAreFinite || !fitsFrame) {
      throw new TypeError('Factory readRegion must be a finite rectangle contained by the normalized frame.');
    }
    return region;
  }

  /** Place the factory-sized box at a normalized top-left position. */
  function placeFactoryReadRegion(factoryValue, position = factoryValue) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    return {
      x: clamp(finite(position?.x, factoryRegion.x), 0, 1 - factoryRegion.width),
      y: clamp(finite(position?.y, factoryRegion.y), 0, 1 - factoryRegion.height),
      width: factoryRegion.width,
      height: factoryRegion.height,
    };
  }

  /** Move from the current position by a normalized delta without resizing. */
  function moveFactoryReadRegion(factoryValue, currentValue, delta = {}) {
    const current = placeFactoryReadRegion(factoryValue, currentValue);
    return placeFactoryReadRegion(factoryValue, {
      x: current.x + finite(delta?.x, 0),
      y: current.y + finite(delta?.y, 0),
    });
  }

  /** Center the factory-sized box on a normalized point (the frame center by default). */
  function centerFactoryReadRegion(factoryValue, center = FRAME_CENTER) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    return placeFactoryReadRegion(factoryRegion, {
      x: finite(center?.x, FRAME_CENTER.x) - (factoryRegion.width / 2),
      y: finite(center?.y, FRAME_CENTER.y) - (factoryRegion.height / 2),
    });
  }

  /**
   * Replace a freeform box's dimensions with the factory dimensions. The
   * top-left corner is retained by default; `anchor: 'center'` retains its
   * center instead. Either result is clamped into the captured frame.
   */
  function adoptFactoryReadRegionSize(factoryValue, currentValue, options = {}) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    const currentX = finite(currentValue?.x, factoryRegion.x);
    const currentY = finite(currentValue?.y, factoryRegion.y);
    if (options.anchor !== 'center') {
      return placeFactoryReadRegion(factoryRegion, { x: currentX, y: currentY });
    }
    const currentWidth = Math.max(0, finite(currentValue?.width, factoryRegion.width));
    const currentHeight = Math.max(0, finite(currentValue?.height, factoryRegion.height));
    return centerFactoryReadRegion(factoryRegion, {
      x: currentX + (currentWidth / 2),
      y: currentY + (currentHeight / 2),
    });
  }

  /** Restore the exact protected factory position and dimensions. */
  function resetFactoryReadRegion(factoryValue) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    return { ...factoryRegion };
  }

  function normalizedPoint(point, viewport) {
    const width = Math.max(1, finite(viewport?.width, 1));
    const height = Math.max(1, finite(viewport?.height, 1));
    return {
      x: clamp(finite(point?.x, 0) / width, 0, 1),
      y: clamp(finite(point?.y, 0) / height, 0, 1),
    };
  }

  const RESIZE_HANDLES = Object.freeze(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

  function normalizedMinimum(minimum = {}) {
    return {
      width: clamp(finite(minimum?.width, 0.01), 0.001, 1),
      height: clamp(finite(minimum?.height, 0.01), 0.001, 1),
    };
  }

  /**
   * Normalize a freeform outer scorebug rectangle without imposing the
   * factory aspect ratio. Width and height are retained while its position is
   * moved just far enough to keep the complete rectangle inside the frame.
   */
  function normalizeResizableReadRegion(value, fallbackValue, minimum = {}) {
    const fallback = assertFactoryReadRegion(fallbackValue);
    const floor = normalizedMinimum(minimum);
    const requestedWidth = finite(value?.width, fallback.width);
    const requestedHeight = finite(value?.height, fallback.height);
    const width = clamp(requestedWidth > 0 ? requestedWidth : fallback.width, floor.width, 1);
    const height = clamp(requestedHeight > 0 ? requestedHeight : fallback.height, floor.height, 1);
    return {
      x: clamp(finite(value?.x, fallback.x), 0, 1 - width),
      y: clamp(finite(value?.y, fallback.y), 0, 1 - height),
      width,
      height,
    };
  }

  function moveResizableReadRegion(currentValue, delta = {}, minimum = {}) {
    const current = assertFactoryReadRegion(currentValue);
    return normalizeResizableReadRegion({
      ...current,
      x: current.x + finite(delta?.x, 0),
      y: current.y + finite(delta?.y, 0),
    }, current, minimum);
  }

  function assertResizeHandle(handleValue) {
    const handle = String(handleValue || '').toLowerCase();
    if (!RESIZE_HANDLES.includes(handle)) {
      throw new TypeError(`Resize handle must be one of: ${RESIZE_HANDLES.join(', ')}.`);
    }
    return handle;
  }

  /** Resize one edge or corner while keeping the opposite edges stationary. */
  function resizeReadRegion(currentValue, handleValue, delta = {}, minimum = {}) {
    const current = assertFactoryReadRegion(currentValue);
    const handle = assertResizeHandle(handleValue);
    const floor = normalizedMinimum(minimum);
    const deltaX = finite(delta?.x, 0);
    const deltaY = finite(delta?.y, 0);
    let left = current.x;
    let top = current.y;
    let right = current.x + current.width;
    let bottom = current.y + current.height;

    if (handle.includes('w')) left = clamp(left + deltaX, 0, right - floor.width);
    if (handle.includes('e')) right = clamp(right + deltaX, left + floor.width, 1);
    if (handle.includes('n')) top = clamp(top + deltaY, 0, bottom - floor.height);
    if (handle.includes('s')) bottom = clamp(bottom + deltaY, top + floor.height, 1);

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  function viewportSize(viewport) {
    return {
      width: Math.max(1, finite(viewport?.width, 1)),
      height: Math.max(1, finite(viewport?.height, 1)),
    };
  }

  function regionPixelRect(region, viewport) {
    const frame = viewportSize(viewport);
    return {
      x: region.x * frame.width,
      y: region.y * frame.height,
      width: region.width * frame.width,
      height: region.height * frame.height,
    };
  }

  function handlePositions(region, viewport) {
    const rect = regionPixelRect(region, viewport);
    const left = rect.x;
    const centerX = rect.x + (rect.width / 2);
    const right = rect.x + rect.width;
    const top = rect.y;
    const centerY = rect.y + (rect.height / 2);
    const bottom = rect.y + rect.height;
    return {
      n: { x: centerX, y: top },
      ne: { x: right, y: top },
      e: { x: right, y: centerY },
      se: { x: right, y: bottom },
      s: { x: centerX, y: bottom },
      sw: { x: left, y: bottom },
      w: { x: left, y: centerY },
      nw: { x: left, y: top },
    };
  }

  function uniformScaleForRegion(factoryValue, value, fallback = 1) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    const widthScale = finite(value?.width, 0) / factoryRegion.width;
    const heightScale = finite(value?.height, 0) / factoryRegion.height;
    if (widthScale > 0 && heightScale > 0) return Math.min(widthScale, heightScale);
    if (widthScale > 0) return widthScale;
    if (heightScale > 0) return heightScale;
    return Math.max(0.001, finite(fallback, 1));
  }

  function uniformScaleLimits(factoryValue, minimum = {}, viewport = {}) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    const floor = normalizedMinimum(minimum);
    const frame = viewportSize(viewport);
    const hasViewport = Number.isFinite(Number(viewport?.width))
      && Number(viewport?.width) > 0
      && Number.isFinite(Number(viewport?.height))
      && Number(viewport?.height) > 0;
    const minimumWidthPixels = clamp(finite(minimum?.widthPixels, 1), 1, 4096);
    const minimumHeightPixels = clamp(finite(minimum?.heightPixels, 1), 1, 4096);
    return {
      minimum: Math.max(
        clamp(finite(minimum?.scale, 0.001), 0.001, limitsMaximum(factoryRegion)),
        floor.width / factoryRegion.width,
        floor.height / factoryRegion.height,
        hasViewport ? minimumWidthPixels / (factoryRegion.width * frame.width) : 0,
        hasViewport ? minimumHeightPixels / (factoryRegion.height * frame.height) : 0,
      ),
      maximum: Math.min(1 / factoryRegion.width, 1 / factoryRegion.height),
    };
  }

  function limitsMaximum(factoryRegion) {
    return Math.min(1 / factoryRegion.width, 1 / factoryRegion.height);
  }

  function uniformRegionFromCenter(factoryValue, centerValue, scaleValue, minimum = {}, viewport = {}) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    const limits = uniformScaleLimits(factoryRegion, minimum, viewport);
    const scale = clamp(finite(scaleValue, 1), limits.minimum, limits.maximum);
    const width = factoryRegion.width * scale;
    const height = factoryRegion.height * scale;
    const centerX = finite(centerValue?.x, factoryRegion.x + (factoryRegion.width / 2));
    const centerY = finite(centerValue?.y, factoryRegion.y + (factoryRegion.height / 2));
    return {
      x: clamp(centerX - (width / 2), 0, 1 - width),
      y: clamp(centerY - (height / 2), 0, 1 - height),
      width,
      height,
    };
  }

  /**
   * Project any historical freeform rectangle onto the protected factory
   * aspect ratio. The rectangle center is retained and the largest uniform
   * scale that fits inside both requested dimensions is used.
   */
  function normalizeUniformReadRegion(value, factoryValue, minimum = {}, viewport = {}) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    const source = value && typeof value === 'object' ? value : factoryRegion;
    const width = Math.max(0, finite(source.width, factoryRegion.width));
    const height = Math.max(0, finite(source.height, factoryRegion.height));
    const center = {
      x: finite(source.x, factoryRegion.x) + (width / 2),
      y: finite(source.y, factoryRegion.y) + (height / 2),
    };
    const scale = Object.prototype.hasOwnProperty.call(source, 'scale')
      ? finite(source.scale, 1)
      : uniformScaleForRegion(factoryRegion, source, 1);
    return uniformRegionFromCenter(factoryRegion, center, scale, minimum, viewport);
  }

  /**
   * Project a detected scorebug rectangle onto the protected factory aspect
   * while covering the complete detected rectangle. This differs from
   * normalizeUniformReadRegion(), which deliberately fits inside a historical
   * freeform rectangle. A live detector supplies the outside edge of the
   * artwork, so fitting inside would trim whichever dimension does not exactly
   * match the protected aspect.
   */
  function coverUniformReadRegion(value, factoryValue, minimum = {}, viewport = {}) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    const source = normalizeResizableReadRegion(value, factoryRegion);
    const center = {
      x: source.x + (source.width / 2),
      y: source.y + (source.height / 2),
    };
    const scale = Math.max(
      source.width / factoryRegion.width,
      source.height / factoryRegion.height,
    );
    return uniformRegionFromCenter(factoryRegion, center, scale, minimum, viewport);
  }

  function oppositeAnchor(handle, rect) {
    const centerX = rect.x + (rect.width / 2);
    const centerY = rect.y + (rect.height / 2);
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    return {
      n: { x: centerX, y: bottom },
      ne: { x: rect.x, y: bottom },
      e: { x: rect.x, y: centerY },
      se: { x: rect.x, y: rect.y },
      s: { x: centerX, y: rect.y },
      sw: { x: right, y: rect.y },
      w: { x: right, y: centerY },
      nw: { x: right, y: bottom },
    }[handle];
  }

  function anchoredUniformRegion(handle, anchor, width, height) {
    if (handle === 'e') return { x: anchor.x, y: anchor.y - (height / 2), width, height };
    if (handle === 'w') return { x: anchor.x - width, y: anchor.y - (height / 2), width, height };
    if (handle === 's') return { x: anchor.x - (width / 2), y: anchor.y, width, height };
    if (handle === 'n') return { x: anchor.x - (width / 2), y: anchor.y - height, width, height };
    if (handle === 'se') return { x: anchor.x, y: anchor.y, width, height };
    if (handle === 'sw') return { x: anchor.x - width, y: anchor.y, width, height };
    if (handle === 'ne') return { x: anchor.x, y: anchor.y - height, width, height };
    return { x: anchor.x - width, y: anchor.y - height, width, height };
  }

  /** Resize from any edge/corner while preserving the factory pixel aspect. */
  function resizeUniformReadRegion(factoryValue, currentValue, handleValue, delta = {}, minimum = {}, viewport = {}) {
    const factoryRegion = assertFactoryReadRegion(factoryValue);
    const handle = assertResizeHandle(handleValue);
    const frame = viewportSize(viewport);
    const current = normalizeUniformReadRegion(currentValue, factoryRegion, minimum, frame);
    const rect = regionPixelRect(current, frame);
    const handles = handlePositions(current, frame);
    const start = handles[handle];
    const anchor = oppositeAnchor(handle, rect);
    const desired = {
      x: start.x + (finite(delta?.x, 0) * frame.width),
      y: start.y + (finite(delta?.y, 0) * frame.height),
    };
    const vector = { x: start.x - anchor.x, y: start.y - anchor.y };
    const desiredVector = { x: desired.x - anchor.x, y: desired.y - anchor.y };
    const denominator = (vector.x * vector.x) + (vector.y * vector.y);
    const relativeScale = denominator > 0
      ? ((desiredVector.x * vector.x) + (desiredVector.y * vector.y)) / denominator
      : 1;
    const limits = uniformScaleLimits(factoryRegion, minimum, frame);
    const currentScale = uniformScaleForRegion(factoryRegion, current, 1);
    const scale = clamp(currentScale * relativeScale, limits.minimum, limits.maximum);
    const width = factoryRegion.width * scale;
    const height = factoryRegion.height * scale;
    const normalizedAnchor = { x: anchor.x / frame.width, y: anchor.y / frame.height };
    const resized = anchoredUniformRegion(handle, normalizedAnchor, width, height);
    return {
      x: clamp(resized.x, 0, 1 - width),
      y: clamp(resized.y, 0, 1 - height),
      width,
      height,
    };
  }

  function nearestEdge(value, first, second, firstName, secondName, tolerance) {
    const firstDistance = Math.abs(value - first);
    const secondDistance = Math.abs(value - second);
    const distance = Math.min(firstDistance, secondDistance);
    if (distance > tolerance) return '';
    return firstDistance <= secondDistance ? firstName : secondName;
  }

  /**
   * Freeform outer-box placer. Internal OCR ROIs remain relative to the outer
   * read region, so moving or resizing this rectangle never rewrites them.
   */
  class ResizableReadRegionPlacer {
    constructor(factoryReadRegion, currentReadRegion = factoryReadRegion, options = {}) {
      this.factoryReadRegion = assertFactoryReadRegion(factoryReadRegion);
      this.minimum = normalizedMinimum({
        width: options.minimumWidth,
        height: options.minimumHeight,
      });
      this.minimumPixels = {
        width: clamp(finite(options.minimumWidthPixels, 16), 1, 512),
        height: clamp(finite(options.minimumHeightPixels, 16), 1, 512),
      };
      this.handleTolerance = clamp(finite(options.handleTolerance, 10), 2, 64);
      this.region = normalizeResizableReadRegion(
        currentReadRegion,
        this.factoryReadRegion,
        this.minimum,
      );
      this.gesture = null;
    }

    getRegion() {
      return { ...this.region };
    }

    minimumForViewport(viewport) {
      const rawWidth = Number(viewport?.width);
      const rawHeight = Number(viewport?.height);
      if (!Number.isFinite(rawWidth) || rawWidth <= 0
        || !Number.isFinite(rawHeight) || rawHeight <= 0) {
        return { ...this.minimum };
      }
      const frame = { width: rawWidth, height: rawHeight };
      return {
        width: Math.min(1, Math.max(this.minimum.width, this.minimumPixels.width / frame.width)),
        height: Math.min(1, Math.max(this.minimum.height, this.minimumPixels.height / frame.height)),
      };
    }

    handles(viewport) {
      return handlePositions(this.region, viewport);
    }

    hitTest(point, viewport) {
      const rect = regionPixelRect(this.region, viewport);
      const x = finite(point?.x, Number.NEGATIVE_INFINITY);
      const y = finite(point?.y, Number.NEGATIVE_INFINITY);
      const left = rect.x;
      const right = rect.x + rect.width;
      const top = rect.y;
      const bottom = rect.y + rect.height;
      const tolerance = this.handleTolerance;
      const withinHorizontalBand = x >= left - tolerance && x <= right + tolerance;
      const withinVerticalBand = y >= top - tolerance && y <= bottom + tolerance;
      const horizontal = withinVerticalBand
        ? nearestEdge(x, left, right, 'w', 'e', tolerance)
        : '';
      const vertical = withinHorizontalBand
        ? nearestEdge(y, top, bottom, 'n', 's', tolerance)
        : '';

      if (horizontal && vertical) return { action: 'resize', handle: `${vertical}${horizontal}` };
      if (horizontal) return { action: 'resize', handle: horizontal };
      if (vertical) return { action: 'resize', handle: vertical };
      if (x >= left && x <= right && y >= top && y <= bottom) {
        return { action: 'move', handle: null };
      }
      return { action: 'none', handle: null };
    }

    adopt(currentReadRegion) {
      this.region = normalizeResizableReadRegion(
        currentReadRegion,
        this.factoryReadRegion,
        this.minimum,
      );
      this.gesture = null;
      return this.getRegion();
    }

    moveBy(delta) {
      this.region = moveResizableReadRegion(this.region, delta, this.minimum);
      return this.getRegion();
    }

    resizeBy(handle, delta, viewport) {
      this.region = resizeReadRegion(
        this.region,
        handle,
        delta,
        this.minimumForViewport(viewport),
      );
      return this.getRegion();
    }

    reset() {
      this.region = resetFactoryReadRegion(this.factoryReadRegion);
      this.gesture = null;
      return this.getRegion();
    }

    begin(point, viewport, forcedGesture) {
      let hit;
      if (typeof forcedGesture === 'string' && forcedGesture !== 'move') {
        hit = { action: 'resize', handle: assertResizeHandle(forcedGesture) };
      } else if (forcedGesture === 'move') {
        hit = { action: 'move', handle: null };
      } else if (forcedGesture && typeof forcedGesture === 'object') {
        hit = forcedGesture.action === 'move'
          ? { action: 'move', handle: null }
          : { action: 'resize', handle: assertResizeHandle(forcedGesture.handle) };
      } else {
        hit = this.hitTest(point, viewport);
      }
      if (hit.action === 'none') {
        this.gesture = null;
        return { ...hit, region: this.getRegion() };
      }
      this.gesture = {
        action: hit.action,
        handle: hit.handle,
        startPoint: normalizedPoint(point, viewport),
        startRegion: this.getRegion(),
        minimum: this.minimumForViewport(viewport),
      };
      return { ...hit, region: this.getRegion() };
    }

    update(point, viewport) {
      if (!this.gesture) return this.getRegion();
      const currentPoint = normalizedPoint(point, viewport);
      const delta = {
        x: currentPoint.x - this.gesture.startPoint.x,
        y: currentPoint.y - this.gesture.startPoint.y,
      };
      this.region = this.gesture.action === 'move'
        ? moveResizableReadRegion(this.gesture.startRegion, delta, this.gesture.minimum)
        : resizeReadRegion(
          this.gesture.startRegion,
          this.gesture.handle,
          delta,
          this.gesture.minimum,
        );
      return this.getRegion();
    }

    end(point, viewport) {
      if (point && viewport) this.update(point, viewport);
      this.gesture = null;
      return this.getRegion();
    }

    cancel() {
      if (this.gesture) this.region = this.gesture.startRegion;
      this.gesture = null;
      return this.getRegion();
    }
  }

  /**
   * Calibration placer for the protected reader layout. Translation is free,
   * but every resize is a uniform scale of the factory outer box. Because the
   * thirteen OCR regions remain relative to that box, their pixel aspect and
   * spacing cannot be stretched independently.
   */
  class UniformReadRegionPlacer {
    constructor(factoryReadRegion, currentReadRegion = factoryReadRegion, options = {}) {
      this.factoryReadRegion = assertFactoryReadRegion(factoryReadRegion);
      this.minimum = {
        ...normalizedMinimum({
          width: options.minimumWidth,
          height: options.minimumHeight,
        }),
        widthPixels: clamp(finite(options.minimumWidthPixels, 16), 1, 4096),
        heightPixels: clamp(finite(options.minimumHeightPixels, 16), 1, 4096),
        scale: clamp(finite(options.minimumScale, 0.001), 0.001, limitsMaximum(this.factoryReadRegion)),
      };
      this.handleTolerance = clamp(finite(options.handleTolerance, 10), 2, 64);
      this.region = normalizeUniformReadRegion(
        currentReadRegion,
        this.factoryReadRegion,
        this.minimum,
      );
      this.gesture = null;
    }

    getRegion() {
      return { ...this.region };
    }

    getScale() {
      return uniformScaleForRegion(this.factoryReadRegion, this.region, 1);
    }

    handles(viewport) {
      return handlePositions(this.region, viewport);
    }

    hitTest(point, viewport) {
      const rect = regionPixelRect(this.region, viewport);
      const x = finite(point?.x, Number.NEGATIVE_INFINITY);
      const y = finite(point?.y, Number.NEGATIVE_INFINITY);
      const tolerance = this.handleTolerance;
      for (const [handle, position] of Object.entries(this.handles(viewport))) {
        if (Math.abs(x - position.x) <= tolerance && Math.abs(y - position.y) <= tolerance) {
          return { action: 'resize', handle };
        }
      }
      if (x >= rect.x && x <= rect.x + rect.width
        && y >= rect.y && y <= rect.y + rect.height) {
        return { action: 'move', handle: null };
      }
      return { action: 'none', handle: null };
    }

    adopt(currentReadRegion, options = {}) {
      const current = currentReadRegion && typeof currentReadRegion === 'object'
        ? currentReadRegion
        : this.factoryReadRegion;
      const source = options.anchor === 'top-left'
        ? {
          ...current,
          x: finite(current.x, this.factoryReadRegion.x)
            - ((this.factoryReadRegion.width * uniformScaleForRegion(this.factoryReadRegion, current, 1)
              - finite(current.width, this.factoryReadRegion.width)) / 2),
          y: finite(current.y, this.factoryReadRegion.y)
            - ((this.factoryReadRegion.height * uniformScaleForRegion(this.factoryReadRegion, current, 1)
              - finite(current.height, this.factoryReadRegion.height)) / 2),
        }
        : current;
      this.region = normalizeUniformReadRegion(source, this.factoryReadRegion, this.minimum, options.viewport);
      this.gesture = null;
      return this.getRegion();
    }

    setPlacement(placement = {}, viewport = {}) {
      const current = this.getRegion();
      const scale = finite(placement.scale, this.getScale());
      const width = this.factoryReadRegion.width * scale;
      const height = this.factoryReadRegion.height * scale;
      this.region = uniformRegionFromCenter(
        this.factoryReadRegion,
        {
          x: finite(placement.x, current.x) + (width / 2),
          y: finite(placement.y, current.y) + (height / 2),
        },
        scale,
        this.minimum,
        viewport,
      );
      this.gesture = null;
      return this.getRegion();
    }

    moveBy(delta) {
      this.region = moveResizableReadRegion(this.region, delta, this.minimum);
      return this.getRegion();
    }

    resizeBy(handle, delta, viewport) {
      this.region = resizeUniformReadRegion(
        this.factoryReadRegion,
        this.region,
        handle,
        delta,
        this.minimum,
        viewport,
      );
      return this.getRegion();
    }

    reset() {
      this.region = resetFactoryReadRegion(this.factoryReadRegion);
      this.gesture = null;
      return this.getRegion();
    }

    begin(point, viewport, forcedGesture) {
      let hit;
      if (typeof forcedGesture === 'string' && forcedGesture !== 'move') {
        hit = { action: 'resize', handle: assertResizeHandle(forcedGesture) };
      } else if (forcedGesture === 'move') {
        hit = { action: 'move', handle: null };
      } else if (forcedGesture && typeof forcedGesture === 'object') {
        hit = forcedGesture.action === 'move'
          ? { action: 'move', handle: null }
          : { action: 'resize', handle: assertResizeHandle(forcedGesture.handle) };
      } else {
        hit = this.hitTest(point, viewport);
      }
      if (hit.action === 'none') {
        this.gesture = null;
        return { ...hit, region: this.getRegion() };
      }
      this.gesture = {
        action: hit.action,
        handle: hit.handle,
        startPoint: normalizedPoint(point, viewport),
        startRegion: this.getRegion(),
        viewport: viewportSize(viewport),
      };
      return { ...hit, region: this.getRegion() };
    }

    update(point, viewport) {
      if (!this.gesture) return this.getRegion();
      const currentPoint = normalizedPoint(point, viewport);
      const delta = {
        x: currentPoint.x - this.gesture.startPoint.x,
        y: currentPoint.y - this.gesture.startPoint.y,
      };
      this.region = this.gesture.action === 'move'
        ? moveResizableReadRegion(this.gesture.startRegion, delta, this.minimum)
        : resizeUniformReadRegion(
          this.factoryReadRegion,
          this.gesture.startRegion,
          this.gesture.handle,
          delta,
          this.minimum,
          this.gesture.viewport,
        );
      return this.getRegion();
    }

    end(point, viewport) {
      if (point && viewport) this.update(point, viewport);
      this.gesture = null;
      return this.getRegion();
    }

    cancel() {
      if (this.gesture) this.region = this.gesture.startRegion;
      this.gesture = null;
      return this.getRegion();
    }
  }

  /** Small drag-state wrapper for a fixed-size box on the calibration canvas. */
  class FixedReadRegionPlacer {
    constructor(factoryReadRegion, currentReadRegion = factoryReadRegion) {
      this.factoryReadRegion = assertFactoryReadRegion(factoryReadRegion);
      this.region = adoptFactoryReadRegionSize(this.factoryReadRegion, currentReadRegion);
      this.gesture = null;
    }

    getRegion() {
      return { ...this.region };
    }

    place(position) {
      this.region = placeFactoryReadRegion(this.factoryReadRegion, position);
      return this.getRegion();
    }

    moveBy(delta) {
      this.region = moveFactoryReadRegion(this.factoryReadRegion, this.region, delta);
      return this.getRegion();
    }

    adopt(currentReadRegion, options) {
      this.region = adoptFactoryReadRegionSize(this.factoryReadRegion, currentReadRegion, options);
      return this.getRegion();
    }

    center(center) {
      this.region = centerFactoryReadRegion(this.factoryReadRegion, center);
      return this.getRegion();
    }

    reset() {
      this.region = resetFactoryReadRegion(this.factoryReadRegion);
      return this.getRegion();
    }

    begin(point, viewport) {
      this.gesture = {
        startPoint: normalizedPoint(point, viewport),
        startRegion: this.getRegion(),
      };
      return this.getRegion();
    }

    update(point, viewport) {
      if (!this.gesture) return this.getRegion();
      const currentPoint = normalizedPoint(point, viewport);
      this.region = moveFactoryReadRegion(
        this.factoryReadRegion,
        this.gesture.startRegion,
        {
          x: currentPoint.x - this.gesture.startPoint.x,
          y: currentPoint.y - this.gesture.startPoint.y,
        },
      );
      return this.getRegion();
    }

    end(point, viewport) {
      if (point && viewport) this.update(point, viewport);
      this.gesture = null;
      return this.getRegion();
    }

    cancel() {
      if (this.gesture) this.region = this.gesture.startRegion;
      this.gesture = null;
      return this.getRegion();
    }
  }

  return Object.freeze({
    FixedReadRegionPlacer,
    RESIZE_HANDLES,
    ResizableReadRegionPlacer,
    UniformReadRegionPlacer,
    adoptFactoryReadRegionSize,
    assertFactoryReadRegion,
    centerFactoryReadRegion,
    coverUniformReadRegion,
    handlePositions,
    moveFactoryReadRegion,
    moveResizableReadRegion,
    normalizeResizableReadRegion,
    normalizeUniformReadRegion,
    placeFactoryReadRegion,
    resizeReadRegion,
    resizeUniformReadRegion,
    resetFactoryReadRegion,
    uniformScaleForRegion,
  });
}));
