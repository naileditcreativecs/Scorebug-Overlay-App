'use strict';

function boundedDelay(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return 0;
  return Math.max(0, Math.min(5_000, Math.round(delay)));
}

function resolveVisibilityMode({
  started = false,
  automaticEnabled = true,
  requestedVisible = false,
  autoVisible = false,
  actualVisible = false,
} = {}) {
  if (actualVisible) return automaticEnabled ? 'on-auto' : 'on-manual';
  if (started && automaticEnabled && requestedVisible && !autoVisible) return 'auto-waiting';
  return started ? 'off' : 'stopped';
}

function automaticVisibilityDelay({
  automaticEnabled = false,
  editMode = false,
  started = false,
  requestedVisible = false,
  shouldShow = false,
  showDelayMs = 0,
  hideDelayMs = 0,
} = {}) {
  if (!automaticEnabled || editMode || !started || !requestedVisible) return 0;
  return boundedDelay(shouldShow ? showDelayMs : hideDelayMs);
}

/**
 * Coalesce rapid automatic visibility reversals into one committed window
 * change. Manual actions pass a zero delay and remain immediate.
 */
class VisibilityTransitionGate {
  constructor(commit, timers = {}) {
    if (typeof commit !== 'function') throw new TypeError('commit must be a function');
    this.commit = commit;
    this.setTimer = timers.setTimer || setTimeout;
    this.clearTimer = timers.clearTimer || clearTimeout;
    this.pending = null;
  }

  request(visible, delayMs = 0, reason = 'state-change') {
    const desired = Boolean(visible);
    const delay = boundedDelay(delayMs);
    if (this.pending?.visible === desired) {
      this.pending.reason = reason;
      return false;
    }
    this.cancel();
    if (!delay) {
      this.commit(desired, reason);
      return true;
    }
    const pending = { visible: desired, reason, timer: null };
    this.pending = pending;
    pending.timer = this.setTimer(() => {
      if (this.pending !== pending) return;
      this.pending = null;
      this.commit(pending.visible, pending.reason);
    }, delay);
    pending.timer?.unref?.();
    return false;
  }

  cancel() {
    if (!this.pending) return false;
    this.clearTimer(this.pending.timer);
    this.pending = null;
    return true;
  }
}

module.exports = {
  automaticVisibilityDelay,
  resolveVisibilityMode,
  VisibilityTransitionGate,
};
