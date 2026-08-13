# Possession Indicator — Completion Plan

_Written 2026-08-13. Possession is the last unread field on the scorebug.
This is the plan to turn it on without guessing._

## Where things stand

Three possible sources exist in memory. All three are already read; none is
published, because each has an unanswered trust question:

| # | Source | Where | Status | Open question |
|---|--------|-------|--------|---------------|
| 1 | Legacy record word | legacy block +0x108 | Trusted today, but only when a synchronized legacy record exists — which is absent in most of our games | Useless most games; is it even worth keeping? |
| 2 | Timeout-clone byte | clone context +0x31 (home slot − 0x13) | Read, deliberately unpublished — observed flipping without a real possession change | Was that flicker real, or a mid-update read that two-copy consensus would filter? |
| 3 | ScoreHud team flag | team object +72 (`HasPossession`) | Parsed; already trusted for tied-score orientation | Does it track truth through kickoffs/punts/turnovers, or is it a presentation flag? |

**Test Build 2 already collects the answer.** Every time any source changes,
the reader logs all three side by side with quarter/clock/score/down context
to `UserData\data-export\possession-probe.jsonl`. The live comparison also
shows in the Diagnostics reader report as `possessionProbe`.

## Phase 1 — Get the data (needs: one game of play)

Play one normal game on Test Build 2 (Dynasty preferred, since that's where
sources have differed from Play Now). No special actions needed. Ideal
coverage within the game: a kickoff, a punt, a turnover if one happens, and
halftime. A second game in Play Now doubles the confidence.

Then hand me `possession-probe.jsonl` (or just say the word — I can read it
from the app folder).

## Phase 2 — Analysis (me, ~30 min once data exists)

Ground truth is derived from the log itself, no manual notes needed:

- **Score attribution**: the team that scores had possession on the
  preceding snaps (excepting defensive scores, which the score size and
  drive context usually expose).
- **Kickoff logic**: after a score, the scored-against team receives.
- **Drive shape**: possession cannot flip mid-drive while down counts
  1→2→3 with the clock running.

Each source gets judged on:

1. **Flip discipline** — does it change ONLY at plausible possession
   boundaries? (The known flicker would fail here.)
2. **Score agreement** — 100% of scoring drives attributed to the side
   that held the flag.
3. **Coverage** — what fraction of the game was the source readable at all?
4. **Cross-mode stability** — same behavior in Dynasty and Play Now.

A source must pass 1 and 2 with zero exceptions to be trusted. Ties broken
by coverage.

## Phase 3 — Implementation (~1–2 hours, one switch point)

All roads lead through one function: `SelectVerifiedPossession` in
`RamLiveExporter.cs` — a pure, self-tested seam built for exactly this day.

- **If the ScoreHud +72 flag wins** (expected): publish from the already-
  oriented away/home team objects. Publication rule: the two objects must
  disagree complementarily (one side 1, other side 0); anything else
  publishes nothing. Two consecutive agreeing reads before the arrow flips
  (debounce against mid-update reads). Never published during a matchup
  transition.
  - *No circularity*: tied-score orientation reads +72 per-object; the
    published arrow is a downstream consumer, not an orientation input.
- **If the clone byte wins**: the plumbing already exists and is disabled —
  `ReadTimeoutClonePossession` + `InstallTimeoutCloneHomePossession`, with
  the two-copy consensus check (`TimeoutCloneHomePossessionReadsAreSafe`)
  already written and self-tested. Re-enable, keep the consensus gate.
- **If only the legacy word survives**: keep today's behavior and accept
  that possession stays missing in games without a legacy record — and say
  so honestly in the release notes.
- **Hybrid fallback** (if no single source is perfect): publish only when
  two available sources agree; silence otherwise. Fail-closed, as always.

App side needs zero work: `away.possession` / `home.possession` booleans
already flow through `ramScoreboardPayload`, and themes already render the
arrow.

## Phase 4 — Validation gates (before any tester sees it)

1. Self-test: new assertions on the chosen rule, proven live by inversion.
2. One local game watching the arrow through: opening kickoff, a punt, a
   score + kickoff, halftime switch, and (if lucky) a turnover.
3. The probe logging STAYS ON in the shipped build — if a tester reports a
   wrong arrow, their probe file shows exactly which source lied.
4. Ship as Test Build 3 with Test Build 2 kept as the revert point.

## Known risks

- **+72 may have a third state** (e.g., neither team during kickoffs/dead
  ball). Fine — complementary-disagreement rule publishes nothing then,
  which is correct: no arrow during no-possession states.
- **Replays/cutscenes** may flip presentation flags — the debounce plus
  boundary-only flip discipline in Phase 2 is the filter; if a source fails
  it there, it fails selection.
- **Overtime** has no kickoffs and quick alternation — validation game
  should ideally reach OT once before we call it fully done, but this can
  ride a later tester report.

## Sequence for tomorrow

1. Morning: play (or have a tester play) one game on Test Build 2.
2. I analyze the probe file and post the verdict table.
3. Same day: implement the winner behind `SelectVerifiedPossession`,
   self-test, one validation game, ship Test Build 3.

That completes the reader: every scorebug field read from memory.
