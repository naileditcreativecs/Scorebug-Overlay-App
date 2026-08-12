'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const {
  normalizeCaptureSourceId,
  normalizeReadRegion,
  sameReadRegion,
} = require('./capture-stream-geometry');

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([250, 1_000, 3_000]);
const DEFAULT_START_TIMEOUT_MS = 15_000;
const DEFAULT_FRAME_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONSECUTIVE_FRAME_TIMEOUTS = 3;
const HEALTH_HISTORY_LIMIT = 20;
const TELEMETRY_EMIT_INTERVAL_MS = 5_000;

function clampInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function normalizeCaptureConfig(value = {}) {
  const sourceId = normalizeCaptureSourceId(value.sourceId);
  if (!sourceId) throw new TypeError('A trusted Electron window capture source ID is required.');
  return {
    sourceId,
    sourceName: String(value.sourceName || '').slice(0, 300),
    readRegion: normalizeReadRegion(value.readRegion),
    width: clampInteger(value.width, 1920, 640, 3840),
    height: clampInteger(value.height, 1080, 360, 2160),
    fps: clampInteger(value.fps, 4, 1, 10),
  };
}

function sameStreamConfig(left, right) {
  return Boolean(left && right
    && left.sourceId === right.sourceId
    && left.width === right.width
    && left.height === right.height
    && left.fps === right.fps);
}

function frameBytes(value, maximumBytes) {
  let bytes = null;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!bytes || bytes.length < 8 || bytes.length > maximumBytes) return null;
  return Buffer.from(bytes);
}

function normalizeRendererTelemetry(value) {
  if (!value || typeof value !== 'object') return null;
  const optionalInteger = (candidate, maximum = Number.MAX_SAFE_INTEGER) => {
    if (candidate === null || candidate === undefined || candidate === '') return null;
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(maximum, Math.round(numeric));
  };
  return {
    health: String(value.health || '').slice(0, 30),
    framesPresented: optionalInteger(value.framesPresented),
    framePulls: optionalInteger(value.framePulls),
    slowPeriods: optionalInteger(value.slowPeriods),
    recoveries: optionalInteger(value.recoveries),
    firstFrameSeen: Boolean(value.firstFrameSeen),
    lastPresentedAt: optionalInteger(value.lastPresentedAt),
    lastFrameAgeMs: optionalInteger(value.lastFrameAgeMs, 24 * 60 * 60 * 1_000),
    trackState: String(value.trackState || '').slice(0, 30),
    trackMuted: Boolean(value.trackMuted),
    mutedForMs: optionalInteger(value.mutedForMs, 24 * 60 * 60 * 1_000),
    videoReadyState: optionalInteger(value.videoReadyState, 10),
    sourceWidth: optionalInteger(value.sourceWidth, 8192),
    sourceHeight: optionalInteger(value.sourceHeight, 8192),
  };
}

/**
 * Own the hidden renderer and its narrow IPC channel. Pixel capture remains in
 * the sandboxed renderer; this transport only forwards commands and cropped PNGs.
 */
