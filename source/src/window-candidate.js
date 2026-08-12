'use strict';

const DEFAULT_EXACT_PROCESS_NAMES = Object.freeze(['CollegeFB27.exe', 'CollegeFB27_Trial.exe']);

// Windows that commonly mention the game in their titles without being the
// game: file managers, terminals, launchers, mod tools, capture suites,
// browsers, chat apps, editors, and media players. The containment fallback
// must never follow one of these.
const DEFAULT_EXCLUDED_TITLE_TERMS = Object.freeze([
  'file explorer',
  'terminal',
  'command prompt',
  'powershell',
  'cmd',
  'bash',
  'launcher',
  'installer',
  'setup',
  'mod manager',
  'frosty',
  'mmc',
  'obs',
  'streamlabs',
  'medal',
  'outplayed',
  'geforce',
  'game bar',
  'xbox',
  'discord',
  'slack',
  'telegram',
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'opera',
  'brave',
  'vivaldi',
  'youtube',
  'twitch',
  'reddit',
  'wiki',
  'fandom',
  'google',
  'bing',
  'notepad',
  'wordpad',
  'visual studio',
  'sublime',
  'obsidian',
  'word',
  'excel',
  'powerpoint',
  'onenote',
  'outlook',
  'steam',
  'epic games',
  'ea app',
  'origin',
  'gog galaxy',
  'vlc',
  'media player',
  'task manager',
  'control panel',
  'github',
  'gitlab',
  'codex',
  'claude',
  'chatgpt',
  'copilot',
  'cfb27 scoreboard overlay',
]);

// Raw-title shapes that are never the game window: filesystem paths shown by
// terminals/file managers and document/media titles ending in an extension.
const PATH_LIKE_TITLE = /(?:^|\s)(?:[a-z]:[\\/]|\\\\)/i;
const FILE_EXTENSION_TITLE = /\.(?:exe|bat|cmd|ps1|msi|dll|txt|log|md|pdf|docx?|xlsx?|pptx?|html?|json|xml|ini|cfg|png|jpe?g|gif|bmp|webp|mp4|mkv|avi|mov|mp3|wav|zip|7z|rar|fbmod)(?:\b|$)/i;

// The real game title carries a trademark symbol; Chromium may deliver it as
// the actual symbol or as UTF-8 mojibake for the active ANSI codepage
// (CP1252 "â„¢"/"Ã¢â€žÂ¢", CP1251 "в„ў", CP932 "邃｢"). A same-named folder or
// document title almost never does, so its presence ranks the true game
// window above impostors that normalize to the same text.
const TRADEMARK_MARKS = /(?:[™®©]|â„¢|Ã¢â€žÂ¢|в„ў|邃｢)/;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

