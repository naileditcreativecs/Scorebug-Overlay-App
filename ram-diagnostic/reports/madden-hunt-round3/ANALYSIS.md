# Madden hunt round 3 (first in-app research zip) - analysis (2026-08-19)

Session: away 7, home 0; two research rounds fired ~2 min apart.

## Team table FOUND (names path)
The nickname scan mapped a fixed-stride team table:
- All 32 nicknames present once in region 0x44E0000-0x44E2000
- Stride exactly 0xD4, alphabetical by nickname:
  Bears 0x44E047C, Bengals 0x44E0550, Bills 0x44E0624, Broncos 0x44E06F8,
  Browns 0x44E07CC, Buccaneers 0x44E08A0, Cardinals 0x44E0974, ...
- Record content: asset key (lowercase, e.g. "cardinals"), display
  ("Cardinals (Closed)"), stadium ("State Farm Stadium") - it is a
  stadium/venue table, one row per team. Anchor for scanning: "Bears" with
  "Bengals" at +0xD4 and "Bills" at +0x1A8.
- Other clusters: 0x22Bxxxxx = Jumbotron UI asset paths
  (content/ui/Jumbotron/TeamItems/<Nick>/...), 0x680DExxx and 0xCEF05Bxx =
  packed alphabetical uppercase string lists (commentary/audio keys).
- Still missing: the scorebug-facing catalog that maps TeamId -> display
  name (CFB27's equivalent had short key + display name). Round 4 scans
  city names ("Arizona"...) to find it.

## Team objects NOT found - and why (fixed)
The home side was 0 and a zero score matches half of memory: 300k+
coincidence counts per key crowded every real away(7) hit out of the
kept top-N (away entries in kept set: ZERO). Fix shipped: a side must
have score > 0 to count; top-N raised to 200.

## Next round needs
Same tester routine on v1.4.68+: play past a score (both teams scoring is
ideal), 10+ minutes, Export test package.
