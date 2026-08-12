'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const THEME_SCHEME = 'cfb27-theme';
const THEME_HOST = 'active';
const THEME_ENTRY_PATH = '/index.html';
// Partitions without the "persist:" prefix are memory-only in Electron.
const THEME_SESSION_PARTITION = 'cfb27-theme';
const DEFAULT_MAX_THEME_BYTES = 50 * 1024 * 1024;

const THEME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const THEME_PERMISSIONS_POLICY = [
  'accelerometer=()',
  'ambient-light-sensor=()',
  'autoplay=()',
  'camera=()',
  'clipboard-read=()',
  'clipboard-write=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'web-share=()',
  'xr-spatial-tracking=()',
].join(', ');

const THEME_SCHEME_REGISTRATION = Object.freeze({
  scheme: THEME_SCHEME,
  privileges: Object.freeze({
    standard: true,
    secure: true,
    bypassCSP: false,
    allowServiceWorkers: false,
    supportFetchAPI: false,
    corsEnabled: false,
    codeCache: false,
  }),
});

const THEME_REQUEST_FILTER = Object.freeze({
  urls: Object.freeze([
    `${THEME_SCHEME}://*/*`,
    'file://*/*',
    'http://*/*',
    'https://*/*',
    'ws://*/*',
    'wss://*/*',
    'ftp://*/*',
  ]),
});

const registeredProtocolApis = new WeakSet();

function registerPrivilegedThemeScheme(protocolApi, appApi = null) {
  if (!protocolApi || typeof protocolApi.registerSchemesAsPrivileged !== 'function') {
    throw new TypeError('Electron protocol.registerSchemesAsPrivileged is required.');
  }
  if (registeredProtocolApis.has(protocolApi)) return THEME_SCHEME_REGISTRATION;
  if (appApi?.isReady?.()) {
    throw new Error('The theme scheme must be registered before Electron app readiness.');
  }
  protocolApi.registerSchemesAsPrivileged([THEME_SCHEME_REGISTRATION]);
  registeredProtocolApis.add(protocolApi);
  return THEME_SCHEME_REGISTRATION;
}

function createOpaqueThemeToken(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(32);
  const token = Buffer.isBuffer(bytes)
    ? bytes.toString('base64url')
    : Buffer.from(bytes).toString('base64url');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new Error('The generated theme capability token was invalid.');
  }
  return token;
}

function normalizeThemeToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new TypeError('Theme capability tokens must contain 32-128 URL-safe characters.');
  }
  return token;
}

function createActiveThemeUrl(options = {}) {
  const token = normalizeThemeToken(
    typeof options === 'string'
      ? options
      : (options.token || createOpaqueThemeToken(options.randomBytes)),
  );
  const url = new URL(`${THEME_SCHEME}://${THEME_HOST}${THEME_ENTRY_PATH}`);
  url.searchParams.set('token', token);
  return url.href;
}

function parseActiveThemeUrl(value, { allowHash = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== `${THEME_SCHEME}:`
    || parsed.hostname !== THEME_HOST
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== THEME_ENTRY_PATH
    || (!allowHash && parsed.hash)) {
    return null;
  }
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'token') return null;
  const token = parsed.searchParams.get('token') || '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  return { parsed, token };
}

