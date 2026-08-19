'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { trimTransparentPng } = require('./png-alpha-trim');
const { spawn, execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Notification,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
  utilityProcess,
} = require('electron');

// Chromium's Windows capture backend writes recoverable WGC diagnostics
// directly to the parent terminal. The app records actionable reader failures
// in its own log, so keep those internal messages out of VS Code/PowerShell.
app.commandLine.appendSwitch('disable-logging');
const {
  hasScoreboardFingerprint,
  MockScoreboardSource,
  ScoreboardStateValidator,
  splitTeamIdentity,
  toRendererState,
} = require('./recognition');
const {
  getBundledLanguageData,
  getBundledOcrWorkerOptions,
  LocalScoreboardOcr,
} = require('./recognition/ocr-worker');
const { recognizeDownDistance } = require('./recognition/down-distance-reader');
const {
  CountdownClockModel,
  confirmedClockFields,
} = require('./recognition/clock-model');
const { recognizeQuarter } = require('./recognition/quarter-reader');
const { recognizeScore } = require('./recognition/score-reader');
const { analyzeVisualFields } = require('./recognition/visual-fields');
const { analyzeVisualIdentity } = require('./recognition/visual-identity');
const {
  preferredTeamColor,
  preferredTeamLogo,
  TeamAssetResolver,
} = require('./recognition/team-assets');
const {
  resolveScoreboardTeamIdentity,
  scoreboardTeamOptions,
} = require('./scoreboard-team-policy');
const {
  applyManualTeamOverrides,
  emptyManualTeamOverrides,
  finalizeManualTeamOverrides,
  normalizeManualTeamOverride,
} = require('./manual-team-overrides');
const {
  TeamLogoVariantResolver,
  applyThemeLogoLibrary,
  applyTeamLogoPreferences,
  normalizedPreferences,
} = require('./team-logo-variants');
const {
  CustomTeamLogoStore,
  normalizedCustomTeamLogos,
} = require('./team-logo-library');
const {
  normalizeCustomTeams,
  removeCustomTeam,
  upsertCustomTeam,
} = require('./custom-teams');
const {
  parseThemeSettingsDeclaration,
  resolveThemeSettingValues,
} = require('./theme-settings');
const {
  applyDynastyContext,
  applyDynastyNameFallback,
  applyDynastySideCorrection,
  indexSaveTeams,
  indexSaveTeamsByPresentationId,
  registerUnmatchedSaveTeams,
} = require('./dynasty-context');
const {
  DEFAULT_LOGO_TRANSFORM,
  logoLayoutKey,
  normalizeLogoTransform,
  normalizedLogoLayouts,
} = require('./team-logo-layout');
const { TeamRankMemory } = require('./recognition/team-rank-memory');
const {
  cropNativeImage,
  regionToPixels,
  resolveFieldRoi,
  resolveReadRegion,
} = require('./read-region');
const {
  ElectronCaptureStreamTransport,
  PersistentCaptureStream,
} = require('./capture-stream-controller');
const { OcrFieldCadence } = require('./ocr-field-cadence');
const {
  normalizeReadingProfile,
  resolveReaderBehavior,
} = require('./reader-behavior-profile');
const {
  displayKey,
  sanitizeBounds,
  serializePlacement,
} = require('./placement-store');
const {
  normalizeOutputResolution,
  resolveScaleSettings,
  resizeBoundsAroundAnchor,
  scaleAt2160FromEffective,
} = require('./resolution-profile');
const {
  adaptReadRegionToSource,
  createFactoryResizablePlacementProfile,
  loadReaderProfileCatalog,
  migrateLegacyCaptureToProfile,
  normalizeProfileKey,
  PROFILE_KEYS,
  REQUIRED_ROI_KEYS,
  resetReaderProfileOverride,
  resolveEffectiveReaderProfile,
  upgradeLegacyReaderProfileOverrides,
} = require('./reader-profile');
const { selectReaderProfileKey } = require('./reader-profile-selection');
const {
  adaptReaderCalibrationReadRegion,
  assertReaderCalibrationFile,
  createReaderCalibrationFile,
  MAX_READER_CALIBRATION_BYTES,
  materializeReaderProfileOverrides,
  parseReaderCalibrationFile,
  serializeReaderCalibrationFile,
} = require('./reader-calibration-file');
const { effectiveReadRegionForSource } = require('./effective-read-region');
const { RuntimeValidationSession } = require('./runtime-validation');
const {
  appendCaptureHistory,
  captureProfileValidation,
  compactRecognitionDiagnostics,
  sanitizeSupportReport,
  supportSafeSettings,
  supportSafeStatus,
} = require('./support-diagnostics');
const { LatestTaskQueue } = require('./latest-task-queue');
const { buildRamReaderReport } = require('./ram-reader-report');
const {
  applyScorebugColorPreset,
  applyScorebugColors,
  deleteScorebugColorPreset,
  isHexColor: isScorebugHexColor,
  normalizeScorebugColors,
  removeScorebugColorRule,
  resolveScorebugColors,
  upsertScorebugColorPreset,
  upsertScorebugColorRule,
} = require('./scorebug-colors');
const {
  captureSourceHwnd,
  normalizeWindowTitle,
  selectCaptureSource,
  selectGameWindow,
} = require('./window-candidate');
const { screenCaptureEnabled } = require('./capture-policy');
const {
  automaticVisibilityDelay,
  resolveVisibilityMode,
  VisibilityTransitionGate,
} = require('./visibility-state');
const {
  ThemeLibrary,
  analyzeThemeHtml,
  sha256,
  themeCanvasSize,
} = require('./theme-library');
const { resolveUserDataLocation } = require('./user-data-location');
const { normalizeGreenScreen } = require('./chroma-key');
const {
  assertTrustedIpcSender,
  installLocalNavigationGuard,
} = require('./ipc-security');
const {
  attachThemeWebviewGuards,
  configureThemeSession,
  createThemeProtocolController,
  getIsolatedThemeSession,
  registerPrivilegedThemeScheme,
} = require('./theme-security');
const { AutomaticDataExtractor } = require('./automatic-data-extractor');
const {
  applyScoreboardDataSource,
  normalizeRamInteger,
  normalizeScoreboardDataSource,
  scoreboardDataSourceLabel,
  usesRamReader,
} = require('./scoreboard-data-source');
const { TransientJsonReader } = require('./transient-json-reader');
const { applyRamFieldHold, clearRamFieldHold, createRamFieldHoldCache,
  forgetRamFieldHold,
} = require('./ram-field-hold');
const { flagStateFromMessages } = require('./flag-detector');
let lastRamQuarter = null;
const { runPreflight, reportText: preflightReportText } = require('./preflight');
const { applyRamDocumentHold, clearRamDocumentHold, createRamDocumentHold, looksLikeNewGame } = require('./ram-document-hold');

registerPrivilegedThemeScheme(protocol, app);

const APP_ID = 'com.cfb27.scoreboard.overlay.data-extraction-test';
const PRODUCT_NAME = 'A test for this';
const ONBOARDING_VERSION = 1;
const SETTINGS_SCHEMA_VERSION = 14;
const READER_CALIBRATION_EXTENSION = 'cfb27reader';
const OVERLAY_DOCUMENT = path.join(__dirname, 'overlay.html');
const IN_GAME_EDITOR_DOCUMENT = path.join(__dirname, 'ingame-editor.html');
const CONTROL_DOCUMENT = path.join(__dirname, 'control.html');
const DIAGNOSIS_DOCUMENT = path.join(__dirname, 'diagnosis.html');
const LIBRARY_DOCUMENT = path.join(__dirname, 'library.html');
const LEGACY_USER_DATA_PATH = app.getPath('userData');
const USER_DATA_LOCATION = resolveUserDataLocation({
  isPackaged: app.isPackaged,
  executablePath: process.execPath,
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  appDataPath: app.getPath('appData'),
  productName: PRODUCT_NAME,
  markerExists: fs.existsSync,
});
const STABLE_USER_DATA_PATH = USER_DATA_LOCATION.userDataPath;
if (path.resolve(LEGACY_USER_DATA_PATH) !== path.resolve(STABLE_USER_DATA_PATH)) {
  fs.mkdirSync(STABLE_USER_DATA_PATH, { recursive: true });
  app.setPath('userData', STABLE_USER_DATA_PATH);
}
const DEFAULT_SIZE = Object.freeze({ width: 371, height: 433 });
const DEFAULT_LAYOUT = Object.freeze({
  // Top-center by default: the game's play-call menu owns the bottom of the
  // screen, and a factory-placed bug sitting on it glitches the picker.
  anchor: 'top-center',
  right: 0,
  bottom: 32,
  width: DEFAULT_SIZE.width,
  height: DEFAULT_SIZE.height,
});
let overlayWindow = null;
let diagnosisWindow = null;
let inGameEditorWindow = null;
let controlWindow = null;
let libraryWindow = null;
let shuttingDown = false;
let sourcePollTimer = null;
let mockSource = null;
let validator = null;
let windowProbe = null;
let windowProbeBuffer = '';
let ramReaderProcess = null;
let ramReaderRestartTimer = null;
let ramReaderSeedMode = null;
let ramScoreboardTimer = null;
let ramFileWatcher = null;
let ramWatchPollScheduled = false;
let ramScoreboardSignature = '';

// Reader health watchdog. The reader can stay alive and busy while publishing
// nothing at all - on 2026-08-11 the game was restarted underneath it and it
// spent over two hours scanning for a process that no longer existed, with the
// scorebug frozen on two-hour-old values that still looked plausible. The one
// signal that catches every version of this is simply whether fresh data is
// arriving, so that is what is watched rather than any single field.
let ramReaderHealthTimer = null;
let lastRamDataAtMs = 0;
let lastRamRecoveryAtMs = 0;
let lastRamReaderStartAtMs = 0;
let consecutiveRamRecoveries = 0;
let lastAutoNewGameAtMs = 0;
let autoNewGameReacquire = false;
// The reader needs up to 30s for a cold scan, so anything near that just
// kills it mid-acquisition and it can never finish. Measured 2026-08-12:
// a 25s threshold restarted it five times in a row and it never read once.
const RAM_DATA_STALE_MS = 90000;
// A reader that has not touched its status file for this long is hung/dead.
const RAM_HEARTBEAT_STALE_MS = 45000;
let ramQuietNoted = false;
// However long the threshold, never judge a reader that has only just
// started - it has produced nothing yet because it is still looking.
const RAM_READER_GRACE_MS = 60000;
const RAM_RECOVERY_COOLDOWN_MS = 30000;
// After repeated failures the game is probably closed or on a menu, so back off
// rather than restarting a child process every half minute forever.
const RAM_RECOVERY_BACKOFF_MS = 300000;
const RAM_RECOVERY_ATTEMPTS_BEFORE_BACKOFF = 5;
let captureLoopTimer = null;
let captureBusy = false;
let clockPresentationTimer = null;
let captureStream = null;
let captureStreamLogSignature = '';
let captureStreamEventSignature = '';
let captureCadenceSourceId = '';
let ocrWorker = null;
let dataOcrWorker = null;
let dataOcrBusy = false;
let dataExtractor = null;
let lastOcrErrorAt = 0;
let placementSaveTimer = null;
let overlayResizeGesture = null;
let overlayMoveGesture = null;
let validationSession = null;
let teamAssetResolver = null;
let teamAssetResolverAttempted = false;
let teamLogoVariantResolver = null;
let customTeamLogoStore = null;
let themeLibrary = null;
let themeProtocolController = null;
let themeSessionSecurity = null;
let themeWebviewSecurityDisposer = null;
let readerProfileCatalog = null;
const readerLifecycle = new LatestTaskQueue();
const ocrFieldCadence = new OcrFieldCadence({ staticIntervalMs: 900 });
const teamRankMemory = new TeamRankMemory();
const ramLiveDocumentReader = new TransientJsonReader();
const ramFieldHoldCache = createRamFieldHoldCache();
const ramDocumentHold = createRamDocumentHold();
const gameClockPresentation = new CountdownClockModel({
  format: 'minutes',
  correctionThresholdSeconds: 5,
  stoppedAfterRepeatMs: 2_500,
});
const playClockPresentation = new CountdownClockModel({
  format: 'seconds',
  correctionThresholdSeconds: 5,
  stoppedAfterRepeatMs: 2_500,
});
const visibilityTransitionGate = new VisibilityTransitionGate(commitOverlayVisibility);
let defaults = {};
let settings = {};

const runtime = {
  playCallOpen: null,
  dynasty: null,
  requestedVisible: false,
  autoVisible: true,
  editMode: false,
  quickSettingsOpen: false,
  cropMode: false,
  positionLocked: false,
  ignorePlacementEventsUntil: 0,
  activeDisplayKey: null,
  mockMode: process.argv.includes('--mock'),
  themePath: null,
  themeLogoLibrary: null,
  themeRevision: 0,
  gameBounds: null,
  layout: { ...DEFAULT_LAYOUT },
  readerScoreboardState: createEmptyState(),
  ramScoreboardState: null,
  ramAppliedFields: [],
  scoreboardState: createEmptyState(),
  manualTeamOverrides: emptyManualTeamOverrides(),
  logoTransformDrafts: new Map(),
  logoGeometry: { away: null, home: null },
  lastVisibilityReason: 'startup',
  started: false,
  automaticEnabled: true,
  game: {
    detected: false,
    title: '',
    sourceId: '',
    lastSeenAt: null,
  },
  // The manually selected capture source id once this session has validated
  // it by title. It keeps the user's pick authoritative through later title
  // changes without ever trusting a stale id from an earlier session.
  trustedExplicitSourceId: '',
  capture: {
    running: false,
    sourceId: '',
    sourceName: '',
    streamSourceId: '',
    streamStatus: 'idle',
    error: null,
    lastError: null,
    lastErrorAt: null,
    attempt: 0,
    retryDelayMs: null,
    retryAt: null,
    sourceWidth: null,
    sourceHeight: null,
    negotiatedWidth: null,
    negotiatedHeight: null,
    health: 'idle',
    healthReason: null,
    telemetry: null,
    lastFrameAt: null,
    lastNoFrameAt: null,
    unavailableReason: null,
    profileValidation: null,
  },
  reader: {
    status: 'waiting',
    healthy: false,
    lastReadAt: null,
  },
  visualIdentity: {
    awayColor: null,
    awayLogo: null,
    awayLogoHash: null,
    homeColor: null,
    homeLogo: null,
    homeLogoHash: null,
    updatedAt: null,
  },
  support: {
    captureHistory: [],
    consecutiveNoFrameTicks: 0,
    lastRecognitionDiagnostics: null,
    lastRecognitionAt: null,
    lastReaderError: null,
    calibrationRestore: null,
  },
};

function createEmptyState() {
  return {
    away: {
      rank: null,
      name: null,
      nickname: null,
      record: null,
      score: null,
      timeouts: null,
      possession: false,
      color: null,
      logo: null,
    },
    home: {
      rank: null,
      name: null,
      nickname: null,
      record: null,
      score: null,
      timeouts: null,
      possession: false,
      color: null,
      logo: null,
    },
    game: {
      quarter: null,
      clock: null,
      playClock: null,
      downDistance: null,
      down: null,
      distance: null,
      ballOn: null,
      status: null,
    },
    meta: {
      source: 'startup',
      visible: false,
      confidence: 0,
      updatedAt: new Date().toISOString(),
    },
  };
}

function createMockState() {
  return {
    away: {
      rank: '18',
      name: 'SYRACUSE',
      nickname: 'Orange',
      record: '5-1',
      score: '14',
      timeouts: 3,
      possession: true,
      color: '#172b4d',
    },
    home: {
      rank: '7',
      name: 'MIAMI',
      nickname: 'Hurricanes',
      record: '6-0',
      score: '10',
      timeouts: 2,
      possession: false,
      color: '#f47321',
    },
    game: {
      quarter: '2ND',
      clock: '8:42',
      playClock: '25',
      downDistance: '3RD & 7',
    },
    meta: {
      source: 'mock',
      confidence: 1,
      updatedAt: new Date().toISOString(),
    },
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepMerge(base, override) {
  const result = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(override)) return result;
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? deepMerge(result[key], value)
      : value;
  }
  return result;
}

function applyResolutionSettings(overlay, fallbackScale = 0.5) {
  const target = isPlainObject(overlay) ? overlay : {};
  const resolved = resolveScaleSettings(target, fallbackScale);
  target.outputResolution = resolved.outputResolution;
  target.scaleAt2160 = resolved.scaleAt2160;
  target.scale = resolved.scale;
  return target;
}

function migrateSavedResolutionSettings(saved) {
  if (!isPlainObject(saved) || !isPlainObject(saved.overlay)) return false;
  const before = JSON.stringify({
    schemaVersion: saved.schemaVersion,
    outputResolution: saved.overlay.outputResolution,
    scaleAt2160: saved.overlay.scaleAt2160,
    scale: saved.overlay.scale,
  });
  applyResolutionSettings(saved.overlay, 0.5);
  saved.schemaVersion = Math.max(3, Number(saved.schemaVersion) || 0);
  return before !== JSON.stringify({
    schemaVersion: saved.schemaVersion,
    outputResolution: saved.overlay.outputResolution,
    scaleAt2160: saved.overlay.scaleAt2160,
    scale: saved.overlay.scale,
  });
}

const LEGACY_RIGHT_DONOR_REGION = Object.freeze({
  x: 0.88515625,
  y: 0.7680555556,
  width: 0.10078125,
  height: 0.2027777778,
});

function sameRegion(left, right, tolerance = 1e-10) {
  return Boolean(left && right && ['x', 'y', 'width', 'height'].every((field) => (
    Math.abs(Number(left[field]) - Number(right[field])) <= tolerance
  )));
}

// Schema v13 -> v14: the factory position moved to top-center so a fresh
// install's bug cannot sit on the play-call menu. Applies only to users
// still on the untouched factory placement - anyone who moved, locked, or
// saved per-theme positions keeps exactly what they had.
function migratePickerClearDefault(saved, loadedSchemaVersion) {
  if (!isPlainObject(saved) || loadedSchemaVersion >= 14) return false;
  saved.overlay ||= {};
  const placements = saved.overlay.placements;
  const hasSavedPlacement = isPlainObject(placements) && Object.keys(placements).length > 0;
  const factoryPlacement = !hasSavedPlacement
    && saved.overlay.positionLocked !== true
    && (saved.overlay.anchor === undefined || saved.overlay.anchor === 'bottom-center')
    && (saved.overlay.marginX === undefined || Number(saved.overlay.marginX) === 0)
    && (saved.overlay.marginY === undefined || Number(saved.overlay.marginY) === 32);
  if (!factoryPlacement) return false;
  saved.overlay.anchor = 'top-center';
  saved.overlay.marginX = 0;
  saved.overlay.marginY = 32;
  return true;
}

function migrateCenteredDonorSettings(saved, loadedSchemaVersion) {
  if (!isPlainObject(saved) || loadedSchemaVersion >= 5) return false;
  const before = JSON.stringify(saved);
  saved.overlay ||= {};
  const placements = saved.overlay.placements;
  const hasSavedPlacement = isPlainObject(placements) && Object.keys(placements).length > 0;
  const factorySidePlacement = !hasSavedPlacement
    && saved.overlay.positionLocked !== true
    && (saved.overlay.anchor === undefined || saved.overlay.anchor === 'bottom-right')
    && (saved.overlay.marginX === undefined || Number(saved.overlay.marginX) === 28);
  if (factorySidePlacement) {
    saved.overlay.anchor = 'bottom-center';
    saved.overlay.marginX = 0;
    if (saved.overlay.marginY === undefined || Number(saved.overlay.marginY) === 28) {
      saved.overlay.marginY = 32;
    }
  }

  const overrides = saved.capture?.profileOverrides;
  if (isPlainObject(overrides)) {
    for (const [key, profile] of Object.entries(overrides)) {
      if (sameRegion(profile?.readRegion, LEGACY_RIGHT_DONOR_REGION)) delete overrides[key];
    }
  }
  saved.schemaVersion = Math.max(5, Number(saved.schemaVersion) || 0);
  return before !== JSON.stringify(saved);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getReaderProfileCatalog() {
  if (!readerProfileCatalog) {
    readerProfileCatalog = loadReaderProfileCatalog(
      path.join(app.getAppPath(), 'config', 'reader-profiles.json'),
    );
  }
  return readerProfileCatalog;
}

// Reader calibration follows the pixels actually captured from the game.
// The overlay output-resolution setting controls only the rendered overlay
// size; using it for OCR could run the wrong boxes against a valid frame and
// leave the UI stuck at "capture running" with no reader output.
function readerProfileSelection(settingsValue = settings) {
  return selectReaderProfileKey({
    sourceWidth: runtime?.capture?.sourceWidth,
    sourceHeight: runtime?.capture?.sourceHeight,
    gameWidth: runtime?.game?.bounds?.width,
    gameHeight: runtime?.game?.bounds?.height,
    configuredKey: settingsValue?.overlay?.outputResolution,
    defaultKey: '2160p',
  });
}

function activeReaderProfileKey(settingsValue = settings) {
  return readerProfileSelection(settingsValue).key;
}

function resolvedReaderProfile(settingsValue = settings, requestedKey = null) {
  const key = normalizeProfileKey(requestedKey, activeReaderProfileKey(settingsValue));
  return resolveEffectiveReaderProfile(
    getReaderProfileCatalog(),
    settingsValue?.capture?.profileOverrides || {},
    key,
  );
}

function portableReaderCalibration(settingsValue = settings) {
  const value = settingsValue?.capture?.readerCalibration;
  if (!value) return null;
  try {
    return assertReaderCalibrationFile(value);
  } catch {
    return null;
  }
}

function restorePortableReaderCalibration(settingsValue) {
  if (!isPlainObject(settingsValue?.capture)) return { changed: false, valid: false };
  const raw = settingsValue.capture.readerCalibration;
  if (!raw) return { changed: false, valid: false };
  const storedProfileKey = normalizeProfileKey(
    settingsValue.capture.readerCalibrationProfileKey,
    null,
  );
  const profileKey = storedProfileKey || activeReaderProfileKey(settingsValue);
  const before = JSON.stringify({
    readerCalibration: raw,
    readerCalibrationProfileKey: settingsValue.capture.readerCalibrationProfileKey || null,
    profileOverrides: settingsValue.capture.profileOverrides || {},
  });
  try {
    const calibration = assertReaderCalibrationFile(raw);
    const profiles = materializeReaderProfileOverrides(
      getReaderProfileCatalog(),
      calibration,
      profileKey,
    );
    const existingOverrides = isPlainObject(settingsValue.capture.profileOverrides)
      ? settingsValue.capture.profileOverrides
      : {};
    if (!storedProfileKey) {
      // Older builds mirrored one saved reader file into every resolution.
      // Keep it only on the resolution selected when this build first loads it.
      for (const key of PROFILE_KEYS) {
        if (key !== profileKey && existingOverrides[key]?.aspectAdaptive === true) {
          delete existingOverrides[key];
        }
      }
    }
    settingsValue.capture.readerCalibration = cloneJson(calibration);
    settingsValue.capture.readerCalibrationProfileKey = profileKey;
    settingsValue.capture.profileOverrides = {
      ...existingOverrides,
      ...cloneJson(profiles),
    };
    return {
      changed: before !== JSON.stringify({
        readerCalibration: settingsValue.capture.readerCalibration,
        readerCalibrationProfileKey: settingsValue.capture.readerCalibrationProfileKey,
        profileOverrides: settingsValue.capture.profileOverrides,
      }),
      valid: true,
      profileKey,
    };
  } catch (error) {
    // Never silently discard the user's saved calibration. The invalid file
    // and any previously materialized overrides stay in settings untouched;
    // the reader falls back to whatever profiles still validate, and the
    // failure is surfaced in the reader status, Activity Log, and diagnostics
    // report so a tester can see that recalibration is required.
    console.warn(`[overlay] saved reader calibration could not be applied: ${error.message}`);
    return {
      changed: false,
      valid: false,
      reason: String(error?.message || error),
      code: error?.code || null,
    };
  }
}

function removePortableReaderCalibration(captureValue, profileKeyValue = null) {
  if (!isPlainObject(captureValue)) return;
  const storedProfileKey = normalizeProfileKey(captureValue.readerCalibrationProfileKey, null);
  const targetProfileKey = normalizeProfileKey(profileKeyValue, null);
  const removeStoredCalibration = !targetProfileKey
    || !storedProfileKey
    || targetProfileKey === storedProfileKey;
  if (removeStoredCalibration) {
    delete captureValue.readerCalibration;
    delete captureValue.readerCalibrationProfileKey;
  }
  if (!isPlainObject(captureValue.profileOverrides)) return;
  const keys = targetProfileKey
    ? [targetProfileKey]
    : (storedProfileKey ? [storedProfileKey] : PROFILE_KEYS);
  for (const key of keys) {
    if (captureValue.profileOverrides[key]?.aspectAdaptive === true) delete captureValue.profileOverrides[key];
  }
}

function sourceGeometryForReader(readerProfile, sourceId = '') {
  const profile = readerProfile?.profile || {};
  const streamMatches = sourceId
    && runtime.capture.streamSourceId
    && sourceId === runtime.capture.streamSourceId;
  if (streamMatches
    && Number(runtime.capture.sourceWidth) > 0
    && Number(runtime.capture.sourceHeight) > 0) {
    return {
      width: Number(runtime.capture.sourceWidth),
      height: Number(runtime.capture.sourceHeight),
      origin: 'live-stream',
    };
  }
  const calibrationMatches = sourceId
    && sourceId === runtime.capture.calibrationSourceId;
  if (calibrationMatches
    && Number(runtime.capture.calibrationSourceWidth) > 0
    && Number(runtime.capture.calibrationSourceHeight) > 0) {
    return {
      width: Number(runtime.capture.calibrationSourceWidth),
      height: Number(runtime.capture.calibrationSourceHeight),
      origin: 'calibration-snapshot',
    };
  }
  const gameMatches = !sourceId || !runtime.game.sourceId || sourceId === runtime.game.sourceId;
  if (gameMatches
    && Number(runtime.game.bounds?.width) > 0
    && Number(runtime.game.bounds?.height) > 0) {
    return {
      width: Number(runtime.game.bounds.width),
      height: Number(runtime.game.bounds.height),
      origin: 'game-window',
    };
  }
  return {
    width: Number(profile.captureWidth) || 1,
    height: Number(profile.captureHeight) || 1,
    origin: 'reader-profile',
  };
}

function effectiveReaderReadRegion(readerProfile, sourceWidth, sourceHeight, settingsValue = settings) {
  return effectiveReadRegionForSource(
    readerProfile,
    portableReaderCalibration(settingsValue),
    sourceWidth,
    sourceHeight,
  );
}

function applyActiveReaderProfile(settingsValue = settings) {
  settingsValue.capture ||= {};
  const resolved = resolvedReaderProfile(settingsValue);
  const profile = resolved.profile;
  settingsValue.capture.activeProfile = resolved.key;
  settingsValue.capture.profileOrigin = resolved.origin;
  settingsValue.capture.captureWidth = profile.captureWidth;
  settingsValue.capture.captureHeight = profile.captureHeight;
  settingsValue.capture.readRegion = cloneJson(profile.readRegion);
  settingsValue.capture.roiSpace = profile.roiSpace;
  settingsValue.capture.rois = cloneJson(profile.rois);
  return resolved;
}

function publicReaderProfiles() {
  const catalog = getReaderProfileCatalog();
  const activeKey = activeReaderProfileKey();
  return Object.keys(catalog.profiles).map((key) => {
    const resolved = resolvedReaderProfile(settings, key);
    return {
      key,
      active: key === activeKey,
      origin: resolved.origin,
      fallbackReason: resolved.fallbackReason || null,
      captureWidth: resolved.profile.captureWidth,
      captureHeight: resolved.profile.captureHeight,
    };
  });
}

function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function logsPath() {
  return path.join(app.getPath('userData'), 'logs');
}

function dataExportRootPath() {
  return path.join(app.getPath('userData'), 'data-export');
}

function automaticExtractionEnabled(settingsValue = settings) {
  return settingsValue.dataExtraction?.enabled !== false;
}

function scoreboardDataSourceMode(settingsValue = settings) {
  return normalizeScoreboardDataSource(settingsValue.dataExtraction?.scoreboardSource);
}

function automaticDataExtractor() {
  if (!dataExtractor) {
    dataExtractor = new AutomaticDataExtractor({ rootPath: dataExportRootPath() });
  }
  return dataExtractor;
}

function ramReaderStatusPath() {
  return path.join(dataExportRootPath(), 'ram-reader-status.json');
}

function ramLiveDataPath() {
  return path.join(dataExportRootPath(), 'live-game-data.json');
}

function ramReaderSnapshot() {
  const saved = readJsonFile(ramReaderStatusPath(), {});
  const mode = scoreboardDataSourceMode();
  const enabled = usesRamReader(mode);
  return {
    bundled: process.platform === 'win32',
    enabled,
    mode,
    modeLabel: scoreboardDataSourceLabel(mode),
    running: Boolean(ramReaderProcess && ramReaderProcess.exitCode === null && !ramReaderProcess.killed),
    processId: ramReaderProcess?.pid || null,
    statusPath: ramReaderStatusPath(),
    gameProcessId: saved.gameProcessId || null,
    dataApplied: enabled && Boolean(runtime.ramScoreboardState),
    appliedFields: [...runtime.ramAppliedFields],
    updatedAt: saved.updatedAt || null,
    message: enabled
      ? (saved.message || (process.platform === 'win32' ? 'RAM reader is starting.' : 'RAM reader is available only on Windows.'))
      : 'Disabled because Screen reader is selected.',
  };
}

function ramScoreboardPayload(document) {
  if (!document || document.status !== 'live' || !document.process?.id) return null;
  if (runtime.game?.pid && Number(document.process.id) !== Number(runtime.game.pid)) return null;
  const updatedAtMs = Date.parse(document.updatedAt || '');
  // A slower background lookup (for example, finding a missing team name) must
  // not make already-confirmed scoreboard values disappear from the overlay.
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > 20000) return null;

  const state = { away: {}, home: {}, game: {}, meta: {} };
  const fields = [];
  const apply = (target, key, value, valid, label) => {
    if (!valid) return;
    target[key] = value;
    fields.push(label);
  };
  const teamIdentityPair = Object.fromEntries(['away', 'home'].map((side) => {
    const source = document[side] || {};
    const presentationId = normalizeRamInteger(source.presentationId, { min: 1, max: 2047 });
    return [side, {
      presentationId,
      isTeamBuilder: source.isTeamBuilder,
      valid: source.presentationIdSource === 'ram-scorehud'
        && source.isTeamBuilderSource === 'ram-scorehud'
        && presentationId !== null
        && typeof source.isTeamBuilder === 'boolean',
    }];
  }));
  const teamIdentityPairValid = teamIdentityPair.away.valid
    && teamIdentityPair.home.valid
    && teamIdentityPair.away.presentationId !== teamIdentityPair.home.presentationId;
  for (const side of ['away', 'home']) {
    const source = document[side] || {};
    const target = state[side];
    // Stable team identity comes from an atomically validated pair of live
    // ScoreHud objects. The C# reader withholds both sides unless their ids,
    // scores, orientation and TeamBuilder flags all agree on this tick.
    apply(target, 'presentationId', teamIdentityPair[side].presentationId, teamIdentityPairValid, `${side}.presentationId`);
    apply(target, 'isTeamBuilder', teamIdentityPair[side].isTeamBuilder, teamIdentityPairValid, `${side}.isTeamBuilder`);
    // 'ram-pending' carries a placeholder ("Away"/"Home") while the reader
    // re-proves the matchup. Treat it as absent so the field hold keeps the
    // last real name instead of flashing AWAY/HOME over it.
    apply(target, 'name', source.name, /^ram(?:-cached)?$/i.test(String(source.nameSource || '')) && Boolean(source.name), `${side}.name`);
    const rank = normalizeRamInteger(source.rank, { min: 1, max: 25 });
    apply(target, 'rank', rank, source.rankSource === 'ram'
      && (source.rank == null || rank !== null), `${side}.rank`);
    // "W-L" or "W-L-T", already sanity-checked by the reader. Validate the
    // shape here anyway so a malformed export cannot reach the scorebug.
    const record = typeof source.record === 'string' && /^\d{1,2}-\d{1,2}(?:-\d{1,2})?$/.test(source.record)
      ? source.record
      : null;
    apply(target, 'record', record, source.recordSource === 'ram' && record !== null, `${side}.record`);
    const score = normalizeRamInteger(source.score, { min: 0, max: 255 });
    apply(target, 'score', score, source.scoreSource === 'ram'
      && score !== null, `${side}.score`);
    const timeouts = normalizeRamInteger(source.timeouts, { min: 0, max: 3 });
    apply(target, 'timeouts', timeouts, source.timeoutsSource === 'ram'
      && timeouts !== null, `${side}.timeouts`);
    apply(target, 'possession', Boolean(source.possession), source.possessionSource === 'ram' && typeof source.possession === 'boolean', `${side}.possession`);
  }
  const game = document.game || {};
  apply(state.game, 'quarter', game.quarterText, game.quarterSource === 'ram' && Boolean(game.quarterText), 'game.quarter');
  apply(state.game, 'clock', game.clock, game.clockSource === 'ram' && /^\d{1,2}:\d{2}$/.test(String(game.clock || '')), 'game.clock');
  const playClock = normalizeRamInteger(game.playClock, { min: 0, max: 99 });
  apply(state.game, 'playClock', playClock, game.playClockSource === 'ram'
    && playClock !== null, 'game.playClock');
  const down = normalizeRamInteger(game.down, { min: 1, max: 4 });
  apply(state.game, 'down', down, game.downDistanceSource === 'ram' && down !== null, 'game.down');
  const distance = normalizeRamInteger(game.distance, { min: 0, max: 99 });
  apply(state.game, 'distance', distance, game.downDistanceSource === 'ram' && distance !== null, 'game.distance');
  apply(state.game, 'downDistance', game.downDistance, game.downDistanceSource === 'ram' && Boolean(game.downDistance), 'game.downDistance');
  // This list must match the kinds RamLiveExporter.cs actually emits. It reports
  // a generic "conversion" when a pooled Down -1 object cannot distinguish a PAT
  // from a 2PT, and "pendingSpecial" while a Goal/Inches layer is still
  // resolving; both were silently dropped here. "pat" is kept for the day the
  // exporter can tell them apart.
  apply(state.game, 'downDistanceKind', game.downDistanceKind, game.downDistanceSource === 'ram'
    && /^(?:numeric|goal|inches|kickoff|pat|conversion|twoPointConversion|pendingSpecial)$/.test(String(game.downDistanceKind || '')), 'game.downDistanceKind');
  // Penalty flag, from the game's own FLAG banner (probe-verified id + text
  // fallback). Present and true only while the game itself shows the banner.
  const flag = flagStateFromMessages(document.ram?.recentMessages, Date.now());
  // Publish an explicit false/'' when the banner is gone - a theme that
  // showed its flag animation needs a real value to take it down again
  // (a missing key means "unknown", and the themes rightly keep the last
  // known state for unknowns).
  apply(state.game, 'flag', flag.active, true, 'game.flag');
  // Side-aware value for themes with their own penalty treatment:
  // 'away'/'home' when the game attributed the flag, 'flag' when it did not.
  apply(state.game, 'penaltyFlag', flag.active ? (flag.side || 'flag') : '', true, 'game.penaltyFlag');
  // The penalty being announced (type + offense/defense), read by the
  // reader from the game's own commentary/referee strings ~10 s after the
  // banner. Which TEAM that is follows from possession: offense = the side
  // with the ball. Cleared by the reader ~45 s after it was read.
  const penalty = document.ram?.penalty;
  if (penalty && typeof penalty === 'object' && penalty.type) {
    const possessionSide = state.away.possession === true ? 'away' : (state.home.possession === true ? 'home' : null);
    let team = null;
    if (penalty.side === 'offense') team = possessionSide;
    else if (penalty.side === 'defense' && possessionSide) team = possessionSide === 'away' ? 'home' : 'away';
    const sideWord = penalty.side === 'offense' ? 'OFFENSE' : (penalty.side === 'defense' ? 'DEFENSE' : '');
    apply(state.game, 'penalty', {
      type: String(penalty.type),
      code: penalty.code || null,
      side: penalty.side || null,
      team,
      text: sideWord ? `${String(penalty.type).toUpperCase()} - ${sideWord}` : String(penalty.type).toUpperCase(),
      readAt: penalty.readAt || null,
    }, true, 'game.penalty');
    apply(state.game, 'penaltyType', String(penalty.type), true, 'game.penaltyType');
    apply(state.game, 'penaltySide', penalty.side || null, Boolean(penalty.side), 'game.penaltySide');
    apply(state.game, 'penaltyTeam', team, Boolean(team), 'game.penaltyTeam');
    apply(state.game, 'penaltyText', sideWord ? `${String(penalty.type).toUpperCase()} - ${sideWord}` : String(penalty.type).toUpperCase(), true, 'game.penaltyText');
  }
  // Stat lower-thirds and other ScoreHud text objects (raw pass-through).
  if (Array.isArray(document.ram?.hudTexts) && document.ram.hudTexts.length) {
    apply(state.game, 'hudTexts', document.ram.hudTexts.map((item) => ({
      kind: String(item?.kind || ''),
      texts: Array.isArray(item?.texts) ? item.texts.map(String).slice(0, 8) : [],
      teamSide: item?.teamSide === 'away' || item?.teamSide === 'home' ? item.teamSide : null,
      playerId: Number.isInteger(item?.playerId) ? item.playerId : null,
    })).filter((item) => item.texts.length), true, 'game.hudTexts');
  }
  // Play-call menu state (experimental byte published by the reader).
  if (typeof document.ram?.playCallOpen === 'boolean') {
    apply(state.game, 'playCallOpen', document.ram.playCallOpen, true, 'game.playCallOpen');
  }
  if (fields.length === 0) return null;
  state.meta = {
    source: 'ram',
    ramProcessId: Number(document.process.id),
    ramProfileScope: document.process.profileScope || null,
    ramUpdatedAt: document.updatedAt,
  };
  if (teamIdentityPairValid) {
    state.meta.ramTeamIdentity = {
      away: {
        presentationId: teamIdentityPair.away.presentationId,
        isTeamBuilder: teamIdentityPair.away.isTeamBuilder,
        source: 'ram-scorehud',
      },
      home: {
        presentationId: teamIdentityPair.home.presentationId,
        isTeamBuilder: teamIdentityPair.home.isTeamBuilder,
        source: 'ram-scorehud',
      },
    };
  }
  return { state, fields };
}

function applyRamScoreboardState(screenState) {
  // Manual and mock modes mean the operator is supplying the values, so those
  // values have to survive publication. RAM-only layering rebuilds the state
  // from an empty base and keeps only what RAM confirmed, which silently
  // discarded everything typed into the manual form - that is why "Send these
  // values" appeared to do nothing once the app became RAM-only.
  //
  // Visibility is forced the same way RAM-only mode forces it: in these modes
  // there is no native scorebug to take a visibility cue from, and the operator
  // asking for a value on screen is the cue.
  const recognitionMode = settings.recognition?.mode;
  if (recognitionMode === 'manual' || recognitionMode === 'mock') {
    const screen = screenState && typeof screenState === 'object' ? screenState : {};
    return {
      ...screen,
      meta: {
        ...(screen.meta || {}),
        source: recognitionMode,
        visible: true,
        confidence: 1,
      },
    };
  }
  return applyScoreboardDataSource(
    screenState,
    applyDynastySideCorrection(runtime.ramScoreboardState, runtime.dynasty),
    scoreboardDataSourceMode(),
  );
}

