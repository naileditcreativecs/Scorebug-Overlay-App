'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function command(name, payload) {
  return ipcRenderer.invoke('overlay:command', name, payload);
}

function subscribe(channel, listener) {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

function scoreboardMethod(name, payload) {
  return ipcRenderer.invoke('scoreboard:method', name, payload);
}

const overlayControl = Object.freeze({
  show: () => command('show'),
  hide: () => command('hide'),
  toggle: () => command('toggle'),
  setEditMode: (enabled) => command('set-edit-mode', Boolean(enabled)),
  toggleEditMode: () => command('toggle-edit-mode'),
  lockPosition: () => command('lock-position'),
  followGame: () => command('follow-game'),
  toggleQuickSettings: () => command('toggle-quick-settings'),
  closeQuickSettings: () => command('close-quick-settings'),
  getInGameEditorState: () => command('get-in-game-editor-state'),
  inGameEditorReady: () => command('in-game-editor-ready'),
  moveOverlay: (payload) => command('move-overlay', payload),
  resizeOverlay: (payload) => command('resize-overlay', payload),
  setCropMode: (enabled) => command('set-crop-mode', Boolean(enabled)),
  resetThemeCrop: () => command('reset-theme-crop'),
  setManualTeamOverride: (override) => command('set-manual-team-override', override),
  clearManualTeamOverrides: () => command('clear-manual-team-overrides'),
  setTeamLogoPreference: (preference) => command('set-team-logo-preference', preference),
  importTeamLogo: (request) => command('import-team-logo', request),
  deleteImportedTeamLogo: (request) => command('delete-imported-team-logo', request),
  previewTeamLogoTransform: (request) => command('preview-team-logo-transform', request),
  saveTeamLogoTransform: (request) => command('save-team-logo-transform', request),
  captureTeamLogoPlacement: (request) => command('capture-team-logo-placement', request),
  reportTeamLogoGeometry: (geometry) => command('report-team-logo-geometry', geometry),
  setGreenScreenEnabled: (enabled) => command('set-green-screen-enabled', Boolean(enabled)),
  setScorebugColor: (payload) => command('set-scorebug-color', payload),
  saveScorebugColorPreset: (payload) => command('save-scorebug-color-preset', payload),
  applyScorebugColorPreset: (payload) => command('apply-scorebug-color-preset', payload),
  deleteScorebugColorPreset: (payload) => command('delete-scorebug-color-preset', payload),
  centerOverlay: (payload) => command('center-overlay', payload),
  freshRead: () => command('fresh-read'),
  reload: () => command('reload'),
  chooseTheme: () => command('choose-theme'),
  setTheme: (filePath) => command('set-theme', filePath),
  useMock: () => command('use-mock'),
  setState: (state) => command('set-state', state),
  getState: () => command('get-state'),
  setGameBounds: (bounds) => command('set-game-bounds', bounds),
  clearGameBounds: () => command('clear-game-bounds'),
  setLayout: (layout) => command('set-layout', layout),
  setAutoVisible: (visible) => command('set-auto-visible', Boolean(visible)),
  getStatus: () => command('get-status'),
  ready: () => command('renderer-ready'),
  onStatus: (listener) => subscribe('overlay:status', listener),
  onTheme: (listener) => subscribe('overlay:theme', listener),
  onReloadTheme: (listener) => subscribe('overlay:reload-theme', listener),
  onState: (listener) => subscribe('overlay:scoreboard-state', listener),
  onEditMode: (listener) => subscribe('overlay:edit-mode', listener),
  onLayout: (listener) => subscribe('overlay:layout', listener),
  onInGameEditorState: (listener) => subscribe('in-game-editor:state', listener),
  onTeamLogoTransform: (listener) => subscribe('overlay:team-logo-transform', listener),
  onTeamLogoGeometry: (listener) => subscribe('in-game-editor:logo-geometry', listener),
});

contextBridge.exposeInMainWorld('overlayControl', overlayControl);

contextBridge.exposeInMainWorld('scoreboard', Object.freeze({
  getStatus: () => scoreboardMethod('getStatus'),
  getSettings: () => scoreboardMethod('getSettings'),
  getReaderProfiles: () => scoreboardMethod('getReaderProfiles'),
  saveSettings: (settings) => scoreboardMethod('saveSettings', settings),
  saveOnboarding: (state) => scoreboardMethod('saveOnboarding', state),
  saveReaderProfile: (profile) => scoreboardMethod('saveReaderProfile', profile),
  saveReaderProfilePlacement: (placement) => scoreboardMethod('saveReaderProfilePlacement', placement),
  useReaderCalibration: (calibration) => scoreboardMethod('useReaderCalibration', calibration),
  saveAndExportReaderCalibration: (calibration) => scoreboardMethod('saveAndExportReaderCalibration', calibration),
  importReaderCalibration: (key) => scoreboardMethod('importReaderCalibration', key),
  resetReaderProfile: (key) => scoreboardMethod('resetReaderProfile', key),
  listCaptureSources: () => scoreboardMethod('listCaptureSources'),
  captureSnapshot: (sourceId) => scoreboardMethod('captureSnapshot', sourceId),
  setState: (state) => scoreboardMethod('setState', state),
  action: (action) => scoreboardMethod('action', action),
  chooseTheme: () => scoreboardMethod('chooseTheme'),
  listThemeLibrary: () => scoreboardMethod('listThemeLibrary'),
  importThemeToLibrary: () => scoreboardMethod('importThemeToLibrary'),
  useLibraryTheme: (id) => scoreboardMethod('useLibraryTheme', id),
  deleteLibraryTheme: (id) => scoreboardMethod('deleteLibraryTheme', id),
  openLogs: () => scoreboardMethod('openLogs'),
  openDataExport: () => scoreboardMethod('openDataExport'),
  copyDiagnostics: () => scoreboardMethod('copyDiagnostics'),
  ramReaderDoctor: () => scoreboardMethod('ramReaderDoctor'),
  copyRamReaderDoctor: () => scoreboardMethod('copyRamReaderDoctor'),
  onStatus: (listener) => subscribe('scoreboard:status', listener),
  onState: (listener) => subscribe('scoreboard:state', listener),
  onLog: (listener) => subscribe('scoreboard:log', listener),
  onPanel: (listener) => subscribe('scoreboard:panel', listener),
  onCalibrationSnapshot: (listener) => subscribe('scoreboard:calibration-snapshot', listener),
}));
