'use strict';
// Runs in an Electron utility process (plain Node context). Reads one CFB27
// dynasty save READ-ONLY and posts a compact context object back to the
// main process: where the season is, this week's games, every team's
// record/ranks/season totals, and (when asked) the offensive leaders of two
// teams. Built on the same madden-franchise library the community tools use.
//
// argv: <savePath> [--teams idx1,idx2]

const fs = require('node:fs');
const Franchise = require('madden-franchise');

const args = process.argv.slice(2);
const savePath = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const teamsArg = (() => { const i = args.indexOf('--teams'); return i >= 0 ? String(args[i + 1] || '') : ''; })();
const leaderTeams = new Set(teamsArg.split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x)));

function post(message) {
  if (process.parentPort) process.parentPort.postMessage(message);
  else process.stdout.write(`${JSON.stringify(message)}\n`);
}

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
  let best = null; let bestRows = 0;
  for (const t of franchise.tables || []) {
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

async function followArray(franchise, ref, limit) {
  const arr = await derefRecord(franchise, ref); if (!arr) return [];
  const rows = [];
  for (const key of Object.keys(arr.record.fields || {})) {
    if (rows.length >= limit) break;
    const hit = await derefRecord(franchise, arr.record[key]);
    if (hit) rows.push({ slot: key, table: hit.table, record: hit.record, values: scalar(hit.record) });
  }
  return rows;
}

function teamName(rec) {
  for (const f of ['DisplayName', 'ShortName', 'Name', 'TeamName', 'LongName']) {
    if (rec?.fields && f in rec.fields) { const v = String(rec[f] ?? '').trim(); if (v) return v; }
  }
  return null;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const optionalNum = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : num(v));
const identityNum = (v) => {
  const number = optionalNum(v);
  return Number.isInteger(number) && number >= 0 && number <= 2047 ? number : null;
};

function safeLogoUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 501) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    // Preserve the source bytes because URL canonicalization can invalidate a
    // signed CDN query. These strings remain private/dormant until validated
    // against a real TeamBuilder save and are never fetched here.
    return text;
  } catch { return null; }
}