function clearRamScoreboardState() {
  if (!runtime.ramScoreboardState) return;
  runtime.ramScoreboardState = null;
  runtime.ramAppliedFields = [];
  ramScoreboardSignature = '';
  if (scoreboardDataSourceMode() === 'ram') {
    runtime.autoVisible = false;
    applyVisibility('ram-waiting');
  }
  publishCurrentScoreboardState();
  broadcastControlStatus();
  logMessage(scoreboardDataSourceMode() === 'ram'
    ? 'RAM scoreboard data became unavailable; RAM-only mode is waiting for the game reader.'
    : 'RAM scoreboard data became unavailable; the visible bug returned to screen-reader values.');
}

// Test 2 round 2: write the halftime numbers where the reader looks for
// them; it searches the game heap and appends stats-search.jsonl.
function requestStatsSearch(payload = {}) {
  const request = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (!/^[a-z_]{1,32}$/.test(key)) continue;
    const number = Number(value);
    if (Number.isInteger(number) && Math.abs(number) < 100000) request[key] = number;
  }
  if (!Object.keys(request).length) throw new Error('No numbers to search for.');
  const folder = dataExportRootPath();
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, 'probe-request.json');
  fs.writeFileSync(target, JSON.stringify({ ...request, requestedAt: new Date().toISOString() }));
  logMessage(`Memory search requested for ${Object.keys(request).length} box-score numbers (results: stats-search.jsonl).`);
  return { folder, count: Object.keys(request).length };
}

// EXPERIMENTAL play-call state from the reader (ram.playCallOpen). When the
// user opts in, the bug hides the moment the play-call menu opens and
// returns at the snap. Off by default until testers confirm the signal.
function notePlayCallState(document) {
  const open = document?.ram?.playCallOpen;
  const next = open === true ? true : (open === false ? false : null);
  if (next === runtime.playCallOpen) return;
  runtime.playCallOpen = next;
  if (settings.overlay?.hideDuringPlayCall !== true) return;
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (next === true) {
    // Immediate: no show/hide delay for this transition.
    visibilityTransitionGate.cancel();
    if (overlayWindow.isVisible()) overlayWindow.hide();
    runtime.lastVisibilityReason = 'play-call-open';
    broadcastStatus();
  } else {
    visibilityTransitionGate.cancel();
    if (desiredOverlayVisibility() && !overlayWindow.isVisible()) {
      positionOverlay();
      overlayWindow.showInactive();
    }
    runtime.lastVisibilityReason = 'play-call-closed';
    broadcastStatus();
  }
}

function pollRamScoreboardState() {
  if (!usesRamReader(scoreboardDataSourceMode())) return;
  try {
    const liveDocument = ramLiveDocumentReader.read(ramLiveDataPath());
    try { notePlayCallState(liveDocument); } catch { /* experimental */ }
    // The hold runs before the signature compare so a one-tick withhold
    // (value -> null -> value) neither blanks the bug nor publishes churn.
    const freshPayload = applyRamFieldHold(
      ramScoreboardPayload(liveDocument),
      ramFieldHoldCache,
      Date.now(),
    );
    // Whole-document continuity: a same-game re-locate keeps the last good
    // state on screen; a new game, a new process, or a dead reader clears it.
    const held = applyRamDocumentHold(ramDocumentHold, freshPayload, {
      nowMs: Date.now(),
      readerStatusText: readJsonFile(ramReaderStatusPath(), {}).message,
      gameProcessId: runtime.game?.pid ?? null,
      readerAlive: Boolean(ramReaderProcess && ramReaderProcess.exitCode === null && !ramReaderProcess.killed),
    });
    const payload = held.payload;
    if (!payload) {
      if (held.reason === 'new-game' || held.reason === 'process') clearRamFieldHold(ramFieldHoldCache);
      clearRamScoreboardState();
      return;
    }
    // Timeouts hold until replaced - except across the half, when both teams
    // get three back and a held first-half count would be wrong.
    const quarterNow = Number(payload.state?.game?.quarter);
    if (Number.isInteger(quarterNow)) {
      if (Number.isInteger(lastRamQuarter) && lastRamQuarter <= 2 && quarterNow >= 3) {
        forgetRamFieldHold(ramFieldHoldCache, ['away.timeouts', 'home.timeouts']);
      }
      lastRamQuarter = quarterNow;
    }
    if (held.held) {
      // Nothing new to publish - the previous state is already on screen.
      lastRamDataAtMs = Date.now();
      // Except the flag: its ~8 s banner window keeps ticking while the
      // reader is quiet (the game blanks its scorebug during the penalty
      // presentation, which is exactly when documents get held). Without
      // this, the held payload kept flag=true on the bug indefinitely.
      const heldGame = payload.state?.game;
      if (heldGame && (heldGame.flag === true || heldGame.penaltyFlag)) {
        const flagNow = flagStateFromMessages(liveDocument?.ram?.recentMessages, Date.now());
        if (!flagNow.active) {
          heldGame.flag = false;
          heldGame.penaltyFlag = '';
          publishCurrentScoreboardState();
        }
      }
      return;
    }
    // A different game in the same process: force a fresh locate so the
    // previous matchup's names can never carry over into the new one.
    if (runtime.ramScoreboardState && looksLikeNewGame(runtime.ramScoreboardState, payload.state)
      && Date.now() - lastAutoNewGameAtMs > 60000) {
      lastAutoNewGameAtMs = Date.now();
      logMessage('New game detected (1st quarter, 0-0, full clock after a game in progress); re-reading everything.');
      // Automatic path: keep the reader's cache. Within one game session the
      // core scoreboard block stays put and the cache probe verifies before
      // adopting, so re-attaching from cache takes ~1s instead of a full
      // locate. Only the manual New game button purges (the escape hatch).
      autoNewGameReacquire = true;
      runControlAction('fresh-read').catch(() => {}).finally(() => { autoNewGameReacquire = false; });
      return;
    }
    const signature = JSON.stringify({
      processId: payload.state.meta.ramProcessId,
      away: payload.state.away,
      home: payload.state.home,
      game: payload.state.game,
    });
    // Any valid payload proves the reader is alive - ramScoreboardPayload
    // already rejected documents older than 20 seconds, so reaching here means
    // the reader wrote the file recently. Refreshing liveness only when the
    // VALUES changed was the bug: a paused game publishes identical values for
    // minutes, the watchdog read that as "no data for 90s" and killed a healthy
    // reader, and the scorebug vanished until play resumed and re-acquired.
    lastRamDataAtMs = Date.now();
    consecutiveRamRecoveries = 0;
    ramQuietNoted = false;
    if (signature === ramScoreboardSignature) return;
    const firstRamState = !runtime.ramScoreboardState;
    ramScoreboardSignature = signature;
    runtime.ramScoreboardState = payload.state;
    runtime.ramAppliedFields = payload.fields;
    if (scoreboardDataSourceMode() === 'ram') {
      runtime.autoVisible = true;
      applyVisibility('ram-live');
    }
    publishCurrentScoreboardState();
    broadcastControlStatus();
    if (firstRamState) logMessage(`Visible scorebug switched to RAM data (${payload.fields.length} fields).`);
  } catch (error) {
    clearRamScoreboardState();
    logMessage(`RAM scoreboard bridge could not read live data: ${error.message}`);
  }
}

function startRamScoreboardBridge() {
  if (ramScoreboardTimer) return;
  pollRamScoreboardState();
  ramScoreboardTimer = setInterval(pollRamScoreboardState, 100);
  startRamReaderHealthWatch();
  ramScoreboardTimer.unref?.();
  startRamFileWatch();
  startRamProblemWatch();
}

// Push instead of poll: the reader atomically replaces live-game-data.json
// on every publish, and waiting for the next 100ms poll tick added up to
// 100ms of pure latency to every field on the scorebug. The watcher reacts
// the instant the file lands; the interval above stays as the safety net,
// so a watcher failure costs nothing but the speed-up.
function startRamFileWatch() {
  if (ramFileWatcher) return;
  try {
    fs.mkdirSync(dataExportRootPath(), { recursive: true });
    ramFileWatcher = fs.watch(dataExportRootPath(), (eventType, filename) => {
      if (filename !== 'live-game-data.json') return;
      // Coalesce bursts (replace fires several events) into one poll.
      if (ramWatchPollScheduled) return;
      ramWatchPollScheduled = true;
      setTimeout(() => {
        ramWatchPollScheduled = false;
        pollRamScoreboardState();
      }, 0);
    });
    ramFileWatcher.on?.('error', () => {
      try { ramFileWatcher?.close(); } catch { }
      ramFileWatcher = null;
    });
  } catch {
    // Polling continues to carry the bridge alone.
    ramFileWatcher = null;
  }
}

function stopRamScoreboardBridge() {
  stopRamReaderHealthWatch();
  if (ramScoreboardTimer) clearInterval(ramScoreboardTimer);
  ramScoreboardTimer = null;
  try { ramFileWatcher?.close(); } catch { }
  ramFileWatcher = null;
  ramWatchPollScheduled = false;
  ramLiveDocumentReader.clear();
  runtime.ramScoreboardState = null;
  runtime.ramAppliedFields = [];
  ramScoreboardSignature = '';
}

function scheduleRamReaderRestart() {
  if (shuttingDown || ramReaderRestartTimer || process.platform !== 'win32'
    || !usesRamReader(scoreboardDataSourceMode())) return;
  ramReaderRestartTimer = setTimeout(() => {
    ramReaderRestartTimer = null;
    startRamReaderService();
  }, 2000);
  ramReaderRestartTimer.unref?.();
}

function startRamReaderService() {
  if (process.platform !== 'win32' || shuttingDown || !usesRamReader(scoreboardDataSourceMode())) return false;
  const seedMode = scoreboardDataSourceMode() === 'ram' ? 'none' : 'screen';
  if (ramReaderProcess && ramReaderProcess.exitCode === null && !ramReaderProcess.killed) {
    if (ramReaderSeedMode === seedMode) return true;
    stopRamReaderService();
  }
  const executable = unpackedResource(path.join('ram-reader', 'CollegeFB27RamReader.exe'));
  const profile = unpackedResource(path.join('ram-reader', 'ram-live-profile.json'));
  if (!fs.existsSync(executable) || !fs.existsSync(profile)) {
    logMessage('Bundled read-only RAM reader is missing; screen reading will continue normally.');
    return false;
  }
  fs.mkdirSync(dataExportRootPath(), { recursive: true });
  const seedPath = seedMode === 'screen'
    ? path.join(dataExportRootPath(), 'live-screen-scoreboard.json')
    : path.join(dataExportRootPath(), 'ram-reader-no-screen-seed.json');
  lastRamReaderStartAtMs = Date.now();
  const readerArgs = [
    '--service',
    seedPath,
    ramReaderStatusPath(),
    String(process.pid),
  ];
  // Madden mode is opt-in and experimental; without it the reader's CFB27
  // behaviour is bit-for-bit unchanged.
  if (gameTitle() === 'madden27') readerArgs.push('--game', 'madden27');
  const child = spawn(executable, readerArgs, {
    windowsHide: true,
    stdio: 'ignore',
  });
  ramReaderProcess = child;
  ramReaderSeedMode = seedMode;
  child.once('spawn', () => {
    logMessage(`Read-only RAM reader started inside the scorebug app (PID ${child.pid}).`);
    broadcastControlStatus();
  });
  // Alive for a while = a real launch; clear the blocked-reader signal.
  setTimeout(() => {
    if (ramReaderProcess === child && child.exitCode === null) {
      readerLaunchFailures = 0;
      readerLaunchError = null;
      scheduleDiagnosisRefresh();
    }
  }, 4000).unref?.();
  child.once('error', (error) => {
    if (ramReaderProcess === child) {
      ramReaderProcess = null;
      ramReaderSeedMode = null;
    }
    readerLaunchFailures += 1;
    readerLaunchError = error.message;
    logMessage(`Read-only RAM reader could not start: ${error.message}`);
    scheduleRamReaderRestart();
    scheduleDiagnosisRefresh();
  });
  child.once('exit', (code) => {
    if (ramReaderProcess === child) {
      ramReaderProcess = null;
      ramReaderSeedMode = null;
    }
    // Dying inside a second of starting, repeatedly, is the antivirus /
    // app-control signature; a long-lived reader exiting is not.
    if (Date.now() - lastRamReaderStartAtMs < 1500) {
      readerLaunchFailures += 1;
      readerLaunchError = readerLaunchError || `exited immediately (code ${code})`;
      scheduleDiagnosisRefresh();
    } else {
      readerLaunchFailures = 0;
      readerLaunchError = null;
    }
    if (!shuttingDown) {
      logMessage(`Read-only RAM reader stopped${code === null ? '' : ` (${code})`}; restarting automatically.`);
      scheduleRamReaderRestart();
    }
    broadcastControlStatus();
  });
  return true;
}

function stopRamReaderService() {
  if (ramReaderRestartTimer) clearTimeout(ramReaderRestartTimer);
  ramReaderRestartTimer = null;
  const child = ramReaderProcess;
  ramReaderProcess = null;
  ramReaderSeedMode = null;
  if (!child) return;
  child.removeAllListeners();
  try { child.kill(); } catch { }
}

// Force the reader to drop everything and locate the game again. Used by the
// Fresh read button and hotkey, and by the watchdog below.
function reacquireRamReader(reason) {
  if (!usesRamReader(scoreboardDataSourceMode())) return false;
  lastRamDataAtMs = Date.now();
  lastRamRecoveryAtMs = Date.now();
  clearRamDocumentHold(ramDocumentHold);
  clearRamFieldHold(ramFieldHoldCache);
  // A manual re-read means "this is a different game": drop the reader's
  // cached profile so it locates everything fresh instead of re-adopting
  // addresses that still hold the previous matchup.
  if (!autoNewGameReacquire && /new game|fresh read/i.test(String(reason || ''))) {
    try { fs.unlinkSync(path.join(dataExportRootPath(), 'ram-live-profile-cache.json')); } catch { }
    try { fs.unlinkSync(ramLiveDataPath()); } catch { }
  }
  clearRamScoreboardState();
  stopRamReaderService();
  startRamReaderService();
  startRamScoreboardBridge();
  logMessage(`RAM reader re-acquiring the game (${reason}).`);
  return true;
}

function watchRamReaderHealth() {
  if (!usesRamReader(scoreboardDataSourceMode()) || !runtime.started) return;
  const now = Date.now();
  // Nothing has arrived yet this session: start the clock rather than treating
  // a cold start as a failure.
  if (!lastRamDataAtMs) { lastRamDataAtMs = now; return; }
  const staleFor = now - lastRamDataAtMs;
  if (staleFor < RAM_DATA_STALE_MS) return;
  // Still inside its acquisition window: leave it alone.
  if (lastRamReaderStartAtMs && now - lastRamReaderStartAtMs < RAM_READER_GRACE_MS) return;
  // No live data is not the same as a dead reader. The reader heartbeats
  // its status file every tick even while the scoreboard is off screen
  // (halftime, replays, menus, the play-call screen). A fresh heartbeat
  // means it is alive and looking - restarting it would only throw away
  // its bindings and blank the bug for the re-locate.
  const heartbeat = readJsonFile(ramReaderStatusPath(), {});
  const heartbeatAgeMs = now - Date.parse(heartbeat?.updatedAt || '');
  if (heartbeat?.running && Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs < RAM_HEARTBEAT_STALE_MS) {
    if (staleFor > RAM_DATA_STALE_MS && !ramQuietNoted) {
      ramQuietNoted = true;
      logMessage(`RAM reader alive but no live scoreboard for ${Math.round(staleFor / 1000)}s (${heartbeat.message || 'no status'}); keeping the last state, not restarting.`);
    }
    return;
  }
  ramQuietNoted = false;
  const cooldown = consecutiveRamRecoveries >= RAM_RECOVERY_ATTEMPTS_BEFORE_BACKOFF
    ? RAM_RECOVERY_BACKOFF_MS
    : RAM_RECOVERY_COOLDOWN_MS;
  if (now - lastRamRecoveryAtMs < cooldown) return;
  consecutiveRamRecoveries += 1;
  logMessage(`RAM reader published nothing for ${Math.round(staleFor / 1000)}s; restarting it `
    + `(attempt ${consecutiveRamRecoveries}).`);
  reacquireRamReader('no data');
}

function startRamReaderHealthWatch() {
  if (ramReaderHealthTimer) return;
  ramReaderHealthTimer = setInterval(watchRamReaderHealth, 5000);
  ramReaderHealthTimer.unref?.();
}

function stopRamReaderHealthWatch() {
  if (ramReaderHealthTimer) clearInterval(ramReaderHealthTimer);
  ramReaderHealthTimer = null;
  lastRamDataAtMs = 0;
  consecutiveRamRecoveries = 0;
}

function applyScoreboardDataSourcePreference({ publish = true, announce = false } = {}) {
  const mode = scoreboardDataSourceMode();
  if (usesRamReader(mode)) {
    startRamReaderService();
    startRamScoreboardBridge();
  } else {
    stopRamScoreboardBridge();
    stopRamReaderService();
  }
  if (publish) publishCurrentScoreboardState();
  if (announce) {
    const detail = mode === 'auto'
      ? 'RAM is preferred with automatic screen-reader fallback.'
      : (mode === 'ram'
        ? 'Only confirmed RAM scoreboard values will be published; the screen still controls visibility.'
        : 'The RAM reader is off and only screen-reader values will be published.');
    logMessage(`Live data source changed to ${scoreboardDataSourceLabel(mode)}. ${detail}`);
  }
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalizedLeft = path.resolve(String(left));
  const normalizedRight = path.resolve(String(right));
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function themeLibraryStore() {
  if (!themeLibrary) themeLibrary = new ThemeLibrary(path.join(app.getPath('userData'), 'theme-library'));
  return themeLibrary;
}

function bundledOriginalThemePath() {
  return resolveThemePath(path.join(app.getAppPath(), 'themes/espn-2013/index.html'));
}

function ensureBundledOriginalThemeInLibrary() {
  const bundledTheme = bundledOriginalThemePath();
  if (!bundledTheme) return null;
  try {
    return themeLibraryStore().importFile(bundledTheme);
  } catch (error) {
    logMessage(`Built-in HTML could not be added to the library: ${error.message}`);
    return null;
  }
}

function currentThemeHash() {
  try {
    return runtime.themePath && fs.existsSync(runtime.themePath)
      ? sha256(fs.readFileSync(runtime.themePath))
      : '';
  } catch {
    return '';
  }
}

function resolveThemeCanvas(themePath, preferred = {}) {
  const resolved = resolveThemePath(themePath);
  if (!resolved) return themeCanvasSize(preferred);
  try {
    const bytes = fs.readFileSync(resolved);
    const metadata = readJsonFile(path.join(path.dirname(resolved), 'theme.json'), {});
    return themeCanvasSize({
      sha256: sha256(bytes),
      canvasWidth: preferred.canvasWidth ?? metadata.canvasWidth,
      canvasHeight: preferred.canvasHeight ?? metadata.canvasHeight,
      compatibility: analyzeThemeHtml(bytes),
    });
  } catch {
    return themeCanvasSize(preferred);
  }
}

function themeUsesAuthoredCanvas(themePath, width, height) {
  const resolved = resolveThemePath(themePath);
  if (!resolved) return false;
  try {
    const authored = analyzeThemeHtml(fs.readFileSync(resolved)).authoredCanvas;
    return Boolean(authored)
      && Math.abs(Number(authored.width) - Number(width)) <= 1
      && Math.abs(Number(authored.height) - Number(height)) <= 1;
  } catch {
    return false;
  }
}

function rememberThemeCanvas(themePath, preferred = {}) {
  const canvas = resolveThemeCanvas(themePath, preferred);
  settings.theme ||= {};
  const changed = settings.theme.canvasWidth !== canvas.width
    || settings.theme.canvasHeight !== canvas.height;
  settings.theme.canvasWidth = canvas.width;
  settings.theme.canvasHeight = canvas.height;
  return { ...canvas, changed };
}

function themeSizingKey(themePath) {
  const resolved = resolveThemePath(themePath);
  if (!resolved) return '';
  try {
    return `sha256:${sha256(fs.readFileSync(resolved)).toLowerCase()}`;
  } catch {
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    return `path:${normalized}`;
  }
}

function themeSizingMap() {
  settings.theme ||= {};
  if (!isPlainObject(settings.theme.sizingByHtml)) settings.theme.sizingByHtml = {};
  return settings.theme.sizingByHtml;
}

function normalizeThemeCrop(value = {}, canvasWidth = DEFAULT_SIZE.width, canvasHeight = DEFAULT_SIZE.height) {
  const width = Math.max(1, Math.round(Number(canvasWidth) || DEFAULT_SIZE.width));
  const height = Math.max(1, Math.round(Number(canvasHeight) || DEFAULT_SIZE.height));
  const minimumVisibleWidth = Math.min(40, width);
  const minimumVisibleHeight = Math.min(24, height);
  const edge = (candidate, maximum) => Math.max(
    0,
    Math.min(maximum, Math.round(Number(candidate) || 0)),
  );
  const left = edge(value?.left, width - minimumVisibleWidth);
  const right = edge(value?.right, width - minimumVisibleWidth - left);
  const top = edge(value?.top, height - minimumVisibleHeight);
  const bottom = edge(value?.bottom, height - minimumVisibleHeight - top);
  return { top, right, bottom, left };
}

function visibleThemeCanvas(layout = runtime.layout) {
  const canvasWidth = Number(layout?.canvasWidth) || DEFAULT_SIZE.width;
  const canvasHeight = Number(layout?.canvasHeight) || DEFAULT_SIZE.height;
  const crop = normalizeThemeCrop(layout?.crop, canvasWidth, canvasHeight);
  return {
    width: Math.max(40, canvasWidth - crop.left - crop.right),
    height: Math.max(24, canvasHeight - crop.top - crop.bottom),
    crop,
  };
}

function currentThemeSizingSnapshot() {
  const canvasWidth = clampInteger(
    runtime.layout?.canvasWidth ?? settings.theme?.canvasWidth,
    DEFAULT_SIZE.width,
    160,
    5000,
  );
  const canvasHeight = clampInteger(
    runtime.layout?.canvasHeight ?? settings.theme?.canvasHeight,
    DEFAULT_SIZE.height,
    32,
    3000,
  );
  const scale = Math.min(2, Math.max(0.1, Number(runtime.layout?.scale ?? settings.overlay?.scale) || 0.5));
  // Derive scaleAt2160 from the on-screen scale instead of trusting a runtime
  // copy that a resize gesture may not have refreshed - the profile must
  // describe what the user is looking at.
  const scaleAt2160 = Math.min(4, Math.max(0.1, scaleAt2160FromEffective(
    scale,
    normalizeOutputResolution(settings.overlay?.outputResolution),
    scale,
  )));
  const crop = normalizeThemeCrop(
    runtime.layout?.crop ?? settings.theme?.crop,
    canvasWidth,
    canvasHeight,
  );
  return {
    canvasWidth,
    canvasHeight,
    crop,
    scale,
    scaleAt2160,
    // Position is part of a theme's identity too: each HTML remembers its own
    // anchor, offsets, and (when placed by hand) the exact screen placement,
    // so switching themes puts each one back where it was left.
    anchor: typeof runtime.layout?.anchor === 'string'
      ? runtime.layout.anchor
      : (settings.overlay?.anchor || 'bottom-center'),
    marginX: clampInteger(runtime.layout?.right ?? settings.overlay?.marginX, 0, -4000, 4000),
    marginY: clampInteger(runtime.layout?.bottom ?? settings.overlay?.marginY, 0, -4000, 4000),
    positionLocked: Boolean(runtime.positionLocked),
    placement: overlayWindow && !overlayWindow.isDestroyed()
      ? serializePlacement(
        overlayWindow.getBounds(),
        runtime.layout,
        displayForBounds(overlayWindow.getBounds()),
      )
      : null,
    updatedAt: new Date().toISOString(),
  };
}

// Automatic remembering (on switch, on lock, on settings save) never
// overwrites a profile the user saved on purpose ("Save profile" in the
// library pins it): the saved position, size and crop are what come back
// every time that bug is used, no matter what was done to it in between.
function rememberThemeSizing(themePath, sizing = currentThemeSizingSnapshot(), { force = false } = {}) {
  const key = themeSizingKey(themePath);
  if (!key) return false;
  const existing = themeSizingMap()[key];
  if (!force && isPlainObject(existing) && existing.pinned) return false;
  themeSizingMap()[key] = { ...sizing, pinned: force ? true : Boolean(existing?.pinned) };
  return true;
}

function restoreThemeSizing(themePath, preferred = {}, { usePreferredCrop = true } = {}) {
  const saved = themeSizingMap()[themeSizingKey(themePath)];
  // Canvas: an HTML that declares its own canvas always wins - a remembered
  // canvas from an older copy of the file (or from before a re-import) must
  // not shrink or stretch the new art. Only user-set canvases (no authored
  // size) come back from the saved profile.
  let authoredCanvas = null;
  try {
    const resolved = resolveThemePath(themePath);
    if (resolved) authoredCanvas = analyzeThemeHtml(fs.readFileSync(resolved)).authoredCanvas || null;
  } catch { authoredCanvas = null; }
  const canvasSource = authoredCanvas
    ? { canvasWidth: authoredCanvas.width, canvasHeight: authoredCanvas.height }
    : (saved || preferred);
  const canvas = rememberThemeCanvas(themePath, canvasSource);
  // Crop only makes sense against the canvas it was made on. If the saved
  // profile's canvas differs from the one we just chose, its crop is stale.
  const savedCropUsable = isPlainObject(saved?.crop)
    && (!saved.canvasWidth || Math.abs(Number(saved.canvasWidth) - canvas.width) <= 1)
    && (!saved.canvasHeight || Math.abs(Number(saved.canvasHeight) - canvas.height) <= 1);
  settings.theme.crop = normalizeThemeCrop(
    savedCropUsable ? saved.crop : (usePreferredCrop ? preferred?.crop : null),
    canvas.width,
    canvas.height,
  );
  if (isPlainObject(saved)) {
    settings.overlay ||= {};
    settings.overlay.scale = saved.scale;
    // Old profiles could hold a scaleAt2160 from before the last resize.
    // The on-screen scale is the truth; recompute the pair when they
    // disagree so the saved SIZE comes back, not just the position.
    const savedResolution = normalizeOutputResolution(settings.overlay.outputResolution);
    const consistent = scaleAt2160FromEffective(Number(saved.scale), savedResolution, Number(saved.scale));
    settings.overlay.scaleAt2160 = Number.isFinite(Number(saved.scaleAt2160))
      && Math.abs(Number(saved.scaleAt2160) - consistent) <= 0.001
      ? saved.scaleAt2160
      : consistent;
    // Older snapshots carry no position; restore it only when present so the
    // upgrade never moves anything that was not saved by this build.
    if (typeof saved.anchor === 'string' && saved.anchor.includes('-')) {
      settings.overlay.anchor = saved.anchor;
      settings.overlay.marginX = clampInteger(saved.marginX, settings.overlay.marginX ?? 0, -4000, 4000);
      settings.overlay.marginY = clampInteger(saved.marginY, settings.overlay.marginY ?? 0, -4000, 4000);
    }
    if (isPlainObject(saved.placement) && saved.placement.displayId) {
      placementMap()[String(saved.placement.displayId)] = { ...saved.placement };
      settings.overlay.lastDisplayId = String(saved.placement.displayId);
      if (saved.positionLocked !== undefined) {
        runtime.positionLocked = Boolean(saved.positionLocked);
        settings.overlay.positionLocked = runtime.positionLocked;
      }
    }
  }
  return { ...canvas, restored: Boolean(saved) };
}

function themeProfileSummary(theme) {
  const key = `sha256:${String(theme.sha256 || '').toLowerCase()}`;
  const sizing = themeSizingMap()[key];
  const logoPicks = Object.keys(normalizedPreferences(themeLogoPreferenceMap()[key])).length;
  const themeSettings = isPlainObject(settings.theme?.settingsByHtml?.[key]) ? Object.keys(settings.theme.settingsByHtml[key]).length : 0;
  if (!isPlainObject(sizing) && !logoPicks && !themeSettings) return { saved: false };
  return {
    saved: true,
    pinned: Boolean(sizing?.pinned),
    updatedAt: sizing?.updatedAt || null,
    width: sizing?.placement?.width ?? null,
    height: sizing?.placement?.height ?? null,
    x: sizing?.placement?.x ?? null,
    y: sizing?.placement?.y ?? null,
    scale: sizing?.scale ?? null,
    anchor: sizing?.anchor || null,
    positionLocked: sizing?.positionLocked === true,
    logoPicks,
    themeSettings,
  };
}

// ---- Rendered snapshots of each bug (the library preview) ----------------
// A sandboxed static preview cannot run the bug's script, so it shows the
// author's placeholder markup. Instead the app photographs the REAL overlay
// window while a theme is in use and keeps one PNG per HTML.
function themeSnapshotsRoot() {
  return path.join(app.getPath('userData'), 'theme-snapshots');
}

function themeSnapshotPath(sha) {
  const clean = String(sha || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  return clean ? path.join(themeSnapshotsRoot(), `${clean}.png`) : null;
}

function themeSnapshotInfo(sha) {
  const file = themeSnapshotPath(sha);
  try {
    if (!file || !fs.existsSync(file)) return { snapshotUrl: null, snapshotAt: null };
    const stat = fs.statSync(file);
    return {
      snapshotUrl: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`,
      snapshotAt: stat.mtime.toISOString(),
    };
  } catch {
    return { snapshotUrl: null, snapshotAt: null };
  }
}

let themeSnapshotTimer = null;
let themeSnapshotLastAt = 0;
let themeSnapshotBusy = false;
const THEME_SNAPSHOT_MIN_INTERVAL_MS = 30000;

async function captureThemeSnapshot({ force = false } = {}) {
  if (themeSnapshotBusy) return null;
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return null;
  const hash = currentThemeHash();
  if (!hash) return null;
  const state = runtime.scoreboardState || {};
  const hasTeams = Boolean(state.away?.name && state.home?.name);
  if (!force && !hasTeams) return null;
  if (!force && Date.now() - themeSnapshotLastAt < THEME_SNAPSHOT_MIN_INTERVAL_MS) return null;
  themeSnapshotBusy = true;
  try {
    let image = await overlayWindow.webContents.capturePage();
    if (image.isEmpty()) return null;
    // The overlay window is mostly transparent canvas around the bug; trim to
    // the painted artwork so the library card shows the bug, not the air.
    try {
      const trimmed = trimTransparentPng(image.toPNG(), { alphaThreshold: 8, padding: 12 });
      if (trimmed?.buffer && trimmed.width >= 40 && trimmed.height >= 16) image = nativeImage.createFromBuffer(trimmed.buffer);
    } catch { /* keep the untrimmed capture */ }
    const size = image.getSize();
    if (size.width > 900) {
      image = image.resize({ width: 900, height: Math.max(1, Math.round(size.height * 900 / size.width)), quality: 'best' });
    }
    const file = themeSnapshotPath(hash);
    fs.mkdirSync(themeSnapshotsRoot(), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, image.toPNG());
    fs.renameSync(temporary, file);
    themeSnapshotLastAt = Date.now();
    return file;
  } catch (error) {
    console.warn('[overlay] theme snapshot failed:', error.message);
    return null;
  } finally {
    themeSnapshotBusy = false;
  }
}

function scheduleThemeSnapshot(delayMs = 4000) {
  if (themeSnapshotTimer) return;
  themeSnapshotTimer = setTimeout(() => {
    themeSnapshotTimer = null;
    captureThemeSnapshot().catch(() => {});
  }, delayMs);
  themeSnapshotTimer.unref?.();
}

async function snapshotActiveTheme() {
  const file = await captureThemeSnapshot({ force: true });
  if (!file) throw new Error('The scorebug is not on screen right now, so it cannot be photographed.');
  logMessage('Library preview refreshed from the live scorebug.');
  return { themes: listLibraryThemes() };
}

// When an edited HTML is re-imported it gets a new content hash, which used
// to orphan its saved position, size, logo picks and settings. Carry the
// profile of a same-named earlier import forward to the new copy.
function carryThemeProfileForward(newTheme, previousThemes) {
  if (!newTheme?.sha256) return false;
  const newKey = `sha256:${String(newTheme.sha256).toLowerCase()}`;
  if (themeSizingMap()[newKey]) return false;
  const name = String(newTheme.fileName || '').toLowerCase();
  const title = String(newTheme.name || '').toLowerCase();
  const candidates = (previousThemes || [])
    .filter((theme) => theme.sha256 !== newTheme.sha256)
    .filter((theme) => String(theme.fileName || '').toLowerCase() === name || (title && String(theme.name || '').toLowerCase() === title))
    .sort((left, right) => String(right.importedAt || '').localeCompare(String(left.importedAt || '')));
  for (const previous of candidates) {
    const oldKey = `sha256:${String(previous.sha256).toLowerCase()}`;
    const sizing = themeSizingMap()[oldKey];
    const logoPicks = themeLogoPreferenceMap()[oldKey];
    const themeSettings = settings.theme?.settingsByHtml?.[oldKey];
    if (!sizing && !logoPicks && !themeSettings) continue;
    if (sizing) {
      // Position, size and lock carry over; canvas and crop belong to the
      // old file's art and are re-derived from the new HTML.
      const carried = cloneJson(sizing);
      delete carried.canvasWidth;
      delete carried.canvasHeight;
      delete carried.crop;
      themeSizingMap()[newKey] = carried;
    }
    if (logoPicks) themeLogoPreferenceMap()[newKey] = cloneJson(logoPicks);
    if (themeSettings) {
      settings.theme.settingsByHtml ||= {};
      settings.theme.settingsByHtml[newKey] = cloneJson(themeSettings);
    }
    const layouts = normalizedLogoLayouts(settings.teamLogos?.layouts);
    for (const [key, value] of Object.entries(layouts)) {
      if (key.startsWith(`${oldKey}::`)) {
        const moved = `${newKey}${key.slice(oldKey.length)}`;
        if (!layouts[moved]) layouts[moved] = value;
      }
    }
    settings.teamLogos ||= {};
    settings.teamLogos.layouts = layouts;
    const colors = normalizeScorebugColors(settings.scorebugColors);
    const oldId = String(previous.id || '').toLowerCase();
    const newId = String(newTheme.id || '').toLowerCase();
    if (oldId && newId && Array.isArray(colors.rules)) {
      const extra = colors.rules
        .filter((rule) => rule.scope === 'theme' && String(rule.themeId || '').toLowerCase() === oldId)
        .map((rule) => ({ ...rule, themeId: newId }));
      if (extra.length) {
        settings.scorebugColors = { ...colors, rules: [...colors.rules, ...extra] };
      }
    }
    const snapshot = themeSnapshotPath(previous.sha256);
    const target = themeSnapshotPath(newTheme.sha256);
    try { if (snapshot && target && fs.existsSync(snapshot) && !fs.existsSync(target)) fs.copyFileSync(snapshot, target); } catch { /* preview only */ }
    persistSettings();
    logMessage(`Profile carried forward from the earlier "${previous.name}" import (position, size, logo picks, settings).`);
    return true;
  }
  return false;
}

function saveThemeProfile(id) {
  const theme = themeLibraryStore().get(String(id || ''));
  const active = runtime.themePath && (samePath(theme.path, runtime.themePath) || theme.sha256 === currentThemeHash());
  if (!active) throw new Error('Use this bug first, place it, then save its profile.');
  rememberThemeSizing(runtime.themePath, { ...currentThemeSizingSnapshot(), updatedAt: new Date().toISOString() }, { force: true });
  persistSettings();
  captureThemeSnapshot({ force: true }).catch(() => {});
  logMessage(`Profile saved for ${theme.name}: position, size, crop and settings are pinned to this bug.`);
  return { themes: listLibraryThemes(), status: publicStatus() };
}

function clearThemeProfile(id) {
  const theme = themeLibraryStore().get(String(id || ''));
  const key = `sha256:${String(theme.sha256).toLowerCase()}`;
  delete themeSizingMap()[key];
  delete themeLogoPreferenceMap()[key];
  if (settings.theme?.settingsByHtml) delete settings.theme.settingsByHtml[key];
  persistSettings();
  logMessage(`Profile cleared for ${theme.name}.`);
  return { themes: listLibraryThemes(), status: publicStatus() };
}

function publicLibraryTheme(theme, activeHash = currentThemeHash()) {
  const preview = pathToFileURL(theme.path);
  preview.searchParams.set('cfb27LibraryPreview', theme.sha256 || String(Date.now()));
  return {
    ...theme,
    previewUrl: preview.href,
    profile: themeProfileSummary(theme),
    ...themeSnapshotInfo(theme.sha256),
    active: Boolean(
      runtime.themePath
      && (samePath(theme.path, runtime.themePath)
        || (activeHash && theme.sha256 === activeHash)),
    ),
  };
}

function listLibraryThemes() {
  const activeHash = currentThemeHash();
  return themeLibraryStore().list().map((theme) => publicLibraryTheme(theme, activeHash));
}

function loadSettings() {
  defaults = readJsonFile(path.join(app.getAppPath(), 'config', 'defaults.json'), {});
  getReaderProfileCatalog();
  const destination = settingsPath();
  const legacySettingsPath = path.join(LEGACY_USER_DATA_PATH, 'settings.json');
  const hasStableSettings = fs.existsSync(destination);
  const shouldMigrate = !hasStableSettings
    && path.resolve(legacySettingsPath) !== path.resolve(destination)
    && fs.existsSync(legacySettingsPath);
  const saved = hasStableSettings
    ? readJsonFile(destination, {})
    : (shouldMigrate ? readJsonFile(legacySettingsPath, {}) : {});
  const loadedSchemaVersion = Number(saved.schemaVersion) || 0;
  const settingsSchemaMigration = loadedSchemaVersion < SETTINGS_SCHEMA_VERSION;
  const migratedResolutionSettings = migrateSavedResolutionSettings(saved);
  // Schema v1 used game.anchor as the outer calibration box. Preserve a
  // customized legacy anchor before v2 defaults add a dedicated readRegion.
  if (saved.capture && !saved.capture.readRegion && saved.capture.rois?.['game.anchor']) {
    saved.capture.readRegion = { ...saved.capture.rois['game.anchor'] };
    saved.capture.roiSpace ||= 'capture';
  }
  const legacyProfileMigration = loadedSchemaVersion < 4
    ? migrateLegacyCaptureToProfile(
      getReaderProfileCatalog(),
      saved.capture || {},
      saved.overlay?.outputResolution,
      saved.capture?.profileOverrides || {},
    )
    : { migrated: false, overrides: saved.capture?.profileOverrides || {} };
  if (legacyProfileMigration.migrated) {
    saved.capture ||= {};
    saved.capture.profileOverrides = legacyProfileMigration.overrides;
  }
  const addedReaderBoxMigration = upgradeLegacyReaderProfileOverrides(
    getReaderProfileCatalog(),
    saved.capture?.profileOverrides || {},
  );
  if (addedReaderBoxMigration.upgradedKeys.length) {
    saved.capture ||= {};
    saved.capture.profileOverrides = addedReaderBoxMigration.overrides;
  }
  const normalizedReadingProfile = normalizeReadingProfile(saved.recognition?.readingProfile);
  const migratedReadingProfile = saved.recognition?.readingProfile !== normalizedReadingProfile;
  saved.recognition ||= {};
  saved.recognition.readingProfile = normalizedReadingProfile;
  const migratedCenteredDonorSettings = migrateCenteredDonorSettings(saved, loadedSchemaVersion);
  migratePickerClearDefault(saved, loadedSchemaVersion);
  settings = deepMerge(defaults, saved);
  settings.dataExtraction ||= {};
  settings.dataExtraction.scoreboardSource = scoreboardDataSourceMode(settings);
  settings.theme ||= {};
  settings.theme.chromaKey = normalizeGreenScreen(settings.theme.chromaKey);
  settings.teamLogos ||= {};
  settings.teamLogos.preferences = normalizedPreferences(settings.teamLogos.preferences);
  settings.teamLogos.custom = normalizedCustomTeamLogos(settings.teamLogos.custom);
  settings.teamLogos.layouts = normalizedLogoLayouts(settings.teamLogos.layouts);
  settings.customTeams = normalizeCustomTeams(settings.customTeams);
  settings.teamPalettes = normalizedTeamPalettes(settings.teamPalettes);
  settings.favoriteTeamId = settings.favoriteTeamId ? String(settings.favoriteTeamId) : null;
  const portableCalibrationRestore = restorePortableReaderCalibration(settings);
  if (!portableCalibrationRestore.valid && portableCalibrationRestore.reason) {
    runtime.support.calibrationRestore = {
      valid: false,
      reason: portableCalibrationRestore.reason,
      code: portableCalibrationRestore.code || null,
      at: new Date().toISOString(),
    };
    logMessage(`Saved reader calibration could not be applied and factory reader boxes may be in use: ${portableCalibrationRestore.reason} Recalibrate from the Calibration panel.`);
  }
  settings.onboarding = normalizeOnboardingState(settings.onboarding);
  settings.overlay = applyResolutionSettings(settings.overlay, defaults.overlay?.scale || 0.5);
  applyActiveReaderProfile(settings);
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  if (shouldMigrate
    || settingsSchemaMigration
    || migratedResolutionSettings
    || legacyProfileMigration.migrated
    || addedReaderBoxMigration.upgradedKeys.length
    || migratedReadingProfile
    || migratedCenteredDonorSettings
    || portableCalibrationRestore.changed) {
    persistSettings();
    console.log(`[overlay] migrated settings: ${destination}`);
  }
  return settings;
}

function persistSettings() {
  const destination = settingsPath();
  const temporary = `${destination}.tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, destination);
}

function sendToControl(channel, payload) {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  controlWindow.webContents.send(channel, payload);
}

function logMessage(message) {
  const text = String(message);
  const timestamp = new Date();
  const line = `[${timestamp.toISOString()}] ${text}`;
  console.log(line);
  sendToControl('scoreboard:log', text);
  try {
    const directory = logsPath();
    fs.mkdirSync(directory, { recursive: true });
    const date = timestamp.toISOString().slice(0, 10);
    fs.appendFileSync(path.join(directory, `overlay-${date}.log`), `${line}\n`, 'utf8');
  } catch (error) {
    console.warn('[overlay] could not write log:', error.message);
  }
}

function appendValidationEvent(event) {
  const timestamp = new Date(Number(event.timestampMs) || Date.now());
  const directory = logsPath();
  fs.mkdirSync(directory, { recursive: true });
  const date = timestamp.toISOString().slice(0, 10);
  fs.appendFileSync(
    path.join(directory, `validation-${date}.jsonl`),
    `${JSON.stringify(event)}\n`,
    'utf8',
  );
}

function getValidationSession() {
  if (!validationSession) {
    validationSession = new RuntimeValidationSession({
      writeEvent: appendValidationEvent,
      onWriteError: (error) => console.warn('[overlay] could not write validation evidence:', error.message),
    });
  }
  return validationSession;
}

function beginValidationSession() {
  const readerProfile = resolvedReaderProfile();
  const session = getValidationSession().begin({
    version: app.getVersion(),
    packaged: app.isPackaged,
    executable: process.execPath,
    recognition: {
      mode: settings.recognition?.mode || 'manual',
      minimumConfidence: settings.recognition?.minimumConfidence ?? null,
      stableFrames: settings.recognition?.stableFrames ?? null,
      clockOffsetSeconds: settings.recognition?.clockOffsetSeconds ?? 0,
    },
    capture: {
      fps: settings.capture?.fps ?? null,
      profileKey: readerProfile.key,
      profileOrigin: readerProfile.origin,
      expectedWidth: readerProfile.profile.captureWidth,
      expectedHeight: readerProfile.profile.captureHeight,
      readRegion: readerProfile.profile.readRegion,
      rois: readerProfile.profile.rois,
    },
    theme: {
      path: runtime.themePath,
      canvasWidth: settings.theme?.canvasWidth ?? null,
      canvasHeight: settings.theme?.canvasHeight ?? null,
    },
    overlay: {
      layout: runtime.layout,
      positionLocked: runtime.positionLocked,
    },
  });
  logMessage(`Validation session started: ${session.sessionId} (app v${app.getVersion()}).`);
  return session;
}

function finishValidationSession(reason) {
  const summary = validationSession?.end(reason);
  if (summary) {
    logMessage(`Validation session ended: ${summary.sessionId}; ${summary.recognitionFrames} reads, ${summary.visibleFrames} visible, ${summary.downTransitions} down changes, ${summary.errors} reader errors.`);
  }
  return summary;
}

// A per-field OCR summary small enough to broadcast with every status update
// so the control center can show which fields read and which were rejected.
// The full diagnostics (visual evidence, identity, timings) stay report-only.
function leanRecognitionDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  const fields = {};
  for (const [binding, value] of Object.entries(diagnostics.fields || {})) {
    fields[binding] = {
      rawText: String(value?.rawText ?? '').slice(0, 60),
      valid: Boolean(value?.valid),
      confidence: Number(value?.confidence) || 0,
    };
  }
  return {
    capturedAt: Number(diagnostics.capturedAt) || null,
    fields,
    visualError: diagnostics.visual?.error ? String(diagnostics.visual.error).slice(0, 200) : null,
    result: diagnostics.result
      ? {
        visible: Boolean(diagnostics.result.visible),
        anchorPresent: Boolean(diagnostics.result.anchorPresent),
        accepted: Array.isArray(diagnostics.result.accepted) ? diagnostics.result.accepted.length : 0,
        rejected: Array.isArray(diagnostics.result.rejected) ? diagnostics.result.rejected.length : 0,
      }
      : null,
  };
}

function publicStatus() {
  const actualVisible = Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
  const readerProfile = resolvedReaderProfile();
  const readerBehavior = resolveReaderBehavior(settings);
  return {
    version: app.getVersion(),
    started: runtime.started,
    automatic: runtime.automaticEnabled,
    game: { ...runtime.game },
    capture: { ...runtime.capture },
    readerProfile: {
      key: readerProfile.key,
      origin: readerProfile.origin,
      expectedWidth: readerProfile.profile.captureWidth,
      expectedHeight: readerProfile.profile.captureHeight,
      fallbackReason: readerProfile.fallbackReason || null,
      userDataMode: USER_DATA_LOCATION.mode,
    },
    readerBehavior: {
      key: readerBehavior.key,
      label: readerBehavior.label,
      description: readerBehavior.description,
      experimental: readerBehavior.experimental,
    },
    reader: { ...runtime.reader },
    support: {
      lastReaderError: runtime.support.lastReaderError,
      calibrationRestore: runtime.support.calibrationRestore,
      lastRecognitionAt: runtime.support.lastRecognitionAt,
      latestRecognition: leanRecognitionDiagnostics(runtime.support.lastRecognitionDiagnostics),
    },
    validation: validationSession?.snapshot() || null,
    dataExtraction: automaticExtractionEnabled()
      ? automaticDataExtractor().snapshot()
      : { enabled: false, sessionPath: dataExportRootPath(), counts: {} },
    ramReader: ramReaderSnapshot(),
    overlay: {
      visible: actualVisible,
      requestedVisible: runtime.requestedVisible,
      autoVisible: runtime.autoVisible,
      lastVisibilityReason: runtime.lastVisibilityReason,
      visibilityMode: resolveVisibilityMode({
        started: runtime.started,
        automaticEnabled: runtime.automaticEnabled,
        requestedVisible: runtime.requestedVisible,
        autoVisible: runtime.autoVisible,
        actualVisible,
      }),
      editMode: runtime.editMode,
      quickSettingsOpen: runtime.quickSettingsOpen,
      positionLocked: runtime.positionLocked,
      placementMode: runtime.editMode ? 'move' : (runtime.positionLocked ? 'locked' : 'follow-game'),
      clickThrough: runtime.quickSettingsOpen
        || (!runtime.editMode && settings.overlay?.clickThrough !== false),
      themePath: runtime.themePath,
      themeName: activeThemeDisplayName(),
      bounds: overlayBoundsForStatus(),
      dynasty: dynastyStatusSummary(),
      chromaKey: normalizeGreenScreen(settings.theme?.chromaKey),
      layout: { ...runtime.layout },
    },
  };
}

function activeThemeDisplayName() {
  if (!runtime.themePath) return '';
  try {
    const hash = currentThemeHash();
    const entry = themeLibraryStore().list().find((theme) => samePath(theme.path, runtime.themePath) || (hash && theme.sha256 === hash));
    if (entry?.name) return entry.name;
  } catch { /* fall through */ }
  return path.basename(runtime.themePath, path.extname(runtime.themePath));
}

function overlayBoundsForStatus() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null;
  try {
    const bounds = overlayWindow.getBounds();
    const displays = screen.getAllDisplays();
    const display = displayForBounds(bounds);
    const index = displays.findIndex((candidate) => candidate.id === display?.id);
    return {
      ...bounds,
      displayLabel: displays.length > 1 && index >= 0 ? `display ${index + 1}` : '',
    };
  } catch {
    return null;
  }
}

function broadcastControlStatus() {
  sendToControl('scoreboard:status', publicStatus());
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeLayout(input = {}) {
  const anchor = ['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left'].includes(input.anchor)
    ? input.anchor
    : runtime.layout.anchor;

  // Width and height describe ONE box (the bug's visible canvas at a scale),
  // so they must be clamped together. Clamping them separately turned a
  // 3840x158 request into 2400x158 - a squashed window the bug then
  // overflowed and got cropped in. Shrink both by the same factor.
  const MAX_WIDTH = 3840;
  const MAX_HEIGHT = 2160;
  let width = Number(input.width);
  let height = Number(input.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    && (width > MAX_WIDTH || height > MAX_HEIGHT)) {
    const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
    width *= ratio;
    height *= ratio;
  }
  return {
    anchor,
    right: clampInteger(input.right, runtime.layout.right, -4000, 4000),
    bottom: clampInteger(input.bottom, runtime.layout.bottom, 0, 4000),
    width: clampInteger(width, runtime.layout.width, 32, MAX_WIDTH),
    height: clampInteger(height, runtime.layout.height, 32, MAX_HEIGHT),
  };
}

function normalizeBounds(input) {
  if (!input || typeof input !== 'object') return null;

  let x = Number(input.x);
  let y = Number(input.y);
  let width = Number(input.width);
  let height = Number(input.height);

  if (![x, y, width, height].every(Number.isFinite) || width < 320 || height < 240) {
    return null;
  }

  if (input.coordinateSpace === 'physical') {
    const probe = {
      x: Math.round(x + width / 2),
      y: Math.round(y + height / 2),
    };
    const display = screen.getDisplayNearestPoint(probe);
    const scale = Number(display.scaleFactor) || 1;
    x /= scale;
    y /= scale;
    width /= scale;
    height /= scale;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    coordinateSpace: 'dip',
    visible: input.visible !== false,
    foreground: input.foreground !== false,
    updatedAt: Date.now(),
  };
}

function isLocalHtml(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  const resolved = path.resolve(candidate.replace(/^"|"$/g, ''));
  if (!['.html', '.htm'].includes(path.extname(resolved).toLowerCase())) return false;
  try {
    return fs.statSync(resolved).isFile();
  } catch {
    return false;
  }
}

function resolveThemePath(candidate) {
  if (isLocalHtml(candidate)) return path.resolve(candidate.replace(/^"|"$/g, ''));
  return null;
}

function findDefaultTheme() {
  const fromArgs = process.argv.find((arg) => arg.startsWith('--theme='));
  const candidates = [
    fromArgs ? fromArgs.slice('--theme='.length) : null,
    process.env.CFB27_SCOREBOARD_THEME,
    path.join(app.getPath('downloads'), 'Football Scorebug espn 2013.html'),
  ];

  return candidates.map(resolveThemePath).find(Boolean) || null;
}

function assertOfflineStandaloneTheme(themePath) {
  const compatibility = analyzeThemeHtml(fs.readFileSync(themePath));
  if (compatibility.canUse) return compatibility;
  const dependencies = [
    ...(compatibility.localDependencies || []),
    ...(compatibility.remoteDependencies || []),
  ];
  const detail = dependencies.slice(0, 2).join(', ');
  throw new Error(
    `Imported scoreboard HTML must be one self-contained Standalone HTML file${detail ? `. Blocked dependency: ${detail}` : ''}.`,
  );
}

function activateThemeDocument(themePath) {
  if (!themeProtocolController) throw new Error('The protected scoreboard HTML runtime is not ready yet.');
  const compatibility = assertOfflineStandaloneTheme(themePath);
  themeProtocolController.activate(themePath);
  return compatibility;
}

function themeUrl() {
  if (runtime.mockMode || !runtime.themePath) return null;
  return themeProtocolController?.getActiveUrl() || null;
}

function statusSnapshot() {
  const actualVisible = Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
  return {
    requestedVisible: runtime.requestedVisible,
    autoVisible: runtime.autoVisible,
    actualVisible,
    editMode: runtime.editMode,
    quickSettingsOpen: runtime.quickSettingsOpen,
    fullWindowEditor: runtime.quickSettingsOpen,
    cropMode: runtime.cropMode,
    positionLocked: runtime.positionLocked,
    mockMode: runtime.mockMode,
    themePath: runtime.themePath,
    themeUrl: themeUrl(),
    themeRevision: runtime.themeRevision,
    chromaKey: normalizeGreenScreen(settings.theme?.chromaKey),
    gameBounds: runtime.gameBounds,
    layout: { ...runtime.layout },
    lastVisibilityReason: runtime.lastVisibilityReason,
    shortcuts: { ...(settings.hotkeys || defaults.hotkeys || {}) },
  };
}

function sendToOverlay(channel, payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send(channel, payload);
}

function sendToInGameEditor(channel, payload) {
  if (!inGameEditorWindow || inGameEditorWindow.isDestroyed()) return;
  inGameEditorWindow.webContents.send(channel, payload);
}

// The editor state carries logo images (data URLs), so it is large. It used
// to be rebuilt and sent on every status broadcast (~10x/s), which made the
// Ctrl+Alt+O window sluggish. Coalesce pushes and skip unchanged states.
let inGameEditorStateTimer = null;
let inGameEditorStateSignature = '';
function pushInGameEditorState({ immediate = false } = {}) {
  if (!inGameEditorWindow || inGameEditorWindow.isDestroyed()) return;
  const send = () => {
    inGameEditorStateTimer = null;
    if (!inGameEditorWindow || inGameEditorWindow.isDestroyed()) return;
    let state;
    try { state = inGameEditorState(); } catch (error) { console.warn('[editor] state failed:', error.message); return; }
    let signature = '';
    try { signature = JSON.stringify(state); } catch { signature = String(Date.now()); }
    if (signature === inGameEditorStateSignature) return;
    inGameEditorStateSignature = signature;
    inGameEditorWindow.webContents.send('in-game-editor:state', state);
  };
  if (immediate) {
    if (inGameEditorStateTimer) { clearTimeout(inGameEditorStateTimer); inGameEditorStateTimer = null; }
    send();
    return;
  }
  if (inGameEditorStateTimer) return;
  inGameEditorStateTimer = setTimeout(send, 90);
}

function inGameEditorBounds() {
  const candidate = runtime.gameBounds || screen.getPrimaryDisplay().bounds;
  return {
    x: Math.round(Number(candidate?.x) || 0),
    y: Math.round(Number(candidate?.y) || 0),
    width: Math.max(640, Math.round(Number(candidate?.width) || 1920)),
    height: Math.max(360, Math.round(Number(candidate?.height) || 1080)),
  };
}

// Logo choices are part of a scorebug's profile: a pick made while a theme
// is active is saved for THAT HTML (an ESPN bug can use the "E" mark while
// a FOX bug keeps the full logo). Older global picks stay as the fallback.
function themeLogoPreferenceMap() {
  settings.teamLogos ||= {};
  if (!isPlainObject(settings.teamLogos.preferencesByTheme)) settings.teamLogos.preferencesByTheme = {};
  return settings.teamLogos.preferencesByTheme;
}

function effectiveLogoPreferences() {
  const global = normalizedPreferences(settings.teamLogos?.preferences);
  const key = themeSizingKey(runtime.themePath);
  const themed = key ? normalizedPreferences(themeLogoPreferenceMap()[key]) : {};
  return { ...global, ...themed };
}

function writeLogoPreference(teamId, variantId) {
  settings.teamLogos ||= {};
  const key = themeSizingKey(runtime.themePath);
  if (key) {
    const map = themeLogoPreferenceMap();
    const themed = normalizedPreferences(map[key]);
    if (variantId) themed[teamId] = variantId;
    else delete themed[teamId];
    if (Object.keys(themed).length) map[key] = themed;
    else delete map[key];
    return;
  }
  const preferences = normalizedPreferences(settings.teamLogos.preferences);
  if (variantId) preferences[teamId] = variantId;
  else delete preferences[teamId];
  settings.teamLogos.preferences = preferences;
}

function logoChoicesForSide(side) {
  const publishedTeamId = runtime.scoreboardState.meta?.teamAssets?.[side]?.id;
  const asset = publishedTeamId
    ? teamAssetResolver?.resolveTeamId(publishedTeamId)
    : resolveBundledTeamIdentity(
      runtime.scoreboardState[side]?.name,
      runtime.scoreboardState[side]?.rank,
    )?.asset;
  if (!asset) {
    return {
      teamId: null,
      teamName: runtime.scoreboardState[side]?.name || null,
      defaultLabel: null,
      selectedVariantId: null,
      choices: [],
    };
  }
  const choices = teamLogoVariantResolver?.choicesForTeam(asset.id, teamAssetResolver) || [];
  const selected = effectiveLogoPreferences()[String(asset.id)] || null;
  const themeVariantId = runtime.themeLogoLibrary === 'original'
    ? 'original'
    : (runtime.themeLogoLibrary === 'cropped' ? 'default' : null);
  const requestedVariantId = themeVariantId || selected || 'default';
  const activeVariantId = choices.some((choice) => choice.id === requestedVariantId)
    ? requestedVariantId
    : 'default';
  const key = logoLayoutKey(themeSizingKey(runtime.themePath), asset.id, activeVariantId, side);
  const savedLayouts = normalizedLogoLayouts(settings.teamLogos?.layouts);
  return {
    teamId: String(asset.id),
    teamName: asset.name,
    defaultLabel: choices[0]?.label || 'Default logo',
    selectedVariantId: activeVariantId === 'default' ? null : activeVariantId,
    activeVariantId,
    themeLogoLibrary: runtime.themeLogoLibrary,
    transform: normalizeLogoTransform(runtime.logoTransformDrafts.get(key) || savedLayouts[key]),
    choices,
  };
}

function inGameEditorState() {
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  const editorBounds = inGameEditorBounds();
  return {
    version: app.getVersion(),
    open: Boolean(inGameEditorWindow && !inGameEditorWindow.isDestroyed()),
    gameDetected: Boolean(runtime.game.detected && runtime.gameBounds),
    gameTitle: runtime.game.title || '',
    editorBounds,
    outputBounds: overlayWindow && !overlayWindow.isDestroyed()
      ? overlayWindow.getBounds()
      : anchoredPosition(editorBounds, runtime.layout),
    layout: cloneJson(runtime.layout),
    cropMode: runtime.cropMode,
    chromaKey: normalizeGreenScreen(settings.theme?.chromaKey),
    readerMode: settings.recognition?.mode || 'local-ocr',
    teams: scoreboardTeamOptions(teamAssetResolver),
    customTeams: customTeamsForEditor(),
    favoriteTeamId: settings.favoriteTeamId || null,
    themeSettings: themeSettingsForEditor(),
    teamOverrides: cloneJson(runtime.manualTeamOverrides),
    scorebugColors: scorebugColorState(),
    logoChoices: {
      away: logoChoicesForSide('away'),
      home: logoChoicesForSide('home'),
    },
    logoGeometry: cloneJson(runtime.logoGeometry),
    scoreboard: {
      away: {
        name: runtime.scoreboardState.away?.name || null,
        rank: runtime.scoreboardState.away?.rank ?? null,
        record: runtime.scoreboardState.away?.record || null,
      },
      home: {
        name: runtime.scoreboardState.home?.name || null,
        rank: runtime.scoreboardState.home?.rank ?? null,
        record: runtime.scoreboardState.home?.record || null,
      },
    },
    readerScoreboard: {
      away: {
        name: runtime.readerScoreboardState.away?.name || null,
        rank: runtime.readerScoreboardState.away?.rank ?? null,
      },
      home: {
        name: runtime.readerScoreboardState.home?.name || null,
        rank: runtime.readerScoreboardState.home?.rank ?? null,
      },
    },
  };
}

function broadcastStatus() {
  sendToOverlay('overlay:status', statusSnapshot());
  pushInGameEditorState();
  broadcastControlStatus();
}

function referenceBounds() {
  if (runtime.gameBounds) return runtime.gameBounds;
  return screen.getPrimaryDisplay().bounds;
}

function anchoredPosition(reference, layout) {
  const onRight = layout.anchor.endsWith('right');
  const onCenter = layout.anchor.endsWith('center');
  const onBottom = layout.anchor.startsWith('bottom');
  const leftInset = layout.right;
  const topInset = layout.bottom;

  const x = onCenter
    ? reference.x + ((reference.width - layout.width) / 2) + layout.right
    : onRight
      ? reference.x + reference.width - layout.width - layout.right
      : reference.x + leftInset;
  const y = onBottom
    ? reference.y + reference.height - layout.height - layout.bottom
    : reference.y + topInset;

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: layout.width,
    height: layout.height,
  };
}

function sameBounds(left, right) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function setOverlayBounds(bounds) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const current = overlayWindow.getBounds();
  if (sameBounds(current, bounds)) return;
  runtime.ignorePlacementEventsUntil = Date.now() + 450;
  overlayWindow.setBounds(bounds, false);
}

