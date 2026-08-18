CFB27 SCOREBUG CENTER — FIELDS YOUR BUG RECEIVES (v1.4.47)
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
  context         { source, seasonYear, week, weekType, weekLabel,
                    matched, bowlName, isPlayoff, isBowl, isRematch,
                    gameOfWeek, network, weather, temperature,
                    conferenceGame, label }   (dynasty save; matched=false
                    means the live teams were not found in this week's
                    schedule - week/season still fill from the save)
  weekLabel       "Week 12" / "Rose Bowl" / "National Championship"
  bowlName        bowl name or null

META  (meta.*)
  teamAssets, scorebugColors, teamLogoLayouts, dynasty { matched, season, teams }

THEME SETTINGS  (themeSettings.*)   see THEME-SETTINGS.md

Where it comes from
  ram   the game's memory (read-only)         - scores, clock, downs, teams,
        ranks/records after the first score, flag, penalty, play-call state
  save  the newest DYNASTY save file          - records/ranks from kickoff,
        week/bowl/playoff, network/weather, season stats, leaders
  Only Dynasty games have a save; Play Now / RTG get the RAM fields alone.
