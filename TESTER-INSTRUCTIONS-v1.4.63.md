CFB27 SCOREBUG CENTER v1.4.63 — TESTER INSTRUCTIONS
===================================================

Download (new build, old links still work if you need to roll back):
https://github.com/naileditcreativecs/Scorebug-Overlay-App/releases/download/v1.4.63/CFB27-Scoreboard-Overlay-v1.4.63.zip

SETUP
1. Unzip anywhere (fresh folder is fine - your settings carry over only if
   you unzip over your old folder; either way works).
2. Run "A test for this.exe". First run shows a welcome popup and a
   "Pick your favorite team" screen.
3. Start College Football 27 and get into a game.

WHAT'S NEW TO TEST (in game)

A. Timeouts (big one - changed twice)
   - Watch the timeout dashes on the bug all game.
   - Use a timeout: the count should drop within a couple of seconds.
   - It should NEVER blink out and back, and NEVER show a stale count
     after halftime (both teams get 3 back).
   - If a count ever looks wrong or stuck, note the game clock time.

B. "1st & 9" bug
   - Whenever the game's own bug says "1st & 10", ours must too.
   - If you ever see us show 9 (or any number one less than the game),
     note the quarter + clock.

C. 1st & Goal / Inches
   - In goal-to-go and short-yardage moments, check whether we show
     "1st & Goal" / "4th & Inches" like the game, or fall back to a
     number. Note clock time either way - we're collecting data on this.

D. Flag banner
   - When a FLAG is thrown, our flag animation should appear, then
     DISAPPEAR on its own about 5-8 seconds later (when the game's
     banner goes). If it sticks on screen, note the clock time.
   - ~10 s after the flag, the penalty type should appear (bug fields
     penaltyText, e.g. "ENCROACHMENT - DEFENSE"). Note if it's wrong.

E. Nothing should blank mid-game anymore
   - During halftime shows, long replays, menus, and the play-call
     screen, the bug should KEEP the teams/scores (not flip to
     HOME/AWAY, not vanish). Note the time if it ever blanks.

F. Saved bug size + position + crop
   - Ctrl+Alt+O, place and size a bug how you like, then in the app's
     Library tab press "Save profile" on that bug.
   - Resize/move it, switch to another bug (Ctrl+Alt+B) and back:
     it must come back EXACTLY as saved - position, size, and crop.
   - Badge in the Library shows "Profile saved" once pinned.

G. Dynasty names/records (start the app BEFORE or DURING the game,
   either should work)
   - Team names, records, ranks should be right from kickoff, even
     for schools with odd spellings (NIU, App St., Miami (OH)) and
     FCS/TeamBuilder schools.
   - Diagnostics tab should say "143/143 teams identified".

H. Madden 27 (ONLY if you have Madden 27 installed - otherwise skip)
   - Settings > Game > "Madden NFL 27 (experimental)", restart the app.
   - Expected today: the app finds the Madden window, NFL teams appear
     in the Ctrl+Alt+O picker with real colors, franchise saves are
     read if present. The LIVE scoreboard will NOT read yet - that's
     normal, we need your probe data to map it.
   - Play one full quarter with the app open, then export (below).
   - IMPORTANT: switch back to College Football 27 in Settings when done.

WHEN SOMETHING LOOKS WRONG (or after each test game)
1. Open the app's Diagnostics tab.
2. Type what you saw in the Tester Notes boxes (flags, halftime/final
   stats, anything else + clock times).
3. Press "Export test package" - it drops one zip on your Desktop.
4. Send that zip. It contains everything we need (probe logs, state,
   your notes, app logs). No personal files are included.

QUICK REFERENCE
   Ctrl+Alt+O  in-game editor (move/size bugs, teams, colors)
   Ctrl+Alt+B  switch to the next bug in the library
   Diagnostics > New game / Re-read  if the reader ever seems stuck

Rollback: every older version is on the Releases page with unchanged
links if this build gives you trouble:
https://github.com/naileditcreativecs/Scorebug-Overlay-App/releases
