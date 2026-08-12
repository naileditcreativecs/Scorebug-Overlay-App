'use strict';

const MAXIMUM_CAPTURE_WIDTH = 3840;
const MAXIMUM_CAPTURE_HEIGHT = 2160;

function nativeDesktopConstraints(command = {}) {
  const fps = Math.max(1, Math.min(10, Math.round(Number(command.fps) || 4)));
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: command.sourceId,
        // These are safety ceilings, not requested output dimensions. Omitting
        // matching minimums lets Chromium retain a 16:9, ultrawide, or windowed
        // source's native geometry instead of resampling it to the profile size.
        maxWidth: MAXIMUM_CAPTURE_WIDTH,
        maxHeight: MAXIMUM_CAPTURE_HEIGHT,
        maxFrameRate: fps,
      },
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAXIMUM_CAPTURE_HEIGHT,
    MAXIMUM_CAPTURE_WIDTH,
    nativeDesktopConstraints,
  };
}

(function captureStreamRenderer() {
  // Allow focused Node tests to import the pure constraint builder without
  // constructing a browser capture worker.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const host = window.captureStreamHost;
  const geometry = window.Cfb27CaptureGeometry;
  const video = document.getElementById('capture-video');
  const canvas = document.getElementById('capture-canvas');
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
  // Windows Graphics Capture can take several seconds to deliver its first
  // decoded frame on a cold GPU/driver path.  A brief presentation gap is not
  // necessarily a dead stream either: Chromium may suppress duplicate frames
  // while the captured window is static.  Report those periods as health
  // changes first and reserve teardown for a genuinely unusable or long-stale
  // stream.
  const INITIAL_FRAME_TIMEOUT_MS = 10_000;
  const SLOW_FRAME_TIMEOUT_MS = 5_000;
  const STALLED_FRAME_TIMEOUT_MS = 30_000;
  const MAXIMUM_STALE_FRAME_TIMEOUT_MS = 90_000;
  const WATCHDOG_INTERVAL_MS = 500;
  const MINIMUM_READ_WIDTH = 96;
  const MINIMUM_READ_HEIGHT = 72;

  let active = null;
  let stream = null;
  let readRegion = geometry.FULL_FRAME;
  let lastPresentedAt = 0;
  let firstFrameSeen = false;
  let frameEncodingToken = null;
  let watchdogTimer = null;
  let videoFrameCallbackId = null;
  let observesPresentedFrames = false;
  let healthStatus = 'starting';
  let framesPresented = 0;
  let framePulls = 0;
  let slowPeriods = 0;
  let recoveries = 0;
  let mutedAt = 0;

  function currentTrack() {
    return stream?.getVideoTracks?.()[0] || null;
  }

  function telemetry(now = Date.now()) {
    const track = currentTrack();
    return {
      health: healthStatus,
      framesPresented,
      framePulls,
      slowPeriods,
      recoveries,
      firstFrameSeen,
      lastPresentedAt: lastPresentedAt || null,
      lastFrameAgeMs: lastPresentedAt ? Math.max(0, now - lastPresentedAt) : null,
      trackState: String(track?.readyState || 'missing'),
      trackMuted: Boolean(track?.muted),
      mutedForMs: mutedAt ? Math.max(0, now - mutedAt) : null,
      videoReadyState: Number(video.readyState) || 0,
      sourceWidth: Number(video.videoWidth) || null,
      sourceHeight: Number(video.videoHeight) || null,
    };
  }

  function emit(type, details = {}) {
    host.emit({ type, ...details });
  }

  function tokenMatches(candidate) {
    return Boolean(active
      && Number(candidate?.epoch) === active.epoch
      && Number(candidate?.attempt) === active.attempt);
  }

  function clearTimers() {
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
    if (videoFrameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(videoFrameCallbackId);
    }
    videoFrameCallbackId = null;
  }

  function stopTracks() {
    clearTimers();
    const previous = stream;
    stream = null;
    video.pause();
    video.srcObject = null;
    for (const track of previous?.getTracks?.() || []) {
      try { track.stop(); } catch { /* A stopped track is already safe. */ }
    }
    firstFrameSeen = false;
    lastPresentedAt = 0;
    frameEncodingToken = null;
    observesPresentedFrames = false;
    healthStatus = 'starting';
    framesPresented = 0;
    framePulls = 0;
    slowPeriods = 0;
    recoveries = 0;
    mutedAt = 0;
  }

  function stopCurrent({ clearActive = true } = {}) {
    stopTracks();
    if (clearActive) active = null;
  }

  function fail(code, error) {
    if (!active) return;
    const failed = { ...active };
    const message = String(error?.message || error || code || 'Capture stream failed').slice(0, 500);
    const captureTelemetry = telemetry();
    stopCurrent();
    emit('failure', {
      ...failed,
      code: String(code || 'capture-failure'),
      message,
      telemetry: captureTelemetry,
    });
  }

  function setHealth(nextStatus, reason, now = Date.now()) {
    if (!active || healthStatus === nextStatus) return;
    const previous = healthStatus;
    if (nextStatus === 'slow' && previous !== 'static') slowPeriods += 1;
    if (nextStatus === 'healthy' && (previous === 'slow' || previous === 'static')) recoveries += 1;
    healthStatus = nextStatus;
    emit('health', {
      ...active,
      status: nextStatus,
      reason: String(reason || '').slice(0, 200),
      telemetry: telemetry(now),
    });
  }

  function acceptPresentedFrame(now = Date.now()) {
    if (!active || !stream) return false;
    const wasFirst = !firstFrameSeen;
    firstFrameSeen = true;
    lastPresentedAt = now;
    framesPresented += 1;
    if (wasFirst) {
      const readPixels = geometry.readRegionToPixels(readRegion, video.videoWidth, video.videoHeight);
      if (readPixels.width < MINIMUM_READ_WIDTH || readPixels.height < MINIMUM_READ_HEIGHT) {
        fail(
          'capture-resolution-too-small',
          `Capture negotiated ${video.videoWidth}x${video.videoHeight}; read area is only ${readPixels.width}x${readPixels.height}.`,
        );
        return false;
      }
      healthStatus = 'healthy';
      emit('started', {
        ...active,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
        telemetry: telemetry(now),
      });
    } else {
      setHealth('healthy', 'Video frames resumed.', now);
    }
    return Boolean(active && stream);
  }

  function observeVideoFrames() {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      // Electron 37 supports requestVideoFrameCallback. This fallback still
      // verifies that decoded video data remains available without polling pixels.
      observesPresentedFrames = false;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) acceptPresentedFrame();
      return;
    }
    observesPresentedFrames = true;
    const callback = () => {
      if (!active || !stream) return;
      if (!acceptPresentedFrame()) return;
      videoFrameCallbackId = video.requestVideoFrameCallback(callback);
    };
    videoFrameCallbackId = video.requestVideoFrameCallback(callback);
  }

  function startWatchdog(startedAt) {
    watchdogTimer = setInterval(() => {
      if (!active || !stream) return;
      const now = Date.now();
      const track = currentTrack();
      if (!track || track.readyState === 'ended' || stream.active === false) {
        fail('track-ended', 'The selected window capture track is no longer active.');
        return;
      }
      // Some WGC/Chromium combinations have current decoded data before the
      // first requestVideoFrameCallback is dispatched.  That frame is safe to
      // use and should count as a successful start.
      if (!firstFrameSeen
          && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && video.videoWidth > 0
          && video.videoHeight > 0) {
        acceptPresentedFrame(now);
        return;
      }
      if (!firstFrameSeen && now - startedAt > INITIAL_FRAME_TIMEOUT_MS) {
        fail('initial-frame-timeout', 'The selected window supplied no capturable video frame.');
        return;
      }
      // Without requestVideoFrameCallback there is no trustworthy presentation
      // cadence to watch.  The frame-pull timeout in the controller remains the
      // terminal guard for that older Chromium fallback.
      if (!firstFrameSeen || !observesPresentedFrames) return;
      const ageMs = now - lastPresentedAt;
      if (ageMs > MAXIMUM_STALE_FRAME_TIMEOUT_MS) {
        fail('stream-stalled', 'The selected window capture stream remained stale for too long.');
        return;
      }
      if (ageMs > STALLED_FRAME_TIMEOUT_MS) {
        if (track.muted || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          fail('stream-stalled', 'The selected window capture stream stopped producing usable frames.');
          return;
        }
        // A live, unmuted track with current decoded data may simply represent
        // an unchanged window. Keep serving that frame while reporting it.
        setHealth('static', 'The capture is live but has not presented a changed frame.', now);
        return;
      }
      if (ageMs > SLOW_FRAME_TIMEOUT_MS) {
        setHealth('slow', 'The capture is waiting for a new video frame.', now);
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  async function start(command) {
    stopCurrent();
    const sourceId = geometry.normalizeCaptureSourceId(command?.sourceId);
    if (!sourceId) {
      emit('failure', {
        epoch: Number(command?.epoch) || 0,
        attempt: Number(command?.attempt) || 0,
        code: 'invalid-source',
        message: 'Capture source ID is not a trusted Electron window source.',
      });
      return;
    }
    active = {
      epoch: Number(command.epoch),
      attempt: Number(command.attempt),
      sourceId,
    };
    const starting = { ...active };
    readRegion = geometry.normalizeReadRegion(command.readRegion);
    const startedAt = Date.now();
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia(nativeDesktopConstraints(command));
      if (!tokenMatches(starting)) {
        for (const track of nextStream.getTracks()) track.stop();
        return;
      }
      stream = nextStream;
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error('Desktop capture returned no video track.');
      track.addEventListener('ended', () => fail('track-ended', 'The selected window capture track ended.'), { once: true });
      track.addEventListener('mute', () => {
        // The frame watchdog decides whether a short transition is recoverable.
        mutedAt = Date.now();
        lastPresentedAt ||= Date.now();
      });
      track.addEventListener('unmute', () => { mutedAt = 0; });
      video.srcObject = stream;
      await video.play();
      if (!tokenMatches(starting)) {
        stopTracks();
        return;
      }
      observeVideoFrames();
      startWatchdog(startedAt);
    } catch (error) {
      if (tokenMatches(starting)) fail(error?.name || 'get-user-media-failed', error);
    }
  }

  function canvasPngBytes() {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('The cropped capture canvas could not be encoded.'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    });
  }

  async function pullFrame(command) {
    if (!tokenMatches(command) || !stream || !firstFrameSeen || frameEncodingToken) return;
    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const encodingToken = `${active.epoch}:${active.attempt}:${Number(command.requestId)}`;
    frameEncodingToken = encodingToken;
    framePulls += 1;
    const token = { ...active };
    try {
      const requestedReadRegion = command.readRegion
        ? geometry.normalizeReadRegion(command.readRegion)
        : readRegion;
      const crop = geometry.readRegionToPixels(requestedReadRegion, video.videoWidth, video.videoHeight);
      if (canvas.width !== crop.width) canvas.width = crop.width;
      if (canvas.height !== crop.height) canvas.height = crop.height;
      context.drawImage(
        video,
        crop.x, crop.y, crop.width, crop.height,
        0, 0, crop.width, crop.height,
      );
      const bytes = await canvasPngBytes();
      if (!tokenMatches(token)) return;
      emit('frame', {
        ...token,
        requestId: Number(command.requestId),
        width: crop.width,
        height: crop.height,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
        bytes,
        telemetry: telemetry(),
      });
    } catch (error) {
      if (tokenMatches(token)) fail('frame-read-failed', error);
    } finally {
      if (frameEncodingToken === encodingToken) frameEncodingToken = null;
    }
  }

  host.onCommand((command) => {
    if (!command || typeof command !== 'object') return;
    if (command.type === 'start') {
      start(command);
    } else if (command.type === 'update-region' && tokenMatches(command)) {
      readRegion = geometry.normalizeReadRegion(command.readRegion);
    } else if (command.type === 'pull-frame') {
      pullFrame(command);
    } else if (command.type === 'stop') {
      stopCurrent();
      emit('stopped', { epoch: Number(command.epoch) || 0 });
    }
  });

  window.addEventListener('pagehide', () => stopCurrent(), { once: true });
  emit('ready');
}());