class ElectronCaptureStreamTransport extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.BrowserWindow || !options.ipcMain) {
      throw new TypeError('BrowserWindow and ipcMain are required.');
    }
    this.BrowserWindow = options.BrowserWindow;
    this.ipcMain = options.ipcMain;
    this.htmlPath = options.htmlPath || path.join(__dirname, 'capture-stream.html');
    this.preloadPath = options.preloadPath || path.join(__dirname, 'capture-stream-preload.js');
    this.readyTimeoutMs = clampInteger(options.readyTimeoutMs, 2_500, 250, 15_000);
    this.window = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.readyTimer = null;
    this.rendererReady = false;
    this.destroying = false;
    this.lastToken = null;
    this.onIpcEvent = this.onIpcEvent.bind(this);
    this.ipcMain.on('capture-stream:event', this.onIpcEvent);
  }

  ownsEvent(event) {
    return Boolean(this.window
      && !this.window.isDestroyed()
      && event?.sender === this.window.webContents);
  }

  onIpcEvent(event, payload) {
    if (!this.ownsEvent(event) || !payload || typeof payload !== 'object') return;
    if (payload.type === 'ready') {
      this.rendererReady = true;
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.readyTimer = null;
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
    }
    this.emit('message', payload);
  }

  clearReady(error = null) {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    if (error) this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
    this.readyPromise = null;
    this.rendererReady = false;
  }

  handleWindowGone(reason) {
    const token = this.lastToken ? { ...this.lastToken } : {};
    this.window = null;
    this.clearReady(new Error(`Capture worker ${reason}.`));
    if (!this.destroying) {
      this.emit('message', {
        type: 'failure',
        ...token,
        code: 'capture-worker-gone',
        message: `The hidden capture worker ${reason}.`,
      });
    }
  }

  async ready() {
    if (this.window && !this.window.isDestroyed() && this.rendererReady) return;
    if (this.readyPromise) return this.readyPromise;

    this.destroying = false;
    const worker = new this.BrowserWindow({
      width: 16,
      height: 16,
      show: false,
      frame: false,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.window = worker;
    worker.setMenu?.(null);
    worker.webContents.setAudioMuted?.(true);
    worker.on('closed', () => {
      if (this.window === worker) this.handleWindowGone('closed');
    });
    worker.webContents.on('render-process-gone', () => {
      if (this.window === worker && !worker.isDestroyed()) worker.destroy();
    });

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => {
        const error = new Error('Capture worker did not become ready in time.');
        this.clearReady(error);
        if (!worker.isDestroyed()) worker.destroy();
      }, this.readyTimeoutMs);
    });
    worker.loadFile(this.htmlPath).catch((error) => {
      this.clearReady(error);
      if (!worker.isDestroyed()) worker.destroy();
    });
    return this.readyPromise;
  }

  send(command) {
    if (!this.window || this.window.isDestroyed() || !this.rendererReady) return false;
    if (command?.type === 'start') {
      this.lastToken = { epoch: command.epoch, attempt: command.attempt };
    }
    this.window.webContents.send('capture-stream:command', command);
    return true;
  }

  destroy() {
    this.destroying = true;
    this.clearReady();
    this.ipcMain.removeListener('capture-stream:event', this.onIpcEvent);
    const worker = this.window;
    this.window = null;
    if (worker && !worker.isDestroyed()) worker.destroy();
    this.removeAllListeners();
  }
}

/**
 * Generation-safe persistent stream with pull backpressure and bounded retries.
 * The renderer never pushes pixels until captureFrame() asks for the newest one.
 */
class PersistentCaptureStream {
  constructor(options = {}) {
    if (typeof options.transportFactory !== 'function') {
      throw new TypeError('transportFactory is required.');
    }
    this.transportFactory = options.transportFactory;
    this.retryDelaysMs = [...(options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS)]
      .map((value) => clampInteger(value, 0, 0, 60_000));
    this.retryCooldownMs = clampInteger(options.retryCooldownMs, 15_000, 1_000, 300_000);
    this.startTimeoutMs = clampInteger(options.startTimeoutMs, DEFAULT_START_TIMEOUT_MS, 250, 30_000);
    this.frameTimeoutMs = clampInteger(options.frameTimeoutMs, DEFAULT_FRAME_TIMEOUT_MS, 100, 30_000);
    this.maxConsecutiveFrameTimeouts = clampInteger(
      options.maxConsecutiveFrameTimeouts,
      DEFAULT_MAX_CONSECUTIVE_FRAME_TIMEOUTS,
      1,
      10,
    );
    this.telemetryEmitIntervalMs = clampInteger(
      options.telemetryEmitIntervalMs,
      TELEMETRY_EMIT_INTERVAL_MS,
      250,
      60_000,
    );
    this.maximumFrameBytes = clampInteger(options.maximumFrameBytes, 8 * 1024 * 1024, 1024, 64 * 1024 * 1024);
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.onState = typeof options.onState === 'function' ? options.onState : () => {};
    this.transport = null;
    this.desired = null;
    this.state = 'idle';
    this.epoch = 0;
    this.attempt = 0;
    this.retryIndex = 0;
    this.retryUnlockAt = 0;
    this.startTimer = null;
    this.retryTimer = null;
    this.frameTimer = null;
    this.pendingFrame = null;
    this.nextRequestId = 1;
    this.disposed = false;
    this.lastError = null;
    this.health = 'idle';
    this.metrics = null;
    this.healthHistory = [];
    this.rendererTelemetry = null;
    this.lastTelemetryEmitAt = 0;
    this.resetTelemetry();
    this.handleMessage = this.handleMessage.bind(this);
  }

