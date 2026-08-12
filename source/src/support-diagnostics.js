'use strict';

const path = require('node:path');

const DEFAULT_CAPTURE_HISTORY_LIMIT = 24;
const REDACTED_ID = '[redacted id]';
const REDACTED_NAME = '[redacted window/source]';
const REDACTED_PATH = '[local path]';

const SENSITIVE_ID_KEYS = new Set([
  'accountid',
  'calibrationsourceid',
  'capturesourceid',
  'computerid',
  'desktopid',
  'desktopsourceid',
  'deviceid',
  'displayid',
  'handle',
  'hwnd',
  'installationid',
  'installid',
  'ipaddress',
  'machineid',
  'macaddress',
  'monitorid',
  'nativehandle',
  'pid',
  'processid',
  'screenid',
  'sessionid',
  'sourceid',
  'streamid',
  'streamsourceid',
  'userid',
  'windowid',
  'windowsourceid',
]);

const SENSITIVE_NAME_KEYS = new Set([
  'computername',
  'desktopname',
  'devicename',
  'displayname',
  'hostname',
  'monitorname',
  'sourcename',
  'username',
  'windowname',
  'windowtitle',
]);

const MACHINE_CONTEXT_KEYS = new Set([
  'capture',
  'captures',
  'desktop',
  'desktops',
  'display',
  'displays',
  'game',
  'monitor',
  'monitors',
  'screen',
  'screens',
  'source',
  'sources',
  'stream',
  'streams',
  'window',
  'windows',
]);

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function boundedText(value, maximum = 500) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, maximum);
}

function compactError(value) {
  if (!value) return null;
  return {
    code: boundedText(value.code || 'capture-failed', 100),
    message: boundedText(value.message || value.code || 'Capture failed', 500),
  };
}

function compactCaptureTelemetry(value) {
  if (!value || typeof value !== 'object') return null;
  const compact = {};
  for (const key of [
    'starts', 'connections', 'failures', 'frameRequests', 'frames',
    'frameTimeouts', 'softStalls', 'hardStalls', 'consecutiveFrameTimeouts',
    'lastFrameAt', 'lastConnectedAt', 'lastFailureAt',
  ]) {
    const numeric = finiteOrNull(value[key]);
    if (numeric !== null) compact[key] = numeric;
  }
  return Object.keys(compact).length ? compact : null;
}

function compactCaptureEvent(status = {}, timestampMs = Date.now()) {
  return {
    timestampMs: finiteOrNull(timestampMs) ?? Date.now(),
    state: boundedText(status.state || 'idle', 80),
    health: boundedText(status.health, 80),
    attempt: finiteOrNull(status.attempt) ?? 0,
    error: compactError(status.error),
    delayMs: finiteOrNull(status.delayMs),
    retryAt: finiteOrNull(status.retryAt),
    sourceWidth: finiteOrNull(status.sourceWidth),
    sourceHeight: finiteOrNull(status.sourceHeight),
    telemetry: compactCaptureTelemetry(status.telemetry),
  };
}

function appendCaptureHistory(history, status, options = {}) {
  const limit = Math.max(1, Math.min(100, Math.round(Number(options.limit) || DEFAULT_CAPTURE_HISTORY_LIMIT)));
  const current = Array.isArray(history) ? history : [];
  const next = [...current, compactCaptureEvent(status, options.timestampMs)];
  return next.slice(-limit);
}

function compactFieldRead(value = {}) {
  const compact = {
    rawText: boundedText(value.rawText, 160),
    value: value.value === undefined ? null : value.value,
    valid: Boolean(value.valid),
    confidence: finiteOrNull(value.confidence),
    engineConfidence: finiteOrNull(value.engineConfidence),
    elapsedMs: finiteOrNull(value.elapsedMs),
    strategy: boundedText(value.strategy, 80),
  };
  if (Array.isArray(value.attempts)) {
    compact.attempts = value.attempts.slice(0, 8).map((attempt) => ({
      rawText: boundedText(attempt?.rawText, 160),
      value: attempt?.value === undefined ? null : attempt.value,
      valid: Boolean(attempt?.valid),
      confidence: finiteOrNull(attempt?.confidence),
      strategy: boundedText(attempt?.strategy, 80),
    }));
  }
  if (value.teamIdentity && typeof value.teamIdentity === 'object') {
    compact.teamIdentity = JSON.parse(JSON.stringify(value.teamIdentity));
  }
  return compact;
}

function compactRecognitionDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  const fields = {};
  for (const [binding, value] of Object.entries(diagnostics.fields || {})) {
    fields[String(binding).slice(0, 100)] = compactFieldRead(value);
  }
  return {
    capturedAt: finiteOrNull(diagnostics.capturedAt),
    elapsedMs: finiteOrNull(diagnostics.elapsedMs),
    capture: diagnostics.capture && typeof diagnostics.capture === 'object'
      ? {
        width: finiteOrNull(diagnostics.capture.width),
        height: finiteOrNull(diagnostics.capture.height),
        sourceWidth: finiteOrNull(diagnostics.capture.sourceWidth),
        sourceHeight: finiteOrNull(diagnostics.capture.sourceHeight),
      }
      : null,
    fields,
    visual: diagnostics.visual ? JSON.parse(JSON.stringify(diagnostics.visual)) : null,
    visualIdentity: diagnostics.visualIdentity
      ? JSON.parse(JSON.stringify(diagnostics.visualIdentity))
      : null,
  };
}

function captureProfileValidation({
  profileKey,
  expectedWidth,
  expectedHeight,
  sourceWidth,
  sourceHeight,
  frameWidth,
  frameHeight,
  readRegion,
} = {}) {
  const expected = { width: finiteOrNull(expectedWidth), height: finiteOrNull(expectedHeight) };
  const source = { width: finiteOrNull(sourceWidth), height: finiteOrNull(sourceHeight) };
  const frame = { width: finiteOrNull(frameWidth), height: finiteOrNull(frameHeight) };
  const hasExpected = expected.width > 0 && expected.height > 0;
  const hasSource = source.width > 0 && source.height > 0;
  const expectedAspect = hasExpected ? expected.width / expected.height : null;
  const sourceAspect = hasSource ? source.width / source.height : null;
  const aspectDelta = expectedAspect && sourceAspect ? Math.abs(sourceAspect - expectedAspect) : null;
  const scaleX = hasExpected && hasSource ? source.width / expected.width : null;
  const scaleY = hasExpected && hasSource ? source.height / expected.height : null;
  const uniformScale = scaleX !== null && scaleY !== null
    ? Math.abs(scaleX - scaleY) <= 0.02
    : null;
  const dimensionsMatch = hasExpected && hasSource
    ? source.width === expected.width && source.height === expected.height
    : null;
  const aspectMatch = aspectDelta === null ? null : aspectDelta <= 0.01;
  const cropPixels = (region, width, height) => {
    if (!region || !(width > 0) || !(height > 0)) return null;
    const x = Math.max(0, Math.min(width - 1, Math.round(Number(region.x || 0) * width)));
    const y = Math.max(0, Math.min(height - 1, Math.round(Number(region.y || 0) * height)));
    const right = Math.max(x + 1, Math.min(width,
      Math.round((Number(region.x || 0) + Number(region.width || 1)) * width)));
    const bottom = Math.max(y + 1, Math.min(height,
      Math.round((Number(region.y || 0) + Number(region.height || 1)) * height)));
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  };
  const expectedFrame = cropPixels(readRegion, expected.width, expected.height);
  const expectedFrameAtSource = cropPixels(readRegion, source.width, source.height);
  const frameGeometryMatch = expectedFrameAtSource && frame.width > 0 && frame.height > 0
    ? frame.width === expectedFrameAtSource.width && frame.height === expectedFrameAtSource.height
    : null;
  const reasonCodes = [];
  if (!hasSource) reasonCodes.push('source-dimensions-unavailable');
  if (aspectMatch === false) reasonCodes.push('custom-source-aspect');
  if (uniformScale === false && aspectMatch !== false) reasonCodes.push('source-non-uniform-scale');
  if (frameGeometryMatch === false) reasonCodes.push('cropped-frame-geometry-mismatch');
  let status = 'waiting-for-frame';
  if (frameGeometryMatch === false) status = 'crop-geometry-mismatch';
  else if (hasSource && aspectMatch === false) status = 'custom-aspect';
  else if (hasSource && uniformScale === false) status = 'non-uniform-scale';
  else if (hasSource && dimensionsMatch) status = 'exact';
  else if (hasSource) status = 'uniformly-scaled';
  return {
    profileKey: boundedText(profileKey, 40),
    status,
    expected,
    source,
    frame,
    expectedFrame,
    expectedFrameAtSource,
    frameGeometryMatch,
    reasonCodes,
    dimensionsMatch,
    aspectMatch,
    uniformScale,
    scaleX,
    scaleY,
  };
}

function supportSafeSettings(settings = {}) {
  const safe = JSON.parse(JSON.stringify(settings || {}));
  if (safe.theme?.path) {
    safe.theme.path = `[local HTML: ${path.basename(String(safe.theme.path))}]`;
  }
  if (safe.overlay?.placements) {
    safe.overlay.placements = `[${Object.keys(safe.overlay.placements).length} saved display placement(s)]`;
  }
  return safe;
}

