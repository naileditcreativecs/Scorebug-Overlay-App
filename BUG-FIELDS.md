CFB27 SCOREBUG CENTER — FIELDS YOUR BUG RECEIVES (v1.4.56)
=========================================================

Every bug gets one state object on every change: in `update(obj)` /
`CFB27ScoreboardOverlay.setState(obj)`, in the `cfb27-scoreboard-state`
event's `detail`, and through `data-cfb27-bind="path"` on any element
(the element's text becomes the value at that path — ANY path below works,
e.g. `data-cfb27-bind="away.leaders.qbLine"`). Missing = unknown; the app
never guesses.

TEAMS  (away.* and home.*)
  name, shortName, nickname, rank (1-25 or null), record ("5-2"),
  score, timeouts (0-3), possession (bool), color (#hex), logo (data URL)
  presentationId              stable ScoreHud/save team id (RAM)
  isTeamBuilder               true/false from the live ScoreHud team object
  recordSource / rankSource   "ram" normally; "dynasty-save" when the save
                              filled it in before the reader confirmed it
  confRecord                  "3-1"                       (dynasty save)
  streak                      "W4" / "L2" / null           (dynasty save)
  offensiveRank, defensiveRank  national ranks             (dynasty save)
  season                      { games, offYards, passYards, rushYards,
                                firstDowns, penalties, penaltyYards,
                                turnovers, takeaways, sacks, thirdDownPct,
                                offYpg, passYpg, rushYpg, defYpg,
                                possessionAvg }            (dynasty save)
  leaders                     { qb, rb, wr } objects with name, shortName,
                              jersey, passComp/passAtt/passYards/passTds/
                              passInts, rushAtt/rushYards/rushTds,
                              receptions/recYards/recTds, games
                              + ready strings qbLine / rbLine / wrLine
                              e.g. "J. Johnson 19/28, 256 YDS, 3 TD"

GAME  (game.*)
  quarter, quarterText, clock, clockSeconds, playClock, down, distance,
  downDistance ("3rd & 7"), downDistanceKind
  flag            true while the game's FLAG banner is up
  penaltyFlag     'away' | 'home' | 'flag'  (who the banner points at)
  penalty         { type, code, side, team, text, readAt }  ~10 s after the
                  banner, held ~45 s. type "Encroachment"/"Delay of Game"...,
                  side 'offense'|'defense', team 'away'|'home' (from
                  possession) or null, text "ENCROACHMENT - DEFENSE"
  penaltyType, penaltySide, penaltyTeam, penaltyText   (flat copies)
  playCallOpen    true while the play-call menu is open (experimental)
  hudTexts        [ { kind, texts[], teamSide, playerId, displayTime } ]
                  the game's own stat lower-thirds while they are on screen,
                  e.g. texts ["T.Dixon 4 Rec, 60 Yds, 1 TD"]; teamSide
                  'away'|'home'|null. Experimental: raw text, layout not
                  decoded yet. Empty array when nothing is up.
  context         { source, seasonYear, week, weekType, weekLabel,
                    matched, bowlName, isPlayoff, isBowl, isRematch,
                    gameOfWeek, network, weather, temperature,
                    conferenceGame, label }   (dynasty save; matched=false
                    means the live teams were not found in this week's
                    schedule - week/season still fill from the save)
  weekLabel       "Week 12" / "Rose Bowl" / "National Championship"
  bowlName        bowl name or null

META  (meta.*)
  teamAssets                  per-side resolved asset; includes id, source,
                              presentationId and isTeamBuilder
  dynastyTeamAssets           exact per-side Dynasty id hints when both live
                              PresentationIds match this week's save schedule
  ramTeamIdentity             score-guarded away/home PresentationIds and
                              TeamBuilder flags (source "ram-scorehud"); the
                              app schedule-corrects their sides when proven
  dynastySideCorrection      present when the selected save proved the two
                              live team objects arrived on opposite sides;
                              includes gameIndex plus raw/corrected ids
  scorebugColors, teamLogoLayouts, dynasty { matched, season, teams }

THEME SETTINGS  (themeSettings.*)   see THEME-SETTINGS.md

Where it comes from
  ram   the game's memory (read-only)         - scores, clock, downs, teams,
        ranks/records after the first score, flag, penalty, play-call state
  save  the newest DYNASTY save file          - records/ranks from kickoff,
        week/bowl/playoff, network/weather, season stats, leaders
  Only Dynasty games have a save; Play Now / RTG get the RAM fields alone.

Team names in Dynasty
  Every team in the loaded save gets an identity: roster teams by name
  (game spellings like "NIU", "App St.", "Miami (OH)" are mapped exactly,
  never by look-alike), and any school the roster does not have (FCS East /
  Midwest / Northwest / Southeast / West, TeamBuilder or mod schools) is
  created from the save itself - name, nickname, abbreviation and the
  save's colours (no logo is invented). The reader publishes each live
  ScoreHud PresentationId and TeamBuilder flag as an atomic, score-guarded
  pair. The app joins both ids to the selected save only when they are unique
  and form a game in this week's schedule, so duplicate names and TeamBuilder
  teams named after a real school remain separate. When that proof succeeds,
  the matched save name is authoritative for each non-manual side (even over a
  conflicting readable name) and uses nameSource "dynasty-save". Older readers
  retain the legacy fallback, which fills only missing/not-real names from a
  known team or the user's scheduled game.

  Texas A&M is canonicalized from Texas A&M, Texas A and M, Texas A M,
  Texas AM, TAMU and A&M. These exact aliases prevent TAMU from falling
  through to a different short-name match such as FAU.

  If both unique live ids match this week's game but arrive home/away reversed
  (seen at playoff/neutral-site kickoffs), the save schedule corrects the full
  team package before publication: identity, name, rank, record, timeouts,
  possession and team-attributed HUD/penalty fields. Core scores and the game
  clock never move. A stale save, ambiguous id or TeamBuilder-flag mismatch
  cannot trigger this correction.

  Manual team overrides are side-scoped. A manually selected team is never
  used as matchup evidence for filling the opposite side, so overriding away
  cannot replace home with that selected team's scheduled opponent (and vice
  versa). The untouched side continues to follow the live/current matchup.
  Ctrl+Alt+O choices are the final publication layer: a selected team replaces
  both name and shortName, and a selected #1-#25 or Unranked value is reapplied
  after every RAM/Dynasty update. Their nameSource/rankSource is
  "manual-override". Auto returns only that chosen field to the reader.

  TeamBuilder logo URL metadata is retained from the save but is not fetched
  yet; a real TeamBuilder save sample is needed to verify URL lifetime,
  authentication and image format before automatic logo caching is safe.
  A uniquely matching logo manually added in Custom Teams takes precedence
  automatically. If two save teams share the same name, neither is assigned
  that one custom asset by row order; choose it manually for a side instead.
  Diagnostics > Dynasty shows "N/N teams identified".