function placementMap() {
  if (!isPlainObject(settings.overlay?.placements)) {
    settings.overlay ||= {};
    settings.overlay.placements = {};
  }
  return settings.overlay.placements;
}

function displayForBounds(bounds) {
  if (!bounds) return screen.getPrimaryDisplay();
  try {
    return screen.getDisplayMatching(bounds);
  } catch {
    return screen.getDisplayNearestPoint({
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    });
  }
}

function adoptSavedSize(saved) {
  if (!saved) return;
  // Resolution profiles own the window size. Older per-display dimensions are
  // still useful for position migration, but may not override the selected
  // 1080p/1440p/4K size.
  if (settings.overlay?.outputResolution) return;
  // A per-display placement can belong to a DIFFERENT bug (the previous
  // theme on this display). Its pixel size only makes sense for its own
  // canvas; for another canvas, keep the scale and re-derive width/height
  // from this theme's visible canvas so the art is never stretched.
  const currentCanvasWidth = Number(runtime.layout.canvasWidth) || DEFAULT_SIZE.width;
  const currentCanvasHeight = Number(runtime.layout.canvasHeight) || DEFAULT_SIZE.height;
  const savedCanvasWidth = Number(saved.canvasWidth);
  const savedCanvasHeight = Number(saved.canvasHeight);
  const differentCanvas = Number.isFinite(savedCanvasWidth) && Number.isFinite(savedCanvasHeight)
    && (Math.abs(savedCanvasWidth - currentCanvasWidth) > 1 || Math.abs(savedCanvasHeight - currentCanvasHeight) > 1);
  if (differentCanvas) {
    const rawScale = Number(saved.scale);
    const scale = Number.isFinite(rawScale)
      ? Math.min(3, Math.max(0.15, rawScale))
      : Math.min(3, Math.max(0.15, Math.min(Number(saved.width) / savedCanvasWidth, Number(saved.height) / savedCanvasHeight) || runtime.layout.scale || 1));
    const visible = visibleThemeCanvas(runtime.layout);
    runtime.layout = {
      ...runtime.layout,
      width: Math.max(120, Math.round(visible.width * scale)),
      height: Math.max(70, Math.round(visible.height * scale)),
      scale,
    };
    return;
  }
  const canvasWidth = clampInteger(saved.canvasWidth, runtime.layout.canvasWidth || DEFAULT_SIZE.width, 160, 5000);
  const canvasHeight = clampInteger(saved.canvasHeight, runtime.layout.canvasHeight || DEFAULT_SIZE.height, 32, 3000);
  const width = clampInteger(saved.width, runtime.layout.width, 120, 4000);
  const height = clampInteger(saved.height, runtime.layout.height, 70, 3000);
  const numericScale = Number(saved.scale);
  const scale = Number.isFinite(numericScale)
    ? Math.min(3, Math.max(0.15, numericScale))
    : Math.min(width / canvasWidth, height / canvasHeight);
  runtime.layout = {
    ...runtime.layout,
    width,
    height,
    canvasWidth,
    canvasHeight,
    scale,
  };
}

function positionOverlay({ force = false, restoreDisplaySize = true } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!force && (runtime.positionLocked || runtime.editMode)) return;

  const reference = referenceBounds();
  const display = displayForBounds(reference);
  const key = displayKey(display);
  if (restoreDisplaySize && runtime.activeDisplayKey !== key) {
    const saved = placementMap()[key];
    if (saved) {
      adoptSavedSize(saved);
      sendToOverlay('overlay:layout', runtime.layout);
    }
  }
  runtime.activeDisplayKey = key;
  setOverlayBounds(anchoredPosition(reference, runtime.layout));
}

function persistPlacement(bounds, display = displayForBounds(bounds), { preserveScale = false } = {}) {
  const key = displayKey(display);
  const visibleCanvas = visibleThemeCanvas(runtime.layout);
  const measuredScale = Math.min(bounds.width / visibleCanvas.width, bounds.height / visibleCanvas.height);
  const scale = preserveScale && Number.isFinite(Number(runtime.layout.scale))
    ? Number(runtime.layout.scale)
    : measuredScale;
  const outputResolution = normalizeOutputResolution(settings.overlay?.outputResolution);
  const scaleAt2160 = scaleAt2160FromEffective(scale, outputResolution, scale);
  runtime.layout = {
    ...runtime.layout,
    width: bounds.width,
    height: bounds.height,
    scale,
    scaleAt2160,
    outputResolution,
  };
  runtime.activeDisplayKey = key;
  settings.overlay ||= {};
  settings.overlay.positionLocked = runtime.positionLocked;
  settings.overlay.lastDisplayId = key;
  settings.overlay.scale = scale;
  settings.overlay.scaleAt2160 = scaleAt2160;
  settings.overlay.outputResolution = outputResolution;
  placementMap()[key] = serializePlacement(bounds, runtime.layout, display);
  rememberThemeSizing(runtime.themePath);
  persistSettings();
  sendToOverlay('overlay:layout', runtime.layout);
  broadcastStatus();
}

function persistCurrentPlacement() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  persistPlacement(bounds, displayForBounds(bounds));
}

function schedulePlacementSave() {
  if (!runtime.editMode || Date.now() < runtime.ignorePlacementEventsUntil) return;
  if (placementSaveTimer) clearTimeout(placementSaveTimer);
  placementSaveTimer = setTimeout(() => {
    placementSaveTimer = null;
    if (runtime.editMode) persistCurrentPlacement();
  }, 300);
  placementSaveTimer.unref?.();
}

function restoreLockedPlacement() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  const placements = placementMap();
  const requestedKey = String(settings.overlay?.lastDisplayId || '');
  const requestedDisplay = displays.find((display) => displayKey(display) === requestedKey);
  const gameDisplay = runtime.gameBounds ? displayForBounds(runtime.gameBounds) : null;
  const savedFromMissingDisplay = requestedKey ? placements[requestedKey] : null;
  const display = requestedDisplay || gameDisplay || screen.getPrimaryDisplay();
  const key = displayKey(display);
  const saved = placements[key] || savedFromMissingDisplay || null;
  if (saved) adoptSavedSize(saved);
  const fallback = anchoredPosition(display.bounds || display.workArea, runtime.layout);
  const sizedSaved = saved && settings.overlay?.outputResolution
    ? resizeBoundsAroundAnchor(
      saved,
      runtime.layout.width,
      runtime.layout.height,
      runtime.layout.anchor,
    )
    : saved;
  const bounds = sanitizeBounds(sizedSaved, display, fallback);
  const visibleForScale = visibleThemeCanvas(runtime.layout);
  runtime.layout = {
    ...runtime.layout,
    width: bounds.width,
    height: bounds.height,
    // The window is the bug's box: paint at the scale that fits it.
    scale: Math.min(bounds.width / visibleForScale.width, bounds.height / visibleForScale.height),
  };
  runtime.activeDisplayKey = key;
  setOverlayBounds(bounds);
  sendToOverlay('overlay:layout', runtime.layout);
  // setBounds is asynchronous on Windows. Persist the sanitized target we
  // just calculated instead of immediately reading the temporary launch
  // bounds back from BrowserWindow.
  if (!requestedDisplay && savedFromMissingDisplay) {
    persistPlacement(bounds, display, { preserveScale: true });
  }
}

function beginEditMode() {
  if (inGameEditorWindow && !inGameEditorWindow.isDestroyed()) {
    runtime.quickSettingsOpen = false;
    inGameEditorWindow.close();
  }
  runtime.editMode = true;
  runtime.cropMode = false;
  overlayResizeGesture = null;
  runtime.positionLocked = false;
  runtime.requestedVisible = true;
  settings.overlay ||= {};
  settings.overlay.positionLocked = false;
  persistSettings();
  applyClickThrough();
  applyVisibility('edit-mode');
}

function lockPosition() {
  if (placementSaveTimer) {
    clearTimeout(placementSaveTimer);
    placementSaveTimer = null;
  }
  runtime.editMode = false;
  runtime.quickSettingsOpen = false;
  runtime.cropMode = false;
  overlayResizeGesture = null;
  runtime.positionLocked = true;
  settings.overlay ||= {};
  settings.overlay.positionLocked = true;
  persistCurrentPlacement();
  applyClickThrough();
  applyVisibility('position-locked');
  if (inGameEditorWindow && !inGameEditorWindow.isDestroyed()) inGameEditorWindow.close();
}

function followGame() {
  if (placementSaveTimer) {
    clearTimeout(placementSaveTimer);
    placementSaveTimer = null;
  }
  runtime.editMode = false;
  runtime.quickSettingsOpen = false;
  runtime.cropMode = false;
  overlayResizeGesture = null;
  runtime.positionLocked = false;
  settings.overlay ||= {};
  settings.overlay.positionLocked = false;
  persistSettings();
  applyClickThrough();
  positionOverlay({ force: true });
  applyVisibility('follow-game');
}

function applyClickThrough() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const usingFullEditor = runtime.quickSettingsOpen;
  const clickThrough = usingFullEditor
    ? true
    : (!runtime.editMode && settings.overlay?.clickThrough !== false);
  overlayWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  overlayWindow.setFocusable(usingFullEditor ? false : (runtime.editMode || !clickThrough));
  overlayWindow.setResizable(runtime.editMode && !usingFullEditor);
  const visibleCanvas = visibleThemeCanvas(runtime.layout);
  overlayWindow.setAspectRatio(runtime.editMode && !usingFullEditor && !runtime.cropMode && visibleCanvas.height
    ? visibleCanvas.width / visibleCanvas.height
    : 0);
  sendToOverlay('overlay:edit-mode', runtime.editMode && !usingFullEditor);
}

function applyWindowBehaviorSettings() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (settings.overlay?.alwaysOnTop !== false) overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  else overlayWindow.setAlwaysOnTop(false);
  applyClickThrough();
}

function desiredOverlayVisibility() {
  if (runtime.editMode || runtime.quickSettingsOpen) return true;
  if (!runtime.started || !runtime.requestedVisible) return false;
  if (settings.overlay?.hideDuringPlayCall === true && runtime.playCallOpen === true) return false;
  // Manual/forced visibility is an explicit user decision and must survive a
  // reader restart, a profile save, or a capture outage. OCR-derived
  // autoVisible is consulted only while Automatic visibility is enabled.
  return runtime.automaticEnabled ? runtime.autoVisible : true;
}

function commitOverlayVisibility(shouldShow, reason = 'state-change') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  runtime.lastVisibilityReason = reason;
  if (desiredOverlayVisibility() !== shouldShow) {
    applyVisibility(`${reason}-superseded`);
    return;
  }

  if (shouldShow && !overlayWindow.isVisible()) {
    positionOverlay();
    overlayWindow.showInactive();
  } else if (!shouldShow && overlayWindow.isVisible()) {
    overlayWindow.hide();
  }
  broadcastStatus();
}

function applyVisibility(reason = 'state-change') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  runtime.lastVisibilityReason = reason;
  const shouldShow = desiredOverlayVisibility();
  const actualVisible = overlayWindow.isVisible();
  if (actualVisible === shouldShow) {
    visibilityTransitionGate.cancel();
    broadcastStatus();
    return;
  }
  const delayMs = automaticVisibilityDelay({
    automaticEnabled: runtime.automaticEnabled,
    editMode: runtime.editMode,
    started: runtime.started,
    requestedVisible: runtime.requestedVisible,
    shouldShow,
    showDelayMs: settings.overlay?.showDelayMs,
    hideDelayMs: settings.overlay?.hideDelayMs,
  });
  visibilityTransitionGate.request(shouldShow, delayMs, reason);
  broadcastStatus();
}

function setEditMode(enabled) {
  if (enabled) beginEditMode();
  else if (runtime.editMode) lockPosition();
  else {
    applyClickThrough();
    applyVisibility('edit-finished');
  }
}

// The editor deliberately opens without keyboard focus so the game keeps
// running - which also made every text box in it untypeable: keystrokes
// went to the game. Reported by a tester as the record editor "not
// working". Focus is now borrowed exactly while a text box is active and
// handed straight back when it is left; dropping focusable returns
// keyboard focus to the game window automatically on Windows.
function setInGameEditorTypeFocus(payload = {}) {
  if (!inGameEditorWindow || inGameEditorWindow.isDestroyed()) return statusSnapshot();
  const enabled = Boolean(payload.enabled);
  inGameEditorWindow.setFocusable(enabled);
  if (enabled) inGameEditorWindow.focus();
  return statusSnapshot();
}

function syncInGameEditorBounds() {
  if (!inGameEditorWindow || inGameEditorWindow.isDestroyed()) return;
  const bounds = inGameEditorBounds();
  if (JSON.stringify(inGameEditorWindow.getBounds()) !== JSON.stringify(bounds)) {
    inGameEditorWindow.setBounds(bounds, false);
  }
  pushInGameEditorState();
}

function createInGameEditorWindow() {
  if (inGameEditorWindow && !inGameEditorWindow.isDestroyed()) {
    syncInGameEditorBounds();
    inGameEditorWindow.showInactive();
    return inGameEditorWindow;
  }
  const bounds = inGameEditorBounds();
  inGameEditorWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  inGameEditorWindow.setMenu(null);
  inGameEditorWindow.setFocusable(false);
  inGameEditorWindow.setAlwaysOnTop(true, 'screen-saver', 2);
  inGameEditorWindow.setSkipTaskbar(true);
  inGameEditorWindow.setContentProtection(false);
  try {
    inGameEditorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // Always-on-top still covers a borderless game on Windows.
  }
  installLocalNavigationGuard(inGameEditorWindow, [IN_GAME_EDITOR_DOCUMENT]);
  inGameEditorWindow.loadFile(IN_GAME_EDITOR_DOCUMENT);
  inGameEditorWindow.once('ready-to-show', () => {
    if (!inGameEditorWindow || inGameEditorWindow.isDestroyed()) return;
    syncInGameEditorBounds();
    inGameEditorWindow.showInactive();
  });
  inGameEditorWindow.on('closed', () => {
    inGameEditorStateSignature = '';
    inGameEditorWindow = null;
    overlayMoveGesture = null;
    overlayResizeGesture = null;
    if (!shuttingDown && runtime.quickSettingsOpen) {
      runtime.quickSettingsOpen = false;
      lockPosition();
      broadcastStatus();
    }
  });
  return inGameEditorWindow;
}

function closeInGameEditor() {
  runtime.quickSettingsOpen = false;
  runtime.cropMode = false;
  overlayMoveGesture = null;
  overlayResizeGesture = null;
  lockPosition();
  broadcastStatus();
  return statusSnapshot();
}

function toggleQuickSettings() {
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
  if (runtime.quickSettingsOpen) {
    return closeInGameEditor();
  } else {
    runtime.quickSettingsOpen = true;
    runtime.editMode = false;
    runtime.cropMode = false;
    runtime.logoGeometry = { away: null, home: null };
    overlayMoveGesture = null;
    overlayResizeGesture = null;
    runtime.requestedVisible = true;
    applyClickThrough();
    applyVisibility('full-in-game-editor');
    createInGameEditorWindow();
    logMessage('Non-activating scorebug resizer opened; the game keeps keyboard focus.');
  }
  broadcastStatus();
  return statusSnapshot();
}

function setGreenScreenEnabled(enabled) {
  settings.theme ||= {};
  settings.theme.chromaKey = normalizeGreenScreen({
    ...(settings.theme.chromaKey || {}),
    enabled: Boolean(enabled),
  });
  persistSettings();
  broadcastStatus();
  logMessage(`Green-screen filter ${settings.theme.chromaKey.enabled ? 'enabled' : 'disabled'} from in-game controls.`);
  return statusSnapshot();
}

function validOverlayHandle(value) {
  const handle = String(value || '').toLowerCase();
  if (!/^(?:n|s|e|w|ne|nw|se|sw)$/.test(handle)) {
    throw new Error('Unknown overlay resize handle.');
  }
  return handle;
}

function beginOverlayHandleGesture(payload, operation) {
  if ((!runtime.editMode && !runtime.quickSettingsOpen) || !overlayWindow || overlayWindow.isDestroyed()) return false;
  const pointerX = Number(payload.screenX);
  const pointerY = Number(payload.screenY);
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return false;
  overlayResizeGesture = {
    operation,
    handle: validOverlayHandle(payload.handle),
    pointerX,
    pointerY,
    bounds: overlayWindow.getBounds(),
    layout: cloneJson(runtime.layout),
  };
  return true;
}

function resizedBoundsForPointer(gesture, pointerX, pointerY) {
  const deltaX = pointerX - gesture.pointerX;
  const deltaY = pointerY - gesture.pointerY;
  const current = gesture.bounds;
  const visibleCanvas = visibleThemeCanvas(gesture.layout);
  const ratio = Math.max(0.1, visibleCanvas.width / visibleCanvas.height);
  const handle = gesture.handle;
  const horizontalWidth = handle.includes('e')
    ? current.width + deltaX
    : (handle.includes('w') ? current.width - deltaX : current.width);
  const verticalHeight = handle.includes('s')
    ? current.height + deltaY
    : (handle.includes('n') ? current.height - deltaY : current.height);
  const verticalWidth = verticalHeight * ratio;
  let requestedWidth = horizontalWidth;
  if (!handle.includes('e') && !handle.includes('w')) requestedWidth = verticalWidth;
  else if ((handle.includes('n') || handle.includes('s'))
    && Math.abs(verticalWidth - current.width) > Math.abs(horizontalWidth - current.width)) {
    requestedWidth = verticalWidth;
  }
  let width = Math.max(120, Math.min(4000, Math.round(requestedWidth)));
  let height = Math.max(70, Math.min(3000, Math.round(width / ratio)));
  width = Math.round(height * ratio);
  let x = current.x;
  let y = current.y;
  if (handle.includes('w')) x = current.x + current.width - width;
  else if (!handle.includes('e')) x = Math.round(current.x + (current.width - width) / 2);
  if (handle.includes('n')) y = current.y + current.height - height;
  else if (!handle.includes('s')) y = Math.round(current.y + (current.height - height) / 2);
  return {
    bounds: { x: Math.round(x), y: Math.round(y), width, height },
    scale: Math.min(width / visibleCanvas.width, height / visibleCanvas.height),
    crop: visibleCanvas.crop,
  };
}

