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
