'use strict';

/**
 * Turns noisy per-frame donor reads into a stable scoreboard state.
 *
 * Input observations may use either flat values:
 *   { awayScore: 7, gameClock: '12:31', anchor: { present: true, confidence: .9 } }
 * or confidence-wrapped fields:
 *   { fields: { awayScore: { value: 7, confidence: .9 } }, anchor: ... }
 *
 * The validator never invents a value. A candidate must be seen on consecutive
 * frames before it replaces the last accepted value. This keeps one bad OCR
 * frame from making the on-screen scorebug jump.
 */

const DEFAULT_STATE = Object.freeze({
  awayName: null,
  awayRank: null,
  awayRecord: null,
  awayScore: null,
  awayTimeouts: null,
  homeName: null,
  homeRank: null,
  homeRecord: null,
  homeScore: null,
  homeTimeouts: null,
  possession: null,
  quarter: null,
  gameClock: null,
  playClock: null,
  down: null,
  distance: null,
  downDistance: null,
  ballOn: null,
  status: null,
});

const ALIASES = Object.freeze({
  'away.name': 'awayName',
  'away.rank': 'awayRank',
  'away.record': 'awayRecord',
  'away.score': 'awayScore',
  'away.timeouts': 'awayTimeouts',
  'away.possession': 'awayPossession',
  'home.name': 'homeName',
  'home.rank': 'homeRank',
  'home.record': 'homeRecord',
  'home.score': 'homeScore',
  'home.timeouts': 'homeTimeouts',
  'home.possession': 'homePossession',
  'game.quarter': 'quarter',
  'game.clock': 'gameClock',
  'game.playClock': 'playClock',
  'game.downDistance': 'downDistance',
});

const QUARTER_MAP = Object.freeze({
  '1': '1st', '1ST': '1st', 'Q1': '1st',
  '2': '2nd', '2ND': '2nd', 'Q2': '2nd',
  '3': '3rd', '3RD': '3rd', 'Q3': '3rd',
  '4': '4th', '4TH': '4th', 'Q4': '4th',
  OT: 'OT', OVERTIME: 'OT',
});

const TIMEOUT_FIELDS = Object.freeze(['awayTimeouts', 'homeTimeouts']);
const SCORE_FIELDS = Object.freeze(['awayScore', 'homeScore']);
const HALFTIME_RESET_WINDOW_MS = 30_000;
const LEGAL_SCORE_INCREMENTS = Object.freeze(new Set([1, 2, 3, 6, 7, 8]));

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function cleanText(value, maxLength = 40) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text && text.length <= maxLength ? text : null;
}

