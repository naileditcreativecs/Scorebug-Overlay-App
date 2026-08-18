'use strict';
// CFB27 dynasty save probe - questions 3, 4, 5 (season) and 7 of the data
// feasibility report. Opens a dynasty save read-only and writes one JSON with
// everything a scorebug needs before kickoff: week/type/year, this week's
// game for the user's team (opponent, bowl/playoff, rematch, network,
// weather), both teams' polls/records/streaks, both teams' season stat
// totals, and their top players' season lines.
//
// usage: node dynasty-probe.js [savePath] [--team "Pitt"] [--out probe.json]
// With no savePath the newest DYNASTY-* file in the default saves folder is
// used. Read-only: nothing is written to the save.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Franchise = require('madden-franchise');

const args = process.argv.slice(2);
function argValue(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }
const teamFilter = argValue('--team');
const outPath = argValue('--out') || path.join(process.cwd(), 'dynasty-probe.json');
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));

const DEFAULT_SAVES = path.join(os.homedir(), 'OneDrive', 'Documents', 'EA Sports College Football 27', 'saves');
const ALT_SAVES = path.join(os.homedir(), 'Documents', 'EA Sports College Football 27', 'saves');

function newestDynastySave() {
  for (const folder of [DEFAULT_SAVES, ALT_SAVES]) {
    if (!fs.existsSync(folder)) continue;
    const files = fs.readdirSync(folder)
      .filter((f) => /^DYNASTY/i.test(f) && !/\.(bak|tmp)$/i.test(f))
      .map((f) => ({ f, full: path.join(folder, f), m: fs.statSync(path.join(folder, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length) return files[0].full;
  }
  return null;
}

// madden-franchise returns references as 32-bit binary strings:
// 2 bits, 13-bit table id, 17-bit row index.
function decodeRef(ref) {
  if (typeof ref !== 'string' || ref.length !== 32 || !/^[01]{32}$/.test(ref)) return null;
  const tableId = parseInt(ref.slice(2, 15), 2);
  const recordIndex = parseInt(ref.slice(15), 2);
  if (!tableId) return null;
  return { tableId, recordIndex };
}

function muted(fn) {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const quiet = (o) => (...a) => { if (!a.some((x) => String(x ?? '').includes("Schema doesn't exist"))) o(...a); };
  console.log = quiet(orig.log); console.warn = quiet(orig.warn); console.error = quiet(orig.error);
  return Promise.resolve().then(fn).finally(() => { console.log = orig.log; console.warn = orig.warn; console.error = orig.error; });
}

function scalar(record) {
  const out = {};
  for (const name of Object.keys(record?.fields || {})) {
    let v; try { v = record[name]; } catch { continue; }
    if (v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)) out[name] = v ?? null;
  }
  return out;
}

async function readTable(table) { if (!table.recordsRead) await muted(() => table.readRecords()); return table; }

async function findTable(franchise, names, requiredFields, minRows = 1) {
  const has = (r) => r?.fields && requiredFields.every((f) => f in r.fields);
  const count = async (t) => { await readTable(t); let n = 0; for (const r of t.records || []) if (r && !r.isEmpty && has(r)) n++; return n; };
  // CFB27 saves carry single-row decoy tables sharing real names: always
  // take the name match with the MOST qualifying rows.
  const all = franchise.tables || [];
  let best = null; let bestRows = 0;
  for (const t of all) {
    if (!names.includes(t.name)) continue;
    let n = 0; try { n = await count(t); } catch { continue; }
    if (n > bestRows) { best = t; bestRows = n; }
  }
  return bestRows >= minRows ? best : null;
}

function tableById(franchise, id) { return (franchise.tables || []).find((t) => t.header?.tableId === id) || null; }

async function derefRecord(franchise, ref) {
  const d = decodeRef(ref); if (!d) return null;
  const t = tableById(franchise, d.tableId); if (!t) return null;
  await readTable(t);
  const r = t.records?.[d.recordIndex];
  return r && !r.isEmpty ? { table: t.name, index: d.recordIndex, record: r } : null;
}

function teamName(rec) {
  for (const f of ['DisplayName', 'ShortName', 'Name', 'TeamName', 'LongName', 'Abbreviation']) {
    if (rec?.fields && f in rec.fields) { const v = String(rec[f] ?? '').trim(); if (v) return v; }
  }
  return null;
}

async function main() {
  const savePath = positional[0] || newestDynastySave();
  if (!savePath || !fs.existsSync(savePath)) throw new Error('No dynasty save found. Pass the path as the first argument.');
  const started = Date.now();
  const franchise = await muted(() => Franchise.create(savePath, { gameTypeOverride: 'college', gameYearOverride: 27, saveOnChange: false, autoUnempty: false }));
  await new Promise((resolve, reject) => { if (franchise.isLoaded) resolve(); else { franchise.on('ready', resolve); franchise.on('error', reject); } });

  const out = { save: savePath, savedAt: fs.statSync(savePath).mtime.toISOString(), readAt: new Date().toISOString(), tables: {} };

  // 1) SeasonInfo - where in the season we are
  const seasonInfo = await findTable(franchise, ['SeasonInfo'], ['CurrentWeek', 'CurrentSeasonYear']);
  const season = seasonInfo ? scalar(seasonInfo.records.find((r) => r && !r.isEmpty)) : null;
  out.season = season && {
    currentWeek: season.CurrentWeek, currentWeekType: season.CurrentWeekType, currentStage: season.CurrentStage,
    currentSeasonYear: season.CurrentSeasonYear, currentYear: season.CurrentYear,
    regularSeasonLastWeek: season.RegularSeasonLastWeekScheduled, confChampWeek: season.RegularSeasonWeekConferenceChampionship,
    postSeasonWeeks: season.PostSeasonNumWeeks, isPlayoffs: /Bowl|Playoff|Championship/i.test(String(season.CurrentWeekType || '')),
  };
  out.tables.SeasonInfo = Boolean(seasonInfo);

  // 2) Teams - names, polls, records, playoff status
  const teamTable = await findTable(franchise, ['Team', 'Teams'], ['ProgramPointBudget', 'RemainingProgramPoints'], 50);
  out.tables.Team = Boolean(teamTable);
  const teams = [];
  if (teamTable) {
    for (let i = 0; i < teamTable.records.length; i++) {
      const r = teamTable.records[i]; if (!r || r.isEmpty) continue;
      const s = scalar(r);
      teams.push({
        index: i, name: teamName(r), teamIndex: s.TeamIndex,
        wins: (Number(s.HomeWin) || 0) + (Number(s.RoadWin) || 0) + (Number(s.NeutralWin) || 0),
        losses: (Number(s.HomeLoss) || 0) + (Number(s.RoadLoss) || 0) + (Number(s.NeutralLoss) || 0),
        confRecord: `${Number(s.ConfWin) || 0}-${Number(s.ConfLoss) || 0}`,
        mediaRank: s.MediaPoll_CurrentRank, coachesRank: s.CoachesPoll_CurrentRank, cfpRank: s.CFPPoll_CurrentRank,
        mediaRankLastWeek: s.MediaPoll_LastWeeksRank, playoffStatus: s.PlayoffStatus, prestigeRank: s.PrestigeRank,
        offensiveRank: s.OffensiveRank, defensiveRank: s.DefensiveRank, streak: s.SeasonWinLossStreak,
        prevWins: s.TEAM_PREVSEASWINS, prevLosses: s.TEAM_PREVSEASLOSSES, ratingOvr: s.TEAM_RATINGOVR,
        conferenceRef: r.fields?.Conference ? r.Conference : null,
        recordRef: r,
      });
    }
  }
  const teamByIndex = new Map(teams.map((t) => [t.index, t]));
  out.teamCount = teams.length;
  // Record fields are not standard names in every schema: keep the raw keys that mention wins/losses.
  if (teams[0]) {
    const raw = scalar(teams[0].recordRef);
    out.teamRecordFieldNames = Object.keys(raw).filter((k) => /win|loss|tie|rank|streak|poll/i.test(k)).slice(0, 60);
  }

  // 3) SeasonGame - schedule; this week's games
  const gameTable = await findTable(franchise, ['SeasonGame'], ['HomeTeam', 'AwayTeam', 'SeasonWeek']);
  out.tables.SeasonGame = Boolean(gameTable);
  const games = [];
  if (gameTable) {
    for (let i = 0; i < gameTable.records.length; i++) {
      const r = gameTable.records[i]; if (!r || r.isEmpty) continue;
      const s = scalar(r);
      const home = decodeRef(r.HomeTeam); const away = decodeRef(r.AwayTeam);
      games.push({
        index: i, week: s.SeasonWeek, weekType: s.SeasonWeekType, year: s.SeasonYear, status: s.GameStatus,
        homeIndex: home?.recordIndex ?? null, awayIndex: away?.recordIndex ?? null,
        homeScore: s.HomeScore, awayScore: s.AwayScore, isRematch: s.IsRematch, gameOfWeek: s.IsGameOfTheWeek,
        network: s.BroadcastNetwork, timeOfDay: s.TimeOfDay, weather: s.Weather, temperature: s.Temperature,
        quarterMinutes: s.QuarterLengthMins, bowlRef: r.fields?.BowlGame ? r.BowlGame : null, stadiumRef: r.fields?.Stadium ? r.Stadium : null,
        simmed: s.IsSimmed, homeStatus: s.HomeTeamStatus, awayStatus: s.AwayTeamStatus,
      });
    }
  }
  out.gameCount = games.length;
  const week = out.season?.currentWeek;
  const thisWeek = games.filter((g) => week !== undefined && g.week === week);
  out.thisWeekGameCount = thisWeek.length;

  // user team: --team filter, else FranchiseUser -> Team
  let userTeam = null;
  if (teamFilter) userTeam = teams.find((t) => String(t.name || '').toLowerCase().includes(teamFilter.toLowerCase())) || null;
  if (!userTeam) {
    const fu = await findTable(franchise, ['FranchiseUser'], ['Team']);
    if (fu) { const r = fu.records.find((x) => x && !x.isEmpty); const d = r ? decodeRef(r.Team) : null; if (d) userTeam = teamByIndex.get(d.recordIndex) || null; }
  }
  if (!userTeam && thisWeek.length) userTeam = teamByIndex.get(thisWeek[0].awayIndex) || null;
  out.userTeam = userTeam ? { name: userTeam.name, index: userTeam.index, note: teamFilter ? 'from --team' : 'guessed (no --team given): first team of this week' } : null;

  const enrich = async (g) => {
    const homeT = teamByIndex.get(g.homeIndex); const awayT = teamByIndex.get(g.awayIndex);
    let bowl = null;
    if (g.bowlRef) { const b = await derefRecord(franchise, g.bowlRef); if (b) { const s = scalar(b.record); bowl = { name: s.Name, isPlayoffBowl: s.IsPlayoffBowl, bracketSlot: s.PlayoffBracketSlot, trophy: s.Trophy }; } }
    const slim = (t) => t && { name: t.name, wins: t.wins, losses: t.losses, mediaRank: t.mediaRank, coachesRank: t.coachesRank, cfpRank: t.cfpRank, playoffStatus: t.playoffStatus, streak: t.streak, offensiveRank: t.offensiveRank, defensiveRank: t.defensiveRank };
    return { week: g.week, weekType: g.weekType, status: g.status, away: slim(awayT), home: slim(homeT), bowl, isRematch: g.isRematch, gameOfWeek: g.gameOfWeek, network: g.network, timeOfDay: g.timeOfDay, weather: g.weather, temperature: g.temperature, quarterMinutes: g.quarterMinutes, awayScore: g.awayScore, homeScore: g.homeScore };
  };
  const userGame = userTeam ? thisWeek.find((g) => g.homeIndex === userTeam.index || g.awayIndex === userTeam.index) : null;
  out.userGameThisWeek = userGame ? await enrich(userGame) : null;
  out.thisWeekSample = [];
  for (const g of thisWeek.slice(0, 6)) out.thisWeekSample.push(await enrich(g));
  const bowls = games.filter((g) => g.bowlRef && decodeRef(g.bowlRef));
  out.bowlGameCount = bowls.length;
  out.bowlSample = [];
  for (const g of bowls.slice(0, 5)) out.bowlSample.push(await enrich(g));

  // 4) TeamStats season totals for the user's game teams (via Team.GetTeamCurrentSeasonStats / SeasonStatRecords refs)
  const statTargets = userGame ? [teamByIndex.get(userGame.awayIndex), teamByIndex.get(userGame.homeIndex)].filter(Boolean) : teams.slice(0, 2);
  out.teamSeasonStats = [];
  for (const t of statTargets) {
    const rec = t.recordRef; let stats = null; let via = null;
    // Team.TeamSeasonStats -> array of TeamStats rows (one per season);
    // Team.TeamGameStatsRegSeason -> array of TeamStats rows (one per game).
    const followArray = async (ref, limit) => {
      const arr = await derefRecord(franchise, ref); if (!arr) return null;
      const rows = [];
      for (const key of Object.keys(arr.record.fields || {})) {
        if (rows.length >= limit) break;
        const hit = await derefRecord(franchise, arr.record[key]);
        if (hit) rows.push({ slot: key, table: hit.table, ...Object.fromEntries(Object.entries(scalar(hit.record)).filter(([k]) => /^[A-Z0-9_]+$/.test(k))) });
      }
      return { arrayTable: arr.table, rows };
    };
    let seasonRows = null; let gameRows = null;
    if (rec.fields && 'TeamSeasonStats' in rec.fields) seasonRows = await followArray(rec.TeamSeasonStats, 8);
    if (rec.fields && 'TeamGameStatsRegSeason' in rec.fields) gameRows = await followArray(rec.TeamGameStatsRegSeason, 16);
    out.teamSeasonStats.push({ team: t.name, teamSeasonStats: seasonRows, teamGameStatsRegSeason: gameRows });
  }
  // fall back: TeamStats table rows referenced by team? list first row shape
  const teamStatsTable = await findTable(franchise, ['TeamStats'], ['OFFYARDS', 'WINS']);
  out.tables.TeamStats = Boolean(teamStatsTable);
  if (teamStatsTable) {
    const rows = teamStatsTable.records.filter((r) => r && !r.isEmpty);
    out.teamStatsRowCount = rows.length;
    out.teamStatsSample = rows.slice(0, 2).map((r) => scalar(r));
  }

  // 5) Player season stats: Player table -> SeasonStats ref -> SeasonOffensiveStats etc.
  const playerTable = await findTable(franchise, ['Player'], ['FirstName', 'LastName', 'Position'], 1000);
  out.tables.Player = Boolean(playerTable);
  out.playerSeasonStatSamples = [];
  if (playerTable && statTargets.length) {
    const wanted = new Set(statTargets.map((t) => t.index));
    let scanned = 0; let matched = 0;
    for (let i = 0; i < playerTable.records.length && matched < 12 && scanned < 20000; i++) {
      const r = playerTable.records[i]; if (!r || r.isEmpty) continue; scanned++;
      const s = scalar(r);
      const team = statTargets.find((t) => t.teamIndex === s.TeamIndex);
      if (!team) continue;
      if (!['QB', 'HB', 'WR', 'TE'].includes(String(s.Position))) continue;
      // Player.SeasonStats -> SeasonStats[] (one slot per season) -> SeasonOffensiveStats...
      // Player.GameStats -> GameStats[] (recent games) -> GameOffensiveStats (with SeasonGame + OpposingTeam refs)
      const follow = async (ref, limit) => {
        const arr = await derefRecord(franchise, ref); if (!arr) return null;
        const rows = [];
        for (const key of Object.keys(arr.record.fields || {})) {
          if (rows.length >= limit) break;
          const hit = await derefRecord(franchise, arr.record[key]);
          if (!hit) continue;
          const row = { slot: key, table: hit.table, ...Object.fromEntries(Object.entries(scalar(hit.record)).filter(([k]) => /^[A-Z0-9_]+$/.test(k))) };
          const opp = hit.record.fields && 'OpposingTeam' in hit.record.fields ? decodeRef(hit.record.OpposingTeam) : null;
          if (opp) row.opponent = teamByIndex.get(opp.recordIndex)?.name || `team#${opp.recordIndex}`;
          rows.push(row);
        }
        return rows;
      };
      const seasonStats = r.fields && 'SeasonStats' in r.fields ? await follow(r.SeasonStats, 8) : null;
      const gameStats = r.fields && 'GameStats' in r.fields ? await follow(r.GameStats, 6) : null;
      out.playerSeasonStatSamples.push({ name: `${s.FirstName} ${s.LastName}`, position: s.Position, jersey: s.JerseyNum ?? null, overall: s.OverallRating ?? null, team: team.name, seasonStatsBySlot: seasonStats, recentGameStats: gameStats });
      matched++;
    }
    out.playerScanNote = `${scanned} players scanned, ${matched} sampled (QB/HB/WR/TE on the two teams)`;
  }

  // 6) roster lookup proof for question 1: jersey -> name for one team
  if (playerTable && statTargets[0]) {
    const roster = [];
    for (let i = 0; i < playerTable.records.length && roster.length < 8; i++) {
      const r = playerTable.records[i]; if (!r || r.isEmpty) continue;
      const s = scalar(r);
      if (s.TeamIndex !== statTargets[0].teamIndex) continue;
      roster.push({ jersey: s.JerseyNum ?? s.JerseyNumber ?? null, name: `${s.FirstName} ${s.LastName}`, position: s.Position });
    }
    out.rosterLookupSample = { team: statTargets[0].name, players: roster };
  }

  out.elapsedMs = Date.now() - started;
  // do not keep record objects in the output
  for (const t of teams) delete t.recordRef;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ save: path.basename(savePath), season: out.season, userTeam: out.userTeam, userGameThisWeek: out.userGameThisWeek, tables: out.tables, teams: out.teamCount, games: out.gameCount, bowls: out.bowlGameCount, playersSampled: out.playerSeasonStatSamples.length, elapsedMs: out.elapsedMs, out: outPath }, null, 2));
}

main().catch((error) => { console.error('dynasty-probe failed:', error.message); process.exit(1); });
