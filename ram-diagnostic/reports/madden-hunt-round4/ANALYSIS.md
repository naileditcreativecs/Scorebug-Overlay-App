# Madden hunt round 4 - analysis (2026-08-20)

Session: 6 research rounds, scores 7-7 -> 14-7 -> 14-10 -> 21-10 -> 28-10 -> 35-10.
Perfect data: the away score changed nearly every round.

## Team-object candidates FOUND
Only three (vtable@scoreOffset) keys matched the away score in ALL six
rounds as it climbed 7->35:
- 0xE88ACD8@+36  counts 99,60,60,49,30,26   (score@36 => timeouts@28, wins@44)
- 0xAB58298@+44  counts 99,60,60,49,30,26   (identical counts every round =
  same allocations seen through a second vtable, 8-byte shifted view)
- 0xA9CD6B0@+116 counts 340,71,73,60,55,31  (noisier type, matches at many
  offsets; secondary)
Counts converge to ~26-31 at score 35 (coincidences die off as the value
gets rarer) - those remaining instances are real score-holding objects.
Also interesting: 0xA1105F8/0xA110578/0xA1105E0 group whose counts GROW
with each away score (34->72->105) - per-scoring-event objects.

## Next
v1.4.69 research dumps full 0x140-byte instances of 0xE88ACD8 / 0xAB58298 /
0xA9CD6B0 / 0xAA14580 each round, with any pointed-at strings - that gives
the exact layout (timeouts/wins/teamId/name pointer) to hard-bind names,
timeouts and records.