function rgbHex(r, g, b) {
  const parts = [r, g, b].map((v) => Number(v));
  if (parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

async function main() {
  if (!savePath || !fs.existsSync(savePath)) throw new Error('save path missing');
  const started = Date.now();
  const franchise = await muted(() => Franchise.create(savePath, { gameTypeOverride: 'college', gameYearOverride: 27, saveOnChange: false, autoUnempty: false }));
  await new Promise((resolve, reject) => { if (franchise.isLoaded) resolve(); else { franchise.on('ready', resolve); franchise.on('error', reject); } });

  const out = { save: savePath, savedAt: fs.statSync(savePath).mtime.toISOString(), readAt: new Date().toISOString(), season: null, teams: [], gamesThisWeek: [], leaders: {} };

  const seasonInfo = await findTable(franchise, ['SeasonInfo'], ['CurrentWeek', 'CurrentSeasonYear']);
  if (seasonInfo) {
    const s = scalar(seasonInfo.records.find((r) => r && !r.isEmpty));
    out.season = {
      currentWeek: num(s.CurrentWeek), currentWeekType: s.CurrentWeekType || null, currentStage: s.CurrentStage || null,
      seasonYear: num(s.CurrentSeasonYear), regularSeasonLastWeek: num(s.RegularSeasonLastWeekScheduled), confChampWeek: num(s.RegularSeasonWeekConferenceChampionship),
    };
  }

  const teamTable = await findTable(franchise, ['Team', 'Teams'], ['ProgramPointBudget', 'RemainingProgramPoints'], 50);
  const teams = [];
  if (teamTable) {
    for (let i = 0; i < teamTable.records.length; i++) {
      const r = teamTable.records[i]; if (!r || r.isEmpty) continue;
      const s = scalar(r);
      const wins = (num(s.HomeWin) || 0) + (num(s.RoadWin) || 0) + (num(s.NeutralWin) || 0);
      const losses = (num(s.HomeLoss) || 0) + (num(s.RoadLoss) || 0) + (num(s.NeutralLoss) || 0);
      const ties = (num(s.HomeTie) || 0) + (num(s.RoadTie) || 0) + (num(s.NeutralTie) || 0);
      const team = {
        index: i, teamIndex: num(s.TeamIndex), name: teamName(r), nickname: String(s.NickName || s.Nickname || '').trim() || null,
        presentationId: identityNum(s.PresentationId), originalId: identityNum(s.TEAM_ORIGID),
        isTeamBuilder: s.IsTeamBuilder === true || s.IsTeamBuilder === 1,
        wins, losses, ties, confWins: num(s.ConfWin) || 0, confLosses: num(s.ConfLoss) || 0,
        mediaRank: num(s.MediaPoll_CurrentRank), coachesRank: num(s.CoachesPoll_CurrentRank), cfpRank: num(s.CFPPoll_CurrentRank),
        mediaRankLastWeek: num(s.MediaPoll_LastWeeksRank), playoffStatus: s.PlayoffStatus || null,
        offensiveRank: num(s.OffensiveRank), defensiveRank: num(s.DefensiveRank), streak: num(s.SeasonWinLossStreak),
        prevWins: num(s.TEAM_PREVSEASWINS), prevLosses: num(s.TEAM_PREVSEASLOSSES),
        // Identity extras so teams the bundled roster does not know (FCS
        // placeholders, TeamBuilder / mod schools) can still be shown by name.
        abbreviation: String(s.ShortName || '').trim() || null,
        assetName: String(s.AssetName || '').trim() || null,
        longName: String(s.LongName || '').trim() || null,
        logoAssetName: String(s.TEAM_LOGO_ASSETNAME || '').trim() || null,
        logoLibraryPath: String(s.TEAM_LOGO_SWAPPABLE_LIBRARY_PATH || '').trim() || null,
        primary: rgbHex(s.TEAM_BACKGROUNDCOLORR, s.TEAM_BACKGROUNDCOLORG, s.TEAM_BACKGROUNDCOLORB),
        secondary: s.TEAM_HAS_SECONDARY_COLOR === false ? null : rgbHex(s.TEAM_BACKGROUNDCOLORR2, s.TEAM_BACKGROUNDCOLORG2, s.TEAM_BACKGROUNDCOLORB2),
        conferenceIndex: decodeRef(r.Conference)?.recordIndex ?? null,
        // The user's team is the one with a UserCharacter reference.
        isUser: Boolean(decodeRef(r.UserCharacter)),
        seasonTotals: null,
        teamBuilderData: null,
      };
      // CFB27 stores a TeamBuilderData reference with the downloaded team's
      // binary and logo URLs. Preserve validated HTTP(S) metadata for future
      // logo caching, but do not fetch or trust it until a real TeamBuilder
      // save fixture has verified lifetime/auth/format behavior.
      if (team.isTeamBuilder) {
        try {
          const hit = await derefRecord(franchise, r.TeamBuilderData);
          const v = hit?.table === 'TeamBuilderData' ? scalar(hit.record) : null;
          if (v) {
            const data = {
              primaryLogoUrl: safeLogoUrl(v.PrimaryLogoURL),
              secondaryLogoUrl: safeLogoUrl(v.SecondaryLogoURL),
              tertiaryLogoUrl: safeLogoUrl(v.TertiaryLogoURL),
            };
            if (Object.values(data).some(Boolean)) team.teamBuilderData = data;
          }
        } catch { /* optional TeamBuilder enrichment */ }
      }
      // Season totals: Team.TeamSeasonStats -> TeamStats rows (one per season); pick
      // the slot whose W-L matches the live record, else the first.
      try {
        const rows = await followArray(franchise, r.TeamSeasonStats, 8);
        const pick = rows.find((x) => Math.abs((num(x.values.WINS) || 0) - wins) <= 1 && Math.abs((num(x.values.LOSSES) || 0) - losses) <= 1) || rows[0];
        if (pick) {
          const v = pick.values;
          const games = Math.max(1, (num(v.WINS) || 0) + (num(v.LOSSES) || 0) + (num(v.TIES) || 0));
          team.seasonTotals = {
            games, offYards: num(v.OFFYARDS), passYards: num(v.OFFPASSYARDS), rushYards: num(v.OFFRUSHYARDS),
            firstDowns: num(v.FIRSTDOWNS), penalties: num(v.PENALTIES), penaltyYards: num(v.PENALTYYARDS),
            possessionTime: num(v.POSSESSIONTIME), thirdDowns: num(v.THIRDDOWNS), thirdDownConv: num(v.THIRDDOWNCONV),
            turnovers: num(v.GIVEAWAYS), takeaways: num(v.TAKEAWAYS), sacks: num(v.SACKS), passTds: num(v.PASSTDS), rushTds: num(v.RUSHTDS),
            defPassYards: num(v.DEFPASSYARDS), defRushYards: num(v.DEFRUSHYARDS),
          };
        }
      } catch { /* totals are optional */ }
      teams.push(team);
    }
  }
  out.teams = teams;
  const byIndex = new Map(teams.map((t) => [t.index, t]));
  out.userTeamIndex = teams.find((t) => t.isUser)?.index ?? null;

  const gameTable = await findTable(franchise, ['SeasonGame'], ['HomeTeam', 'AwayTeam', 'SeasonWeek'], 100);
  const week = out.season?.currentWeek;
  if (gameTable && week !== null && week !== undefined) {
    for (let i = 0; i < gameTable.records.length; i++) {
      const r = gameTable.records[i]; if (!r || r.isEmpty) continue;
      const s = scalar(r);
      if (num(s.SeasonWeek) !== week) continue;
      const home = decodeRef(r.HomeTeam); const away = decodeRef(r.AwayTeam);
      let bowl = null;
      const bowlRef = decodeRef(r.BowlGame);
      if (bowlRef) {
        const b = await derefRecord(franchise, r.BowlGame);
        if (b) { const bs = scalar(b.record); bowl = { name: bs.Name || null, isPlayoff: bs.IsPlayoffBowl === true, bracketSlot: num(bs.PlayoffBracketSlot), trophy: bs.Trophy || null }; }
      }
      out.gamesThisWeek.push({
        index: i, week: num(s.SeasonWeek), weekType: s.SeasonWeekType || null, status: s.GameStatus || null, simmed: s.IsSimmed === true,
        homeIndex: home?.recordIndex ?? null, awayIndex: away?.recordIndex ?? null,
        homeName: byIndex.get(home?.recordIndex)?.name || null, awayName: byIndex.get(away?.recordIndex)?.name || null,
        isRematch: s.IsRematch === true, gameOfWeek: s.IsGameOfTheWeek === true, network: s.BroadcastNetwork || null,
        timeOfDay: num(s.TimeOfDay), weather: s.Weather || null, temperature: num(s.Temperature), quarterMinutes: num(s.QuarterLengthMins),
        bowl,
      });
    }
  }

  // The user's game this week: the user team's game, else the lone
  // unplayed/unsimmed game (every CPU game is simmed when the week advances).
  const userGame = out.gamesThisWeek.find((g) => out.userTeamIndex !== null && (g.homeIndex === out.userTeamIndex || g.awayIndex === out.userTeamIndex))
    || (out.gamesThisWeek.filter((g) => g.status === 'Unplayed' && !g.simmed).length === 1 ? out.gamesThisWeek.find((g) => g.status === 'Unplayed' && !g.simmed) : null)
    || null;
  out.userGameIndex = userGame ? userGame.index : null;

  // Offensive leaders for the requested teams (season lines).
  if (leaderTeams.size) {
    const playerTable = await findTable(franchise, ['Player'], ['FirstName', 'LastName', 'Position'], 1000);
    const wantedTeamIndexes = new Set([...leaderTeams].map((idx) => byIndex.get(idx)?.teamIndex).filter((x) => x !== null && x !== undefined));
    const perTeam = {};
    if (playerTable) {
      for (let i = 0; i < playerTable.records.length; i++) {
        const r = playerTable.records[i]; if (!r || r.isEmpty) continue;
        const s = scalar(r);
        if (!wantedTeamIndexes.has(s.TeamIndex)) continue;
        const pos = String(s.Position || '');
        if (!['QB', 'HB', 'WR', 'TE', 'FB'].includes(pos)) continue;
        let seasons = [];
        try { seasons = await followArray(franchise, r.SeasonStats, 8); } catch { seasons = []; }
        const allOffense = seasons.filter((x) => /Offensive/.test(x.table));
        const offense = allOffense.filter((x) => (num(x.values.GAMESPLAYED) || 0) > 0);
        if (!offense.length) continue;
        const newestSeasonYear = Math.max(...allOffense.map((x) => num(x.values.SEAS_YEAR) || 0));
        offense.sort((a, b) => ((num(b.values.SEAS_YEAR) || 0) - (num(a.values.SEAS_YEAR) || 0)) || ((num(b.values.GAMESPLAYED) || 0) - (num(a.values.GAMESPLAYED) || 0)));
        const v = offense[0].values;
        const line = {
          seasonIndex: num(v.SEAS_YEAR), isCurrentSeason: (num(v.SEAS_YEAR) || 0) >= newestSeasonYear,
          name: `${s.FirstName || ''} ${s.LastName || ''}`.trim(), shortName: `${String(s.FirstName || '').slice(0, 1)}. ${s.LastName || ''}`.trim(),
          jersey: num(s.JerseyNum), position: pos, overall: num(s.OverallRating), games: num(v.GAMESPLAYED),
          passComp: num(v.PASSCOMPLETED), passAtt: num(v.PASSATTEMPTS), passYards: num(v.PASSYARDS), passTds: num(v.PASSTDS), passInts: num(v.PASSINTS),
          rushAtt: num(v.RUSHATTEMPTS), rushYards: num(v.RUSHYARDS), rushTds: num(v.RUSHTDS),
          receptions: num(v.RECEIVECATCHES), recYards: num(v.RECEIVEYARDS), recTds: num(v.RECEIVETDS),
        };
        const bucket = perTeam[s.TeamIndex] ||= { qb: null, rb: null, wr: null };
        if (pos === 'QB' && (line.passYards || 0) > ((bucket.qb?.passYards) || -1)) bucket.qb = line;
        if ((pos === 'HB' || pos === 'FB') && (line.rushYards || 0) > ((bucket.rb?.rushYards) || -1)) bucket.rb = line;
        if ((pos === 'WR' || pos === 'TE') && (line.recYards || 0) > ((bucket.wr?.recYards) || -1)) bucket.wr = line;
      }
    }
    for (const idx of leaderTeams) {
      const t = byIndex.get(idx);
      if (t && perTeam[t.teamIndex]) out.leaders[idx] = perTeam[t.teamIndex];
    }
  }

  out.elapsedMs = Date.now() - started;
  post({ ok: true, context: out });
}

main().catch((error) => { post({ ok: false, error: error.message }); }).finally(() => { setTimeout(() => process.exit(0), 50); });
