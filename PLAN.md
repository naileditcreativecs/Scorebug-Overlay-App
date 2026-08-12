# Reader reliability plan

Agreed 2026-08-12. The problem to solve: fields that the reader can plainly
find are not shown, and when nothing appears there is no way to tell why.

## The core defect

Four fields fail together — team names, timeouts, ranks, possession — always
with `configuredCopies=0`, while clock, score and down keep working.

They fail together because they are all installed at *matchup confirmation*,
and confirmation requires team names. So a failure to identify the teams takes
out three other fields that never needed the identity in the first place.

Captured live 2026-08-12, Ole Miss (rank 9, home) vs West Virginia, while the
in-game scorebug showed both names correctly:

```
ScoreHud team object   rank 9  score 7  timeouts 3   ← correct
                       teamId 0, name pointer → empty string
locator                teamRoleAllocationBase blank
                       activeTraditionSlugs   []
                       homeTimeouts [0x7FA33A74, 0x7FA33D44]   ← FOUND
                       awayTimeouts [0x7FA33A78, 0x7FA33D48]   ← FOUND
running reader         names/timeouts/ranks/possession all configured=0
```

The timeout addresses are found on every single scan and never installed.

Note: this is **not** simply a Dynasty-vs-Play-Now split. Earlier the same
evening, in the same mode, the reader read `West Virginia / Pittsburgh` and
`Penn State / Pittsburgh` with timeouts. The structures are sometimes present
and sometimes not; the cause of that is still unknown.

## 1. Publish every field as soon as it is found

Nothing should wait on anything else. A field is shown when it is confirmed on
its own terms, not when some other field succeeds.

- Timeouts, possession and ranks stop depending on matchup confirmation
- Team names keep their own confirmation, because showing the *previous*
  game's teams is the one failure worth protecting against
- Fail-closed stays: a field that cannot be verified shows nothing. This is
  about removing false dependencies, not lowering the bar for evidence

Biggest reliability win available, and it works in every mode without needing
the identity problem solved first.

## 2. Look for team identity in more than one place

Try every known source and take the first that verifies, rather than requiring
one specific structure:

- the team role buffers ("Team Home" / "Team Away" markers)
- the ScoreHud team object's `teamId`, resolved against the team catalog
  (the catalog is found reliably — `teamCatalogBase` is populated even when
  everything else about identity is missing)
- the tradition slugs
- the team display string pointer

Right now the absence of the first one is treated as total failure.

## 3. Diagnostics that say what is wrong, in plain English

When something is not reading, the app should say so and say why. Each field
reports its own state with a short code and a sentence a person can act on:

```
TEAMS-NOMARKERS   Team names: the game is not exposing team markers right now.
TIMEOUTS-NOBIND   Timeouts: found in memory but not installed (waiting on matchup).
POSS-NOLEGACY     Possession: no synchronised record present in this game.
OK                Reading normally.
```

Two rules learned the hard way tonight:

- **Never report a field as working when it is not.** `workingRamFields` is a
  hardcoded list that always claims timeouts work. It cost hours.
- **Empty `catch` blocks hide the cause.** 28 of them across the reader; a
  failed read is currently indistinguishable from an absent value.

The export file should carry the same per-field state, so a support report
shows exactly what the reader saw and what it declined to publish.

## 4. Test in the mode actually used

Play Now is the normal case, not Dynasty. Any fix must be checked there.

## Order of work

1. Diagnostics first (3) — so the next two steps are measured, not guessed
2. Decouple the fields (1) — the reliability win
3. Multi-source identity (2) — fixes names, and with (1) they no longer block
   anything else

Timeout binding must be repaired in the current source at the same time: the
deployed reader is the 16:17 build because every later build inherits a change
that stops timeouts binding. See `build-tools/backups/20260812-shippable/`.