function croppedBoundsForPointer(gesture, pointerX, pointerY) {
  const deltaX = pointerX - gesture.pointerX;
  const deltaY = pointerY - gesture.pointerY;
  const scale = Math.max(0.1, Number(gesture.layout.scale) || 1);
  const handle = gesture.handle;
  const startingCrop = normalizeThemeCrop(
    gesture.layout.crop,
    gesture.layout.canvasWidth,
    gesture.layout.canvasHeight,
  );
  const requestedCrop = { ...startingCrop };
  if (handle.includes('w')) requestedCrop.left = startingCrop.left + (deltaX / scale);
  if (handle.includes('e')) requestedCrop.right = startingCrop.right - (deltaX / scale);
  if (handle.includes('n')) requestedCrop.top = startingCrop.top + (deltaY / scale);
  if (handle.includes('s')) requestedCrop.bottom = startingCrop.bottom - (deltaY / scale);
  const crop = normalizeThemeCrop(
    requestedCrop,
    gesture.layout.canvasWidth,
    gesture.layout.canvasHeight,
  );
  const visibleCanvas = visibleThemeCanvas({ ...gesture.layout, crop });
  const width = Math.max(40, Math.round(visibleCanvas.width * scale));
  const height = Math.max(24, Math.round(visibleCanvas.height * scale));
  const current = gesture.bounds;
  return {
    bounds: {
      x: handle.includes('w') ? current.x + current.width - width : current.x,
      y: handle.includes('n') ? current.y + current.height - height : current.y,
      width,
      height,
    },
    scale,
    crop,
  };
}

function applyOverlayHandleGesture(payload = {}) {
  if (!overlayResizeGesture || !overlayWindow || overlayWindow.isDestroyed()) return false;
  const pointerX = Number(payload.screenX);
  const pointerY = Number(payload.screenY);
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return false;
  const result = overlayResizeGesture.operation === 'crop'
    ? croppedBoundsForPointer(overlayResizeGesture, pointerX, pointerY)
    : resizedBoundsForPointer(overlayResizeGesture, pointerX, pointerY);
  overlayWindow.setBounds(result.bounds, false);
  runtime.layout = {
    ...runtime.layout,
    scale: result.scale,
    // scaleAt2160 is what restore actually uses (resolveScaleSettings prefers
    // it over scale). Leaving it stale here was why a saved profile brought
    // back the position but the PRE-resize size.
    scaleAt2160: scaleAt2160FromEffective(
      result.scale,
      normalizeOutputResolution(settings.overlay?.outputResolution),
      result.scale,
    ),
    crop: result.crop,
    width: result.bounds.width,
    height: result.bounds.height,
  };
  if (overlayResizeGesture.operation === 'crop') settings.theme.crop = result.crop;
  sendToOverlay('overlay:layout', runtime.layout);
  return true;
}

function resizeOverlayFromHandle(payload = {}) {
  if ((!runtime.editMode && !runtime.quickSettingsOpen) || !overlayWindow || overlayWindow.isDestroyed()) return statusSnapshot();
  const phase = String(payload.phase || 'move').toLowerCase();
  const operation = payload.operation === 'crop' ? 'crop' : 'resize';
  if (phase === 'start') {
    beginOverlayHandleGesture(payload, operation);
    return null;
  }
  if (!overlayResizeGesture || overlayResizeGesture.operation !== operation) return null;
  applyOverlayHandleGesture(payload);
  if (phase !== 'end') return null;
  const completedOperation = overlayResizeGesture.operation;
  overlayResizeGesture = null;
  const bounds = overlayWindow.getBounds();
  persistPlacement(bounds, displayForBounds(bounds), { preserveScale: completedOperation === 'crop' });
  broadcastStatus();
  return statusSnapshot();
}

function moveOverlayFromPointer(payload = {}) {
  if (!runtime.quickSettingsOpen || !overlayWindow || overlayWindow.isDestroyed()) return statusSnapshot();
  const phase = String(payload.phase || 'move').toLowerCase();
  const pointerX = Number(payload.screenX);
  const pointerY = Number(payload.screenY);
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return null;
  if (phase === 'start') {
    overlayMoveGesture = {
      pointerX,
      pointerY,
      bounds: overlayWindow.getBounds(),
    };
    return null;
  }
  if (!overlayMoveGesture) return null;
  const bounds = {
    ...overlayMoveGesture.bounds,
    x: Math.round(overlayMoveGesture.bounds.x + pointerX - overlayMoveGesture.pointerX),
    y: Math.round(overlayMoveGesture.bounds.y + pointerY - overlayMoveGesture.pointerY),
  };
  overlayWindow.setBounds(bounds, false);
  if (phase !== 'end') return null;
  overlayMoveGesture = null;
  persistPlacement(bounds, displayForBounds(bounds), { preserveScale: true });
  broadcastStatus();
  return statusSnapshot();
}

function setCropMode(enabled) {
  if (!runtime.editMode && !runtime.quickSettingsOpen) throw new Error('Open the overlay editor before using Crop mode.');
  runtime.cropMode = Boolean(enabled);
  overlayResizeGesture = null;
  applyClickThrough();
  broadcastStatus();
  return statusSnapshot();
}

function resetThemeCrop() {
  if ((!runtime.editMode && !runtime.quickSettingsOpen) || !overlayWindow || overlayWindow.isDestroyed()) return statusSnapshot();
  const current = overlayWindow.getBounds();
  const crop = normalizeThemeCrop({}, runtime.layout.canvasWidth, runtime.layout.canvasHeight);
  const visibleCanvas = visibleThemeCanvas({ ...runtime.layout, crop });
  const scale = Math.max(0.1, Number(runtime.layout.scale) || 1);
  const requested = resizeBoundsAroundAnchor(
    current,
    Math.round(visibleCanvas.width * scale),
    Math.round(visibleCanvas.height * scale),
    runtime.layout.anchor,
  );
  const display = displayForBounds(current);
  const bounds = sanitizeBounds(requested, display, current);
  settings.theme.crop = crop;
  runtime.layout = { ...runtime.layout, crop, width: bounds.width, height: bounds.height };
  setOverlayBounds(bounds);
  persistPlacement(bounds, display, { preserveScale: true });
  return statusSnapshot();
}

function handleOverlayBoundsChanged(kind) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayResizeGesture || overlayMoveGesture) return;
  const isManualEdit = runtime.editMode && Date.now() >= runtime.ignorePlacementEventsUntil;
  if (isManualEdit && kind === 'resize') {
    const bounds = overlayWindow.getBounds();
    const visibleCanvas = visibleThemeCanvas(runtime.layout);
    runtime.layout = {
      ...runtime.layout,
      width: bounds.width,
      height: bounds.height,
      scale: Math.min(bounds.width / visibleCanvas.width, bounds.height / visibleCanvas.height),
    };
    sendToOverlay('overlay:layout', runtime.layout);
  }
  if (isManualEdit) schedulePlacementSave();
  broadcastStatus();
}

function handleDisplayConfigurationChanged() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  syncInGameEditorBounds();
  if (runtime.positionLocked || runtime.editMode) {
    const current = overlayWindow.getBounds();
    const display = displayForBounds(current);
    const safe = sanitizeBounds(current, display, anchoredPosition(display.bounds || display.workArea, runtime.layout));
    setOverlayBounds(safe);
    runtime.activeDisplayKey = displayKey(display);
    if (runtime.positionLocked) persistCurrentPlacement();
    return;
  }
  positionOverlay({ force: true });
}

function setTheme(themePath, preferredCanvas = {}, { rememberPrevious = true } = {}) {
  const resolved = resolveThemePath(themePath);
  if (!resolved) throw new Error('Theme must be an existing local .html or .htm file.');

  const changingTheme = Boolean(runtime.themePath && !samePath(runtime.themePath, resolved));
  if (rememberPrevious && changingTheme) {
    rememberThemeSizing(runtime.themePath);
  }
  const compatibility = activateThemeDocument(resolved);
  settings.theme ||= {};
  // Keep the built-in selection portable across app upgrades. Persisting an
  // app.asar path would point the next release back at the previous folder.
  settings.theme.path = samePath(resolved, bundledOriginalThemePath()) ? '' : resolved;
  restoreThemeSizing(resolved, preferredCanvas, { usePreferredCrop: !changingTheme });
  runtime.themePath = resolved;
  runtime.themeLogoLibrary = compatibility.logoLibrary || null;
  runtime.mockMode = false;
  runtime.themeRevision += 1;
  runtime.logoGeometry = { away: null, home: null };
  // On a real switch the placement restoreThemeSizing just loaded must be
  // APPLIED, not merely stored: without restoreLocked the locked path kept
  // the previous theme's on-screen position and then persisted it straight
  // over the snapshot it had just restored - which is why each theme's saved
  // spot never seemed to stick.
  applyPlacementSettings({ restoreLocked: changingTheme });
  rememberThemeSizing(resolved);
  persistSettings();
  try {
    const b = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getBounds() : null;
    const l = runtime.layout || {};
    logMessage(`Theme layout: ${path.basename(resolved)} canvas ${l.canvasWidth}x${l.canvasHeight} crop ${JSON.stringify(l.crop || {})} layout ${l.width}x${l.height} scale ${Number(l.scale).toFixed(3)} window ${b ? `${b.width}x${b.height}@${b.x},${b.y}` : 'none'} anchor ${l.anchor} locked ${runtime.positionLocked}`);
  } catch { /* diagnostics only */ }
  sendToOverlay('overlay:theme', {
    themePath: runtime.themePath,
    themeUrl: themeUrl(),
    themeRevision: runtime.themeRevision,
  });
  broadcastStatus();
  return statusSnapshot();
}

function reloadTheme() {
  if (runtime.themePath && !runtime.mockMode) {
    const compatibility = activateThemeDocument(runtime.themePath);
    runtime.themeLogoLibrary = compatibility.logoLibrary || null;
  }
  runtime.themeRevision += 1;
  runtime.logoGeometry = { away: null, home: null };
  sendToOverlay('overlay:reload-theme', {
    themeUrl: themeUrl(),
    themeRevision: runtime.themeRevision,
  });
  broadcastStatus();
}

function applyTeamLogoLayouts(sourceState) {
  const payload = {
    ...sourceState,
    away: { ...(sourceState?.away || {}) },
    home: { ...(sourceState?.home || {}) },
    game: { ...(sourceState?.game || {}) },
    meta: { ...(sourceState?.meta || {}) },
  };
  const preferences = normalizedPreferences(settings.teamLogos?.preferences);
  const layouts = normalizedLogoLayouts(settings.teamLogos?.layouts);
  const themeKey = themeSizingKey(runtime.themePath);
  const published = {};

  for (const side of ['away', 'home']) {
    const publishedTeamId = payload.meta?.teamAssets?.[side]?.id;
    const asset = publishedTeamId
      ? teamAssetResolver?.resolveTeamId(publishedTeamId)
      : teamAssetResolver?.resolve(payload[side]?.name);
    if (!asset || !payload[side]?.logo) continue;
    const selected = runtime.themeLogoLibrary === 'original'
      ? 'original'
      : (runtime.themeLogoLibrary === 'cropped'
        ? 'default'
        : (preferences[String(asset.id)] || 'default'));
    const variantId = teamLogoVariantResolver?.resolveChoice(asset.id, selected, teamAssetResolver)
      ? selected
      : 'default';
    const key = logoLayoutKey(themeKey, asset.id, variantId, side);
    const transform = normalizeLogoTransform(runtime.logoTransformDrafts.get(key) || layouts[key]);
    published[side] = {
      teamId: String(asset.id),
      variantId,
      ...transform,
    };
  }
  payload.meta.teamLogoLayouts = published;
  return payload;
}

// ---- Bug-declared settings (THEME-SETTINGS.md) -------------------------
// Parsed from the active HTML once per theme revision; values are part of
// the bug's profile (settings.theme.settingsByHtml[<sha key>]).
let themeSettingsCache = { path: null, revision: -1, declaration: [] };

function themeSettingsDeclaration() {
  if (themeSettingsCache.path === runtime.themePath && themeSettingsCache.revision === runtime.themeRevision) {
    return themeSettingsCache.declaration;
  }
  let declaration = [];
  try {
    if (runtime.themePath && fs.existsSync(runtime.themePath)) {
      declaration = parseThemeSettingsDeclaration(fs.readFileSync(runtime.themePath, 'utf8'));
    }
  } catch { declaration = []; }
  themeSettingsCache = { path: runtime.themePath, revision: runtime.themeRevision, declaration };
  return declaration;
}

function themeSettingsMap() {
  settings.theme ||= {};
  if (!isPlainObject(settings.theme.settingsByHtml)) settings.theme.settingsByHtml = {};
  return settings.theme.settingsByHtml;
}

function currentThemeSettingValues() {
  const declaration = themeSettingsDeclaration();
  if (!declaration.length) return null;
  const key = themeSizingKey(runtime.themePath);
  return resolveThemeSettingValues(declaration, key ? themeSettingsMap()[key] : null);
}

function themeSettingsForEditor() {
  return { declaration: themeSettingsDeclaration(), values: currentThemeSettingValues() || {} };
}

function setThemeSetting(payload = {}) {
  const declaration = themeSettingsDeclaration();
  const control = declaration.find((entry) => entry.key === String(payload.key || ''));
  if (!control) throw new Error('This scorebug does not declare that setting.');
  const key = themeSizingKey(runtime.themePath);
  if (!key) throw new Error('No scorebug HTML is active.');
  const map = themeSettingsMap();
  const current = resolveThemeSettingValues(declaration, map[key]);
  if (payload.reset === true) delete current[control.key];
  else current[control.key] = payload.value;
  map[key] = resolveThemeSettingValues(declaration, current);
  persistSettings();
  publishCurrentScoreboardState();
  pushInGameEditorState();
  return inGameEditorState();
}

// The exact object every bug receives, for bug authors and testers:
// UserData/data-export/latest-state.json (at most once per second; logos
// replaced by their byte length so the file stays readable).
let latestStateDebugAtMs = 0;
function writeLatestStateDebug(state) {
  const now = Date.now();
  if (now - latestStateDebugAtMs < 1000) return;
  latestStateDebugAtMs = now;
  try {
    const folder = dataExportRootPath();
    fs.mkdirSync(folder, { recursive: true });
    const compact = JSON.parse(JSON.stringify(state, (key, value) => (
      typeof value === 'string' && value.startsWith('data:') ? `<data-url ${value.length} chars>` : value
    )));
    const target = path.join(folder, 'latest-state.json');
    fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(compact, null, 2)}
`, 'utf8');
    fs.renameSync(`${target}.tmp`, target);
  } catch { /* debugging aid only */ }
}

function publishCurrentScoreboardState() {
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  runtime.scoreboardState = applyTeamLogoLayouts(
    applyThemeLogoLibrary(
      applyTeamLogoPreferences(
        // Colors apply after the bundled assets so a pinned scorebug color
        // wins over the asset's primary.
        applyScorebugColors(
          applyBundledTeamAssets(
            applyDynastyNameFallback(
              applyManualTeamOverrides(
                applyRamScoreboardState(runtime.readerScoreboardState),
                runtime.manualTeamOverrides,
                teamAssetResolver,
              ),
              runtime.dynasty,
              teamAssetResolver,
            ),
          ),
          settings.scorebugColors,
          { themeId: scorebugThemeIdentity() },
        ),
        effectiveLogoPreferences(),
        teamAssetResolver,
        teamLogoVariantResolver,
      ),
      runtime.themeLogoLibrary,
      teamAssetResolver,
      teamLogoVariantResolver,
    ),
  );
  try { applyDynastyContext(runtime.scoreboardState, runtime.dynasty); } catch (error) { console.warn('[dynasty] apply failed:', error.message); }
  // Ctrl+Alt+O is the operator's final authority. Automatic RAM/Dynasty
  // enrichment stays active underneath, but it can never replace a team,
  // rank, or record field the operator explicitly chose.
  runtime.scoreboardState = finalizeManualTeamOverrides(
    runtime.scoreboardState,
    runtime.manualTeamOverrides,
    teamAssetResolver,
  );
  try { maybeRequestDynastyLeaders(); } catch { /* optional */ }
  const themeSettingValues = currentThemeSettingValues();
  if (themeSettingValues) runtime.scoreboardState.themeSettings = themeSettingValues;
  else delete runtime.scoreboardState.themeSettings;
  sendToOverlay('overlay:scoreboard-state', runtime.scoreboardState);
  sendToControl('scoreboard:state', runtime.scoreboardState);
  writeLatestStateDebug(runtime.scoreboardState);
  if (runtime.scoreboardState?.away?.name && runtime.scoreboardState?.home?.name) scheduleThemeSnapshot();
  if (automaticExtractionEnabled()) {
    try {
      const extractor = automaticDataExtractor();
      extractor.observeScreenScoreboard(runtime.readerScoreboardState);
      extractor.observeScoreboard(runtime.scoreboardState);
    } catch (error) {
      console.warn('[data-extraction] could not write scoreboard state:', error.message);
    }
  }
  return runtime.scoreboardState;
}

function updateScoreboardState(nextState) {
  if (!nextState || typeof nextState !== 'object' || Array.isArray(nextState)) {
    throw new Error('Scoreboard state must be an object.');
  }

  const mergedState = {
    ...runtime.readerScoreboardState,
    ...nextState,
    away: { ...runtime.readerScoreboardState.away, ...(nextState.away || {}) },
    home: { ...runtime.readerScoreboardState.home, ...(nextState.home || {}) },
    game: { ...runtime.readerScoreboardState.game, ...(nextState.game || {}) },
    meta: {
      ...runtime.readerScoreboardState.meta,
      ...(nextState.meta || {}),
      updatedAt: nextState.meta?.updatedAt || new Date().toISOString(),
    },
  };
  runtime.readerScoreboardState = mergedState;
  // The reader remains automatic. Session-only team/rank choices are layered
  // over its latest state at this single publication boundary.
  return publishCurrentScoreboardState();
}

function setManualTeamOverride(payload = {}) {
  const side = String(payload.side || '').toLowerCase();
  if (!['away', 'home'].includes(side)) throw new Error('Choose the away or home team override.');
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  const nextOverride = normalizeManualTeamOverride(teamAssetResolver, payload);
  runtime.manualTeamOverrides[side] = nextOverride;
  publishCurrentScoreboardState();
  pushInGameEditorState();
  const teamLabel = nextOverride.teamId
    ? teamAssetResolver.resolveTeamId(nextOverride.teamId).name
    : 'Auto team';
  const rankLabel = nextOverride.rankMode === 'ranked'
    ? `#${nextOverride.rank}`
    : (nextOverride.rankMode === 'unranked' ? 'Unranked' : 'Auto rank');
  logMessage(`${side === 'away' ? 'Away' : 'Home'} override: ${teamLabel}, ${rankLabel}. Automatic OCR remains active.`);
  return inGameEditorState();
}

function clearManualTeamOverrides({ publish = true, recordLog = true } = {}) {
  runtime.manualTeamOverrides = emptyManualTeamOverrides();
  if (publish) publishCurrentScoreboardState();
  pushInGameEditorState();
  if (recordLog) logMessage('Manual team and rank overrides cleared; automatic OCR owns both teams again.');
  return inGameEditorState();
}

// Current color choices plus the swatches the editor can offer: the live
// team's real primary and secondary from the bundled assets.
// Identity of the active scorebug HTML for 'this bug only' color rules:
// the library folder id when the theme comes from the library, else the
// file path.
function scorebugThemeIdentity() {
  const themePath = String(runtime.themePath || '');
  if (!themePath) return null;
  const folder = path.basename(path.dirname(themePath));
  return /^[0-9a-f]{64}$/i.test(folder) ? folder.toLowerCase() : themePath.toLowerCase();
}

function scorebugColorContext() {
  return {
    awayTeamId: runtime.scoreboardState?.meta?.teamAssets?.away?.id || null,
    homeTeamId: runtime.scoreboardState?.meta?.teamAssets?.home?.id || null,
    themeId: scorebugThemeIdentity(),
  };
}

function scorebugColorState() {
  const colors = normalizeScorebugColors(settings.scorebugColors);
  const context = scorebugColorContext();
  const swatches = {};
  for (const side of ['away', 'home']) {
    const id = runtime.scoreboardState?.meta?.teamAssets?.[side]?.id;
    const asset = id && teamAssetResolver ? teamAssetResolver.resolveTeamId(id) : null;
    swatches[side] = {
      teamId: id || null,
      teamName: asset?.name || runtime.scoreboardState?.[side]?.name || null,
      primary: asset?.primary || null,
      secondary: asset?.secondary || null,
      live: runtime.scoreboardState?.[side]?.color || null,
      paletteCount: id ? teamPaletteList(id).length : 0,
    };
  }
  const teamName = (id) => (id && teamAssetResolver ? teamAssetResolver.resolveTeamId(id)?.name : null) || id || '?';
  const themeName = (id) => {
    try {
      const entry = themeLibraryStore().list().find((candidate) => candidate.id === id);
      if (entry?.name) return entry.name;
    } catch { }
    return 'this bug';
  };
  const rules = colors.rules.map((rule) => {
    const bits = [];
    if (rule.scope === 'team') {
      bits.push(teamName(rule.teamId));
      if (rule.awayTeamId && rule.homeTeamId) bits.push(`vs ${teamName(rule.teamId === rule.awayTeamId ? rule.homeTeamId : rule.awayTeamId)} only`);
      if (rule.themeId) bits.push(`on ${themeName(rule.themeId)} only`);
    } else if (rule.scope === 'matchup') {
      bits.push(`${teamName(rule.awayTeamId)} vs ${teamName(rule.homeTeamId)}`);
      if (rule.themeId) bits.push(`on ${themeName(rule.themeId)} only`);
    } else {
      bits.push(`${themeName(rule.themeId)} (bug only)`);
    }
    return { ...rule, label: bits.join(' · ') };
  });
  return {
    ...colors,
    rules,
    swatches,
    context,
    resolved: resolveScorebugColors(colors, context),
  };
}

// One full-resolution grab of the display the editor covers, for the
// in-panel eyedropper. Returned as a data URL plus the display geometry so
// the editor can map its own client coordinates onto capture pixels.
async function captureScreenForEyedropper() {
  const bounds = inGameEditorBounds();
  const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const size = {
    width: Math.round(display.bounds.width * scale),
    height: Math.round(display.bounds.height * scale),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const match = sources.find((source) => String(source.display_id) === String(display.id)) || sources[0];
  if (!match) throw new Error('No display could be captured.');
  return {
    dataUrl: match.thumbnail.toDataURL(),
    displayX: display.bounds.x,
    displayY: display.bounds.y,
    displayWidth: display.bounds.width,
    displayHeight: display.bounds.height,
  };
}

function deleteScorebugColorRuleCommand(payload = {}) {
  const rule = payload.rule || {};
  return publishScorebugColors(
    removeScorebugColorRule(settings.scorebugColors, rule),
    `Scorebug color profile removed (${rule.scope || '?'}).`,
  );
}

function publishScorebugColors(nextColors, logText) {
  settings.scorebugColors = normalizeScorebugColors(nextColors);
  persistSettings();
  publishCurrentScoreboardState();
  pushInGameEditorState();
  if (logText) logMessage(logText);
  return inGameEditorState();
}

function setScorebugColor(payload = {}) {
  const side = String(payload.side || '').toLowerCase();
  if (!['away', 'home'].includes(side)) throw new Error('Choose the away or home scorebug color.');
  const mode = String(payload.mode || 'auto').toLowerCase();
  if (mode === 'custom' && !isScorebugHexColor(payload.color)) {
    throw new Error('Pick a color first.');
  }
  let colors = normalizeScorebugColors(settings.scorebugColors);
  const teamId = runtime.scoreboardState?.meta?.teamAssets?.[side]?.id || null;
  const color = mode === 'custom' ? String(payload.color).trim().toLowerCase() : null;
  if (teamId) {
    // Per-team: the choice follows this TEAM to every game and either side.
    // A matchup rule for the current pairing would otherwise silently win,
    // so a direct click also updates that pairing's entry for this side.
    colors = mode === 'custom'
      ? upsertScorebugColorRule(colors, { scope: 'team', teamId, color })
      : removeScorebugColorRule(colors, { scope: 'team', teamId });
    const context = scorebugColorContext();
    const matchup = colors.rules.find((rule) => rule.scope === 'matchup'
      && rule.awayTeamId === context.awayTeamId && rule.homeTeamId === context.homeTeamId);
    if (matchup) {
      colors = upsertScorebugColorRule(colors, { ...matchup, [side]: color });
      if (!matchup.away && !matchup.home) colors = removeScorebugColorRule(colors, matchup);
    }
    // The legacy side pin must not keep overriding a team that was just set to auto.
    colors[side] = { mode: 'auto', color: null };
  } else {
    colors[side] = mode === 'custom' ? { mode: 'custom', color } : { mode: 'auto', color: null };
  }
  const teamLabel = teamId && teamAssetResolver ? (teamAssetResolver.resolveTeamId(teamId)?.name || teamId) : (side === 'away' ? 'Away' : 'Home');
  return publishScorebugColors(colors, `${teamLabel} scorebug color: `
    + (mode === 'custom' ? color : 'auto (team primary)'));
}

// Scoped save: 'team-away' | 'team-home' | 'matchup' | 'theme'. Saves the
// colors currently showing on the bug under that scope.
// Save the colors on the bug under any mix of conditions: sides
// (left/right team) plus qualifiers (this matchup only, this bug only).
// - sides picked -> one team rule per side, qualified as requested
// - no side, matchup -> a matchup rule for both colors (bug-qualified if asked)
// - no side, bug only -> a bug rule for both colors
function saveScorebugColorMix(payload = {}) {
  const context = scorebugColorContext();
  const away = runtime.scoreboardState?.away?.color;
  const home = runtime.scoreboardState?.home?.color;
  const sides = [...new Set((Array.isArray(payload.sides) ? payload.sides : []).map((side) => String(side).toLowerCase()).filter((side) => side === 'away' || side === 'home'))];
  const matchup = payload.matchup === true;
  const theme = payload.theme === true;
  if (!sides.length && !matchup && !theme) throw new Error('Choose what the colors should apply to.');
  if (matchup && !(context.awayTeamId && context.homeTeamId)) throw new Error('Both teams need to be identified for a matchup rule.');
  if (theme && !context.themeId) throw new Error('No scorebug HTML is active.');
  let colors = normalizeScorebugColors(settings.scorebugColors);
  const labels = [];
  const qualifiers = [];
  if (matchup) qualifiers.push('this matchup');
  if (theme) qualifiers.push('this bug');
  const suffix = qualifiers.length ? ` (${qualifiers.join(', ')} only)` : '';
  if (sides.length) {
    for (const side of sides) {
      const teamId = context[`${side}TeamId`];
      const color = side === 'away' ? away : home;
      if (!teamId) throw new Error(`The ${side === 'away' ? 'left' : 'right'} side has no identified team yet.`);
      if (!isScorebugHexColor(color)) throw new Error(`The ${side === 'away' ? 'left' : 'right'} team has no visible color yet.`);
      colors = upsertScorebugColorRule(colors, {
        scope: 'team', teamId, color,
        ...(matchup ? { awayTeamId: context.awayTeamId, homeTeamId: context.homeTeamId } : {}),
        ...(theme ? { themeId: context.themeId } : {}),
      });
      labels.push(`${teamAssetResolver?.resolveTeamId(teamId)?.name || teamId}${suffix}`);
    }
  } else if (matchup) {
    if (!isScorebugHexColor(away) && !isScorebugHexColor(home)) throw new Error('No visible colors to save yet.');
    colors = upsertScorebugColorRule(colors, {
      scope: 'matchup', awayTeamId: context.awayTeamId, homeTeamId: context.homeTeamId,
      away: isScorebugHexColor(away) ? away : null, home: isScorebugHexColor(home) ? home : null,
      ...(theme ? { themeId: context.themeId } : {}),
    });
    labels.push(`this matchup${theme ? ' on this bug' : ''} only`);
  } else {
    if (!isScorebugHexColor(away) && !isScorebugHexColor(home)) throw new Error('No visible colors to save yet.');
    colors = upsertScorebugColorRule(colors, {
      scope: 'theme', themeId: context.themeId,
      away: isScorebugHexColor(away) ? away : null, home: isScorebugHexColor(home) ? home : null,
    });
    labels.push('this scorebug only');
  }
  return publishScorebugColors(colors, `Scorebug colors saved for ${labels.join('; ')}.`);
}

function saveScorebugColorScopeCommand(payload = {}) {
  if (Array.isArray(payload.sides) || payload.matchup !== undefined || payload.theme !== undefined) {
    return saveScorebugColorMix(payload);
  }
  const scope = String(payload.scope || '').toLowerCase();
  const context = scorebugColorContext();
  const away = runtime.scoreboardState?.away?.color;
  const home = runtime.scoreboardState?.home?.color;
  let colors = normalizeScorebugColors(settings.scorebugColors);
  let label;
  if (scope === 'team-away' || scope === 'team-home') {
    const side = scope === 'team-away' ? 'away' : 'home';
    const teamId = context[`${side}TeamId`];
    const color = side === 'away' ? away : home;
    if (!teamId) throw new Error('That side has no identified team yet.');
    if (!isScorebugHexColor(color)) throw new Error('That team has no visible color yet.');
    colors = upsertScorebugColorRule(colors, { scope: 'team', teamId, color });
    label = `${teamAssetResolver?.resolveTeamId(teamId)?.name || teamId}: color saved for this team`;
  } else if (scope === 'matchup') {
    if (!context.awayTeamId || !context.homeTeamId) throw new Error('Both teams need to be identified first.');
    if (!isScorebugHexColor(away) && !isScorebugHexColor(home)) throw new Error('No visible colors to save yet.');
    colors = upsertScorebugColorRule(colors, {
      scope: 'matchup', awayTeamId: context.awayTeamId, homeTeamId: context.homeTeamId,
      away: isScorebugHexColor(away) ? away : null, home: isScorebugHexColor(home) ? home : null,
    });
    label = 'colors saved for this matchup only';
  } else if (scope === 'theme') {
    if (!context.themeId) throw new Error('No scorebug HTML is active.');
    if (!isScorebugHexColor(away) && !isScorebugHexColor(home)) throw new Error('No visible colors to save yet.');
    colors = upsertScorebugColorRule(colors, {
      scope: 'theme', themeId: context.themeId,
      away: isScorebugHexColor(away) ? away : null, home: isScorebugHexColor(home) ? home : null,
    });
    label = 'colors saved for this scorebug only';
  } else {
    throw new Error('Choose what the colors should apply to.');
  }
  return publishScorebugColors(colors, `Scorebug colors: ${label}.`);
}

function clearScorebugColorScopeCommand(payload = {}) {
  const scope = String(payload.scope || '').toLowerCase();
  const context = scorebugColorContext();
  let colors = normalizeScorebugColors(settings.scorebugColors);
  if (scope === 'team-away' || scope === 'team-home') {
    const teamId = context[scope === 'team-away' ? 'awayTeamId' : 'homeTeamId'];
    if (teamId) colors = removeScorebugColorRule(colors, { scope: 'team', teamId });
  } else if (scope === 'matchup' && context.awayTeamId && context.homeTeamId) {
    colors = removeScorebugColorRule(colors, { scope: 'matchup', awayTeamId: context.awayTeamId, homeTeamId: context.homeTeamId });
  } else if (scope === 'theme' && context.themeId) {
    colors = removeScorebugColorRule(colors, { scope: 'theme', themeId: context.themeId });
  }
  return publishScorebugColors(colors, `Scorebug color rule cleared (${scope}).`);
}

function saveScorebugColorPresetCommand(payload = {}) {
  const colors = normalizeScorebugColors(settings.scorebugColors);
  // "Save current colors": a pinned color saves as pinned; an auto side
  // saves whatever the live scorebug is actually showing right now.
  const away = colors.away.mode === 'custom'
    ? colors.away.color : runtime.scoreboardState?.away?.color;
  const home = colors.home.mode === 'custom'
    ? colors.home.color : runtime.scoreboardState?.home?.color;
  if (!isScorebugHexColor(away) || !isScorebugHexColor(home)) {
    throw new Error('Both teams need a visible color before saving a preset.');
  }
  const name = String(payload.name || '').trim()
    || `Preset ${colors.presets.length + 1}`;
  return publishScorebugColors(
    upsertScorebugColorPreset(colors, name, away, home),
    `Scorebug color preset saved: ${name}.`,
  );
}

function applyScorebugColorPresetCommand(payload = {}) {
  return publishScorebugColors(
    applyScorebugColorPreset(settings.scorebugColors, payload.name),
    `Scorebug color preset applied: ${String(payload.name || '').trim()}.`,
  );
}

function deleteScorebugColorPresetCommand(payload = {}) {
  return publishScorebugColors(
    deleteScorebugColorPreset(settings.scorebugColors, payload.name),
    `Scorebug color preset deleted: ${String(payload.name || '').trim()}.`,
  );
}

// Center the scorebug inside the game window (or its display), one axis at
// a time. Behaves exactly like a user drag: absolute placement persists, and
// the anchor offsets are updated so follow-game keeps the centered position.
function centerOverlay(payload = {}) {
  if (!runtime.quickSettingsOpen || !overlayWindow || overlayWindow.isDestroyed()) {
    return statusSnapshot();
  }
  const horizontal = Boolean(payload.horizontal);
  const vertical = Boolean(payload.vertical);
  if (!horizontal && !vertical) return statusSnapshot();
  const reference = referenceBounds();
  if (!reference || !(reference.width > 0) || !(reference.height > 0)) return statusSnapshot();
  const bounds = overlayWindow.getBounds();
  if (horizontal) bounds.x = Math.round(reference.x + ((reference.width - bounds.width) / 2));
  if (vertical) bounds.y = Math.round(reference.y + ((reference.height - bounds.height) / 2));
  setOverlayBounds(bounds);
  settings.overlay ||= {};
  if (horizontal) {
    const verticalAnchor = String(settings.overlay.anchor || 'bottom-center').startsWith('top')
      ? 'top' : 'bottom';
    settings.overlay.anchor = `${verticalAnchor}-center`;
    settings.overlay.marginX = 0;
    runtime.layout.anchor = settings.overlay.anchor;
    runtime.layout.right = 0;
  }
  if (vertical) {
    const inset = Math.round((reference.height - bounds.height) / 2);
    settings.overlay.marginY = inset;
    runtime.layout.bottom = inset;
  }
  persistPlacement(bounds, displayForBounds(bounds), { preserveScale: true });
  pushInGameEditorState();
  return statusSnapshot();
}

function setTeamLogoPreference(payload = {}) {
  const side = String(payload.side || '').toLowerCase();
  if (!['away', 'home'].includes(side)) throw new Error('Choose the away or home logo.');
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  const teamId = String(payload.teamId || '').trim();
  const asset = teamAssetResolver?.resolveTeamId(teamId);
  if (!asset) throw new Error('Wait for the reader to detect this team before choosing its logo.');

  const requested = payload.variantId === null || payload.variantId === undefined
    ? null
    : String(payload.variantId).trim().toLowerCase();
  if (requested && !teamLogoVariantResolver?.resolveChoice(teamId, requested, teamAssetResolver)) {
    throw new Error(`That logo is not installed for ${asset.name}.`);
  }

  writeLogoPreference(teamId, requested);
  persistSettings();
  publishCurrentScoreboardState();
  pushInGameEditorState();

  const label = requested
    ? teamLogoVariantResolver.resolveChoice(teamId, requested, teamAssetResolver).label
    : 'automatic default';
  logMessage(`${asset.name} logo preference: ${label}. Automatic team detection remains active.`);
  return inGameEditorState();
}

function currentLogoContext(payload = {}) {
  const side = String(payload.side || '').toLowerCase();
  if (!['away', 'home'].includes(side)) throw new Error('Choose the away or home logo.');
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  const state = logoChoicesForSide(side);
  const teamId = String(payload.teamId || state.teamId || '').trim();
  if (!state.teamId || teamId !== state.teamId) {
    throw new Error('The detected team changed. Open its logo controls again.');
  }
  const variantId = String(payload.variantId || state.activeVariantId || 'default').trim().toLowerCase();
  const choice = teamLogoVariantResolver?.resolveChoice(teamId, variantId, teamAssetResolver);
  if (!choice) throw new Error(`That logo is not installed for ${state.teamName || 'this team'}.`);
  const key = logoLayoutKey(themeSizingKey(runtime.themePath), teamId, variantId, side);
  return { side, teamId, variantId, choice, key, state };
}

async function importTeamLogo(payload = {}) {
  const context = currentLogoContext(payload);
  const parent = inGameEditorWindow && !inGameEditorWindow.isDestroyed()
    ? inGameEditorWindow
    : controlWindow;
  const result = await dialog.showOpenDialog(parent || undefined, {
    title: `Import a logo for ${context.state.teamName}`,
    properties: ['openFile'],
    filters: [
      { name: 'Logo images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.[0]) return inGameEditorState();

  const sourcePath = path.resolve(result.filePaths[0]);
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile() || stats.size > 25 * 1024 * 1024) {
    throw new Error('Choose a logo image smaller than 25 MB.');
  }
  let image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('That file is not a readable logo image.');
  let size = image.getSize();
  if (size.width < 1 || size.height < 1) throw new Error('That logo has no usable pixels.');
  if (size.width > 4096 || size.height > 4096) {
    const ratio = Math.min(4096 / size.width, 4096 / size.height);
    image = image.resize({
      width: Math.max(1, Math.round(size.width * ratio)),
      height: Math.max(1, Math.round(size.height * ratio)),
      quality: 'best',
    });
    size = image.getSize();
  }

  settings.teamLogos ||= {};
  const imported = customTeamLogoStore.importPng({
    teamId: context.teamId,
    label: path.parse(sourcePath).name,
    png: image.toPNG(),
    width: size.width,
    height: size.height,
    catalog: settings.teamLogos.custom,
  });
  settings.teamLogos.custom = imported.catalog;
  writeLogoPreference(context.teamId, imported.entry.id);
  persistSettings();
  publishCurrentScoreboardState();
  pushInGameEditorState();
  logMessage(`${context.state.teamName} custom logo imported and selected. Reader output was not changed.`);
  return inGameEditorState();
}

function deleteImportedTeamLogo(payload = {}) {
  const context = currentLogoContext(payload);
  if (!context.choice.custom) throw new Error('Bundled team logos cannot be deleted.');
  settings.teamLogos ||= {};
  settings.teamLogos.custom = customTeamLogoStore.remove(
    context.variantId,
    settings.teamLogos.custom,
  );
  const preferences = normalizedPreferences(settings.teamLogos.preferences);
  if (preferences[context.teamId] === context.variantId) delete preferences[context.teamId];
  settings.teamLogos.preferences = preferences;
  for (const [key, themed] of Object.entries(themeLogoPreferenceMap())) {
    if (themed?.[context.teamId] === context.variantId) {
      delete themed[context.teamId];
      if (!Object.keys(themed).length) delete themeLogoPreferenceMap()[key];
    }
  }
  const layouts = normalizedLogoLayouts(settings.teamLogos.layouts);
  for (const key of Object.keys(layouts)) {
    if (key.includes(`::${context.teamId}::${context.variantId}::`)) delete layouts[key];
  }
  settings.teamLogos.layouts = layouts;
  runtime.logoTransformDrafts.delete(context.key);
  persistSettings();
  publishCurrentScoreboardState();
  pushInGameEditorState();
  logMessage(`${context.state.teamName} imported logo removed. Automatic team detection remains active.`);
  return inGameEditorState();
}

// ---- Dynasty save context ---------------------------------------------------
// The dynasty save knows things the game's memory does not show the reader:
// records and polls from kickoff, the week/bowl/playoff label, network,
// weather, season totals and each team's offensive leaders. A utility
// process reads the newest DYNASTY save (read-only) whenever it changes; the
// result is layered onto the published state (record/rank only fill blanks).
function dynastySettings() {
  settings.dynasty ||= {};
  return settings.dynasty;
}

function dynastySavesFolders() {
  const configured = String(dynastySettings().savesFolder || '').trim();
  const folders = [];
  if (configured) folders.push(configured);
  const home = app.getPath('home');
  const gameFolder = gameTitle() === 'madden27' ? 'Madden NFL 27' : 'EA Sports College Football 27';
  folders.push(path.join(home, 'OneDrive', 'Documents', gameFolder, 'saves'));
  folders.push(path.join(app.getPath('documents'), gameFolder, 'saves'));
  return [...new Set(folders)];
}

// Franchise files in Madden are CAREER/FRANCHISE; dynasty files in CFB27 are
// DYNASTY. Each game only ever looks for its own prefix.
function dynastySaveNamePattern() {
  return gameTitle() === 'madden27' ? /^(CAREER|FRANCHISE)/i : /^DYNASTY/i;
}

function listDynastySaves() {
  const all = [];
  for (const folder of dynastySavesFolders()) {
    try {
      if (!fs.existsSync(folder)) continue;
      for (const name of fs.readdirSync(folder)) {
        if (!dynastySaveNamePattern().test(name) || /\.(bak|tmp)$/i.test(name)) continue;
        const full = path.join(folder, name);
        const stat = fs.statSync(full);
        if (stat.isFile()) all.push({ name, full, mtimeMs: stat.mtimeMs, size: stat.size, modified: stat.mtime.toISOString() });
      }
    } catch { /* next */ }
  }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return all;
}

function newestDynastySave() {
  const chosen = String(dynastySettings().savePath || '').trim();
  if (chosen && fs.existsSync(chosen)) {
    const stat = fs.statSync(chosen);
    return { full: chosen, mtimeMs: stat.mtimeMs, size: stat.size, pinned: true };
  }
  for (const folder of dynastySavesFolders()) {
    try {
      if (!fs.existsSync(folder)) continue;
      const files = fs.readdirSync(folder)
        .filter((name) => /^DYNASTY/i.test(name) && !/\.(bak|tmp)$/i.test(name))
        .map((name) => { const full = path.join(folder, name); const stat = fs.statSync(full); return stat.isFile() ? { full, mtimeMs: stat.mtimeMs, size: stat.size } : null; })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (files.length) return files[0];
    } catch { /* next folder */ }
  }
  return null;
}

let dynastyPollTimer = null;
let dynastyWorkerBusy = false;
let dynastyLastKey = '';
let dynastyLeaderKey = '';
let dynastyRefreshQueued = false;
let dynastyRefreshQueuedForce = false;
let dynastyFailurePath = '';
let dynastyFailureSinceMs = 0;
const DYNASTY_SAME_SAVE_FAILURE_GRACE_MS = 60000;

function dynastySaveKey(save) {
  return save ? `${save.full}|${Math.round(save.mtimeMs)}|${save.size}` : '';
}

function copyThemeProfileToRepairedHash(oldSha256, newSha256) {
  const oldKey = `sha256:${String(oldSha256 || '').toLowerCase()}`;
  const newKey = `sha256:${String(newSha256 || '').toLowerCase()}`;
  if (oldKey === newKey || oldKey === 'sha256:' || newKey === 'sha256:') return false;
  let changed = false;
  const copyEntry = (map) => {
    if (!isPlainObject(map?.[oldKey]) || map[newKey] !== undefined) return;
    map[newKey] = cloneJson(map[oldKey]);
    changed = true;
  };
  settings.theme ||= {};
  settings.teamLogos ||= {};
  copyEntry(settings.theme.sizingByHtml);
  copyEntry(settings.theme.settingsByHtml);
  copyEntry(settings.teamLogos.preferencesByTheme);

  const layouts = normalizedLogoLayouts(settings.teamLogos.layouts);
  for (const [key, value] of Object.entries(layouts)) {
    if (!key.startsWith(`${oldKey}::`)) continue;
    const moved = `${newKey}${key.slice(oldKey.length)}`;
    if (!layouts[moved]) {
      layouts[moved] = value;
      changed = true;
    }
  }
  settings.teamLogos.layouts = layouts;
  try {
    const oldSnapshot = themeSnapshotPath(oldSha256);
    const newSnapshot = themeSnapshotPath(newSha256);
    if (oldSnapshot && newSnapshot && fs.existsSync(oldSnapshot) && !fs.existsSync(newSnapshot)) {
      fs.copyFileSync(oldSnapshot, newSnapshot);
      changed = true;
    }
  } catch { /* preview only */ }
  return changed;
}

function repairKnownThemeLibraryBugs() {
  const repaired = themeLibraryStore().repairKnownThemes();
  if (!repaired.length) return repaired;
  for (const item of repaired) {
    copyThemeProfileToRepairedHash(item.oldSha256, item.newSha256);
    const details = [];
    if (item.repairs.includes('allow-team-name-ampersand')) details.push('team names containing & now display correctly');
    if (item.repairs.includes('fox-v7-live-identity')) details.push('live team names and ranks now replace preview text');
    logMessage(`Repaired ${item.name}: ${details.join('; ') || 'known compatibility update applied'}.`);
  }
  persistSettings();
  return repaired;
}

function queueDynastyRefresh(force = false) {
  dynastyRefreshQueued = true;
  dynastyRefreshQueuedForce ||= force;
}

function runQueuedDynastyRefresh() {
  if (dynastyWorkerBusy || !dynastyRefreshQueued) return;
  const force = dynastyRefreshQueuedForce;
  dynastyRefreshQueued = false;
  dynastyRefreshQueuedForce = false;
  setImmediate(() => { refreshDynastyContext({ force }).catch(() => {}); });
}

function dynastyRequestIsCurrent(save, key) {
  if (dynastySettings().enabled === false) return false;
  try {
    const current = newestDynastySave();
    return Boolean(current && samePath(current.full, save.full) && dynastySaveKey(current) === key);
  } catch { return false; }
}

function dynastyWorkerScript() {
  // The worker requires madden-franchise, which must live outside the asar.
  return path.join(__dirname, 'dynasty-context-worker.js');
}

function runDynastyWorker(savePath, { teams = null } = {}) {
  return new Promise((resolve, reject) => {
    const args = [savePath];
    if (gameTitle() === 'madden27') args.push('--madden', '27');
    if (Array.isArray(teams) && teams.length) args.push('--teams', teams.join(','));
    let child;
    try {
      child = utilityProcess.fork(dynastyWorkerScript(), args, { serviceName: 'cfb27-dynasty-context', stdio: 'ignore' });
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; try { child.kill(); } catch { } reject(new Error('dynasty read timed out')); } }, 90000);
    child.on('message', (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message?.ok) resolve(message.context);
      else reject(new Error(message?.error || 'dynasty read failed'));
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`dynasty worker exited (${code})`));
    });
  });
}

