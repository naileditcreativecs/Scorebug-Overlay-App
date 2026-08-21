# Per-player game-stat table — FOUND (2026-08-21, postgame scan)

Ground truth: user read the postgame box score aloud (Pitt @ Cal dynasty
game). Scans ran against the live postgame process (pid 138484).

## The find

Per-player game stats are stored as **int16 fields in fixed-layout
records** in a low-address region, with a synchronized mirror copy:

- **Primary region: ~0x40Axxxx** (e.g. QB record at 0x40A28CC,
  RB record at 0x40A2E48, WR record at 0x40A7D20)
- **Mirror region: ~0x477xxxx** (same records, same layouts, e.g.
  0x4779288 mirrors the RB record; QB mirror at 0x4777D1C)

Verified against the spoken box score:
- QB (Hainchul 7/13, 86 yds): record at 0x40A28CC —
  completions@+0, attempts@+12 (copy @+16), yards@+38/+46/+54 (three
  copies). Four hits with identical layout across the region
  (two QBs x two buffers).
- RB (Turner 11 car, 26 yds, long 12): 0x40A2E48 — carries@+0,
  long@+6, yards@+12. Same field grid as the QB record family.
- WR (Yates 2 rec, 41 yds): 0x40A7D20 (+24 spacing — receiving
  layout differs slightly, needs one more mapping pass).
- A second QB-like record sits +272 bytes after the first
  (record stride candidate ~0x110).

## Next steps (wire it)

1. Locate the region at runtime by pattern (record grid of small
   int16s; or anchor via a known player's live stats from a banner).
2. Map record boundaries + which field is the player id / name link
   (identity tokens carry ids like 25350; find the id field in or
   near each record).
3. Confirm the records update LIVE during play (this scan was
   postgame; the low static-ish address is promising for stability).
4. Reader: parse all records each cycle, publish as
   game.playerTable (per-player QB/WR/RB stats, always current) —
   fail-closed: only publish records whose fields parse sane and
   whose id maps to a roster identity.

## Tooling used

External PowerShell P/Invoke scans (BoxScan/BoxScan2/Dump16 inline
C#), int16+int32 tuple search with neighbor windows. The in-reader
HuntStatTuples (v1.4.114) searched int32-only — that is why in-game
hunts found only UI copies; the real table is int16. Fix the reader
hunt to int16 OR skip hunting entirely and anchor the region directly.
