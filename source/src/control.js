(function () {
  const $ = (id) => document.getElementById(id);
  const qsa = (selector) => [...document.querySelectorAll(selector)];
  const api = window.scoreboard || createBrowserFallback();
  const regionApi = window.Cfb27ReadRegion;
  const roiAutoFitApi = window.Cfb27RoiAutoFit;
  const presetApi = window.Cfb27PresetReadRegion;
  const resolutionApi = window.Cfb27ResolutionProfile;
  const chromaKeyApi = window.CFB27ChromaKey;
  const verificationApi = window.Cfb27WizardVerification;
  const CALIBRATION_ZOOM_MIN = 1;
  const CALIBRATION_ZOOM_MAX = 4;
  const CALIBRATION_ZOOM_STEP = 0.25;
  const DEFAULT_APP_HOTKEYS = Object.freeze({
    toggle: 'CommandOrControl+Alt+S',
    edit: 'CommandOrControl+Alt+E',
    reload: 'CommandOrControl+Alt+R',
    automatic: 'CommandOrControl+Alt+A',
    calibrationCapture: 'CommandOrControl+Alt+C',
    quickSettings: 'CommandOrControl+Alt+O',
    freshRead: 'CommandOrControl+Alt+F',
  });
  const APP_HOTKEY_FIELDS = Object.freeze({
    toggle: 'toggle-hotkey',
    edit: 'edit-hotkey',
    reload: 'reload-hotkey',
    automatic: 'automatic-hotkey',
    calibrationCapture: 'calibration-capture-hotkey',
    quickSettings: 'quick-settings-hotkey',
    freshRead: 'fresh-read-hotkey',
  });
  // These match reader-profile validation. Keeping independent dimensions is
  // important: a timeout bar only needs two source rows before the whole crop
  // is canonically upscaled, while text still needs six source columns.
  const ROI_MINIMUM_SOURCE_WIDTH_PIXELS = 6;
  const ROI_MINIMUM_SOURCE_HEIGHT_PIXELS = 2;
  const ROI_DISPLAY = Object.freeze([
    ['away.name', 'Away team name'],
    ['away.record', 'Away record'],
    ['away.timeouts', 'Away timeouts'],
    ['away.score', 'Away score'],
    ['away.possession', 'Possession marker'],
    ['home.name', 'Home team name'],
    ['home.record', 'Home record'],
    ['home.timeouts', 'Home timeouts'],
    ['home.score', 'Home score'],
    ['game.quarter', 'Quarter'],
    ['game.clock', 'Game clock'],
    ['game.playClock', 'Play clock'],
    ['game.downDistance', 'Down and distance'],
  ]);
  const ROI_LABELS = new Map(ROI_DISPLAY);
  let settings = null;
  let snapshotImage = null;
  let opticalReaderPreview = null;
  let calibrationZoom = CALIBRATION_ZOOM_MIN;
  let readRegionGesture = false;
  // Two-click guided placement: click the scorebug's top-left corner, then
  // its bottom-right corner; the locked-layout box is fitted to those clicks.
  let cornerPlacement = null;
  // Per-box fine-tuning: select one of the 13 reading areas and move/resize
  // it within the bounded band the save-time layout lock accepts.
  let roiEditMode = false;
  let selectedRoiName = null;
  let roiGesture = null;
  const lockedRoiNames = new Set();
  let fixedReadRegionPlacer = null;
  let factoryPreset = null;
  let presetPlacementReady = false;
  let snapshotRequestSerial = 0;
  let activeSnapshotRequest = 0;
  let sourceRefreshPromise = null;
  let rois = {};
  let scaleControlManuallyChanged = false;
  let currentStatus = {};
  let currentScoreboardState = null;
  // The last state whose meta.source was local-ocr, with its arrival time.
  // Manual, mock, and placeholder states never overwrite it, so wizard
  // verification is judged against actual reader output only.
  let lastLiveScoreboardState = null;
  let lastLiveScoreboardStateAt = null;
  let readerFindingSince = null;
  let calibrationWarningShown = false;
  let setupWizardActive = false;
  let setupWizardStep = 0;
  let setupWizardAutoResolutionApplied = false;
  let previewObservers = [];
  const logLines = [];

  const defaultState = {
    away: { name: 'Notre Dame', shortName: 'NOTRE DAME', nickname: 'Fighting Irish', score: 0, rank: 3, record: '8-1', timeouts: 3, possession: true },
    home: { name: 'Miami', shortName: 'MIAMI', nickname: 'Hurricanes', score: 7, rank: 7, record: '8-0', timeouts: 3, possession: false },
    game: { quarter: '1st', clock: '3:23', playClock: '14', downDistance: '3rd & 6' },
    meta: { source: 'manual', confidence: 100, visible: true }
  };

  function createBrowserFallback() {
    let fallbackSettings = {
      onboarding: { version: 1, completed: false, skipped: false, step: 0 },
      theme: {
        path: '',
        canvasWidth: 371,
        canvasHeight: 433,
        chromaKey: { enabled: false, color: '#00ff00', tolerance: 0.06, softness: 0.04 }
      },
      overlay: { scale: .674, scaleAt2160: .674, outputResolution: '2160p', anchor: 'bottom-center', marginX: 0, marginY: 32, positionLocked: false, autoHide: true, hideWhenGameUnfocused: true },
      capture: {
        sourceId: '',
        readRegion: { x: .72, y: .68, width: .27, height: .3 },
        roiSpace: 'read-region',
        rois: {}
      },
      recognition: { mode: 'manual', readingProfile: 'safe', minimumConfidence: 20, stableFrames: 2, clockOffsetSeconds: 0 },
      dataExtraction: { enabled: true, screenIntervalMs: 2000, eventScreenIntervalMs: 500 },
      hotkeys: { quickSettings: 'CommandOrControl+Alt+O', freshRead: 'CommandOrControl+Alt+F' }
    };
    return {
      getStatus: async () => ({ version: 'browser-preview', game: { detected: false }, capture: { running: false }, reader: { status: 'preview' }, overlay: { visible: false, placementMode: 'follow-game' } }),
      getSettings: async () => fallbackSettings,
      getReaderProfiles: async () => [],
      saveSettings: async (next) => (fallbackSettings = next),
      saveOnboarding: async (state) => (fallbackSettings.onboarding = state),
      saveReaderProfile: async () => ({ settings: fallbackSettings, profiles: [] }),
      saveReaderProfilePlacement: async () => ({ settings: fallbackSettings, profiles: [] }),
      useReaderCalibration: async () => ({ settings: fallbackSettings, profiles: [], used: true }),
      saveAndExportReaderCalibration: async () => ({ settings: fallbackSettings, profiles: [], canceled: true, exported: false }),
      importReaderCalibration: async () => ({ settings: fallbackSettings, profiles: [], canceled: true, imported: false }),
      resetReaderProfile: async () => ({ settings: fallbackSettings, profiles: [] }),
      listCaptureSources: async () => [],
      captureSnapshot: async () => null,
      setState: async () => true,
      action: async () => true,
      chooseTheme: async () => null,
      listThemeLibrary: async () => [],
      importThemeToLibrary: async () => ({ canceled: true, themes: [] }),
      useLibraryTheme: async () => ({ themes: [] }),
      deleteLibraryTheme: async () => ({ themes: [] }),
      openLogs: async () => false,
      openDataExport: async () => false,
      copyDiagnostics: async () => false,
      ramReaderDoctor: async () => null,
      copyRamReaderDoctor: async () => false,
      onStatus: () => () => {}, onState: () => () => {}, onLog: () => () => {}, onPanel: () => () => {}, onCalibrationSnapshot: () => () => {}
    };
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function appendLog(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    logLines.push(line);
    if (logLines.length > 300) logLines.shift();
    $('log-output').textContent = logLines.join('\n');
    $('log-output').scrollTop = $('log-output').scrollHeight;
  }

  function numberValue(id, fallback = 0) {
    const value = Number($(id).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizeReadingProfile(value) {
    return String(value || '').trim().toLowerCase() === 'aggressive' ? 'aggressive' : 'safe';
  }

  function normalizeScoreboardDataSource(value) {
    const mode = String(value || '').trim().toLowerCase();
    return ['auto', 'ram', 'screen'].includes(mode) ? mode : 'auto';
  }

  function scoreboardDataSourceLabel(value) {
    return {
      auto: 'Automatic',
      ram: 'RAM reader',
      screen: 'Screen reader',
    }[normalizeScoreboardDataSource(value)];
  }

  function renderScoreboardDataSource(value) {
    const mode = normalizeScoreboardDataSource(value);
    if ($('scoreboard-data-source')) $('scoreboard-data-source').value = mode;
    $('mode-badge').textContent = scoreboardDataSourceLabel(mode);
    const help = {
      auto: 'RAM is preferred. If it is unavailable, the screen reader keeps the scoreboard working.',
      ram: 'Only confirmed RAM values are used. The screen still tells the app when the native scorebug is visible.',
      screen: 'Only screen-reader values are used. The hidden RAM reader is turned off.',
    }[mode];
    if ($('scoreboard-data-source-help')) $('scoreboard-data-source-help').textContent = help;
  }

  function renderReadingProfile() {
    const key = normalizeReadingProfile(settings?.recognition?.readingProfile);
    const label = key === 'aggressive' ? 'Aggressive' : 'Safe';
    if ($('active-reading-profile')) $('active-reading-profile').textContent = label;
    if ($('active-reading-profile-badge')) {
      $('active-reading-profile-badge').textContent = key === 'aggressive' ? 'EXPERIMENTAL' : 'CURRENT / SAFE';
      $('active-reading-profile-badge').classList.toggle('neutral', key === 'aggressive');
    }
    qsa('[data-reading-profile]').forEach((button) => {
      const active = button.dataset.readingProfile === key;
      button.setAttribute('aria-checked', String(active));
      const action = button.querySelector('.reading-profile-action');
      if (action) action.textContent = active
        ? `${label} is active`
        : `Use ${button.dataset.readingProfile === 'aggressive' ? 'Aggressive' : 'Safe'}`;
    });
  }

  function setScaleControl(scale) {
    const numeric = Number(scale);
    const safe = Number.isFinite(numeric) ? numeric : 0.72;
    $('overlay-scale').value = String(Math.round(safe * 10000) / 100);
    $('scale-output').value = `${Math.round(safe * 100)}%`;
  }

  function themeLabel(themePath, explicitName = '') {
    if (explicitName) return explicitName;
    if (!themePath) return 'Built-in scoreboard';
    const fileName = String(themePath).split(/[\\/]/).filter(Boolean).pop() || 'Custom HTML';
    return fileName.toLowerCase() === 'index.html' ? 'Selected HTML scoreboard' : fileName.replace(/\.html?$/i, '');
  }

  function updateThemeSummary(themePath, explicitName = '') {
    $('simple-theme-name').textContent = themeLabel(themePath, explicitName);
    $('simple-theme-name').title = themePath || 'Built-in scoreboard';
  }

  function resolutionProfileLabel(key) {
    return {
      '720p': '1280 × 720 (720p)',
      '1080p': '1920 × 1080 (1080p)',
      '1080p-ultrawide': '2560 × 1080 (Ultrawide)',
      '1440p': '2560 × 1440 (1440p)',
      '1440p-ultrawide': '3440 × 1440 (Ultrawide)',
      '1440p-super-ultrawide': '5120 × 1440 (Super ultrawide)',
      '1600p-ultrawide': '3840 × 1600 (Ultrawide)',
      '2160p': '3840 × 2160 (4K)',
    }[resolutionApi.normalizeOutputResolution(key)] || 'Resolution profile';
  }

  function activeResolutionKey() {
    return resolutionApi.normalizeOutputResolution(settings?.overlay?.outputResolution);
  }

  function setCalibrationEmpty(title, detail) {
    const empty = $('calibration-empty');
    empty.querySelector('strong').textContent = title;
    empty.querySelector('span').textContent = detail;
  }

  function setSnapshotBusy(busy) {
    $('btn-snapshot').disabled = Boolean(busy);
    $('btn-calibrate-profile').disabled = Boolean(busy);
  }

  function setOpticalReaderPreview(preview) {
    const valid = Boolean(
      preview
      && preview.readRegion
      && preview.rois
      && typeof preview.rois === 'object',
    );
    opticalReaderPreview = valid ? structuredClone(preview) : null;
    const toggle = $('show-optical-reader-boxes');
    const status = $('optical-reader-box-status');
    toggle.disabled = !valid;
    if (!valid) {
      status.textContent = 'Automatic boxes: not detected in the latest reader frame.';
      return;
    }
    const resolved = Object.keys(opticalReaderPreview.rois).length;
    const total = ROI_DISPLAY.filter(([binding]) => binding !== 'away.record' && binding !== 'home.record').length;
    const state = opticalReaderPreview.locked ? 'full lock' : 'partial lock';
    status.textContent = `Automatic boxes: ${state}, ${resolved} of ${total} supported fields resolved.`;
  }

  function resetPresetUi(options = {}) {
    fixedReadRegionPlacer = null;
    factoryPreset = null;
    presetPlacementReady = false;
    readRegionGesture = false;
    snapshotImage = null;
    opticalReaderPreview = null;
    $('show-optical-reader-boxes').disabled = true;
    $('optical-reader-box-status').textContent = 'Automatic boxes: start the reader and refresh while the in-game scorebug is visible.';
    setCornerPlacement(null);
    setRoiEditMode(false);
    lockedRoiNames.clear();
    $('advanced-calibration').open = false;
    $('btn-use-reader-calibration').disabled = true;
    $('btn-save-export-reader-file').disabled = true;
    $('btn-reset-preset-box').disabled = true;
    $('btn-place-box-corners').disabled = true;
    $('btn-adjust-roi-boxes').disabled = true;
    $('preset-box-size').textContent = 'Live box is waiting for a game picture';
    $('preset-box-status').textContent = options.status
      || 'Start the reader with the scorebug visible, then refresh to inspect the detected box.';
    $('capture-dimensions-warning').hidden = true;
    $('capture-dimensions-warning').textContent = '';
    $('calibration-canvas').style.display = 'none';
    $('calibration-empty').style.display = '';
    updateCalibrationZoomControls();
    setCalibrationEmpty(
      options.title || 'No game picture yet',
      options.detail || 'Start CFB27 yourself, enter a game, then click Refresh game picture.',
    );
  }

  function invalidateCalibrationSnapshot(title, detail) {
    activeSnapshotRequest = ++snapshotRequestSerial;
    setSnapshotBusy(false);
    resetPresetUi({ title, detail });
  }

  function beginSnapshotRequest() {
    const requestToken = ++snapshotRequestSerial;
    activeSnapshotRequest = requestToken;
    resetPresetUi({
      title: 'Capturing game window...',
      detail: 'Keep the in-game scorebug visible while the picture is prepared.',
      status: 'Capturing a fresh game picture...',
    });
    $('preset-box-size').textContent = 'Preparing the premade reader box';
    setSnapshotBusy(true);
    return requestToken;
  }

  function updateCalibrationProfileSummary() {
    if (!settings) return;
    const key = resolutionApi.normalizeOutputResolution(settings.overlay?.outputResolution);
    $('calibration-profile-name').textContent = resolutionProfileLabel(key);
    const custom = settings.capture?.profileOrigin === 'custom';
    $('calibration-profile-status').textContent = custom ? 'Custom setup' : 'Recommended setup';
    $('calibration-profile-status').className = `badge ${custom ? '' : 'neutral'}`.trim();
  }

  async function runAction(action, successMessage) {
    try {
      const status = await api.action(action);
      if (status && typeof status === 'object') renderStatus(status);
      if (successMessage) toast(typeof successMessage === 'function' ? successMessage(status || {}) : successMessage);
      return status;
    } catch (error) {
      appendLog(`${action} failed: ${error.message}`);
      toast(`Could not ${String(action).replaceAll('-', ' ')} — see Diagnostics`);
      return null;
    }
  }

  function stateFromForm() {
    const possession = $('input-possession').value;
    return {
      away: {
        name: $('input-away-name').value.trim(), shortName: $('input-away-name').value.trim().toUpperCase(),
        score: numberValue('input-away-score'), rank: numberValue('input-away-rank'), record: $('input-away-record').value.trim(),
        timeouts: numberValue('input-away-timeouts', 3), possession: possession === 'away'
      },
      home: {
        name: $('input-home-name').value.trim(), shortName: $('input-home-name').value.trim().toUpperCase(),
        score: numberValue('input-home-score'), rank: numberValue('input-home-rank'), record: $('input-home-record').value.trim(),
        timeouts: numberValue('input-home-timeouts', 3), possession: possession === 'home'
      },
      game: {
        quarter: $('input-quarter').value.trim(), clock: $('input-clock').value.trim(),
        playClock: $('input-play-clock').value.trim(), downDistance: $('input-down-distance').value.trim()
      },
      meta: { source: 'manual', confidence: 100, visible: true, timestamp: Date.now() }
    };
  }

  function renderState(state) {
    if (!state) return;
    currentScoreboardState = state;
    if (String(state.meta?.source || '').toLowerCase() === 'local-ocr') {
      lastLiveScoreboardState = state;
      lastLiveScoreboardStateAt = Date.now();
    }
    $('away-name').textContent = state.away?.shortName || state.away?.name || 'AWAY';
    $('home-name').textContent = state.home?.shortName || state.home?.name || 'HOME';
    $('away-score').textContent = state.away?.score ?? 0;
    $('home-score').textContent = state.home?.score ?? 0;
    $('away-rank').textContent = state.away?.rank ? `#${state.away.rank}` : '—';
    $('home-rank').textContent = state.home?.rank ? `#${state.home.rank}` : '—';
    $('quarter').textContent = state.game?.quarter || '—';
    $('clock').textContent = state.game?.clock || '—';
    $('play-clock').textContent = `Play ${state.game?.playClock ?? '—'}`;
    $('down-distance').textContent = state.game?.downDistance || '—';
    $('state-matchup').textContent = `${state.away?.name || 'Away'} at ${state.home?.name || 'Home'}`;
    const conf = Number(state.meta?.confidence);
    const confidencePercent = Number.isFinite(conf) ? (conf <= 1 ? conf * 100 : conf) : null;
    $('state-confidence').textContent = confidencePercent !== null
      ? `${Math.round(confidencePercent)}% ${state.meta?.source || ''}`
      : 'No live read';
    updateSetupWizardFeedback();
  }

  const READER_STATUS_LABELS = {
    waiting: 'Waiting',
    initializing: 'Starting reader',
    'waiting-for-game': 'Waiting for game window',
    'ready-for-calibration': 'Ready to calibrate',
    'needs-calibration': 'Needs calibration',
    'finding-scoreboard': 'Searching for scorebug',
    reading: 'Reading',
    'waiting-for-frame': 'Waiting for video frame',
    'capture-reconnecting': 'Reconnecting capture',
    'capture-unavailable': 'Capture unavailable',
    'capture-slow': 'Capture delayed',
    'capture-error': 'Capture error',
    'capture-disabled': 'Capture disabled',
    error: 'Reader error',
    stopped: 'Stopped',
    manual: 'Manual mode',
  };

  const CAPTURE_UNAVAILABLE_LABELS = {
    'game-window-not-detected': 'Game window not detected',
    'game-window-minimized': 'Game window is minimized',
    'game-window-cloaked': 'Game window is hidden by Windows',
    'game-window-not-visible': 'Game window is not visible',
    'capture-disabled': 'Screen capture is disabled in settings',
  };

  // Cross-tick per-field evidence: each OCR tick reads only the fields whose
  // cadence is due, so the table remembers the latest read per field.
  const OCR_FIELD_ORDER = [
    'away.name', 'away.record', 'away.score',
    'home.name', 'home.record', 'home.score',
    'game.quarter', 'game.clock', 'game.playClock', 'game.downDistance',
  ];
  const fieldReadHistory = new Map();

  function renderFieldDiagnostics(support) {
    const table = $('field-diagnostics');
    const body = $('field-diagnostics-body');
    const summaryEl = $('field-diagnostics-summary');
    if (!table || !body || !summaryEl) return;
    const recognition = support?.latestRecognition;
    for (const [binding, field] of Object.entries(recognition?.fields || {})) {
      fieldReadHistory.set(binding, field);
    }
    if (!fieldReadHistory.size) {
      table.hidden = true;
      summaryEl.textContent = support?.lastReaderError
        ? `Reader error: ${support.lastReaderError.message}`
        : 'No local reader data yet. Start the reader with the game scorebug visible.';
      return;
    }
    const at = recognition?.capturedAt ? new Date(recognition.capturedAt).toLocaleTimeString() : '';
    const outcome = recognition?.result
      ? (recognition.result.visible ? 'scorebug recognized' : 'scorebug not yet recognized')
      : '';
    summaryEl.textContent = [
      at ? `Latest read at ${at}` : 'Latest reads',
      outcome,
      recognition?.visualError ? `visual analysis error: ${recognition.visualError}` : '',
    ].filter(Boolean).join(' — ');
    body.textContent = '';
    const bindings = [
      ...OCR_FIELD_ORDER.filter((binding) => fieldReadHistory.has(binding)),
      ...[...fieldReadHistory.keys()].filter((binding) => !OCR_FIELD_ORDER.includes(binding)).sort(),
    ];
    for (const binding of bindings) {
      const field = fieldReadHistory.get(binding) || {};
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = binding;
      const raw = document.createElement('td');
      raw.textContent = String(field.rawText || '').trim() || '—';
      const teamDiagnosis = document.createElement('td');
      const diagnosis = field.teamIdentityCandidates;
      const candidateNames = Array.isArray(diagnosis?.candidates)
        ? diagnosis.candidates.map((candidate) => candidate?.name).filter(Boolean)
        : [];
      if (field.teamIdentity?.name) {
        teamDiagnosis.textContent = `Resolved: ${field.teamIdentity.name}`;
        teamDiagnosis.className = 'field-ok field-team-diagnosis';
      } else if (Number(diagnosis?.candidateCount) > 1) {
        teamDiagnosis.textContent = `${diagnosis.candidateCount} possible: ${candidateNames.join(', ')}`;
        teamDiagnosis.className = 'field-team-diagnosis';
      } else if (Number(diagnosis?.candidateCount) === 1) {
        teamDiagnosis.textContent = diagnosis.ready
          ? `Resolved: ${candidateNames[0]}`
          : `Need more characters: ${candidateNames[0]}`;
        teamDiagnosis.className = 'field-team-diagnosis';
      } else if (diagnosis?.prefix) {
        teamDiagnosis.textContent = `No roster match for “${diagnosis.prefix}”`;
        teamDiagnosis.className = 'field-bad field-team-diagnosis';
      } else {
        teamDiagnosis.textContent = '—';
        teamDiagnosis.className = 'field-team-diagnosis';
      }
      const accepted = document.createElement('td');
      accepted.textContent = field.valid ? 'yes' : 'no';
      accepted.className = field.valid ? 'field-ok' : 'field-bad';
      const confidence = document.createElement('td');
      const percent = Number(field.confidence) || 0;
      confidence.textContent = `${Math.round((percent <= 1 ? percent * 100 : percent))}%`;
      row.append(name, raw, teamDiagnosis, accepted, confidence);
      body.appendChild(row);
    }
    table.hidden = false;
  }

  function readerDetailText(status, capture) {
    const readerStatus = String(status.reader?.status || '');
    const support = status.support || {};
    if (status.reader?.opticalReader?.locked) {
      return 'Automatic reader boxes locked - fixed fields are aligned automatically';
    }
    if (readerStatus === 'error' && support.lastReaderError?.message) {
      return `Reader error: ${support.lastReaderError.message}`;
    }
    if (support.calibrationRestore && support.calibrationRestore.valid === false) {
      return 'Saved reader calibration could not be applied — recalibrate';
    }
    const unavailable = CAPTURE_UNAVAILABLE_LABELS[String(status.capture?.unavailableReason || '')];
    if (!capture && unavailable) return unavailable;
    if (readerStatus === 'finding-scoreboard') {
      if (!readerFindingSince) readerFindingSince = Date.now();
      if (capture && Date.now() - readerFindingSince > 20000) {
        return 'Frames are arriving but no scorebug text is recognized — check the amber reader box and the selected game window';
      }
      return 'Looking for the native scorebug in the reader box';
    }
    readerFindingSince = null;
    return '';
  }

  function renderStatus(status = {}) {
    currentStatus = status;
    const game = Boolean(status.game?.detected || status.game?.running);
    const capture = Boolean(status.capture?.running);
    const captureState = String(status.capture?.streamStatus || 'idle');
    const captureError = status.capture?.error || null;
    const captureProfile = status.capture?.profileValidation || null;
    const captureWaiting = ['starting', 'retry-wait'].includes(captureState);
    const captureFailed = captureState === 'exhausted' || Boolean(captureError && !capture);
    const captureFallback = capture
      && status.capture?.capturePath === 'fresh-window-snapshot';
    const captureDegraded = capture
      && (captureFallback || ['slow', 'static'].includes(status.capture?.health));
    const readerOk = status.reader?.status === 'reading' || status.reader?.healthy;
    const overlay = Boolean(status.overlay?.visible);
    $('status-game').textContent = game ? (status.game?.title || 'Detected') : 'Not detected';
    $('status-capture').textContent = capture
      ? (captureError
        ? 'Recovering'
        : (captureFallback ? 'Fresh capture' : (captureDegraded ? 'Capture delayed' : 'Running')))
      : (captureState === 'starting'
        ? 'Starting'
        : (captureState === 'retry-wait' ? 'Retrying' : (captureFailed ? 'Unavailable' : 'Stopped')));
    $('status-capture-detail').textContent = captureError
      ? `[${captureError.code || 'capture-failed'}] ${captureError.message || 'Capture failed'}`
      : (captureFallback
        ? 'The video stream was stale; reading fresh game-window snapshots automatically'
        : (captureDegraded
          ? (status.capture?.healthReason || `Capture health: ${status.capture?.health}`)
          : (captureProfile?.status && captureProfile.status !== 'waiting-for-frame'
            ? (captureProfile.status === 'custom-aspect'
              ? `${status.capture?.sourceWidth || captureProfile.source?.width || '?'} x ${status.capture?.sourceHeight || captureProfile.source?.height || '?'} custom game shape (supported)`
              : `Profile ${captureProfile.profileKey || ''}: ${String(captureProfile.status).replaceAll('-', ' ')}`)
            : (status.capture?.sourceName || (captureWaiting ? 'Waiting for a game frame' : 'Waiting to start')))));
    const readerStatusToken = String(status.reader?.status || '');
    $('status-reader').textContent = readerOk
      ? 'Reading'
      : (READER_STATUS_LABELS[readerStatusToken] || readerStatusToken || 'Waiting');
    $('status-reader-detail').textContent = readerDetailText(status, capture);
    const visibilityMode = status.overlay?.visibilityMode
      || (overlay ? (status.automatic === false ? 'on-manual' : 'on-auto') : (status.started ? 'off' : 'stopped'));
    const visibilityLabels = {
      'on-auto': ['VISIBLE — AUTOMATIC', 'Automatic visibility is on'],
      'on-manual': ['VISIBLE — MANUAL', 'Automatic visibility is off'],
      'auto-waiting': ['HIDDEN — AUTOMATIC', 'Waiting for the game scoreboard'],
      off: ['OFF', status.started ? 'Overlay is hidden' : 'Reader is not running'],
      stopped: ['STOPPED', 'Reader is not running'],
    };
    const [visibilityLabel, visibilityDetail] = visibilityLabels[visibilityMode] || visibilityLabels.off;
    $('status-overlay').textContent = visibilityLabel;
    $('status-overlay-detail').textContent = visibilityDetail;
    $('overlay-status-item').dataset.state = visibilityMode;
    $('dot-game').className = `dot ${game ? 'ok' : ''}`;
    $('dot-capture').className = `dot ${captureError || captureFailed ? 'bad' : (captureDegraded || captureWaiting ? 'warn' : (capture ? 'ok' : ''))}`;
    $('dot-reader').className = `dot ${readerOk ? 'ok' : ['error', 'capture-unavailable'].includes(status.reader?.status) ? 'bad' : 'warn'}`;
    renderFieldDiagnostics(status.support);
    if ($('ram-reader-status')) {
      const ram = status.ramReader || {};
      const selectedMode = normalizeScoreboardDataSource(ram.mode || settings?.dataExtraction?.scoreboardSource);
      if (document.activeElement !== $('scoreboard-data-source')) renderScoreboardDataSource(selectedMode);
      $('ram-reader-status').textContent = selectedMode === 'screen'
        ? 'Screen reader selected. The hidden RAM reader is off.'
        : (ram.running
          ? (ram.gameProcessId
            ? `${scoreboardDataSourceLabel(selectedMode)} selected. Connected to College Football 27 (PID ${ram.gameProcessId}). ${ram.dataApplied ? `Using ${ram.appliedFields?.length || 0} RAM fields.` : 'Waiting for live RAM values.'}`
            : `${scoreboardDataSourceLabel(selectedMode)} selected. ${ram.message || 'Waiting for College Football 27.'}`)
          : `${scoreboardDataSourceLabel(selectedMode)} selected. ${ram.message || 'RAM reader is not running.'}`);
    }
    if (status.support?.calibrationRestore?.valid === false && !calibrationWarningShown) {
      calibrationWarningShown = true;
      toast('Saved reader calibration could not be applied — open Calibration and save a new reader box');
    }
    $('dot-overlay').className = `dot ${overlay ? 'ok' : visibilityMode === 'auto-waiting' ? 'warn' : visibilityMode === 'off' ? 'bad' : ''}`;
    $('btn-start').disabled = Boolean(status.started);
    $('btn-stop').disabled = !status.started;
    $('simple-runtime-status').textContent = status.started
      ? (captureFailed ? 'Capture needs attention' : 'Reader is running')
      : 'Reader is stopped';
    $('simple-visibility-state').textContent = overlay ? 'Overlay is visible' : (status.started ? 'Overlay is hidden' : 'Overlay is off');
    const automatic = status.automatic !== false;
    if (settings) {
      settings.overlay ||= {};
      settings.overlay.autoHide = automatic;
      if (document.activeElement !== $('auto-hide')) $('auto-hide').checked = automatic;
    }
    $('btn-auto').textContent = `Automatic visibility: ${automatic ? 'ON' : 'OFF'}`;
    $('btn-auto').setAttribute('aria-pressed', String(automatic));
    $('btn-auto').classList.toggle('state-on', automatic);
    $('btn-auto').classList.toggle('state-off', !automatic);
    $('simple-automatic-help').textContent = automatic
      ? (visibilityMode === 'auto-waiting' ? 'Automatic is ON and waiting for the in-game scoreboard.' : 'Automatic is ON. The app decides when to show the overlay.')
      : 'Automatic is OFF. The overlay stays under your manual control.';
    $('btn-toggle').textContent = overlay ? 'Hide overlay now' : 'Show overlay now';
    const placementMode = status.overlay?.placementMode || 'follow-game';
    const placementLabel = placementMode === 'move' ? 'Move mode' : (placementMode === 'locked' ? 'Locked' : 'Follow game');
    $('placement-mode').textContent = placementLabel;
    ['btn-edit', 'btn-edit-theme'].forEach((id) => { $(id).disabled = placementMode === 'move'; });
    ['btn-lock-position', 'btn-lock-theme'].forEach((id) => {
      $(id).disabled = placementMode === 'locked';
      $(id).textContent = placementMode === 'locked' ? 'Position saved' : 'Save current position';
    });
    ['btn-follow-game', 'btn-follow-theme'].forEach((id) => { $(id).disabled = placementMode === 'follow-game'; });
    $('simple-position-help').textContent = placementMode === 'move'
      ? 'Move mode is ON. Drag the green handles to resize, or choose Crop and drag the orange edges inward.'
      : (placementMode === 'locked'
        ? 'This exact position is saved. Choose Move overlay whenever you want to change it.'
        : 'The overlay follows the detected game window. Choose Move overlay to set a fixed spot.');
    if (settings && Number.isFinite(Number(status.overlay?.layout?.scale))) {
      settings.overlay ||= {};
      settings.overlay.scale = Number(status.overlay.layout.scale);
      if (Number.isFinite(Number(status.overlay.layout.scaleAt2160))) {
        settings.overlay.scaleAt2160 = Number(status.overlay.layout.scaleAt2160);
      }
      if (status.overlay.layout.outputResolution) {
        settings.overlay.outputResolution = resolutionApi.normalizeOutputResolution(
          status.overlay.layout.outputResolution,
        );
      }
      if (!scaleControlManuallyChanged && document.activeElement !== $('overlay-scale')) {
        setScaleControl(settings.overlay.scale);
      }
    }
    if (status.version) $('app-version').textContent = `v${status.version}`;
    updateSetupWizardFeedback();
  }

  function populateSettings(value) {
    if (!regionApi) throw new Error('Read-region calibration helper did not load.');
    if (!presetApi) throw new Error('Preset-box placement helper did not load.');
    if (!resolutionApi) throw new Error('Resolution-profile helper did not load.');
    if (!verificationApi) throw new Error('Wizard-verification helper did not load.');
    const previousPresetKey = factoryPreset?.key || '';
    settings = value || {};
    settings.theme ||= {};
    const chromaKey = chromaKeyApi.normalizeGreenScreen(settings.theme.chromaKey);
    settings.theme.chromaKey = { ...chromaKey };
    settings.overlay ||= {};
    Object.assign(settings.overlay, resolutionApi.resolveScaleSettings(settings.overlay, 0.72));
    settings.capture = regionApi.migrateCaptureSettings(settings.capture || {});
    settings.recognition ||= {};
    settings.recognition.readingProfile = normalizeReadingProfile(settings.recognition.readingProfile);
    settings.hotkeys ||= {};
    settings.onboarding ||= { version: 1, completed: false, skipped: false, step: 0 };
    settings.dataExtraction ||= {};
    settings.dataExtraction.scoreboardSource = normalizeScoreboardDataSource(settings.dataExtraction.scoreboardSource);
    if (previousPresetKey && previousPresetKey !== activeResolutionKey()) resetPresetUi();
    rois = structuredClone(settings.capture.rois);
    $('theme-path').value = settings.theme.path || '';
    $('theme-canvas-width').value = settings.theme.canvasWidth ?? 371;
    $('theme-canvas-height').value = settings.theme.canvasHeight ?? 433;
    $('green-screen-enabled').checked = chromaKey.enabled;
    $('green-screen-color').value = chromaKey.color;
    $('green-screen-tolerance').value = String(chromaKey.tolerance * 100);
    $('green-screen-tolerance-output').value = `${Math.round(chromaKey.tolerance * 100)}%`;
    $('green-screen-softness').value = String(chromaKey.softness * 100);
    $('green-screen-softness-output').value = `${Math.round(chromaKey.softness * 1000) / 10}%`;
    $('green-screen-fine-tune').open = chromaKey.enabled;
    $('output-resolution').value = settings.overlay.outputResolution;
    setScaleControl(settings.overlay.scale);
    scaleControlManuallyChanged = false;
    $('overlay-anchor').value = settings.overlay.anchor || 'bottom-center';
    $('margin-x').value = settings.overlay.marginX ?? 0;
    $('margin-y').value = settings.overlay.marginY ?? 32;
    $('reader-mode').value = settings.recognition.mode || 'local-ocr';
    $('donor-profile').value = settings.recognition.donorProfile || 'auto';
    renderScoreboardDataSource(settings.dataExtraction.scoreboardSource);
    $('minimum-confidence').value = settings.recognition.minimumConfidence ?? 20;
    $('confidence-output').value = `${$('minimum-confidence').value}%`;
    $('stable-frames').value = settings.recognition.stableFrames ?? 2;
    $('clock-offset-seconds').value = settings.recognition.clockOffsetSeconds ?? 0;
    renderReadingProfile();
    $('auto-hide').checked = settings.overlay.autoHide !== false;
    $('hide-unfocused').checked = settings.overlay.hideWhenGameUnfocused !== false;
    $('overlay-click-through').checked = settings.overlay.clickThrough !== false;
    $('overlay-always-on-top').checked = settings.overlay.alwaysOnTop !== false;
    Object.entries(APP_HOTKEY_FIELDS).forEach(([name, id]) => {
      $(id).value = settings.hotkeys[name] ?? DEFAULT_APP_HOTKEYS[name];
    });
    updateThemeSummary(settings.theme.path);
    updateCalibrationProfileSummary();
    syncReadRegionInputs();
    updateRoiCount();
  }

  async function saveSettings(message = 'Settings saved') {
    const saved = await api.saveSettings(settings);
    if (saved && typeof saved === 'object') settings = saved;
    toast(message);
  }

  async function activateSelectedResolution() {
    const key = resolutionApi.normalizeOutputResolution($('output-resolution').value);
    settings.overlay.outputResolution = key;
    const saved = await api.saveSettings(settings);
    if (saved && typeof saved === 'object') populateSettings(saved);
    await runAction('reposition');
    return key;
  }

  function recommendedResolutionForSource(widthValue, heightValue) {
    const width = Number(widthValue);
    const height = Number(heightValue);
    if (!Number.isFinite(height) || height <= 0) return activeResolutionKey();
    if (!Number.isFinite(width) || width <= 0) {
      if (height < 900) return '720p';
      if (height < 1260) return '1080p';
      if (height < 1800) return '1440p';
      return '2160p';
    }
    const candidates = {
      '720p': [1280, 720],
      '1080p': [1920, 1080],
      '1080p-ultrawide': [2560, 1080],
      '1440p': [2560, 1440],
      '1440p-ultrawide': [3440, 1440],
      '1440p-super-ultrawide': [5120, 1440],
      '1600p-ultrawide': [3840, 1600],
      '2160p': [3840, 2160],
    };
    const aspect = width / height;
    return Object.entries(candidates).reduce((best, [key, dimensions]) => {
      const score = (Math.abs(Math.log(height / dimensions[1])) * 2)
        + Math.abs(Math.log(aspect / (dimensions[0] / dimensions[1])));
      return score < best.score ? { key, score } : best;
    }, { key: activeResolutionKey(), score: Number.POSITIVE_INFINITY }).key;
  }

  function stageSelectedResolution(value) {
    if (!settings) return activeResolutionKey();
    const previous = resolutionApi.normalizeOutputResolution(settings.overlay.outputResolution);
    const next = resolutionApi.normalizeOutputResolution(value);
    const effective = numberValue('overlay-scale', 72) / 100;
    const baseline = scaleControlManuallyChanged
      ? resolutionApi.scaleAt2160FromEffective(effective, previous, 0.72)
      : (Number.isFinite(Number(settings.overlay.scaleAt2160))
        ? Number(settings.overlay.scaleAt2160)
        : resolutionApi.scaleAt2160FromEffective(effective, previous, 0.72));
    settings.overlay.outputResolution = next;
    settings.overlay.scaleAt2160 = baseline;
    settings.overlay.scale = resolutionApi.effectiveScale(baseline, next, 0.72);
    $('output-resolution').value = next;
    setScaleControl(settings.overlay.scale);
    scaleControlManuallyChanged = false;
    return next;
  }

  async function refreshSources() {
    if (sourceRefreshPromise) return sourceRefreshPromise;
    sourceRefreshPromise = (async () => {
      const select = $('capture-source');
      const previous = settings?.capture?.sourceId || select.value;
      const sources = await api.listCaptureSources();
      select.innerHTML = '<option value="">Auto-detect CFB27</option>';
      for (const source of sources || []) {
        const option = document.createElement('option');
        option.value = source.id;
        option.textContent = source.name;
        option.dataset.name = source.name;
        select.appendChild(option);
      }
      select.value = previous;
      appendLog(`Capture source scan returned ${(sources || []).length} windows.`);
      return sources || [];
    })();
    try {
      return await sourceRefreshPromise;
    } finally {
      sourceRefreshPromise = null;
    }
  }

  function reportSourceRefreshError(error) {
    appendLog(`Game-window refresh failed: ${error.message}`);
    toast('Could not refresh game windows - use Auto-detect or see Diagnostics');
  }

  function formatThemeDate(value) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : 'Saved theme';
  }

  function formatThemeBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function activatePanel(name) {
    qsa('.tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === name));
    qsa('.panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (name === 'calibration') refreshSources().then(undefined, reportSourceRefreshError);
    setRamDoctorPolling(name === 'diagnostics');
  }

  // The reader report re-reads the reader's files on every request, so poll it
  // only while the Diagnostics tab is actually open.
  let ramDoctorTimer = null;
  async function refreshRamDoctor() {
    if (!$('ram-doctor-headline')) return;
    let report = null;
    try { report = await api.ramReaderDoctor?.(); } catch { }
    if (!report) {
      $('ram-doctor-headline').textContent = 'The reader report is not available in this build.';
      return;
    }
    $('ram-doctor-headline').textContent = report.headline;
    $('ram-doctor-headline').dataset.state = report.level || 'info';
    const list = $('ram-doctor-lines');
    list.textContent = '';
    for (const item of report.lines || []) {
      const entry = document.createElement('li');
      entry.dataset.state = item.state || 'info';
      const label = document.createElement('strong');
      label.textContent = `${item.label}: `;
      entry.append(label, document.createTextNode(item.text));
      list.append(entry);
    }
  }
  function setRamDoctorPolling(active) {
    if (active && !ramDoctorTimer) {
      refreshRamDoctor();
      ramDoctorTimer = setInterval(refreshRamDoctor, 3000);
    } else if (!active && ramDoctorTimer) {
      clearInterval(ramDoctorTimer);
      ramDoctorTimer = null;
    }
  }

  function setupWizardRecognitionSummary() {
    // Judged against the last LIVE local-ocr state only; the startup
    // placeholder and manual test values can never count as verification,
    // and null scores are rejected instead of coercing to 0.
    return verificationApi.scoreboardVerificationSummary(lastLiveScoreboardState, {
      liveAt: lastLiveScoreboardStateAt,
    });
  }

  function setSetupWizardFeedback(status, detail, state = 'warn') {
    if (!$('setup-wizard-feedback')) return;
    $('setup-wizard-status').textContent = status;
    $('setup-wizard-detail').textContent = detail;
    const dot = $('setup-wizard-feedback').querySelector('.dot');
    if (dot) dot.className = `dot ${state}`.trim();
  }

  function updateSetupWizardFeedback() {
    if (!setupWizardActive || !$('setup-wizard')) return;
    const sourceWidth = Number(currentStatus.capture?.sourceWidth || currentStatus.game?.bounds?.width);
    const sourceHeight = Number(currentStatus.capture?.sourceHeight || currentStatus.game?.bounds?.height);
    if (setupWizardStep === 0) {
      const detected = Boolean(currentStatus.game?.detected || currentStatus.game?.running);
      setSetupWizardFeedback(
        detected ? 'Game window detected' : 'Waiting for the game window',
        detected
          ? (currentStatus.game?.title || 'The selected College Football 27 window is ready.')
          : 'Open the game yourself, enter a game, then use the Game window selector underneath this guide.',
        detected ? 'ok' : 'warn',
      );
      return;
    }
    if (setupWizardStep === 1) {
      if (sourceWidth > 0 && sourceHeight > 0) {
        if (!setupWizardAutoResolutionApplied) {
          stageSelectedResolution(recommendedResolutionForSource(sourceWidth, sourceHeight));
          setupWizardAutoResolutionApplied = true;
        }
        setSetupWizardFeedback(
          `Detected game shape: ${sourceWidth} x ${sourceHeight}`,
          `${resolutionProfileLabel(recommendedResolutionForSource(sourceWidth, sourceHeight))} was chosen from the game-window dimensions.`,
          'ok',
        );
      } else {
        setSetupWizardFeedback(
          'Waiting for a native game frame',
          'Keep the game visible. Next will capture a game picture without forcing it to 16:9.',
          'warn',
        );
      }
      return;
    }
    if (setupWizardStep === 2) {
      const region = fixedReadRegionPlacer?.getRegion();
      setSetupWizardFeedback(
        presetPlacementReady ? 'Live reader picture is ready' : 'Capture a game picture first',
        region
          ? `The detected box is ${(region.width * 100).toFixed(2)}% wide by ${(region.height * 100).toFixed(2)}% high. No manual placement or export is required; choose Next to verify live values.`
          : 'Go back once and capture the game picture with the complete native scorebug visible.',
        presetPlacementReady ? 'ok' : 'warn',
      );
      return;
    }
    if (setupWizardStep === 3) {
      const summary = setupWizardRecognitionSummary();
      setSetupWizardFeedback(
        summary.complete
          ? 'All required live fields are updating'
          : (summary.liveSource
            ? `${summary.ready} of ${summary.total} required live fields are present`
            : 'Waiting for live reader data'),
        summary.complete
          ? 'Both teams and scores, quarter, clock, and down-and-distance are coming from the local reader.'
          : (summary.liveSource
            ? `Still missing: ${summary.missing.join(', ') || 'a fresh visible read'}. You can go Back to adjust the box.`
            : 'Wait for local OCR data from a visible in-game scorebug; preview or manual values do not count as verification.'),
        summary.complete ? 'ok' : 'warn',
      );
      return;
    }
    const visible = Boolean(currentStatus.overlay?.visible);
    const placementMode = currentStatus.overlay?.placementMode || 'follow-game';
    setSetupWizardFeedback(
      visible ? 'Overlay is visible' : 'Show the overlay to place it',
      visible
        ? `Placement mode: ${String(placementMode).replaceAll('-', ' ')}. Use the Home controls underneath this guide, then Finish.`
        : 'Choose Show overlay now, move it if needed, and save its position before finishing.',
      visible ? 'ok' : 'warn',
    );
  }

  async function persistSetupWizardState(next = {}) {
    settings ||= {};
    const state = {
      version: 1,
      completed: next.completed === true,
      skipped: next.skipped === true,
      step: Math.max(0, Math.min(4, Number.isInteger(next.step) ? next.step : setupWizardStep)),
    };
    settings.onboarding = state;
    if (typeof api.saveOnboarding === 'function') await api.saveOnboarding(state);
    return state;
  }

  function renderSetupWizard({ focus = true } = {}) {
    if (!setupWizardActive || !$('setup-wizard')) return;
    const displayStep = setupWizardStep + 1;
    $('setup-wizard-progress').textContent = `Step ${displayStep} of 5`;
    for (let step = 1; step <= 5; step += 1) {
      const active = step === displayStep;
      const progress = $(`setup-wizard-progress-step-${step}`);
      const content = $(`setup-wizard-step-${step}`);
      content.hidden = !active;
      progress.classList.toggle('is-complete', step < displayStep);
      if (active) progress.setAttribute('aria-current', 'step');
      else progress.removeAttribute('aria-current');
    }
    $('btn-setup-wizard-back').disabled = setupWizardStep === 0;
    $('btn-setup-wizard-next').hidden = setupWizardStep === 4;
    $('btn-setup-wizard-finish').hidden = setupWizardStep !== 4;
    activatePanel(setupWizardStep <= 2 ? 'calibration' : 'dashboard');
    updateSetupWizardFeedback();
    if (focus) $('setup-wizard-dialog').focus({ preventScroll: true });
  }

  async function openSetupWizard({ restart = false } = {}) {
    if (!$('setup-wizard')) return;
    setupWizardStep = restart
      ? 0
      : Math.max(0, Math.min(4, Number(settings?.onboarding?.step) || 0));
    setupWizardAutoResolutionApplied = false;
    setupWizardActive = true;
    $('setup-wizard').hidden = false;
    $('setup-wizard').classList.add('is-guiding');
    $('setup-wizard').setAttribute('aria-modal', 'false');
    renderSetupWizard();
    if (restart) await persistSetupWizardState({ step: 0 });
  }

  function closeSetupWizard() {
    setupWizardActive = false;
    if (!$('setup-wizard')) return;
    $('setup-wizard').hidden = true;
    $('setup-wizard').classList.remove('is-guiding');
    $('setup-wizard').setAttribute('aria-modal', 'true');
  }

  async function advanceSetupWizard() {
    const nextButton = $('btn-setup-wizard-next');
    nextButton.disabled = true;
    try {
      if (setupWizardStep === 0) {
        if (!currentStatus.started) await runAction('start');
        try { await refreshSources(); } catch (error) { reportSourceRefreshError(error); }
      } else if (setupWizardStep === 1) {
        const sourceWidth = Number(currentStatus.capture?.sourceWidth || currentStatus.game?.bounds?.width);
        const sourceHeight = Number(currentStatus.capture?.sourceHeight || currentStatus.game?.bounds?.height);
        if (sourceHeight > 0) stageSelectedResolution(recommendedResolutionForSource(sourceWidth, sourceHeight));
        const key = await activateSelectedResolution();
        if (!await takeSnapshot(key)) {
          setSetupWizardFeedback('Game picture was not captured', 'Keep the game visible, choose its window underneath this guide, and try Next again.', 'bad');
          return;
        }
      } else if (setupWizardStep === 2) {
        if (!presetPlacementReady) {
          setSetupWizardFeedback(
            'Live reader picture is not ready',
            'Go Back and capture the game picture with the complete scorebug visible.',
            'bad',
          );
          return;
        }
      } else if (setupWizardStep === 3) {
        // Setup must never advance past live verification without a fresh,
        // visible local-ocr read proving both teams, both scores, quarter,
        // clock, and down-and-distance. Skip setup remains available for
        // testers who cannot verify right now.
        const summary = setupWizardRecognitionSummary();
        if (!summary.complete) {
          setSetupWizardFeedback(
            'Live verification has not passed',
            summary.liveSource
              ? `Still missing: ${summary.missing.join(', ') || 'a fresh visible read'}. Adjust the reader box or wait for the scorebug, then try Next again.`
              : 'No fresh local reader data yet. Keep the in-game scorebug visible with the reader running, or use Skip setup to finish later.',
            'bad',
          );
          return;
        }
      }
      setupWizardStep = Math.min(4, setupWizardStep + 1);
      await persistSetupWizardState({ step: setupWizardStep });
      renderSetupWizard();
    } finally {
      nextButton.disabled = false;
    }
  }

  async function finishSetupWizard() {
    // A resumed wizard can open directly at the final step, so Finish
    // re-checks the same live verification the step-3 gate enforces.
    const summary = setupWizardRecognitionSummary();
    if (!summary.complete) {
      setSetupWizardFeedback(
        'Live verification has not passed',
        'Setup can only complete after a fresh local reader read shows both teams, both scores, quarter, clock, and down-and-distance. Go Back to verify, or use Skip setup.',
        'bad',
      );
      return;
    }
    if (currentStatus.overlay?.placementMode === 'move') await runAction('lock-position');
    if (currentStatus.automatic === false) await runAction('automatic');
    await persistSetupWizardState({ completed: true, skipped: false, step: 4 });
    closeSetupWizard();
    activatePanel('dashboard');
    toast('Setup complete');
  }

  function fitThemePreview(shell, iframe, dimensions = {}) {
    const width = Math.max(160, Math.min(5000, Number(dimensions.width) || 1200));
    const height = Math.max(90, Math.min(3000, Number(dimensions.height) || 800));
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    const fit = () => {
      const shellWidth = shell.clientWidth;
      const shellHeight = shell.clientHeight;
      if (!shellWidth || !shellHeight) return;
      const scale = Math.min(shellWidth / width, shellHeight / height);
      iframe.style.left = `${Math.round((shellWidth - width * scale) / 2)}px`;
      iframe.style.top = `${Math.round((shellHeight - height * scale) / 2)}px`;
      iframe.style.transform = `scale(${scale})`;
    };
    fit();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(fit);
      observer.observe(shell);
      previewObservers.push(observer);
    }
    requestAnimationFrame(fit);
  }

  function renderThemeLibrary(themes = []) {
    const grid = $('theme-library-grid');
    previewObservers.forEach((observer) => observer.disconnect());
    previewObservers = [];
    $('theme-library-tab-count').textContent = String(themes.length);
    $('theme-library-heading-count').textContent = `${themes.length} saved`;
    const activeTheme = themes.find((theme) => theme.active);
    if (activeTheme) updateThemeSummary(activeTheme.path, activeTheme.name || activeTheme.fileName);
    grid.replaceChildren();
    if (!themes.length) {
      const empty = document.createElement('div');
      empty.className = 'theme-library-empty';
      empty.textContent = 'No imported HTML themes yet.';
      grid.appendChild(empty);
      return;
    }
    for (const theme of themes) {
      const compatibility = theme.compatibility || {};
      const card = document.createElement('article');
      card.className = `theme-library-item${theme.active ? ' is-active' : ''}${compatibility.canUse === false ? ' is-blocked' : ''}`;
      card.dataset.themeId = theme.id;

      const preview = document.createElement('div');
      preview.className = 'theme-preview-shell';
      const iframe = document.createElement('iframe');
      iframe.title = `Preview of ${theme.name || theme.fileName || 'imported theme'}`;
      iframe.loading = 'eager';
      iframe.referrerPolicy = 'no-referrer';
      iframe.setAttribute('sandbox', '');
      if (theme.previewHtml) iframe.srcdoc = theme.previewHtml;
      else iframe.src = theme.previewUrl;
      preview.appendChild(iframe);
      fitThemePreview(preview, iframe, compatibility.preview);

      const info = document.createElement('div');
      info.className = 'theme-library-info';
      const name = document.createElement('strong');
      name.textContent = theme.name || theme.fileName || 'Imported theme';
      name.title = name.textContent;
      const details = document.createElement('small');
      const canvasLabel = Number.isFinite(Number(theme.canvasWidth)) && Number.isFinite(Number(theme.canvasHeight))
        ? ` · ${Math.round(Number(theme.canvasWidth))} × ${Math.round(Number(theme.canvasHeight))}`
        : '';
      details.textContent = `${theme.fileName || 'HTML'}${canvasLabel} · ${formatThemeBytes(theme.bytes)} · ${formatThemeDate(theme.importedAt)}`;
      const compatibilityRow = document.createElement('div');
      compatibilityRow.className = 'theme-compatibility';
      const compatibilityBadge = document.createElement('span');
      const badgeLevel = compatibility.level === 'ready' ? 'ready' : (compatibility.level === 'blocked' ? 'blocked' : 'automatic');
      compatibilityBadge.className = `compatibility-badge ${badgeLevel}`;
      compatibilityBadge.textContent = compatibility.label || 'Automatic fields';
      const compatibilityDetail = document.createElement('span');
      compatibilityDetail.className = 'compatibility-detail';
      compatibilityDetail.textContent = compatibility.detail || 'The app will attempt automatic field matching.';
      compatibilityRow.append(compatibilityBadge, compatibilityDetail);
      const use = document.createElement('button');
      use.className = theme.active ? 'state-on' : 'primary';
      use.textContent = theme.active
        ? 'Currently in use'
        : (compatibility.canUse === false ? 'Needs Standalone HTML' : 'Use this theme');
      use.disabled = Boolean(theme.active || compatibility.canUse === false);
      use.addEventListener('click', async () => {
        try {
          const result = await api.useLibraryTheme(theme.id);
          if (result?.theme?.path) {
            settings ||= { theme: {} };
            settings.theme ||= {};
            settings.theme.path = result.theme.path;
            settings.theme.canvasWidth = result.theme.canvasWidth;
            settings.theme.canvasHeight = result.theme.canvasHeight;
            $('theme-path').value = result.theme.path;
            $('theme-canvas-width').value = result.theme.canvasWidth;
            $('theme-canvas-height').value = result.theme.canvasHeight;
            updateThemeSummary(result.theme.path, result.theme.name || theme.name || theme.fileName);
          }
          if (result?.status) renderStatus(result.status);
          renderThemeLibrary(result?.themes || await api.listThemeLibrary());
          toast(`Using ${theme.name || theme.fileName}`);
        } catch (error) {
          appendLog(`Theme selection failed: ${error.message}`);
          toast('Theme could not be selected — see Diagnostics');
        }
      });
      const remove = document.createElement('button');
      remove.className = 'danger theme-delete';
      remove.textContent = 'Delete';
      remove.title = `Delete ${theme.name || theme.fileName || 'this HTML theme'} from the library`;
      remove.addEventListener('click', async () => {
        const label = theme.name || theme.fileName || 'this HTML theme';
        if (!window.confirm(`Delete "${label}" from the HTML library? This removes the saved copy.`)) return;
        try {
          const result = await api.deleteLibraryTheme(theme.id);
          if (result?.status) renderStatus(result.status);
          renderThemeLibrary(result?.themes || await api.listThemeLibrary());
          toast(`${label} deleted`);
        } catch (error) {
          appendLog(`Theme deletion failed: ${error.message}`);
          toast(error.message || 'Theme could not be deleted');
        }
      });
      const actions = document.createElement('div');
      actions.className = 'theme-library-actions';
      actions.append(use, remove);
      info.append(name, details, compatibilityRow, actions);
      card.append(preview, info);
      grid.appendChild(card);
    }
  }

  async function refreshThemeLibrary() {
    renderThemeLibrary(await api.listThemeLibrary());
  }

  function updateRoiCount() {
    const count = Object.keys(rois).length;
    const lockedCount = [...lockedRoiNames].filter((name) => rois[name]).length;
    $('roi-count').textContent = `${count} reading area${count === 1 ? '' : 's'} · ${lockedCount} edit-locked`;
  }

  function activeCalibrationRegion() {
    return fixedReadRegionPlacer?.getRegion() || settings?.capture?.readRegion || regionApi.FULL_FRAME;
  }

  function applyActiveCalibrationRegion() {
    settings.capture ||= {};
    settings.capture.readRegion = activeCalibrationRegion();
    return settings.capture.readRegion;
  }

  function calibrationCapture() {
    return {
      ...(settings?.capture || {}),
      readRegion: activeCalibrationRegion(),
      roiSpace: 'read-region',
      rois
    };
  }

  function syncReadRegionInputs() {
    const region = activeCalibrationRegion();
    if (!region) return;
    const values = regionApi.regionToPercent(region);
    $('read-region-x').value = values.x;
    $('read-region-y').value = values.y;
    $('read-region-width').value = values.width;
    $('read-region-height').value = values.height;
    if (settings?.capture) settings.capture.readRegion = region;
  }

  function applyReadRegionInputs() {
    if (!fixedReadRegionPlacer) return;
    fixedReadRegionPlacer.adopt({
      x: numberValue('read-region-x') / 100,
      y: numberValue('read-region-y') / 100,
      width: numberValue('read-region-width') / 100,
      height: numberValue('read-region-height') / 100,
    });
    settings.capture.readRegion = fixedReadRegionPlacer.getRegion();
    syncReadRegionInputs();
    drawCalibration();
  }

  function normalizeCalibrationZoom(value) {
    const numeric = Number(value);
    const bounded = Math.max(
      CALIBRATION_ZOOM_MIN,
      Math.min(CALIBRATION_ZOOM_MAX, Number.isFinite(numeric) ? numeric : CALIBRATION_ZOOM_MIN),
    );
    const steps = Math.round((bounded - CALIBRATION_ZOOM_MIN) / CALIBRATION_ZOOM_STEP);
    return Number((CALIBRATION_ZOOM_MIN + (steps * CALIBRATION_ZOOM_STEP)).toFixed(2));
  }

  function updateCalibrationZoomControls() {
    const ready = Boolean(snapshotImage);
    const label = `${Math.round(calibrationZoom * 100)}%`;
    $('calibration-zoom-output').value = label;
    $('btn-calibration-zoom-out').disabled = !ready || calibrationZoom <= CALIBRATION_ZOOM_MIN;
    $('btn-calibration-zoom-in').disabled = !ready || calibrationZoom >= CALIBRATION_ZOOM_MAX;
    $('btn-calibration-zoom-reset').disabled = !ready || calibrationZoom === CALIBRATION_ZOOM_MIN;
  }

  function calibrationViewportAnchor() {
    const stage = $('calibration-stage');
    const canvas = $('calibration-canvas');
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    if (!snapshotImage || width <= 0 || height <= 0) return null;
    return {
      x: Math.max(0, Math.min(1, (stage.scrollLeft + (stage.clientWidth / 2)) / width)),
      y: Math.max(0, Math.min(1, (stage.scrollTop + (stage.clientHeight / 2)) / height)),
    };
  }

  function activeCalibrationAnchor() {
    const region = activeCalibrationRegion();
    if (!region) return { x: 0.5, y: 0.5 };
    return {
      x: region.x + (region.width / 2),
      y: region.y + (region.height / 2),
    };
  }

  function scrollCalibrationToAnchor(anchor) {
    if (!anchor || !snapshotImage) return;
    const stage = $('calibration-stage');
    const canvas = $('calibration-canvas');
    stage.scrollLeft = (anchor.x * canvas.offsetWidth) - (stage.clientWidth / 2);
    stage.scrollTop = (anchor.y * canvas.offsetHeight) - (stage.clientHeight / 2);
  }

  function setCalibrationZoom(value, options = {}) {
    const preserveCenter = options.preserveCenter !== false;
    const anchor = options.focusRegion
      ? activeCalibrationAnchor()
      : (preserveCenter ? calibrationViewportAnchor() : null);
    calibrationZoom = normalizeCalibrationZoom(value);
    $('calibration-canvas').style.width = `${Math.round(calibrationZoom * 100)}%`;
    updateCalibrationZoomControls();
    scrollCalibrationToAnchor(anchor);
    return calibrationZoom;
  }

  function canvasPoint(event) {
    const canvas = $('calibration-canvas');
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height))
    };
  }

  function setCornerPlacement(next) {
    cornerPlacement = next;
    if (next) setRoiEditMode(false);
    const button = $('btn-place-box-corners');
    if (button) button.classList.toggle('state-on', Boolean(next));
    const canvas = $('calibration-canvas');
    if (canvas) canvas.style.cursor = next ? 'crosshair' : 'default';
    if (next?.stage === 1) {
      $('preset-box-status').textContent = 'Click the TOP-LEFT corner of the native scorebug in the picture.';
    } else if (next?.stage === 2) {
      $('preset-box-status').textContent = 'Now click the BOTTOM-RIGHT corner of the native scorebug.';
    }
  }

  // Boxes are hand-adjustable anywhere inside the reader region; the only
  // floor is a size that still crops at least a few pixels. Save-time
  // validation independently rejects boxes too small to read at any profile.
  function clampTunedRoi(name, next) {
    const width = Math.max(0.004, Math.min(1, Number(next.width) || 0));
    const height = Math.max(0.004, Math.min(1, Number(next.height) || 0));
    return {
      x: Math.max(0, Math.min(1 - width, Number(next.x) || 0)),
      y: Math.max(0, Math.min(1 - height, Number(next.y) || 0)),
      width,
      height,
    };
  }

  function roiNamesInDisplayOrder() {
    const available = new Set(Object.keys(rois));
    const known = ROI_DISPLAY
      .map(([name]) => name)
      .filter((name) => available.delete(name));
    return [...known, ...[...available].sort()];
  }

  function isRoiLocked(name) {
    return Boolean(name && lockedRoiNames.has(name));
  }

  function renderRoiBoxList() {
    const list = $('roi-box-list-items');
    if (!list) return;
    list.textContent = '';
    const names = roiNamesInDisplayOrder();
    for (const lockedName of [...lockedRoiNames]) {
      if (!rois[lockedName]) lockedRoiNames.delete(lockedName);
    }
    for (const name of names) {
      const locked = isRoiLocked(name);
      const row = document.createElement('div');
      row.className = [
        'roi-box-item',
        name === selectedRoiName ? 'is-selected' : '',
        locked ? 'is-locked' : '',
      ].filter(Boolean).join(' ');
      row.setAttribute('role', 'listitem');

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'roi-box-select';
      select.dataset.roiSelect = name;
      select.setAttribute('aria-current', name === selectedRoiName ? 'true' : 'false');
      const label = document.createElement('strong');
      label.textContent = ROI_LABELS.get(name) || name;
      const binding = document.createElement('small');
      binding.textContent = `${name} · ${roiAutoFitApi?.isTextBinding(name) ? 'smart text seed' : 'fixed visual box'}`;
      select.append(label, binding);

      const state = document.createElement('span');
      state.className = `roi-box-state${locked ? ' is-locked' : ''}`;
      state.textContent = locked ? 'Locked' : 'Editable';

      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'roi-box-lock';
      lock.dataset.roiLock = name;
      lock.setAttribute('aria-pressed', String(locked));
      lock.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${ROI_LABELS.get(name) || name}`);
      lock.textContent = locked ? 'Unlock' : 'Lock';

      row.append(select, state, lock);
      list.appendChild(row);
    }
    const allLocked = names.length > 0 && names.every((name) => isRoiLocked(name));
    const lockAll = $('btn-toggle-all-roi-locks');
    if (lockAll) {
      lockAll.textContent = allLocked ? 'Unlock all' : 'Lock all';
      lockAll.setAttribute('aria-pressed', String(allLocked));
    }
  }

  function updateSelectedRoiStatus() {
    if (!roiEditMode) return;
    const picker = $('roi-picker');
    if (picker && picker.value !== (selectedRoiName || '')) picker.value = selectedRoiName || '';
    const selectedLocked = isRoiLocked(selectedRoiName);
    const resetButton = $('btn-reset-selected-roi');
    if (resetButton) resetButton.disabled = !selectedRoiName || selectedLocked;
    $('preset-box-status').textContent = selectedRoiName
      ? (selectedLocked
        ? `${selectedRoiName} is locked and cannot be moved, resized, redrawn, nudged, or reset. Use Unlock beside it to edit again.`
        : `Adjusting ${selectedRoiName}. Drag to move, drag an edge to resize, or drag on empty space to draw it fresh. Arrows = 1 px, Shift = 10, Ctrl+Arrows = resize.`)
      : 'Click a reading box, or choose one from the list, to adjust it by hand.';
  }

  function populateRoiPicker() {
    const picker = $('roi-picker');
    if (!picker) return;
    picker.innerHTML = '<option value="">Choose a box…</option>';
    for (const name of roiNamesInDisplayOrder()) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = `${isRoiLocked(name) ? '🔒 ' : ''}${ROI_LABELS.get(name) || name}`;
      picker.appendChild(option);
    }
    picker.value = selectedRoiName || '';
  }

  function refreshRoiEditorUi() {
    populateRoiPicker();
    renderRoiBoxList();
    updateSelectedRoiStatus();
    updateRoiCount();
  }

  function setRoiLocked(name, locked) {
    if (!name || !rois[name]) return false;
    if (locked) lockedRoiNames.add(name);
    else lockedRoiNames.delete(name);
    if (locked && roiGesture?.name === name) {
      rois[name] = { ...roiGesture.startRoi };
      roiGesture = null;
    }
    refreshRoiEditorUi();
    drawCalibration();
    return true;
  }

  function toggleAllRoiLocks() {
    const names = roiNamesInDisplayOrder();
    const lockAll = names.some((name) => !isRoiLocked(name));
    lockedRoiNames.clear();
    if (lockAll) {
      for (const name of names) lockedRoiNames.add(name);
      roiGesture = null;
    }
    refreshRoiEditorUi();
    drawCalibration();
    toast(lockAll ? 'All reading boxes locked' : 'All reading boxes unlocked');
  }

  function setRoiEditMode(next) {
    const enabled = Boolean(next);
    if (roiEditMode === enabled) return;
    roiEditMode = enabled;
    if (enabled && cornerPlacement) setCornerPlacement(null);
    if (!enabled) {
      selectedRoiName = null;
      roiGesture = null;
    }
    $('btn-adjust-roi-boxes')?.classList.toggle('state-on', enabled);
    const resetButton = $('btn-reset-selected-roi');
    if (resetButton) resetButton.hidden = !enabled;
    const picker = $('roi-picker');
    if (picker) picker.hidden = !enabled;
    const list = $('roi-box-list');
    if (list) list.hidden = !enabled;
    if (enabled) {
      refreshRoiEditorUi();
    }
    drawCalibration();
  }

  function roiHitAt(point) {
    const canvas = $('calibration-canvas');
    const capture = calibrationCapture();
    const tolerance = Math.max(6, canvas.width / 300);
    let best = null;
    for (const name of Object.keys(rois)) {
      const absolute = regionApi.resolveAbsoluteFieldRoi(capture, name);
      if (!absolute) continue;
      const rect = {
        x: absolute.x * canvas.width,
        y: absolute.y * canvas.height,
        width: absolute.width * canvas.width,
        height: absolute.height * canvas.height,
      };
      const inBandX = point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance;
      const inBandY = point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance;
      if (!inBandX || !inBandY) continue;
      const edges = {
        w: Math.abs(point.x - rect.x) <= tolerance,
        e: Math.abs(point.x - (rect.x + rect.width)) <= tolerance,
        n: Math.abs(point.y - rect.y) <= tolerance,
        s: Math.abs(point.y - (rect.y + rect.height)) <= tolerance,
      };
      const inside = point.x >= rect.x && point.x <= rect.x + rect.width
        && point.y >= rect.y && point.y <= rect.y + rect.height;
      const resize = edges.w || edges.e || edges.n || edges.s;
      if (!inside && !resize) continue;
      const candidate = {
        name,
        edges,
        action: resize ? 'resize' : 'move',
        locked: isRoiLocked(name),
        area: rect.width * rect.height,
      };
      // Boxes overlap in places; the smallest hit wins so tight fields stay
      // selectable inside larger neighbours.
      if (!best || candidate.area < best.area) best = candidate;
    }
    return best;
  }

  function applyRoiGesture(point) {
    if (!roiGesture) return;
    if (isRoiLocked(roiGesture.name)) {
      rois[roiGesture.name] = { ...roiGesture.startRoi };
      roiGesture = null;
      drawCalibration();
      return;
    }
    const canvas = $('calibration-canvas');
    const region = activeCalibrationRegion();
    const start = roiGesture.startRoi;
    const fx = (point.x - roiGesture.startPoint.x) / (canvas.width * region.width);
    const fy = (point.y - roiGesture.startPoint.y) / (canvas.height * region.height);
    let next;
    if (roiGesture.action === 'move') {
      next = { x: start.x + fx, y: start.y + fy, width: start.width, height: start.height };
    } else if (roiGesture.action === 'draw') {
      // A bare click (no meaningful drag) must not collapse the box.
      if (Math.abs(point.x - roiGesture.startPoint.x) < 3
        && Math.abs(point.y - roiGesture.startPoint.y) < 3) {
        rois[roiGesture.name] = { ...roiGesture.startRoi };
        drawCalibration();
        return;
      }
      const startX = (roiGesture.startPoint.x / canvas.width - region.x) / region.width;
      const startY = (roiGesture.startPoint.y / canvas.height - region.y) / region.height;
      const currentX = (point.x / canvas.width - region.x) / region.width;
      const currentY = (point.y / canvas.height - region.y) / region.height;
      next = {
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      };
    } else {
      next = { ...start };
      if (roiGesture.edges.e) next.width = start.width + fx;
      if (roiGesture.edges.w) { next.x = start.x + fx; next.width = start.width - fx; }
      if (roiGesture.edges.s) next.height = start.height + fy;
      if (roiGesture.edges.n) { next.y = start.y + fy; next.height = start.height - fy; }
    }
    rois[roiGesture.name] = clampTunedRoi(roiGesture.name, next);
    drawCalibration();
  }

  function nudgeSelectedRoi(stepX, stepY, resize) {
    if (!roiEditMode || !selectedRoiName || !rois[selectedRoiName] || !snapshotImage) return false;
    if (isRoiLocked(selectedRoiName)) return false;
    const canvas = $('calibration-canvas');
    const region = activeCalibrationRegion();
    const fx = stepX / (canvas.width * region.width);
    const fy = stepY / (canvas.height * region.height);
    const current = rois[selectedRoiName];
    const next = resize
      ? { ...current, width: current.width + fx, height: current.height + fy }
      : { ...current, x: current.x + fx, y: current.y + fy };
    rois[selectedRoiName] = clampTunedRoi(selectedRoiName, next);
    drawCalibration();
    return true;
  }

  function applyCornerClick(point) {
    const canvas = $('calibration-canvas');
    const normalized = { x: point.x / canvas.width, y: point.y / canvas.height };
    if (cornerPlacement.stage === 1) {
      setCornerPlacement({ stage: 2, first: normalized });
      return;
    }
    const first = cornerPlacement.first;
    const spanWidth = Math.abs(normalized.x - first.x);
    const spanHeight = Math.abs(normalized.y - first.y);
    if (spanWidth < 0.01 || spanHeight < 0.005) {
      toast('Those clicks were too close together — click the two opposite corners of the scorebug');
      setCornerPlacement({ stage: 1 });
      return;
    }
    // Use the two clicked corners exactly. The live scorebug can vary slightly
    // in shape between layouts, so forcing the bundled aspect adds pixels the
    // user did not select and shifts every relative inner box.
    fixedReadRegionPlacer.adopt({
      x: Math.min(first.x, normalized.x),
      y: Math.min(first.y, normalized.y),
      width: spanWidth,
      height: spanHeight,
    });
    setCornerPlacement(null);
    applyActiveCalibrationRegion();
    syncReadRegionInputs();
    drawCalibration();
    $('preset-box-status').textContent = 'Box placed from your two clicks. Nudge with the arrow keys (Shift = 10 px), then save.';
    toast('Reader box placed from your two clicks');
  }

  function nudgeReadRegion(stepX, stepY) {
    if (!fixedReadRegionPlacer || !snapshotImage) return false;
    const sourceWidth = Number(factoryPreset?.sourceWidth) || $('calibration-canvas').width || 1;
    const sourceHeight = Number(factoryPreset?.sourceHeight) || $('calibration-canvas').height || 1;
    fixedReadRegionPlacer.moveBy({ x: stepX / sourceWidth, y: stepY / sourceHeight });
    applyActiveCalibrationRegion();
    syncReadRegionInputs();
    drawCalibration();
    return true;
  }

  function pointInsidePreset(point, viewport) {
    if (!fixedReadRegionPlacer) return false;
    const rect = regionApi.regionToPixels(
      fixedReadRegionPlacer.getRegion(),
      viewport.width,
      viewport.height,
    );
    return point.x >= rect.x
      && point.x <= rect.x + rect.width
      && point.y >= rect.y
      && point.y <= rect.y + rect.height;
  }

  function setFineTuneEnabled() {
    applyActiveCalibrationRegion();
    syncReadRegionInputs();
    updateRoiCount();
    drawCalibration();
  }

  function initializePresetPlacement(result) {
    const key = resolutionApi.normalizeOutputResolution(result.profileKey);
    if (key !== activeResolutionKey()) {
      appendLog(`Ignored ${key} calibration picture because ${activeResolutionKey()} is active.`);
      return {
        ok: false,
        code: 'profile-mismatch',
        error: 'The resolution changed before the game picture finished. Capture it again.',
      };
    }
    if (!result.presetReadRegion || !result.presetRois) {
      appendLog('Calibration picture did not include protected preset geometry.');
      return {
        ok: false,
        code: 'preset-unavailable',
        error: 'The premade reader box is unavailable in this build.',
      };
    }
    factoryPreset = {
      key,
      readRegion: structuredClone(result.presetReadRegion),
      rois: structuredClone(result.presetRois),
      pixelSize: structuredClone(result.presetPixelSize || {}),
      sourceWidth: Number(result.sourceWidth) || Number(result.width) || 0,
      sourceHeight: Number(result.sourceHeight) || Number(result.height) || 0,
    };
    const minimumWidth = Math.max(
      0.01,
      96 / factoryPreset.sourceWidth,
      ...Object.values(factoryPreset.rois).flatMap((roi) => [
        ROI_MINIMUM_SOURCE_WIDTH_PIXELS / (factoryPreset.sourceWidth * roi.width),
      ]),
    );
    const minimumHeight = Math.max(
      0.01,
      40 / factoryPreset.sourceHeight,
      ...Object.values(factoryPreset.rois).flatMap((roi) => [
        ROI_MINIMUM_SOURCE_HEIGHT_PIXELS / (factoryPreset.sourceHeight * roi.height),
      ]),
    );
    fixedReadRegionPlacer = new presetApi.ResizableReadRegionPlacer(
      factoryPreset.readRegion,
      result.currentReadRegion || factoryPreset.readRegion,
      {
        minimumWidth,
        minimumHeight,
        minimumWidthPixels: 96,
        minimumHeightPixels: 40,
        handleTolerance: 18,
      },
    );
    rois = structuredClone(result.currentRois || factoryPreset.rois);
    lockedRoiNames.clear();
    presetPlacementReady = true;
    setRoiEditMode(false);
    $('advanced-calibration').open = false;
    applyActiveCalibrationRegion();
    syncReadRegionInputs();
    updateRoiCount();
    $('btn-use-reader-calibration').disabled = false;
    $('btn-save-export-reader-file').disabled = false;
    $('btn-reset-preset-box').disabled = false;
    $('btn-place-box-corners').disabled = false;
    $('btn-adjust-roi-boxes').disabled = false;
    const startingRegion = fixedReadRegionPlacer.getRegion();
    const width = Math.round(startingRegion.width * factoryPreset.sourceWidth);
    const height = Math.round(startingRegion.height * factoryPreset.sourceHeight);
    $('preset-box-size').textContent = `${factoryPreset.sourceWidth} x ${factoryPreset.sourceHeight} game shape; starting box ${width} x ${height} px`;
    $('preset-box-status').textContent = result.currentReadRegionOrigin ? [
      'measured',
      'measured-rejected-saved-calibration',
      'verified-saved-calibration',
    ].includes(result.currentReadRegionOrigin)
      ? (result.currentReadRegionOrigin === 'verified-saved-calibration'
        ? 'Your saved outer box was verified against the current live scorebug. The reader is using this exact box.'
        : 'Box fitted from the current live scorebug. A stale saved outer box cannot override it.')
      : 'Live detection has not produced a box yet. Keep the complete scorebug visible and refresh.'
      : 'Fit the amber outer box around the complete scorebug, adjust any individual green boxes that need it, then click Use.';
    const aspectRatioMismatch = captureAspectRatioMismatch(result);
    $('capture-dimensions-warning').hidden = !aspectRatioMismatch;
    $('capture-dimensions-warning').textContent = aspectRatioMismatch
      ? `Custom game-window shape detected (${factoryPreset.sourceWidth} x ${factoryPreset.sourceHeight}). Fit each amber edge tightly around the visible scorebug.`
      : '';
    return { ok: true };
  }

  function captureAspectRatioMismatch(result, tolerance = 0.015) {
    const width = Number(result?.sourceWidth || result?.width);
    const height = Number(result?.sourceHeight || result?.height);
    const expectedWidth = Number(result?.expectedWidth);
    const expectedHeight = Number(result?.expectedHeight);
    if (![width, height, expectedWidth, expectedHeight].every((value) => Number.isFinite(value) && value > 0)) {
      return true;
    }
    return Math.abs((width / height) - (expectedWidth / expectedHeight)) > tolerance;
  }

  function finitePreviewRegion(region) {
    const values = [region?.x, region?.y, region?.width, region?.height].map(Number);
    return values.every(Number.isFinite)
      && values[0] >= 0
      && values[1] >= 0
      && values[2] > 0
      && values[3] > 0
      && values[0] + values[2] <= 1.001
      && values[1] + values[3] <= 1.001;
  }

  function drawOpticalReaderPreview(ctx, canvas) {
    if (
      !opticalReaderPreview
      || !$('show-optical-reader-boxes').checked
      || !finitePreviewRegion(opticalReaderPreview.readRegion)
    ) {
      return;
    }
    const readRegion = opticalReaderPreview.readRegion;
    const colors = {
      away: '#58a6ff',
      center: '#ffffff',
      home: '#f8c35c',
    };
    ctx.save();
    ctx.lineWidth = Math.max(2, canvas.width / 1000);
    ctx.setLineDash([10, 6]);
    for (const segment of ['away', 'center', 'home']) {
      const bounds = opticalReaderPreview.segments?.[segment]?.bounds;
      if (!finitePreviewRegion(bounds)) continue;
      const absolute = {
        x: readRegion.x + (bounds.x * readRegion.width),
        y: readRegion.y + (bounds.y * readRegion.height),
        width: bounds.width * readRegion.width,
        height: bounds.height * readRegion.height,
      };
      if (!finitePreviewRegion(absolute)) continue;
      ctx.strokeStyle = colors[segment];
      ctx.strokeRect(
        absolute.x * canvas.width,
        absolute.y * canvas.height,
        absolute.width * canvas.width,
        absolute.height * canvas.height,
      );
    }
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(1, canvas.width / 1500);
    const previewCapture = {
      readRegion,
      roiSpace: 'read-region',
      rois: opticalReaderPreview.rois,
    };
    for (const binding of Object.keys(opticalReaderPreview.rois)) {
      const absolute = regionApi.resolveAbsoluteFieldRoi(previewCapture, binding);
      if (!finitePreviewRegion(absolute)) continue;
      ctx.strokeStyle = colors[
        binding.startsWith('away.')
          ? 'away'
          : (binding.startsWith('home.') ? 'home' : 'center')
      ];
      ctx.strokeRect(
        absolute.x * canvas.width,
        absolute.y * canvas.height,
        absolute.width * canvas.width,
        absolute.height * canvas.height,
      );
    }
    ctx.restore();
  }

  function drawCalibration() {
    const canvas = $('calibration-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (snapshotImage) ctx.drawImage(snapshotImage, 0, 0, canvas.width, canvas.height);
    const currentRegion = activeCalibrationRegion();
    if (currentRegion) {
      regionApi.drawReadRegion(
        ctx,
        currentRegion,
        { width: canvas.width, height: canvas.height },
        {
          editor: null,
          selected: true,
          handleSize: Math.max(12, canvas.width / 150),
          lineWidth: Math.max(3, canvas.width / 700),
          font: `600 ${Math.max(14, canvas.width / 95)}px Segoe UI`,
          showLabel: false,
          label: 'MOVE + UNIFORM SCALE OVER COMPLETE SCOREBUG',
        }
      );
    }
    drawOpticalReaderPreview(ctx, canvas);
    ctx.lineWidth = Math.max(2, canvas.width / 900);
    const capture = calibrationCapture();
    for (const name of Object.keys(rois)) {
      if (name === selectedRoiName) continue;
      const roi = regionApi.resolveAbsoluteFieldRoi(capture, name);
      if (!roi) continue;
      const x = roi.x * canvas.width, y = roi.y * canvas.height;
      const w = roi.width * canvas.width, h = roi.height * canvas.height;
      const locked = isRoiLocked(name);
      ctx.strokeStyle = locked ? '#f8c35c' : '#42e19c';
      ctx.setLineDash(locked ? [8, 5] : []);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.setLineDash([]);
    if (selectedRoiName) {
      const roi = regionApi.resolveAbsoluteFieldRoi(capture, selectedRoiName);
      if (roi) {
        ctx.lineWidth = Math.max(3, canvas.width / 600);
        ctx.strokeStyle = isRoiLocked(selectedRoiName) ? '#f8c35c' : '#ffffff';
        ctx.setLineDash(isRoiLocked(selectedRoiName) ? [10, 6] : []);
        ctx.strokeRect(
          roi.x * canvas.width,
          roi.y * canvas.height,
          roi.width * canvas.width,
          roi.height * canvas.height,
        );
        ctx.setLineDash([]);
      }
    }
  }

  function calibrationFailureCopy(result = {}) {
    const code = String(result?.code || 'source-not-found');
    const copies = {
      'capture-disabled': {
        title: 'Automatic reader is off',
        detail: 'Choose Automatic local reader, then refresh the game picture.',
      },
      'source-not-found': {
        title: 'Game window not found',
        detail: 'Open CFB27, refresh the window list, and select the game window.',
      },
      'source-not-capturable': {
        title: 'Game window cannot be captured',
        detail: 'Use Borderless mode and run CFB27 and this app at the same administrator level.',
      },
      'source-scan-failed': {
        title: 'Game-window list failed',
        detail: 'Refresh the window list. If it fails again, copy Diagnostics and restart this app.',
      },
      'profile-mismatch': {
        title: 'Resolution changed',
        detail: 'The resolution changed before capture finished. Refresh the game picture again.',
      },
      'preset-unavailable': {
        title: 'Premade box unavailable',
        detail: 'This build is missing its protected reader preset. Re-extract the complete tester folder.',
      },
      'source-changed': {
        title: 'Game window changed',
        detail: 'The selected window changed during capture. Refresh the game picture again.',
      },
      'image-decode-failed': {
        title: 'Game picture could not open',
        detail: 'Refresh the game picture. If it happens again, reselect the CFB27 window.',
      },
    };
    const copy = copies[code] || {
      title: 'Game picture failed',
      detail: 'Refresh the game-window list, select CFB27, and try again.',
    };
    return {
      code,
      title: copy.title,
      detail: String(copies[code] ? copy.detail : (result?.error || copy.detail)),
    };
  }

  function renderCalibrationFailure(result, requestToken) {
    if (requestToken !== activeSnapshotRequest) return false;
    const failure = calibrationFailureCopy(result);
    setSnapshotBusy(false);
    resetPresetUi({
      title: failure.title,
      detail: failure.detail,
      status: 'No new game picture is ready to save.',
    });
    appendLog(`Calibration picture failed (${failure.code}): ${failure.detail}`);
    toast(failure.title);
    return false;
  }

  function displayCalibrationSnapshot(result, context = {}) {
    const requestToken = Number.isInteger(context.requestToken)
      ? context.requestToken
      : beginSnapshotRequest();
    if (requestToken !== activeSnapshotRequest) return false;
    if (result?.ok === false || !result?.dataUrl) {
      return renderCalibrationFailure(result || {
        code: 'source-not-found',
        error: 'No selected or detected CFB27 window is available.',
      }, requestToken);
    }
    if (context.sourceId && result.id && context.sourceId !== result.id) {
      return renderCalibrationFailure({ code: 'source-changed' }, requestToken);
    }
    const image = new Image();
    return new Promise((resolve) => {
      image.onload = () => {
        if (requestToken !== activeSnapshotRequest) {
          resolve(false);
          return;
        }
        const initialized = initializePresetPlacement(result);
        if (!initialized.ok) {
          renderCalibrationFailure(initialized, requestToken);
          resolve(false);
          return;
        }
        setOpticalReaderPreview(result.opticalReaderGeometry);
        snapshotImage = image;
        const canvas = $('calibration-canvas');
        canvas.width = result.width || image.naturalWidth;
        canvas.height = result.height || image.naturalHeight;
        canvas.style.display = 'block';
        $('calibration-empty').style.display = 'none';
        setSnapshotBusy(false);
        setCalibrationZoom(calibrationZoom, { preserveCenter: false, focusRegion: true });
        drawCalibration();
        appendLog(`Captured ${result.profileKey} placement frame ${canvas.width}x${canvas.height}.`);
        updateSetupWizardFeedback();
        resolve(true);
      };
      image.onerror = () => {
        renderCalibrationFailure({ code: 'image-decode-failed' }, requestToken);
        resolve(false);
      };
      image.src = result.dataUrl;
    });
  }

  async function takeSnapshot(profileKey = activeResolutionKey()) {
    const select = $('capture-source');
    const sourceId = select.value || '';
    const sourceName = sourceId ? (select.selectedOptions[0]?.dataset.name || '') : '';
    const requestToken = beginSnapshotRequest();
    try {
      const result = await api.captureSnapshot({
        sourceId: sourceId || undefined,
        sourceName: sourceName || undefined,
        profileKey,
        presetPlacement: true,
      });
      return displayCalibrationSnapshot(result, { requestToken, sourceId, sourceName });
    } catch (error) {
      return renderCalibrationFailure({ code: 'capture-failed', error: error.message }, requestToken);
    }
  }

  async function saveAndExportReaderCalibration() {
    if (!presetPlacementReady || !fixedReadRegionPlacer) {
      throw new Error('Capture the game picture before saving the reader box.');
    }
    const key = activeResolutionKey();
    const region = activeCalibrationRegion();
    const result = await api.saveAndExportReaderCalibration({
      key,
      readRegion: region,
      roiSpace: 'read-region',
      rois: structuredClone(rois),
      sourceWidth: Number(factoryPreset?.sourceWidth) || undefined,
      sourceHeight: Number(factoryPreset?.sourceHeight) || undefined,
    });
    if (result?.settings) populateSettings(result.settings);
    const savedRegion = result?.currentReadRegion
      || result?.settings?.capture?.readRegion
      || region;
    rois = structuredClone(result?.currentRois || factoryPreset?.rois || rois);
    fixedReadRegionPlacer.adopt(savedRegion);
    applyActiveCalibrationRegion();
    syncReadRegionInputs();
    drawCalibration();
    const exported = result?.exported !== false && result?.canceled !== true;
    $('preset-box-status').textContent = exported
      ? 'Saved on this PC and exported as one portable reader file.'
      : 'Saved on this PC. Reader-file export was canceled.';
    updateSetupWizardFeedback();
    return { key, result };
  }

  async function useReaderCalibration() {
    if (!presetPlacementReady || !fixedReadRegionPlacer) {
      throw new Error('Capture the game picture before using the reader box.');
    }
    const key = activeResolutionKey();
    const region = activeCalibrationRegion();
    const result = await api.useReaderCalibration({
      key,
      readRegion: region,
      roiSpace: 'read-region',
      rois: structuredClone(rois),
      sourceWidth: Number(factoryPreset?.sourceWidth) || undefined,
      sourceHeight: Number(factoryPreset?.sourceHeight) || undefined,
    });
    if (result?.settings) populateSettings(result.settings);
    const usedRegion = result?.currentReadRegion
      || result?.settings?.capture?.readRegion
      || region;
    rois = structuredClone(result?.currentRois || factoryPreset?.rois || rois);
    fixedReadRegionPlacer.adopt(usedRegion);
    applyActiveCalibrationRegion();
    syncReadRegionInputs();
    drawCalibration();
    $('preset-box-status').textContent = `Reader is in use on this PC for ${resolutionProfileLabel(key)} only.`;
    updateSetupWizardFeedback();
    return { key, result };
  }

  async function importReaderCalibrationFile() {
    const key = await activateSelectedResolution();
    const result = await api.importReaderCalibration(key);
    if (result?.canceled) return result;
    if (result?.settings) populateSettings(result.settings);
    const importedRegion = result?.currentReadRegion
      || result?.settings?.capture?.readRegion;
    rois = structuredClone(result?.currentRois || factoryPreset?.rois || rois);
    if (fixedReadRegionPlacer && importedRegion) fixedReadRegionPlacer.adopt(importedRegion);
    applyActiveCalibrationRegion();
    syncReadRegionInputs();
    drawCalibration();
    $('preset-box-status').textContent = `Imported reader file applied to ${resolutionProfileLabel(key)} only.`;
    updateSetupWizardFeedback();
    return result;
  }

  function bindEvents() {
    qsa('button[data-tab]').forEach((tab) => tab.addEventListener('click', () => activatePanel(tab.dataset.tab)));
    qsa('[data-reading-profile]').forEach((button) => button.addEventListener('click', async () => {
      const key = normalizeReadingProfile(button.dataset.readingProfile);
      if (normalizeReadingProfile(settings?.recognition?.readingProfile) === key) {
        toast(`${key === 'aggressive' ? 'Aggressive' : 'Safe'} is already active`);
        return;
      }
      qsa('[data-reading-profile]').forEach((item) => { item.disabled = true; });
      try {
        settings.recognition ||= {};
        settings.recognition.readingProfile = key;
        const saved = await api.saveSettings(settings);
        if (saved && typeof saved === 'object') populateSettings(saved);
        toast(`${key === 'aggressive' ? 'Aggressive' : 'Safe'} reading profile is now active`);
      } catch (error) {
        appendLog(`Reading-profile change failed: ${error.message}`);
        toast('Could not change the reading profile - see Diagnostics');
      } finally {
        qsa('[data-reading-profile]').forEach((item) => { item.disabled = false; });
      }
    }));
    $('btn-open-advanced').addEventListener('click', () => activatePanel('data'));
    $('btn-run-setup-wizard').addEventListener('click', () => openSetupWizard({ restart: true }));
    $('btn-setup-wizard-next').addEventListener('click', advanceSetupWizard);
    $('btn-setup-wizard-back').addEventListener('click', async () => {
      setupWizardStep = Math.max(0, setupWizardStep - 1);
      await persistSetupWizardState({ step: setupWizardStep });
      renderSetupWizard();
    });
    $('btn-setup-wizard-skip').addEventListener('click', async () => {
      await persistSetupWizardState({ completed: false, skipped: true, step: setupWizardStep });
      closeSetupWizard();
      activatePanel('dashboard');
      toast('Setup skipped - you can run it anytime from Home');
    });
    $('btn-setup-wizard-finish').addEventListener('click', finishSetupWizard);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && setupWizardActive) closeSetupWizard();
    });

    $('btn-start').addEventListener('click', () => runAction('start', 'Reader started'));
    $('btn-fresh-read').addEventListener('click', () => runAction('fresh-read', 'Fresh read started'));
    $('btn-stop').addEventListener('click', () => runAction('stop', 'Reader and overlay stopped'));
    $('btn-toggle').addEventListener('click', async () => {
      const action = currentStatus.overlay?.visible ? 'toggle' : 'force-show';
      await runAction(action, action === 'force-show'
        ? 'Overlay shown — automatic visibility is OFF'
        : 'Overlay hidden');
    });
    $('btn-edit').addEventListener('click', () => runAction('edit', 'Move mode is ON — drag the green overlay handle'));
    $('btn-lock-position').addEventListener('click', () => runAction('lock-position', 'Current overlay position saved'));
    $('btn-follow-game').addEventListener('click', () => runAction('follow-game', 'Overlay reset to follow the game window'));
    $('btn-edit-theme').addEventListener('click', () => runAction('edit', 'Move mode is ON — drag the green overlay handle'));
    $('btn-lock-theme').addEventListener('click', () => runAction('lock-position', 'Current overlay position saved'));
    $('btn-follow-theme').addEventListener('click', () => runAction('follow-game', 'Overlay reset to follow the game window'));
    $('btn-reload').addEventListener('click', () => runAction('reload', 'Current HTML reloaded'));
    $('btn-auto').addEventListener('click', async () => {
      await runAction('automatic', (status) => status.automatic
        ? 'Automatic visibility is ON'
        : 'Automatic visibility is OFF');
    });
    $('btn-apply-state').addEventListener('click', async () => { const state = stateFromForm(); await api.setState(state); renderState(state); toast('Manual state sent'); });
    $('btn-refresh-sources').addEventListener('click', async () => {
      try {
        await refreshSources();
        toast('Game-window list refreshed');
      } catch (error) {
        reportSourceRefreshError(error);
      }
    });
    $('capture-source').addEventListener('change', async (event) => {
      const previous = {
        sourceId: settings.capture.sourceId || '',
        sourceName: settings.capture.sourceName || '',
      };
      invalidateCalibrationSnapshot(
        'Game window changed',
        'Refresh the game picture to place the premade box on this window.',
      );
      settings.capture.sourceId = event.target.value;
      settings.capture.sourceName = event.target.selectedOptions[0]?.dataset.name || '';
      try {
        await saveSettings('Game window saved');
      } catch (error) {
        settings.capture.sourceId = previous.sourceId;
        settings.capture.sourceName = previous.sourceName;
        event.target.value = previous.sourceId;
        appendLog(`Game-window selection failed: ${error.message}`);
        toast('Could not save the game window - see Diagnostics');
      }
    });
    $('reader-mode').addEventListener('change', async (event) => {
      settings.recognition.mode = event.target.value;
      settings.capture.enabled = event.target.value === 'local-ocr';
      await saveSettings(event.target.value === 'local-ocr' ? 'Automatic reader enabled' : 'Screen capture disabled');
    });
    $('scoreboard-data-source').addEventListener('change', async (event) => {
      const previous = normalizeScoreboardDataSource(settings.dataExtraction?.scoreboardSource);
      const next = normalizeScoreboardDataSource(event.target.value);
      settings.dataExtraction ||= {};
      settings.dataExtraction.scoreboardSource = next;
      renderScoreboardDataSource(next);
      try {
        await saveSettings(`${scoreboardDataSourceLabel(next)} selected`);
      } catch (error) {
        settings.dataExtraction.scoreboardSource = previous;
        renderScoreboardDataSource(previous);
        appendLog(`Data-source change failed: ${error.message}`);
        toast('Could not change the data source - see Diagnostics');
      }
    });
    $('minimum-confidence').addEventListener('input', () => $('confidence-output').value = `${$('minimum-confidence').value}%`);
    $('output-resolution').addEventListener('change', (event) => {
      invalidateCalibrationSnapshot(
        'Resolution changed',
        'Use this profile, then capture a fresh game picture.',
      );
      stageSelectedResolution(event.target.value);
    });
    $('overlay-scale').addEventListener('input', () => {
      $('scale-output').value = `${Math.round(numberValue('overlay-scale', 72))}%`;
      scaleControlManuallyChanged = true;
    });
    $('btn-save-resolution').addEventListener('click', async () => {
      const key = await activateSelectedResolution();
      toast(`${resolutionProfileLabel(key)} profile loaded`);
    });
    $('btn-save-reader').addEventListener('click', async () => {
      settings.recognition.donorProfile = $('donor-profile').value || 'auto';
      settings.recognition.minimumConfidence = numberValue('minimum-confidence', 20);
      settings.recognition.stableFrames = numberValue('stable-frames', 2);
      settings.recognition.clockOffsetSeconds = Math.max(-5, Math.min(5, numberValue('clock-offset-seconds', 0)));
      await saveSettings('Reader settings saved');
    });
    $('btn-save-placement').addEventListener('click', async () => {
      const outputResolution = resolutionApi.normalizeOutputResolution($('output-resolution').value);
      if (scaleControlManuallyChanged) {
        settings.overlay.scale = numberValue('overlay-scale', 72) / 100;
        settings.overlay.scaleAt2160 = resolutionApi.scaleAt2160FromEffective(
          settings.overlay.scale,
          outputResolution,
          0.72,
        );
      } else {
        settings.overlay.scaleAt2160 = Number(settings.overlay.scaleAt2160) || 0.72;
        settings.overlay.scale = resolutionApi.effectiveScale(
          settings.overlay.scaleAt2160,
          outputResolution,
          0.72,
        );
      }
      settings.overlay.outputResolution = outputResolution;
      setScaleControl(settings.overlay.scale);
      scaleControlManuallyChanged = false;
      settings.overlay.anchor = $('overlay-anchor').value;
      settings.overlay.marginX = numberValue('margin-x', 0);
      settings.overlay.marginY = numberValue('margin-y', 32);
      await saveSettings('Placement applied');
      await api.action('reposition');
    });
    $('btn-browse-theme').addEventListener('click', async () => { const path = await api.chooseTheme(); if (path) $('theme-path').value = path; });
    $('btn-load-theme').addEventListener('click', async () => {
      settings.theme.path = $('theme-path').value.trim();
      settings.theme.canvasWidth = Math.max(160, Math.min(5000, Math.round(numberValue('theme-canvas-width', 371))));
      settings.theme.canvasHeight = Math.max(32, Math.min(3000, Math.round(numberValue('theme-canvas-height', 433))));
      updateThemeSummary(settings.theme.path);
      await saveSettings('Theme and authored size selected');
      await runAction('reload');
      await refreshThemeLibrary();
    });
    $('btn-fallback-theme').addEventListener('click', async () => {
      settings.theme.path = '';
      settings.theme.canvasWidth = 371;
      settings.theme.canvasHeight = 433;
      $('theme-path').value = '';
      $('theme-canvas-width').value = '371';
      $('theme-canvas-height').value = '433';
      updateThemeSummary('');
      await saveSettings('ESPN 2013 theme selected');
      await runAction('reload');
      await refreshThemeLibrary();
    });
    $('green-screen-tolerance').addEventListener('input', () => {
      $('green-screen-tolerance-output').value = `${Math.round(numberValue('green-screen-tolerance', 6))}%`;
    });
    $('green-screen-softness').addEventListener('input', () => {
      $('green-screen-softness-output').value = `${Math.round(numberValue('green-screen-softness', 4) * 10) / 10}%`;
    });
    $('btn-save-green-screen').addEventListener('click', async () => {
      settings.theme.chromaKey = {
        enabled: $('green-screen-enabled').checked,
        color: $('green-screen-color').value,
        tolerance: numberValue('green-screen-tolerance', 6) / 100,
        softness: numberValue('green-screen-softness', 4) / 100,
      };
      await saveSettings(settings.theme.chromaKey.enabled
        ? 'Green-screen filter applied'
        : 'Green-screen filter turned off');
      toast(settings.theme.chromaKey.enabled
        ? 'Green canvas is now transparent'
        : 'Green-screen filter is off');
    });
    $('btn-save-app-settings').addEventListener('click', async () => {
      settings.hotkeys ||= {};
      const nextHotkeys = Object.fromEntries(
        Object.entries(APP_HOTKEY_FIELDS).map(([name, id]) => [name, $(id).value.trim()]),
      );
      const usedAccelerators = new Map();
      for (const [name, accelerator] of Object.entries(nextHotkeys)) {
        if (!accelerator) continue;
        const normalized = accelerator.toLowerCase().replace(/\s+/g, '');
        if (usedAccelerators.has(normalized)) {
          toast(`Shortcut conflict: ${name} and ${usedAccelerators.get(normalized)} use the same keys`);
          return;
        }
        usedAccelerators.set(normalized, name);
      }
      Object.assign(settings.hotkeys, nextHotkeys);
      settings.overlay ||= {};
      settings.overlay.autoHide = $('auto-hide').checked;
      settings.overlay.hideWhenGameUnfocused = $('hide-unfocused').checked;
      settings.overlay.clickThrough = $('overlay-click-through').checked;
      settings.overlay.alwaysOnTop = $('overlay-always-on-top').checked;
      await saveSettings('App settings saved');
    });
    $('btn-reset-app-shortcuts').addEventListener('click', () => {
      Object.entries(APP_HOTKEY_FIELDS).forEach(([name, id]) => {
        $(id).value = DEFAULT_APP_HOTKEYS[name];
      });
      toast('Default shortcuts restored in the fields — save to apply them');
    });
    $('btn-open-library').addEventListener('click', () => activatePanel('library'));
    $('btn-import-theme-library').addEventListener('click', async () => {
      try {
        const result = await api.importThemeToLibrary();
        renderThemeLibrary(result?.themes || []);
        if (!result?.canceled) toast(`${result.theme?.name || 'HTML theme'} saved to library`);
      } catch (error) {
        appendLog(`Theme import failed: ${error.message}`);
        toast(error.message || 'Theme import failed — see Diagnostics');
      }
    });
    $('btn-snapshot').addEventListener('click', async () => {
      try {
        try {
          await refreshSources();
        } catch (error) {
          reportSourceRefreshError(error);
        }
        const key = await activateSelectedResolution();
        await takeSnapshot(key);
      } catch (error) {
        appendLog(`Game picture refresh failed: ${error.message}`);
        const requestToken = beginSnapshotRequest();
        renderCalibrationFailure({ code: 'capture-failed', error: error.message }, requestToken);
      }
    });
    $('btn-calibrate-profile').addEventListener('click', async () => {
      try {
        try {
          await refreshSources();
        } catch (error) {
          reportSourceRefreshError(error);
        }
        const key = await activateSelectedResolution();
        await takeSnapshot(key);
      } catch (error) {
        appendLog(`Preset-box setup failed: ${error.message}`);
        const requestToken = beginSnapshotRequest();
        renderCalibrationFailure({ code: 'capture-failed', error: error.message }, requestToken);
      }
    });
    $('btn-calibration-zoom-out').addEventListener('click', () => {
      setCalibrationZoom(calibrationZoom - CALIBRATION_ZOOM_STEP);
    });
    $('btn-calibration-zoom-in').addEventListener('click', () => {
      setCalibrationZoom(calibrationZoom + CALIBRATION_ZOOM_STEP);
    });
    $('btn-calibration-zoom-reset').addEventListener('click', () => {
      setCalibrationZoom(CALIBRATION_ZOOM_MIN, { preserveCenter: false, focusRegion: true });
    });
    $('show-optical-reader-boxes').addEventListener('change', drawCalibration);
    $('btn-reset-preset-box').addEventListener('click', () => {
      if (!fixedReadRegionPlacer) {
        toast('Capture the game picture first');
        return;
      }
      fixedReadRegionPlacer.reset();
      applyActiveCalibrationRegion();
      syncReadRegionInputs();
      drawCalibration();
      toast('Premade box returned to its recommended starting position');
    });
    $('btn-use-reader-calibration').addEventListener('click', async () => {
      try {
        await useReaderCalibration();
        toast(`Reader is now in use for ${resolutionProfileLabel(activeResolutionKey())}`);
      } catch (error) {
        appendLog(`Reader use failed: ${error.message}`);
        toast(error.message || 'Reader calibration could not be used');
      }
    });
    $('btn-save-export-reader-file').addEventListener('click', async () => {
      try {
        const { result } = await saveAndExportReaderCalibration();
        toast(result?.canceled
          ? 'Reader saved locally; export canceled'
          : `Reader saved and exported for ${resolutionProfileLabel(activeResolutionKey())}`);
      } catch (error) {
        appendLog(`Reader save and export failed: ${error.message}`);
        toast(error.message || 'Reader file could not be saved and exported');
      }
    });
    $('btn-import-reader-file').addEventListener('click', async () => {
      try {
        const result = await importReaderCalibrationFile();
        if (!result?.canceled) toast(`Reader file imported for ${resolutionProfileLabel(activeResolutionKey())}`);
      } catch (error) {
        appendLog(`Reader-file import failed: ${error.message}`);
        toast(error.message || 'Reader file could not be imported');
      }
    });
    $('btn-reset-resolution').addEventListener('click', async () => {
      try {
        const key = resolutionApi.normalizeOutputResolution(settings.overlay.outputResolution);
        const result = await api.resetReaderProfile(key);
        if (result?.settings) populateSettings(result.settings);
        if (fixedReadRegionPlacer) {
          fixedReadRegionPlacer.reset();
          rois = structuredClone(factoryPreset?.rois || result?.settings?.capture?.rois || {});
          lockedRoiNames.clear();
          applyActiveCalibrationRegion();
          syncReadRegionInputs();
          if (roiEditMode) refreshRoiEditorUi();
          else updateRoiCount();
          drawCalibration();
        }
        toast('Reader setup reset to the recommended boxes');
      } catch (error) {
        appendLog(`Profile reset failed: ${error.message}`);
        toast('Could not reset this resolution — see Diagnostics');
      }
    });
    $('advanced-calibration').addEventListener('toggle', (event) => {
      setFineTuneEnabled(event.currentTarget.open);
    });
    $('btn-apply-read-region').addEventListener('click', () => {
      applyReadRegionInputs();
      toast('Read area updated — save calibration to keep it');
    });
    for (const id of ['read-region-x', 'read-region-y', 'read-region-width', 'read-region-height']) {
      $(id).addEventListener('keydown', (event) => {
        if (event.key === 'Enter') $('btn-apply-read-region').click();
      });
    }
    $('btn-open-logs').addEventListener('click', () => api.openLogs());
    $('btn-open-data-export').addEventListener('click', () => api.openDataExport());
    $('btn-copy-diagnostics').addEventListener('click', async () => { await api.copyDiagnostics(); toast('Diagnostic report copied'); });
    $('btn-copy-ram-report')?.addEventListener('click', async () => {
      await api.copyRamReaderDoctor?.();
      toast('Reader report copied — paste it anywhere');
    });
    $('btn-clear-log').addEventListener('click', () => { logLines.length = 0; $('log-output').textContent = ''; });
    $('btn-save-debug-crops')?.addEventListener('click', async () => {
      await api.saveReaderDebugImages?.();
      toast('Debug images save from the next captured frame');
    });
    $('btn-place-box-corners')?.addEventListener('click', () => {
      if (!snapshotImage || !fixedReadRegionPlacer) {
        toast('Capture the game picture first');
        return;
      }
      if (cornerPlacement) {
        setCornerPlacement(null);
        $('preset-box-status').textContent = 'Two-click placement canceled.';
        return;
      }
      setCornerPlacement({ stage: 1 });
      $('calibration-stage')?.focus?.({ preventScroll: true });
    });
    $('calibration-stage')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && cornerPlacement) {
        event.preventDefault();
        setCornerPlacement(null);
        $('preset-box-status').textContent = 'Two-click placement canceled.';
        return;
      }
      if (event.key === 'Escape' && roiEditMode) {
        event.preventDefault();
        if (selectedRoiName) {
          selectedRoiName = null;
          refreshRoiEditorUi();
          drawCalibration();
        } else {
          setRoiEditMode(false);
          $('preset-box-status').textContent = 'Individual box adjustment closed.';
        }
        return;
      }
      const steps = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const step = steps[event.key];
      if (!step) return;
      // Arrow keys move by exactly one SOURCE pixel (ten with Shift)
      // regardless of zoom, instead of scrolling the stage. In individual-box
      // mode they act on the selected green box, and Ctrl resizes it.
      const multiplier = event.shiftKey ? 10 : 1;
      if (roiEditMode) {
        if (selectedRoiName && isRoiLocked(selectedRoiName)) {
          event.preventDefault();
          updateSelectedRoiStatus();
          return;
        }
        if (nudgeSelectedRoi(step[0] * multiplier, step[1] * multiplier, event.ctrlKey)) {
          event.preventDefault();
        }
        return;
      }
      if (nudgeReadRegion(step[0] * multiplier, step[1] * multiplier)) event.preventDefault();
    });
    $('btn-adjust-roi-boxes')?.addEventListener('click', () => {
      if (!snapshotImage || !fixedReadRegionPlacer) {
        toast('Capture the game picture first');
        return;
      }
      setRoiEditMode(!roiEditMode);
      if (roiEditMode) updateSelectedRoiStatus();
      else $('preset-box-status').textContent = 'Individual box adjustment closed.';
      $('calibration-stage')?.focus?.({ preventScroll: true });
    });
    $('btn-reset-selected-roi')?.addEventListener('click', () => {
      if (!selectedRoiName || !factoryPreset?.rois?.[selectedRoiName]) {
        toast('Select a green box first');
        return;
      }
      if (isRoiLocked(selectedRoiName)) {
        toast(`${selectedRoiName} is locked — unlock it before resetting`);
        updateSelectedRoiStatus();
        return;
      }
      rois[selectedRoiName] = structuredClone(factoryPreset.rois[selectedRoiName]);
      drawCalibration();
      toast(`${selectedRoiName} reset to the bundled layout`);
    });
    $('roi-picker')?.addEventListener('change', () => {
      selectedRoiName = $('roi-picker').value || null;
      refreshRoiEditorUi();
      drawCalibration();
      $('calibration-stage')?.focus?.({ preventScroll: true });
    });
    $('roi-box-list-items')?.addEventListener('click', (event) => {
      const lockButton = event.target.closest('[data-roi-lock]');
      if (lockButton) {
        const name = lockButton.dataset.roiLock;
        const locked = !isRoiLocked(name);
        selectedRoiName = name;
        if (setRoiLocked(name, locked)) {
          toast(`${ROI_LABELS.get(name) || name} ${locked ? 'locked' : 'unlocked'}`);
        }
        return;
      }
      const selectButton = event.target.closest('[data-roi-select]');
      if (!selectButton) return;
      selectedRoiName = selectButton.dataset.roiSelect || null;
      refreshRoiEditorUi();
      drawCalibration();
      $('calibration-stage')?.focus?.({ preventScroll: true });
    });
    $('btn-toggle-all-roi-locks')?.addEventListener('click', toggleAllRoiLocks);

    const canvas = $('calibration-canvas');
    canvas.addEventListener('pointerdown', (event) => {
      if (!snapshotImage) return;
      $('calibration-stage')?.focus?.({ preventScroll: true });
      const point = canvasPoint(event);
      const viewport = { width: canvas.width, height: canvas.height };
      if (cornerPlacement && fixedReadRegionPlacer) {
        applyCornerClick(point);
        return;
      }
      if (roiEditMode && fixedReadRegionPlacer) {
        const roiHit = roiHitAt(point);
        if (roiHit) {
          selectedRoiName = roiHit.name;
          roiGesture = roiHit.locked
            ? null
            : {
              name: roiHit.name,
              action: roiHit.action,
              edges: roiHit.edges,
              startPoint: point,
              startRoi: { ...rois[roiHit.name] },
            };
        } else if (selectedRoiName) {
          // Dragging on empty space draws the selected box fresh at the
          // dragged rectangle — the hand-drawn placement path.
          roiGesture = isRoiLocked(selectedRoiName)
            ? null
            : {
              name: selectedRoiName,
              action: 'draw',
              edges: {},
              startPoint: point,
              startRoi: { ...rois[selectedRoiName] },
            };
        } else {
          roiGesture = null;
        }
        if (roiGesture) canvas.setPointerCapture(event.pointerId);
        refreshRoiEditorUi();
        drawCalibration();
        return;
      }
      const hit = fixedReadRegionPlacer?.hitTest(point, viewport);
      if (!fixedReadRegionPlacer || !hit || hit.action === 'none') {
        toast('Grab inside the amber box to move it, or drag a white handle to scale it');
        return;
      }
      readRegionGesture = true;
      fixedReadRegionPlacer.begin(point, viewport, hit);
      applyActiveCalibrationRegion();
      syncReadRegionInputs();
      canvas.style.cursor = 'grabbing';
      canvas.setPointerCapture(event.pointerId);
      drawCalibration();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (cornerPlacement) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (roiEditMode) {
        const point = canvasPoint(event);
        if (roiGesture) {
          applyRoiGesture(point);
          return;
        }
        const hover = roiHitAt(point);
        canvas.style.cursor = hover
          ? (hover.locked ? 'not-allowed' : (hover.action === 'move' ? 'grab' : 'crosshair'))
          : (selectedRoiName
            ? (isRoiLocked(selectedRoiName) ? 'not-allowed' : 'crosshair')
            : 'default');
        return;
      }
      const point = canvasPoint(event);
      const viewport = { width: canvas.width, height: canvas.height };
      if (readRegionGesture) {
        fixedReadRegionPlacer.update(point, viewport);
        applyActiveCalibrationRegion();
        syncReadRegionInputs();
        drawCalibration();
        return;
      }
      const hit = fixedReadRegionPlacer?.hitTest(point, viewport) || { action: 'none' };
      const cursors = {
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
        nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize'
      };
      canvas.style.cursor = hit.action === 'move'
        ? 'grab'
        : (hit.action === 'resize' ? (cursors[hit.handle] || 'crosshair') : 'default');
    });
    canvas.addEventListener('pointerup', (event) => {
      const point = canvasPoint(event);
      const viewport = { width: canvas.width, height: canvas.height };
      if (roiGesture) {
        applyRoiGesture(point);
        roiGesture = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }
      if (!readRegionGesture) return;
      fixedReadRegionPlacer.end(point, viewport);
      readRegionGesture = false;
      applyActiveCalibrationRegion();
      syncReadRegionInputs();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = 'default';
      drawCalibration();
    });
    canvas.addEventListener('pointercancel', (event) => {
      if (roiGesture) {
        rois[roiGesture.name] = roiGesture.startRoi;
        roiGesture = null;
      }
      if (readRegionGesture) fixedReadRegionPlacer?.cancel();
      readRegionGesture = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      applyActiveCalibrationRegion();
      syncReadRegionInputs();
      drawCalibration();
    });
    updateCalibrationZoomControls();
  }

  async function init() {
    bindEvents();
    const requestedPanel = new URLSearchParams(window.location.search).get('panel');
    if (requestedPanel && qsa('.panel').some((panel) => panel.dataset.panel === requestedPanel)) {
      activatePanel(requestedPanel);
    }
    renderState(defaultState);
    try {
      populateSettings(await api.getSettings());
    } catch (error) {
      appendLog(`Settings initialization error: ${error.message}`);
    }
    try {
      await refreshThemeLibrary();
    } catch (error) {
      appendLog(`Theme library initialization error: ${error.message}`);
      toast('Saved HTML library could not load — see Diagnostics');
    }
    try {
      renderStatus(await api.getStatus());
    } catch (error) {
      appendLog(`Status initialization error: ${error.message}`);
    }
    if (settings?.onboarding?.completed !== true && settings?.onboarding?.skipped !== true) {
      await openSetupWizard();
    }
    api.onStatus?.(renderStatus);
    api.onState?.(renderState);
    api.onLog?.(appendLog);
    api.onPanel?.(activatePanel);
    api.onCalibrationSnapshot?.(displayCalibrationSnapshot);
    refreshSources().catch((error) => appendLog(`Capture source scan failed: ${error.message}`));
    appendLog('Control center initialized. Saved HTML is independent of game capture. No game was launched.');
  }

  init();
})();