async function refreshDynastyContext({ force = false } = {}) {
  if (dynastySettings().enabled === false) {
    dynastyRefreshQueued = false;
    dynastyRefreshQueuedForce = false;
    if (clearLoadedDynastyContext()) publishCurrentScoreboardState();
    return;
  }
  const newest = newestDynastySave();
  if (!newest) {
    dynastyRefreshQueued = false;
    dynastyRefreshQueuedForce = false;
    if (clearLoadedDynastyContext()) publishCurrentScoreboardState();
    return;
  }
  if (runtime.dynasty?.savePath && !samePath(runtime.dynasty.savePath, newest.full)) {
    // A different selected/newest save may describe a completely different
    // Dynasty. Do not serve the previous save while this one is queued/read.
    if (clearLoadedDynastyContext()) {
      publishCurrentScoreboardState();
      broadcastStatus();
    }
  }
  if (dynastyWorkerBusy) {
    queueDynastyRefresh(force);
    return;
  }
  const key = dynastySaveKey(newest);
  if (!force && key === dynastyLastKey) return;
  // A save being written grows for a moment: wait until it has been quiet for 5 s.
  if (Date.now() - newest.mtimeMs < 5000) return;
  dynastyWorkerBusy = true;
  let loaded = false;
  let cleared = false;
  try {
    const context = await runDynastyWorker(newest.full);
    if (!dynastyRequestIsCurrent(newest, key)) {
      // Settings/save changed while the worker was reading. Never let an
      // obsolete result repopulate the resolver; service the newest request.
      let current = null;
      try { current = newestDynastySave(); } catch { current = null; }
      if (runtime.dynasty?.savePath
          && (!current || !samePath(runtime.dynasty.savePath, current.full))) {
        cleared = clearLoadedDynastyContext();
      }
      if (dynastySettings().enabled !== false) queueDynastyRefresh(true);
    } else {
      if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
      runtime.dynasty = {
        context,
        byAsset: new Map(),
        byPresentationId: new Map(),
        synthesizedTeams: [],
        leaders: {},
        savePath: newest.full,
        pinned: Boolean(newest.pinned),
        loadedAt: new Date().toISOString(),
      };
      const synthesized = reindexDynastyTeams();
      dynastyLastKey = key;
      dynastyLeaderKey = '';
      dynastyFailurePath = '';
      dynastyFailureSinceMs = 0;
      logMessage(`Dynasty save read: ${path.basename(newest.full)} - ${context.season?.seasonYear ?? '?'} ${context.season?.currentWeekType || ''} week ${context.season?.currentWeek ?? '?'}, ${context.teams?.length || 0} teams, ${context.gamesThisWeek?.length || 0} games this week (${runtime.dynasty.byAsset.size} of ${context.teams?.length || 0} identified; ${synthesized} from the save only${synthesized ? `: ${runtime.dynasty.synthesizedTeams.join(', ')}` : ''}).`);
      loaded = true;
    }
  } catch (error) {
    if (!dynastyRequestIsCurrent(newest, key)) {
      if (dynastySettings().enabled !== false) queueDynastyRefresh(true);
    } else {
      logMessage(`Dynasty save could not be read: ${error.message}`);
      const retainingSameSave = runtime.dynasty?.savePath
        && samePath(runtime.dynasty.savePath, newest.full);
      if (retainingSameSave) {
        if (!dynastyFailurePath || !samePath(dynastyFailurePath, newest.full)) {
          dynastyFailurePath = newest.full;
          dynastyFailureSinceMs = Date.now();
        }
        if (Date.now() - dynastyFailureSinceMs >= DYNASTY_SAME_SAVE_FAILURE_GRACE_MS) {
          cleared = clearLoadedDynastyContext();
        }
      } else {
        cleared = clearLoadedDynastyContext();
      }
      // Leave dynastyLastKey unchanged so polling retries a transient failure.
    }
  } finally {
    dynastyWorkerBusy = false;
  }
  if (loaded || cleared) {
    // Publish AFTER the busy flag drops so the leaders request can start.
    publishCurrentScoreboardState();
    broadcastStatus();
  }
  runQueuedDynastyRefresh();
}

function clearLoadedDynastyContext() {
  const changed = Boolean(runtime.dynasty || dynastyLastKey || dynastyLeaderKey);
  runtime.dynasty = null;
  dynastyLastKey = '';
  dynastyLeaderKey = '';
  dynastyFailurePath = '';
  dynastyFailureSinceMs = 0;
  teamAssetResolver?.setDynastyTeams?.([]);
  return changed;
}

// Once the live matchup is known, fetch the two teams' offensive leaders.
function maybeRequestDynastyLeaders() {
  const dynasty = runtime.dynasty;
  if (!dynasty?.context || dynastyWorkerBusy) return;
  const away = runtime.scoreboardState?.meta?.teamAssets?.away?.id;
  const home = runtime.scoreboardState?.meta?.teamAssets?.home?.id;
  if (!away || !home) return;
  const awayTeam = dynasty.byAsset.get(String(away));
  const homeTeam = dynasty.byAsset.get(String(home));
  if (!awayTeam || !homeTeam) return;
  const key = `${dynasty.savePath}|${awayTeam.index}|${homeTeam.index}`;
  if (key === dynastyLeaderKey) return;
  dynastyLeaderKey = key;
  dynastyWorkerBusy = true;
  runDynastyWorker(dynasty.savePath, { teams: [awayTeam.index, homeTeam.index] })
    .then((context) => {
      if (runtime.dynasty && runtime.dynasty.savePath === dynasty.savePath) {
        runtime.dynasty.leaders = context.leaders || {};
        logMessage(`Dynasty leaders loaded for ${awayTeam.name} and ${homeTeam.name}.`);
        publishCurrentScoreboardState();
      }
    })
    .catch((error) => logMessage(`Dynasty leaders could not be read: ${error.message}`))
    .finally(() => { dynastyWorkerBusy = false; runQueuedDynastyRefresh(); });
}

const dynastyFolderWatchers = new Map();
let dynastyWatchDebounce = null;

// React to a save being written (advance week, autosave) within seconds
// instead of waiting for the next poll, so records/ranks/names come from
// the current week the moment the game is loaded. The 20 s poll stays as
// the safety net (fs.watch is best-effort on OneDrive folders).
function watchDynastyFolders() {
  for (const folder of dynastySavesFolders()) {
    if (dynastyFolderWatchers.has(folder) || !fs.existsSync(folder)) continue;
    try {
      const watcher = fs.watch(folder, { persistent: false }, () => {
        clearTimeout(dynastyWatchDebounce);
        // The save grows while it is written; refresh once it has settled.
        dynastyWatchDebounce = setTimeout(() => { refreshDynastyContext().catch(() => {}); }, 6000);
      });
      watcher.on('error', () => { try { watcher.close(); } catch { } dynastyFolderWatchers.delete(folder); });
      dynastyFolderWatchers.set(folder, watcher);
    } catch { /* polling covers it */ }
  }
}

function startDynastyWatch() {
  if (dynastyPollTimer) return;
  refreshDynastyContext().catch(() => {});
  watchDynastyFolders();
  dynastyPollTimer = setInterval(() => { watchDynastyFolders(); refreshDynastyContext().catch(() => {}); }, 20000);
  dynastyPollTimer.unref?.();
}

// ---- Tester notes + test package export -----------------------------------
function testerNotesPath() { return path.join(dataExportRootPath(), 'tester-notes.json'); }

function saveTesterNotes(payload = {}) {
  const notes = {};
  for (const key of ['flags', 'playPicker', 'halftimeStats', 'finalStats', 'other']) {
    notes[key] = String(payload?.[key] ?? '').slice(0, 20000);
  }
  notes.savedAt = new Date().toISOString();
  notes.appVersion = app.getVersion();
  fs.mkdirSync(dataExportRootPath(), { recursive: true });
  fs.writeFileSync(testerNotesPath(), `${JSON.stringify(notes, null, 2)}\n`, 'utf8');
  return notes;
}

function loadTesterNotes() {
  return readJsonFile(testerNotesPath(), {});
}

