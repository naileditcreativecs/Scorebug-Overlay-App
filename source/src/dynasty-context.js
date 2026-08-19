'use strict';

// Pure helpers that turn a dynasty-save context (from dynasty-context-worker)
// into scorebug fields. Nothing here reads files or memory.

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Map save teams to bundled asset ids using the resolver (exact name / alias
// first, then name + nickname, then the resolver's identity match). Returns
// Map<assetId, saveTeam>.
// Save display names that the roster does not know under that spelling.
const SAVE_NAME_ALIASES = new Map([
  // keys are normalizeName() output: lower case, punctuation stripped
  ['niu', 'Northern Illinois'],
  ['c michigan', 'Central Michigan'],
  ['e michigan', 'Eastern Michigan'],
  ['w michigan', 'Western Michigan'],
  ['w kentucky', 'Western Kentucky'],
  ['middle tenn', 'Middle Tennessee'],
  ['san diego st', 'San Diego State'],
  ['san jose st', 'San Jose State'],
  ['miami oh', 'Miami (OH)'],
  ['ul monroe', 'Louisiana-Monroe'],
  ['la tech', 'Louisiana Tech'],
  ['app state', 'Appalachian State'],
  ['app st', 'Appalachian State'],
  ['ga southern', 'Georgia Southern'],
  ['fla atlantic', 'FAU'],
  ['florida atlantic', 'FAU'],
  ['c carolina', 'Coastal Carolina'],
  ['hawai i', 'Hawaii'],
  ['jax state', 'Jacksonville State'],
  ['jax st', 'Jacksonville State'],
  ['sac state', 'Sacramento State'],
  ['ndsu', 'North Dakota State'],
  ['uconn', 'Connecticut'],
  ['louisiana', 'UL Lafayette'],
  ['nc state', 'N.C. State'],
]);

function resolveSaveTeam(team, resolver) {
  if (!team || !resolver) return null;
  const tries = [team.name, SAVE_NAME_ALIASES.get(normalizeName(team.name)), team.nickname ? `${team.name} ${team.nickname}` : null].filter(Boolean);
  for (const candidate of tries) {
    let asset = null;
    try { asset = resolver.resolve(candidate) || null; } catch { asset = null; }
    if (asset) return asset;
  }
  for (const candidate of tries) {
    // Fuzzy identity matching is for full names only; "E. Michigan" must
    // not drift to Michigan State.
    if (candidate.includes('.') || candidate.length < 5) continue;
    let identity = null;
    try { identity = resolver.resolveIdentity?.(candidate) || null; } catch { identity = null; }
    const asset = identity?.asset || null;
    if (!asset) continue;
    // A save name is the game's own spelling, so a fuzzy hit must agree on
    // the nickname, and a "closest" guess must also contain every real word
    // of the save name: "Eastern Washington Eagles" is not Eastern Michigan
    // and "South Dakota" is not South Carolina - those are save-only teams.
    const sameNickname = !team.nickname || !asset.nickname
      || normalizeName(team.nickname) === normalizeName(asset.nickname);
    if (!sameNickname) continue;
    if (/closest|fuzzy/i.test(String(identity.match || ''))) {
      const assetWords = new Set(normalizeName(asset.name).split(' '));
      const words = normalizeName(team.name).split(' ').filter((w) => w.length >= 4);
      if (!words.length || !words.every((w) => assetWords.has(w))) continue;
    }
    return asset;
  }
  // Nickname disambiguation: the roster team with this nickname that shares
  // a word (or the abbreviation's initials) with the save name.
  if (team.nickname && resolver.byId) {
    const nick = String(team.nickname).toLowerCase();
    const candidates = [...resolver.byId.values()].filter((t) => String(t.nickname || '').toLowerCase() === nick);
    const words = normalizeName(team.name).split(' ').filter((w) => w.length > 2);
    const realWords = words.filter((w) => w.length >= 4);
    const initials = normalizeName(team.name).replace(/ /g, '');
    for (const t of candidates) {
      const tw = normalizeName(t.name).split(' ');
      // Every real word of the save name must be in the roster name: a
      // shared nickname alone ("Delaware State Hornets" vs Sacramento State)
      // is not a match - that is a save-only team.
      if (realWords.length && realWords.every((w) => tw.includes(w))) return resolver.resolveTeamId(t.id);
      const ini = tw.map((w) => w[0]).join('');
      if (initials.length >= 2 && (ini === initials || `${ini}u` === initials)) return resolver.resolveTeamId(t.id);
    }
  }
  return null;
}

// Give every save team an identity: teams the resolver cannot place after
// exact/alias/nickname matching are registered on the resolver as dynasty
// teams (name, nickname, abbreviation, colours from the save). Returns the
// list that had to be synthesized.
function registerUnmatchedSaveTeams(context, resolver) {
  if (!context?.teams || !resolver || typeof resolver.setDynastyTeams !== 'function') return [];
  resolver.setDynastyTeams([]);
  const unmatched = [];
  const taken = new Set();
  for (const team of context.teams) {
    const asset = resolveSaveTeam(team, resolver);
    // Two save teams landing on one roster team means the second is really a
    // different school (mod/TeamBuilder) - keep the save's own name for it.
    if (asset && !taken.has(String(asset.id))) { taken.add(String(asset.id)); continue; }
    unmatched.push(team);
  }
  resolver.setDynastyTeams(unmatched);
  return unmatched;
}

function indexSaveTeams(context, resolver) {
  const byAsset = new Map();
  if (!context?.teams || !resolver) return byAsset;
  for (const team of context.teams) {
    const asset = resolveSaveTeam(team, resolver);
    if (asset && !byAsset.has(String(asset.id))) byAsset.set(String(asset.id), team);
  }
  return byAsset;
}

// This week's SeasonGame for the live matchup (either orientation).
function findMatchupGame(context, awayTeam, homeTeam) {
  if (!context?.gamesThisWeek || !awayTeam || !homeTeam) return null;
  const exact = context.gamesThisWeek.find((g) => g.awayIndex === awayTeam.index && g.homeIndex === homeTeam.index);
  if (exact) return { game: exact, flipped: false };
  const flipped = context.gamesThisWeek.find((g) => g.awayIndex === homeTeam.index && g.homeIndex === awayTeam.index);
  if (flipped) return { game: flipped, flipped: true };
  return null;
}

function weekLabel(season, game) {
  const type = String(game?.weekType || season?.currentWeekType || '');
  if (game?.bowl?.name) return game.bowl.name;
  if (/NationalChampionship/i.test(type)) return 'National Championship';
  if (/Bowl|Playoff/i.test(type)) return 'Bowl Season';
  if (/PreSeason/i.test(type)) return 'Preseason';
  const week = Number(game?.week ?? season?.currentWeek);
  if (Number.isInteger(week) && week > 0) {
    if (season?.confChampWeek && week === season.confChampWeek) return 'Conference Championship';
    return `Week ${week}`;
  }
  return '';
}

function record(team) {
  if (!team) return null;
  const w = Number(team.wins) || 0, l = Number(team.losses) || 0, t = Number(team.ties) || 0;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function confRecord(team) {
  if (!team) return null;
  return `${Number(team.confWins) || 0}-${Number(team.confLosses) || 0}`;
}

function streakText(team) {
  const n = Number(team?.streak);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? `W${n}` : `L${Math.abs(n)}`;
}

function perGame(total, games) {
  if (!Number.isFinite(Number(total)) || !games) return null;
  return Math.round((Number(total) / games) * 10) / 10;
}

function seasonSummary(team) {
  const s = team?.seasonTotals;
  if (!s) return null;
  const games = Math.max(1, Number(s.games) || 1);
  return {
    games,
    offYards: s.offYards, passYards: s.passYards, rushYards: s.rushYards, firstDowns: s.firstDowns,
    penalties: s.penalties, penaltyYards: s.penaltyYards, turnovers: s.turnovers, takeaways: s.takeaways, sacks: s.sacks,
    thirdDownPct: s.thirdDowns ? Math.round((Number(s.thirdDownConv) || 0) / s.thirdDowns * 100) : null,
    offYpg: perGame(s.offYards, games), passYpg: perGame(s.passYards, games), rushYpg: perGame(s.rushYards, games),
    defYpg: perGame((Number(s.defPassYards) || 0) + (Number(s.defRushYards) || 0), games),
    possessionAvg: s.possessionTime ? Math.round(s.possessionTime / games) : null,
  };
}

function leaderLine(kind, line) {
  if (!line) return null;
  const who = line.shortName || line.name;
  // Before the first game of a season the only line is last season's: say so.
  const suffix = line.isCurrentSeason === false ? ' (last season)' : '';
  if (kind === 'qb') return `${who} ${line.passComp ?? 0}/${line.passAtt ?? 0}, ${line.passYards ?? 0} YDS, ${line.passTds ?? 0} TD${line.passInts ? `, ${line.passInts} INT` : ''}${suffix}`;
  if (kind === 'rb') return `${who} ${line.rushAtt ?? 0} CAR, ${line.rushYards ?? 0} YDS, ${line.rushTds ?? 0} TD${suffix}`;
  return `${who} ${line.receptions ?? 0} REC, ${line.recYards ?? 0} YDS, ${line.recTds ?? 0} TD${suffix}`;
}

function pollRank(team) {
  // The CFP poll exists only late in the year (0 = not published); the media
  // poll is the everyday "#7" the broadcast shows.
  const cfp = Number(team?.cfpRank);
  if (Number.isInteger(cfp) && cfp >= 1 && cfp <= 25) return cfp;
  const media = Number(team?.mediaRank);
  if (Number.isInteger(media) && media >= 1 && media <= 25) return media;
  return null;
}

// The user's game this week, if the save marks it.
function userGame(context) {
  if (!context?.gamesThisWeek) return null;
  if (context.userGameIndex === null || context.userGameIndex === undefined) return null;
  return context.gamesThisWeek.find((g) => g.index === context.userGameIndex) || null;
}

// Backup team names from the save when the reader has none (or only
// placeholders). Runs BEFORE asset/logo/color resolution so the filled name
// gets its logo and colours like a read one. Orientation comes from the
// save's home/away. If the reader has ONE real name, the other side comes
// from the same game; if the reader has neither, both come from the user's
// game this week. Never overrides a real reader name.
function applyDynastyNameFallback(payload, dynasty, resolver) {
  if (!payload || !dynasty?.context || !resolver) return payload;
  const context = dynasty.context;
  const resolvable = (name) => {
    try { return Boolean(resolver.resolve(name) || resolver.resolveIdentity?.(name)?.asset); } catch { return false; }
  };
  // A side is "real" when the reader produced a name that names a known team
  // (roster, custom, or a team of this save). Anything else - pending,
  // placeholder, or a string no team owns - is filled from the save.
  const isReal = (side) => {
    const name = payload[side]?.name;
    const source = String(payload[side]?.nameSource || '');
    return Boolean(name) && !/pending|placeholder|dynasty/i.test(source) && resolvable(name);
  };
  const byIndex = new Map((context.teams || []).map((t) => [t.index, t]));
  const canonical = (team) => {
    if (!team) return null;
    const asset = resolveSaveTeam(team, resolver);
    return asset?.name || team.name || null;
  };
  let game = null;
  let flipped = false;
  const realSides = ['away', 'home'].filter(isReal);
  if (realSides.length === 2) return payload;
  if (realSides.length === 1) {
    // Find this week's game containing the known team.
    const known = realSides[0];
    let knownAsset = null;
    try { knownAsset = resolver.resolve(payload[known].name) || resolver.resolveIdentity?.(payload[known].name)?.asset || null; } catch { knownAsset = null; }
    const saveTeam = knownAsset && dynasty.byAsset instanceof Map ? dynasty.byAsset.get(String(knownAsset.id)) : null;
    if (!saveTeam) return payload;
    game = (context.gamesThisWeek || []).find((g) => g.awayIndex === saveTeam.index || g.homeIndex === saveTeam.index) || null;
    if (!game) return payload;
    const saveSideOfKnown = game.awayIndex === saveTeam.index ? 'away' : 'home';
    flipped = saveSideOfKnown !== known;
  } else {
    game = userGame(context);
    if (!game) return payload;
  }
  const saveAway = byIndex.get(game.awayIndex);
  const saveHome = byIndex.get(game.homeIndex);
  const forSide = { away: flipped ? saveHome : saveAway, home: flipped ? saveAway : saveHome };
  for (const side of ['away', 'home']) {
    if (isReal(side)) continue;
    const name = canonical(forSide[side]);
    if (!name) continue;
    payload[side] ||= {};
    payload[side].name = name;
    payload[side].nameSource = 'dynasty-save';
  }
  payload.meta ||= {};
  payload.meta.dynastyNameFallback = { gameIndex: game.index, flipped };
  return payload;
}

// Layer the save context onto a published scoreboard payload. Only fills
// what the reader left empty (record, rank); everything else lands in new
// fields the reader does not own.
function applyDynastyContext(payload, dynasty) {
  if (!payload || !dynasty?.context) return payload;
  const context = dynasty.context;
  const byAsset = dynasty.byAsset instanceof Map ? dynasty.byAsset : new Map();
  const sides = {};
  for (const side of ['away', 'home']) {
    const assetId = payload.meta?.teamAssets?.[side]?.id;
    sides[side] = assetId ? byAsset.get(String(assetId)) || null : null;
  }
  const match = findMatchupGame(context, sides.away, sides.home);
  payload.game ||= {};
  payload.meta ||= {};
  const applied = { season: context.season || null, matched: Boolean(match), teams: {} };

  for (const side of ['away', 'home']) {
    const team = sides[side];
    if (!team) continue;
    payload[side] ||= {};
    const rec = record(team);
    if ((payload[side].record === null || payload[side].record === undefined) && rec) {
      payload[side].record = rec;
      payload[side].recordSource = 'dynasty-save';
    }
    const rank = pollRank(team);
    if ((payload[side].rank === null || payload[side].rank === undefined) && rank) {
      payload[side].rank = rank;
      payload[side].rankSource = 'dynasty-save';
    }
    payload[side].confRecord = confRecord(team);
    payload[side].streak = streakText(team);
    payload[side].offensiveRank = team.offensiveRank ?? null;
    payload[side].defensiveRank = team.defensiveRank ?? null;
    payload[side].season = seasonSummary(team);
    const leaders = dynasty.leaders?.[team.index] || null;
    if (leaders) {
      payload[side].leaders = {
        qb: leaders.qb || null, rb: leaders.rb || null, wr: leaders.wr || null,
        qbLine: leaderLine('qb', leaders.qb), rbLine: leaderLine('rb', leaders.rb), wrLine: leaderLine('wr', leaders.wr),
      };
    }
    applied.teams[side] = { name: team.name, index: team.index };
  }

  const game = match?.game || null;
  const label = weekLabel(context.season, game);
  payload.game.context = {
    source: 'dynasty-save',
    seasonYear: context.season?.seasonYear ?? null,
    week: game?.week ?? context.season?.currentWeek ?? null,
    weekType: game?.weekType || context.season?.currentWeekType || null,
    weekLabel: label,
    matched: Boolean(game),
    bowlName: game?.bowl?.name || null,
    isPlayoff: Boolean(game?.bowl?.isPlayoff),
    isBowl: Boolean(game?.bowl?.name),
    isRematch: Boolean(game?.isRematch),
    gameOfWeek: Boolean(game?.gameOfWeek),
    network: game?.network || null,
    weather: game?.weather || null,
    temperature: game?.temperature ?? null,
    conferenceGame: Boolean(sides.away && sides.home && sides.away.conferenceIndex !== null && sides.away.conferenceIndex === sides.home.conferenceIndex),
    label: game ? label : (label ? `${label}` : ''),
  };
  payload.game.weekLabel = payload.game.context.weekLabel;
  payload.game.bowlName = payload.game.context.bowlName;
  payload.meta.dynasty = applied;
  return payload;
}

module.exports = {
  applyDynastyContext,
  resolveSaveTeam,
  applyDynastyNameFallback,
  userGame,
  confRecord,
  findMatchupGame,
  indexSaveTeams,
  registerUnmatchedSaveTeams,
  leaderLine,
  pollRank,
  record,
  seasonSummary,
  streakText,
  weekLabel,
};
