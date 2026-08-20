# Madden capture round 7 (v1.4.74, 12 rounds) - the breakthrough

## Names already work
live-game-data.json: away "Colts" / home "Ravens", BOTH nameSource "ram".
The generic team-name path reads Madden already. discovery says
rankBind "only 0 ScoreHud team objects found", timeoutBind
"clone-contexts-unsafe", timeoutHud "HUD team objects not bound" - so
timeouts/records are the only gap, and CFB27's team-object route is NOT
the way to them in Madden (those objects do not exist there).

## The ticker object: 0xCAE8DC4 (records + per-team stat lines)
An instance at 0x2CF193C8 carried, as pointer strings:
  +8 '(0-0)'          record
  +24 'Tennessee'     (other ticker entry)
  +144 '2ND 6:17'     live period + clock
  +152 'CLE'          abbreviation
  +160 'CLE:    S.Sanders 3-8, 31 Yds [3 Rush - 28 Pass]'   team stat line
  +168 '(0-0)'        record
  +176 'AFC'          conference
  +184 'Week 1'       week
  +192 'JAX'          abbreviation
  +200 'Cleveland'    city
  +208 'JAX:    T.Lawrence 4-7, 34 Yds [8 Rush - 26 Pass]'
  +224 '(0-0)'        record
  +240 'Jacksonville' city
A second instance 16 bytes earlier holds the same list shifted - the
strings are a contiguous pointer array, so the layout is
[record, city/abbr, statline] repeating, not fixed field offsets.

=> RECORDS are available here ("(0-0)" per team), and Madden's own
per-team drive/stat summary lines come free with them. The entries seen
are ticker entries for OTHER games plus the live one (clock matched
2ND 6:17 while the live game was Q2) - binding must match the entry
whose abbreviations equal the live teams.

## Timeouts
Still unlocated. Not in the ScoreHud team objects (they do not exist in
Madden). Next probe: value-tracking - watch for a 3->2 transition at the
moment a timeout is burned (the reader now records quarter/clock every
round, so the tester burning timeouts gives the timestamps to search).
