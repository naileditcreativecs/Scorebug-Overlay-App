# Scorebug Center (CFB27/Madden27 Scoreboard Overlay) — session briefing

This file briefs any Claude Code session opening this repo, ESPECIALLY on
the development PC that does NOT have the game installed. Read it fully
before acting.

## What this is

An Electron app ("Scorebug Center", `source/`) + a read-only C# RAM reader
(`ram-diagnostic/source/`) that reads College Football 27 (and Madden 27)
live game state from memory and feeds scoreboard bugs (HTML themes).
Owner: gabe (naileditcreativecs). Public releases:
github.com/naileditcreativecs/Scorebug-Overlay-App (every change ships as a
tagged release — rollback protection). THIS private repo is the source of
truth for code.

## Two-machine setup (IMPORTANT)

- **Gaming PC** (F: drive, `F:\FromOneDrive\claude\A test for this`): the
  game, the live test install (`tester-builds/CFB27 Scoreboard RAM
  v1.3.53-test.16/`), deploy scripts, live memory scanning. Only THERE can
  anything be tested against the running game.
- **Dev PC** (this clone): code work, data analysis, theme/UI work, offline
  algorithm development against recorded data in `ram-diagnostic/reports/`.
  DO NOT try to deploy/test live from here. Push to `origin` (this private
  repo); the gaming PC pulls.

## Build & test (works on any PC with .NET Framework + Node)

- Reader build: `C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe
  -nologo -target:winexe -platform:x64 -optimize+
  -out:../build/CollegeFB27RamReader.exe -r:System.dll -r:System.Core.dll
  -r:System.Drawing.dll -r:System.Windows.Forms.dll
  -r:System.Web.Extensions.dll Program.cs MemoryScanner.cs
  RamLiveExporter.cs LiveScoreboard.cs MainForm.cs ResearchProbes.cs`
  (run in `ram-diagnostic/source/`). C# 5 ONLY: no `?.`, no string
  interpolation. Then `CollegeFB27RamReader.exe --self-test out.json`.
- App tests: `cd source && node --test` (115 tests) and
  `node build-tools/check-orphaned-ui.js` (must report 0).
- Prove new assertions by inversion (make it fail once, then fix).

## Current state (2026-08-22, v1.4.126)

Working & confirmed live: full scoreboard (scores/clocks/down-distance with
exact decimal yardage + Inches), dynasty team names/records/leaders 143/143,
fast flags, field-goal distance on made kicks (18–120 window), EA-patch
auto-rebase with persisted cache + self-heal, stat pop-up capture with junk
filtering, per-player stat board + game leaders in the Field Inspector
theme, drift-based row confirmation (a player's live stat row confirms from
his own plays), chat-driven "value hunt" (in-reader Cheat-Engine loop via
`value-hunt.json` → `value-hunt-status.json` → auto neighborhood dumps at
≤24 survivors into `valuehunt-dumps.jsonl`).

## THE ACTIVE GOAL: always-on per-player stats (QB/RB/WR, both teams)

Proven: the game stores per-player game stats as **int16 fixed-layout
records with mirror copies** — a live row was confirmed updating in place
(RB 11 car/102 yds at 12 addresses). See
`ram-diagnostic/reports/stat-table-2026-08-21/ANALYSIS.md` (decoded QB/RB
record layouts from a spoken box score) and
`ram-diagnostic/reports/mmc-banner-research-2026-08-21/FINDINGS.md`
(the stat lower-third is a Rime GameBanner; `RimeBannerData` is a
structured in-memory source; full stat vocabulary AudioPlayerStatType_*).

**Decided plan** (stress-tested with the owner):
1. Discovery via the in-reader value hunt (owner pauses, says RB yards,
   Claude drives first/next scans; auto-dumps at the end) — gaming PC only.
2. From dumps: decode record layout; CHECK FOR jersey-number / player-id
   fields.
3. If ids/jerseys present → **roster fingerprint auto-finder**: ~70 known
   jerseys/ids from the dynasty save at fixed stride = locate the table
   PREGAME every game (no stats needed). Else: shape+stride scan mid-game
   (stat-plausible int16 rows repeating at fixed stride) + pop-up anchors.
4. Names: dynasty save roster order / jersey fields (app already parses the
   save). Publish `game.playerTable`; Field Inspector shows it.

**Hard-won safety rules (do not violate):**
- NEVER repeatedly full-sweep the live game process (three crashes on
  2026-08-20/21 correlate with heavy scans). Hunts are narrow/paced
  (Thread.Sleep(3)/MB) and single-burst per user action.
- The reader is fail-closed: never publish guessed values. Every publish
  needs structural verification (copies agree, drift plausibility, etc.).
- EA patches shift ScoreHud vtables (+0x1000 on 2026-08-20). GameProfile +
  rebase cache handle it; never hardcode absolute addresses in features.
- An app deploy restarts the reader (in-memory state dies). Theme edits
  must be synced to the ACTIVE theme-library copy AND the app restarted.

## Madden (parked for now)

Names/records work; timeouts nearly done: the all-calls counter trio is
found; per-team attribution needs one tester half of
`madden-timeout-probe.jsonl` (v1.4.114+ wide "around" dumps) WITH the
tester's notes of who called each timeout. See memory of rounds in
`ram-diagnostic/reports/madden-*`.

## Data for offline work

`ram-diagnostic/reports/` holds analyzed sessions. Fresh probe data lives
only on the gaming PC under the live install's `UserData/data-export/`
(stattable-probe.jsonl, valuehunt-dumps.jsonl, statbanner-probe.jsonl,
fgspot-probe.jsonl, rebase-probe.jsonl...). Ask the gaming-PC session to
commit new samples into `ram-diagnostic/reports/` when needed.
