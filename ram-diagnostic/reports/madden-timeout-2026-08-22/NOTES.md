# Madden timeout tester round — 2026-08-22 (v1.4.114)

First tester package that actually contains `madden-timeout-probe.jsonl`
(177 events, wide ±0x780 "around" snapshots per transition).

## Tester's ground truth

- Timeout #1: Q1, clock **4:39** (279s) — wall time ~23:36:57–23:37:35 UTC
- Timeout #2: Q1, clock **1:12** (72s) — wall time ~23:38:58 (final event in file)
- WHO called each timeout: **NOT recorded** — asked tester as follow-up.
- Also noted: down & distance didn't read for the first two drives, then
  started working (separate issue, likely rebase warm-up on Madden).

## First-pass read of the events

- Watched slot pairs come mirrored 0x190 apart (e.g. 0x3B0/0x540,
  0x3D8/0x568, 0x3E0/0x570, 0x378/0x508, 0x3C0/0x550, 0x350/0x4E0).
- HEAVY NOISE: several pairs (0x3B0/0x540, 0x3E0/0x570) cycle 3→2→1→0 at
  one-per-game-second cadence — they track clock digits, not timeouts.
  There is also a frozen-clock (5:57) pre-period full of cascades
  (menus/replay); treat everything before ~23:34 as suspect.
- Known all-calls trio 0x4A0/0x4B8 (+0x310/0x328/0x6E0) fired 3→2 exactly
  once at 23:38:18 (clock field was racing/stale: 184).
- 0x350/0x358/0x4E0/0x4E8 dropped 3→2 (23:38:19) then 2→1 (23:38:36) —
  two clean drops, no cascade. Candidate timeouts-remaining, but clock
  fields at those moments read 149/111, not the noted 279/72 (stale reads
  during runoff?).
- During the real 4:39 break: 0x3D8/0x568 dropped 3→2 (23:37:09).
- The file's FINAL event at exactly 1:12: 0x3B0/0x540 3→2 — but that pair
  is clock-noisy, so weigh accordingly.
- Timeout #1 and #2 candidates being DIFFERENT pairs would fit each team
  calling one — unconfirmed until tester says who called which.

## Next steps

1. Get attribution from tester (who called #1 / #2), even from memory.
2. Offline: diff the "around" snapshots across the two timeout windows;
   find bytes that decrement exactly once per timeout and stay. Filter out
   anything that moved during clock-running periods (clock-digit noise).
3. `madden-hunt.jsonl` from the same session is included for cross-ref.
