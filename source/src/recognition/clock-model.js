'use strict';

/**
 * Countdown-clock interpolation.
 *
 * OCR reads the donor a few times a second and every individual read can fail,
 * so a clock rendered straight from accepted reads stutters: it holds for a
 * beat, jumps two seconds, holds again. A football clock is not a random
 * variable though - between reads it decrements at exactly one second per
 * second - so the display can be reconstructed locally and resynchronized
 * whenever a read lands.
 *
 * This model is deliberately a PRESENTATION layer. It consumes values the
 * validator has already accepted and never decides what is true; it only fills
 * the gaps between accepted values. Plausibility, correction, and rejection all
 * stay in ScoreboardStateValidator.
 *
 * Two behaviors matter for correctness over prettiness:
 *  - The clock is only interpolated while it is believed to be RUNNING. A
 *    stopped clock (between plays, timeout, review) must not tick down, so the
 *    model requires evidence of movement before it starts extrapolating.
 *  - Interpolation is bounded. If reads stop arriving the model holds the last
 *    known value rather than counting a game clock down through a lost feed.
 */

const DEFAULT_OPTIONS = Object.freeze({
  // How long the model will keep extrapolating past its last accepted read.
  // Beyond this the feed is considered lost and the display holds.
  maxInterpolationMs: 10_000,
  // A repeated identical read this long after the anchor proves the clock is
  // stopped rather than merely a delayed duplicate from the OCR pipeline.
  // A full live read currently lands about every two seconds, so this must
  // span more than one read. Otherwise one duplicate freezes the local ticker
  // and the next lower read makes the display jump several seconds.
  stoppedAfterRepeatMs: 2_500,
  // Interpolated output may not run more than this far ahead of the last
  // accepted read, which keeps a slow capture from drifting the display.
  maxLeadSeconds: 10,
  // The local clock owns normal countdown motion. OCR only corrects it when
  // the two clocks differ by more than five seconds.
  correctionThresholdSeconds: 5,
  // The play clock legitimately jumps back to 25 or 40, but a single clipped
  // digit must not make the display bounce upward. When enabled, an upward
  // reset is accepted only after a second compatible read confirms it.
  confirmUpwardReset: false,
  upwardResetConfirmationMs: 3_000,
});

function parseClockSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? Math.floor(value) : null;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (match) return (Number(match[1]) * 60) + Number(match[2]);
  if (/^\d{1,2}$/.test(text)) return Number(text);
  return null;
}

function formatMinuteClock(totalSeconds) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSecondClock(totalSeconds) {
  return String(Math.max(0, Math.floor(totalSeconds)));
}

/**
 * Return clock fields that the presentation model may safely observe.
 *
 * Changed values appear in `result.accepted`. An unchanged-but-valid OCR read
 * does not, because the validator correctly has no state change to publish.
 * Those repeated reads still matter to a countdown model: they are the only
 * direct evidence that a previously running clock has stopped. Accept a
 * repeated read only when it exactly confirms the validator's retained state.
 */
function confirmedClockFields(result = {}) {
  const confirmed = new Set(
    (Array.isArray(result.accepted) ? result.accepted : [])
      .filter((field) => field === 'gameClock' || field === 'playClock'),
  );
  const diagnostics = result.diagnostics?.fields || {};
  const pairs = [
    ['gameClock', 'game.clock'],
    ['playClock', 'game.playClock'],
  ];
  for (const [stateField, binding] of pairs) {
    const read = diagnostics[binding];
    const retained = result.state?.[stateField];
    if (read?.valid !== true || retained === null || retained === undefined) continue;
    if (String(read.value) === String(retained)) confirmed.add(stateField);
  }
  return [...confirmed];
}