  ensureTransport() {
    if (!this.transport) {
      this.transport = this.transportFactory();
      this.transport.on('message', this.handleMessage);
    }
    return this.transport;
  }

  tokenMatches(value) {
    return Number(value?.epoch) === this.epoch && Number(value?.attempt) === this.attempt;
  }

  clearTimer(name) {
    if (this[name]) clearTimeout(this[name]);
    this[name] = null;
  }

  resetTelemetry() {
    this.metrics = {
      attempts: 0,
      starts: 0,
      frames: 0,
      frameTimeouts: 0,
      consecutiveFrameTimeouts: 0,
      failures: 0,
      recoveries: 0,
      lastStartedAt: null,
      lastFrameAt: null,
    };
    this.healthHistory = [];
    this.rendererTelemetry = null;
    this.lastTelemetryEmitAt = 0;
  }

  recordHealth(event, details = {}) {
    const item = {
      at: this.now(),
      event: String(event || 'capture-event').slice(0, 50),
      attempt: this.attempt,
    };
    if (details.code) item.code = String(details.code).slice(0, 100);
    if (details.reason) item.reason = String(details.reason).slice(0, 200);
    if (Number.isFinite(Number(details.requestId))) item.requestId = Number(details.requestId);
    if (Number.isFinite(Number(details.count))) item.count = Number(details.count);
    this.healthHistory.push(item);
    if (this.healthHistory.length > HEALTH_HISTORY_LIMIT) {
      this.healthHistory.splice(0, this.healthHistory.length - HEALTH_HISTORY_LIMIT);
    }
  }

  telemetrySnapshot() {
    return {
      ...this.metrics,
      renderer: this.rendererTelemetry ? { ...this.rendererTelemetry } : null,
      history: this.healthHistory.map((item) => ({ ...item })),
    };
  }

  setState(state, extra = {}) {
    if (this.state === state && !extra.force) return;
    this.state = state;
    const details = { ...extra };
    delete details.force;
    this.onState({
      state,
      sourceId: this.desired?.sourceId || '',
      epoch: this.epoch,
      attempt: this.attempt,
      error: this.lastError,
      health: this.health,
      telemetry: this.telemetrySnapshot(),
      ...details,
    });
  }

  resolvePendingFrame(value = null) {
    if (!this.pendingFrame) return;
    this.clearTimer('frameTimer');
    const pending = this.pendingFrame;
    this.pendingFrame = null;
    pending.resolve(value);
  }

  retireCurrent() {
    this.clearTimer('startTimer');
    this.clearTimer('retryTimer');
    this.resolvePendingFrame(null);
    this.transport?.send({ type: 'stop', epoch: this.epoch, attempt: this.attempt });
  }

  async start(value) {
    if (this.disposed) return false;
    const config = normalizeCaptureConfig(value);
    if (sameStreamConfig(this.desired, config)) {
      if (!sameReadRegion(this.desired.readRegion, config.readRegion)) {
        this.desired = config;
        if (this.state === 'running') {
          this.transport?.send({
            type: 'update-region',
            epoch: this.epoch,
            attempt: this.attempt,
            readRegion: config.readRegion,
          });
        }
      } else {
        this.desired = config;
      }
      if (this.state === 'exhausted' && this.now() >= this.retryUnlockAt) {
        this.retryIndex = 0;
        this.beginAttempt();
      }
      return this.state === 'running';
    }

    this.retireCurrent();
    this.epoch += 1;
    this.attempt = 0;
    this.retryIndex = 0;
    this.retryUnlockAt = 0;
    this.lastError = null;
    this.desired = config;
    this.health = 'starting';
    this.resetTelemetry();
    await this.beginAttempt();
    return this.state === 'running';
  }