// Reduce a window title to lowercase alphanumeric words. Collapsing every
// other character (trademark symbols, any-codepage mojibake, dashes, dots)
// into spaces makes the comparison stable across Windows locales, which is
// where per-symbol strip lists previously failed.
function normalizeWindowTitle(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeProcessName(value) {
  return normalize(value).split(/[\\/]/).pop();
}

function numberString(value) {
  return String(value ?? '');
}

function windowArea(candidate) {
  const bounds = candidate?.clientBounds || candidate?.frameBounds || {};
  const width = Math.max(0, Number(bounds.width) || 0);
  const height = Math.max(0, Number(bounds.height) || 0);
  return width * height;
}

function rankGameWindows(windows, options = {}) {
  const excludedPids = new Set([
    options.selfPid,
    ...(options.excludedPids || []),
  ].filter((value) => value !== undefined && value !== null).map(numberString));
  const exactProcessNames = (options.exactProcessNames || DEFAULT_EXACT_PROCESS_NAMES)
    .map(normalizeProcessName)
    .filter(Boolean);
  const processTerms = (options.processNameIncludes || []).map(normalize).filter(Boolean);
  const titleTerms = (options.windowNameIncludes || []).map(normalize).filter(Boolean);
  const excludedProcessTerms = (options.excludedProcessNameIncludes || [])
    .map(normalize)
    .filter(Boolean);
  const hasProcessIdentity = exactProcessNames.length > 0 || processTerms.length > 0;
  const trustedHwnd = numberString(options.trustedHwnd);

  return (Array.isArray(windows) ? windows : [])
    .map((candidate) => {
      const processName = normalizeProcessName(candidate?.processName || candidate?.processPath);
      const title = normalize(candidate?.title);
      const exactProcess = exactProcessNames.includes(processName);
      const processMatch = processTerms.some((term) => processName.includes(term));
      const titleMatch = titleTerms.some((term) => title.includes(term));
      const excluded = excludedPids.has(numberString(candidate?.pid))
        || excludedProcessTerms.some((term) => processName.includes(term));
      const trustedHandle = Boolean(trustedHwnd) && numberString(candidate?.hwnd) === trustedHwnd;

      // When a process identity is configured, fail closed instead of following
      // an unrelated terminal, launcher, or mod manager whose title mentions the game.
      const identityMatch = trustedHandle || (hasProcessIdentity ? (exactProcess || processMatch) : titleMatch);
      if (excluded || !identityMatch) return null;

      const area = windowArea(candidate);
      const score = (trustedHandle ? 2_000_000 : (exactProcess ? 1_000_000 : 100_000))
        + (titleMatch ? 10_000 : 0)
        + (candidate?.foreground ? 2_000 : 0)
        + (!candidate?.minimized ? 1_000 : 0)
        + (!candidate?.cloaked ? 500 : 0)
        + Math.min(499, Math.round(area / 10_000));

      return { candidate, score, area };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.score - left.score
      || right.area - left.area
      || numberString(left.candidate.hwnd).localeCompare(numberString(right.candidate.hwnd), 'en', { numeric: true })
    ));
}

function selectGameWindow(windows, options = {}) {
  return rankGameWindows(windows, options)[0]?.candidate || null;
}

function captureSourceHwnd(source) {
  const match = /^window:(\d+):/i.exec(String(source?.id || ''));
  return match?.[1] || '';
}

function titleMatchedTerm(normalizedTitle, acceptedTitles) {
  if (!normalizedTitle) return '';
  if (acceptedTitles.includes(normalizedTitle)) return normalizedTitle;
  const padded = ` ${normalizedTitle} `;
  return acceptedTitles
    .filter((term) => padded.includes(` ${term} `))
    .sort((left, right) => right.length - left.length)[0] || '';
}

function excludedContainmentTitle(name, extraTerms) {
  const raw = String(name || '');
  if (PATH_LIKE_TITLE.test(raw) || FILE_EXTENSION_TITLE.test(raw)) return true;
  const padded = ` ${normalizeWindowTitle(raw)} `;
  const terms = [
    ...DEFAULT_EXCLUDED_TITLE_TERMS,
    ...(extraTerms || []),
  ].map(normalizeWindowTitle).filter(Boolean);
  return terms.some((term) => padded.includes(` ${term} `));
}

// Desktop-capture sources expose no process name or bounds, so ties between
// same-titled windows are broken by title evidence alone: a trademark mark
// only the real game title carries, then continuity with the previously
// selected source, then how exactly and completely the configured title is
// matched.
function rankAcceptedCaptureSources(list, context = {}) {
  const previousSourceId = String(context.previousSourceId || '');
  const acceptedTitles = context.acceptedTitles || [];
  return list
    .map((source, index) => {
      const normalized = normalizeWindowTitle(source?.name);
      const matchedTerm = titleMatchedTerm(normalized, acceptedTitles);
      const score = (TRADEMARK_MARKS.test(String(source?.name || '')) ? 1000 : 0)
        + (previousSourceId && source?.id === previousSourceId ? 500 : 0)
        + (matchedTerm && normalized === matchedTerm ? 250 : 0)
        + Math.min(99, matchedTerm.length)
        - Math.min(99, Math.max(0, normalized.length - matchedTerm.length));
      return { source, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.source);
}

/**
 * Match Electron desktop-capture sources without accepting arbitrary windows
 * whose titles merely mention the game (for example Terminal or Frosty).
 */
function selectCaptureSource(sources, options = {}) {
  const candidates = Array.isArray(sources) ? sources : [];
  const acceptedTitles = [
    options.exactTitle,
    ...(options.windowNameIncludes || []),
  ].map(normalizeWindowTitle).filter(Boolean);
  const previousSourceId = String(options.previousSourceId || '');
  const rankContext = { previousSourceId, acceptedTitles };
  const hwnd = String(options.hwnd || '');
  if (hwnd) {
    const byHandle = candidates.find((source) => captureSourceHwnd(source) === hwnd);
    if (byHandle) return byHandle;
  }

  const explicitSourceId = String(options.explicitSourceId || '');
  if (explicitSourceId) {
    const explicit = candidates.find((source) => source.id === explicitSourceId);
    const savedName = normalizeWindowTitle(options.explicitSourceName);
    const savedNameAccepted = Boolean(savedName)
      && normalizeWindowTitle(explicit?.name) === savedName;
    const titleAccepted = acceptedTitles.includes(normalizeWindowTitle(explicit?.name));
    const unconstrainedExplicit = !acceptedTitles.length && !savedName;
    // A manual pick that this session has already validated stays
    // authoritative while its live id is still enumerable, even when the
    // window retitles itself (loading screens, display-mode suffixes).
    // Ids persisted by an earlier session still revalidate by title, so a
    // recycled handle cannot silently capture an unrelated window.
    const sessionTrusted = Boolean(explicit)
      && explicitSourceId === String(options.trustedExplicitSourceId || '');
    if (explicit && (titleAccepted || savedNameAccepted || unconstrainedExplicit || sessionTrusted)) {
      return explicit;
    }
  }

  // Electron source IDs are tied to a particular enumeration and commonly
  // change after the game or app restarts. Recover only by the complete saved
  // title; substring matches would admit launchers, terminals, and mod tools.
  const savedName = normalizeWindowTitle(options.explicitSourceName);
  if (savedName) {
    const recovered = rankAcceptedCaptureSources(
      candidates.filter((source) => normalizeWindowTitle(source?.name) === savedName),
      rankContext,
    )[0];
    if (recovered) return recovered;
  }

  const exact = rankAcceptedCaptureSources(
    candidates.filter((source) => acceptedTitles.includes(normalizeWindowTitle(source?.name))),
    rankContext,
  )[0];
  if (exact) return exact;

  // Accept decorated variants of the configured titles ("EA SPORTS™ College
  // Football 27 (DX12)", locale-specific trademark mojibake) that exact
  // matching would reject forever. Known browser/launcher/tool windows and
  // path-like or document titles stay rejected, so this fallback cannot
  // follow a window that merely mentions the game.
  const contained = rankAcceptedCaptureSources(
    candidates.filter((source) => Boolean(titleMatchedTerm(normalizeWindowTitle(source?.name), acceptedTitles))
      && !excludedContainmentTitle(source?.name, options.excludedTitleTerms)),
    rankContext,
  )[0];
  return contained || null;
}

module.exports = {
  DEFAULT_EXACT_PROCESS_NAMES,
  DEFAULT_EXCLUDED_TITLE_TERMS,
  captureSourceHwnd,
  normalizeWindowTitle,
  rankGameWindows,
  selectCaptureSource,
  selectGameWindow,
};
