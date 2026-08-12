'use strict';

const SIGNIFICANT_FIELDS = new Set([
  'awayName', 'awayRank', 'awayRecord', 'awayScore', 'awayTimeouts',
  'homeName', 'homeRank', 'homeRecord', 'homeScore', 'homeTimeouts',
  'possession', 'quarter', 'down', 'distance', 'downDistance', 'ballOn', 'status',
]);

let nextSessionNumber = 1;

function safeClone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function compactState(payload = {}) {
  return {
    away: {
      rank: payload.away?.rank ?? null,
      name: payload.away?.name ?? null,
      record: payload.away?.record ?? null,
      score: payload.away?.score ?? null,
      timeouts: payload.away?.timeouts ?? null,
      possession: Boolean(payload.away?.possession),
    },
    home: {
      rank: payload.home?.rank ?? null,
      name: payload.home?.name ?? null,
      record: payload.home?.record ?? null,
      score: payload.home?.score ?? null,
      timeouts: payload.home?.timeouts ?? null,
      possession: Boolean(payload.home?.possession),
    },
    game: {
      quarter: payload.game?.quarter ?? null,
      clock: payload.game?.clock ?? null,
      playClock: payload.game?.playClock ?? null,
      downDistance: payload.game?.downDistance ?? null,
      ballOn: payload.game?.ballOn ?? null,
      status: payload.game?.status ?? null,
    },
    visible: payload.meta?.visible !== false,
    confidence: Number(payload.meta?.confidence) || 0,
    source: payload.meta?.source || null,
  };
}

function compactBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const compact = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    const value = Number(bounds[key]);
    if (Number.isFinite(value)) compact[key] = value;
  }
  if (bounds.coordinateSpace) compact.coordinateSpace = String(bounds.coordinateSpace);
  if (bounds.visible !== undefined) compact.visible = Boolean(bounds.visible);
  if (bounds.foreground !== undefined) compact.foreground = Boolean(bounds.foreground);
  return Object.keys(compact).length ? compact : null;
}

