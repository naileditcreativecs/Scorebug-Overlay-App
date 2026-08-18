'use strict';

// Pure helpers that turn a dynasty-save context (from dynasty-context-worker)
// into scorebug fields. Nothing here reads files or memory.

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Map save teams to bundled asset ids using the resolver (exact name / alias
// first, then name + nickname, then the resolver's identity match). Returns
// Map<assetId, saveTeam>.
function indexSaveTeams(context, resolver) {
  const byAsset = new Map();
  if (!context?.teams || !resolver) return byAsset;
  for (const team of context.teams) {
    let asset = null;
    try { asset = resolver.resolve(team.name); } catch { asset = null; }
    if (!asset && team.nickname) {
      try { asset = resolver.resolve(`${team.name} ${team.nickname}`); } catch { asset = null; }
    }
    if (!asset) {
      try { asset = resolver.resolveIdentity?.(team.name)?.asset || null; } catch { asset = null; }
    }
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
  if (kind === 'qb') return `${who} ${line.passComp ?? 0}/${line.passAtt ?? 0}, ${line.passYards ?? 0} YDS, ${line.passTds ?? 0} TD${line.passInts ? `, ${line.passInts} INT` : ''}`;
  if (kind === 'rb') return `${who} ${line.rushAtt ?? 0} CAR, ${line.rushYards ?? 0} YDS, ${line.rushTds ?? 0} TD`;
  return `${who} ${line.receptions ?? 0} REC, ${line.recYards ?? 0} YDS, ${line.recTds ?? 0} TD`;
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
  confRecord,
  findMatchupGame,
  indexSaveTeams,
  leaderLine,
  pollRank,
  record,
  seasonSummary,
  streakText,
  weekLabel,
};