function sameToken(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function expectedThemeToken(expected) {
  if (!expected) return null;
  const parsed = parseActiveThemeUrl(expected, { allowHash: true });
  if (parsed) return parsed.token;
  try {
    return normalizeThemeToken(expected);
  } catch {
    return null;
  }
}

function validateActiveThemeUrl(candidate, expected = null) {
  const parsed = parseActiveThemeUrl(candidate);
  if (!parsed) return false;
  const expectedToken = expectedThemeToken(expected);
  return !expected || (expectedToken !== null && sameToken(parsed.token, expectedToken));
}

function isActiveThemeNavigation(candidate, expected) {
  const parsed = parseActiveThemeUrl(candidate, { allowHash: true });
  const expectedToken = expectedThemeToken(expected);
  return Boolean(parsed && expectedToken && sameToken(parsed.token, expectedToken));
}

function createThemeSecurityHeaders(contentLength = null) {
  const headers = {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': THEME_CSP,
    'Content-Type': 'text/html; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': THEME_PERMISSIONS_POLICY,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (Number.isSafeInteger(contentLength) && contentLength >= 0) {
    headers['Content-Length'] = String(contentLength);
  }
  return headers;
}

function looksLikeStandaloneHtml(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) return false;
  const prefix = bytes.subarray(0, Math.min(bytes.length, 1024 * 1024))
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  return /<!doctype\s+html\b|<html\b|<body\b|<svg\b/i.test(prefix);
}

function resolveStandaloneThemeFile(filePath, options = {}) {
  const fsApi = options.fs || fs;
  const pathApi = options.path || path;
  const maximumBytes = Number(options.maximumBytes) || DEFAULT_MAX_THEME_BYTES;
  const supplied = String(filePath || '').trim();
  if (!supplied) throw new TypeError('A standalone theme HTML path is required.');
  const resolved = pathApi.resolve(supplied);
  if (!['.html', '.htm'].includes(pathApi.extname(resolved).toLowerCase())) {
    throw new Error('Theme content must be a standalone .html or .htm file.');
  }
  const initialStat = fsApi.lstatSync(resolved);
  if (initialStat.isSymbolicLink() || !initialStat.isFile()) {
    throw new Error('Theme content must be a regular, non-symbolic-link file.');
  }
  if (initialStat.size < 1 || initialStat.size > maximumBytes) {
    throw new Error(`Theme HTML must be between 1 and ${maximumBytes} bytes.`);
  }

  let canonicalPath = resolved;
  try {
    const realpath = fsApi.realpathSync?.native || fsApi.realpathSync;
    if (typeof realpath === 'function') canonicalPath = realpath(resolved);
  } catch {
    // Electron's virtual ASAR filesystem can stat/read an entry even where the
    // platform realpath implementation cannot resolve the virtual path.
  }
  const bytes = Buffer.from(fsApi.readFileSync(canonicalPath));
  if (bytes.length < 1 || bytes.length > maximumBytes || !looksLikeStandaloneHtml(bytes)) {
    throw new Error('Selected content is not a valid standalone HTML document.');
  }
  return {
    sourcePath: canonicalPath,
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  };
}

function createThemeProtocolController(options = {}) {
  const ResponseCtor = options.Response || globalThis.Response;
  if (typeof ResponseCtor !== 'function') throw new TypeError('A WHATWG Response constructor is required.');
  let activeTheme = null;
  let installedProtocol = null;

  function publicActiveTheme() {
    if (!activeTheme) return null;
    return Object.freeze({
      url: activeTheme.url,
      token: activeTheme.token,
      sourcePath: activeTheme.sourcePath,
      sha256: activeTheme.sha256,
      bytes: activeTheme.bytes.length,
    });
  }

  function activate(filePath) {
    const source = resolveStandaloneThemeFile(filePath, options);
    const token = createOpaqueThemeToken(options.randomBytes);
    activeTheme = {
      ...source,
      token,
      url: createActiveThemeUrl(token),
    };
    return publicActiveTheme();
  }

  function deactivate() {
    if (activeTheme?.bytes) activeTheme.bytes.fill(0);
    activeTheme = null;
  }

  function response(status, body = null, extraHeaders = {}) {
    return new ResponseCtor(body, {
      status,
      headers: { ...createThemeSecurityHeaders(body?.length ?? null), ...extraHeaders },
    });
  }

  async function handle(request = {}) {
    const method = String(request.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      return response(405, null, { Allow: 'GET, HEAD' });
    }
    if (!activeTheme || !validateActiveThemeUrl(request.url, activeTheme.url)) {
      return response(404);
    }
    const headers = createThemeSecurityHeaders(activeTheme.bytes.length);
    return new ResponseCtor(method === 'HEAD' ? null : activeTheme.bytes.toString('utf8'), {
      status: 200,
      headers,
    });
  }

  function install(protocolApi) {
    if (!protocolApi || typeof protocolApi.handle !== 'function') {
      throw new TypeError('An Electron Protocol instance with handle() is required.');
    }
    if (installedProtocol && installedProtocol !== protocolApi) {
      throw new Error('The theme protocol handler is already installed on another session.');
    }
    if (!installedProtocol) {
      protocolApi.handle(THEME_SCHEME, handle);
      installedProtocol = protocolApi;
    }
    return handle;
  }

  async function dispose() {
    deactivate();
    if (installedProtocol?.unhandle) await installedProtocol.unhandle(THEME_SCHEME);
    installedProtocol = null;
  }

  return Object.freeze({
    activate,
    deactivate,
    dispose,
    getActiveTheme: publicActiveTheme,
    getActiveUrl: () => activeTheme?.url || null,
    handle,
    install,
  });
}

function isServiceWorkerRequest(details) {
  return /service.?worker/i.test(String(details?.resourceType || details?.type || ''));
}

function isAllowedThemeRequest(details, activeThemeUrl) {
  if (isServiceWorkerRequest(details)) return false;
  const candidate = typeof details === 'string' ? details : details?.url;
  let parsed;
  try {
    parsed = new URL(String(candidate || ''));
  } catch {
    return false;
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true;
  if (parsed.protocol === `${THEME_SCHEME}:`) {
    return validateActiveThemeUrl(parsed.href, activeThemeUrl);
  }
  return false;
}

function createThemeBeforeRequestHandler(getActiveThemeUrl) {
  if (typeof getActiveThemeUrl !== 'function') {
    throw new TypeError('getActiveThemeUrl must be a function.');
  }
  return (details, callback) => {
    callback({ cancel: !isAllowedThemeRequest(details, getActiveThemeUrl()) });
  };
}

function getIsolatedThemeSession(sessionApi) {
  if (!sessionApi || typeof sessionApi.fromPartition !== 'function') {
    throw new TypeError('Electron session.fromPartition is required.');
  }
  return sessionApi.fromPartition(THEME_SESSION_PARTITION, { cache: false });
}

function configureThemeSession(themeSession, options = {}) {
  if (!themeSession?.webRequest?.onBeforeRequest) {
    throw new TypeError('An isolated Electron Session with webRequest support is required.');
  }
  const getActiveThemeUrl = options.getActiveThemeUrl || (() => options.activeThemeUrl || null);
  const beforeRequest = createThemeBeforeRequestHandler(getActiveThemeUrl);
  themeSession.webRequest.onBeforeRequest(THEME_REQUEST_FILTER, beforeRequest);

  themeSession.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false));
  themeSession.setPermissionCheckHandler?.(() => false);
  themeSession.setDevicePermissionHandler?.(() => false);
  themeSession.setDisplayMediaRequestHandler?.((_request, callback) => callback({}));

  const onWillDownload = (event, item) => {
    event?.preventDefault?.();
    item?.cancel?.();
  };
  themeSession.on?.('will-download', onWillDownload);

  const serviceWorkers = themeSession.serviceWorkers;
  const onServiceWorkerStatus = (details = {}) => {
    const status = String(details.runningStatus || details.status || '').toLowerCase();
    if (status !== 'running' || details.versionId === undefined) return;
    Promise.resolve(serviceWorkers?.stopWorker?.(details.versionId)).catch(() => {});
  };
  serviceWorkers?.on?.('running-status-changed', onServiceWorkerStatus);

  const cleanupPromise = Promise.resolve(
    themeSession.clearStorageData?.({ storages: ['serviceworkers'] }),
  ).catch(() => undefined);

  return Object.freeze({
    beforeRequest,
    cleanupPromise,
    dispose() {
      themeSession.removeListener?.('will-download', onWillDownload);
      serviceWorkers?.removeListener?.('running-status-changed', onServiceWorkerStatus);
      try { themeSession.webRequest.onBeforeRequest(THEME_REQUEST_FILTER, null); } catch { /* Best effort. */ }
    },
  });
}