// Zip data-export (probes, latest-state, notes) + logs to the Desktop and
// reveal it, so a tester can send one file.
async function exportTestPackage() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const desktop = app.getPath('desktop');
  const target = path.join(desktop, `CFB27-test-package-${stamp}.zip`);
  const sources = [dataExportRootPath(), logsPath()].filter((folder) => fs.existsSync(folder));
  if (!sources.length) throw new Error('Nothing to package yet - play a game first.');
  const staging = path.join(app.getPath('temp'), `cfb27-test-package-${stamp}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const folder of sources) {
    fs.cpSync(folder, path.join(staging, path.basename(folder)), { recursive: true, filter: (src) => !/ram-live-profile-cache\.json$/.test(src) });
  }
  fs.writeFileSync(path.join(staging, 'README.txt'), `CFB27 Scorebug Center test package\nApp ${app.getVersion()} - ${new Date().toISOString()}\nContents: data-export (probe logs, latest-state.json, tester-notes.json), logs.\n`, 'utf8');
  await new Promise((resolve, reject) => {
    const script = `Compress-Archive -Path '${staging.replace(/'/g, "''")}\*' -DestinationPath '${target.replace(/'/g, "''")}' -Force`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 300)));
      else resolve();
    });
  });
  fs.rmSync(staging, { recursive: true, force: true });
  shell.showItemInFolder(target);
  logMessage(`Test package written: ${target}`);
  return { path: target };
}

function dynastyStatusSummary() {
  const dynasty = runtime.dynasty;
  if (dynastySettings().enabled === false) return { enabled: false, text: 'Dynasty save reading is off.' };
  if (!dynasty?.context) {
    const newest = newestDynastySave();
    return { enabled: true, text: newest ? `Reading ${path.basename(newest.full)}…` : 'No dynasty save found (Documents\EA Sports College Football 27\saves).' };
  }
  const season = dynasty.context.season || {};
  const matched = runtime.scoreboardState?.meta?.dynasty?.matched;
  const label = runtime.scoreboardState?.game?.context?.weekLabel || '';
  return {
    enabled: true,
    save: path.basename(dynasty.savePath),
    loadedAt: dynasty.loadedAt,
    season: season.seasonYear ?? null,
    week: season.currentWeek ?? null,
    weekType: season.currentWeekType || null,
    teams: dynasty.context.teams?.length || 0,
    identified: dynasty.byAsset?.size || 0,
    saveOnlyTeams: dynasty.synthesizedTeams || [],
    matched: Boolean(matched),
    userTeam: dynasty.context.teams?.find((t) => t.isUser)?.name || null,
    userGame: (() => { const g = (dynasty.context.gamesThisWeek || []).find((x) => x.index === dynasty.context.userGameIndex); return g ? `${g.awayName || '?'} at ${g.homeName || '?'}` : null; })(),
    text: `${path.basename(dynasty.savePath)}${dynasty.pinned ? ' (chosen)' : ' (newest)'} · ${season.seasonYear ?? '?'} ${label || `week ${season.currentWeek ?? '?'}`} · ${dynasty.byAsset?.size || 0}/${dynasty.context.teams?.length || 0} teams identified${dynasty.synthesizedTeams?.length ? ` (${dynasty.synthesizedTeams.length} by save name only)` : ''}${dynasty.context.teams?.find((t) => t.isUser) ? ` · you: ${dynasty.context.teams.find((t) => t.isUser).name}` : ''}${(() => { const g = (dynasty.context.gamesThisWeek || []).find((x) => x.index === dynasty.context.userGameIndex); return g ? ` · your game: ${g.awayName || '?'} at ${g.homeName || '?'}` : ''; })()}${matched ? ' · live matchup found' : ''}`,
  };
}

// ---- Team catalog with logo thumbnails ------------------------------------
// Pickers show every team's mark, not just its name. Full logos are ~100 KB
// each, so a 72 px thumbnail per team is built once and cached on disk.
const teamThumbCache = new Map();

function logoThumbsRoot() {
  return path.join(app.getPath('userData'), 'logo-thumbs');
}

function teamLogoThumb(asset) {
  if (!asset?.logo) return null;
  const digest = crypto.createHash('sha1').update(asset.logo.length > 4096 ? asset.logo.slice(-4096) + asset.logo.length : asset.logo).digest('hex').slice(0, 10);
  const cacheKey = `${asset.id}-${digest}`;
  if (teamThumbCache.has(cacheKey)) return teamThumbCache.get(cacheKey);
  const file = path.join(logoThumbsRoot(), `${cacheKey}.png`);
  try {
    if (fs.existsSync(file)) {
      const url = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
      teamThumbCache.set(cacheKey, url);
      return url;
    }
    const image = nativeImage.createFromDataURL(asset.logo);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const ratio = Math.min(1, 72 / Math.max(size.width, size.height));
    const thumb = ratio < 1
      ? image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'good' })
      : image;
    fs.mkdirSync(logoThumbsRoot(), { recursive: true });
    const png = thumb.toPNG();
    fs.writeFileSync(file, png);
    const url = `data:image/png;base64,${png.toString('base64')}`;
    teamThumbCache.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

function teamCatalogForPicker() {
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  const teams = scoreboardTeamOptions(teamAssetResolver).map((team) => {
    const asset = teamAssetResolver?.resolveTeamId(team.id);
    return {
      ...team,
      logo: teamLogoThumb(asset),
      primary: asset?.primary || null,
      secondary: asset?.secondary || null,
    };
  });
  return { teams, favoriteTeamId: settings.favoriteTeamId || null };
}

function setFavoriteTeam(payload = {}) {
  const teamId = payload?.teamId === null || payload?.teamId === undefined || payload?.teamId === ''
    ? null
    : String(payload.teamId);
  if (teamId) {
    if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
    if (!teamAssetResolver?.resolveTeamId(teamId)) throw new Error('That team is not in the roster.');
  }
  settings.favoriteTeamId = teamId;
  settings.onboarding = normalizeOnboardingState({ ...(settings.onboarding || {}), favoritePicked: true });
  persistSettings();
  pushInGameEditorState();
  broadcastStatus();
  logMessage(teamId ? `Favorite team: ${teamAssetResolver.resolveTeamId(teamId).name}.` : 'Favorite team cleared.');
  return { favoriteTeamId: settings.favoriteTeamId, onboarding: cloneJson(settings.onboarding) };
}

// ---- Team palette images ---------------------------------------------------
// A team can carry its own color-palette pictures (a brand sheet, a jersey
// photo). They are saved to the team and offered inside the color wheel, where
// hovering the picture previews that pixel's color on the real bug.
function teamPalettesRoot() {
  return path.join(app.getPath('userData'), 'team-palettes');
}

function normalizedTeamPalettes(value) {
  const out = {};
  if (!isPlainObject(value)) return out;
  for (const [teamId, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const clean = list.filter((entry) => entry && /^pal-[a-z0-9]{6,32}$/.test(String(entry.id || '')) && /^pal-[a-z0-9]{6,32}\.png$/.test(String(entry.file || '')))
      .map((entry) => ({ id: String(entry.id), file: String(entry.file), label: String(entry.label || '').slice(0, 60), width: Number(entry.width) || null, height: Number(entry.height) || null, addedAt: String(entry.addedAt || '') }));
    if (clean.length) out[String(teamId)] = clean;
  }
  return out;
}

function teamPaletteList(teamId) {
  return normalizedTeamPalettes(settings.teamPalettes)[String(teamId || '')] || [];
}

function teamPaletteImages(payload = {}) {
  const teamId = String(payload.teamId || '').trim();
  return teamPaletteList(teamId).map((entry) => {
    let image = null;
    try { image = `data:image/png;base64,${fs.readFileSync(path.join(teamPalettesRoot(), entry.file)).toString('base64')}`; } catch { }
    return { ...entry, image };
  }).filter((entry) => entry.image);
}

async function importTeamPalette(payload = {}) {
  const teamId = String(payload.teamId || '').trim();
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  const asset = teamAssetResolver?.resolveTeamId(teamId);
  if (!asset) throw new Error('Palette images are saved to a team - wait for the team to be identified (or pick it) first.');
  const parent = inGameEditorWindow && !inGameEditorWindow.isDestroyed() ? inGameEditorWindow : controlWindow;
  const result = await dialog.showOpenDialog(parent || undefined, {
    title: `Add a color palette image for ${asset.name}`,
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const sourcePath = path.resolve(result.filePaths[0]);
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile() || stats.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  let image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('That file is not a readable image.');
  let size = image.getSize();
  if (size.width > 1024 || size.height > 1024) {
    const ratio = Math.min(1024 / size.width, 1024 / size.height);
    image = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'best' });
    size = image.getSize();
  }
  const id = `pal-${crypto.randomBytes(5).toString('hex')}`;
  const file = `${id}.png`;
  fs.mkdirSync(teamPalettesRoot(), { recursive: true });
  const temporary = path.join(teamPalettesRoot(), `${file}.tmp`);
  fs.writeFileSync(temporary, image.toPNG());
  fs.renameSync(temporary, path.join(teamPalettesRoot(), file));
  const palettes = normalizedTeamPalettes(settings.teamPalettes);
  palettes[teamId] = [...(palettes[teamId] || []), {
    id, file, label: path.parse(sourcePath).name.slice(0, 60), width: size.width, height: size.height, addedAt: new Date().toISOString(),
  }].slice(-12);
  settings.teamPalettes = palettes;
  persistSettings();
  pushInGameEditorState();
  logMessage(`${asset.name}: palette image added.`);
  return { canceled: false, teamId, palettes: teamPaletteImages({ teamId }) };
}

function deleteTeamPalette(payload = {}) {
  const teamId = String(payload.teamId || '').trim();
  const id = String(payload.id || '').trim();
  const palettes = normalizedTeamPalettes(settings.teamPalettes);
  const entry = (palettes[teamId] || []).find((candidate) => candidate.id === id);
  if (!entry) throw new Error('That palette image is already gone.');
  try { fs.unlinkSync(path.join(teamPalettesRoot(), entry.file)); } catch { /* already gone */ }
  palettes[teamId] = palettes[teamId].filter((candidate) => candidate.id !== id);
  if (!palettes[teamId].length) delete palettes[teamId];
  settings.teamPalettes = palettes;
  persistSettings();
  pushInGameEditorState();
  return { teamId, palettes: teamPaletteImages({ teamId }) };
}

// ---- Custom teams -------------------------------------------------------
// TeamBuilder schools and anything else the bundled roster lacks. Stored in
// settings.customTeams; logo PNGs live in UserData/custom-teams/<id>.png.

function customTeamsRoot() {
  return path.join(app.getPath('userData'), 'custom-teams');
}

// Which game the app reads. 'cfb27' is the default and the only fully
// supported game; 'madden27' is EXPERIMENTAL groundwork (reader attaches to
// Madden27.exe and runs its automatic locator, NFL identities load, franchise
// saves are tried). Nothing below changes behaviour unless the user picks
// Madden in Settings.
// 'auto' (the default) follows whichever supported game is actually
// running: CFB27 always wins when both are up, and with neither running the
// app behaves exactly as CFB27 - so for a college-only user nothing ever
// changes. An explicit choice in Settings overrides detection entirely.
let detectedGameTitle = null;

function gameTitle() {
  const explicit = String(settings.gameTitle || 'auto').toLowerCase();
  if (explicit === 'madden27' || explicit === 'cfb27') return explicit;
  return detectedGameTitle || 'cfb27';
}

function noteDetectedGame(windows) {
  if (String(settings.gameTitle || 'auto').toLowerCase() !== 'auto') return;
  const names = new Set((Array.isArray(windows) ? windows : [])
    .map((w) => String(w?.processName || '').toLowerCase().split(/[\/]/).pop()));
  const cfb = names.has('collegefb27.exe') || names.has('collegefb27_trial.exe');
  const madden = names.has('madden27.exe') || names.has('madden27_trial.exe');
  const next = cfb ? 'cfb27' : (madden ? 'madden27' : null);
  if (!next || next === (detectedGameTitle || 'cfb27')) { if (next) detectedGameTitle = next; return; }
  const previous = gameTitle();
  detectedGameTitle = next;
  if (gameTitle() === previous) return;
  logMessage(`Game detected: ${next === 'madden27' ? 'Madden NFL 27 (experimental)' : 'College Football 27'} - switching the reader and team catalog.`);
  try { syncCustomTeamsToResolver(); } catch { /* teams refresh best-effort */ }
  try { stopRamReaderService(); startRamReaderService(); } catch { /* reader restart best-effort */ }
  try { dynastyLastKey = ''; refreshDynastyContext({ force: true }).catch(() => {}); watchDynastyFolders(); } catch { }
  broadcastControlStatus();
}

let nflCatalogCache = null;
function nflCatalogTeams() {
  if (nflCatalogCache) return nflCatalogCache;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'assets', 'nfl-teams.json'), 'utf8'));
    nflCatalogCache = Array.isArray(raw?.teams) ? raw.teams : [];
  } catch { nflCatalogCache = []; }
  return nflCatalogCache;
}

function syncCustomTeamsToResolver() {
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  // Dynamic save aliases can temporarily own a name that a newly imported
  // custom team needs. Clear that layer first, install custom teams, then
  // rebuild the save layer in deterministic precedence order.
  teamAssetResolver?.setDynastyTeams([]);
  const extraTeams = gameTitle() === 'madden27' ? nflCatalogTeams() : [];
  teamAssetResolver?.setCustomTeams([...(Array.isArray(settings.customTeams) ? settings.customTeams : []), ...extraTeams], customTeamsRoot());
  // A new custom team may now cover a save team; rebuild the save index.
  reindexDynastyTeams();
}

// Every team in the loaded save gets an identity: roster/custom teams by
// name, the rest synthesized on the resolver from the save (name, nickname,
// abbreviation, colours). Returns how many had to be synthesized.
function reindexDynastyTeams() {
  const context = runtime.dynasty?.context;
  if (!teamAssetResolver) return 0;
  if (!context) {
    teamAssetResolver.setDynastyTeams([]);
    return 0;
  }
  const synthesized = registerUnmatchedSaveTeams(context, teamAssetResolver);
  runtime.dynasty.byAsset = indexSaveTeams(context, teamAssetResolver);
  runtime.dynasty.byPresentationId = indexSaveTeamsByPresentationId(context);
  runtime.dynasty.synthesizedTeams = synthesized.map((t) => t.name);
  return synthesized.length;
}

function customTeamsForEditor() {
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  return (settings.customTeams || []).map((team) => ({
    ...team,
    logo: teamAssetResolver?.resolveTeamId(team.id)?.logo || null,
  }));
}

function customTeamById(id) {
  const target = String(id || '').trim();
  const team = (settings.customTeams || []).find((entry) => entry.id === target);
  if (!team) throw new Error('That custom team no longer exists.');
  return team;
}

function afterCustomTeamsChanged(message) {
  persistSettings();
  syncCustomTeamsToResolver();
  publishCurrentScoreboardState();
  pushInGameEditorState();
  if (message) logMessage(message);
  return inGameEditorState();
}

function saveCustomTeam(payload = {}) {
  const { teams, team } = upsertCustomTeam(settings.customTeams, payload, {
    makeId: () => crypto.randomBytes(6).toString('hex'),
  });
  settings.customTeams = teams;
  const applyTo = String(payload.applyTo || '').toLowerCase();
  const state = afterCustomTeamsChanged(`Custom team saved: ${team.name}.`);
  if (['away', 'home'].includes(applyTo)) {
    const current = runtime.manualTeamOverrides[applyTo] || {};
    return setManualTeamOverride({ ...current, side: applyTo, teamId: team.id });
  }
  return state;
}

function deleteCustomTeam(payload = {}) {
  const { teams, removed } = removeCustomTeam(settings.customTeams, payload.id);
  if (!removed) throw new Error('That custom team no longer exists.');
  settings.customTeams = teams;
  for (const side of ['away', 'home']) {
    if (String(runtime.manualTeamOverrides[side]?.teamId || '') === removed.id) {
      runtime.manualTeamOverrides[side] = { ...runtime.manualTeamOverrides[side], teamId: null };
    }
  }
  if (settings.teamLogos?.preferences) delete settings.teamLogos.preferences[removed.id];
  if (removed.logoFile) {
    try { fs.unlinkSync(path.join(customTeamsRoot(), removed.logoFile)); } catch { /* already gone */ }
  }
  return afterCustomTeamsChanged(`Custom team removed: ${removed.name}.`);
}

async function importCustomTeamLogo(payload = {}) {
  const team = customTeamById(payload.id);
  const parent = inGameEditorWindow && !inGameEditorWindow.isDestroyed()
    ? inGameEditorWindow
    : controlWindow;
  const result = await dialog.showOpenDialog(parent || undefined, {
    title: `Choose a logo for ${team.name}`,
    properties: ['openFile'],
    filters: [
      { name: 'Logo images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths?.[0]) return inGameEditorState();
  const sourcePath = path.resolve(result.filePaths[0]);
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile() || stats.size > 25 * 1024 * 1024) {
    throw new Error('Choose a logo image smaller than 25 MB.');
  }
  let image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('That file is not a readable logo image.');
  let size = image.getSize();
  if (size.width < 1 || size.height < 1) throw new Error('That logo has no usable pixels.');
  if (size.width > 2048 || size.height > 2048) {
    const ratio = Math.min(2048 / size.width, 2048 / size.height);
    image = image.resize({
      width: Math.max(1, Math.round(size.width * ratio)),
      height: Math.max(1, Math.round(size.height * ratio)),
      quality: 'best',
    });
    size = image.getSize();
  }
  const root = customTeamsRoot();
  fs.mkdirSync(root, { recursive: true });
  const logoFile = `${team.id}.png`;
  const temporary = path.join(root, `${logoFile}.tmp`);
  fs.writeFileSync(temporary, image.toPNG());
  fs.renameSync(temporary, path.join(root, logoFile));
  const { teams } = upsertCustomTeam(settings.customTeams, {
    id: team.id, name: team.name, logoFile, logoWidth: size.width, logoHeight: size.height,
  });
  settings.customTeams = teams;
  return afterCustomTeamsChanged(`${team.name} logo imported.`);
}

function clearCustomTeamLogo(payload = {}) {
  const team = customTeamById(payload.id);
  if (team.logoFile) {
    try { fs.unlinkSync(path.join(customTeamsRoot(), team.logoFile)); } catch { /* already gone */ }
  }
  const { teams } = upsertCustomTeam(settings.customTeams, {
    id: team.id, name: team.name, logoFile: null, logoWidth: null, logoHeight: null,
  });
  settings.customTeams = teams;
  return afterCustomTeamsChanged(`${team.name} logo removed.`);
}

function previewTeamLogoTransform(payload = {}) {
  const context = currentLogoContext(payload);
  const transform = normalizeLogoTransform(payload.transform);
  runtime.logoTransformDrafts.set(context.key, transform);
  sendToOverlay('overlay:team-logo-transform', { side: context.side, transform });
  return transform;
}

function saveTeamLogoTransform(payload = {}) {
  const context = currentLogoContext(payload);
  settings.teamLogos ||= {};
  const layouts = normalizedLogoLayouts(settings.teamLogos.layouts);
  if (payload.reset === true) delete layouts[context.key];
  else layouts[context.key] = normalizeLogoTransform(payload.transform);
  settings.teamLogos.layouts = layouts;
  runtime.logoTransformDrafts.delete(context.key);
  persistSettings();
  publishCurrentScoreboardState();
  pushInGameEditorState();
  logMessage(`${context.state.teamName} ${context.side} logo placement saved for this HTML scoreboard.`);
  return inGameEditorState();
}

async function captureTeamLogoPlacement(payload = {}) {
  const context = currentLogoContext(payload);
  const geometry = runtime.logoGeometry[context.side];
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) {
    throw new Error('Show the scorebug before capturing its logo placement.');
  }
  if (!geometry || Number(geometry.width) <= 0 || Number(geometry.height) <= 0) {
    throw new Error('The live logo position is not ready yet. Wait a moment and try Capture again.');
  }

  const content = overlayWindow.getContentBounds();
  const paddingX = Math.max(48, Math.round(Number(geometry.width) * 1.5));
  const paddingY = Math.max(36, Math.round(Number(geometry.height)));
  const left = Math.min(Math.max(0, content.width - 1), Math.max(0, Math.floor(Number(geometry.x) - paddingX)));
  const top = Math.min(Math.max(0, content.height - 1), Math.max(0, Math.floor(Number(geometry.y) - paddingY)));
  const right = Math.max(left + 1, Math.min(content.width, Math.ceil(Number(geometry.x) + Number(geometry.width) + paddingX)));
  const bottom = Math.max(top + 1, Math.min(content.height, Math.ceil(Number(geometry.y) + Number(geometry.height) + paddingY)));
  const captureBounds = {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
  const image = await overlayWindow.webContents.capturePage(captureBounds);
  if (image.isEmpty()) throw new Error('The scorebug capture was empty.');
  return {
    side: context.side,
    teamId: context.teamId,
    variantId: context.variantId,
    image: image.toDataURL(),
    width: captureBounds.width,
    height: captureBounds.height,
    logoBounds: {
      x: Number(geometry.x) - captureBounds.x,
      y: Number(geometry.y) - captureBounds.y,
      width: Number(geometry.width),
      height: Number(geometry.height),
    },
    transform: normalizeLogoTransform(context.state.transform),
    overlayScale: Math.max(0.1, Number(runtime.layout.scale) || 1),
    capturedAt: new Date().toISOString(),
  };
}

function reportTeamLogoGeometry(payload = {}) {
  const side = payload.side === 'home' ? 'home' : (payload.side === 'away' ? 'away' : null);
  if (!side) throw new Error('Logo geometry requires an away or home side.');
  if (payload.visible === false || !payload.bounds) {
    runtime.logoGeometry[side] = null;
  } else {
    const bounds = payload.bounds;
    const numbers = ['x', 'y', 'width', 'height'].map((field) => Number(bounds[field]));
    if (!numbers.every(Number.isFinite)) throw new Error('Logo geometry requires numeric bounds.');
    runtime.logoGeometry[side] = {
      x: Math.max(-5000, Math.min(5000, numbers[0])),
      y: Math.max(-5000, Math.min(5000, numbers[1])),
      width: Math.max(1, Math.min(5000, numbers[2])),
      height: Math.max(1, Math.min(5000, numbers[3])),
      measuredAt: Date.now(),
    };
  }
  sendToInGameEditor('in-game-editor:logo-geometry', {
    side,
    bounds: cloneJson(runtime.logoGeometry[side]),
  });
  return runtime.logoGeometry[side];
}

function resetClockPresentation() {
  gameClockPresentation.reset();
  playClockPresentation.reset();
}

function applyClockPresentation(payload, result, source) {
  if (source !== 'local-ocr' || !result?.visible) {
    resetClockPresentation();
    return payload;
  }

  const confirmed = new Set(confirmedClockFields(result));
  const observedAt = Number(result.timestampMs) || Date.now();
  if (confirmed.has('gameClock')) {
    gameClockPresentation.observe(payload.game?.clock, observedAt);
  }
  if (confirmed.has('playClock')) {
    playClockPresentation.observe(payload.game?.playClock, observedAt);
  }

  const gameClock = gameClockPresentation.read(observedAt).value;
  const playClock = playClockPresentation.read(observedAt).value;
  if (gameClock !== null) payload.game.clock = gameClock;
  if (playClock !== null) payload.game.playClock = playClock;
  return payload;
}

function publishClockPresentationTick() {
  if (!runtime.started || settings.recognition?.mode !== 'local-ocr') return;
  if (runtime.ramScoreboardState?.game?.clock) return;
  const now = Date.now();
  const gameClock = gameClockPresentation.read(now).value;
  const playClock = playClockPresentation.read(now).value;
  const currentGame = runtime.scoreboardState.game || {};
  const nextGame = { ...currentGame };
  if (gameClock !== null) nextGame.clock = gameClock;
  if (playClock !== null) nextGame.playClock = playClock;
  if (nextGame.clock === currentGame.clock && nextGame.playClock === currentGame.playClock) return;

  runtime.scoreboardState = {
    ...runtime.scoreboardState,
    game: nextGame,
  };
  runtime.readerScoreboardState = {
    ...runtime.readerScoreboardState,
    game: {
      ...(runtime.readerScoreboardState.game || {}),
      clock: nextGame.clock,
      playClock: nextGame.playClock,
    },
  };
  sendToOverlay('overlay:scoreboard-state', runtime.scoreboardState);
  sendToControl('scoreboard:state', runtime.scoreboardState);
}

function startClockPresentationTicker() {
  if (clockPresentationTimer) return;
  clockPresentationTimer = setInterval(publishClockPresentationTick, 100);
  clockPresentationTimer.unref?.();
}

function stopClockPresentationTicker() {
  if (clockPresentationTimer) clearInterval(clockPresentationTimer);
  clockPresentationTimer = null;
  resetClockPresentation();
}

function configuredThemePath() {
  const configured = resolveThemePath(settings.theme?.path);
  if (configured) return configured;

  // Keep the approved ESPN 2013 design inside the app so a moved Downloads
  // folder cannot silently switch the overlay back to the generic scorebug.
  const bundledTheme = bundledOriginalThemePath();
  if (bundledTheme) return bundledTheme;

  const fallback = settings.theme?.fallback || defaults.theme?.fallback || 'themes/espn-2013/index.html';
  const fallbackPath = path.isAbsolute(fallback) ? fallback : path.join(app.getAppPath(), fallback);
  return resolveThemePath(fallbackPath) || findDefaultTheme();
}

function applyPlacementSettings({ restoreLocked = false } = {}) {
  const canvasWidth = clampInteger(settings.theme?.canvasWidth, DEFAULT_SIZE.width, 160, 5000);
  const canvasHeight = clampInteger(settings.theme?.canvasHeight, DEFAULT_SIZE.height, 32, 3000);
  settings.overlay ||= {};
  const resolution = resolveScaleSettings(settings.overlay, defaults.overlay?.scale || 0.5);
  const scale = Math.min(2, Math.max(0.1, resolution.scale));
  const scaleAt2160 = scaleAt2160FromEffective(
    scale,
    resolution.outputResolution,
    resolution.scaleAt2160,
  );
  settings.overlay.outputResolution = resolution.outputResolution;
  settings.overlay.scaleAt2160 = scaleAt2160;
  settings.overlay.scale = scale;
  const crop = normalizeThemeCrop(settings.theme?.crop, canvasWidth, canvasHeight);
  settings.theme.crop = crop;
  const visibleCanvas = visibleThemeCanvas({ canvasWidth, canvasHeight, crop });
  runtime.layout = normalizeLayout({
    anchor: settings.overlay?.anchor || DEFAULT_LAYOUT.anchor,
    right: settings.overlay?.marginX ?? DEFAULT_LAYOUT.right,
    bottom: settings.overlay?.marginY ?? DEFAULT_LAYOUT.bottom,
    width: Math.round(visibleCanvas.width * scale),
    height: Math.round(visibleCanvas.height * scale),
  });
  runtime.layout.canvasWidth = canvasWidth;
  runtime.layout.canvasHeight = canvasHeight;
  runtime.layout.authoredCanvas = themeUsesAuthoredCanvas(runtime.themePath, canvasWidth, canvasHeight);
  runtime.layout.crop = crop;
  // If the box had to shrink to fit (normalizeLayout keeps its aspect), the
  // scale the guest paints at must shrink with it or the art overflows the
  // window and gets cropped on the right and bottom.
  runtime.layout.scale = Math.min(scale, runtime.layout.width / visibleCanvas.width, runtime.layout.height / visibleCanvas.height);
  runtime.layout.scaleAt2160 = scaleAt2160;
  runtime.layout.outputResolution = resolution.outputResolution;

  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (runtime.positionLocked && restoreLocked) {
    restoreLockedPlacement();
  } else if (runtime.positionLocked || runtime.editMode) {
    const current = overlayWindow.getBounds();
    const display = displayForBounds(current);
    const resized = resizeBoundsAroundAnchor(
      current,
      runtime.layout.width,
      runtime.layout.height,
      runtime.layout.anchor,
    );
    const bounds = sanitizeBounds(resized, display, current);
    runtime.layout.width = bounds.width;
    runtime.layout.height = bounds.height;
    runtime.layout.scale = Math.min(runtime.layout.scale, bounds.width / visibleCanvas.width, bounds.height / visibleCanvas.height);
    setOverlayBounds(bounds);
    if (runtime.positionLocked) persistPlacement(bounds, display, { preserveScale: true });
  } else {
    positionOverlay({ force: true, restoreDisplaySize: false });
  }
  sendToOverlay('overlay:layout', runtime.layout);
}

async function saveSettings(nextSettings) {
  if (!isPlainObject(nextSettings)) throw new Error('Settings must be a JSON object.');
  const previousDynastySettings = JSON.stringify(settings.dynasty || {});
  const previousScoreboardDataSource = scoreboardDataSourceMode();
  const previousExplicitSourceId = String(settings.capture?.sourceId || '');
  const previousThemePath = runtime.themePath;
  const previousThemeSizing = previousThemePath ? currentThemeSizingSnapshot() : null;
  const previousThemeSizingMap = cloneJson(settings.theme?.sizingByHtml || {});
  const livePlacementSettings = {
    positionLocked: runtime.positionLocked,
    lastDisplayId: settings.overlay?.lastDisplayId || '',
    placements: settings.overlay?.placements || {},
  };
  const liveProfileOverrides = cloneJson(settings.capture?.profileOverrides || {});
  const liveReaderCalibration = cloneJson(settings.capture?.readerCalibration || null);
  const liveReaderCalibrationProfileKey = normalizeProfileKey(
    settings.capture?.readerCalibrationProfileKey,
    null,
  );
  settings = deepMerge(defaults, nextSettings);
  settings.dataExtraction ||= {};
  settings.dataExtraction.scoreboardSource = scoreboardDataSourceMode(settings);
  settings.recognition ||= {};
  settings.recognition.readingProfile = normalizeReadingProfile(settings.recognition.readingProfile);
  settings.theme ||= {};
  settings.theme.sizingByHtml = {
    ...previousThemeSizingMap,
    ...(isPlainObject(settings.theme.sizingByHtml) ? settings.theme.sizingByHtml : {}),
  };
  if (previousThemePath && previousThemeSizing) {
    const previousKey = themeSizingKey(previousThemePath);
    if (previousKey) settings.theme.sizingByHtml[previousKey] = previousThemeSizing;
  }
  settings.theme.chromaKey = normalizeGreenScreen(settings.theme.chromaKey);
  settings.scorebugColors = normalizeScorebugColors(settings.scorebugColors);
  settings.onboarding = normalizeOnboardingState(settings.onboarding);
  settings.overlay = deepMerge(settings.overlay || {}, livePlacementSettings);
  settings.overlay = applyResolutionSettings(settings.overlay, defaults.overlay?.scale || 0.5);
  settings.capture ||= {};
  settings.capture.profileOverrides = liveProfileOverrides;
  settings.capture.readerCalibration = liveReaderCalibration;
  settings.capture.readerCalibrationProfileKey = liveReaderCalibrationProfileKey;
  if (String(settings.capture.sourceId || '') !== previousExplicitSourceId) {
    // A different manual pick (or a return to auto-detect) must revalidate by
    // title before its id becomes session-trusted again.
    runtime.trustedExplicitSourceId = '';
  }
  const activeProfile = applyActiveReaderProfile(settings);
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  const selectedTheme = configuredThemePath();
  if (selectedTheme && (!samePath(selectedTheme, runtime.themePath) || runtime.mockMode)) {
    setTheme(selectedTheme, settings.theme, { rememberPrevious: false });
  } else {
    applyPlacementSettings();
    rememberThemeSizing(runtime.themePath);
    persistSettings();
  }
  if (JSON.stringify(settings.dynasty || {}) !== previousDynastySettings) {
    // Disabling clears immediately; folder/save changes start now or queue
    // behind an in-flight read. Obsolete worker results are rejected on commit.
    refreshDynastyContext({ force: true }).catch(() => {});
  }
  applyWindowBehaviorSettings();
  runtime.automaticEnabled = settings.overlay?.autoHide !== false;
  registerShortcuts();
  startWindowProbe();
  await scanForGameWindow();
  await configureReader();
  const nextScoreboardDataSource = scoreboardDataSourceMode();
  applyScoreboardDataSourcePreference({
    publish: nextScoreboardDataSource !== previousScoreboardDataSource,
    announce: nextScoreboardDataSource !== previousScoreboardDataSource,
  });
  logMessage(`Settings saved and applied (${activeProfile.key} ${activeProfile.origin} reader profile).`);
  broadcastStatus();
  return settings;
}

function normalizeOnboardingState(value = {}) {
  const step = Number(value?.step);
  return {
    version: ONBOARDING_VERSION,
    completed: value?.completed === true,
    skipped: value?.skipped === true,
    welcomeShown: value?.welcomeShown === true,
    favoritePicked: value?.favoritePicked === true,
    step: Number.isInteger(step) ? Math.max(0, Math.min(4, step)) : 0,
  };
}

function saveOnboarding(payload = {}) {
  settings.onboarding = normalizeOnboardingState(payload);
  persistSettings();
  logMessage(settings.onboarding.welcomeShown
    ? 'Welcome message acknowledged.'
    : (settings.onboarding.completed
      ? 'First-run setup completed.'
      : (settings.onboarding.skipped ? 'First-run setup skipped.' : `First-run setup saved at step ${settings.onboarding.step + 1}.`)));
  return cloneJson(settings.onboarding);
}

async function applyPortableReaderCalibration(calibration, profiles, actionLabel, profileKey) {
  settings.capture ||= {};
  settings.capture.readerCalibration = cloneJson(calibration);
  settings.capture.readerCalibrationProfileKey = profileKey;
  settings.capture.profileOverrides = {
    ...(isPlainObject(settings.capture.profileOverrides)
      ? settings.capture.profileOverrides
      : {}),
    ...cloneJson(profiles),
  };
  const activeProfile = applyActiveReaderProfile(settings);
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  persistSettings();
  await configureReader();
  logMessage(`${actionLabel} applied to the ${profileKey} profile only; reader restarted.`);
  broadcastStatus();
  return activeProfile;
}

function portableCalibrationResult(calibration, activeProfile, sourceWidth, sourceHeight, extra = {}) {
  let currentReadRegion = cloneJson(calibration.readRegion);
  if (Number(sourceWidth) > 0 && Number(sourceHeight) > 0) {
    try {
      currentReadRegion = cloneJson(adaptReaderCalibrationReadRegion(
        calibration,
        Number(sourceWidth),
        Number(sourceHeight),
      ));
    } catch {
      // The calibration remains valid for all supported profiles even if a
      // transient window shape cannot show its height-relative position.
    }
  }
  return {
    saved: true,
    settings,
    profiles: publicReaderProfiles(),
    profile: activeProfile,
    savedProfileKey: settings.capture?.readerCalibrationProfileKey || null,
    currentReadRegion,
    currentRois: cloneJson(calibration.rois),
    ...extra,
  };
}

function readerCalibrationDialogParent() {
  return controlWindow && !controlWindow.isDestroyed()
    ? controlWindow
    : (overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : undefined);
}

function safeReaderCalibrationFileName(filePath) {
  return path.basename(String(filePath || ''))
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 200);
}

function freshCalibrationSnapshotTarget(payload, actionLabel) {
  const key = normalizeProfileKey(payload?.key, null);
  const sourceWidth = Number(payload.sourceWidth);
  const sourceHeight = Number(payload.sourceHeight);
  const snapshotKey = normalizeProfileKey(runtime.capture.calibrationProfileKey, null);
  const snapshotWidth = Number(runtime.capture.calibrationSourceWidth);
  const snapshotHeight = Number(runtime.capture.calibrationSourceHeight);
  const dimensionsMatch = Number.isFinite(sourceWidth)
    && sourceWidth > 0
    && Number.isFinite(sourceHeight)
    && sourceHeight > 0
    && sourceWidth === snapshotWidth
    && sourceHeight === snapshotHeight;
  if (!key || key !== snapshotKey || !dimensionsMatch) {
    throw new Error(`Capture a fresh game picture for the selected resolution before ${actionLabel}.`);
  }
  return { key, sourceWidth, sourceHeight };
}

async function saveAndExportReaderCalibration(payload = {}) {
  const { key, sourceWidth, sourceHeight } = freshCalibrationSnapshotTarget(payload, 'saving');
  const calibration = createReaderCalibrationFile({
    referenceAspectRatio: sourceWidth / sourceHeight,
    readRegion: payload.readRegion,
    rois: payload.rois,
    roiSpace: payload.roiSpace || 'read-region',
  });
  const profiles = materializeReaderProfileOverrides(getReaderProfileCatalog(), calibration, key);
  const activeProfile = await applyPortableReaderCalibration(
    calibration,
    profiles,
    'Portable reader calibration',
    key,
  );

  const result = await dialog.showSaveDialog(readerCalibrationDialogParent(), {
    title: 'Save portable reader file',
    defaultPath: path.join(
      app.getPath('documents'),
      `CFB27-Reader-Calibration.${READER_CALIBRATION_EXTENSION}`,
    ),
    filters: [{
      name: 'CFB27 reader calibration',
      extensions: [READER_CALIBRATION_EXTENSION],
    }],
  });
  if (result.canceled || !result.filePath) {
    logMessage('Reader calibration saved on this PC; portable-file export canceled.');
    return portableCalibrationResult(calibration, activeProfile, sourceWidth, sourceHeight, {
      exported: false,
      canceled: true,
    });
  }
  const destination = path.extname(result.filePath).toLowerCase()
    === `.${READER_CALIBRATION_EXTENSION}`
    ? result.filePath
    : `${result.filePath}.${READER_CALIBRATION_EXTENSION}`;
  try {
    await fs.promises.writeFile(destination, serializeReaderCalibrationFile(calibration), 'utf8');
  } catch (error) {
    throw new Error(`The reader was saved on this PC, but its portable file could not be written (${String(error.code || 'write-failed')}).`);
  }
  const fileName = safeReaderCalibrationFileName(destination);
  logMessage(`Portable reader file exported: ${fileName}.`);
  return portableCalibrationResult(calibration, activeProfile, sourceWidth, sourceHeight, {
    exported: true,
    canceled: false,
    fileName,
  });
}

async function useReaderCalibration(payload = {}) {
  const { key, sourceWidth, sourceHeight } = freshCalibrationSnapshotTarget(payload, 'using this calibration');
  const calibration = createReaderCalibrationFile({
    referenceAspectRatio: sourceWidth / sourceHeight,
    readRegion: payload.readRegion,
    rois: payload.rois,
    roiSpace: payload.roiSpace || 'read-region',
  });
  const profiles = materializeReaderProfileOverrides(getReaderProfileCatalog(), calibration, key);
  const activeProfile = await applyPortableReaderCalibration(
    calibration,
    profiles,
    'Reader calibration',
    key,
  );
  return portableCalibrationResult(calibration, activeProfile, sourceWidth, sourceHeight, {
    used: true,
    exported: false,
    canceled: false,
  });
}

async function importReaderCalibration(profileKeyValue) {
  const key = normalizeProfileKey(profileKeyValue, null);
  const selectedKey = normalizeProfileKey(settings.overlay?.outputResolution, null);
  if (!key || key !== selectedKey) {
    throw new Error('Select the resolution that should receive this reader file, then try again.');
  }
  const result = await dialog.showOpenDialog(readerCalibrationDialogParent(), {
    title: 'Import portable reader file',
    properties: ['openFile'],
    filters: [{
      name: 'CFB27 reader calibration',
      extensions: [READER_CALIBRATION_EXTENSION],
    }],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { imported: false, canceled: true, settings };
  }
  const selected = result.filePaths[0];
  let stat;
  try {
    stat = await fs.promises.lstat(selected);
  } catch (error) {
    throw new Error(`The selected reader calibration could not be opened (${String(error.code || 'open-failed')}).`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('The selected reader calibration must be a regular file.');
  }
  if (stat.size > MAX_READER_CALIBRATION_BYTES) {
    throw new Error(`Reader calibration files cannot exceed ${MAX_READER_CALIBRATION_BYTES} bytes.`);
  }
  let bytes;
  try {
    bytes = await fs.promises.readFile(selected);
  } catch (error) {
    throw new Error(`The selected reader calibration could not be read (${String(error.code || 'read-failed')}).`);
  }
  const calibration = parseReaderCalibrationFile(bytes);
  const profiles = materializeReaderProfileOverrides(getReaderProfileCatalog(), calibration, key);
  const activeProfile = await applyPortableReaderCalibration(
    calibration,
    profiles,
    'Imported reader calibration',
    key,
  );
  const geometry = sourceGeometryForReader(activeProfile, runtime.capture.sourceId || runtime.game.sourceId);
  const fileName = safeReaderCalibrationFileName(selected);
  logMessage(`Portable reader file imported: ${fileName}.`);
  return portableCalibrationResult(
    calibration,
    activeProfile,
    geometry.width,
    geometry.height,
    {
      imported: true,
      canceled: false,
      fileName,
    },
  );
}

async function saveReaderProfile(payload = {}) {
  const key = normalizeProfileKey(payload.key, activeReaderProfileKey());
  if (key !== activeReaderProfileKey()) {
    throw new Error(`Select the ${key} profile before saving its calibration.`);
  }
  // Retain the legacy IPC method for older renderers, but make the server the
  // authority for the protected layout. Client ROIs and non-uniform outer-box
  // dimensions can no longer be written even for the current session.
  const draft = createFactoryResizablePlacementProfile(
    getReaderProfileCatalog(),
    key,
    payload.readRegion || {},
  );
  settings.capture ||= {};
  settings.capture.profileOverrides ||= {};
  removePortableReaderCalibration(settings.capture, key);
  settings.capture.profileOverrides[key] = cloneJson(draft);
  const activeProfile = applyActiveReaderProfile(settings);
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  persistSettings();
  await configureReader();
  logMessage(`${key} reader profile saved and restarted.`);
  broadcastStatus();
  return { settings, profiles: publicReaderProfiles(), profile: activeProfile };
}

async function saveReaderProfilePlacement(payload = {}) {
  const key = normalizeProfileKey(payload.key, null);
  if (!key) throw new Error(`Unsupported reader profile: ${String(payload.key ?? '')}.`);
  if (key !== activeReaderProfileKey()) {
    throw new Error(`Select the ${key} profile before saving its box position.`);
  }
  const draft = createFactoryResizablePlacementProfile(
    getReaderProfileCatalog(),
    key,
    { x: payload.x, y: payload.y, width: payload.width, height: payload.height },
  );
  settings.capture ||= {};
  settings.capture.profileOverrides ||= {};
  removePortableReaderCalibration(settings.capture, key);
  settings.capture.profileOverrides[key] = cloneJson(draft);
  const activeProfile = applyActiveReaderProfile(settings);
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  persistSettings();
  await configureReader();
  logMessage(`${key} reader box geometry saved and restarted.`);
  broadcastStatus();
  return { settings, profiles: publicReaderProfiles(), profile: activeProfile };
}

async function resetReaderProfile(keyValue) {
  const key = normalizeProfileKey(keyValue, activeReaderProfileKey());
  settings.capture ||= {};
  removePortableReaderCalibration(settings.capture, key);
  settings.capture.profileOverrides = resetReaderProfileOverride(
    settings.capture.profileOverrides || {},
    key,
  );
  const activeProfile = applyActiveReaderProfile(settings);
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  persistSettings();
  await configureReader();
  logMessage('Reader calibration reset to the recommended setup for every resolution.');
  broadcastStatus();
  return { settings, profiles: publicReaderProfiles(), profile: activeProfile };
}

async function listCaptureSources() {
  if (!screenCaptureEnabled(settings)) return [];
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((source) => source.name && !/^CFB27 Scoreboard Overlay(?: Version 1\.0)?$/i.test(source.name))
    .map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id || '',
      iconDataUrl: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }));
}

async function scanForGameWindow() {
  let sources;
  try {
    sources = await listCaptureSources();
  } catch (error) {
    runtime.reader.status = 'capture-error';
    runtime.reader.healthy = false;
    validationSession?.recordError('window-scan', error);
    logMessage(`Window scan failed: ${error.message}`);
    broadcastControlStatus();
    return null;
  }

  const detected = selectCaptureSource(sources, {
    explicitSourceId: settings.capture?.sourceId,
    explicitSourceName: settings.capture?.sourceName,
    hwnd: runtime.game.hwnd,
    exactTitle: runtime.game.processName ? runtime.game.title : '',
    windowNameIncludes: settings.game?.windowNameIncludes || [],
    previousSourceId: runtime.game.sourceId,
    trustedExplicitSourceId: runtime.trustedExplicitSourceId,
  });
  const changed = runtime.game.sourceId !== (detected?.id || '');
  if (detected && settings.capture?.sourceId && detected.id === settings.capture.sourceId) {
    // The manual pick was just validated (or session-trusted); keep honoring
    // this id even if the window retitles itself later in the session.
    runtime.trustedExplicitSourceId = detected.id;
  }

  runtime.game = {
    ...runtime.game,
    detected: Boolean(detected),
    title: detected?.name || '',
    sourceId: detected?.id || '',
    lastSeenAt: detected ? Date.now() : runtime.game.lastSeenAt,
  };
  runtime.capture.sourceId = detected?.id || '';
  runtime.capture.sourceName = detected?.name || '';
  runtime.capture.running = Boolean(
    !changed
    && runtime.capture.running
    && runtime.started
    && detected
    && settings.capture?.enabled !== false,
  );
  validationSession?.recordGameWindow(runtime.game);

  if (changed) {
    captureCadenceSourceId = '';
    ocrFieldCadence.reset();
    teamRankMemory.reset();
    stopCaptureStreamQuietly();
    logMessage(detected ? `Game capture window detected: ${detected.name}` : 'Game capture window is not currently detected.');
    if (detected) startWindowProbe();
    else stopWindowProbe();
  }
  if (runtime.started && settings.recognition?.mode === 'local-ocr' && !detected) {
    runtime.reader.status = 'waiting-for-game';
    runtime.reader.healthy = false;
  } else if (runtime.started && settings.recognition?.mode === 'local-ocr'
    && !captureLoopTimer && !ocrWorker) {
    runtime.reader.status = 'ready-for-calibration';
    runtime.reader.healthy = false;
  }

  if (runtime.started && runtime.automaticEnabled && settings.overlay?.hideWhenGameUnfocused !== false) {
    const nonGameMode = settings.recognition?.mode === 'mock' || settings.recognition?.mode === 'manual';
    const donorAllowed = settings.overlay?.autoHide === false || Boolean(validator?.visible);
    const focusAllowed = settings.overlay?.hideWhenGameUnfocused === false || runtime.game.foreground !== false;
    runtime.autoVisible = nonGameMode ? true : Boolean(detected && donorAllowed && focusAllowed && !runtime.game.minimized);
    applyVisibility('game-window-scan');
  }
  broadcastControlStatus();
  return detected;
}

function unpackedResource(relativePath) {
  if (!app.isPackaged) return path.join(app.getAppPath(), relativePath);
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
  return fs.existsSync(unpacked) ? unpacked : path.join(app.getAppPath(), relativePath);
}

function applyWindowProbeSnapshot(snapshot) {
  if (!snapshot?.ok) return;
  noteDetectedGame(snapshot.windows);
  const window = selectGameWindow(snapshot.windows, {
    selfPid: process.pid,
    exactProcessNames: settings.game?.exactProcessNames
      || (gameTitle() === 'madden27' ? ['Madden27.exe', 'Madden27_Trial.exe'] : ['CollegeFB27.exe', 'CollegeFB27_Trial.exe']),
    processNameIncludes: settings.game?.processNameIncludes || [],
    windowNameIncludes: settings.game?.windowNameIncludes || [],
    excludedProcessNameIncludes: ['CFB27 Scoreboard Overlay'],
    trustedHwnd: captureSourceHwnd({ id: runtime.game.sourceId || runtime.capture.sourceId }),
  });
  if (!window) {
    const gameWasDetected = runtime.game.detected;
    runtime.gameBounds = null;
    syncInGameEditorBounds();
    runtime.game = {
      ...runtime.game,
      detected: false,
      hwnd: '',
      pid: null,
      processName: '',
      foreground: false,
      minimized: false,
      bounds: null,
    };
    if (gameWasDetected) {
      validator?.reset();
      clearVisualIdentity();
    }
    captureCadenceSourceId = '';
    ocrFieldCadence.reset();
    teamRankMemory.reset();
    stopCaptureStreamQuietly();
    validationSession?.recordGameWindow(runtime.game);
    if (settings.recognition?.mode === 'local-ocr' && runtime.automaticEnabled) {
      runtime.autoVisible = false;
      applyVisibility('game-not-running');
    }
    broadcastControlStatus();
    return;
  }

  const visible = window.visible !== false && !window.minimized && !window.cloaked;
  const bounds = normalizeBounds({
    ...(window.clientBounds || window.frameBounds),
    coordinateSpace: 'dip',
    visible,
    foreground: Boolean(window.foreground),
  });
  runtime.game = {
    ...runtime.game,
    detected: true,
    hwnd: String(window.hwnd || ''),
    pid: Number(window.pid) || null,
    title: window.title || runtime.game.title,
    processName: window.processName || '',
    foreground: Boolean(window.foreground),
    minimized: Boolean(window.minimized),
    cloaked: Boolean(window.cloaked),
    bounds,
    lastSeenAt: snapshot.timestampMs || Date.now(),
  };
  if (!visible) stopCaptureStreamQuietly();
  validationSession?.recordGameWindow(runtime.game);
  if (bounds) {
    runtime.gameBounds = bounds;
    positionOverlay();
    syncInGameEditorBounds();
  }

  const modeNeedsGame = settings.recognition?.mode === 'local-ocr';
  if (runtime.started && runtime.automaticEnabled && modeNeedsGame) {
    const focusAllowed = settings.overlay?.hideWhenGameUnfocused === false || window.foreground;
    const donorAllowed = settings.overlay?.autoHide === false || Boolean(validator?.visible);
    runtime.autoVisible = Boolean(visible && focusAllowed && donorAllowed);
    applyVisibility('game-window-state');
  }
  broadcastControlStatus();
}

function stopWindowProbe() {
  if (windowProbe) {
    windowProbe.removeAllListeners();
    windowProbe.kill();
  }
  windowProbe = null;
  windowProbeBuffer = '';
}

function startWindowProbe() {
  stopWindowProbe();
  const executable = String(process.env.CFB27_PYTHON || '').trim();
  // The packaged application must not depend on a machine-wide Python install.
  // The optional probe runs only when a developer/tester deliberately supplies
  // an executable; Electron desktop capture remains the normal fallback.
  if (!executable) return;
  const trustedHwnd = captureSourceHwnd({ id: runtime.game.sourceId || runtime.capture.sourceId });
  if (!trustedHwnd) return;
  const script = unpackedResource(path.join('recognition', 'python', 'window_probe.py'));
  if (!fs.existsSync(script)) {
    logMessage('Window probe helper is missing; desktop source detection remains available.');
    return;
  }

  const args = [script, '--hwnd', trustedHwnd, '--watch', '500'];
  windowProbe = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  windowProbe.stdout.setEncoding('utf8');
  windowProbe.stdout.on('data', (chunk) => {
    windowProbeBuffer += chunk;
    const lines = windowProbeBuffer.split(/\r?\n/);
    windowProbeBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        applyWindowProbeSnapshot(JSON.parse(line));
      } catch (error) {
        validationSession?.recordError('window-probe-data', error);
        logMessage(`Window probe returned invalid data: ${error.message}`);
      }
    }
  });
  let stderr = '';
  windowProbe.stderr.setEncoding('utf8');
  windowProbe.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
  windowProbe.once('error', (error) => {
    validationSession?.recordError('window-probe', error);
    logMessage(`Window probe unavailable (${error.message}); desktop capture detection will still work.`);
  });
  windowProbe.once('exit', (code) => {
    if (!shuttingDown && code && stderr.trim()) logMessage(`Window probe stopped (${code}): ${stderr.trim()}`);
    windowProbe = null;
  });
}

function captureSnapshotFailure(code, message, details = {}) {
  return {
    ok: false,
    code: String(code || 'snapshot-failed'),
    error: String(message || 'The game picture could not be captured.'),
    ...details,
  };
}

function sourceWithMatchingIdAndName(sources, sourceId, sourceName) {
  const id = String(sourceId || '');
  const name = normalizeWindowTitle(sourceName);
  if (!id || !name) return null;
  const candidate = sources.find((source) => source.id === id);
  return candidate && normalizeWindowTitle(candidate.name) === name ? candidate : null;
}

function calibrationSourceGeometry(source, thumbnailSize, factoryProfile) {
  const thumbnailWidth = Number(thumbnailSize?.width) || 0;
  const thumbnailHeight = Number(thumbnailSize?.height) || 0;
  const thumbnailAspect = thumbnailWidth > 0 && thumbnailHeight > 0
    ? thumbnailWidth / thumbnailHeight
    : null;
  const candidates = [];
  const streamMatches = sourceWithMatchingIdAndName(
    [source],
    runtime.capture.streamSourceId || runtime.capture.sourceId,
    runtime.capture.sourceName,
  );
  if (streamMatches) {
    candidates.push({
      width: Number(runtime.capture.sourceWidth),
      height: Number(runtime.capture.sourceHeight),
      origin: 'live-stream',
    });
  }
  if (runtime.game.hwnd && captureSourceHwnd(source) === String(runtime.game.hwnd)) {
    candidates.push({
      width: Number(runtime.game.bounds?.width),
      height: Number(runtime.game.bounds?.height),
      origin: 'game-window',
    });
  }
  const measured = candidates.find((candidate) => {
    if (!(candidate.width > 0 && candidate.height > 0)) return false;
    if (!thumbnailAspect) return true;
    return Math.abs((candidate.width / candidate.height) - thumbnailAspect) <= 0.03;
  });
  if (measured) return measured;

  // Electron calibration thumbnails are resized to the requested box. Their
  // aspect ratio is still trustworthy, so infer a source width at the active
  // height preset when live window telemetry has not arrived yet.
  const referenceHeight = Number(factoryProfile?.captureHeight) || thumbnailHeight;
  return {
    width: thumbnailAspect ? Math.max(1, Math.round(referenceHeight * thumbnailAspect)) : thumbnailWidth,
    height: Math.max(1, referenceHeight),
    origin: 'thumbnail-aspect',
  };
}

async function captureSnapshot(payload = {}) {
  if (!screenCaptureEnabled(settings)) {
    return captureSnapshotFailure('capture-disabled', 'Screen capture is disabled for the current reader mode.');
  }
  const request = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : { sourceId: payload };
  const profileKey = request.profileKey === undefined
    ? activeReaderProfileKey()
    : normalizeProfileKey(request.profileKey, null);
  if (!profileKey) {
    return captureSnapshotFailure(
      'unsupported-reader-profile',
      `Unsupported reader profile: ${String(request.profileKey ?? '')}.`,
    );
  }
  const catalog = getReaderProfileCatalog();
  const factoryProfile = catalog.profiles[profileKey];
  const currentProfile = resolvedReaderProfile(settings, profileKey);

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {
        width: factoryProfile.captureWidth,
        height: factoryProfile.captureHeight,
      },
      fetchWindowIcons: false,
    });
  } catch (error) {
    validationSession?.recordError('calibration-snapshot', error);
    logMessage(`Calibration snapshot source scan failed: ${error.message}`);
    return captureSnapshotFailure('source-scan-failed', error.message);
  }

  // A renderer-supplied ID is trusted only while its supplied name still
  // describes the same current source. Electron IDs can be recycled.
  let source = sourceWithMatchingIdAndName(sources, request.sourceId, request.sourceName);
  let sourceOrigin = source ? 'renderer-selection' : '';

  // Next prefer the source already vetted by the live runtime scan/probe.
  if (!source && runtime.game.hwnd) {
    source = sources.find((candidate) => captureSourceHwnd(candidate) === String(runtime.game.hwnd)) || null;
    if (source) sourceOrigin = 'runtime-hwnd';
  }
  if (!source) {
    source = sourceWithMatchingIdAndName(
      sources,
      runtime.game.sourceId,
      runtime.game.title,
    );
    if (source) sourceOrigin = 'runtime-source';
  }
  if (!source) {
    source = sourceWithMatchingIdAndName(
      sources,
      runtime.capture.streamSourceId || runtime.capture.sourceId,
      runtime.capture.sourceName,
    );
    if (source) sourceOrigin = 'runtime-capture';
  }

  // Recover a saved manual selection by exact name when its ephemeral source
  // ID changed. selectCaptureSource deliberately refuses substring impostors.
  if (!source && settings.capture?.sourceId && settings.capture?.sourceName) {
    source = selectCaptureSource(sources, {
      explicitSourceId: settings.capture.sourceId,
      explicitSourceName: settings.capture.sourceName,
      trustedExplicitSourceId: runtime.trustedExplicitSourceId,
    });
    if (source) sourceOrigin = 'persisted-selection';
  }

  // Automatic fallback stays fail-closed: complete configured titles first,
  // then ranked decorated variants of them; windows that merely mention the
  // game (launchers, terminals, browsers, mod tools) are still rejected.
  if (!source) {
    source = selectCaptureSource(sources, {
      exactTitle: runtime.game.processName ? runtime.game.title : '',
      windowNameIncludes: settings.game?.windowNameIncludes || [],
      previousSourceId: runtime.game.sourceId,
    });
    if (source) sourceOrigin = 'exact-title';
  }
  if (!source) {
    return captureSnapshotFailure(
      'source-not-found',
      'No selected or detected game window is available.',
    );
  }
  if (!source.thumbnail || source.thumbnail.isEmpty()) {
    return captureSnapshotFailure(
      'source-not-capturable',
      `Windows did not return a picture for ${source.name || 'the selected game window'}. Use Borderless mode and keep the game visible.`,
      { id: source.id, name: source.name || '', sourceOrigin },
    );
  }
  const size = source.thumbnail.getSize();
  const sourceGeometry = calibrationSourceGeometry(source, size, factoryProfile);
  const adaptedPresetReadRegion = adaptReadRegionToSource(
    factoryProfile.readRegion,
    factoryProfile.captureWidth,
    factoryProfile.captureHeight,
    sourceGeometry.width,
    sourceGeometry.height,
  );
  const presetPixels = regionToPixels(
    adaptedPresetReadRegion,
    sourceGeometry.width,
    sourceGeometry.height,
  );
  let currentReadRegion = currentProfile.origin === 'factory'
    ? adaptedPresetReadRegion
    : currentProfile.profile.readRegion;
  if (currentProfile.origin === 'custom' && currentProfile.profile.aspectAdaptive === true) {
    currentReadRegion = effectiveReaderReadRegion(
      currentProfile,
      sourceGeometry.width,
      sourceGeometry.height,
    );
  }
  runtime.capture.sourceId = source.id;
  runtime.capture.sourceName = source.name;
  runtime.capture.calibrationSourceId = source.id;
  runtime.capture.calibrationProfileKey = profileKey;
  runtime.capture.calibrationSourceWidth = sourceGeometry.width;
  runtime.capture.calibrationSourceHeight = sourceGeometry.height;
  runtime.capture.calibrationCapturedAt = Date.now();
  logMessage(`Calibration snapshot captured from ${source.name} at preview ${size.width}x${size.height}; source geometry ${sourceGeometry.width}x${sourceGeometry.height} (${sourceGeometry.origin}, ${sourceOrigin}).`);
  broadcastControlStatus();
  return {
    ok: true,
    id: source.id,
    name: source.name,
    sourceOrigin,
    profileKey,
    expectedWidth: factoryProfile.captureWidth,
    expectedHeight: factoryProfile.captureHeight,
    width: size.width,
    height: size.height,
    sourceWidth: sourceGeometry.width,
    sourceHeight: sourceGeometry.height,
    sourceGeometryOrigin: sourceGeometry.origin,
    presetReadRegion: cloneJson(adaptedPresetReadRegion),
    currentReadRegion: cloneJson(currentReadRegion),
    presetPixelSize: {
      width: presetPixels.width,
      height: presetPixels.height,
    },
    presetRois: cloneJson(factoryProfile.rois),
    currentRois: cloneJson(currentProfile.profile.rois),
    dataUrl: source.thumbnail.toDataURL(),
  };
}

function revealCalibrationPanel(snapshot) {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
  const deliver = () => {
    sendToControl('scoreboard:panel', 'calibration');
    sendToControl('scoreboard:calibration-snapshot', snapshot);
  };
  if (controlWindow.webContents.isLoadingMainFrame()) {
    controlWindow.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }
}

async function captureCalibrationFromShortcut() {
  const snapshot = await captureSnapshot({
    profileKey: activeReaderProfileKey(),
    presetPlacement: true,
  });
  if (!snapshot?.ok) {
    revealCalibrationPanel(snapshot);
    logMessage(`Calibration shortcut failed: ${snapshot?.error || 'No selected or detected game window is available.'}`);
    return snapshot;
  }
  revealCalibrationPanel(snapshot);
  logMessage('Calibration shortcut captured the game window and opened Reading areas.');
  return snapshot;
}

function stopMockReader() {
  if (mockSource) {
    mockSource.removeAllListeners();
    mockSource.stop();
  }
  mockSource = null;
  validator = null;
}

function captureStreamError(value) {
  if (!value) return null;
  return {
    code: String(value.code || 'capture-failed'),
    message: String(value.message || value.code || 'Capture failed').slice(0, 500),
  };
}

function rememberCaptureStreamEvent(status = {}) {
  const error = captureStreamError(status.error);
  const signature = JSON.stringify({
    state: status.state || 'idle',
    health: status.health || null,
    attempt: Number(status.attempt) || 0,
    error,
    delayMs: Number(status.delayMs) || null,
    retryAt: Number(status.retryAt) || null,
    sourceWidth: Number(status.sourceWidth) || null,
    sourceHeight: Number(status.sourceHeight) || null,
  });
  if (signature === captureStreamEventSignature) return false;
  captureStreamEventSignature = signature;
  runtime.support.captureHistory = appendCaptureHistory(runtime.support.captureHistory, {
    ...status,
    error,
  });
  validationSession?.recordCaptureState?.({ ...status, error });
  return true;
}

function logCaptureStreamState(status) {
  const error = captureStreamError(status.error);
  const signature = JSON.stringify({
    state: status.state,
    health: status.health || null,
    sourceId: status.sourceId || '',
    attempt: Number(status.attempt) || 0,
    error,
    delayMs: Number(status.delayMs) || null,
    retryAt: Number(status.retryAt) || null,
    sourceWidth: Number(status.sourceWidth) || null,
    sourceHeight: Number(status.sourceHeight) || null,
  });
  if (signature === captureStreamLogSignature) return;
  captureStreamLogSignature = signature;

  const source = status.sourceId || runtime.capture.sourceName || 'the selected game window';
  if (status.state === 'starting') {
    logMessage(`Capture stream starting for ${source} (attempt ${Number(status.attempt) || 1}).`);
  } else if (status.state === 'running') {
    const dimensions = Number(status.sourceWidth) && Number(status.sourceHeight)
      ? ` at ${Number(status.sourceWidth)}x${Number(status.sourceHeight)}`
      : '';
    const health = status.health && status.health !== 'healthy' ? ` (${status.health})` : '';
    logMessage(`Capture stream connected to ${source}${dimensions}${health}.`);
  } else if (status.state === 'retry-wait') {
    const delayMs = Number(status.delayMs) || 0;
    logMessage(`Capture stream failed${error ? ` [${error.code}]: ${error.message}` : ''}; retrying in ${delayMs} ms.`);
  } else if (status.state === 'exhausted') {
    const retryAt = Number(status.retryAt);
    const retryText = retryAt ? ` Retry is available after ${new Date(retryAt).toISOString()}.` : '';
    logMessage(`Capture stream is unavailable${error ? ` [${error.code}]: ${error.message}` : '.'}${retryText}`);
  } else if (status.state === 'idle' && runtime.capture.streamStatus !== 'idle') {
    logMessage('Capture stream stopped.');
  }
}

function handleCaptureStreamState(status = {}) {
  const state = String(status.state || 'idle');
  const sourceId = String(status.sourceId || '');
  const previousStreamSourceId = runtime.capture.streamSourceId;
  logCaptureStreamState({ ...status, state, sourceId });
  rememberCaptureStreamEvent({ ...status, state, sourceId });

  runtime.capture.streamStatus = state;
  runtime.capture.running = state === 'running';
  runtime.capture.streamSourceId = sourceId;
  const nextError = captureStreamError(status.error);
  if (nextError) {
    runtime.capture.error = nextError;
    runtime.capture.lastError = nextError;
    runtime.capture.lastErrorAt = Date.now();
  } else if (state === 'idle') {
    runtime.capture.error = null;
  }
  runtime.capture.attempt = Number(status.attempt) || 0;
  runtime.capture.retryDelayMs = Number.isFinite(Number(status.delayMs))
    ? Number(status.delayMs)
    : null;
  runtime.capture.retryAt = Number.isFinite(Number(status.retryAt))
    ? Number(status.retryAt)
    : null;
  runtime.capture.health = String(status.health || (state === 'running' ? 'healthy' : state));
  runtime.capture.healthReason = status.healthReason ? String(status.healthReason).slice(0, 500) : null;
  runtime.capture.telemetry = status.telemetry && typeof status.telemetry === 'object'
    ? cloneJson(status.telemetry)
    : runtime.capture.telemetry;
  runtime.capture.streamUpdatedAt = Date.now();

  if (sourceId && previousStreamSourceId && sourceId !== previousStreamSourceId) {
    runtime.capture.sourceWidth = null;
    runtime.capture.sourceHeight = null;
    runtime.capture.negotiatedWidth = null;
    runtime.capture.negotiatedHeight = null;
    runtime.capture.profileValidation = null;
  }
  const sourceWidth = Number(status.sourceWidth);
  const sourceHeight = Number(status.sourceHeight);
  if (sourceWidth > 0 && sourceHeight > 0) {
    runtime.capture.sourceWidth = sourceWidth;
    runtime.capture.sourceHeight = sourceHeight;
    runtime.capture.negotiatedWidth = sourceWidth;
    runtime.capture.negotiatedHeight = sourceHeight;
  } else if (state === 'idle') {
    runtime.capture.sourceWidth = null;
    runtime.capture.sourceHeight = null;
    runtime.capture.negotiatedWidth = null;
    runtime.capture.negotiatedHeight = null;
    runtime.capture.profileValidation = null;
  }

  if (runtime.started && settings.recognition?.mode === 'local-ocr') {
    if (state === 'retry-wait' || state === 'starting') {
      runtime.reader.status = 'capture-reconnecting';
      runtime.reader.healthy = false;
    } else if (state === 'exhausted') {
      runtime.reader.status = 'capture-unavailable';
      runtime.reader.healthy = false;
      if (runtime.automaticEnabled) {
        runtime.autoVisible = false;
        applyVisibility('capture-unavailable');
      }
    } else if (state === 'running'
      && ['capture-reconnecting', 'capture-unavailable', 'waiting-for-frame'].includes(runtime.reader.status)) {
      runtime.reader.status = ['slow', 'static'].includes(status.health) ? 'capture-slow' : 'waiting-for-frame';
      runtime.reader.healthy = false;
    }
  }
  if (!shuttingDown) broadcastControlStatus();
}

function persistentCaptureStream() {
  if (!captureStream) {
    captureStream = new PersistentCaptureStream({
      transportFactory: () => new ElectronCaptureStreamTransport({
        BrowserWindow,
        ipcMain,
        htmlPath: path.join(__dirname, 'capture-stream.html'),
        preloadPath: path.join(__dirname, 'capture-stream-preload.js'),
      }),
      // Event/stat discovery occasionally requests a full-window PNG instead
      // of the tiny scorebug crop. Busy 4K game frames can exceed the reader's
      // original 8 MB ceiling without being malformed.
      maximumFrameBytes: 32 * 1024 * 1024,
      onState: handleCaptureStreamState,
    });
  }
  return captureStream;
}

function stopCaptureStreamQuietly() {
  if (!captureStream) return;
  captureStream.stop().catch((error) => {
    validationSession?.recordError('capture-stream-stop', error);
  });
}

async function stopLocalReader() {
  if (captureLoopTimer) clearInterval(captureLoopTimer);
  captureLoopTimer = null;
  stopClockPresentationTicker();
  captureBusy = false;
  captureCadenceSourceId = '';
  ocrFieldCadence.reset();
  teamRankMemory.reset();
  const streamStop = captureStream?.stop().catch(() => {});
  const worker = ocrWorker;
  const screenWorker = dataOcrWorker;
  ocrWorker = null;
  dataOcrWorker = null;
  dataOcrBusy = false;
  await Promise.all([
    streamStop,
    worker?.terminate().catch(() => {}),
    screenWorker?.terminate().catch(() => {}),
  ]);
}

function cropNormalized(image, roi) {
  const size = image.getSize();
  if (!roi || !size.width || !size.height) return null;
  const normalized = [roi.x, roi.y, roi.width, roi.height].every((value) => Number(value) >= 0 && Number(value) <= 1);
  const scaleX = normalized ? size.width : 1;
  const scaleY = normalized ? size.height : 1;
  const x = Math.max(0, Math.min(size.width - 1, Math.round(Number(roi.x || 0) * scaleX)));
  const y = Math.max(0, Math.min(size.height - 1, Math.round(Number(roi.y || 0) * scaleY)));
  const width = Math.max(1, Math.min(size.width - x, Math.round(Number(roi.width || 1) * scaleX)));
  const height = Math.max(1, Math.min(size.height - y, Math.round(Number(roi.height || 1) * scaleY)));
  return image.crop({ x, y, width, height });
}

const OCR_FIELD_TYPES = Object.freeze({
  'away.score': 'score',
  'home.score': 'score',
  'away.name': 'teamName',
  'home.name': 'teamName',
  'away.record': 'record',
  'home.record': 'record',
  'game.quarter': 'quarter',
  'game.clock': 'clock',
  'game.playClock': 'playClock',
  'game.downDistance': 'downDistance',
});

async function captureTargetReadImage() {
  if (!screenCaptureEnabled(settings)) {
    runtime.capture.unavailableReason = 'capture-disabled';
    stopCaptureStreamQuietly();
    return null;
  }
  const sourceId = runtime.game.detected
    ? (runtime.game.sourceId || runtime.capture.sourceId)
    : '';
  const unavailable = !sourceId
    || runtime.game.minimized === true
    || runtime.game.cloaked === true
    || runtime.game.bounds?.visible === false;
  if (unavailable) {
    runtime.capture.unavailableReason = !sourceId
      ? 'game-window-not-detected'
      : (runtime.game.minimized === true
        ? 'game-window-minimized'
        : (runtime.game.cloaked === true ? 'game-window-cloaked' : 'game-window-not-visible'));
    stopCaptureStreamQuietly();
    return null;
  }
  if (captureCadenceSourceId !== sourceId) {
    captureCadenceSourceId = sourceId;
    ocrFieldCadence.reset();
  }
  const readerProfile = resolvedReaderProfile();
  const requestedWidth = readerProfile.profile.captureWidth;
  const requestedHeight = readerProfile.profile.captureHeight;
  const sourceGeometry = sourceGeometryForReader(readerProfile, sourceId);
  const readRegion = effectiveReaderReadRegion(
    readerProfile,
    sourceGeometry.width,
    sourceGeometry.height,
  );
  const stream = persistentCaptureStream();
  await stream.start({
    sourceId,
    sourceName: runtime.game.title || runtime.capture.sourceName,
    readRegion,
    width: requestedWidth,
    height: requestedHeight,
    fps: clampInteger(settings.capture?.fps, 4, 1, 10),
  });
  const frame = await stream.captureFrame();
  if (!frame?.bytes) {
    runtime.capture.unavailableReason = runtime.capture.error?.code
      || `capture-${runtime.capture.streamStatus || 'waiting'}`;
    return null;
  }
  const image = nativeImage.createFromBuffer(frame.bytes);
  if (!image || image.isEmpty()) {
    runtime.capture.unavailableReason = 'invalid-frame-image';
    return null;
  }
  runtime.capture.sourceId = sourceId;
  runtime.capture.sourceName = runtime.game.title || runtime.capture.sourceName;
  runtime.capture.running = true;
  runtime.capture.frameWidth = frame.width;
  runtime.capture.frameHeight = frame.height;
  runtime.capture.sourceWidth = frame.sourceWidth;
  runtime.capture.sourceHeight = frame.sourceHeight;
  runtime.capture.lastFrameAt = Number(frame.capturedAt) || Date.now();
  runtime.capture.error = null;
  runtime.capture.unavailableReason = null;
  runtime.support.consecutiveNoFrameTicks = 0;
  const frameReadRegion = effectiveReaderReadRegion(
    readerProfile,
    Number(frame.sourceWidth) || sourceGeometry.width,
    Number(frame.sourceHeight) || sourceGeometry.height,
  );
  runtime.capture.profileValidation = captureProfileValidation({
    profileKey: readerProfile.key,
    expectedWidth: requestedWidth,
    expectedHeight: requestedHeight,
    sourceWidth: frame.sourceWidth,
    sourceHeight: frame.sourceHeight,
    frameWidth: frame.width,
    frameHeight: frame.height,
    readRegion: frameReadRegion,
  });
  return image;
}

function queueAutomaticScreenOcr(frame) {
  if (!frame?.bytes || dataOcrBusy || !automaticExtractionEnabled()) return false;
  const extractor = automaticDataExtractor();
  const worker = dataOcrWorker || new LocalScoreboardOcr();
  dataOcrWorker = worker;
  dataOcrBusy = true;
  worker.recognize(frame.bytes, 'screenText', { preprocess: false })
    .then((read) => {
      if (worker !== dataOcrWorker || !automaticExtractionEnabled()) return;
      if (read?.valid && read.rawText) {
        extractor.observeScreenText(read.rawText, {
          capturedAt: frame.capturedAt,
          pngBytes: frame.bytes,
          width: frame.width,
          height: frame.height,
          confidence: read.confidence,
        });
      } else if (extractor.needsContextCapture(frame.capturedAt)) {
        extractor.saveScreenshot(frame.bytes, extractor.contextReason || 'event-context', frame.capturedAt);
      }
    })
    .catch((error) => {
      if (worker !== dataOcrWorker) return;
      try {
        extractor.recordError(error, 'full-screen-ocr');
        if (extractor.needsContextCapture(frame.capturedAt)) {
          extractor.saveScreenshot(frame.bytes, 'ocr-error-context', frame.capturedAt);
        }
      } catch (writeError) {
        console.warn('[data-extraction] could not record OCR error:', writeError.message);
      }
    })
    .finally(() => {
      if (worker === dataOcrWorker) dataOcrBusy = false;
    });
  return true;
}

async function captureAutomaticScreenData() {
  if (!automaticExtractionEnabled() || dataOcrBusy || !captureStream) return;
  const extractor = automaticDataExtractor();
  const now = Date.now();
  const normalIntervalMs = clampInteger(
    settings.dataExtraction?.screenIntervalMs,
    2_000,
    750,
    30_000,
  );
  const eventIntervalMs = clampInteger(
    settings.dataExtraction?.eventScreenIntervalMs,
    500,
    250,
    normalIntervalMs,
  );
  if (!extractor.shouldSampleScreen(now, normalIntervalMs, eventIntervalMs)) return;
  extractor.markScreenSampled(now);
  const frame = await captureStream.captureFrame({
    readRegion: { x: 0, y: 0, width: 1, height: 1 },
  });
  if (!frame?.bytes) return;
  queueAutomaticScreenOcr(frame);
}

function applyVisualIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const summary = {
    source: identity.source || null,
    layout: typeof identity.layout === 'string' ? identity.layout : null,
  };

  for (const side of ['away', 'home']) {
    const color = identity[side]?.color;
    const logo = identity[side]?.logo;
    const normalizedColor = typeof color?.value === 'string' && /^#[0-9a-f]{6}$/i.test(color.value)
      ? color.value.toLowerCase()
      : null;
    const logoValue = typeof logo?.value === 'string'
      && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(logo.value)
      && logo.value.length <= 500_000
      ? logo.value
      : null;
    const colorAccepted = Boolean(normalizedColor && Number(color.confidence) >= 0.3);
    const logoAccepted = Boolean(logoValue && Number(logo.confidence) >= 0.5);

    if (colorAccepted) runtime.visualIdentity[`${side}Color`] = normalizedColor;
    if (logoAccepted) {
      runtime.visualIdentity[`${side}Logo`] = logoValue;
      runtime.visualIdentity[`${side}LogoHash`] = logo.hash || null;
    }
    summary[side] = {
      color: {
        value: normalizedColor,
        confidence: Number(color?.confidence) || 0,
        accepted: colorAccepted,
      },
      logo: {
        confidence: Number(logo?.confidence) || 0,
        width: Number(logo?.width) || 0,
        height: Number(logo?.height) || 0,
        hash: logo?.hash || null,
        accepted: logoAccepted,
      },
    };
  }
  runtime.visualIdentity.updatedAt = Date.now();
  return summary;
}

function currentVisualIdentityMeta() {
  return {
    ...(runtime.visualIdentity.awayColor ? { awayColor: runtime.visualIdentity.awayColor } : {}),
    ...(runtime.visualIdentity.awayLogo ? { awayLogo: runtime.visualIdentity.awayLogo } : {}),
    ...(runtime.visualIdentity.homeColor ? { homeColor: runtime.visualIdentity.homeColor } : {}),
    ...(runtime.visualIdentity.homeLogo ? { homeLogo: runtime.visualIdentity.homeLogo } : {}),
  };
}

function clearVisualIdentity() {
  runtime.visualIdentity = {
    awayColor: null,
    awayLogo: null,
    awayLogoHash: null,
    homeColor: null,
    homeLogo: null,
    homeLogoHash: null,
    updatedAt: Date.now(),
  };
}

function resolveBundledTeamIdentity(name, rank) {
  if (!teamAssetResolverAttempted) {
    teamAssetResolverAttempted = true;
    try {
      teamAssetResolver = TeamAssetResolver.fromAppRoot(app.getAppPath());
      teamAssetResolver.setCustomTeams([
        ...(Array.isArray(settings.customTeams) ? settings.customTeams : []),
        ...(gameTitle() === 'madden27' ? nflCatalogTeams() : []),
      ], customTeamsRoot());
      teamLogoVariantResolver = TeamLogoVariantResolver.fromAppRoot(app.getAppPath());
      customTeamLogoStore = new CustomTeamLogoStore(path.join(app.getPath('userData'), 'team-logos'));
      teamLogoVariantResolver.setAdditionalChoiceSource({
        choicesForTeam(teamId) {
          return customTeamLogoStore.choicesForTeam(teamId, settings.teamLogos?.custom);
        },
      });
    } catch (error) {
      logMessage(`Bundled team assets unavailable: ${error.message}`);
    }
  }
  return resolveScoreboardTeamIdentity(teamAssetResolver, name, rank);
}

function diagnoseBundledTeamPrefix(name) {
  if (!teamAssetResolverAttempted) resolveBundledTeamIdentity('', null);
  return teamAssetResolver?.diagnosePrefix(name) || null;
}

function stabilizeTeamOcrRead(read) {
  // Resolve from raw text too: a clipped team fragment may fail the generic
  // team-name length normalizer even though the bundled roster makes it unique.
  const observedText = read?.value || read?.rawText;
  if (!observedText) return read;
  const parsed = splitTeamIdentity(observedText);
  const prefixDiagnosis = diagnoseBundledTeamPrefix(parsed.name);
  const teamIdentityCandidates = prefixDiagnosis?.prefix
    ? {
      prefix: prefixDiagnosis.prefix,
      candidateCount: prefixDiagnosis.candidateCount,
      candidates: prefixDiagnosis.candidates.slice(0, 20),
      unique: prefixDiagnosis.unique,
      ready: prefixDiagnosis.ready,
    }
    : null;
  const diagnosedRead = teamIdentityCandidates
    ? { ...read, teamIdentityCandidates }
    : read;
  const identity = resolveBundledTeamIdentity(parsed.name, parsed.rank);
  if (!identity?.asset) return diagnosedRead;

  // Team-name OCR is structurally different from a free-form text read: a
  // unique match in the bundled 130-team registry is strong corroboration.
  // This recovers a faint but exact read (for example Pittsburgh at 26%) and
  // one-character OCR slips such as PENN STATI without lowering the global
  // confidence threshold used by scores, clocks, and downs.
  const canonicalName = identity.match === 'exact'
    ? parsed.name
    : identity.name;
  if (parsed.rank) teamRankMemory.remember(identity.asset.id, parsed.rank);
  const corroboratedRank = teamRankMemory.establishedRank(identity.asset.id) ?? parsed.rank;
  const decorated = [
    corroboratedRank ? String(corroboratedRank) : '',
    canonicalName || '',
    parsed.record || '',
  ].filter(Boolean).join(' ');
  const rosterConfidenceFloor = {
    'closest-roster': 0.78,
    'adjacency-rule': 0.84,
    fuzzy: 0.8,
    'team-rule': 0.9,
  }[identity.match] ?? 0.9;
  return {
    ...diagnosedRead,
    value: decorated,
    // A unique roster match is structural proof of a valid team name even when
    // the free-form OCR normalizer rejected the clipped token on length alone.
    valid: true,
    confidence: Math.max(Number(read.confidence) || 0, rosterConfidenceFloor),
    teamIdentity: {
      id: identity.asset.id,
      name: identity.asset.name,
      match: identity.match,
    },
  };
}

function applyBundledTeamAssets(payload) {
  payload.meta ||= {};
  const resolved = {};
  for (const side of ['away', 'home']) {
    const hint = payload.meta.manualTeamOverrides?.[side]?.teamId
      ? null
      : payload.meta.dynastyTeamAssets?.[side];
    const hintedAsset = hint?.id ? teamAssetResolver?.resolveTeamId(hint.id) : null;
    const identity = hintedAsset
      ? { asset: hintedAsset, match: 'dynasty-presentation-id' }
      : resolveBundledTeamIdentity(payload[side]?.name, payload[side]?.rank);
    const asset = identity?.asset;
    if (!asset) continue;
    if (!hintedAsset && identity.match && identity.match !== 'exact') {
      payload[side].name = identity.name;
      payload[side].rank = identity.rank;
    }
    payload[side].color = preferredTeamColor(asset, payload[side].color);
    payload[side].nickname = asset.nickname;
    const logo = preferredTeamLogo(asset, payload[side].logo);
    if (logo) payload[side].logo = logo;
    resolved[side] = {
      id: asset.id,
      assetId: asset.assetId,
      name: asset.name,
      nickname: asset.nickname,
      source: asset.source,
      width: asset.width,
      height: asset.height,
      presentationId: hint?.presentationId ?? asset.presentationId,
      isTeamBuilder: typeof hint?.isTeamBuilder === 'boolean'
        ? hint.isTeamBuilder
        : asset.isTeamBuilder === true,
    };
  }
  if (Object.keys(resolved).length > 0) payload.meta.teamAssets = resolved;
  else delete payload.meta.teamAssets;
  return payload;
}

function publishRecognitionResult(result, source) {
  const confidence = Number(result.anchor?.confidence) || 0;
  const payload = toRendererState(result.state, {
    visible: result.visible,
    confidence,
    timestampMs: result.timestampMs,
    source,
    ...currentVisualIdentityMeta(),
  }, {
    // OCR runs after the captured frame, so display a small configurable
    // presentation correction. Mock/manual data remains exact.
    clockOffsetSeconds: source === 'local-ocr'
      ? clampInteger(settings.recognition?.clockOffsetSeconds, -1, -5, 5)
      : 0,
  });
  applyClockPresentation(payload, result, source);
  if (result.diagnostics) {
    runtime.support.lastRecognitionDiagnostics = {
      ...compactRecognitionDiagnostics(result.diagnostics),
      result: {
        visible: Boolean(result.visible),
        anchorPresent: Boolean(result.anchor?.present),
        anchorConfidence: Number(result.anchor?.confidence) || 0,
        accepted: Array.isArray(result.accepted) ? [...result.accepted] : [],
        rejected: Array.isArray(result.rejected) ? [...result.rejected] : [],
      },
    };
    runtime.support.lastRecognitionAt = Number(result.timestampMs) || Date.now();
  }
  validationSession?.observe(result, payload);
  updateScoreboardState(payload);
  const downDistanceRawText = String(
    result.diagnostics?.fields?.['game.downDistance']?.rawText || '',
  );
  if (automaticExtractionEnabled() && /\b(?:FLAG|PENALTY)\b/i.test(downDistanceRawText)) {
    try {
      automaticDataExtractor().observeSignal('flag-detected', {
        capturedAt: result.timestampMs,
        rawText: downDistanceRawText,
      });
    } catch (error) {
      console.warn('[data-extraction] could not record flag signal:', error.message);
    }
  }
  runtime.reader = {
    status: result.visible ? 'reading' : 'finding-scoreboard',
    healthy: result.visible,
    lastReadAt: result.timestampMs,
  };
  if (runtime.automaticEnabled) {
    const focusAllowed = settings.overlay?.hideWhenGameUnfocused === false || runtime.game.foreground !== false;
    runtime.autoVisible = Boolean(result.visible && focusAllowed && !runtime.game.minimized);
    applyVisibility(`${source}-anchor`);
  }
  broadcastControlStatus();
}

async function runLocalCaptureTick() {
  if (captureBusy || !runtime.started || !screenCaptureEnabled(settings)) return;
  captureBusy = true;
  let worker = null;
  try {
    const captureStartedAt = Date.now();
    const image = await captureTargetReadImage();
    const readerProfile = resolvedReaderProfile();
    const captureProfile = readerProfile.profile;
    const rois = captureProfile.rois || {};
    if (!image) {
      ocrFieldCadence.reset();
      runtime.support.consecutiveNoFrameTicks += 1;
      runtime.capture.lastNoFrameAt = Date.now();
      // A missing capture frame is transport evidence, not an OCR observation.
      // Do not advance the validator, lastReadAt, scoreboard data, or validation
      // recognition counters. The last known overlay stays stable while the
      // capture worker reconnects instead of flickering off and on.
      if (!['capture-reconnecting', 'capture-unavailable'].includes(runtime.reader.status)) {
        runtime.reader.status = runtime.capture.streamStatus === 'running'
          ? 'waiting-for-frame'
          : (runtime.game.detected ? 'capture-reconnecting' : 'waiting-for-game');
      }
      runtime.reader.healthy = false;
      validationSession?.recordCaptureGap?.({
        reason: runtime.capture.unavailableReason || 'no-frame',
        streamStatus: runtime.capture.streamStatus,
        attempt: runtime.capture.attempt,
      });
      broadcastControlStatus();
      return;
    }

    const allConfiguredFields = Object.entries(OCR_FIELD_TYPES).filter(([binding]) => rois[binding]);
    if (!allConfiguredFields.length) {
      runtime.reader = { status: 'needs-calibration', healthy: false, lastReadAt: runtime.reader.lastReadAt };
      runtime.capture.running = true;
      broadcastControlStatus();
      return;
    }
    const dueBindings = new Set(ocrFieldCadence.due(
      allConfiguredFields.map(([binding]) => binding),
      captureStartedAt,
    ));
    const configuredFields = allConfiguredFields.filter(([binding]) => dueBindings.has(binding));

    worker = ocrWorker;
    if (!worker) return;

    const fields = {};
    const confidences = [];
    const diagnostics = {
      fields: {},
      visual: null,
      elapsedMs: 0,
      capturedAt: Date.now(),
      capture: {
        width: image.getSize().width,
        height: image.getSize().height,
        sourceWidth: runtime.capture.sourceWidth || null,
        sourceHeight: runtime.capture.sourceHeight || null,
      },
    };
    for (const [binding, fieldType] of configuredFields) {
      const cropped = cropNativeImage(image, resolveFieldRoi(captureProfile, binding));
      if (!cropped || cropped.isEmpty()) continue;
      const fieldImage = cropped.toPNG();
      ocrFieldCadence.mark([binding], Date.now());
      const rawRead = fieldType === 'downDistance'
        ? await recognizeDownDistance(worker, fieldImage)
        : (fieldType === 'score'
          ? await recognizeScore(worker, fieldImage)
          : (fieldType === 'quarter'
            ? await recognizeQuarter(worker, fieldImage)
            : await worker.recognize(fieldImage, fieldType)));
      const read = fieldType === 'teamName'
        ? stabilizeTeamOcrRead(rawRead)
        : rawRead;
      diagnostics.fields[binding] = {
        rawText: read.rawText,
        value: read.value,
        valid: read.valid,
        confidence: read.confidence,
        engineConfidence: read.engineConfidence,
        elapsedMs: read.elapsedMs,
        strategy: read.strategy || 'single-pass',
        attempts: read.attempts || null,
        teamIdentity: read.teamIdentity || null,
      };
      if (!read.valid) continue;
      fields[binding] = {
        value: read.value,
        confidence: read.confidence,
        ...(read.teamIdentity ? { teamIdentity: read.teamIdentity } : {}),
      };
      confidences.push(read.confidence);
    }
    const currentState = validator.snapshot().state;
    const readPng = image.toPNG();
    try {
      // Timeout bars and possession are visual fields, so analyze them on
      // every captured frame even when every text OCR attempt was rejected.
      // This keeps timeout changes independent from OCR confidence/cadence.
      const visual = analyzeVisualFields(readPng, {
        timeoutRegions: {
          away: resolveFieldRoi(captureProfile, 'away.timeouts'),
          home: resolveFieldRoi(captureProfile, 'home.timeouts'),
        },
        possessionRegion: resolveFieldRoi(captureProfile, 'away.possession'),
        possessionSide: 'away',
        emptyDarkMeansOpposite: true,
      });
      diagnostics.visual = visual;
      fields['away.timeouts'] = {
        value: visual.awayTimeouts.value,
        confidence: visual.awayTimeouts.confidence,
      };
      fields['home.timeouts'] = {
        value: visual.homeTimeouts.value,
        confidence: visual.homeTimeouts.confidence,
      };
      if (visual.possession.value) {
        fields.possession = {
          value: visual.possession.value,
          confidence: visual.possession.confidence,
          evidence: visual.possession.state === 'present'
            ? 'present'
            : (visual.possession.state === 'absent' ? 'inferred-absence' : undefined),
        };
      }
    } catch (error) {
      diagnostics.visual = { error: error.message };
    }

    const teamPairAnchored = Boolean(
      (fields['away.name'] || currentState.awayName)
      && (fields['home.name'] || currentState.homeName),
    );
    const scorePairAnchored = Boolean(
      (fields['away.score'] || currentState.awayScore !== null)
      && (fields['home.score'] || currentState.homeScore !== null),
    );
    const gameContextAnchored = Boolean(
      fields['game.clock']
      || fields['game.quarter']
      || fields['game.downDistance']
      || currentState.gameClock
      || currentState.quarter
      || currentState.downDistance,
    );
    const identityAnchored = confidences.length > 0
      && scorePairAnchored
      && (teamPairAnchored || gameContextAnchored);
    if (identityAnchored) {
      try {
        diagnostics.visualIdentity = applyVisualIdentity(analyzeVisualIdentity(readPng));
      } catch (error) {
        // Team artwork is supplemental. A transition frame can hide or
        // animate a logo without interrupting scores, clocks, or possession.
        diagnostics.visualIdentity = { error: error.message };
      }
    } else {
      diagnostics.visualIdentity = { skipped: 'team-and-score-anchor-missing' };
    }
    const meanConfidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0;
    const scoresEstablished = currentState.awayScore !== null
      && currentState.homeScore !== null;
    const establishedAwayIdentity = currentState.awayName
      ? resolveBundledTeamIdentity(currentState.awayName, currentState.awayRank)
      : null;
    const establishedHomeIdentity = currentState.homeName
      ? resolveBundledTeamIdentity(currentState.homeName, currentState.homeRank)
      : null;
    // Stale garbage text from an older, misaligned calibration must not count
    // as trusted team context when the hidden scoreboard is reacquired.
    const teamsEstablished = Boolean(
      establishedAwayIdentity?.asset && establishedHomeIdentity?.asset,
    );
    const scoreboardWasVisible = Boolean(validator.visible);
    const fingerprintPresent = hasScoreboardFingerprint({ fields }, {
      fieldConfidence: Math.max(
        0,
        Math.min(1, Number(settings.recognition?.minimumConfidence ?? 20) / 100),
      ),
      downDistanceConfidence: 0.35,
      scoresEstablished,
      teamsEstablished,
      currentlyVisible: scoreboardWasVisible,
    });
    const observation = {
      anchor: { present: fingerprintPresent, confidence: meanConfidence },
      fields,
      timestampMs: Date.now(),
    };
    diagnostics.elapsedMs = Date.now() - captureStartedAt;
    if (worker !== ocrWorker || !runtime.started || settings.recognition?.mode !== 'local-ocr') return;
    const result = validator.update(observation);
    if (scoreboardWasVisible && !result.visible) ocrFieldCadence.reset();
    result.diagnostics = diagnostics;
    publishRecognitionResult(result, 'local-ocr');
    await captureAutomaticScreenData();
  } catch (error) {
    // Start/stop and settings changes can retire a worker while a capture is
    // awaiting its thumbnail; only that stale tick ends quietly. A throw
    // before the worker reference was taken (capture setup, profile
    // resolution, stream configuration) previously returned here silently,
    // leaving the reader stuck with no log, status, or report evidence.
    if (worker && worker !== ocrWorker) return;
    if (!runtime.started || settings.recognition?.mode !== 'local-ocr') return;
    runtime.reader = { status: 'error', healthy: false, lastReadAt: runtime.reader.lastReadAt };
    runtime.support.lastReaderError = {
      message: String(error?.message || error).slice(0, 500),
      at: new Date().toISOString(),
      beforeOcrWorker: !worker,
    };
    validationSession?.recordError('local-ocr', error);
    if (Date.now() - lastOcrErrorAt > 5000) {
      lastOcrErrorAt = Date.now();
      logMessage(`Local reader error: ${error.message}`);
    }
    broadcastControlStatus();
  } finally {
    captureBusy = false;
  }
}

async function startLocalReader(isCurrent = () => true) {
  await stopLocalReader();
  if (!isCurrent()) return;
  // The Safe resolver preserves scoreStableFrames: 2, while Aggressive owns
  // its separate one-frame opt-in without changing this shipped baseline.
  const behavior = resolveReaderBehavior(settings);
  validator = new ScoreboardStateValidator(behavior.validatorOptions);
  ocrFieldCadence.staticIntervalMs = behavior.staticIntervalMs;
  ocrFieldCadence.reset();
  ocrWorker = new LocalScoreboardOcr();
  const fps = behavior.captureFps;
  captureLoopTimer = setInterval(() => {
    runLocalCaptureTick().catch((error) => logMessage(`Capture tick failed: ${error.message}`));
  }, Math.round(1000 / fps));
  captureLoopTimer.unref?.();
  startClockPresentationTicker();
  runtime.reader = { status: 'initializing', healthy: false, lastReadAt: runtime.reader.lastReadAt };
  runLocalCaptureTick().catch((error) => logMessage(`Initial capture failed: ${error.message}`));
  logMessage(`${behavior.label} reading profile started at up to ${fps} capture frames per second.`);
}

async function startMockReader(isCurrent = () => true) {
  stopMockReader();
  const recognition = settings.recognition || {};
  const configuredConfidence = Math.max(0, Math.min(1, Number(recognition.minimumConfidence ?? 20) / 100));
  validator = new ScoreboardStateValidator({
    fieldConfidence: configuredConfidence,
    anchorConfidence: configuredConfidence,
    stableFrames: clampInteger(recognition.stableFrames, 2, 1, 10),
    visibleFrames: clampInteger(recognition.presentFramesToShow, 2, 1, 10),
    hiddenFrames: clampInteger(recognition.missingFramesToHide, 3, 1, 10),
  });
  mockSource = await MockScoreboardSource.fromFile(
    path.join(app.getAppPath(), 'recognition', 'mock-sequence.json'),
    { intervalMs: 400, loop: true },
  );
  if (!isCurrent()) {
    mockSource = null;
    return;
  }
  mockSource.on('observation', (observation) => {
    const result = validator.update(observation);
    const confidence = Number(result.anchor?.confidence) || 0;
    const payload = toRendererState(result.state, {
      visible: result.visible,
      confidence,
      timestampMs: result.timestampMs,
      source: 'mock',
    });
    updateScoreboardState(payload);
    runtime.reader = {
      status: result.visible ? 'reading' : 'finding-scoreboard',
      healthy: result.visible,
      lastReadAt: result.timestampMs,
    };
    if (runtime.automaticEnabled) {
      runtime.autoVisible = result.visible;
      applyVisibility('mock-anchor');
    }
    sendToControl('scoreboard:state', runtime.scoreboardState);
    broadcastControlStatus();
  });
  mockSource.start();
  runtime.reader.status = 'finding-scoreboard';
  runtime.reader.healthy = true;
  logMessage('Animated mock reader started.');
}

function configureReader() {
  return readerLifecycle.run(async ({ isCurrent }) => {
    stopMockReader();
    await stopLocalReader();
    if (!isCurrent()) return;
    if (!runtime.started) {
      runtime.reader = { status: 'stopped', healthy: false, lastReadAt: runtime.reader.lastReadAt };
      runtime.capture.running = false;
      broadcastControlStatus();
      return;
    }

    const mode = settings.recognition?.mode || 'manual';
    if (mode === 'mock') {
      runtime.autoVisible = true;
      await startMockReader(isCurrent);
    } else if (mode === 'manual') {
      runtime.reader = { status: 'manual', healthy: true, lastReadAt: Date.now() };
      runtime.autoVisible = true;
    } else if (!screenCaptureEnabled(settings)) {
      runtime.reader = { status: 'capture-disabled', healthy: false, lastReadAt: runtime.reader.lastReadAt };
      runtime.capture.running = false;
      runtime.autoVisible = false;
    } else {
      runtime.autoVisible = settings.overlay?.autoHide === false && runtime.game.detected;
      await startLocalReader(isCurrent);
    }
    if (!isCurrent()) {
      stopMockReader();
      await stopLocalReader();
      return;
    }
    applyVisibility('reader-configured');
    broadcastControlStatus();
  });
}

function stopReader() {
  return readerLifecycle.run(async () => {
    stopMockReader();
    await stopLocalReader();
  });
}

async function runControlAction(action) {
  switch (action) {
    case 'start':
      if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
      if (runtime.started) {
        runtime.requestedVisible = true;
        applyVisibility('control-start-already-running');
        logMessage('Overlay runtime is already running.');
        break;
      }
      runtime.started = true;
      runtime.requestedVisible = true;
      beginValidationSession();
      await scanForGameWindow();
      validationSession?.recordGameWindow(runtime.game);
      await configureReader();
      applyVisibility('control-start');
      logMessage('Overlay runtime started. The game was not launched by this app.');
      break;
    case 'stop':
      runtime.started = false;
      runtime.requestedVisible = false;
      await stopReader();
      runtime.capture.running = false;
      runtime.reader = { status: 'stopped', healthy: false, lastReadAt: runtime.reader.lastReadAt };
      setEditMode(false);
      applyVisibility('control-stop');
      logMessage('Overlay runtime stopped.');
      finishValidationSession('control-stop');
      break;
    case 'toggle':
      await executeCommand('toggle');
      break;
    case 'force-show': {
      if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
      const wasStarted = runtime.started;
      runtime.started = true;
      runtime.requestedVisible = true;
      runtime.automaticEnabled = false;
      runtime.autoVisible = true;
      if (!wasStarted) beginValidationSession();
      applyVisibility('control-force-show');
      if (!wasStarted) {
        await scanForGameWindow();
        validationSession?.recordGameWindow(runtime.game);
        await configureReader();
        runtime.autoVisible = true;
        applyVisibility('control-force-show-ready');
      }
      logMessage('Overlay forced ON. Automatic visibility is paused until it is resumed.');
      break;
    }
    case 'edit':
      beginEditMode();
      break;
    case 'lock-position':
      lockPosition();
      break;
    case 'follow-game':
      followGame();
      break;
    case 'reload': {
      const selectedTheme = configuredThemePath();
      if (selectedTheme && (selectedTheme !== runtime.themePath || runtime.mockMode)) setTheme(selectedTheme);
      else reloadTheme();
      break;
    }
    case 'automatic':
      runtime.automaticEnabled = !runtime.automaticEnabled;
      settings.overlay ||= {};
      settings.overlay.autoHide = runtime.automaticEnabled;
      persistSettings();
      if (!runtime.automaticEnabled) runtime.autoVisible = true;
      else {
        // The Home-screen Automatic control has one simple meaning: show only
        // while the native donor scoreboard is actually present. Re-enable
        // donor auto-hide here so an older "always show" setting cannot make
        // Automatic appear over gameplay menus or cutscenes.
        runtime.requestedVisible = true;
        if (settings.recognition?.mode === 'mock') runtime.autoVisible = validator?.visible ?? true;
      }
      applyVisibility('automatic-toggle');
      logMessage(`Automatic visibility ${runtime.automaticEnabled ? 'enabled' : 'disabled'}.`);
      break;
    case 'reposition':
      applyPlacementSettings();
      break;
    case 'restart-reader':
      await configureReader();
      logMessage('Reader restarted.');
      break;
    case 'fresh-read': {
      clearManualTeamOverrides({ publish: false, recordLog: false });
      if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
      if (!runtime.started) {
        runtime.started = true;
        runtime.requestedVisible = true;
        beginValidationSession();
      }
      runtime.support.lastRecognitionDiagnostics = null;
      runtime.support.lastRecognitionAt = null;
      await scanForGameWindow();
      validationSession?.recordGameWindow(runtime.game);
      await configureReader();
      reacquireRamReader('fresh read requested');
      applyVisibility('fresh-read');
      logMessage('Fresh read requested: the reader was restarted and is locating the game again.');
      break;
    }
    default:
      throw new Error(`Unknown control action: ${String(action)}`);
  }
  broadcastStatus();
  return publicStatus();
}

async function chooseThemePath() {
  const parent = libraryWindow && !libraryWindow.isDestroyed()
    ? libraryWindow
    : (controlWindow && !controlWindow.isDestroyed() ? controlWindow : overlayWindow);
  const result = await dialog.showOpenDialog(parent, {
    title: 'Choose scoreboard HTML',
    properties: ['openFile'],
    filters: [{ name: 'HTML scoreboard', extensions: ['html', 'htm'] }],
  });
  return result.canceled ? null : (result.filePaths[0] || null);
}

async function importThemeToLibrary() {
  const selected = await chooseThemePath();
  if (!selected) return { canceled: true, themes: listLibraryThemes() };
  const previous = themeLibraryStore().list();
  const theme = themeLibraryStore().importFile(selected);
  logMessage(`Theme imported into the library: ${theme.name}.`);
  carryThemeProfileForward(theme, previous);
  return { canceled: false, theme: publicLibraryTheme(theme), themes: listLibraryThemes() };
}

function useLibraryTheme(id) {
  const theme = themeLibraryStore().get(String(id || ''));
  setTheme(theme.path, theme);
  logMessage(`Theme selected from the library: ${theme.name}.`);
  return { theme: publicLibraryTheme(theme), themes: listLibraryThemes(), status: publicStatus() };
}

// Ctrl+Alt+B: switch to the next usable bug in the library (the order the
// library tab shows), wrapping around. Each bug's saved profile restores as
// it always does when a theme is selected.
function cycleLibraryTheme(direction = 1) {
  const themes = listLibraryThemes().filter((theme) => theme.compatibility?.canUse !== false);
  if (!themes.length) throw new Error('The HTML library is empty.');
  if (themes.length === 1) {
    logMessage(`Only one bug in the library: ${themes[0].name}.`);
    return useLibraryTheme(themes[0].id);
  }
  const activeIndex = themes.findIndex((theme) => theme.active);
  const next = themes[(activeIndex + (direction >= 0 ? 1 : -1) + themes.length) % themes.length];
  const result = useLibraryTheme(next.id);
  logMessage(`Switched to the next bug: ${next.name} (${((activeIndex + 1 + themes.length) % themes.length) + 1} of ${themes.length}).`);
  pushInGameEditorState();
  return result;
}

function deleteLibraryTheme(id) {
  const store = themeLibraryStore();
  const theme = store.get(String(id || ''));
  if (samePath(theme.path, runtime.themePath)) {
    const fallback = bundledOriginalThemePath();
    if (!fallback) throw new Error('The active theme cannot be deleted because the built-in fallback is missing.');
    setTheme(fallback);
  }
  const deleted = store.delete(theme.id);
  logMessage(`Theme deleted from the library: ${deleted.name}.`);
  return { deleted: { id: deleted.id, name: deleted.name }, themes: listLibraryThemes(), status: publicStatus() };
}

async function openLogs() {
  fs.mkdirSync(logsPath(), { recursive: true });
  const error = await shell.openPath(logsPath());
  if (error) throw new Error(error);
  return true;
}

async function openDataExport() {
  const target = automaticExtractionEnabled()
    ? automaticDataExtractor().snapshot().sessionPath
    : dataExportRootPath();
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return target;
}

// The plain-English RAM reader report shown on the Diagnostics tab. Reads the
// status and live files fresh on every call so a stalled broadcast can never
// show a stale diagnosis - the whole point is being accurate when broken.
// ---- Launch diagnosis window ------------------------------------------
// Answers "why is it not reading?" BEFORE the user has to ask: at launch the
// app checks everything that can stop a read (antivirus removed/blocked the
// reader, unwritable data folder, running from inside the zip, wrong source
// mode, second copy, elevation) and opens a plain-language window listing
// what it found, why it blocks reading, and the exact fix. Later, the reader
// problem watch routes real problems into the same window. Re-check runs it
// all again live so the user can confirm the fix without restarting.
let readerLaunchFailures = 0;
let readerLaunchError = null;
let diagnosisRefreshTimer = null;
let lastDiagnosisReport = null;
let elevationCache; // undefined = not probed yet, null = unknown

function probeElevation() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    if (elevationCache !== undefined) return resolve(elevationCache);
    execFile('whoami', ['/groups'], { timeout: 4000, windowsHide: true }, (error, stdout) => {
      elevationCache = error ? null : /S-1-16-12288|S-1-16-16384/.test(String(stdout || ''));
      resolve(elevationCache);
    });
  });
}

function probeDefenderDetection() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const script = "try { Get-MpThreatDetection -ErrorAction Stop | Where-Object { $_.Resources -match 'CollegeFB27RamReader' } | Select-Object -First 1 -ExpandProperty ThreatID | ForEach-Object { (Get-MpThreat -ThreatID $_).ThreatName } } catch { }";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true }, (error, stdout) => {
      const name = String(stdout || '').trim().split(/\r?\n/)[0];
      resolve(!error && name ? name : null);
    });
  });
}

function dataFolderWritable() {
  try {
    fs.mkdirSync(dataExportRootPath(), { recursive: true });
    const probe = path.join(dataExportRootPath(), `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function readerExeOnDisk() {
  const relative = path.join('ram-reader', 'CollegeFB27RamReader.exe');
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', relative)
    : path.join(app.getAppPath(), relative);
  let exists = false;
  try { exists = fs.statSync(candidate).isFile(); } catch { exists = false; }
  return { path: candidate, exists };
}

async function buildDiagnosisReport({ deep = false } = {}) {
  const onDisk = readerExeOnDisk();
  const executable = onDisk.path;
  const readerExeExists = onDisk.exists;
  const [elevated, defenderDetection] = await Promise.all([
    probeElevation(),
    (!readerExeExists && deep) ? probeDefenderDetection() : Promise.resolve(null),
  ]);
  const result = runPreflight({
    readerExePath: executable,
    readerExeExists,
    readerLaunchFailures,
    readerLaunchError,
    readerRunning: Boolean(ramReaderProcess && ramReaderProcess.exitCode === null && !ramReaderProcess.killed),
    dataFolderWritable: dataFolderWritable(),
    dataFolderPath: dataExportRootPath(),
    appPath: process.execPath,
    elevated,
    sourceMode: scoreboardDataSourceMode(),
    singleInstance: hasSingleInstanceLock,
    defenderDetection,
  });
  // Live reader problems (game running, reader stuck) join the same list.
  try {
    const doctor = ramReaderDoctor();
    const headline = ramProblemFromReport(doctor);
    const coveredByPreflight = result.findings.some((f) => f.id === 'reader-missing' || f.id === 'reader-blocked')
      && /reader is not running/i.test(headline || '');
    if (headline && !coveredByPreflight && !result.findings.some((f) => f.id === 'reader-live')) {
      const steps = (doctor.lines || [])
        .filter((l) => /^\s*\[(WARN|BAD)\]/.test(l))
        .map((l) => l.replace(/^\s*\[(WARN|BAD)\]\s*/, ''))
        .slice(0, 4);
      result.findings.push({
        id: 'reader-live',
        severity: 'bad',
        title: headline,
        why: 'The reader is running but reports it cannot read the game right now.',
        fix: steps.length ? steps : ['Open Diagnostics in the control panel and use Copy report to send the details.'],
        detail: null,
      });
      result.level = 'bad';
    }
  } catch { }
  const report = {
    ...result,
    alwaysShow: settings.diagnosis?.alwaysShowAtLaunch === true,
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
  };
  lastDiagnosisReport = report;
  return report;
}

function createDiagnosisWindow() {
  if (diagnosisWindow && !diagnosisWindow.isDestroyed()) {
    diagnosisWindow.show();
    diagnosisWindow.focus();
    return diagnosisWindow;
  }
  diagnosisWindow = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 560,
    minHeight: 420,
    show: false,
    title: 'CFB27 Scoreboard Overlay - Why it is not reading',
    backgroundColor: '#080c12',
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  diagnosisWindow.setMenu(null);
  installLocalNavigationGuard(diagnosisWindow, [DIAGNOSIS_DOCUMENT]);
  diagnosisWindow.loadFile(DIAGNOSIS_DOCUMENT);
  diagnosisWindow.once('ready-to-show', () => {
    if (!diagnosisWindow || diagnosisWindow.isDestroyed()) return;
    diagnosisWindow.show();
    // Only the first moments need to be on top; then behave like a window.
    setTimeout(() => { try { diagnosisWindow?.setAlwaysOnTop(false); } catch { } }, 2500).unref?.();
  });
  diagnosisWindow.on('closed', () => { diagnosisWindow = null; });
  return diagnosisWindow;
}

function sendDiagnosisReport(report) {
  if (diagnosisWindow && !diagnosisWindow.isDestroyed()) {
    diagnosisWindow.webContents.send('diagnosis:report', report);
  }
}

function scheduleDiagnosisRefresh() {
  if (diagnosisRefreshTimer) return;
  diagnosisRefreshTimer = setTimeout(async () => {
    diagnosisRefreshTimer = null;
    try {
      const report = await buildDiagnosisReport({ deep: true });
      if (report.level === 'bad') createDiagnosisWindow();
      sendDiagnosisReport(report);
    } catch { }
  }, 1500);
  diagnosisRefreshTimer.unref?.();
}

async function runLaunchDiagnosis() {
  try {
    const report = await buildDiagnosisReport({ deep: true });
    const mustShow = report.level === 'bad' || report.level === 'warn' || report.alwaysShow;
    logMessage(report.findings.length
      ? `Launch check: ${report.findings.length} issue(s) - ${report.findings.map((f) => f.title).join('; ')}`
      : 'Launch check: no problems found.');
    if (mustShow) {
      createDiagnosisWindow();
      sendDiagnosisReport(report);
    }
  } catch (error) {
    logMessage(`Launch check could not run: ${error.message}`);
  }
}

async function diagnosisMethod(method, payload) {
  switch (method) {
    case 'getReport':
      return lastDiagnosisReport || buildDiagnosisReport({ deep: true });
    case 'recheck': {
      readerLaunchFailures = 0;
      readerLaunchError = null;
      elevationCache = undefined;
      // Give a fixed reader a fresh start so "reader blocked" can clear.
      if (usesRamReader(scoreboardDataSourceMode()) && !(ramReaderProcess && ramReaderProcess.exitCode === null)) {
        startRamReaderService();
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return buildDiagnosisReport({ deep: true });
    }
    case 'copyReport': {
      const report = lastDiagnosisReport || await buildDiagnosisReport({ deep: true });
      clipboard.writeText(preflightReportText(report, { appVersion: report.appVersion, generatedAt: report.generatedAt })
        + '\n\n' + (ramReaderDoctor().reportText || ''));
      return true;
    }
    case 'setAlwaysShow':
      settings.diagnosis ||= {};
      settings.diagnosis.alwaysShowAtLaunch = Boolean(payload);
      persistSettings();
      return true;
    case 'close':
      diagnosisWindow?.close();
      return true;
    default:
      throw new Error(`Unknown diagnosis method: ${method}`);
  }
}

function ramReaderDoctor() {
  const executable = unpackedResource(path.join('ram-reader', 'CollegeFB27RamReader.exe'));
  let readerExePresent = true;
  try { readerExePresent = fs.existsSync(executable); } catch { }
  return buildRamReaderReport({
    now: Date.now(),
    appVersion: app.getVersion(),
    readerEnabled: usesRamReader(scoreboardDataSourceMode()),
    readerExePresent,
    readerProcessRunning: Boolean(ramReaderProcess && ramReaderProcess.exitCode === null && !ramReaderProcess.killed),
    status: readJsonFile(ramReaderStatusPath(), null),
    live: readJsonFile(ramLiveDataPath(), null),
    gameWindowDetected: Boolean(runtime.game?.detected),
  });
}

function copyRamReaderDoctor() {
  const report = ramReaderDoctor();
  clipboard.writeText(report.reportText);
  logMessage('Reader report copied to the clipboard.');
  return true;
}

// When the reader hits a REAL problem - not a normal wait - push the
// diagnosis to the user instead of hoping they open the Diagnostics tab:
// an alert banner in the control window plus one Windows notification per
// distinct problem. Normal states (game not running, locking on) never
// trigger it, so it cannot nag.
let ramProblemTimer = null;
let lastRamProblemHeadline = null;
let notifiedRamProblemHeadline = null;

function ramProblemFromReport(report) {
  if (!report) return null;
  if (report.level === 'bad') return report.headline;
  // The one warn-state worth interrupting for: a game window exists but the
  // reader cannot find the game process (unusual copies of the game).
  if (report.level === 'warn' && /cannot find a game process/i.test(report.headline)) {
    return report.headline;
  }
  return null;
}

function checkRamProblem() {
  if (!usesRamReader(scoreboardDataSourceMode())) return;
  let headline = null;
  try { headline = ramProblemFromReport(ramReaderDoctor()); } catch { }
  if (headline === lastRamProblemHeadline) return;
  lastRamProblemHeadline = headline;
  sendToControl('scoreboard:ram-problem', headline ? { headline } : null);
  if (headline) scheduleDiagnosisRefresh();
  if (headline && headline !== notifiedRamProblemHeadline) {
    notifiedRamProblemHeadline = headline;
    try {
      const alert = new Notification({
        title: 'CFB27 Scoreboard Overlay needs attention',
        body: headline,
      });
      alert.on('click', () => { controlWindow?.show?.(); controlWindow?.focus?.(); });
      alert.show();
    } catch { }
  }
}

function startRamProblemWatch() {
  if (ramProblemTimer) return;
  checkRamProblem();
  ramProblemTimer = setInterval(checkRamProblem, 10000);
  ramProblemTimer.unref?.();
}

function copyDiagnostics() {
  const readerProfile = resolvedReaderProfile();
  const displays = screen.getAllDisplays().map((display) => ({
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: Boolean(display.internal),
  }));
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    app: { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: {
      platform: process.platform,
      arch: process.arch,
      release: require('node:os').release(),
      displays,
    },
    status: supportSafeStatus(publicStatus()),
    activeReaderProfile: {
      key: readerProfile.key,
      origin: readerProfile.origin,
      expectedWidth: readerProfile.profile.captureWidth,
      expectedHeight: readerProfile.profile.captureHeight,
      readRegion: cloneJson(readerProfile.profile.readRegion),
      rois: cloneJson(readerProfile.profile.rois),
      fallbackReason: readerProfile.fallbackReason || null,
    },
    evidence: {
      captureHistory: cloneJson(runtime.support.captureHistory),
      consecutiveNoFrameTicks: runtime.support.consecutiveNoFrameTicks,
      lastRecognitionAt: runtime.support.lastRecognitionAt,
      latestRecognition: cloneJson(runtime.support.lastRecognitionDiagnostics),
      lastReaderError: cloneJson(runtime.support.lastReaderError),
      calibrationRestore: cloneJson(runtime.support.calibrationRestore),
      captureProfileValidation: cloneJson(runtime.capture.profileValidation),
      windowProbe: {
        configured: Boolean(String(process.env.CFB27_PYTHON || '').trim()),
        running: Boolean(windowProbe),
      },
      userDataMode: USER_DATA_LOCATION.mode,
    },
    settings: supportSafeSettings(settings),
  };
  clipboard.writeText(JSON.stringify(sanitizeSupportReport(report), null, 2));
  logMessage('Diagnostic report copied to the clipboard.');
  return true;
}

async function scoreboardMethod(method, payload) {
  switch (method) {
    case 'getStatus': return publicStatus();
    case 'getSettings': return settings;
    case 'getReaderProfiles': return publicReaderProfiles();
    case 'saveSettings': return saveSettings(payload);
    case 'saveOnboarding': return saveOnboarding(payload);
    case 'saveReaderProfile': return saveReaderProfile(payload);
    case 'saveReaderProfilePlacement': return saveReaderProfilePlacement(payload);
    case 'useReaderCalibration': return useReaderCalibration(payload);
    case 'saveAndExportReaderCalibration': return saveAndExportReaderCalibration(payload);
    case 'importReaderCalibration': return importReaderCalibration(payload);
    case 'resetReaderProfile': return resetReaderProfile(payload);
    case 'listCaptureSources': return listCaptureSources();
    case 'captureSnapshot': return captureSnapshot(payload);
    case 'setState': {
      const state = updateScoreboardState(payload);
      runtime.autoVisible = payload?.meta?.visible !== false;
      applyVisibility('manual-state');
      return state;
    }
    case 'action': return runControlAction(payload);
    case 'chooseTheme': return chooseThemePath();
    case 'listThemeLibrary': return listLibraryThemes();
    case 'importThemeToLibrary': return importThemeToLibrary();
    case 'useLibraryTheme': return useLibraryTheme(payload);
    case 'deleteLibraryTheme': return deleteLibraryTheme(payload);
    case 'cycleLibraryTheme': return cycleLibraryTheme(payload === -1 ? -1 : 1);
    case 'saveThemeProfile': return saveThemeProfile(payload);
    case 'clearThemeProfile': return clearThemeProfile(payload);
    case 'snapshotActiveTheme': return snapshotActiveTheme();
    case 'getTeamCatalog': return teamCatalogForPicker();
    case 'setFavoriteTeam': return setFavoriteTeam(payload);
    case 'openLogs': return openLogs();
    case 'openDataExport': return openDataExport();
    case 'copyDiagnostics': return copyDiagnostics();
    case 'ramReaderDoctor': return ramReaderDoctor();
    case 'copyRamReaderDoctor': return copyRamReaderDoctor();
    case 'requestStatsSearch': return requestStatsSearch(payload);
    case 'refreshDynasty': { await refreshDynastyContext({ force: true }); return dynastyStatusSummary(); }
    case 'listDynastySaves': return { saves: listDynastySaves(), chosen: String(dynastySettings().savePath || '') };
    case 'chooseDynastySave': {
      const chosen = String(payload || '').trim();
      dynastySettings().savePath = chosen && fs.existsSync(chosen) ? chosen : '';
      persistSettings();
      if (clearLoadedDynastyContext()) publishCurrentScoreboardState();
      await refreshDynastyContext({ force: true });
      return dynastyStatusSummary();
    }
    case 'saveTesterNotes': return saveTesterNotes(payload);
    case 'exportTestPackage': return exportTestPackage();
    case 'openDiagnosis': {
      createDiagnosisWindow();
      buildDiagnosisReport({ deep: true }).then(sendDiagnosisReport).catch(() => {});
      return true;
    }
    default: throw new Error(`Unknown scoreboard method: ${String(method)}`);
  }
}

async function chooseTheme() {
  const selected = await chooseThemePath();
  if (!selected) return statusSnapshot();
  return setTheme(selected);
}

async function executeCommand(command, payload) {
  switch (command) {
    case 'show':
      runtime.requestedVisible = true;
      applyVisibility('manual-show');
      return statusSnapshot();
    case 'hide':
      runtime.requestedVisible = false;
      setEditMode(false);
      applyVisibility('manual-hide');
      return statusSnapshot();
    case 'toggle':
      runtime.requestedVisible = !runtime.requestedVisible;
      if (!runtime.requestedVisible && runtime.editMode) lockPosition();
      applyClickThrough();
      applyVisibility('manual-toggle');
      return statusSnapshot();
    case 'set-edit-mode':
      setEditMode(Boolean(payload));
      return statusSnapshot();
    case 'toggle-edit-mode':
      setEditMode(!runtime.editMode);
      return statusSnapshot();
    case 'lock-position':
      lockPosition();
      return statusSnapshot();
    case 'follow-game':
      followGame();
      return statusSnapshot();
    case 'toggle-quick-settings':
      return toggleQuickSettings();
    case 'close-quick-settings':
      return closeInGameEditor();
    case 'get-in-game-editor-state':
      return inGameEditorState();
    case 'in-game-editor-ready':
      pushInGameEditorState();
      return inGameEditorState();
    case 'move-overlay':
      return moveOverlayFromPointer(payload);
    case 'resize-overlay':
      return resizeOverlayFromHandle(payload);
    case 'set-crop-mode':
      return setCropMode(payload);
    case 'reset-theme-crop':
      return resetThemeCrop();
    case 'set-manual-team-override':
      return setManualTeamOverride(payload);
    case 'clear-manual-team-overrides':
      return clearManualTeamOverrides();
    case 'set-team-logo-preference':
      return setTeamLogoPreference(payload);
    case 'import-team-logo':
      return importTeamLogo(payload);
    case 'get-team-catalog':
      return teamCatalogForPicker();
    case 'set-theme-setting':
      return setThemeSetting(payload);
    case 'set-favorite-team':
      return setFavoriteTeam(payload);
    case 'get-team-palettes':
      return teamPaletteImages(payload);
    case 'import-team-palette':
      return importTeamPalette(payload);
    case 'delete-team-palette':
      return deleteTeamPalette(payload);
    case 'save-custom-team':
      return saveCustomTeam(payload);
    case 'delete-custom-team':
      return deleteCustomTeam(payload);
    case 'import-custom-team-logo':
      return importCustomTeamLogo(payload);
    case 'clear-custom-team-logo':
      return clearCustomTeamLogo(payload);
    case 'delete-imported-team-logo':
      return deleteImportedTeamLogo(payload);
    case 'preview-team-logo-transform':
      return previewTeamLogoTransform(payload);
    case 'save-team-logo-transform':
      return saveTeamLogoTransform(payload);
    case 'capture-team-logo-placement':
      return captureTeamLogoPlacement(payload);
    case 'report-team-logo-geometry':
      return reportTeamLogoGeometry(payload);
    case 'set-green-screen-enabled':
      return setGreenScreenEnabled(payload);
    case 'set-scorebug-color':
      return setScorebugColor(payload);
    case 'save-scorebug-color-scope':
      return saveScorebugColorScopeCommand(payload);
    case 'clear-scorebug-color-scope':
      return clearScorebugColorScopeCommand(payload);
    case 'delete-scorebug-color-rule':
      return deleteScorebugColorRuleCommand(payload);
    case 'capture-screen-for-eyedropper':
      return captureScreenForEyedropper();
    case 'save-scorebug-color-preset':
      return saveScorebugColorPresetCommand(payload);
    case 'apply-scorebug-color-preset':
      return applyScorebugColorPresetCommand(payload);
    case 'delete-scorebug-color-preset':
      return deleteScorebugColorPresetCommand(payload);
    case 'center-overlay':
      return centerOverlay(payload);
    case 'set-editor-type-focus':
      return setInGameEditorTypeFocus(payload);
    case 'fresh-read':
      await runControlAction('fresh-read');
      return statusSnapshot();
    case 'reload':
      reloadTheme();
      return statusSnapshot();
    case 'set-theme':
      return setTheme(payload);
    case 'choose-theme':
      return chooseTheme();
    case 'use-mock':
      themeProtocolController?.deactivate();
      runtime.mockMode = true;
      runtime.themeRevision += 1;
      sendToOverlay('overlay:theme', {
        themePath: null,
        themeUrl: null,
        themeRevision: runtime.themeRevision,
      });
      broadcastStatus();
      return statusSnapshot();
    case 'set-state':
      return updateScoreboardState(payload);
    case 'set-game-bounds': {
      const bounds = normalizeBounds(payload);
      if (!bounds) throw new Error('Game bounds require numeric x, y, width and height.');
      runtime.gameBounds = bounds;
      if (typeof payload.visible === 'boolean' || typeof payload.foreground === 'boolean') {
        runtime.autoVisible = bounds.visible && bounds.foreground;
      }
      positionOverlay();
      syncInGameEditorBounds();
      applyVisibility('game-bounds');
      return statusSnapshot();
    }
    case 'clear-game-bounds':
      runtime.gameBounds = null;
      positionOverlay();
      syncInGameEditorBounds();
      broadcastStatus();
      return statusSnapshot();
    case 'set-layout':
      runtime.layout = normalizeLayout(payload);
      positionOverlay();
      sendToOverlay('overlay:layout', runtime.layout);
      broadcastStatus();
      return statusSnapshot();
    case 'set-auto-visible':
      runtime.autoVisible = Boolean(payload);
      applyVisibility('automatic-visibility');
      return statusSnapshot();
    case 'get-state':
      return runtime.scoreboardState;
    case 'get-status':
      return statusSnapshot();
    case 'renderer-ready':
      sendToOverlay('overlay:scoreboard-state', runtime.scoreboardState);
      sendToOverlay('overlay:edit-mode', runtime.editMode);
      return statusSnapshot();
    default:
      throw new Error(`Unknown overlay command: ${String(command)}`);
  }
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.overlay?.alwaysOnTop !== false,
    focusable: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  overlayWindow.setMenu(null);
  applyWindowBehaviorSettings();
  overlayWindow.setSkipTaskbar(true);
  // Target-window capture already excludes this separate HWND. Keep content
  // protection off so ordinary screenshots and OBS Display Capture can include
  // the finished scorebug for visual testing.
  overlayWindow.setContentProtection(false);
  try {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // The option is platform-dependent; always-on-top still applies on Windows.
  }

  positionOverlay();

  themeWebviewSecurityDisposer?.();
  themeWebviewSecurityDisposer = attachThemeWebviewGuards(overlayWindow.webContents, {
    getActiveThemeUrl: () => themeProtocolController?.getActiveUrl() || null,
    onBlocked: ({ type, reason }) => {
      logMessage(`Protected scoreboard HTML blocked ${reason || type || 'an unsafe action'}.`);
    },
  });
  // A <webview> guest paints an opaque backdrop by default, so a scorebug
  // built with a transparent background showed BLACK around the artwork
  // (green-screen mode hid this only because the key filter forces alpha
  // compositing). Make the guest surface itself transparent so transparent
  // HTML is see-through natively - no green canvas or filter required.
  overlayWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    try { guestWebContents.setBackgroundColor('#00000000'); } catch { }
    guestWebContents.on('did-finish-load', () => {
      try { guestWebContents.setBackgroundColor('#00000000'); } catch { }
    });
  });
  installLocalNavigationGuard(overlayWindow, [OVERLAY_DOCUMENT]);
  overlayWindow.loadFile(OVERLAY_DOCUMENT);
  overlayWindow.once('ready-to-show', () => applyVisibility('ready'));
  overlayWindow.on('closed', () => {
    themeWebviewSecurityDisposer?.();
    themeWebviewSecurityDisposer = null;
    overlayWindow = null;
    if (!shuttingDown) {
      logMessage('Overlay renderer window closed. Reopen it with Start overlay.');
      broadcastControlStatus();
    }
  });
  overlayWindow.on('move', () => handleOverlayBoundsChanged('move'));
  overlayWindow.on('resize', () => handleOverlayBoundsChanged('resize'));
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    show: false,
    backgroundColor: '#08101a',
    title: PRODUCT_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  controlWindow.setMenu(null);
  installLocalNavigationGuard(controlWindow, [CONTROL_DOCUMENT]);
  const initialPanel = process.argv.includes('--library') ? 'library' : '';
  controlWindow.loadFile(
    CONTROL_DOCUMENT,
    initialPanel ? { query: { panel: initialPanel } } : undefined,
  );
  controlWindow.once('ready-to-show', () => {
    controlWindow.show();
    sendToControl('scoreboard:state', runtime.scoreboardState);
    broadcastControlStatus();
  });
  controlWindow.on('closed', () => {
    controlWindow = null;
    if (!shuttingDown) app.quit();
  });
}

function createLibraryWindow() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    if (libraryWindow.isMinimized()) libraryWindow.restore();
    libraryWindow.show();
    libraryWindow.focus();
    return libraryWindow;
  }
  libraryWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    show: false,
    backgroundColor: '#090d13',
    title: 'HTML Scoreboard Library',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  libraryWindow.setMenu(null);
  installLocalNavigationGuard(libraryWindow, [LIBRARY_DOCUMENT]);
  libraryWindow.loadFile(LIBRARY_DOCUMENT);
  libraryWindow.webContents.once('did-finish-load', async () => {
    if (!process.argv.includes('--library-smoke')) return;
    try {
      const result = await libraryWindow.webContents.executeJavaScript(`new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
          attempts += 1;
          const cards = document.querySelectorAll('.theme-card');
          const message = document.getElementById('library-message')?.textContent || '';
          if (cards.length || /failed|error/i.test(message) || attempts >= 40) {
            resolve({
              cards: cards.length,
              message,
              original: document.getElementById('original-status')?.textContent || '',
            });
          } else setTimeout(check, 100);
        };
        check();
      })`, true);
      const passed = result.cards >= 1 && /exactly matches/i.test(result.original) && !/failed|error/i.test(result.message);
      console.log(`[library-smoke] ${JSON.stringify({ ...result, passed })}`);
      app.exit(passed ? 0 : 1);
    } catch (error) {
      console.error(`[library-smoke] ${error.stack || error.message}`);
      app.exit(1);
    }
  });
  libraryWindow.once('ready-to-show', () => {
    libraryWindow.show();
    libraryWindow.focus();
  });
  libraryWindow.on('closed', () => {
    libraryWindow = null;
    if (!controlWindow && !shuttingDown) app.quit();
  });
  return libraryWindow;
}