  async beginAttempt() {
    if (!this.desired || this.disposed) return;
    const epoch = this.epoch;
    const attempt = this.attempt + 1;
    this.attempt = attempt;
    this.metrics.attempts += 1;
    this.health = 'starting';
    this.recordHealth('attempt-started');
    this.setState('starting');
    const transport = this.ensureTransport();
    try {
      await transport.ready();
      if (!this.desired || this.disposed || epoch !== this.epoch || attempt !== this.attempt) return;
      const sent = transport.send({
        type: 'start',
        epoch,
        attempt,
        ...this.desired,
      });
      if (!sent) throw new Error('Capture worker is unavailable.');
      this.startTimer = setTimeout(() => {
        this.failAttempt({ epoch, attempt }, 'stream-start-timeout', 'Capture stream did not start in time.');
      }, this.startTimeoutMs);
    } catch (error) {
      this.failAttempt({ epoch, attempt }, 'capture-worker-start-failed', error.message);
    }
  }

  failAttempt(token, code, message) {
    if (!this.tokenMatches(token) || !this.desired || this.disposed) return;
    if (this.state === 'retry-wait' || this.state === 'exhausted') return;
    this.clearTimer('startTimer');
    this.resolvePendingFrame(null);
    this.lastError = { code: String(code || 'capture-failed'), message: String(message || code || 'Capture failed').slice(0, 500) };
    this.health = 'failed';
    this.metrics.failures += 1;
    this.recordHealth('attempt-failed', { code: this.lastError.code, reason: this.lastError.message });
    this.transport?.send({ type: 'stop', epoch: this.epoch, attempt: this.attempt });

    if (this.retryIndex < this.retryDelaysMs.length) {
      const delayMs = this.retryDelaysMs[this.retryIndex];
      this.retryIndex += 1;
      this.setState('retry-wait', { delayMs, force: true });
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.beginAttempt();
      }, delayMs);
      return;
    }

    this.retryUnlockAt = this.now() + this.retryCooldownMs;
    this.setState('exhausted', { retryAt: this.retryUnlockAt, force: true });
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'started') {
      if (!this.tokenMatches(message) || !this.desired) return;
      this.clearTimer('startTimer');
      this.retryIndex = 0;
      this.retryUnlockAt = 0;
      this.lastError = null;
      this.rendererTelemetry = normalizeRendererTelemetry(message.telemetry);
      this.health = 'healthy';
      this.metrics.starts += 1;
      this.metrics.consecutiveFrameTimeouts = 0;
      this.metrics.lastStartedAt = this.now();
      this.recordHealth('stream-started');
      this.setState('running', {
        sourceWidth: Number(message.sourceWidth) || null,
        sourceHeight: Number(message.sourceHeight) || null,
        force: true,
      });
      return;
    }
    if (message.type === 'failure') {
      if (this.tokenMatches(message)) this.rendererTelemetry = normalizeRendererTelemetry(message.telemetry);
      this.failAttempt(message, message.code, message.message);
      return;
    }
    if (message.type === 'health') {
      if (!this.tokenMatches(message) || !this.desired || this.state !== 'running') return;
      const nextHealth = ['healthy', 'slow', 'static'].includes(message.status)
        ? message.status
        : 'unknown';
      const previousHealth = this.health;
      this.rendererTelemetry = normalizeRendererTelemetry(message.telemetry);
      this.health = nextHealth;
      if (nextHealth === 'healthy' && (previousHealth === 'slow' || previousHealth === 'static')) {
        this.metrics.recoveries += 1;
      }
      this.recordHealth(`renderer-${nextHealth}`, { reason: message.reason });
      this.setState('running', {
        healthReason: String(message.reason || '').slice(0, 200),
        force: true,
      });
      return;
    }
    if (message.type !== 'frame' || !this.tokenMatches(message) || !this.pendingFrame) return;
    if (Number(message.requestId) !== this.pendingFrame.requestId) return;
    const width = clampInteger(message.width, 0, 1, 8192);
    const height = clampInteger(message.height, 0, 1, 8192);
    const bytes = frameBytes(message.bytes, this.maximumFrameBytes);
    if (!bytes || !width || !height) {
      this.failAttempt(message, 'invalid-frame', 'Capture worker returned an invalid cropped frame.');
      return;
    }
    this.rendererTelemetry = normalizeRendererTelemetry(message.telemetry);
    const now = this.now();
    const rendererHealth = ['slow', 'static'].includes(this.rendererTelemetry?.health)
      ? this.rendererTelemetry.health
      : 'healthy';
    const recovered = this.health === 'slow' && rendererHealth === 'healthy';
    // A successful canvas/PNG response proves that the worker is responsive;
    // it does not prove that Chromium presented a new video frame. Preserve a
    // renderer-reported slow/static condition until presentation resumes.
    this.health = rendererHealth;
    this.metrics.frames += 1;
    this.metrics.consecutiveFrameTimeouts = 0;
    this.metrics.lastFrameAt = now;
    if (recovered) {
      this.metrics.recoveries += 1;
      this.recordHealth('frame-response-recovered');
    }
    this.resolvePendingFrame({
      bytes,
      width,
      height,
      sourceWidth: Number(message.sourceWidth) || null,
      sourceHeight: Number(message.sourceHeight) || null,
      sourceId: this.desired.sourceId,
      epoch: this.epoch,
      attempt: this.attempt,
      capturedAt: now,
    });
    if (recovered || now - this.lastTelemetryEmitAt >= this.telemetryEmitIntervalMs) {
      this.lastTelemetryEmitAt = now;
      this.setState('running', { force: true });
    }
  }

  captureFrame(options = {}) {
    if (this.state !== 'running' || !this.desired || this.disposed) return Promise.resolve(null);
    if (this.pendingFrame) return this.pendingFrame.promise;
    const requestedReadRegion = options.readRegion
      ? normalizeReadRegion(options.readRegion)
      : null;
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    let resolveFrame;
    const promise = new Promise((resolve) => { resolveFrame = resolve; });
    this.pendingFrame = { requestId, promise, resolve: resolveFrame };
    const token = { epoch: this.epoch, attempt: this.attempt };
    const sent = this.transport?.send({
      type: 'pull-frame',
      ...token,
      requestId,
      ...(requestedReadRegion ? { readRegion: requestedReadRegion } : {}),
    });
    if (!sent) {
      this.resolvePendingFrame(null);
      this.failAttempt(token, 'capture-worker-unavailable', 'Capture worker is unavailable.');
      return promise;
    }
    this.frameTimer = setTimeout(() => {
      this.resolvePendingFrame(null);
      if (!this.tokenMatches(token) || !this.desired || this.disposed) return;
      this.metrics.frameTimeouts += 1;
      this.metrics.consecutiveFrameTimeouts += 1;
      const count = this.metrics.consecutiveFrameTimeouts;
      this.recordHealth('frame-response-timeout', { requestId, count });
      if (count >= this.maxConsecutiveFrameTimeouts) {
        this.failAttempt(token, 'frame-timeout', `Capture stream missed ${count} consecutive cropped-frame responses.`);
        return;
      }
      // A busy GPU or a single slow PNG encode should not tear down an otherwise
      // healthy WGC session. Keep it running and let the next reader tick retry.
      this.health = 'slow';
      this.setState('running', {
        warning: {
          code: 'frame-response-delayed',
          message: `Capture frame response was delayed (${count}/${this.maxConsecutiveFrameTimeouts}).`,
        },
        force: true,
      });
    }, this.frameTimeoutMs);
    return promise;
  }

  async stop() {
    if (!this.desired && this.state === 'idle') return;
    this.retireCurrent();
    this.epoch += 1;
    this.desired = null;
    this.attempt = 0;
    this.retryIndex = 0;
    this.retryUnlockAt = 0;
    this.lastError = null;
    this.health = 'idle';
    this.setState('idle', { force: true });
  }

  async dispose() {
    if (this.disposed) return;
    await this.stop();
    this.disposed = true;
    this.transport?.removeListener('message', this.handleMessage);
    this.transport?.destroy?.();
    this.transport = null;
  }
}

module.exports = {
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_START_TIMEOUT_MS,
  DEFAULT_FRAME_TIMEOUT_MS,
  DEFAULT_MAX_CONSECUTIVE_FRAME_TIMEOUTS,
  ElectronCaptureStreamTransport,
  PersistentCaptureStream,
  normalizeCaptureConfig,
  sameStreamConfig,
};
