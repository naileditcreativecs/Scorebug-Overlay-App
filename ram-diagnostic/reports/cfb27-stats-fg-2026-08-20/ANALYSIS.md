# CFB27 stats + FG capture (owner's game, 2026-08-20)

## SOLVED: precise yardage + field-goal distance
Wide block +0xA8 (verification copy +0xD8) is yards-to-go as a FLOAT:
- 236/236 down changes matched, zero mismatches (ballspot-probe).
- The game's bug displays CEIL(float): 6.574->7, 9.531->10, 14.71->15 -
  the entire "1st & 9 vs 10" story.
- "Inches" = float < 1 yard (0.899 -> "4th & inches").
- During FG attempts the slot holds the KICK DISTANCE (55.301, 60.078, 65
  for the three attempts this game).
Shipped in v1.4.77: distance = ceil(float) when copies agree; inches
resolved from the float without needing the HUD object; new bug fields
game.distancePrecise and game.fieldGoalDistance (published only while the
game's FIELD GOAL presentation is up).

## Player names on stat banners: present, needs one more pass
Identity objects (0xB0F31A8) carried real names ("C.Harrell", "Binns",
"Gill Jr.", roster token "AbdoulayeSyPape_6133") at VARYING string-slot
offsets, plus stray "1st & Goal"/"3rd & inches" strings - pooled objects
with reused slots. The 0xB0F3148 stat-line objects held stale pointers at
capture time (fast scan caught them between rebuilds). Name-to-stat
binding needs the identity object's live/current discriminator (probably
the same header-flag discipline the message objects use) - next pass.
