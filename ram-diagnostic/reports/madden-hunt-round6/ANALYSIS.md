# Madden hunt round 6 - analysis (2026-08-20)

Session: 6 rounds, 0-7 -> 18-21 (Cowboys home, per gear strings).

- Match-time dumps worked mechanically, but 0xA9CD6B0 hogged all 24 slots.
  Its strings expose it as PLAYER GEAR/PROPERTY objects
  ("U_Helmet_Cowboys_2010_sil", "FergusonJake_22094", facemask/wrist gear,
  physics keys) - a decoy; removed from the dump set.
- The score-tracking pair 0xE88ACD8 / 0xAB58298 got zero dump slots
  (gear objects occur at lower addresses). v1.4.71 dumps ONLY the pair,
  capped 12 per type.
