CFB27 SCOREBUG CENTER — DATA HUNT TESTS (v1.4.44)
=================================================

These are research probes. They never change what the scorebug shows; they
write extra log files while you play so we can find data the app does not
read yet. Play ONE full game (any mode), then send the files listed at the
end. Where a test asks you to note something, a phone note with the game
clock is perfect ("Q2 6:41 - opened play picker").

All probe files land in the app's data folder:
  <app folder>\UserData\data-export\
(next to live-game-data.json). Each file is capped at 5 MB.

------------------------------------------------------------------------
TEST 1 — Flag details (penalty type + player)      -> penalty-probe.jsonl
------------------------------------------------------------------------
What we know: the FLAG banner is already read, but it carries no type,
team or player. What we are hunting: the object behind the penalty result
card ("Holding - Offense - #72 - 10 yards").

The reader now scans the game's UI heap three times:
  * once about 45 s into live play      (phase "baseline")
  * the instant a FLAG banner appears   (phase "flag")
  * ~25 s later, when the card is gone  (phase "after")
and logs every penalty word it finds plus every object in the ScoreHud
object family. Text or objects present at "flag" but gone at "after" are
the live card.

Please note for EACH flag: game clock, penalty type as the game showed it,
which side (offense/defense), jersey number, accepted/declined. Two or
three flags in a game are plenty; more is better.

------------------------------------------------------------------------
TEST 2 — Live team stats                              -> stats-probe.jsonl
------------------------------------------------------------------------
Hunting the running box score in memory. Every down change the reader
snapshots 512 KB around the live game record and logs the numbers that
ROSE like a stat and never went down all game ("steady" candidates every
8 ticks).

Please note at HALFTIME and at FINAL: both teams' total yards, passing
yards, rushing yards, first downs, penalties (count + yards), time of
possession, 3rd-down conversions — straight from the game's stats screen.
A photo of the stats screen is ideal.

------------------------------------------------------------------------
TEST 3 — Play-call menu detection      -> toggle-probe.jsonl (+ hudstate-probe.jsonl)
------------------------------------------------------------------------
Hunting the flag that flips when the play picker opens/closes so the bug
can slide out and back at the right time. Every 250 ms the reader logs
tiny-value byte flips within +-8 KB of the game record; the round-2
hud-state probe sweeps the game record's own block.

Please note 5–10 moments with the game clock: "picker opened", "picker
closed" (snap). Hurry-up / no-huddle plays are especially useful — note
those too.

------------------------------------------------------------------------
TEST 4 — Dynasty save context, season stats, player stats -> dynasty-probe.json
------------------------------------------------------------------------
This one reads your DYNASTY save file, not the game. It proves we can show
records, ranks, bowl/playoff stakes, season and per-game team stats, and
player season/game lines BEFORE kickoff.

  1. Unzip CFB27-Dynasty-Probe.zip anywhere (needs Node.js installed:
     https://nodejs.org — LTS is fine).
  2. Double-click "Run Dynasty Probe.cmd". It picks your newest DYNASTY
     save (or drag a save file onto the .cmd) and writes
     dynasty-probe.json next to it. Add your team name if it asks
     ("--team Pitt").
  3. Send dynasty-probe.json and tell us: is the "userGameThisWeek" your
     real next game? Are the ranks/records right? Do the player lines
     match what the game shows?

It is read-only — the save is never modified. Play Now / RTG games have no
save to read; this is Dynasty only.

------------------------------------------------------------------------
WHAT TO SEND (zip the whole data-export folder if easier)
------------------------------------------------------------------------
  penalty-probe.jsonl      (test 1)
  stats-probe.jsonl        (test 2)
  toggle-probe.jsonl       (test 3)
  hudstate-probe.jsonl     (test 3, round 2)
  messages-probe.jsonl     (banner stream - always useful)
  dynasty-probe.json       (test 4)
  + your notes / photos with game-clock times

Discord or the usual channel. Thank you — every one of these turns a
"maybe" in the roadmap into a shipped feature.