function hardenThemeWebPreferences(webPreferences = {}) {
  for (const key of ['preload', 'preloadURL', 'additionalArguments', 'enableBlinkFeatures']) {
    delete webPreferences[key];
  }
  Object.assign(webPreferences, {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    disableDialogs: true,
    enableRemoteModule: false,
    experimentalFeatures: false,
    javascript: true,
    navigateOnDragDrop: false,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    partition: THEME_SESSION_PARTITION,
    plugins: false,
    safeDialogs: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  });
  return webPreferences;
}

function validateThemeWebviewAttachment(params = {}, activeThemeUrl, partition = THEME_SESSION_PARTITION) {
  if (!validateActiveThemeUrl(params.src, activeThemeUrl)) {
    return { ok: false, reason: 'unapproved-theme-url' };
  }
  if (String(params.partition || '') !== partition) {
    return { ok: false, reason: 'wrong-theme-session' };
  }
  if (params.allowpopups === true || params.allowpopups === '') {
    return { ok: false, reason: 'popups-not-allowed' };
  }
  if (params.preload || params.preloadURL) {
    return { ok: false, reason: 'theme-preload-not-allowed' };
  }
  if (params.nodeintegration || params.nodeIntegration || params.disablewebsecurity) {
    return { ok: false, reason: 'unsafe-theme-preferences' };
  }
  return { ok: true, reason: null };
}

function navigationUrl(value) {
  if (typeof value === 'string') return value;
  return String(value?.url || '');
}