function parseBounds(value) {
  const parts = String(value || '').split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function commandLineValue(prefix) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : '';
}

async function runPackagedOcrSmoke() {
  const reportPath = commandLineValue('--ocr-smoke-output=');
  const report = {
    passed: false,
    version: app.getVersion(),
    packaged: app.isPackaged,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    userDataMode: USER_DATA_LOCATION.mode,
    readerProfiles: {},
    workerPhysical: false,
    languagePhysical: false,
    corePhysical: false,
    teamAssets: {},
    progress: [],
  };
  let worker = null;
  try {
    const profileCatalog = getReaderProfileCatalog();
    for (const key of ['1080p', '1440p', '2160p']) {
      const profile = profileCatalog.profiles[key];
      report.readerProfiles[key] = {
        captureWidth: profile?.captureWidth || null,
        captureHeight: profile?.captureHeight || null,
        roiCount: Object.keys(profile?.rois || {}).length,
      };
      const roiKeys = Object.keys(profile?.rois || {});
      if (!profile
        || roiKeys.length !== REQUIRED_ROI_KEYS.length
        || !REQUIRED_ROI_KEYS.every((binding) => roiKeys.includes(binding))) {
        throw new Error(`Packaged reader profile is incomplete: ${key}`);
      }
    }
    const workerOptions = getBundledOcrWorkerOptions();
    const languageData = getBundledLanguageData();
    const physicalMarker = `${path.sep}app.asar.unpacked${path.sep}`;
    report.workerPhysical = workerOptions.workerPath.includes(physicalMarker);
    report.languagePhysical = languageData.langPath.includes(physicalMarker);
    report.corePhysical = workerOptions.corePath.includes(physicalMarker);
    if (app.isPackaged && (!report.workerPhysical || !report.languagePhysical || !report.corePhysical)) {
      throw new Error('Packaged OCR assets did not resolve to physical app.asar.unpacked files');
    }
    const resolver = TeamAssetResolver.fromAppRoot(app.getAppPath());
    for (const teamName of ['PENN STATE', 'PITTSBURGH']) {
      const asset = resolver.resolve(teamName);
      const logoBytes = asset?.logo
        ? Buffer.from(asset.logo.split(',')[1] || '', 'base64').length
        : 0;
      const validLogo = Boolean(
        asset
        // Default logos are now tightly cropped, so their transparent canvas
        // is intentionally smaller than the old 500/512px square while the
        // visible artwork remains high resolution.
        && Math.max(asset.width, asset.height) >= 250
        && (asset.width * asset.height) >= 25_000
        && logoBytes >= 10_000
        && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(asset.logo || ''),
      );
      report.teamAssets[teamName] = {
        name: asset?.name || null,
        width: asset?.width || null,
        height: asset?.height || null,
        logoBytes,
        passed: validLogo,
      };
      if (!validLogo) throw new Error(`Packaged team logo is unavailable or too small: ${teamName}`);
    }
    worker = new LocalScoreboardOcr({
      workerOptions: {
        ...workerOptions,
        errorHandler(error) {
          report.workerError = String(error?.message || error || 'Unknown OCR worker error');
        },
      },
      languageData,
      logger(message) {
        const status = String(message?.status || '').trim();
        if (status && !report.progress.includes(status)) report.progress.push(status);
      },
    });
    let timeout;
    await Promise.race([
      worker.initialize(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('OCR initialization timed out after 45 seconds')), 45_000);
      }),
    ]).finally(() => clearTimeout(timeout));
    const requiredProgress = [
      'loading tesseract core',
      'initializing tesseract',
      'loading language traineddata',
      'initializing api',
    ];
    const missingProgress = requiredProgress.filter((status) => !report.progress.includes(status));
    if (missingProgress.length) throw new Error(`OCR startup did not reach: ${missingProgress.join(', ')}`);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
  } finally {
    await worker?.terminate().catch(() => {});
  }
  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  const label = report.passed ? 'passed' : 'failed';
  console.log(`[ocr-smoke] ${label} ${JSON.stringify(report)}`);
  return report.passed;
}