function integerInRange(value, minimum, maximum) {
  if (typeof value === 'string' && !/^-?\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function normalizeClock(value) {
  const text = cleanText(value, 8);
  if (!text) return null;
  const match = text.replace(/[.;]/g, ':').match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  if (minutes > 15) return null;
  return `${minutes}:${match[2]}`;
}

function normalizeQuarter(value) {
  const text = cleanText(value, 12);
  if (!text) return null;
  return QUARTER_MAP[text.toUpperCase()] || null;
}

function quarterIndex(value) {
  return { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, OT: 5 }[value] || 0;
}

function quarterFromIndex(value) {
  return ['', '1st', '2nd', '3rd', '4th', 'OT'][value] || null;
}

function normalizePossession(value) {
  if (value === true) return 'away';
  const text = cleanText(value, 16);
  if (!text) return null;
  if (/^(away|visitor|a)$/i.test(text)) return 'away';
  if (/^(home|host|h)$/i.test(text)) return 'home';
  return null;
}

function normalizeDownDistance(value) {
  const text = cleanText(value, 28);
  if (!text) return null;
  const compact = text.replace(/\b(first|second|third|fourth)\b/gi, (word) => ({
    first: '1st', second: '2nd', third: '3rd', fourth: '4th',
  })[word.toLowerCase()]);
  const match = compact.match(/\b([1-4])(?:st|nd|rd|th)?\s*(?:&|and)\s*(goal|inches?|\d{1,2})\b/i);
  if (match) {
    const down = Number(match[1]);
    const distance = /^goal$/i.test(match[2])
      ? 'Goal'
      : /^inches?$/i.test(match[2])
        ? 'Inches'
        : Number(match[2]);
    return { value: `${down}${['th', 'st', 'nd', 'rd'][down] || 'th'} & ${distance}`, down, distance };
  }
  if (/kick\s*off/i.test(compact)) return { value: 'Kickoff', down: null, distance: null };
  if (/extra\s*point|pat/i.test(compact)) return { value: 'PAT', down: null, distance: null };
  return null;
}

function normalizeField(field, value) {
  switch (field) {
    case 'awayScore':
    case 'homeScore': return integerInRange(value, 0, 199);
    case 'awayTimeouts':
    case 'homeTimeouts': return integerInRange(value, 0, 3);
    case 'awayRank':
    case 'homeRank': return value === '' || value === null ? null : integerInRange(value, 1, 99);
    case 'quarter': return normalizeQuarter(value);
    case 'gameClock': return normalizeClock(value);
    case 'playClock': return integerInRange(value, 0, 40);
    case 'down': return integerInRange(value, 1, 4);
    case 'distance': {
      if (/^goal$/i.test(String(value || ''))) return 'Goal';
      if (/^inches?$/i.test(String(value || ''))) return 'Inches';
      return integerInRange(value, 1, 99);
    }
    case 'possession': return normalizePossession(value);
    case 'downDistance': {
      const parsed = normalizeDownDistance(value);
      return parsed ? parsed.value : null;
    }
    case 'awayName':
    case 'homeName': return cleanText(value, 32);
    case 'awayRecord':
    case 'homeRecord': {
      const text = cleanText(value, 16);
      return text && /^\d{1,2}\s*-\s*\d{1,2}(?:\s*\(.*\))?$/.test(text) ? text : null;
    }
    case 'ballOn': return cleanText(value, 16);
    case 'status': return cleanText(value, 40);
    default: return null;
  }
}

function valuesEqual(left, right) {
  return left === right;
}

function clockSeconds(value) {
  if (!value) return null;
  const [minutes, seconds] = value.split(':').map(Number);
  return minutes * 60 + seconds;
}

function normalizeClockOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-5, Math.min(5, Math.trunc(number)));
}

/** Apply a small presentation-only correction without changing accepted OCR state. */
function offsetGameClock(value, offsetSeconds = 0) {
  const normalized = normalizeClock(value);
  if (!normalized) return value ?? null;
  const adjusted = Math.max(0, clockSeconds(normalized) + normalizeClockOffset(offsetSeconds));
  return `${Math.floor(adjusted / 60)}:${String(adjusted % 60).padStart(2, '0')}`;
}

function offsetPlayClock(value, offsetSeconds = 0) {
  if (value === null || value === undefined || value === '') return value ?? null;
  const normalized = integerInRange(value, 0, 99);
  if (normalized === null) return value;
  return Math.max(0, Math.min(99, normalized + normalizeClockOffset(offsetSeconds)));
}

/**
 * Some scoreboard layouts place rank, team, and record inside one OCR box.
 * Split those decorations here so the imported HTML never shows e.g.
 * "17 PENN STATE 5-1" in its team-name slot.
 */
