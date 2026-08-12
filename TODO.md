# Knock-out list

One at a time, in this order. Each step says what it is, how we prove it, and
what it unblocks. Nothing moves to the next step until the current one is
verified in a live game.

---

## 1. Restore a safe name fallback

**Root cause found 2026-08-12.** Names are not missing from memory - the
finder is deliberately switched off.

```
labels home=1 away=1
away 0x4F5432C0 refs=1
home 0x4F5432E0 refs=1
labeled-vector evidence ambiguous; legacy fallback blocked
```

Both markers are located. The strict labelled-vector route then returns
IncompleteOrAmbiguous - most likely because activeTraditionSlugs is empty in
this mode and it needs those to map a marker to a team.

On the other branch the old finder still runs, and its answer is discarded:

```csharp
ChooseActiveTeams(result, homeMarkers, traditions, catalogNames);
result.HomeTeamName = null;
result.AwayTeamName = null;
result.HomeTeamNameAddresses.Clear();
```

The stated reason is real: raw text addresses could rebind to the wrong teams
across a same-process game load - the hanging-teams bug. So this was a
deliberate trade of availability for safety, and it is why older builds read
names every time and this one does not.

**Method.** Re-enable the fallback with the safety the original lacked: use it
only when the labelled route cannot decide, require the pair to be re-verified
inside the current process epoch, and drop it the moment the matchup changes.
The protection that motivated switching it off has to survive.

**Done when.** Real team names read in a Play Now game, AND starting a second
game in the same session does not show the first game teams.

**Unblocks.** Names, and probably ranks with them.

---

## 2. Background sweep returns zero timeout copies

**Problem.** The standalone locator finds the timeout addresses on every single
scan:

```
homeTimeouts [0x7FA33A74, 0x7FA33D44]
awayTimeouts [0x7FA33A78, 0x7FA33D48]
```

The background sweep the reader actually uses reports `timeout copies 0`, so
the install declines: `selection declined (result home=0 away=0)`.

Same game, same moment, two code paths, different answers. The visible
difference is that the background one runs `DiscoverRamLayout(null)` with no
screen snapshot.

**Method.** Compare the two paths directly. Find what the null screen changes.

**Done when.** `timeout copies` is non-zero in the reader's own status line.

**Unblocks.** Timeouts. Very likely the regression that has kept us on the old
reader all night.

---

## 2b. Goal/Inches when no special layer exists  (NEW 2026-08-12)

Captured live during a 2nd & Inches:

```
core:    down= dist= kind=pendingSpecial dd=''
objects: downDistanceCandidates: []          <- none at all in memory
```

The reader is behaving correctly here. The numeric core reports distance 0,
which is shared by Goal and Inches, so it sets pendingSpecial and withholds
rather than guessing. But there was no ScoreHud down-distance object present
to say which one it is - not a stale one, none.

So this is a third distinct case, separate from the goal-to-go problem:

- goal-to-go with real yardage: core says e.g. 3, layer exists, must be found
- Inches with core 0: layer must exist to disambiguate, and sometimes does not

**Possible route.** Goal and Inches are distinguishable by field position
without any layer: distance 0 inside the opponent 10 is Goal, distance 0
anywhere else is Inches. That needs the ball-on/yard-line field, which the
reader does not currently read. Worth finding - it would resolve the ambiguity
from the numeric core alone and stop depending on a layer that is not always
there.

---

## 3. Confirm the decoupling end to end

**Already built, not yet proven.** Timeouts and possession are now installed
before the gates that used to discard the whole discovery result. The install
path demonstrably runs — it now reports *why* it declines instead of silently
doing nothing.

**Done when.** With step 2 fixed, timeouts appear even while team names are
still unresolved.

---

## 4. Publish win/loss records

**Problem.** The ScoreHud team object already carries `Wins`, `Losses`, `Ties`
and `Color`. They are parsed on every read and thrown away — only a debug probe
ever prints them.

**Method.** Plumbing: format `W-L`, add to the export and the app state.

**Done when.** Records show on the scorebug.

**Note.** This is the smallest job on the list and needs no new discovery.

---

## 5. Play Now records rule

Records publish as `W-L`. In Play Now they must read `0-0`. Never publish an
implausible record — blank rather than wrong.

Check what Play Now actually holds in those fields before writing the rule.

---

## 6. Possession in every mode

**Problem.** Possession is only ever taken from a "legacy" scoreboard record
that agrees with the moving wide record. In your games there are no legacy
records at all (`legacy candidates=0`), so there is no source.

There is a possession byte inside the timeout clones, but the code refuses it
deliberately — it was seen flipping while quarter, clock, score and down were
unchanged, so it is not authoritative.

**Method.** Find possession inside the wide record, the way down and distance
were originally found: capture before and after a change of possession and
compare.

---

## 7. Plain-English diagnostics for every field

Each field reports its own state with a short code and a sentence:

```
TEAMS-NOMARKERS   Team names: the game is not exposing team markers right now.
TIMEOUTS-NOBIND   Timeouts: found in memory but not installed.
OK                Reading normally.
```

Partly done — `timeoutBind`, `timeoutInstall` and `possessionBind` already
report real reasons and are what cracked steps 2 and 3.

Two rules learned the hard way:

- Never report a field as working when it is not. `workingRamFields` is a
  hardcoded list that always claims timeouts work.
- Stop swallowing errors: 28 empty `catch` blocks make a failed read
  indistinguishable from an absent value.

---

## 8. Recorded memory snapshots for offline testing

Capture the regions that matter during real games — Play Now, Dynasty,
kickoff, PAT, goal-line, a game restart — and replay them without the game
running.

Addresses change every launch, which is the point: a snapshot tests whether the
**finder** works, not whether an address is still valid.

**Why it matters.** Every verification tonight needed a live game and a human.
Every regression shipped because I could not test in seconds. With fixtures,
each bug becomes a permanent test case.

---

## 9. Survive a game update

Offsets like `0xB0F3128` are absolute positions inside CFB27. After any EA
patch they are wrong, and the failure looks identical to "no kickoff
happening". It should say the game build is not recognised.

---

## 10. Product polish

- Executable is still named `A test for this.exe`; the embedded product name is
  already correct, so this is a rename and repackage
- Unsigned, so Windows warns on every launch
- 194 MB download still carries the OCR engine the RAM build never uses

---

## Merge blocker, running through all of it

The deployed reader is the 16:17 build because every later build inherited a
change that stops timeouts binding. Step 2 is most likely the cause. Until it
is fixed, Goal/Inches and timeouts cannot ship in the same build.
