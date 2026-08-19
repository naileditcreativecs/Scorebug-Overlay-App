# Madden 27 probe round 2 - analysis (2026-08-19)

Seed: Browns at Saints, paused Q1 5:56, still 0-0, 3/3 timeouts (from a
tester on the previous kit build; names were provided this time).

Findings:
- Team-object hunt: 16,848 histogram entries - swamped by score=0 /
  timeouts=3 coincidences as predicted; unusable until a run with a real
  score. (Kit output now trims to the top 300 and the README demands a
  non-zero score + a used timeout.)
- NAME HITS - the important result: "Browns" at 0x44E07CC/0x44E0800/
  0x44EAE2C/0x44EAEB4/0x44EAF3C (0x88 spacing for three of them) and
  "Saints" at 0x44E1A04/0x44E3DA0 - BOTH teams' names in one low region
  (0x44Exxxx). This looks like Madden's team catalog / team DB, the analogue
  of the CFB27 catalog that provides names. Mixed-case hits elsewhere
  (0xF295Cxx cluster for "Saints") may be the live presentation strings.
- Tradition slugs found again ('saints'); role labels home=1 away=1 exist;
  labeled-vector role binding still unvalidated.
- Round 3 kit (same link) adds nameContexts: a 0x180-byte dump around every
  name hit, so the record stride and key fields can be read directly, plus
  the trimmed histogram. One run at a non-zero score should be enough to
  design the Madden name+timeout binding.
