'use strict';

/**
 * Publish normalized scoreboard state to a Claude Standalone/DC document.
 *
 * Keep this function self-contained. The overlay serializes it with
 * Function#toString and evaluates it inside the isolated theme guest, where
 * module-scope helpers and CommonJS are unavailable.
 */
function applyClaudeDcScoreboardState(scope, scoreboardState = {}) {
  const report = {
    detected: false,
    applied: false,
    didApply: false,
    reason: 'runtime-unavailable',
    rootName: null,
    appliedFields: [],
    appliedProps: [],
    supported: [],
    supportedProps: [],
    staticMissing: [],
  };
  const host = scope && (typeof scope === 'object' || typeof scope === 'function') ? scope : null;
  if (!host || typeof host.__dcSetProps !== 'function'
    || typeof host.__dcRootName !== 'function' || !host.__dcRegistry) {
    return report;
  }

  let rootName;
  let registryEntry;
  try {
    rootName = host.__dcRootName();
    const registry = host.__dcRegistry;
    registryEntry = registry && typeof registry.get === 'function'
      ? registry.get(rootName)
      : registry?.[rootName];
  } catch (error) {
    report.reason = 'runtime-inspection-failed';
    report.error = error instanceof Error ? error.message : String(error);
    return report;
  }
  report.rootName = typeof rootName === 'string' ? rootName : null;

  const propsMeta = registryEntry?.propsMeta;
  if (!report.rootName || !propsMeta || typeof propsMeta !== 'object') {
    report.reason = 'props-metadata-unavailable';
    return report;
  }

  const declaredProps = Object.keys(propsMeta).filter((name) => name && name[0] !== '$');
  if (!declaredProps.length) {
    report.reason = 'no-declared-props';
    return report;
  }
  const declaredByLower = new Map(declaredProps.map((name) => [name.toLowerCase(), name]));
  const findDeclared = (...candidates) => {
    for (const candidate of candidates.flat()) {
      const found = declaredByLower.get(String(candidate || '').toLowerCase());
      if (found) return found;
    }
    return null;
  };
  const hasOwn = (object, key) => Boolean(object)
    && Object.prototype.hasOwnProperty.call(object, key);
  const readFirst = (object, keys) => {
    for (const key of keys) {
      if (hasOwn(object, key)) return object[key];
    }
    return undefined;
  };
  const normalizeForProp = (prop, value) => {
    if (value === undefined) return undefined;
    const meta = propsMeta[prop] || {};
    const numeric = meta.tsType === 'number' || meta.editor === 'int'
      || meta.editor === 'number' || typeof meta.default === 'number';
    const boolean = meta.tsType === 'boolean' || meta.editor === 'boolean'
      || typeof meta.default === 'boolean';
    if (numeric) {
      if (value === null || value === '') return undefined;
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    }
    if (boolean) return Boolean(value);
    if (value === null) return '';
    return typeof value === 'string' ? value : String(value);
  };
  const parseDownDistance = (value) => {
    const match = /^\s*([1-4])(?:st|nd|rd|th)?\s*(?:&|and)\s*(.+?)\s*$/i.exec(String(value || ''));
    return match ? { down: Number(match[1]), distance: match[2] } : {};
  };
  const parseQuarter = (value) => {
    if (Number.isFinite(Number(value)) && String(value).trim() !== '') return Number(value);
    const text = String(value || '').trim();
    if (/ot/i.test(text)) return 5;
    const match = /([1-4])/.exec(text);
    return match ? Number(match[1]) : undefined;
  };
  const unique = (values) => [...new Set(values.filter(Boolean))];

  const away = scoreboardState?.away || {};
  const home = scoreboardState?.home || {};
  const game = scoreboardState?.game || {};
  const parsedDownDistance = parseDownDistance(game.downDistance);

  const prop = {
    awayName: findDeclared('awayName'),
    awayNickname: findDeclared('awayNickname', 'awayMascot', 'awayWordmark'),
    awayRecord: findDeclared('awayRecord'),
    awayColor: findDeclared('awayColor'),
    awayRank: findDeclared('awayRank'),
    awayScore: findDeclared('awayScore'),
    awayLogo: findDeclared('awayLogo', 'awayLogoUrl'),
    homeName: findDeclared('homeName'),
    homeNickname: findDeclared('homeNickname', 'homeMascot', 'homeWordmark'),
    homeRecord: findDeclared('homeRecord'),
    homeColor: findDeclared('homeColor'),
    homeRank: findDeclared('homeRank'),
    homeScore: findDeclared('homeScore'),
    homeLogo: findDeclared('homeLogo', 'homeLogoUrl'),
    down: findDeclared('down', 'downNumber'),
    distance: findDeclared('distance', 'yardsToGo'),
    quarter: findDeclared('quarter', 'period'),
    clock: findDeclared('clock', 'gameClock'),
    playClock: findDeclared('playClock'),
    possession: findDeclared('possession', 'possessionSide', 'possessingTeam'),
    awayPossession: findDeclared('awayPossession'),
    homePossession: findDeclared('homePossession'),
  };

  const timeoutProps = declaredProps.filter((name) => /timeouts?$/i.test(name));
  prop.awayTimeouts = findDeclared('awayTimeouts', 'awayTimeout');
  prop.homeTimeouts = findDeclared('homeTimeouts', 'homeTimeout');
  const unclaimedTimeoutProps = () => timeoutProps.filter((name) => (
    name !== prop.awayTimeouts && name !== prop.homeTimeouts
  ));
  if (!prop.awayTimeouts) prop.awayTimeouts = unclaimedTimeoutProps()[0] || null;
  if (!prop.homeTimeouts) prop.homeTimeouts = unclaimedTimeoutProps()[0] || null;

  // The bundled 2013 theme also carries Claude's DC runtime, but its authored
  // props are unrelated (team1Name, playClockLength, and so on). A DC bug
  // is driven natively when it declares the live numbers as props (scores
  // and clock) OR at least the team identity (name/color/record/rank).
  // Design-canvas bugs often keep scores/clock/downs in the component's own
  // state with demo controls and expose only identity as props; those get
  // identity through props and the live numbers through their state below.
  const identityProps = [prop.awayName, prop.homeName, prop.awayColor, prop.homeColor,
    prop.awayRecord, prop.homeRecord, prop.awayRank, prop.homeRank].filter(Boolean);
  const liveNumberProps = Boolean(prop.awayScore && prop.homeScore && prop.clock);
  if (!liveNumberProps && identityProps.length < 2) {
    report.reason = 'incompatible-scoreboard-props';
    report.supportedProps = unique(Object.values(prop));
    return report;
  }
  report.detected = true;
  report.identityOnlyProps = !liveNumberProps;

  const supported = new Set();
  const support = (field, property) => {
    if (property) supported.add(field);
  };
  support('away.name', prop.awayName);
  support('away.nickname', prop.awayNickname);
  support('away.record', prop.awayRecord);
  support('away.color', prop.awayColor);
  support('away.rank', prop.awayRank);
  support('away.score', prop.awayScore);
  support('away.timeouts', prop.awayTimeouts);
  support('away.logo', prop.awayLogo);
  support('home.name', prop.homeName);
  support('home.nickname', prop.homeNickname);
  support('home.record', prop.homeRecord);
  support('home.color', prop.homeColor);
  support('home.rank', prop.homeRank);
  support('home.score', prop.homeScore);
  support('home.timeouts', prop.homeTimeouts);
  support('home.logo', prop.homeLogo);
  support('game.down', prop.down);
  support('game.distance', prop.distance);
  if (prop.down && prop.distance) supported.add('game.downDistance');
  support('game.quarter', prop.quarter);
  support('game.clock', prop.clock);
  support('game.playClock', prop.playClock);
  if (prop.possession || prop.awayPossession) supported.add('away.possession');
  if (prop.possession || prop.homePossession) supported.add('home.possession');

  const capabilityFields = [
    'away.name', 'away.nickname', 'away.record', 'away.color', 'away.rank', 'away.score',
    'away.timeouts', 'away.possession', 'away.logo',
    'home.name', 'home.nickname', 'home.record', 'home.color', 'home.rank', 'home.score',
    'home.timeouts', 'home.possession', 'home.logo',
    'game.down', 'game.distance', 'game.downDistance', 'game.quarter',
    'game.clock', 'game.playClock',
  ];
  report.supported = capabilityFields.filter((field) => supported.has(field));
  report.staticMissing = capabilityFields.filter((field) => !supported.has(field));
  report.supportedProps = unique(Object.values(prop));

  const mapped = {};
  const propFields = {};
  const mapValue = (property, field, value) => {
    if (!property) return;
    const normalized = normalizeForProp(property, value);
    if (normalized === undefined) return;
    mapped[property] = normalized;
    propFields[property] = field;
  };

  mapValue(prop.awayName, 'away.name', readFirst(away, ['name']));
  mapValue(prop.awayNickname, 'away.nickname', readFirst(away, ['nickname', 'mascot']));
  mapValue(prop.awayRecord, 'away.record', readFirst(away, ['record']));
  mapValue(prop.awayColor, 'away.color', readFirst(away, ['color']));
  mapValue(prop.awayRank, 'away.rank', readFirst(away, ['rank']));
  mapValue(prop.awayScore, 'away.score', readFirst(away, ['score']));
  mapValue(prop.awayTimeouts, 'away.timeouts', readFirst(away, ['timeouts']));
  mapValue(prop.awayLogo, 'away.logo', readFirst(away, ['logo', 'logoUrl']));
  mapValue(prop.homeName, 'home.name', readFirst(home, ['name']));
  mapValue(prop.homeNickname, 'home.nickname', readFirst(home, ['nickname', 'mascot']));
  mapValue(prop.homeRecord, 'home.record', readFirst(home, ['record']));
  mapValue(prop.homeColor, 'home.color', readFirst(home, ['color']));
  mapValue(prop.homeRank, 'home.rank', readFirst(home, ['rank']));
  mapValue(prop.homeScore, 'home.score', readFirst(home, ['score']));
  mapValue(prop.homeTimeouts, 'home.timeouts', readFirst(home, ['timeouts']));
  mapValue(prop.homeLogo, 'home.logo', readFirst(home, ['logo', 'logoUrl']));
  mapValue(prop.down, 'game.down', game.down ?? parsedDownDistance.down);
  mapValue(prop.distance, 'game.distance', game.distance ?? parsedDownDistance.distance);
  mapValue(prop.quarter, 'game.quarter', parseQuarter(game.quarter));
  mapValue(prop.clock, 'game.clock', readFirst(game, ['clock']));
  mapValue(prop.playClock, 'game.playClock', readFirst(game, ['playClock']));

  let possessionSide = 'none';
  const gamePossession = String(game.possession || '').toLowerCase();
  if (gamePossession === 'away' || gamePossession === 'home') possessionSide = gamePossession;
  else if (away.possession === true) possessionSide = 'away';
  else if (home.possession === true) possessionSide = 'home';
  mapValue(prop.awayPossession, 'away.possession', possessionSide === 'away');
  mapValue(prop.homePossession, 'home.possession', possessionSide === 'home');

  if (prop.possession) {
    const optionValues = Array.isArray(propsMeta[prop.possession]?.options)
      ? propsMeta[prop.possession].options.map((option) => (
        option && typeof option === 'object' ? option.value : option
      )).filter((value) => value !== undefined && value !== null)
      : [];
    const timeoutTeamName = (property) => {
      if (!property || /^(away|home)timeouts?$/i.test(property)) return '';
      const raw = property.replace(/timeouts?$/i, '').replace(/[_-]+/g, ' ').trim();
      return raw ? raw.replace(/\b\w/g, (letter) => letter.toUpperCase()) : '';
    };
    const matchOption = (candidates) => {
      for (const candidate of candidates) {
        const found = optionValues.find((option) => String(option).toLowerCase() === String(candidate || '').toLowerCase());
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const candidates = possessionSide === 'away'
      ? ['away', away.name, timeoutTeamName(prop.awayTimeouts)]
      : possessionSide === 'home'
        ? ['home', home.name, timeoutTeamName(prop.homeTimeouts)]
        : ['none', 'neither', 'no possession'];
    const possessionValue = matchOption(candidates) ?? possessionSide;
    mapValue(prop.possession, 'game.possession', possessionValue);
  }

  const mappedProps = Object.keys(mapped);
  if (!mappedProps.length) {
    report.reason = 'no-state-values';
    return report;
  }

  const cacheKey = '__CFB27_CLAUDE_DC_BRIDGE_CACHE__';
  const cached = host[cacheKey];
  const liveOverrides = registryEntry.propOverrides && typeof registryEntry.propOverrides === 'object'
    ? registryEntry.propOverrides
    : null;
  const previous = liveOverrides || (
    cached?.registryEntry === registryEntry && cached?.rootName === report.rootName
      ? cached.mapped
      : {}
  );
  const sameValue = (left, right) => left === right || (Number.isNaN(left) && Number.isNaN(right));
  const changedProps = mappedProps.filter((name) => !sameValue(previous?.[name], mapped[name]));
  if (!changedProps.length) {
    report.reason = 'unchanged';
    return report;
  }

  const nextOverrides = {};
  for (const name of declaredProps) {
    if (liveOverrides && hasOwn(liveOverrides, name)) nextOverrides[name] = liveOverrides[name];
  }
  Object.assign(nextOverrides, mapped);
  try {
    host.__dcSetProps.call(host, report.rootName, nextOverrides);
  } catch (error) {
    report.reason = 'apply-failed';
    report.error = error instanceof Error ? error.message : String(error);
    return report;
  }

  try {
    host[cacheKey] = { registryEntry, rootName: report.rootName, mapped: { ...mapped } };
  } catch {
    // The native registry remains the authoritative repeat-call cache when the
    // guest global is non-extensible.
  }
  report.didApply = true;
  report.reason = 'applied';
  report.appliedProps = changedProps;
  report.applied = true;
  report.appliedFields = unique(changedProps.map((name) => propFields[name]));
  return report;
}

/**
 * Drive the live numbers of a DC component that keeps them in its own state
 * (scores, clock, quarter, down/distance, possession, timeouts). The mounted
 * logic instance is reached through the React fiber of the rendered root;
 * only keys that already exist in the instance's state are set, and only
 * when they change. Self-contained: serialized into the theme guest.
 */
function applyClaudeDcScoreboardLiveState(scope, scoreboardState = {}) {
  const result = { found: false, applied: false, keys: [] };
  const doc = scope && scope.document;
  if (!doc || !doc.body) return result;
  let logic = null;
  const elements = [doc.body, ...Array.from(doc.body.querySelectorAll('*'))].slice(0, 800);
  outer: for (const el of elements) {
    for (const key of Object.keys(el)) {
      if (!key.startsWith('__reactFiber')) continue;
      let fiber = el[key];
      let hops = 0;
      while (fiber && hops < 80) {
        const node = fiber.stateNode;
        if (node && node.logic && typeof node.__setLogicState === 'function'
          && node.logic.state && typeof node.logic.setState === 'function') {
          logic = node.logic;
          break outer;
        }
        fiber = fiber.return;
        hops += 1;
      }
    }
  }
  if (!logic) return result;
  result.found = true;
  const state = logic.state || {};
  const has = (name) => Object.prototype.hasOwnProperty.call(state, name);
  const firstKey = (...names) => names.find((name) => has(name)) || null;
  const away = scoreboardState.away || {};
  const home = scoreboardState.home || {};
  const game = scoreboardState.game || {};
  const update = {};
  const put = (key, value) => {
    if (!key || value === undefined || value === null || Number.isNaN(value)) return;
    if (state[key] !== value) update[key] = value;
  };
  const clockMs = (() => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(game.clock || ''));
    return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 : null;
  })();
  const numeric = (value) => (value === undefined || value === null || value === '' ? undefined : Number(value));
  put(firstKey('awayScore', 'away_score', 'scoreAway'), numeric(away.score));
  put(firstKey('homeScore', 'home_score', 'scoreHome'), numeric(home.score));
  if (clockMs !== null) put(firstKey('gameMs', 'clockMs', 'timeMs', 'gameClockMs'), clockMs);
  else if (game.clock && has('clock')) put('clock', String(game.clock));
  const playSeconds = numeric(game.playClock);
  if (playSeconds !== undefined) {
    put(firstKey('playMs', 'playClockMs'), playSeconds * 1000);
    if (!has('playMs') && !has('playClockMs')) put(firstKey('playClock', 'playclock'), playSeconds);
  }
  const quarter = (() => {
    const raw = game.quarter;
    if (Number.isFinite(Number(raw)) && String(raw).trim() !== '') return Number(raw);
    const text = String(raw || '');
    if (/ot/i.test(text)) return 5;
    const match = /([1-4])/.exec(text);
    return match ? Number(match[1]) : undefined;
  })();
  put(firstKey('quarter', 'period', 'qtr'), quarter);
  put(firstKey('down'), numeric(game.down));
  put(firstKey('dist', 'distance', 'toGo', 'yardsToGo'), numeric(game.distance));
  const possession = away.possession === true ? 'away' : (home.possession === true ? 'home' : 'none');
  put(firstKey('poss', 'possession'), possession);
  put(firstKey('awayTo', 'awayTimeouts', 'awayTO'), numeric(away.timeouts));
  put(firstKey('homeTo', 'homeTimeouts', 'homeTO'), numeric(home.timeouts));
  // The bug's own demo clocks must not tick over the live values.
  if (has('running') && state.running !== false) update.running = false;
  if (has('playRunning') && state.playRunning !== false) update.playRunning = false;
  const keys = Object.keys(update);
  if (!keys.length) return result;
  try {
    logic.setState(update);
    result.applied = true;
    result.keys = keys;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

// Keep the browser-global binding name unique. This file is loaded as a
// classic script beside logo-source.js, whose own top-level `const api` would
// otherwise make Chromium reject this script before the bridge is exposed.
const claudeDcBridgeApi = Object.freeze({ applyClaudeDcScoreboardState, applyClaudeDcScoreboardLiveState });

if (typeof module !== 'undefined' && module.exports) module.exports = claudeDcBridgeApi;
if (typeof globalThis !== 'undefined') globalThis.CFB27ClaudeDcBridge = claudeDcBridgeApi;