class RuntimeValidationSession {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.writeEvent = options.writeEvent || (() => {});
    this.onWriteError = options.onWriteError || (() => {});
    this.clockSampleIntervalMs = Number(options.clockSampleIntervalMs) || 10000;
    this.recognitionSampleIntervalMs = Number(options.recognitionSampleIntervalMs) || 10000;
    this.checkpointIntervalMs = Number(options.checkpointIntervalMs) || 30000;
    this.session = null;
    this.lastClockSampleAt = 0;
    this.lastRecognitionSampleAt = 0;
    this.lastCheckpointAt = 0;
    this.lastVisibility = null;
    this.lastGameKey = null;
    this.lastCaptureKey = null;
    this.lastCaptureGapAt = 0;
    this.lastSignificantSignature = null;
  }

  begin(context = {}) {
    if (this.session?.active) this.end('restarted');
    const timestampMs = this.now();
    const iso = new Date(timestampMs).toISOString();
    this.session = {
      sessionId: `${iso.replace(/[^0-9]/g, '').slice(0, 17)}-${nextSessionNumber++}`,
      active: true,
      startedAt: timestampMs,
      endedAt: null,
      durationMs: 0,
      context: safeClone(context) || {},
      recognitionFrames: 0,
      anchorFrames: 0,
      visibleFrames: 0,
      visibilityTransitions: 0,
      semanticUpdates: 0,
      downTransitions: 0,
      clockSamples: 0,
      recognitionSamples: 0,
      gameWindowEvents: 0,
      gameDetections: 0,
      captureEvents: 0,
      captureConnections: 0,
      captureFailures: 0,
      captureGaps: 0,
      lastCaptureState: null,
      lastCaptureGap: null,
      errors: 0,
      acceptedByField: {},
      firstReadAt: null,
      lastReadAt: null,
      lastState: null,
    };
    this.lastClockSampleAt = 0;
    this.lastRecognitionSampleAt = 0;
    this.lastCheckpointAt = timestampMs;
    this.lastVisibility = null;
    this.lastGameKey = null;
    this.lastCaptureKey = null;
    this.lastCaptureGapAt = 0;
    this.lastSignificantSignature = null;
    this._emit('session-start', { context: this.session.context }, timestampMs);
    return this.snapshot();
  }

  observe(result = {}, payload = {}) {
    if (!this.session?.active) return null;
    const timestampMs = Number(result.timestampMs) || this.now();
    const state = compactState(payload);
    const accepted = [...new Set(Array.isArray(result.accepted) ? result.accepted : [])];
    this.session.recognitionFrames += 1;
    if (result.anchor?.present) this.session.anchorFrames += 1;
    if (result.visible) this.session.visibleFrames += 1;
    this.session.firstReadAt ??= timestampMs;
    this.session.lastReadAt = timestampMs;
    this.session.lastState = state;

    for (const field of accepted) {
      this.session.acceptedByField[field] = (this.session.acceptedByField[field] || 0) + 1;
    }

    const visible = Boolean(result.visible);
    if (this.lastVisibility === null || this.lastVisibility !== visible || result.visibilityChanged) {
      this.lastVisibility = visible;
      this.session.visibilityTransitions += 1;
      this._emit('scoreboard-visibility', {
        visible,
        confidence: Number(result.anchor?.confidence) || 0,
        state,
      }, timestampMs);
    }

    const significantAccepted = accepted.filter((field) => SIGNIFICANT_FIELDS.has(field));
    const significantSignature = JSON.stringify(state);
    if (significantAccepted.length && significantSignature !== this.lastSignificantSignature) {
      this.lastSignificantSignature = significantSignature;
      this.session.semanticUpdates += 1;
      if (significantAccepted.includes('downDistance')) this.session.downTransitions += 1;
      this._emit('scoreboard-change', { fields: significantAccepted, state }, timestampMs);
    }

    const hasClock = state.game.clock !== null || state.game.playClock !== null;
    if (hasClock && (!this.lastClockSampleAt
      || timestampMs - this.lastClockSampleAt >= this.clockSampleIntervalMs)) {
      this.lastClockSampleAt = timestampMs;
      this.session.clockSamples += 1;
      this._emit('clock-sample', { state }, timestampMs);
    }

    if (result.diagnostics && (!this.lastRecognitionSampleAt
      || timestampMs - this.lastRecognitionSampleAt >= this.recognitionSampleIntervalMs)) {
      this.lastRecognitionSampleAt = timestampMs;
      this.session.recognitionSamples += 1;
      this._emit('recognition-sample', {
        diagnostics: safeClone(result.diagnostics),
      }, timestampMs);
    }

    if (timestampMs - this.lastCheckpointAt >= this.checkpointIntervalMs) {
      this.lastCheckpointAt = timestampMs;
      this._emit('session-checkpoint', { summary: this.snapshot(timestampMs) }, timestampMs);
    }
    return this.snapshot(timestampMs);
  }

  recordGameWindow(game = {}) {
    if (!this.session?.active) return null;
    const event = {
      detected: Boolean(game.detected),
      title: game.title || '',
      processName: game.processName || '',
      pid: Number(game.pid) || null,
      sourceId: game.sourceId || '',
      // Exclude per-poll metadata such as updatedAt so an unchanged game
      // window does not create a new telemetry event every 500 ms.
      bounds: compactBounds(game.bounds),
    };
    const key = JSON.stringify(event);
    if (key === this.lastGameKey) return this.snapshot();
    this.lastGameKey = key;
    this.session.gameWindowEvents += 1;
    if (event.detected) this.session.gameDetections += 1;
    this._emit('game-window', event);
    return this.snapshot();
  }

  recordCaptureState(status = {}) {
    if (!this.session?.active) return null;
    const error = status.error ? {
      code: String(status.error.code || 'capture-failed').slice(0, 100),
      message: String(status.error.message || status.error.code || 'Capture failed').slice(0, 500),
    } : null;
    const event = {
      state: String(status.state || 'idle').slice(0, 80),
      health: status.health ? String(status.health).slice(0, 80) : null,
      attempt: Number(status.attempt) || 0,
      error,
      delayMs: Number.isFinite(Number(status.delayMs)) ? Number(status.delayMs) : null,
      retryAt: Number.isFinite(Number(status.retryAt)) ? Number(status.retryAt) : null,
      sourceWidth: Number(status.sourceWidth) || null,
      sourceHeight: Number(status.sourceHeight) || null,
    };
    const key = JSON.stringify(event);
    if (key === this.lastCaptureKey) return this.snapshot();
    this.lastCaptureKey = key;
    this.session.captureEvents += 1;
    if (event.state === 'running') this.session.captureConnections += 1;
    if (event.error || ['retry-wait', 'exhausted'].includes(event.state)) {
      this.session.captureFailures += 1;
    }
    this.session.lastCaptureState = safeClone(event);
    this._emit('capture-state', event);
    return this.snapshot();
  }

  recordCaptureGap(value = {}) {
    if (!this.session?.active) return null;
    const timestampMs = this.now();
    this.session.captureGaps += 1;
    this.session.lastCaptureGap = {
      timestampMs,
      reason: String(value.reason || 'no-frame').slice(0, 100),
      streamStatus: String(value.streamStatus || 'unknown').slice(0, 80),
      attempt: Number(value.attempt) || 0,
    };
    // Keep the JSONL useful without writing eight duplicate events per second.
    if (!this.lastCaptureGapAt || timestampMs - this.lastCaptureGapAt >= 5_000) {
      this.lastCaptureGapAt = timestampMs;
      this._emit('capture-gap', this.session.lastCaptureGap, timestampMs);
    }
    return this.snapshot(timestampMs);
  }

  recordError(stage, error) {
    if (!this.session?.active) return null;
    this.session.errors += 1;
    this._emit('reader-error', {
      stage: String(stage || 'unknown'),
      message: String(error?.message || error || 'Unknown error'),
    });
    return this.snapshot();
  }

  end(reason = 'stopped') {
    if (!this.session?.active) return null;
    const timestampMs = this.now();
    this.session.active = false;
    this.session.endedAt = timestampMs;
    this.session.durationMs = Math.max(0, timestampMs - this.session.startedAt);
    const summary = this.snapshot(timestampMs);
    this._emit('session-end', { reason: String(reason), summary }, timestampMs);
    return summary;
  }

  snapshot(at = this.now()) {
    if (!this.session) return null;
    return {
      ...safeClone(this.session),
      durationMs: this.session.endedAt
        ? this.session.durationMs
        : Math.max(0, Number(at) - this.session.startedAt),
    };
  }

  _emit(type, detail = {}, timestampMs = this.now()) {
    const event = {
      schemaVersion: 1,
      type,
      sessionId: this.session?.sessionId || null,
      timestampMs,
      timestamp: new Date(timestampMs).toISOString(),
      ...safeClone(detail),
    };
    try {
      this.writeEvent(event);
    } catch (error) {
      this.onWriteError(error);
    }
    return event;
  }
}

module.exports = {
  RuntimeValidationSession,
  SIGNIFICANT_FIELDS,
  compactBounds,
  compactState,
};
