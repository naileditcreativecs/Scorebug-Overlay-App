# Table-capture session 2026-08-23 (~21:12-21:20Z), Pittsburgh vs California

User on box score screen; all four hunts fired while the screen was open,
numbers read simultaneously from it. Manual tuple hunts dumped each hit's
+-0x480 neighborhood to valuehunt-dumps.jsonl (labels "tuple:MANUAL ...").

| Label | Player | Line at capture |
|---|---|---|
| CalQB (900201) | Saquon Patel (Cal) | 8 comp / 16 att / 118 yds |
| PittQB (900202) | Mason (Pitt, user) | 9 comp / 21 att / 64 yds |
| TurnerRB (900203) | Turner (Pitt) | 10 car / 30 yds / long 9 / 15 YAC / 1 BT |
| MohamedRB (900204) | Mohamed (Cal) | 6 car / 80 yds / 2 TD / long 40 / 69 YAC / 5 BT |

Earlier same evening (prev game, sub-4GB conclusions): per-player totals
persist NOWHERE as plain int16/int32/float32; the box score MATERIALIZES
the table on open (fresh addresses) then freezes it. QB rows carry att
duplicated (+12/+16 int16) and yds tripled (+38/+46/+54) with 3 pointers
just before the record (likely identity/name).

## Decode goals (offline; dev PC can take this)
1. In each labeled dump, find the offset where ALL of that player's known
   numbers cohere -> true field map per position.
2. Cross-player: same-table rows -> record stride; QB vs RB sections.
3. The pointer trio before rows: confirm, and plan a dereference pass
   (next reader build follows them for name strings).
4. Output: shape+layout spec for the on-demand capturer to publish
   game.playerTable.

## First-pass decode notes (2026-08-23 ~21:30Z, gaming-PC session)

- BEWARE ascending-integer ramps: the 0x2D0xxxxx "Turner family" (8 identical
  copies, car@0 yds@+40 lng@-2) is a counting sequence 0,1,2,...,36 — tuple
  hunts match inside ramps trivially. Any analyzer must reject
  a[i+k]==a[i]+k runs FIRST.
- Mohamed row 0x2B4F6A8: car 6@+0, 255@+4, 128@+8, yds 80@+12, 64@+16,
  48@+20, lng 40@+24, then pointer-looking int64s at +32 and +52. The
  255/128/64/48 fields are suspicious (powers of two) — verify against
  another player before trusting this layout.
- PittQB layout family A (0x557D794 = 0x61EAC04 identical): att@+0,
  comp@+14, yds@+60. Family B (0x5F49272/0x61EF192): att@+0, comp@+64,
  yds@±32. Multiple UI contexts coexist.
- NO cross-player rows within ±0x480 of any dump — table sections are
  farther apart. Next capture build should dump ±0x2000 around confirmed
  rows, and dereference the leading pointer trio for name strings.
- Analysis scripts from tonight: ../madden-timeout-2026-08-22/*.js pattern
  (timeline reconstruction) + the inline node passes in session history.

## Dev-PC decode verdict (2026-08-24)

decode-table-dumps.js finds ZERO layouts consistent across both players of
either position, at +-96 AND +-512 bytes. Closer inspection confirms the
v1.4.136 conclusion — every "clean" box-score hit is RENDER data:

- CalQB 0x2BA75A0: att/comp/yds all present, but the row sits next to
  ASCII glyph-markup strings ("i68::i59", "i67::i59", ... at fixed 32-byte
  spacing) — this is the glyph-indexed menu renderer's data, materialized
  on open. Not a persistent stat record.
- MohamedRB 0x2B4F6A8: car 6 / yds 80 / lng 40 cohere as int32s, but the
  interleaved 255/128/64/48 fields are render/tween params (powers of two,
  no relation to his TD/YAC/BT truth values). Same family.
- Both TurnerRB regions are dense small-int noise (coincidence fields).
- PittQB "family A/B" rows never reproduce for CalQB — UI contexts, not a
  shared table.

CONCLUSION: nothing further to decode in this dataset; the box-score menu
is a dead end, exactly as bf33717 decided. The banner pipeline (drift
confirmation -> +-0x2000 confirmed-neighborhood dumps in
stattable-probe.jsonl) is the sole path to game.playerTable. Next live game
with stat banners should produce the first decodable table-neighborhood
capture.
