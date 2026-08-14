CFB27 GAME READER — standalone
================================

What this is
------------
The memory reader from the CFB27 Scoreboard Overlay, packaged alone. It
attaches READ-ONLY to a running College Football 27 game (process
CollegeFB27.exe) and continuously publishes the full live game state as
JSON files your own app can consume. It never writes to the game's
memory and needs no install, no calibration, and no configuration.

How to run
----------
1. Unzip anywhere.
2. Double-click "Start Game Reader.cmd" (Windows may warn once - the exe
   is not code signed).
3. Start College Football 27 and play. The reader finds the game
   automatically; it needs a few seconds of live, unpaused gameplay
   (the clock must tick) before it publishes - by design, it proves what
   it found before it publishes anything.

Files produced (in the data\ folder)
------------------------------------
live-game-data.json     The full game state. Rewritten ~10x per second
                        while a game is live via atomic replace (you will
                        never read a half-written file). DELETED on
                        purpose during game transitions - treat a missing
                        file or an updatedAt older than ~2 seconds as
                        "no live game right now".

reader-status.json      Always present while the reader runs. Plain-
                        English "message" field says what the reader is
                        doing or why it is waiting. Also carries
                        gameExeVersion/gameModuleSize once attached.

possession-probe.jsonl / ballspot-probe.jsonl
                        Append-only research logs (capped at 5 MB).
                        Ignore them, or send them with bug reports.

ram-live-profile-cache.json
                        The reader's own cache. Ignore.

Reading live-game-data.json
---------------------------
Poll it (100ms is plenty) or use a filesystem watcher on the data folder.
Top-level keys:

  status        "live" - only trust documents with this value.
  updatedAt     ISO timestamp of this publish. Stale = not live.
  process       { name, id, exeVersion, moduleSize, ... } - the game.

  away / home   Per-team, ready to display:
    name          e.g. "Texas A&M"   (nameSource "ram"/"ram-cached" =
                  real; "ram-pending" means not identified yet and name
                  holds a placeholder like "Away")
    rank          1-25 or null (null = unranked or not yet read)
    record        "W-L" or "W-L-T" string, or null
    score         integer
    timeouts      0-3 or null
    possession    true/false or null (null = no clean answer right now,
                  e.g. kickoffs/dead balls - hide your indicator then)
    Each field has a matching *Source key; the value is real when the
    source is "ram".

  game
    quarter / quarterText     1..n / "1st".."4th","OT"
    clockSeconds / clock      seconds / "M:SS"
    playClock                 integer
    down / distance           integers (may be null during specials)
    downDistance              display string: "3rd & 7", "1st & Goal",
                              "4th & Inches", "Kickoff", "Conversion",
                              or "" while a special state resolves
    downDistanceKind          numeric | goal | inches | kickoff |
                              conversion | twoPointConversion |
                              pendingSpecial

  ram.recentMessages
                Raw pass-through of the game's own banner messages -
                flags, touchdown announcements, milestones. Each entry:
                t (ISO time), quarter, clock, awayScore, homeScore,
                messageId, displayText, infoText, playerId, teamId,
                color, displayTime. Newest last, deduplicated, capped at
                12; cleared when the reader attaches to a new game
                process. The text is exactly what the game displays
                (touchdown banners typically name the scorer). Parse or
                ignore as you see fit - nothing here is interpreted.
                The full per-game history of the same entries appends to
                messages-probe.jsonl in the data folder.

  discovery     The reader explaining itself (why a field is not
                reading). Useful verbatim in bug reports.

Rules of thumb
--------------
- Only display a field when its value is non-null; every null is a
  deliberate "I do not know right now" - the reader never guesses.
- The reader is fail-closed: wrong values are treated as worse than
  missing ones everywhere.
- One reader per machine is plenty; multiple instances are harmless
  (all read-only) but pointless.
- 64-bit Windows 10/11. Uses the .NET Framework already in Windows.

Known limitations
-----------------
- Team names for TeamBuilder/custom teams are not read yet.
- Ranks/records appear after the first score of a game (tied 0-0 gives
  the reader no proof of which team is which).
- A game patch can break rank/record/timeout/possession reading until
  the reader is updated; scores/clock/downs survive patches.

Source & updates: https://github.com/naileditcreativecs/Scorebug-Overlay-App