async function applyCommandLine(argv) {
  const themeArg = argv.find((arg) => arg.startsWith('--theme='));
  const boundsArg = argv.find((arg) => arg.startsWith('--game-bounds='));
  if (themeArg) await executeCommand('set-theme', themeArg.slice('--theme='.length));
  if (boundsArg) {
    const parsed = parseBounds(boundsArg.slice('--game-bounds='.length));
    if (parsed) await executeCommand('set-game-bounds', parsed);
  }
  if (argv.includes('--mock')) {
    settings = deepMerge(settings, { recognition: { mode: 'mock' } });
    runtime.mockMode = false;
    if (runtime.themePath) setTheme(runtime.themePath);
    runtime.started = true;
    runtime.requestedVisible = true;
    await configureReader();
  }
  if (argv.includes('--start')) await runControlAction('start');
  if (argv.includes('--show')) await executeCommand('show');
  if (argv.includes('--hide')) await executeCommand('hide');
  if (argv.includes('--toggle')) await executeCommand('toggle');
  if (argv.includes('--edit')) await executeCommand('toggle-edit-mode');
  if (argv.includes('--reload')) await executeCommand('reload');
  if (argv.includes('--library')) createLibraryWindow();
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const shortcuts = deepMerge({
    toggle: 'CommandOrControl+Alt+S',
    edit: 'CommandOrControl+Alt+E',
    reload: 'CommandOrControl+Alt+R',
    automatic: 'CommandOrControl+Alt+A',
    calibrationCapture: 'CommandOrControl+Alt+C',
    quickSettings: 'CommandOrControl+Alt+O',
    freshRead: 'CommandOrControl+Alt+F',
    nextTheme: 'CommandOrControl+Alt+B',
  }, settings.hotkeys || {});
  const registrations = [
    [shortcuts.toggle, () => executeCommand('toggle')],
    [shortcuts.edit, () => executeCommand('toggle-edit-mode')],
    [shortcuts.reload, () => executeCommand('reload')],
    [shortcuts.automatic, () => runControlAction('automatic')],
    [shortcuts.calibrationCapture, captureCalibrationFromShortcut],
    [shortcuts.quickSettings, () => executeCommand('toggle-quick-settings')],
    [shortcuts.freshRead, () => runControlAction('fresh-read')],
    [shortcuts.nextTheme, () => cycleLibraryTheme(1)],
  ];
  for (const [accelerator, callback] of registrations) {
    if (!accelerator) continue;
    const registered = globalShortcut.register(accelerator, () => {
      Promise.resolve(callback()).catch((error) => logMessage(`Hotkey action failed: ${error.message}`));
    });
    if (!registered) logMessage(`Hotkey is already in use: ${accelerator}`);
  }
}

app.setAppUserModelId(APP_ID);
const ocrSmokeRequested = process.argv.includes('--ocr-smoke');
const hasSingleInstanceLock = ocrSmokeRequested || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  if (!ocrSmokeRequested) {
    app.on('second-instance', (_event, argv) => {
      applyCommandLine(argv).catch((error) => console.error('[overlay] command-line control failed:', error));
      if (!argv.includes('--library') && controlWindow && !controlWindow.isDestroyed()) {
        if (controlWindow.isMinimized()) controlWindow.restore();
        controlWindow.show();
        controlWindow.focus();
      }
    });
  }

  app.whenReady().then(async () => {
    if (process.argv.includes('--ocr-smoke')) {
      const passed = await runPackagedOcrSmoke();
      app.exit(passed ? 0 : 1);
      return;
    }
    const isolatedThemeSession = getIsolatedThemeSession(session);
    themeProtocolController = createThemeProtocolController();
    themeProtocolController.install(isolatedThemeSession.protocol);
    themeSessionSecurity = configureThemeSession(isolatedThemeSession, {
      getActiveThemeUrl: () => themeProtocolController?.getActiveUrl() || null,
    });
    await themeSessionSecurity.cleanupPromise;

    loadSettings();
    if (automaticExtractionEnabled()) {
      const extraction = automaticDataExtractor().start();
      logMessage(`Automatic data extraction is writing to ${extraction.sessionPath}`);
    }
    if (!process.argv.includes('--library') && !process.argv.includes('--library-smoke')) {
      applyScoreboardDataSourcePreference({ publish: false });
    }
    ensureBundledOriginalThemeInLibrary();
    repairKnownThemeLibraryBugs();
    try { startDynastyWatch(); } catch (error) { logMessage(`Dynasty watch could not start: ${error.message}`); }
    runtime.positionLocked = settings.overlay?.positionLocked === true;
    const initialThemePath = configuredThemePath();
    runtime.themePath = null;
    if (initialThemePath) {
      try {
        setTheme(initialThemePath, settings.theme, { rememberPrevious: false });
      } catch (error) {
        logMessage(`Saved scoreboard HTML was blocked: ${error.message}`);
        const bundledTheme = bundledOriginalThemePath();
        if (bundledTheme) {
          setTheme(bundledTheme, {}, { rememberPrevious: false });
        }
      }
    }
    runtime.mockMode = runtime.mockMode || !runtime.themePath;
    runtime.automaticEnabled = settings.overlay?.autoHide !== false;

    ipcMain.handle('overlay:command', (event, command, payload) => {
      assertTrustedIpcSender(event, [
        { window: overlayWindow, documents: [OVERLAY_DOCUMENT] },
        { window: inGameEditorWindow, documents: [IN_GAME_EDITOR_DOCUMENT] },
      ], 'overlay:command');
      return executeCommand(command, payload);
    });
    ipcMain.handle('scoreboard:method', (event, method, payload) => {
      assertTrustedIpcSender(event, [
        { window: controlWindow, documents: [CONTROL_DOCUMENT] },
        { window: libraryWindow, documents: [LIBRARY_DOCUMENT] },
      ], 'scoreboard:method');
      return scoreboardMethod(method, payload);
    });
    ipcMain.handle('diagnosis:method', (event, method, payload) => {
      assertTrustedIpcSender(event, [
        { window: diagnosisWindow, documents: [DIAGNOSIS_DOCUMENT] },
      ], 'diagnosis:method');
      return diagnosisMethod(method, payload);
    });
    createOverlayWindow();
    const libraryOnly = (process.argv.includes('--library') || process.argv.includes('--library-smoke'))
      && !process.argv.some((argument) => ['--start', '--show', '--toggle', '--edit'].includes(argument));
    if (libraryOnly) createLibraryWindow();
    else createControlWindow();
    applyPlacementSettings({ restoreLocked: true });
    if (!libraryOnly) {
      registerShortcuts();
      startWindowProbe();
    }

    screen.on('display-added', handleDisplayConfigurationChanged);
    screen.on('display-removed', handleDisplayConfigurationChanged);
    screen.on('display-metrics-changed', handleDisplayConfigurationChanged);

    if (!libraryOnly) {
      await scanForGameWindow();
      sourcePollTimer = setInterval(() => {
        scanForGameWindow().catch((error) => logMessage(`Window scan failed: ${error.message}`));
      }, 2500);
      sourcePollTimer.unref?.();
    }

    if (!libraryOnly && !process.argv.includes('--mock') && !process.argv.includes('--start')) {
      await runControlAction('start');
    }
    await applyCommandLine(process.argv);
    logMessage('Control center ready. This app never launches the game.');
    if (!libraryOnly) {
      // Let the reader attempt its first launch, then judge everything at once.
      setTimeout(() => { runLaunchDiagnosis(); }, 3500).unref?.();
    }
  }).catch((error) => {
    console.error('[overlay] startup failed:', error);
    app.quit();
  });
}

app.on('activate', () => {
  if (!overlayWindow) createOverlayWindow();
  if (!controlWindow && !libraryWindow) createControlWindow();
  else if (controlWindow) controlWindow.show();
  else libraryWindow.show();
});

app.on('before-quit', () => {
  shuttingDown = true;
  themeWebviewSecurityDisposer?.();
  themeWebviewSecurityDisposer = null;
  themeSessionSecurity?.dispose();
  themeSessionSecurity = null;
  themeProtocolController?.dispose().catch(() => {});
  themeProtocolController = null;
  visibilityTransitionGate.cancel();
  finishValidationSession('app-quit');
  if (sourcePollTimer) clearInterval(sourcePollTimer);
  readerLifecycle.invalidate();
  stopMockReader();
  stopLocalReader().catch(() => {});
  captureStream?.dispose().catch(() => {});
  stopWindowProbe();
  stopRamScoreboardBridge();
  stopRamReaderService();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => app.quit());
