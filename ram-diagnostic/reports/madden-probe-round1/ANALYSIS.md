# Madden 27 probe round 1 - analysis (2026-08-19)

Seed: paused Q1 0:56, 0-0, 1st & 10, play clock 24, 3/3 timeouts (worst case
for value matching - almost everything in memory is zero).

Findings:
- Memory access clean: 2814 private regions, 11.5 GB readable, sample read ok.
- One-shot --locate could not pick a scoreboard block (1768 zero-ish
  candidates, no live change observable while paused). The APP's continuous
  locator DOES bind in Madden per the tester's live report (scores/clock/
  downs read) - consistent: it proves candidates by watching them change.
- BIG: the tradition-slug scan found 'panthers' (Carolina) and the role
  labels exist ("labels home=1 away=1") - the CFB27-style name structures
  ARE present in Madden. The labeled-vector role binding failed validation,
  and the team catalog anchor (AIRFOR/Air Force record 0) is CFB27-specific,
  so names need a Madden catalog anchor + role-binding data.
- liveDistances found one moving distance cell at 0x82488150.

Round 2 (kit updated, --scorehud-hunt): needs a NON-ZERO score and ideally
unequal timeouts; asks for the two team names and hunts team objects + name
strings. That output is what unlocks names, and timeouts follow names.
