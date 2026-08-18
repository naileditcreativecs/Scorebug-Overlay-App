CFB27 SCOREBUG CENTER — DATA HUNT TESTS (v1.4.48, round 3)
==========================================================

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
TEST 2 — Live team stats (round 2)     -> stats-search.jsonl (+ stats-probe.jsonl)
------------------------------------------------------------------------
Round 1 proved the box score is NOT near the live game record, so round 2
searches the whole game heap for the numbers you type in:

  1. At halftime (or any stoppage) open the game's STATS screen.
  2. In the app: Diagnostics tab -> "Find the live box score in memory".
     Type the numbers exactly as the screen shows them (left team / right
     team). Blank fields are fine.
  3. Press "Search memory now" and leave the game paused on the stats
     screen for ~30 seconds. Take a photo of the stats screen too.
  4. Do it once at halftime and once at final if you can.

Results append to stats-search.jsonl next to live-game-data.json.

------------------------------------------------------------------------
TEST 3 — Play-call menu detection      -> playcall-probe.jsonl (+ toggle-probe.jsonl)
------------------------------------------------------------------------
Round 1 found a candidate: a byte just below the live game record that
flips when the play picker opens and closes (it matched 4 of 5 noted
moments in the probe game). The reader now publishes it, and
playcall-probe.jsonl logs every flip with the game clock.

Please note 5–10 moments with the game clock: "picker opened", "picker
closed" (snap) — hurry-up / no-huddle plays and DEFENSIVE play calls are
especially useful. If you want to see it in action, tick Settings ->
"Hide the scorebug while a play is being picked (experimental)" and tell
us whether the bug leaves and returns at the right moments.

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
NOTES + SENDING IT (built into the app now)
------------------------------------------------------------------------
Diagnostics tab -> "TEST GAME NOTES": type your flag notes, play-picker
moments, halftime and final stats there as you go (it autosaves). After
the game press "Export test package" - one zip lands on your Desktop with
every probe log, latest-state.json, your notes and the app logs, and the
folder opens. Send that one file (plus your stats-screen photos).

Diagnostics also shows which DYNASTY save the app is reading (newest by
default; pick another from the dropdown if you play from an older file).