class CountdownClockModel {
  /**
   * @param {object} options
   * @param {'minutes'|'seconds'} [options.format] `minutes` renders M:SS (game
   *   clock), `seconds` renders a bare integer (play clock).
   */
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.format = options.format === 'seconds' ? 'seconds' : 'minutes';
    this.reset();
  }

  reset() {
    this.anchorSeconds = null;
    this.anchorAtMs = null;
    this.running = false;
    this.lastObservedSeconds = null;
    this.lastObservedAtMs = null;
    this.lastChangedObservedAtMs = null;
    this.pendingUpwardReset = null;
  }

  /**
   * Record a clock value the validator has accepted.
   * @returns {{anchored: boolean, running: boolean, seconds: number|null}}
   */
  observe(value, timestampMs) {
    const seconds = parseClockSeconds(value);
    const now = Number(timestampMs);
    if (seconds === null || !Number.isFinite(now)) {
      return { anchored: false, running: this.running, seconds: this.anchorSeconds };
    }

    const previousSeconds = this.anchorSeconds;
    const previousAtMs = this.anchorAtMs;
    const previousObservedSeconds = this.lastObservedSeconds;
    const projectedSeconds = this.secondsAt(now);
    const correctionThreshold = Math.max(
      0,
      Number(this.options.correctionThresholdSeconds) || 0,
    );

    if (previousSeconds === null || previousAtMs === null) {
      // First read: anchor, but do not assume motion. A clock discovered during
      // a stoppage would otherwise immediately start ticking down.
      this.anchorSeconds = seconds;
      this.anchorAtMs = now;
      this.running = false;
      this.lastChangedObservedAtMs = now;
    } else {
      const movedDown = previousObservedSeconds !== null
        && seconds < previousObservedSeconds;
      const movedUp = previousObservedSeconds !== null
        && seconds > previousObservedSeconds;
      const repeated = previousObservedSeconds !== null
        && seconds === previousObservedSeconds;
      const changed = movedDown || movedUp;
      const difference = projectedSeconds === null
        ? Infinity
        : Math.abs(seconds - projectedSeconds);
      const correctionRequired = difference > correctionThreshold;
      const repeatedSince = this.lastChangedObservedAtMs ?? previousAtMs;
      const stopConfirmed = repeated
        && now - repeatedSince >= this.options.stoppedAfterRepeatMs;

      if (this.options.confirmUpwardReset && movedUp && correctionRequired) {
        const pending = this.pendingUpwardReset;
        const pendingAgeMs = pending ? now - pending.atMs : Infinity;
        const allowedDrop = pending
          ? Math.max(2, Math.ceil(Math.max(0, pendingAgeMs) / 1000) + 2)
          : 0;
        const compatibleConfirmation = pending
          && pendingAgeMs >= 0
          && pendingAgeMs <= this.options.upwardResetConfirmationMs
          && seconds >= 20
          && seconds <= pending.seconds
          && pending.seconds - seconds <= allowedDrop;
        if (compatibleConfirmation) {
          this.anchorSeconds = seconds;
          this.anchorAtMs = now;
          this.running = seconds < pending.seconds;
          this.pendingUpwardReset = null;
          this.lastObservedSeconds = seconds;
          this.lastObservedAtMs = now;
          this.lastChangedObservedAtMs = now;
          return { anchored: true, running: this.running, seconds: this.anchorSeconds };
        }

        // Hold the existing local timeline for one more read. Do not replace
        // lastObservedSeconds with the unconfirmed candidate, otherwise the
        // following correct low read would itself look like a large drop.
        this.pendingUpwardReset = { seconds, atMs: now };
        this.lastObservedAtMs = now;
        return { anchored: true, running: this.running, seconds: projectedSeconds };
      }
      this.pendingUpwardReset = null;

      if (stopConfirmed) {
        // A repeated native value proves that the clock stopped. The stopped
        // value is authoritative, so do the user's requested final correction
        // even when it falls inside the normal five-second running deadband.
        this.anchorSeconds = seconds;
        this.anchorAtMs = now;
        this.running = false;
      } else if (changed && correctionRequired) {
        // Correct only a material miss. A large downward difference is normal
        // during accelerated runoff and remains running; an upward difference
        // is a reset/rebase and waits for new movement before counting again.
        this.anchorSeconds = seconds;
        this.anchorAtMs = now;
        this.running = movedDown;
      } else if (movedDown) {
        // The native clock moved, so local countdown is safe. Starting from a
        // held clock is ordinary clock motion rather than an auto-correction:
        // use the newly observed (already offset) second so the presentation
        // does not begin one or two seconds behind.
        //
        // While already running, stay on the current within-deadband timeline
        // but preserve its sub-second phase. Resetting anchorAtMs to `now` here
        // discarded that phase on every OCR read, making the local clock run
        // slow until a >2-second correction caused a visible jump.
        if (!this.running) {
          this.anchorSeconds = seconds;
          this.anchorAtMs = now;
        } else {
          const phaseMs = Math.max(0, now - previousAtMs) % 1000;
          this.anchorSeconds = projectedSeconds;
          this.anchorAtMs = now - phaseMs;
        }
        this.running = true;
      }
      if (changed) this.lastChangedObservedAtMs = now;
    }

    this.lastObservedSeconds = seconds;
    this.lastObservedAtMs = now;
    return { anchored: true, running: this.running, seconds: this.anchorSeconds };
  }

  /** Seconds remaining at `timestampMs`, or null when nothing is anchored. */
  secondsAt(timestampMs) {
    if (this.anchorSeconds === null || this.anchorAtMs === null) return null;
    const now = Number(timestampMs);
    if (!Number.isFinite(now)) return this.anchorSeconds;
    if (!this.running) return this.anchorSeconds;

    const elapsedMs = now - this.anchorAtMs;
    if (elapsedMs <= 0) return this.anchorSeconds;
    // Once the feed is old, hold the furthest value that was safely projected.
    // Returning the original anchor here made a running display jump backward
    // by several seconds at the exact moment OCR went stale.
    const boundedElapsedMs = Math.min(elapsedMs, this.options.maxInterpolationMs);
    const elapsedSeconds = Math.min(
      Math.floor(boundedElapsedMs / 1000),
      this.options.maxLeadSeconds,
    );
    return Math.max(0, this.anchorSeconds - elapsedSeconds);
  }

  /**
   * Rendered clock at `timestampMs`.
   * @returns {{value: string|null, seconds: number|null, interpolated: boolean, running: boolean}}
   */
  read(timestampMs) {
    const seconds = this.secondsAt(timestampMs);
    if (seconds === null) {
      return { value: null, seconds: null, interpolated: false, running: false };
    }
    return {
      value: this.format === 'seconds'
        ? formatSecondClock(seconds)
        : formatMinuteClock(seconds),
      seconds,
      interpolated: this.running && seconds !== this.anchorSeconds,
      running: this.running,
    };
  }
}

module.exports = {
  CountdownClockModel,
  DEFAULT_CLOCK_MODEL_OPTIONS: DEFAULT_OPTIONS,
  confirmedClockFields,
  formatMinuteClock,
  formatSecondClock,
  parseClockSeconds,
};
