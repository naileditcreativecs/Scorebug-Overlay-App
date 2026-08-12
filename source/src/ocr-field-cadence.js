'use strict';

const DEFAULT_STATIC_INTERVAL_MS = 900;

const DYNAMIC_OCR_BINDINGS = Object.freeze([
  'away.score',
  'home.score',
  'game.quarter',
  'game.clock',
  'game.playClock',
  'game.downDistance',
]);

const STATIC_OCR_BINDINGS = Object.freeze([
  'away.name',
  'away.record',
  'home.name',
  'home.record',
]);

const STATIC_BINDING_SET = new Set(STATIC_OCR_BINDINGS);

function finiteTimestamp(value, label = 'nowMs') {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be a finite number`);
  return timestamp;
}

function staticInterval(value) {
  const interval = Number(value ?? DEFAULT_STATIC_INTERVAL_MS);
  if (!Number.isFinite(interval) || interval < 0) {
    throw new TypeError('staticIntervalMs must be a non-negative finite number');
  }
  return interval;
}

function normalizedBindings(bindings) {
  if (!Array.isArray(bindings)) throw new TypeError('bindings must be an array');
  const unique = [];
  const seen = new Set();
  for (const binding of bindings) {
    if (typeof binding !== 'string' || !binding) {
      throw new TypeError('every binding must be a non-empty string');
    }
    if (seen.has(binding)) continue;
    seen.add(binding);
    unique.push(binding);
  }
  return unique;
}

/**
 * Select fields for one OCR frame without mutating cadence state.
 *
 * Only team identity and record fields are throttled. Scores, quarter, clocks,
 * and down/distance are gameplay fields and remain due on every captured
 * frame. Unknown future bindings remain due on every frame so adding a
 * dynamic field cannot make it stale accidentally.
 */
function selectDueOcrBindings(bindings, nowMs, lastReadAt = new Map(), options = {}) {
  const now = finiteTimestamp(nowMs);
  const interval = staticInterval(options.staticIntervalMs);
  if (!lastReadAt || typeof lastReadAt.get !== 'function') {
    throw new TypeError('lastReadAt must provide Map-compatible get()');
  }

  return normalizedBindings(bindings).filter((binding) => {
    if (!STATIC_BINDING_SET.has(binding)) return true;
    const last = Number(lastReadAt.get(binding));
    return !Number.isFinite(last) || now < last || now - last >= interval;
  });
}

class OcrFieldCadence {
  constructor(options = {}) {
    this.staticIntervalMs = staticInterval(options.staticIntervalMs);
    this.lastReadAt = new Map();
  }

  due(bindings, nowMs = Date.now()) {
    return selectDueOcrBindings(bindings, nowMs, this.lastReadAt, {
      staticIntervalMs: this.staticIntervalMs,
    });
  }

  /** Mark fields only after the caller has actually attempted their reads. */
  mark(bindings, nowMs = Date.now()) {
    const now = finiteTimestamp(nowMs);
    for (const binding of normalizedBindings(bindings)) {
      if (STATIC_BINDING_SET.has(binding)) this.lastReadAt.set(binding, now);
    }
    return this;
  }

  /** Force all configured static fields to be due on the next frame. */
  reset() {
    this.lastReadAt.clear();
    return this;
  }
}

module.exports = {
  DEFAULT_STATIC_INTERVAL_MS,
  DYNAMIC_OCR_BINDINGS,
  OcrFieldCadence,
  STATIC_OCR_BINDINGS,
  selectDueOcrBindings,
};