function supportSafeStatus(status = {}) {
  const safe = JSON.parse(JSON.stringify(status || {}));
  if (safe.overlay?.themePath) {
    safe.overlay.themePath = `[local HTML: ${path.basename(String(safe.overlay.themePath))}]`;
  }
  return safe;
}

function looksLikeAbsolutePath(value) {
  const text = String(value || '').trim();
  return /^(?:file:\/{2,3})?[a-z]:[\\/]/i.test(text)
    || /^\\\\(?:\?\\)?[^\\/]+[\\/]/.test(text)
    || /^\/(?!\/)[^\s]*/.test(text);
}

function sanitizeSupportText(value) {
  let text = String(value);
  if (looksLikeAbsolutePath(text)) return REDACTED_PATH;

  // Capture source tokens are stable machine/window handles even when nested in
  // an error message or stored under an unexpected key.
  text = text.replace(/\b(?:desktop|screen|window):\d+:\d+\b/gi, REDACTED_ID);
  text = text.replace(/\\\\\.\\DISPLAY\d+\b/gi, REDACTED_ID);
  text = text.replace(/\bS-1-5-21-(?:\d+-){2,}\d+\b/gi, REDACTED_ID);
  text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, REDACTED_ID);
  text = text.replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, REDACTED_ID);
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, REDACTED_ID);

  // Paths in thrown errors and stack summaries are commonly embedded after a
  // useful error prefix. Keep that prefix and remove the machine-local suffix.
  text = text.replace(/(?:file:\/{2,3})?[a-z]:[\\/][^\r\n]*/gi, REDACTED_PATH);
  text = text.replace(/\\\\(?:\?\\)?[^\\/\r\n]+[\\/][^\r\n]*/g, REDACTED_PATH);
  text = text.replace(/\/(?:Users|home|root|var|tmp|opt|mnt|media|private|Applications|Volumes)\/[^\r\n]*/gi, REDACTED_PATH);
  return text;
}

function isMachineContext(pathParts) {
  return pathParts.some((part) => MACHINE_CONTEXT_KEYS.has(String(part).toLowerCase()));
}

function isSensitiveIdKey(key, pathParts) {
  const normalized = String(key).toLowerCase();
  if (SENSITIVE_ID_KEYS.has(normalized)) return true;
  if (normalized === 'id' && isMachineContext(pathParts)) return true;
  return /^(?:raw)?(?:capture|desktop|device|display|monitor|process|screen|source|stream|window)(?:source)?(?:id|identifier|handle)$/.test(normalized);
}

function isSensitiveNameKey(key, pathParts) {
  const normalized = String(key).toLowerCase();
  if (SENSITIVE_NAME_KEYS.has(normalized)) return true;
  if (/^(?:capture|desktop|device|display|monitor|process|screen|source|stream|window)(?:name|title|label)$/.test(normalized)) return true;
  return ['label', 'name', 'title'].includes(normalized) && isMachineContext(pathParts);
}

function sanitizeSupportReport(report = {}) {
  const seen = new WeakSet();

  const sanitize = (value, pathParts = []) => {
    if (typeof value === 'string') return sanitizeSupportText(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular reference removed]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item, index) => sanitize(item, [...pathParts, String(index)]));
    }

    const safe = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (normalized === 'placements' && child && typeof child === 'object') {
        const count = Array.isArray(child) ? child.length : Object.keys(child).length;
        safe[key] = `[${count} saved display placement(s)]`;
        continue;
      }
      if (isSensitiveIdKey(key, pathParts)) {
        safe[key] = REDACTED_ID;
        continue;
      }
      if (isSensitiveNameKey(key, pathParts)) {
        safe[key] = REDACTED_NAME;
        continue;
      }
      if (MACHINE_CONTEXT_KEYS.has(normalized) && (child === null || typeof child !== 'object')) {
        safe[key] = REDACTED_ID;
        continue;
      }

      const safeKey = sanitizeSupportText(key);
      const outputKey = safeKey === key ? key : `[redacted key ${Object.keys(safe).length + 1}]`;
      safe[outputKey] = sanitize(child, [...pathParts, normalized]);
    }
    return safe;
  };

  return sanitize(report, []);
}

module.exports = {
  DEFAULT_CAPTURE_HISTORY_LIMIT,
  appendCaptureHistory,
  captureProfileValidation,
  compactCaptureEvent,
  compactRecognitionDiagnostics,
  sanitizeSupportReport,
  supportSafeSettings,
  supportSafeStatus,
};