function attachThemeNavigationGuards(webContents, options = {}) {
  if (!webContents?.on) throw new TypeError('A WebContents instance is required.');
  const getActiveThemeUrl = options.getActiveThemeUrl || (() => options.activeThemeUrl || null);
  const onBlocked = typeof options.onBlocked === 'function' ? options.onBlocked : () => {};

  const guard = (event, value) => {
    // Electron 43 passes one details/event object. Older Electron releases
    // passed (event, url). Support both so an allowed theme switch is not
    // mistaken for an empty/blocked navigation.
    const details = value === undefined ? event : value;
    const url = navigationUrl(details);
    if (isActiveThemeNavigation(url, getActiveThemeUrl())) return;
    event?.preventDefault?.();
    onBlocked({ type: 'navigation', url });
  };
  const frameGuard = (event, value, _isInPlace, legacyIsMainFrame) => {
    const details = value === undefined ? event : value;
    const url = navigationUrl(details);
    const isMainFrame = details?.isMainFrame === true || legacyIsMainFrame === true;
    if (isMainFrame && isActiveThemeNavigation(url, getActiveThemeUrl())) return;
    event?.preventDefault?.();
    onBlocked({ type: 'frame-navigation', url });
  };
  webContents.on('will-navigate', guard);
  webContents.on('will-redirect', guard);
  webContents.on('will-frame-navigate', frameGuard);
  webContents.setWindowOpenHandler?.((details) => {
    onBlocked({ type: 'popup', url: String(details?.url || '') });
    return { action: 'deny' };
  });

  return () => {
    webContents.removeListener?.('will-navigate', guard);
    webContents.removeListener?.('will-redirect', guard);
    webContents.removeListener?.('will-frame-navigate', frameGuard);
    webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  };
}

function attachThemeWebviewGuards(hostWebContents, options = {}) {
  if (!hostWebContents?.on) throw new TypeError('The host WebContents instance is required.');
  const getActiveThemeUrl = options.getActiveThemeUrl || (() => options.activeThemeUrl || null);
  const onBlocked = typeof options.onBlocked === 'function' ? options.onBlocked : () => {};
  const guestDisposers = new Set();

  const onWillAttach = (event, webPreferences, params) => {
    hardenThemeWebPreferences(webPreferences);
    const validation = validateThemeWebviewAttachment(
      params,
      getActiveThemeUrl(),
      options.partition || THEME_SESSION_PARTITION,
    );
    if (validation.ok) return;
    event?.preventDefault?.();
    onBlocked({ type: 'webview-attachment', ...validation, url: String(params?.src || '') });
  };
  const onDidAttach = (_event, guestWebContents) => {
    const currentUrl = String(guestWebContents?.getURL?.() || '');
    if (currentUrl && currentUrl !== 'about:blank'
      && !isActiveThemeNavigation(currentUrl, getActiveThemeUrl())) {
      onBlocked({ type: 'attached-unapproved-theme', url: currentUrl });
      guestWebContents?.destroy?.();
      return;
    }
    guestDisposers.add(attachThemeNavigationGuards(guestWebContents, { getActiveThemeUrl, onBlocked }));
  };

  hostWebContents.on('will-attach-webview', onWillAttach);
  hostWebContents.on('did-attach-webview', onDidAttach);
  return () => {
    hostWebContents.removeListener?.('will-attach-webview', onWillAttach);
    hostWebContents.removeListener?.('did-attach-webview', onDidAttach);
    for (const dispose of guestDisposers) dispose();
    guestDisposers.clear();
  };
}

module.exports = {
  DEFAULT_MAX_THEME_BYTES,
  THEME_CSP,
  THEME_ENTRY_PATH,
  THEME_HOST,
  THEME_PERMISSIONS_POLICY,
  THEME_REQUEST_FILTER,
  THEME_SCHEME,
  THEME_SCHEME_REGISTRATION,
  THEME_SESSION_PARTITION,
  attachThemeNavigationGuards,
  attachThemeWebviewGuards,
  configureThemeSession,
  createActiveThemeUrl,
  createOpaqueThemeToken,
  createThemeBeforeRequestHandler,
  createThemeProtocolController,
  createThemeSecurityHeaders,
  getIsolatedThemeSession,
  hardenThemeWebPreferences,
  isActiveThemeNavigation,
  isAllowedThemeRequest,
  looksLikeStandaloneHtml,
  parseActiveThemeUrl,
  registerPrivilegedThemeScheme,
  resolveStandaloneThemeFile,
  validateActiveThemeUrl,
  validateThemeWebviewAttachment,
};
