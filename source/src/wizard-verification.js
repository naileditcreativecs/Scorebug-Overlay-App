(function exposeWizardVerification(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Cfb27WizardVerification = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function wizardVerificationFactory() {
  'use strict';

  const DEFAULT_FRESH_WINDOW_MS = 20000;

  // Number.isInteger(Number(null)) is true because Number(null) is 0, so the
  // score check must reject null/undefined/empty explicitly instead of
  // coercing first.
  function integerScore(value) {
    if (typeof value === 'number') return Number.isInteger(value);
    if (typeof value === 'string' && value.trim() !== '') return Number.isInteger(Number(value));
    return false;
  }

  function textPresent(...values) {
    return values.some((value) => Boolean(String(value || '').trim()));
  }

  /**
   * Decide whether a scoreboard state proves the local reader is actually
   * working: a fresh, visible local-ocr read carrying both team names, both
   * scores, the quarter, the game clock, and down-and-distance. Manual, mock,
   * placeholder, and stale states never verify.
   */
  function scoreboardVerificationSummary(state, options = {}) {
    const value = state && typeof state === 'object' ? state : {};
    const liveSource = String(value.meta?.source || '').toLowerCase() === 'local-ocr';
    const visible = value.meta?.visible === true;
    const checks = [
      ['away team', textPresent(value.away?.name, value.away?.shortName)],
      ['home team', textPresent(value.home?.name, value.home?.shortName)],
      ['away score', integerScore(value.away?.score)],
      ['home score', integerScore(value.home?.score)],
      ['quarter', textPresent(value.game?.quarter)],
      ['game clock', textPresent(value.game?.clock)],
      ['down and distance', textPresent(value.game?.downDistance)],
    ];
    const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const liveAt = Number(options.liveAt);
    const freshWindowMs = Number.isFinite(options.freshWindowMs)
      ? options.freshWindowMs
      : DEFAULT_FRESH_WINDOW_MS;
    const fresh = liveSource
      && Number.isFinite(liveAt)
      && (now - liveAt) <= freshWindowMs
      && (now - liveAt) >= -1000;
    return {
      total: checks.length,
      ready: checks.length - missing.length,
      missing,
      liveSource,
      visible,
      fresh,
      complete: fresh && visible && missing.length === 0,
    };
  }

  return {
    DEFAULT_FRESH_WINDOW_MS,
    integerScore,
    scoreboardVerificationSummary,
  };
}));