function splitTeamIdentity(name, explicitRank = null, explicitRecord = null) {
  let resolvedName = cleanText(name, 40);
  let resolvedRank = integerInRange(explicitRank, 1, 99);
  let resolvedRecord = cleanText(explicitRecord, 16);

  if (!resolvedName) {
    return { name: resolvedName, rank: resolvedRank, record: resolvedRecord };
  }

  const recordMatch = resolvedName.match(/\s+(\d{1,2}\s*-\s*\d{1,2}(?:\s*\([^)]*\))?)$/);
  if (recordMatch) {
    if (!resolvedRecord) resolvedRecord = recordMatch[1].replace(/\s+/g, '');
    resolvedName = resolvedName.slice(0, recordMatch.index).trim();
  }

  // Three digits are inspected only so the observed `123` OCR insertion can
  // be rejected or conservatively repaired below. Ordinary poll ranks remain
  // limited to their real one- or two-digit range.
  const rankMatch = resolvedName.match(/^#?(\d{1,3})\s+(.+)$/);
  if (rankMatch) {
    let candidateRank = integerInRange(rankMatch[1], 1, 25);
    const possibleTeamName = rankMatch[2].trim();
    const cleanCombinedTeamLabel = /^[A-Z][A-Z&.'() -]*$/i.test(possibleTeamName)
      && (possibleTeamName.match(/[A-Z]/gi) || []).length >= 3;
    // The combined rank/name crop has produced two stable, exact OCR defects:
    // the narrow `1` in rank 10 disappears (`00`), and rank 13 gains a middle
    // stroke (`123`). Keep this as an explicit allowlist rather than repairing
    // arbitrary invalid numbers. A repair also requires a clean alphabetic
    // team label and cannot override a conflicting independent rank read.
    const observedRankRepair = rankMatch[1] === '00'
      ? 10
      : (rankMatch[1] === '123' ? 13 : null);
    const isConservativeObservedRepair = observedRankRepair !== null
      && (resolvedRank === null || resolvedRank === observedRankRepair)
      && cleanCombinedTeamLabel;
    if (candidateRank === null && isConservativeObservedRepair) candidateRank = observedRankRepair;
    if (candidateRank !== null) {
      if (resolvedRank === null) resolvedRank = candidateRank;
      resolvedName = possibleTeamName;
    }
  }

  return { name: resolvedName || null, rank: resolvedRank, record: resolvedRecord };
}

function unwrapFields(observation) {
  const source = observation && observation.fields && typeof observation.fields === 'object'
    ? observation.fields
    : (observation || {});
  const fields = {};
  for (const [sourceName, raw] of Object.entries(source)) {
    if (sourceName === 'anchor' || sourceName === 'timestampMs' || sourceName === 'fields') continue;
    const field = ALIASES[sourceName] || sourceName;
    if (field === 'awayPossession' || field === 'homePossession') continue;
    const wrapped = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value');
    fields[field] = {
      value: wrapped ? raw.value : raw,
      confidence: clamp01(wrapped ? raw.confidence : 1),
      evidence: wrapped && ['present', 'inferred-absence'].includes(raw.evidence)
        ? raw.evidence
        : undefined,
      teamIdentity: wrapped
        && raw.teamIdentity
        && typeof raw.teamIdentity === 'object'
        && raw.teamIdentity.id !== undefined
        ? { id: String(raw.teamIdentity.id) }
        : null,
    };
  }
  const awayPossession = source['away.possession'];
  const homePossession = source['home.possession'];
  if (!fields.possession && awayPossession) {
    const wrapped = awayPossession && typeof awayPossession === 'object' && 'value' in awayPossession;
    if (wrapped ? awayPossession.value : awayPossession) {
      fields.possession = { value: 'away', confidence: clamp01(wrapped ? awayPossession.confidence : 1) };
    }
  }
  if (!fields.possession && homePossession) {
    const wrapped = homePossession && typeof homePossession === 'object' && 'value' in homePossession;
    if (wrapped ? homePossession.value : homePossession) {
      fields.possession = { value: 'home', confidence: clamp01(wrapped ? homePossession.confidence : 1) };
    }
  }
  return fields;
}

/**
 * Decide whether one local-OCR frame contains the structure of the donor
 * scorebug rather than unrelated menu/cutscene text inside the read region.
 *
 * Before both scores have been published, require a credible score pair plus
 * one independent scoreboard signal. Once a score baseline exists, ordinary
 * clock/down reads may keep the overlay visible through a brief score OCR miss.
 */
function hasScoreboardFingerprint(observation = {}, options = {}) {
  const fields = unwrapFields(observation);
  const fieldConfidence = clamp01(options.fieldConfidence ?? 0.62);
  const downDistanceConfidence = clamp01(options.downDistanceConfidence ?? 0.35);
  const scoresEstablished = options.scoresEstablished === true;
  const teamsEstablished = options.teamsEstablished === true;
  const currentlyVisible = options.currentlyVisible === true;
  const credible = (field, confidence = fieldConfidence) => {
    const candidate = fields[field];
    return Boolean(
      candidate
      && candidate.confidence >= confidence
      && normalizeField(field, candidate.value) !== null
    );
  };

  const scorePair = credible('awayScore') && credible('homeScore');
  const teamPair = credible('awayName') && credible('homeName');
  // Team-shaped OCR text alone is not strong startup proof. A badly placed
  // reader box can repeatedly turn field markings into plausible-looking
  // names. The bundled team registry gives us independent corroboration for
  // both names without raising the global confidence floor used by the tiny
  // clock/down glyphs.
  const corroboratedTeamPair = teamPair
    && Boolean(fields.awayName?.teamIdentity?.id)
    && Boolean(fields.homeName?.teamIdentity?.id);
  const quarter = credible('quarter');
  const gameClock = credible('gameClock');
  const playClock = credible('playClock');
  const downDistance = credible('downDistance', downDistanceConfidence);

  // Reacquiring a hidden overlay must use the same complete, current-frame
  // proof as first startup. Retained scores/team names are presentation state,
  // not evidence that the donor is still on screen. This prevents menu and
  // cutscene numbers from bringing the overlay back after the native bug has
  // disappeared.
  if (!scoresEstablished || !currentlyVisible) {
    if (scorePair
      && gameClock
      && (quarter || playClock || ((corroboratedTeamPair || teamsEstablished) && downDistance))) {
      return true;
    }
    // Two independently roster-corroborated names plus a valid clock and any
    // third gameplay signal are enough context when one score crop is weak.
    return corroboratedTeamPair && gameClock && (quarter || playClock || downDistance);
  }
  // While already visible, tolerate one weak score/name/down pass, but always
  // require a current valid clock. The clock requirement makes loss detection
  // decisive once the native donor is gone.
  return gameClock && (scorePair || teamPair || downDistance);
}

/** Convert the stable flat state into the renderer's public scorebug contract. */
function toRendererState(state, meta = {}, displayOptions = {}) {
  const value = { ...DEFAULT_STATE, ...(state || {}) };
  const away = splitTeamIdentity(value.awayName, value.awayRank, value.awayRecord);
  const home = splitTeamIdentity(value.homeName, value.homeRank, value.homeRecord);
  const clockOffsetSeconds = normalizeClockOffset(displayOptions.clockOffsetSeconds);
  return {
    away: {
      rank: away.rank,
      name: away.name,
      record: away.record,
      score: value.awayScore,
      timeouts: value.awayTimeouts,
      possession: value.possession === 'away',
      ...(meta.awayColor ? { color: meta.awayColor } : {}),
      ...(meta.awayLogo ? { logo: meta.awayLogo } : {}),
    },
    home: {
      rank: home.rank,
      name: home.name,
      record: home.record,
      score: value.homeScore,
      timeouts: value.homeTimeouts,
      possession: value.possession === 'home',
      ...(meta.homeColor ? { color: meta.homeColor } : {}),
      ...(meta.homeLogo ? { logo: meta.homeLogo } : {}),
    },
    game: {
      quarter: value.quarter,
      clock: offsetGameClock(value.gameClock, clockOffsetSeconds),
      playClock: offsetPlayClock(value.playClock, clockOffsetSeconds),
      downDistance: value.downDistance,
      down: value.down,
      distance: value.distance,
      ballOn: value.ballOn,
      status: value.status,
    },
    meta: {
      source: meta.source || 'recognition',
      visible: meta.visible !== false,
      confidence: clamp01(meta.confidence ?? 1),
      timestampMs: meta.timestampMs ?? Date.now(),
    },
  };
}

class ScoreboardStateValidator {
  constructor(options = {}) {
    this.options = {
      fieldConfidence: options.fieldConfidence ?? 0.62,
      downDistanceConfidence: options.downDistanceConfidence ?? 0.35,
      gameplayFieldConfidence: options.gameplayFieldConfidence
        ?? options.fieldConfidence
        ?? 0.62,
      anchorConfidence: options.anchorConfidence ?? 0.45,
      stableFrames: options.stableFrames ?? 2,
      identityStableFrames: options.identityStableFrames ?? 3,
      visibleFrames: options.visibleFrames ?? 2,
      hiddenFrames: options.hiddenFrames ?? 3,
      maxScoreJump: options.maxScoreJump ?? 8,
      correctionStableFrames: options.correctionStableFrames ?? 5,
      strictScores: options.strictScores === true,
      scoreStableFrames: options.scoreStableFrames ?? 3,
      scoreBaselineStableFrames: options.scoreBaselineStableFrames ?? 3,
      homeTimeoutDropStableFrames: options.homeTimeoutDropStableFrames ?? 3,
      clockCorrectionFrames: options.clockCorrectionFrames ?? 2,
      clockDriftSeconds: options.clockDriftSeconds ?? 2,
      strictPlayClock: options.strictPlayClock === true,
      playClockDriftSeconds: options.playClockDriftSeconds ?? 2,
      requireClockResetForQuarterAdvance: options.requireClockResetForQuarterAdvance === true,
      repairSkippedQuarterReads: options.repairSkippedQuarterReads === true,
    };
    this.reset(options.initialState);
  }

  reset(initialState = {}) {
    this.state = { ...DEFAULT_STATE, ...(initialState || {}) };
    this.pending = new Map();
    this.acceptedAt = new Map();
    this.visible = false;
    this.allowClockRebase = true;
    this.lastQuarterAcceptedAt = null;
    this.goodAnchorFrames = 0;
    this.missedAnchorFrames = 0;
    this.lastTimestampMs = null;
    return this.snapshot();
  }

  snapshot() {
    return { state: { ...this.state }, visible: this.visible };
  }

  _isPlausible(field, value, timestampMs, fields = {}) {
    const previous = this.state[field];
    if (valuesEqual(previous, value)) return true;
    if (TIMEOUT_FIELDS.includes(field)) {
      // At game start the only fast baseline is the normal three-timeout
      // state. Starting midgame at a lower value still converges through the
      // longer correction path instead of trusting a menu's empty crop.
      if (previous === null || previous === undefined) return value === 3;
      const delta = value - previous;
      if (delta === -1) return true;
      // Each team can spend only one timeout at a time. Larger drops are
      // usually an all-dark transition crop and therefore require the longer
      // correction proof. An increase is valid only for the halftime reset;
      // stable corrections remain possible through correctionStableFrames.
      if (delta < 0) return false;
      const halftimeJustStarted = this.state.quarter === '3rd'
        && this.lastQuarterAcceptedAt !== null
        && timestampMs - this.lastQuarterAcceptedAt <= HALFTIME_RESET_WINDOW_MS;
      return value === 3 && halftimeJustStarted;
    }
    if (previous === null || previous === undefined) return true;
    if (field === 'awayScore' || field === 'homeScore') {
      const delta = value - previous;
      if (delta < 0 || delta > this.options.maxScoreJump) return false;
      return LEGAL_SCORE_INCREMENTS.has(delta);
    }
    if (field === 'quarter') {
      const before = quarterIndex(previous);
      const after = quarterIndex(value);
      if (after < before || after > before + 1) return false;
      if (after === before || !this.options.requireClockResetForQuarterAdvance) return true;
      return this._hasQuarterClockReset(fields);
    }
    if (field === 'gameClock') {
      const before = clockSeconds(previous);
      const after = clockSeconds(value);
      if (before === null || after === null) return true;
      if (this.allowClockRebase) return true;
      const quarterJustAdvanced = this.lastQuarterAcceptedAt !== null
        && timestampMs - this.lastQuarterAcceptedAt <= 2000;
      if (quarterJustAdvanced && after > before) return true;
      if (after > before + this.options.clockDriftSeconds) return false;
      const acceptedAt = this.acceptedAt.get(field);
      const elapsedSeconds = acceptedAt === undefined
        ? 0
        : Math.max(0, (timestampMs - acceptedAt) / 1000);
      const maximumExpectedDrop = Math.max(
        this.options.clockDriftSeconds,
        Math.ceil(elapsedSeconds) + this.options.clockDriftSeconds,
      );
      return before - after <= maximumExpectedDrop;
    }
    if (field === 'playClock') {
      const before = Number(previous);
      const after = Number(value);
      if (!Number.isInteger(before) || !Number.isInteger(after)) return true;
      // Real resets move upward into the 25/40-second range. Small upward
      // changes are digit noise and must never reach the presentation model.
      if (after > before) return after >= 20 && (after - before) >= 5;
      // Accelerated-clock runoff can legitimately skip several seconds. Guard
      // only a collapse into one digit, which is the common clipped-tens read.
      if (after >= 10) return true;
      const acceptedAt = this.acceptedAt.get(field);
      const elapsedSeconds = acceptedAt === undefined
        ? 0
        : Math.max(0, (timestampMs - acceptedAt) / 1000);
      const maximumExpectedDrop = Math.max(
        this.options.playClockDriftSeconds,
        Math.ceil(elapsedSeconds) + this.options.playClockDriftSeconds,
      );
      return before - after <= maximumExpectedDrop;
    }
    return true;
  }

  _requiredFrames(field, plausible, value, evidence, corroborated = false) {
    if (!plausible) return this.options.correctionStableFrames;
    if (SCORE_FIELDS.includes(field) && this.options.strictScores) {
      const hasBaseline = this.state[field] !== null && this.state[field] !== undefined;
      return hasBaseline
        ? this.options.scoreStableFrames
        : this.options.scoreBaselineStableFrames;
    }
    // Every gameplay field is attempted on the clock cadence. Publish a
    // structurally valid, plausible score/quarter/clock/down read from that
    // same frame; implausible score jumps and quarter changes still take the
    // correction path below.
    // Possession is not OCR. A visible geometry-validated triangle is direct
    // evidence and may publish immediately; absence from the one-team probe is
    // indirect evidence and is stabilized separately above.
    if (field === 'possession' && evidence === 'inferred-absence') {
      return Math.max(2, this.options.stableFrames);
    }
    if (field === 'gameClock'
      || field === 'playClock'
      || field === 'downDistance'
      || field === 'quarter'
      || SCORE_FIELDS.includes(field)
      || field === 'possession') return 1;
    // Zero bars is visually identical to an empty transition crop. A third
    // established-scoreboard sample protects the last timeout without making
    // ordinary 3->2 or 2->1 changes sluggish.
    if (TIMEOUT_FIELDS.includes(field) && value === 0) {
      return Math.max(3, this.options.stableFrames);
    }
    // The lower timeout row is more exposed to bright team colors, the score
    // glyph, and one-pixel capture alignment changes. Require one additional
    // matching observation before publishing a home-team decrement. This is
    // intentionally asymmetric: the proven upper-row timing remains unchanged.
    if (field === 'homeTimeouts'
      && this.state.homeTimeouts !== null
      && this.state.homeTimeouts !== undefined
      && value < this.state.homeTimeouts) {
      return Math.max(this.options.homeTimeoutDropStableFrames, this.options.stableFrames);
    }
    if (field === 'awayName' || field === 'homeName' || field.endsWith('Record')) {
      if (corroborated) return Math.min(2, this.options.identityStableFrames);
      return this.options.identityStableFrames;
    }
    return this.options.stableFrames;
  }

  _trackClockCorrection(field, value, confidence, timestampMs) {
    const previous = this.pending.get(field);
    const before = clockSeconds(previous?.value);
    const after = clockSeconds(value);
    const elapsedSeconds = previous?.timestampMs === undefined
      ? 0
      : Math.max(0, (timestampMs - previous.timestampMs) / 1000);
    const mutuallyConsistent = previous
      && before !== null
      && after !== null
      && after <= before + this.options.clockDriftSeconds
      && before - after <= Math.max(
        this.options.clockDriftSeconds,
        Math.ceil(elapsedSeconds) + this.options.clockDriftSeconds,
      );
    const candidate = mutuallyConsistent
      ? {
        value,
        frames: previous.frames + 1,
        confidence: Math.max(previous.confidence, confidence),
        plausible: false,
        timestampMs,
      }
      : { value, frames: 1, confidence, plausible: false, timestampMs };
    this.pending.set(field, candidate);
    if (candidate.frames < this.options.clockCorrectionFrames) return false;
    this.state[field] = value;
    this.pending.delete(field);
    return true;
  }

  _trackCandidate(field, value, confidence, plausible, timestampMs, evidence, corroborated = false) {
    if (!plausible
      && ((this.options.strictScores && SCORE_FIELDS.includes(field))
        || (this.options.strictPlayClock && field === 'playClock'))) {
      this.pending.delete(field);
      return false;
    }
    if (field === 'gameClock' && !plausible) {
      return this._trackClockCorrection(field, value, confidence, timestampMs);
    }
    const previous = this.pending.get(field);
    const sameEvidence = field !== 'possession' || previous?.evidence === evidence;
    const candidate = previous && valuesEqual(previous.value, value) && sameEvidence
      ? { value, frames: previous.frames + 1, confidence: Math.max(previous.confidence, confidence), plausible, timestampMs, evidence }
      : { value, frames: 1, confidence, plausible, timestampMs, evidence };
    this.pending.set(field, candidate);
    if (candidate.frames < this._requiredFrames(field, plausible, value, evidence, corroborated)) return false;
    this.state[field] = value;
    this.pending.delete(field);
    return true;
  }

  _hasQuarterClockReset(fields = {}) {
    const candidate = fields.gameClock;
    if (!candidate || candidate.confidence < this.options.fieldConfidence) return false;
    const before = clockSeconds(normalizeClock(this.state.gameClock));
    const after = clockSeconds(normalizeClock(candidate.value));
    return before !== null
      && after !== null
      && after > before + this.options.clockDriftSeconds;
  }

  _resolveQuarterCandidate(value, fields = {}) {
    if (!this.options.repairSkippedQuarterReads || !this._hasQuarterClockReset(fields)) return value;
    const previousIndex = quarterIndex(this.state.quarter);
    const observedIndex = quarterIndex(value);
    if (!previousIndex || observedIndex <= previousIndex + 1) return value;
    // A football clock can reset only into the immediately following quarter.
    // The live 3rd-quarter glyph has repeatedly OCR'd as `4`; when the prior
    // accepted quarter and simultaneous clock reset prove that a transition
    // occurred, collapse an impossible skipped-quarter read to the next legal
    // quarter instead of permanently jumping 2nd -> 4th.
    return quarterFromIndex(previousIndex + 1) || value;
  }

  update(observation = {}, metadata = {}) {
    const timestampMs = Number(metadata.timestampMs ?? observation.timestampMs ?? Date.now());
    const anchor = observation.anchor || {};
    const anchorPresent = anchor.present !== false && clamp01(anchor.confidence ?? 1) >= this.options.anchorConfidence;
    const visibilityChangedBefore = this.visible;

    if (anchorPresent) {
      this.goodAnchorFrames += 1;
      this.missedAnchorFrames = 0;
      if (!this.visible && this.goodAnchorFrames >= this.options.visibleFrames) this.visible = true;
    } else {
      this.goodAnchorFrames = 0;
      this.missedAnchorFrames += 1;
      if (this.visible && this.missedAnchorFrames >= this.options.hiddenFrames) this.visible = false;
    }

    const accepted = [];
    const rejected = [];
    const fields = unwrapFields(observation);
    const pendingPossession = this.pending.get('possession');
    if (!anchorPresent
      || (pendingPossession?.evidence === 'inferred-absence'
        && fields.possession?.evidence !== 'inferred-absence')) {
      this.pending.delete('possession');
    }

    const hasCredibleContextValue = (field) => {
      const acceptedValue = normalizeField(field, this.state[field]);
      if (acceptedValue !== null) return true;
      const candidate = fields[field];
      const requiredConfidence = field === 'downDistance'
        ? this.options.downDistanceConfidence
        : this.options.fieldConfidence;
      return Boolean(
        candidate
        && candidate.confidence >= requiredConfidence
        && normalizeField(field, candidate.value) !== null
      );
    };
    const hasClockContext = hasCredibleContextValue('gameClock');
    const hasQuarterContext = hasCredibleContextValue('quarter');
    // The tiny native quarter glyph can occasionally OCR as "B" even while
    // the rest of the scorebug is unambiguous. In that case, require both team
    // identities plus down-and-distance alongside the clock before accepting
    // an initial score. This remains much stricter than a lone menu/cutscene
    // number and avoids blank scores after a fresh reader restart.
    const hasTeamAndDownContext = hasCredibleContextValue('awayName')
      && hasCredibleContextValue('homeName')
      && hasCredibleContextValue('downDistance');
    const hasScoreBaselineContext = hasClockContext
      && (hasQuarterContext || hasTeamAndDownContext);

    // Timeout, score, and down candidates must never accumulate while the
    // donor scoreboard is unestablished. This is the exact state seen in
    // menu/cutscene telemetry: isolated visual fields can remain readable even
    // though the full scoreboard is hidden or transitioning.
    if (!anchorPresent || !this.visible) {
      for (const field of [...TIMEOUT_FIELDS, ...SCORE_FIELDS, 'downDistance']) this.pending.delete(field);
    }

    const timeoutDrops = TIMEOUT_FIELDS.filter((field) => {
      const candidate = fields[field];
      if (!candidate || candidate.confidence < this.options.fieldConfidence) return false;
      const value = normalizeField(field, candidate.value);
      const previous = this.state[field];
      return value !== null && previous !== null && previous !== undefined && value < previous;
    });
    const simultaneousTimeoutDrop = timeoutDrops.length === TIMEOUT_FIELDS.length;
    // Quarter is evaluated first even if an input source supplied timeout
    // fields before it. On the second stable Q3 frame, this lets both teams'
    // legitimate halftime reset publish without a five-frame correction lag.
    const orderedFields = Object.entries(fields).sort(([left], [right]) => (
      Number(TIMEOUT_FIELDS.includes(left)) - Number(TIMEOUT_FIELDS.includes(right))
    ));

    if (anchorPresent) {
      for (const [field, candidate] of orderedFields) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_STATE, field)) continue;
        if ((TIMEOUT_FIELDS.includes(field) || SCORE_FIELDS.includes(field) || field === 'downDistance')
          && !this.visible) {
          rejected.push({ field, reason: 'scoreboard-not-established' });
          this.pending.delete(field);
          continue;
        }
        const requiredConfidence = field === 'downDistance'
          ? this.options.downDistanceConfidence
          : (field === 'quarter' || SCORE_FIELDS.includes(field)
            ? this.options.gameplayFieldConfidence
            : this.options.fieldConfidence);
        if (candidate.confidence < requiredConfidence) {
          rejected.push({ field, reason: 'low-confidence', confidence: candidate.confidence });
          if (field === 'possession' && candidate.evidence === 'inferred-absence') {
            this.pending.delete('possession');
          }
          continue;
        }
        let value = normalizeField(field, candidate.value);
        if (field === 'quarter' && value !== null) {
          value = this._resolveQuarterCandidate(value, fields);
        }
        if (value === null) {
          rejected.push({ field, reason: 'invalid-value', value: candidate.value });
          if (field === 'possession') this.pending.delete('possession');
          continue;
        }
        if (
          SCORE_FIELDS.includes(field)
          && (this.state[field] === null || this.state[field] === undefined)
          && !hasScoreBaselineContext
        ) {
          rejected.push({ field, reason: 'scoreboard-context-missing' });
          this.pending.delete(field);
          continue;
        }
        if (valuesEqual(this.state[field], value)) {
          this.pending.delete(field);
          continue;
        }
        const plausible = !(simultaneousTimeoutDrop && TIMEOUT_FIELDS.includes(field))
          && this._isPlausible(field, value, timestampMs, fields);
        if (this._trackCandidate(
          field,
          value,
          candidate.confidence,
          plausible,
          timestampMs,
          candidate.evidence,
          Boolean(candidate.teamIdentity?.id),
        )) {
          accepted.push(field);
          this.acceptedAt.set(field, timestampMs);
          if (field === 'gameClock') this.allowClockRebase = false;
          if (field === 'quarter') this.lastQuarterAcceptedAt = timestampMs;
          if (field === 'downDistance') {
            const parsed = normalizeDownDistance(value);
            if (parsed) {
              this.state.down = parsed.down;
              this.state.distance = parsed.distance;
            }
          }
        }
      }
    }

    if (visibilityChangedBefore && !this.visible) {
      this.allowClockRebase = true;
      this.pending.delete('gameClock');
      this.pending.delete('possession');
      // Team cards briefly disappear during replays, play transitions and
      // specialty HUD states. Retain the last structurally valid possession
      // value while the overlay is hidden; reset() still clears it when the
      // reader/game session is explicitly restarted.
    }

    this.lastTimestampMs = timestampMs;
    return {
      state: { ...this.state },
      visible: this.visible,
      changed: accepted.length > 0 || visibilityChangedBefore !== this.visible,
      visibilityChanged: visibilityChangedBefore !== this.visible,
      accepted,
      rejected,
      anchor: {
        present: anchorPresent,
        confidence: clamp01(anchor.confidence ?? (anchorPresent ? 1 : 0)),
        goodFrames: this.goodAnchorFrames,
        missedFrames: this.missedAnchorFrames,
      },
      timestampMs,
    };
  }
}

module.exports = {
  ALIASES,
  DEFAULT_STATE,
  ScoreboardStateValidator,
  hasScoreboardFingerprint,
  normalizeClock,
  normalizeClockOffset,
  normalizeDownDistance,
  normalizeField,
  normalizeQuarter,
  offsetGameClock,
  offsetPlayClock,
  splitTeamIdentity,
  toRendererState,
  unwrapFields,
};
