COLLEGE FOOTBALL 27 - READ-ONLY RAM DIAGNOSTIC
================================================

This tool asks Windows for read-only access to CollegeFB27.exe. It contains no
memory-writing, code-injection, patching, freezing, or anti-cheat bypass code.

WHAT IT DOES

1. Reads the proven scoreboard app's live-scoreboard.json as the answer key.
2. Searches readable private RAM for the selected 32-bit integer value.
3. Lets you narrow candidates after the in-game value changes.
4. Saves candidate addresses and module-relative offsets to JSON reports.

FIRST TEST: GAME CLOCK

1. Start College Football 27 in an offline exhibition game.
2. Start "A test for this.exe" and let it read the scorebug.
3. Pause the game with the scorebug visible.
4. Open "CollegeFB27 RAM Diagnostic.exe" and confirm both green/live lines.
5. Select "Game clock (total seconds)" and click First scan.
6. Resume the game for several seconds, then pause again.
7. Click "Next: live value". Repeat until fewer than 100 candidates remain.
8. Click Save candidates.

MANUAL VALUE FOR ONE SCAN

If the reader value is wrong, enter a correction in the Manual box and click
Use once. Clock fields accept M:SS only, such as 4:51. Numeric fields accept the
range displayed beside the box, and possession accepts away or home.

The Expected label changes to MANUAL and the value is used by the next First
scan or Next exact scan only. The diagnostic then returns to LIVE automatically.
Changed, Unchanged, Increased, and Decreased do not consume an armed manual
value. Tolerance remains under your control; use 1 when the manual clock is
known to be within one second of the RAM representation.

For score, timeouts, quarter, and possession, perform a First scan before the
value changes and a Next scan after it changes. A single gameplay session can
diagnose several fields, but each field needs enough real changes to distinguish
it from unrelated values in RAM.

Manual-scan addresses are still candidates, but the confirmed live fields now
have automatic read-only signatures. When CollegeFB27.exe restarts, the app
relocates the scoreboard block, timeout copies, RAM team catalog, and active-team
buffers before it resumes exporting.

Keep the diagnostic open when restarting the game. It checks for a replacement
CollegeFB27.exe process every two seconds and reattaches read-only automatically.

CONSOLIDATED LIVE EXPORT

The diagnostic automatically writes:

  win-unpacked\UserData\data-export\live-game-data.json

Confirmed RAM fields in this file are away/home team names, score, quarter,
game clock, play clock, down, distance, possession, and away/home timeouts.
Team-name buffers populate during matchup loading and may later clear, so the
diagnostic polls the discovered display/key buffers ten times per second,
decodes internal keys through the game's RAM catalog, and retains the last name
captured directly from game RAM. The JSON
records whether a name is currently visible in RAM or is the cached RAM value.
It also keeps the raw screen-reader snapshot for comparison only.

The away-team tracker also scans the focused in-game traditions asset pool every
half second. A path such as content/traditions/teams/texas/... resolves to Texas
through the same RAM team catalog. This is used when the temporary away display
buffer has already cleared.

The timeout reader automatically relocates two synchronized RAM copies and
reports how many agree. The current ram-live-profile.json stores no old-process
heap addresses. On each game launch, a self-referencing scoreboard fingerprint
and read-only byte signatures find the current structures. The combined JSON's
discovery section records the locator result and candidate count.
