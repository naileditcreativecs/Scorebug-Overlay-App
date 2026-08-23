using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace CollegeFootballRamDiagnostic
{
    internal sealed class RamLiveExporter
    {
        // Bump the scope whenever the field-coherence rules change.  Existing
        // caches may contain a legal but stale down pointer and must be
        // rediscovered instead of being trusted on the next launch.
        private const string AutomaticProfileScope = "automatic-read-only-signatures-v16-dynasty-clone-possession";
        private const string PreviousAutomaticProfileScope = "automatic-read-only-signatures-v15-live-core-role-bindings";
        private const string EarlierAutomaticProfileScope = "automatic-read-only-signatures-v14-fixed-team-state";
        private const string OlderAutomaticProfileScope = "automatic-read-only-signatures-v13-matchup-epochs";
        private const string OldestAutomaticProfileScope = "automatic-read-only-signatures-v12-cloned-timeouts";
        private const string RankProfileScope = "automatic-read-only-signatures-v8-scorehud-ranks";
        private const string LegacyProfileScope = "automatic-read-only-signatures-v7-correct-live-down";
        internal const int ScoreHudExpectedNone = 0;
        internal const int ScoreHudExpectedKickoff = 1;
        internal const int ScoreHudExpectedConversion = 2;
        internal const int ScoreHudExpectedAwaitScrimmage = 3;
        private readonly MemoryScanner scanner;
        private readonly string profilePath;
        private RamLiveProfile profile;
        private DateTime profileWriteTimeUtc;
        private string lastAwayTeamName;
        private string lastHomeTeamName;
        private Dictionary<string, string> teamKeyNames;
        private DateTime nextAwayAssetScanUtc;
        private RamTextResult lastAwayAssetResult = RamTextResult.Missing(0);
        private int resolvedProcessId;
        private long attachedProcessStartUtcTicks;
        private int discoveryAttemptProcessId;
        private DateTime nextAutoDiscoveryUtc;
        private string autoDiscoverySummary;
        private int scoreboardCandidateCount;
        private int scoreHudTeamCandidateCount;
        private int scoreHudDownDistanceCandidateCount;
        private DateTime nextRankScoreHudDiscoveryUtc;
        private ScoreHudDownDistanceCandidate lastScoreHudDownDistance;
        private DateTime lastScoreHudDownDistanceSeenUtc;
        private ScoreHudMessageCandidate lastScoreHudMessage;
        private DateTime lastScoreHudMessageSeenUtc;
        private int lastConversionMessageId;
        private DateTime lastConversionMessageSeenUtc;
        private int coreReadFailureCount;
        private int confirmationProcessId;
        private int confirmationPassCount;
        private DateTime nextConfirmationUtc;
        private DateTime nextHealthCheckUtc;
        private int healthFailureCount;
        private int lastStateProcessId;
        private int lastQuarter;
        private int lastClock;
        private int lastHomeScore;
        private int lastAwayScore;
        private int lastAwayRank = -1;
        private int lastHomeRank = -1;
        private int matchupGeneration;
        private int restoredMatchupStatePreparedProcessId;
        private int lastAwayRankGeneration = -1;
        private int lastHomeRankGeneration = -1;
        // Records ride on the rank object: the same ScoreHud team candidate
        // that carries Rank also carries Wins/Losses/Ties, so reading them
        // costs nothing extra and shares the rank generation for lifetime.
        private string lastAwayRecord;
        private string lastHomeRecord;
        private int orientedAwayScoreHudTeamId = -1;
        private int orientedHomeScoreHudTeamId = -1;
        // The matchup epoch in which the ScoreHud orientation was established.
        // BeginPendingMatchupTransition increments the epoch and resets this,
        // so equality is positive proof that an orientation was derived after
        // the current transition began rather than inherited from the old game.
        private int orientedScoreHudMatchupGeneration = -1;
        private int pendingAwayScoreHudTeamId = -1;
        private int pendingHomeScoreHudTeamId = -1;
        private int pendingAwayScoreHudRank = -1;
        private int pendingHomeScoreHudRank = -1;
        private long pendingAwayScoreHudAddress;
        private long pendingHomeScoreHudAddress;
        private int scoreHudOrientationConfirmations;
        private bool matchupTransitionPending;
        // Independent verification of the live core by the background full
        // sweep: how many times the sweep re-located the same core the reader
        // is publishing from, and when. Makes the fast cached re-attach's
        // double-check visible instead of implicit.
        private int coreCrossCheckAgreements;
        private int coreCrossCheckDisagreements;
        private DateTime lastCoreCrossCheckUtc = DateTime.MinValue;
        private string retiredAwayTeamName;
        private string retiredHomeTeamName;
        private string retiredAwayTeamAddressSignature;
        private string retiredHomeTeamAddressSignature;
        private bool rejectRetiredOrderedPair;
        private string transitionPreviousCoreSignature;
        private string transitionPreviousAwayTeamName;
        private string transitionPreviousHomeTeamName;
        private string transitionPreviousAwayAddressSignature;
        private string transitionPreviousHomeAddressSignature;
        private int lastPublishedProcessId;
        private readonly object scoreHudDiscoverySync = new object();
        private bool scoreHudDiscoveryRunning;
        private int scoreHudDiscoveryGeneration;
        private bool scoreHudDiscoveryRequested;
        private ScoreHudDiscoveryResult pendingScoreHudDiscovery;
        private DateTime nextScoreHudDiscoveryUtc;
        private DateTime scoreHudTransitionScanUntilUtc;
        private bool scoreHudSpecialPending;
        private int scoreHudNumericResumeConfirmations;
        private DateTime nextScoreHudDelayedSpecialRetryUtc;
        private bool scoreHudZeroDistanceActive;
        private DateTime nextScoreHudZeroDistanceRetryUtc;
        private bool scoreHudColdBaselinePending;
        private int scoreHudColdBaselineResumeConfirmations;
        private int scoreHudColdBaselineObservedPlayClock = -1;
        private bool scoreHudColdBaselinePlayClockResetSeen;
        private int scoreHudColdBaselinePlayClockEpochs;
        private int scoreHudColdBaselineObservedGameClock = -1;
        private bool scoreHudColdBaselineGameClockMoved;
        private int scoreHudColdBaselineEpochsAtLastGameClockChange;
        private bool scoreHudColdFreshScrimmageObserved;
        private int scoreHudExpectedNonScrimmageSpecial;
        private int scoreHudTransitionQuarter;
        private int scoreHudTransitionDown = -1;
        private int scoreHudTransitionDistance = -1;
        private int scoreHudTransitionObservedPlayClock = -1;
        private bool scoreHudTransitionPlayClockResetSeen;
        private bool scoreHudTransitionAllowInitialPlayClockEpoch;
        private int scoreHudTransitionPlayClockEpochs;
        private int scoreHudTransitionObservedGameClock = -1;
        private bool scoreHudTransitionGameClockMoved;
        private int scoreHudTransitionEpochsAtLastGameClockChange;
        private bool scoreHudExpectedSpecialObserved;
        private bool scoreHudTransitionFreshScrimmageObserved;
        private int scoreHudTransitionFreshScrimmageEpoch = -1;
        private bool scoreHudFreshKickoffObserved;
        private readonly Dictionary<long, string> scoreHudObservedCandidateStates =
            new Dictionary<long, string>();
        private readonly Dictionary<long, DateTime> scoreHudCandidateActivationUtc =
            new Dictionary<long, DateTime>();
        private readonly Dictionary<long, DateTime> scoreHudCandidateSemanticChangeUtc =
            new Dictionary<long, DateTime>();
        private readonly HashSet<long> scoreHudTrustedZeroDistanceAddresses =
            new HashSet<long>();
        private int scoreHudTrustedZeroDistanceDown = -1;
        private bool scoreHudTransitionBaselineInitialized;
        private int scoreHudTransitionBaselineProcessId;
        private int scoreHudTransitionBaselineQuarter;
        private int scoreHudTransitionBaselineHomeScore;
        private int scoreHudTransitionBaselineAwayScore;
        private int scoreHudTransitionBaselineDown = -1;
        private int scoreHudTransitionBaselineDistance = -1;
        private bool hasStableDownDistance;
        private int stableDown;
        private int stableDistance;
        private int pendingDown;
        private int pendingDistance;
        private int pendingDownDistanceReads;
        private readonly object teamNameDiscoverySync = new object();
        private bool teamNameDiscoveryRunning;
        private int teamNameDiscoveryGeneration;
        private RamAutoDiscovery pendingTeamNameDiscovery;
        private int pendingTeamNameDiscoveryProcessId;
        private int pendingTeamNameDiscoveryMatchupGeneration;
        private DateTime nextTeamNameDiscoveryUtc;
        private string candidateAwayTeamName;
        private string candidateHomeTeamName;
        private string candidateAwayTeamAddressSignature;
        private string candidateHomeTeamAddressSignature;
        private int teamNamePairConfirmations;
        private string candidateDifferentCoreSignature;
        private int differentCoreConfirmations;
        private readonly object fullMemoryScanSync = new object();
        private bool fullMemoryScanRunning;
        private long fullMemoryScanToken;
        // The game's exe version and module size, read once per attached
        // process. Every hardcoded ScoreHud offset is measured against one
        // specific game build; without this stamp a patch mismatch is
        // indistinguishable from every other failure in a user's report.
        private int gameVersionProcessId;
        private string gameExeVersion;
        private long gameModuleSize;
        // Fast reattach. When the app restarts while the same game process is
        // still running, the cached core addresses are checked by watching the
        // clock tick there - the same liveness proof discovery uses - instead
        // of being discarded outright. Adoption on proof, full discovery on any
        // failure; discovery keeps its normal cadence in parallel the whole
        // time, so this path can shortcut acquisition but never block it.
        private bool cacheProbeActive;
        private int cacheProbeProcessId;
        private DateTime nextCacheProbeSampleUtc;
        private RamScoreboardSnapshot cacheProbeFirst;
        private RamScoreboardSnapshot cacheProbeSecond;
        private DateTime cacheProbeFirstAtUtc;
        private DateTime cacheProbeSecondAtUtc;

        public RamLiveExporter(MemoryScanner scanner, string profilePath)
        {
            this.scanner = scanner;
            this.profilePath = profilePath;
        }

        public void Reset()
        {
            profile = null;
            profileWriteTimeUtc = DateTime.MinValue;
            coreCrossCheckAgreements = 0;
            coreCrossCheckDisagreements = 0;
            lastCoreCrossCheckUtc = DateTime.MinValue;
            lastAwayTeamName = null;
            lastHomeTeamName = null;
            teamKeyNames = null;
            nextAwayAssetScanUtc = DateTime.MinValue;
            lastAwayAssetResult = RamTextResult.Missing(0);
            resolvedProcessId = 0;
            attachedProcessStartUtcTicks = CurrentProcessStartUtcTicks();
            discoveryAttemptProcessId = 0;
            // Pooled neighborhoods are per game process; a new attach starts
            // with none rather than scanning another process's map.
            scoreHudDownDistanceAnchors.Clear();
            nextFastScoreHudScanUtc = DateTime.MinValue;
            loggedScoreHudMessages.Clear();
            recentScoreHudMessages.Clear();
            currentPenalty = null;
            publishedFieldValues.Clear();
            publishedFieldChangedAt.Clear();
            nextAutoDiscoveryUtc = DateTime.MinValue;
            autoDiscoverySummary = null;
            scoreboardCandidateCount = 0;
            scoreHudTeamCandidateCount = 0;
            scoreHudDownDistanceCandidateCount = 0;
            nextRankScoreHudDiscoveryUtc = DateTime.MinValue;
            lastScoreHudDownDistance = null;
            lastScoreHudDownDistanceSeenUtc = DateTime.MinValue;
            lastScoreHudMessage = null;
            lastScoreHudMessageSeenUtc = DateTime.MinValue;
            lastConversionMessageId = 0;
            lastConversionMessageSeenUtc = DateTime.MinValue;
            coreReadFailureCount = 0;
            confirmationProcessId = 0;
            confirmationPassCount = 0;
            nextConfirmationUtc = DateTime.MinValue;
            nextHealthCheckUtc = DateTime.MinValue;
            healthFailureCount = 0;
            lastPublishedProcessId = 0;
            matchupGeneration = 0;
            restoredMatchupStatePreparedProcessId = 0;
            lastAwayRankGeneration = -1;
            lastHomeRankGeneration = -1;
            candidateDifferentCoreSignature = null;
            differentCoreConfirmations = 0;
            ResetCacheProbe();
            ResetScoreHudOrientation();
            matchupTransitionPending = false;
            retiredAwayTeamName = null;
            retiredHomeTeamName = null;
            retiredAwayTeamAddressSignature = null;
            retiredHomeTeamAddressSignature = null;
            rejectRetiredOrderedPair = false;
            ClearTransitionPreviousSnapshot();
            lock (scoreHudDiscoverySync)
            {
                scoreHudDiscoveryGeneration++;
                scoreHudDiscoveryRunning = false;
                scoreHudDiscoveryRequested = false;
                pendingScoreHudDiscovery = null;
            }
            nextScoreHudDiscoveryUtc = DateTime.MinValue;
            scoreHudTransitionScanUntilUtc = DateTime.MinValue;
            scoreHudSpecialPending = false;
            scoreHudNumericResumeConfirmations = 0;
            nextScoreHudDelayedSpecialRetryUtc = DateTime.MinValue;
            scoreHudZeroDistanceActive = false;
            nextScoreHudZeroDistanceRetryUtc = DateTime.MinValue;
            scoreHudColdBaselinePending = false;
            scoreHudColdBaselineResumeConfirmations = 0;
            scoreHudColdBaselineObservedPlayClock = -1;
            scoreHudColdBaselinePlayClockResetSeen = false;
            scoreHudColdBaselinePlayClockEpochs = 0;
            scoreHudColdBaselineObservedGameClock = -1;
            scoreHudColdBaselineGameClockMoved = false;
            scoreHudColdBaselineEpochsAtLastGameClockChange = 0;
            scoreHudColdFreshScrimmageObserved = false;
            scoreHudExpectedNonScrimmageSpecial = ScoreHudExpectedNone;
            scoreHudTransitionQuarter = 0;
            scoreHudTransitionDown = -1;
            scoreHudTransitionDistance = -1;
            scoreHudTransitionObservedPlayClock = -1;
            scoreHudTransitionPlayClockResetSeen = false;
            scoreHudTransitionAllowInitialPlayClockEpoch = false;
            scoreHudTransitionPlayClockEpochs = 0;
            scoreHudTransitionObservedGameClock = -1;
            scoreHudTransitionGameClockMoved = false;
            scoreHudTransitionEpochsAtLastGameClockChange = 0;
            scoreHudExpectedSpecialObserved = false;
            scoreHudTransitionFreshScrimmageObserved = false;
            scoreHudTransitionFreshScrimmageEpoch = -1;
            scoreHudFreshKickoffObserved = false;
            scoreHudObservedCandidateStates.Clear();
            scoreHudCandidateActivationUtc.Clear();
            scoreHudCandidateSemanticChangeUtc.Clear();
            scoreHudTrustedZeroDistanceAddresses.Clear();
            scoreHudTrustedZeroDistanceDown = -1;
            scoreHudTransitionBaselineInitialized = false;
            scoreHudTransitionBaselineProcessId = 0;
            scoreHudTransitionBaselineDown = -1;
            scoreHudTransitionBaselineDistance = -1;
            lock (teamNameDiscoverySync)
            {
                teamNameDiscoveryGeneration++;
                teamNameDiscoveryRunning = false;
                pendingTeamNameDiscovery = null;
                pendingTeamNameDiscoveryProcessId = 0;
                pendingTeamNameDiscoveryMatchupGeneration = 0;
            }
            nextTeamNameDiscoveryUtc = DateTime.MinValue;
            candidateAwayTeamName = null;
            candidateHomeTeamName = null;
            candidateAwayTeamAddressSignature = null;
            candidateHomeTeamAddressSignature = null;
            teamNamePairConfirmations = 0;
            ResetLogicalState();
        }

        // Live-loop stall watchdog. Anything that blocks Refresh for longer
        // than a tick or two shows on the bug as a sticking clock. Count the
        // stalls and remember the worst so a report can say whether the
        // export loop itself is what lagged, instead of guessing.
        private int slowRefreshCount;
        private long worstRefreshMs;
        private DateTime lastSlowRefreshUtc = DateTime.MinValue;
        private const long SlowRefreshThresholdMs = 350;

        public string Refresh(LiveScoreboard screen, string screenJsonPath)
        {
            System.Diagnostics.Stopwatch refreshTimer = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                return RefreshCore(screen, screenJsonPath);
            }
            finally
            {
                refreshTimer.Stop();
                long elapsed = refreshTimer.ElapsedMilliseconds;
                if (elapsed > worstRefreshMs) worstRefreshMs = elapsed;
                if (elapsed >= SlowRefreshThresholdMs)
                {
                    slowRefreshCount++;
                    lastSlowRefreshUtc = DateTime.UtcNow;
                }
            }
        }

        private string RefreshCore(LiveScoreboard screen, string screenJsonPath)
        {
            // The shipped overlay is RAM-only. Never let a stale/blank screen
            // snapshot influence discovery, validation, or published fields.
            screen = null;
            if (scanner.Process == null || scanner.Process.HasExited)
                return "RAM export: waiting for " + GameProfile.ProcessName + ".exe";

            LoadProfileIfNeeded();
            if (profile == null) profile = new RamLiveProfile();
            MigratePreviousCurrentProcessProfile();
            ApplyCompletedTeamNameDiscovery(screenJsonPath);
            if (differentCoreConfirmations > 0)
            {
                ClearStaleOutput(screenJsonPath);
                RequestTeamNameDiscoveryIfNeeded();
                return "RAM export: confirming a replacement moving core ("
                    + differentCoreConfirmations.ToString(CultureInfo.InvariantCulture) + "/2)";
            }
            ScoreHudDownDistanceCandidate scoreHudDownDistance = ReadScoreHudDownDistance();
            bool nonScrimmageSpecialState = IsVisibleNonScrimmageSpecialState(scoreHudDownDistance)
                || scoreHudExpectedNonScrimmageSpecial != ScoreHudExpectedNone;
            bool canRecoverDuringSpecialState = nonScrimmageSpecialState
                && CanRecoverProfileDuringSpecialState();
            bool sameProcessIdentity = profile.ProcessId == scanner.Process.Id
                && CurrentProcessIdentityMatchesProfile();
            if (resolvedProcessId != scanner.Process.Id
                && IsCompatibleAutomaticProfileScope(profile.Scope)
                && (sameProcessIdentity || canRecoverDuringSpecialState))
            {
                // The game process can outlive the overlay and retain a fully
                // readable prior-game core. Static cache readability - even with
                // an agreeing legacy record - is not current-game proof. But the
                // proof discovery uses IS available here without a sweep: watch
                // the cached core and require a coherent clock countdown, the
                // exact test PromoteChangingWideCandidates applies to a freshly
                // found record. So for a same-process reattach, probe the cached
                // addresses instead of discarding them: they either prove
                // themselves within a few live seconds or the normal discovery
                // (still running on its own cadence below) replaces them.
                //
                // Side-bound state - names, ranks, timeouts, possession - is
                // still dropped up front. A different matchup can be loaded in
                // the same process between sessions, and re-reading a cached
                // name address is exactly the hanging-teams bug. Those fields
                // re-bind through their existing confirmation paths once the
                // core is adopted.
                if (sameProcessIdentity && !canRecoverDuringSpecialState && HasCachedCoreFields())
                {
                    if (!cacheProbeActive || cacheProbeProcessId != scanner.Process.Id)
                    {
                        PrepareRestoredMatchupState();
                        ClearStaleOutput(screenJsonPath);
                        BeginCacheProbe();
                        autoDiscoverySummary = "same-process cache found; verifying the cached scoreboard by watching it move";
                    }
                    AdvanceCacheProbe(screenJsonPath);
                }
                else
                {
                    PrepareRestoredMatchupState();
                    // A paused restart intentionally stays blank until gameplay
                    // moves; without a full cached core there is nothing to
                    // probe, so force the cold-attach discovery.
                    ClearStaleOutput(screenJsonPath);
                    DiscardCachedProfile("same-process cache discarded; waiting for live progression");
                }
            }
            bool processNeedsDiscovery = resolvedProcessId != scanner.Process.Id;
            bool matchupNeedsDiscovery = !processNeedsDiscovery && TeamNamesDifferFromScreen(screen);
            // The timeout clones come and go between sweeps: the standalone
            // locator finds them on most scans while a single foreground sweep
            // can report none. Discovery previously ran only on a process or
            // matchup change, so one unlucky sweep meant timeouts stayed
            // unbound for the whole session. Retry on a slow cadence while
            // they are missing - a sweep costs seconds, so 20s not 2s.
            // Only ever a recovery pass for an already-established game. A
            // full discovery resets the synchronized-scoreboard confirmation,
            // and in a fresh game the timeouts are always unbound - so without
            // this guard the recovery fired every 20s and knocked confirmation
            // back to 1/3 before it could reach 3/3, leaving the reader unable
            // to acquire at all. Observed live 2026-08-12 on a game restart.
            //
            // Ranks and records are included as well, because they bind in the
            // same place as timeouts and nothing else asks for a sweep once the
            // matchup has committed. Loading a second game showed the cost of
            // leaving them out: names came across fine, and timeouts, ranks and
            // records all stayed blank for the whole game because their one
            // chance to re-bind had already passed.
            //
            // An earlier attempt at this ran the sweep every 10s forever,
            // because at the time ranks could not bind at all - the unranked
            // side's team object was being discarded, so orientation only ever
            // saw one team - and every sweep knocked the synchronized-scoreboard
            // confirmation back to 1/3, emptying the overlay. Unranked teams are
            // read properly now, so ranks do bind and the sweeping does stop.
            //
            // The attempt cap is the backstop for that failure mode returning:
            // if these fields cannot bind in this game, give up rather than
            // sweep for the rest of it. Blank ranks are survivable; an overlay
            // that goes dark every few seconds is not. The counter resets on
            // every new matchup, so the next game gets a fresh set of tries.
            bool scoreHudFieldsUnbound = !HasConfiguredField("timeoutSlotTeamIdZero")
                || !HasConfiguredField("awayRank");
            RamReadResult recoveryQuarter = Read("quarter", 1, 20);
            if (recoveryQuarter.Available && recoveryQuarter.Value != scoreHudRecoveryQuarter)
            {
                scoreHudRecoveryQuarter = recoveryQuarter.Value;
                scoreHudRecoveryAttempts = 0;
            }
            bool timeoutsNeedDiscovery = !processNeedsDiscovery && !matchupNeedsDiscovery
                && lastPublishedProcessId == scanner.Process.Id
                && scoreHudFieldsUnbound
                && scoreHudRecoveryAttempts < MaximumScoreHudRecoveryAttempts
                && DateTime.UtcNow >= nextTimeoutRecoveryDiscoveryUtc;
            if (timeoutsNeedDiscovery)
            {
                scoreHudRecoveryAttempts++;
                nextTimeoutRecoveryDiscoveryUtc = DateTime.UtcNow.AddSeconds(10);
            }
            // A full memory sweep can take several seconds. Never run that
            // sweep repeatedly just because an optional team-name object has
            // not appeared; doing so freezes the clock export. Missing names
            // remain pending while the already-confirmed live scoreboard runs.
            if (timeoutsNeedDiscovery)
            {
                // Recovery only: do not clear published output or begin a
                // matchup transition. Nothing about the current game changed.
                //
                // This used to call RunAutomaticDiscovery here - a blocking
                // multi-second sweep on the live thread, every 10s, for as long
                // as timeouts or ranks stayed unbound. On the bug that read as
                // the clock sticking for a couple of seconds and jumping, over
                // and over (a Dynasty game with an unusable timeout catalog
                // never binds timeouts, so it never stopped). The background
                // sweep already installs timeouts and the ScoreHud discovery
                // already binds ranks, both off-thread: pull them forward
                // instead of freezing the export.
                RequestBackgroundRecoverySweep();
            }
            if ((processNeedsDiscovery || matchupNeedsDiscovery)
                && DateTime.UtcNow >= nextAutoDiscoveryUtc)
            {
                if (matchupNeedsDiscovery) BeginPendingMatchupTransition();
                // An unresolved profile can be a same-process invalidation,
                // not only a brand-new game process. Always remove the prior
                // snapshot before the blocking locator so no old matchup can
                // survive while fresh RAM is being confirmed.
                ClearStaleOutput(screenJsonPath);
                RunAutomaticDiscovery(screen);
            }
            if (resolvedProcessId != scanner.Process.Id)
            {
                // Keep the last confirmed snapshot during a same-process
                // reacquisition. A new game process must not inherit it.
                if (lastPublishedProcessId != scanner.Process.Id)
                    ClearStaleOutput(screenJsonPath);
                return "RAM export: automatic read-only locator is waiting to retry" +
                    (String.IsNullOrWhiteSpace(autoDiscoverySummary) ? String.Empty : " (" + autoDiscoverySummary + ")");
            }
            if (!nonScrimmageSpecialState && !ConfirmProfileIfNeeded())
                return resolvedProcessId == scanner.Process.Id
                    ? "RAM export: confirming synchronized scoreboard (" + confirmationPassCount.ToString(CultureInfo.InvariantCulture) + "/3)"
                    : "RAM export: synchronized confirmation failed; locating again";
            if (!nonScrimmageSpecialState && DateTime.UtcNow >= nextHealthCheckUtc)
            {
                nextHealthCheckUtc = DateTime.UtcNow.AddMilliseconds(500);
                // Strict cross-record agreement is required while initially
                // confirming a candidate. Once confirmed, presentation copies
                // are allowed to lag without tearing down the live reader.
                healthFailureCount = RuntimeProfileIsHealthy() ? 0 : healthFailureCount + 1;
                if (healthFailureCount >= 3)
                {
                    InvalidateProfile("continuous scoreboard agreement failed");
                    return "RAM export: live record diverged; locating again";
                }
            }

            // Only a pair that came from a labelled binding can be checked
            // against one. A pool-fallback pair has no role label, reference,
            // descriptor or vector - those fields are all zero - so
            // ConfiguredTeamRoleBindingIsValid always returns false for it. Left
            // ungated, that reads as "the roles changed" on every single tick:
            // the profile is invalidated, output is cleared, the matchup is
            // relocated, and the reader publishes nothing while cycling through
            // "team roles changed; locating the new matchup" forever.
            //
            // Absence of a labelled binding is not evidence that one broke.
            if (!matchupTransitionPending
                && !lastMatchupFromFallback
                && !String.IsNullOrWhiteSpace(lastAwayTeamName)
                && !String.IsNullOrWhiteSpace(lastHomeTeamName)
                && !ConfiguredTeamRoleBindingIsValid())
            {
                ClearStaleOutput(screenJsonPath);
                InvalidateProfile("labeled team-role binding changed");
                return "RAM export: team roles changed; locating the new matchup";
            }

            EnsureLiveScoreHudRankFields();
            RequestTeamNameDiscoveryIfNeeded();

            RamReadResult quarter = Read("quarter", 1, 20);
            RamReadResult gameClock = Read("gameClockSeconds", 0, 3600);
            RamReadResult playClock = Read("playClock", 0, 99);
            RamReadResult homeScore = Read("homeScore", 0, 255);
            RamReadResult awayScore = Read("awayScore", 0, 255);
            RamReadResult rawPossession = Read("possessionAwayIsOne", 0, 2);
            // Publication order: the proven HUD flag first, the synchronized
            // legacy record as fallback, nothing rather than a guess. The
            // clone byte is never published - the probe game showed it
            // flapping mid-drive.
            RamReadResult possession = SelectVerifiedPossession(
                ReadHudPossession(), rawPossession, PossessionVerificationRecordAgrees());
            RamReadResult down = Read("down", 1, 4);
            RamReadResult distance = Read("distance", 0, 99);
            RamReadResult stableDownRead;
            RamReadResult stableDistanceRead;
            StabilizeDownDistance(down, distance, out stableDownRead, out stableDistanceRead);
            ApplyOrientedTimeoutFields();
            // Timeouts: the oriented ScoreHud team objects (the same objects
            // that supply rank, record and possession) carry the count the
            // in-game bug draws. Guarded by the live score, debounced, held
            // through brief object churn. The clone-slot read stays as the
            // fallback for a game where the HUD objects never bind.
            ObserveHudTimeouts(awayScore, homeScore);
            RamReadResult homeTimeouts = SelectVerifiedTimeouts(
                ReadHudTimeouts(false), Read("homeTimeouts", 0, 3));
            RamReadResult awayTimeouts = SelectVerifiedTimeouts(
                ReadHudTimeouts(true), Read("awayTimeouts", 0, 3));
            RamReadResult awayRank = ReadLiveRank("awayRank", ref lastAwayRank,
                ref lastAwayRankGeneration, ref lastAwayRecord);
            RamReadResult homeRank = ReadLiveRank("homeRank", ref lastHomeRank,
                ref lastHomeRankGeneration, ref lastHomeRecord);
            // Only serve a cached record inside the matchup that produced it.
            string awayRecord = lastAwayRankGeneration == matchupGeneration ? lastAwayRecord : null;
            string homeRecord = lastHomeRankGeneration == matchupGeneration ? lastHomeRecord : null;
            if (matchupTransitionPending) { awayRecord = null; homeRecord = null; }
            RamTextResult awayTeamName = ReadTeamName("awayTeamNameAscii", "awayTeamKeyAscii");
            RamTextResult homeTeamName = ReadTeamName("homeTeamNameAscii", "homeTeamKeyAscii");
            awayTeamName = CanonicalizeRoleTeamRead(awayTeamName, lastAwayTeamName);
            homeTeamName = CanonicalizeRoleTeamRead(homeTeamName, lastHomeTeamName);

            // ScoreHud recreates and temporarily removes its display object
            // during timeouts and presentation wipes. A verified GOAL/INCHES
            // label remains valid while the numeric down is still the same;
            // discard it immediately when the down actually changes.
            if (!ScoreHudDownDistanceMatchesCurrentState(
                scoreHudDownDistance, down, distance))
                scoreHudDownDistance = null;

            // Only the fundamental synchronized scoreboard can invalidate the
            // profile. Optional fields publish independently as unavailable
            // while their own live objects are still appearing.
            bool coreMissing = !quarter.Available || !gameClock.Available
                || !homeScore.Available || !awayScore.Available;
            coreReadFailureCount = coreMissing ? coreReadFailureCount + 1 : 0;
            bool teamBuffersChanged = awayTeamName.Available && homeTeamName.Available
                && !String.IsNullOrWhiteSpace(lastAwayTeamName) && !String.IsNullOrWhiteSpace(lastHomeTeamName)
                && (!String.Equals(awayTeamName.Value, lastAwayTeamName, StringComparison.OrdinalIgnoreCase)
                    || !String.Equals(homeTeamName.Value, lastHomeTeamName, StringComparison.OrdinalIgnoreCase));
            if (MatchupRediscoveryIsRequired(nonScrimmageSpecialState,
                    coreReadFailureCount, teamBuffersChanged)
                && DateTime.UtcNow >= nextAutoDiscoveryUtc)
            {
                // A replacement core in the same process is a new epoch until
                // the ordered team-role buffers prove otherwise.
                BeginPendingMatchupTransition(true);
                // The locator can take several seconds. Remove the prior
                // matchup snapshot before it starts so consumers cannot show
                // stale team-bound data during the transition.
                ClearStaleOutput(screenJsonPath);
                coreReadFailureCount = 0;
                RunAutomaticDiscovery(screen);
                return "RAM export: matchup changed; automatic read-only locator refreshed";
            }
            bool currentPairMatchesPublished = awayTeamName.Available && homeTeamName.Available
                && String.Equals(awayTeamName.Value, lastAwayTeamName, StringComparison.OrdinalIgnoreCase)
                && String.Equals(homeTeamName.Value, lastHomeTeamName, StringComparison.OrdinalIgnoreCase);
            RamTextResult publishedAwayRead = currentPairMatchesPublished
                ? awayTeamName : RamTextResult.Missing(awayTeamName.ConfiguredCopies, awayTeamName.SuccessfulReads);
            RamTextResult publishedHomeRead = currentPairMatchesPublished
                ? homeTeamName : RamTextResult.Missing(homeTeamName.ConfiguredCopies, homeTeamName.SuccessfulReads);

            // Team identity comes from the same oriented ScoreHud objects that
            // supply rank, record and HUD timeouts. Re-read both objects against
            // this tick's core scores and publish the pair atomically. During a
            // matchup transition, a freshly oriented pair from this generation
            // may publish before the ordered names resolve; an old-generation
            // orientation, one stale side, or a changed binding still withholds
            // both identities rather than mixing two matchup epochs.
            ScoreHudTeamCandidate awayTeamIdentity = null;
            ScoreHudTeamCandidate homeTeamIdentity = null;
            bool awayTeamIdentityRead = false;
            bool homeTeamIdentityRead = false;
            bool scoreHudOrientationIsCurrentEpoch =
                orientedAwayScoreHudTeamId >= 0 && orientedHomeScoreHudTeamId >= 0
                && orientedScoreHudMatchupGeneration == matchupGeneration;
            bool teamBuffersPermitScoreHudIdentity = !teamBuffersChanged
                || matchupTransitionPending;
            if (scoreHudOrientationIsCurrentEpoch && teamBuffersPermitScoreHudIdentity
                && awayScore.Available && homeScore.Available)
            {
                awayTeamIdentityRead = TryReadConfiguredTeamIdentity(
                    "awayRank", awayScore.Value, orientedAwayScoreHudTeamId, out awayTeamIdentity);
                homeTeamIdentityRead = TryReadConfiguredTeamIdentity(
                    "homeRank", homeScore.Value, orientedHomeScoreHudTeamId, out homeTeamIdentity);
            }
            bool scoreHudTeamIdentityAvailable = awayTeamIdentityRead && homeTeamIdentityRead
                && ScoreHudTeamIdentityPairIsSafe(scoreHudOrientationIsCurrentEpoch,
                    awayScore, homeScore, orientedAwayScoreHudTeamId,
                    orientedHomeScoreHudTeamId, awayTeamIdentity, homeTeamIdentity);
            string scoreHudTeamIdentityDiagnostic;
            if (!scoreHudOrientationIsCurrentEpoch)
                scoreHudTeamIdentityDiagnostic = "withheld: ScoreHud sides not oriented for current matchup epoch"
                    + (matchupTransitionPending ? " (team names pending)" : String.Empty);
            else if (teamBuffersChanged && !matchupTransitionPending)
                scoreHudTeamIdentityDiagnostic = "withheld: ordered team buffers changed";
            else if (!awayScore.Available || !homeScore.Available)
                scoreHudTeamIdentityDiagnostic = "withheld: live scores unavailable";
            else if (!awayTeamIdentityRead || !homeTeamIdentityRead)
                scoreHudTeamIdentityDiagnostic = "withheld: score-matching ScoreHud object unavailable"
                    + " (away=" + (awayTeamIdentityRead ? "yes" : "no")
                    + ", home=" + (homeTeamIdentityRead ? "yes" : "no") + ")";
            else if (!scoreHudTeamIdentityAvailable)
                scoreHudTeamIdentityDiagnostic = "withheld: ScoreHud identity pair failed validation";
            else
                scoreHudTeamIdentityDiagnostic = "bound: away " + awayTeamIdentity.TeamId
                    + (awayTeamIdentity.IsTeambuilder == 1 ? " (TeamBuilder)" : String.Empty)
                    + ", home " + homeTeamIdentity.TeamId
                    + (homeTeamIdentity.IsTeambuilder == 1 ? " (TeamBuilder)" : String.Empty)
                    + " (live-score guarded"
                    + (matchupTransitionPending ? ", team names pending" : String.Empty)
                    + ")";
            if (quarter.Available && gameClock.Available
                && homeScore.Available && awayScore.Available
                && !StateProgressIsLogical(quarter.Value, gameClock.Value, homeScore.Value, awayScore.Value))
            {
                ClearStaleOutput(screenJsonPath);
                InvalidateProfile("game state moved backward or reset");
                return "RAM export: game state reset detected; locating again";
            }

            probeOutputSeedPath = screenJsonPath;
            WriteResearchProbes(screenJsonPath, rawPossession, possession,
                quarter, gameClock, awayScore, homeScore,
                stableDownRead, stableDistanceRead, scoreHudDownDistance);

            Dictionary<string, object> root = new Dictionary<string, object>();
            root["schemaVersion"] = 1;
            root["status"] = "live";
            root["updatedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            EnsureGameVersionInfo();
            root["process"] = new Dictionary<string, object>
            {
                { "name", scanner.Process.ProcessName },
                { "id", scanner.Process.Id },
                { "exeVersion", gameExeVersion },
                { "moduleSize", gameModuleSize > 0 ? (object)gameModuleSize : null },
                { "profileScope", profile.Scope },
                { "profileCreatedAt", profile.CreatedAt }
            };

            Dictionary<string, object> ram = new Dictionary<string, object>();
            ram["quarter"] = quarter.ToDictionary();
            ram["gameClockSeconds"] = gameClock.ToDictionary();
            ram["playClock"] = playClock.ToDictionary();
            ram["awayScore"] = awayScore.ToDictionary();
            ram["homeScore"] = homeScore.ToDictionary();
            ram["possessionAwayIsOne"] = possession.ToDictionary();
            ram["possessionRaw"] = rawPossession.ToDictionary();
            ram["down"] = down.ToDictionary();
            ram["distance"] = distance.ToDictionary();
            ram["awayTimeouts"] = awayTimeouts.ToDictionary();
            ram["homeTimeouts"] = homeTimeouts.ToDictionary();
            ram["awayRank"] = awayRank.ToDictionary();
            ram["homeRank"] = homeRank.ToDictionary();
            ram["awayRecord"] = awayRecord;
            ram["homeRecord"] = homeRecord;
            ram["scoreHudDownDistance"] = ScoreHudDownDistanceDictionary(scoreHudDownDistance);
            ram["scoreHudMessage"] = ScoreHudMessageDictionary(CurrentScoreHudMessage());
            // Raw pass-through of the game's banner messages (flags, touchdown
            // announcements, milestones): newest last, deduplicated, capped.
            // Consumers parse or ignore as they see fit.
            ram["recentMessages"] = new List<Dictionary<string, object>>(recentScoreHudMessages);
            // EXPERIMENTAL (probe game 2026-08-18): a byte just below the live
            // game record flips 1->0 when the play-call menu opens and back to
            // 1 at the snap, in four mirrored copies. Published as a candidate
            // for the app's optional hide-during-play-call; null unless all
            // copies agree.
            ram["playCallOpen"] = ReadPlayCallOpenCandidate();
            // The penalty being announced (type + offense/defense), from the
            // strings the game builds for commentary/referee presentation
            // ~10 s after the FLAG banner. Held for 45 s, then cleared.
            ram["penalty"] = CurrentPenaltyDictionary();
            // Stat lower-thirds and other ScoreHud text objects, passed through
            // raw (newest scan). Experimental: layout not decoded yet.
            ram["hudTexts"] = HudTextsDictionary();
            // Post-patch offset re-derivation, when it has happened - so a
            // tester zip shows at a glance that this session self-repaired.
            if (scoreHudRebaseSummary != null) ram["scoreHudRebase"] = scoreHudRebaseSummary;
            if (GameProfile.Key == "cfb27")
            {
                List<Dictionary<string, object>> tableRows = StatTableWatchRows();
                if (tableRows.Count > 0) ram["statTable"] = tableRows;
                if (lastValueHuntState.Length > 0)
                    ram["valueHunt"] = new Dictionary<string, object>
                    {
                        { "label", valueHuntLabel },
                        { "state", lastValueHuntState },
                        { "survivors", lastValueHuntSurvivors },
                        { "at", lastValueHuntStamp }
                    };
            }
            string publishedAwayName = matchupTransitionPending ? null : lastAwayTeamName;
            string publishedHomeName = matchupTransitionPending ? null : lastHomeTeamName;
            ram["awayTeamName"] = TeamNameDictionary(publishedAwayName, publishedAwayRead);
            ram["homeTeamName"] = TeamNameDictionary(publishedHomeName, publishedHomeRead);
            DateTime freshnessNowUtc = DateTime.UtcNow;
            NoteRead("quarter", quarter, freshnessNowUtc);
            NoteRead("gameClockSeconds", gameClock, freshnessNowUtc);
            NoteRead("playClock", playClock, freshnessNowUtc);
            NoteRead("awayScore", awayScore, freshnessNowUtc);
            NoteRead("homeScore", homeScore, freshnessNowUtc);
            NoteRead("possessionAwayIsOne", possession, freshnessNowUtc);
            NoteRead("down", down, freshnessNowUtc);
            NoteRead("distance", distance, freshnessNowUtc);
            NoteRead("awayTimeouts", awayTimeouts, freshnessNowUtc);
            NoteRead("homeTimeouts", homeTimeouts, freshnessNowUtc);
            NoteRead("awayRank", awayRank, freshnessNowUtc);
            NoteRead("homeRank", homeRank, freshnessNowUtc);
            NotePublishedFieldValue(publishedFieldValues, publishedFieldChangedAt,
                "awayRecord", awayRecord, freshnessNowUtc);
            NotePublishedFieldValue(publishedFieldValues, publishedFieldChangedAt,
                "homeRecord", homeRecord, freshnessNowUtc);
            NotePublishedFieldValue(publishedFieldValues, publishedFieldChangedAt,
                "awayTeamName", publishedAwayName, freshnessNowUtc);
            NotePublishedFieldValue(publishedFieldValues, publishedFieldChangedAt,
                "homeTeamName", publishedHomeName, freshnessNowUtc);
            NotePublishedFieldValue(publishedFieldValues, publishedFieldChangedAt,
                "awayPresentationId", scoreHudTeamIdentityAvailable
                    ? awayTeamIdentity.TeamId.ToString(CultureInfo.InvariantCulture) : null, freshnessNowUtc);
            NotePublishedFieldValue(publishedFieldValues, publishedFieldChangedAt,
                "homePresentationId", scoreHudTeamIdentityAvailable
                    ? homeTeamIdentity.TeamId.ToString(CultureInfo.InvariantCulture) : null, freshnessNowUtc);
            ram["freshness"] = BuildFreshness(freshnessNowUtc);
            root["ram"] = ram;

            Dictionary<string, object> screenSnapshot = ScreenSnapshot(screen);
            root["screenReader"] = screenSnapshot;

            bool awayPossession = possession.Available && possession.Value == 1;
            bool homePossession = possession.Available && possession.Value == 0;
            object exportedAwayScore = awayScore.Available ? (object)awayScore.Value : (screen == null ? null : (object)screen.AwayScore);
            object exportedHomeScore = homeScore.Available ? (object)homeScore.Value : (screen == null ? null : (object)screen.HomeScore);

            string exportedAwayName = !String.IsNullOrWhiteSpace(publishedAwayName)
                ? publishedAwayName
                : (screen != null && !String.IsNullOrWhiteSpace(screen.AwayName) ? screen.AwayName : "Away");
            string exportedHomeName = !String.IsNullOrWhiteSpace(publishedHomeName)
                ? publishedHomeName
                : (screen != null && !String.IsNullOrWhiteSpace(screen.HomeName) ? screen.HomeName : "Home");
            string awayNameSource = !String.IsNullOrWhiteSpace(publishedAwayName)
                ? (publishedAwayRead.Available ? "ram" : "ram-cached")
                : "ram-pending";
            string homeNameSource = !String.IsNullOrWhiteSpace(publishedHomeName)
                ? (publishedHomeRead.Available ? "ram" : "ram-cached")
                : "ram-pending";

            root["away"] = new Dictionary<string, object>
            {
                { "name", exportedAwayName },
                { "nameSource", awayNameSource },
                { "presentationId", scoreHudTeamIdentityAvailable ? (object)awayTeamIdentity.TeamId : null },
                { "presentationIdSource", scoreHudTeamIdentityAvailable ? "ram-scorehud" : "missing" },
                { "isTeamBuilder", scoreHudTeamIdentityAvailable ? (object)(awayTeamIdentity.IsTeambuilder == 1) : null },
                { "isTeamBuilderSource", scoreHudTeamIdentityAvailable ? "ram-scorehud" : "missing" },
                { "rank", awayRank.Available && awayRank.Value > 0 ? (object)awayRank.Value : null },
                { "rankSource", awayRank.Available ? "ram" : "missing" },
                { "record", awayRecord },
                { "recordSource", awayRecord != null ? "ram" : "missing" },
                { "score", exportedAwayScore },
                { "scoreSource", awayScore.Available ? "ram" : "screen" },
                { "timeouts", awayTimeouts.Available ? (object)awayTimeouts.Value : null },
                { "timeoutsSource", "ram" },
                { "possession", possession.Available ? (object)awayPossession : null },
                { "possessionSource", "ram" }
            };
            root["home"] = new Dictionary<string, object>
            {
                { "name", exportedHomeName },
                { "nameSource", homeNameSource },
                { "presentationId", scoreHudTeamIdentityAvailable ? (object)homeTeamIdentity.TeamId : null },
                { "presentationIdSource", scoreHudTeamIdentityAvailable ? "ram-scorehud" : "missing" },
                { "isTeamBuilder", scoreHudTeamIdentityAvailable ? (object)(homeTeamIdentity.IsTeambuilder == 1) : null },
                { "isTeamBuilderSource", scoreHudTeamIdentityAvailable ? "ram-scorehud" : "missing" },
                { "rank", homeRank.Available && homeRank.Value > 0 ? (object)homeRank.Value : null },
                { "rankSource", homeRank.Available ? "ram" : "missing" },
                { "record", homeRecord },
                { "recordSource", homeRecord != null ? "ram" : "missing" },
                { "score", exportedHomeScore },
                { "scoreSource", homeScore.Available ? "ram" : "screen" },
                { "timeouts", homeTimeouts.Available ? (object)homeTimeouts.Value : null },
                { "timeoutsSource", "ram" },
                { "possession", possession.Available ? (object)homePossession : null },
                { "possessionSource", "ram" }
            };

            int clockValue = gameClock.Available ? gameClock.Value : (screen == null ? 0 : screen.GameClockSeconds);
            int quarterValue = quarter.Available ? quarter.Value : (screen == null ? 0 : screen.QuarterNumber);
            int playClockValue = playClock.Available ? playClock.Value : (screen == null ? 0 : screen.PlayClock);
            int downValue = stableDownRead.Available ? stableDownRead.Value : (screen == null ? 0 : screen.Down);
            int distanceValue = stableDistanceRead.Available ? stableDistanceRead.Value : (screen == null ? 0 : screen.Distance);
            object exportedDown = downValue;
            object exportedDistance = distanceValue;
            string downDistanceKind = "numeric";
            string downDistanceText = FormatDownDistance(downValue, distanceValue);
            if (scoreHudSpecialPending
                || (stableDownRead.Available && stableDistanceRead.Available
                    && distanceValue == 0))
            {
                // Zero is shared by Goal and Inches in the numeric core.  Do
                // not draw an incorrect yardage label while the active
                // ScoreHud special layer is being resolved.
                exportedDown = null;
                exportedDistance = null;
                downDistanceKind = "pendingSpecial";
                downDistanceText = String.Empty;
            }
            // Precise yardage: trusted only when both float copies agree
            // (fail closed). It refines the numeric distance and resolves the
            // Goal/Inches-pending ambiguity for the inches case.
            double preciseYards = double.NaN;
            {
                List<long> quarterAddressList = CopyConfiguredAddresses("quarter");
                string coreSignature = ConfiguredCoreSignature();
                if (quarterAddressList.Count == 1 && coreSignature.EndsWith(":W", StringComparison.Ordinal))
                {
                    try
                    {
                        long block = quarterAddressList[0] - 0xC8;
                        byte[] preciseBytes = scanner.ReadBytes(block + 0xA8, 4);
                        byte[] copyBytes = scanner.ReadBytes(block + 0xD8, 4);
                        float primary = BitConverter.ToSingle(preciseBytes, 0);
                        float copy = BitConverter.ToSingle(copyBytes, 0);
                        if (!float.IsNaN(primary) && !float.IsInfinity(primary)
                            && primary >= 0f && primary <= 120f
                            && PreciseYardsPairAgrees(primary, copy))
                            preciseYards = primary;
                    }
                    catch { }
                }
            }
            if (!double.IsNaN(preciseYards) && downDistanceKind == "numeric"
                && stableDownRead.Available && stableDistanceRead.Available
                && Math.Abs(DistanceFromPreciseYards(preciseYards) - distanceValue) <= 1)
            {
                // Same play, better number: the game's bug shows ceil(float).
                exportedDistance = DistanceFromPreciseYards(preciseYards);
                downDistanceText = FormatDownDistance(downValue, DistanceFromPreciseYards(preciseYards));
            }
            if (!double.IsNaN(preciseYards) && downDistanceKind == "pendingSpecial"
                && stableDownRead.Available && PreciseYardsAreInches(preciseYards))
            {
                // Distance zero + a sub-yard float is Inches, no HUD object needed.
                exportedDown = downValue;
                exportedDistance = null;
                downDistanceKind = "inches";
                downDistanceText = FormatSpecialDownDistance(downValue, "Inches");
            }
            if (scoreHudDownDistance != null && !scoreHudDownDistance.IsEmpty)
            {
                string scoreHudDisplay = (scoreHudDownDistance.Display ?? String.Empty).Trim();
                string scoreHudDisplayUpper = scoreHudDisplay.ToUpperInvariant();
                if (scoreHudDownDistance.Down == 0)
                {
                    exportedDown = null;
                    exportedDistance = null;
                    downDistanceKind = "kickoff";
                    downDistanceText = "Kickoff";
                }
                else if (scoreHudDownDistance.Down == -1)
                {
                    exportedDown = null;
                    exportedDistance = null;
                    if (quarterValue >= 6)
                    {
                        downDistanceKind = "twoPointConversion";
                        downDistanceText = "2PT Conversion";
                    }
                    else
                    {
                        // A pooled Down -1 object proves a conversion
                        // presentation, but its retained text does not safely
                        // distinguish PAT from 2PT. Second overtime and later
                        // is necessarily 2PT; otherwise stay generic.
                        downDistanceKind = "conversion";
                        downDistanceText = "Conversion";
                    }
                }
                else if (scoreHudDownDistance.Down >= 1 && scoreHudDownDistance.Down <= 4
                    && scoreHudDisplayUpper.Contains("GOAL"))
                {
                    exportedDown = scoreHudDownDistance.Down;
                    exportedDistance = 0;
                    downDistanceKind = "goal";
                    downDistanceText = FormatSpecialDownDistance(scoreHudDownDistance.Down, "Goal");
                }
                else if (scoreHudDownDistance.Down >= 1 && scoreHudDownDistance.Down <= 4
                    && scoreHudDisplayUpper.Contains("INCH"))
                {
                    exportedDown = scoreHudDownDistance.Down;
                    exportedDistance = null;
                    downDistanceKind = "inches";
                    downDistanceText = FormatSpecialDownDistance(scoreHudDownDistance.Down, "Inches");
                }
                else
                {
                    int displayedDown;
                    int displayedDistance;
                    // The HUD text is what the game draws. The core int is the
                    // yardage truncated ("1st & 9" while the bug says 10), so a
                    // live same-down HUD text within a yard wins over the int.
                    if (TryParseNumericScoreHudDisplay(scoreHudDisplay, out displayedDown, out displayedDistance)
                        && stableDownRead.Available && stableDistanceRead.Available
                        && displayedDown == stableDownRead.Value
                        && HudDistanceAgreesWithCore(displayedDistance, stableDistanceRead.Value))
                    {
                        exportedDown = displayedDown;
                        exportedDistance = displayedDistance;
                        downDistanceKind = "numeric";
                        downDistanceText = FormatDownDistance(displayedDown, displayedDistance);
                    }
                }
            }
            // Tonight's research (CFB27): full dumps of every NEW stat-banner /
            // identity object (statbanner-probe.jsonl) and, whenever any live
            // text mentions a field goal, a snapshot of the whole scoreboard
            // block (fgspot-probe.jsonl) - the FG text's own yardage minus 17
            // is the yards-to-goal ground truth that identifies the ball-spot
            // slot after a couple of attempts.
            try { RefreshScoreHudTextsFast(); } catch { }
            try { MaybeRebaseScoreHudOffsets(downValue, distanceValue, downDistanceKind); } catch { }
            try { RefreshPlayCallFieldGoalText(downValue); } catch { }
            try { ProcessManualStatHunt(); } catch { }
            try { ProbeMaterializedStatTable(probeOutputSeedPath); } catch { }
            try { ProcessValueHunt(); } catch { }
            try { WriteStatBannerProbe(screenJsonPath, quarterValue, clockValue, downValue, distanceValue); } catch { }
            if (GameProfile.Key == "madden27")
            {
                // Madden: records + the game's own per-team stat lines come
                // from the scoreboard ticker object (round 7), and timeouts
                // are found by watching the scoreboard block for a legal
                // 3->2->1->0 burn (Madden has no ScoreHud team objects).
                try { ram["maddenTicker"] = MaddenTickerEntries(); } catch { }
                try { MaddenWatchTimeoutSlots(screenJsonPath, quarterValue, clockValue); } catch { }
                try { MaddenWatchTeamObjectTimeouts(screenJsonPath, quarterValue, clockValue); } catch { }
                try { ram["maddenTimeouts"] = MaddenTimeoutDictionary(); } catch { }
            }
            root["game"] = new Dictionary<string, object>
            {
                { "quarter", quarterValue },
                { "quarterText", FormatQuarter(quarterValue) },
                { "quarterSource", quarter.Available ? "ram" : "screen" },
                { "clockSeconds", clockValue },
                { "clock", FormatClock(clockValue) },
                { "clockSource", gameClock.Available ? "ram" : "screen" },
                { "playClock", playClockValue },
                { "playClockSource", playClock.Available ? "ram" : "screen" },
                { "down", exportedDown },
                { "distance", exportedDistance },
                { "downDistance", downDistanceText },
                { "downDistanceKind", downDistanceKind },
                { "distancePrecise", double.IsNaN(preciseYards) ? null : (object)Math.Round(preciseYards, 3) },
                // During the FG presentation the precise slot IS the kick
                // distance; published only while the game's own FIELD GOAL
                // text is up and the value is a legal kick length.
                { "fieldGoalDistance", CurrentFieldGoalDistance(preciseYards, distanceValue, downValue, downDistanceKind) },
                { "downDistanceSource", downDistanceKind != "numeric" || (stableDownRead.Available && stableDistanceRead.Available) ? "ram" : "screen" }
            };

            root["discovery"] = new Dictionary<string, object>
            {
                { "workingRamFields", new string[] { "awayTeamName", "homeTeamName", "teamIdentity", "awayRank", "homeRank", "awayRecord", "homeRecord", "awayScore", "homeScore", "quarter", "gameClock", "playClock", "possession", "down", "distance", "specialDownState", "homeTimeouts", "awayTimeouts" } },
                { "screenBackedFields", new string[0] },
                { "remainingRamWork", new string[0] },
                { "automaticLocator", autoDiscoverySummary },
                { "liveLoop", slowRefreshCount == 0
                    ? "no slow ticks (worst " + worstRefreshMs.ToString(CultureInfo.InvariantCulture) + "ms)"
                    : slowRefreshCount.ToString(CultureInfo.InvariantCulture) + " slow tick(s) >= "
                        + SlowRefreshThresholdMs.ToString(CultureInfo.InvariantCulture) + "ms, worst "
                        + worstRefreshMs.ToString(CultureInfo.InvariantCulture) + "ms, last "
                        + ((int)(DateTime.UtcNow - lastSlowRefreshUtc).TotalSeconds).ToString(CultureInfo.InvariantCulture) + "s ago" },
                { "coreCrossCheck", lastCoreCrossCheckUtc == DateTime.MinValue
                    ? "not yet re-verified by an independent full read"
                    : "independent full read agreed " + coreCrossCheckAgreements.ToString(CultureInfo.InvariantCulture)
                        + "x, disagreed " + coreCrossCheckDisagreements.ToString(CultureInfo.InvariantCulture)
                        + "x, last " + ((int)(DateTime.UtcNow - lastCoreCrossCheckUtc).TotalSeconds).ToString(CultureInfo.InvariantCulture) + "s ago" },
                { "timeoutBind", timeoutBindDiagnostic },
                { "timeoutHud", hudTimeoutsDiagnostic },
                { "timeoutInstall", timeoutInstallDiagnostic },
                { "timeoutCatalog", catalogTimeoutDiagnostic },
                { "rankBind", rankBindDiagnostic },
                { "teamIdNames", teamIdNamesDiagnostic },
                { "teamIdentityBind", scoreHudTeamIdentityDiagnostic },
                { "teamRole", teamRoleDiagnostic },
                { "matchupBind", matchupBindDiagnostic },
                { "possessionBind", possessionBindDiagnostic },
                { "possessionProbe", possessionProbeSummary },
                { "scoreboardCandidates", scoreboardCandidateCount },
                { "scoreHudDownDistanceCandidates", scoreHudDownDistanceCandidateCount },
                { "ramScoreMatchesScreenSnapshot", screen != null && awayScore.Available && homeScore.Available
                    && awayScore.Value == screen.AwayScore && homeScore.Value == screen.HomeScore }
            };

            string outputPath = OutputPath(screenJsonPath);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = Int32.MaxValue;
            WriteSharedText(outputPath, serializer.Serialize(root));
            lastPublishedProcessId = scanner.Process.Id;

            return String.Format(CultureInfo.InvariantCulture,
                MaddenNoteLiveValues(awayScore, homeScore, screenJsonPath),
                FormatQuarter(quarterValue), FormatClock(clockValue), playClockValue, downDistanceText,
                possession.Available ? (awayPossession ? "away" : "home") : "unknown",
                awayTimeouts.Available ? awayTimeouts.Value.ToString(CultureInfo.InvariantCulture) : "?",
                homeTimeouts.Available ? homeTimeouts.Value.ToString(CultureInfo.InvariantCulture) : "?",
                outputPath);
        }

        private void WriteResearchProbes(string screenJsonPath,
            RamReadResult rawPossession, RamReadResult verifiedPossession,
            RamReadResult quarter, RamReadResult gameClock,
            RamReadResult awayScore, RamReadResult homeScore,
            RamReadResult down, RamReadResult distance,
            ScoreHudDownDistanceCandidate scoreHudDownDistance)
        {
            try
            {
                WritePossessionProbe(screenJsonPath, rawPossession, verifiedPossession,
                    quarter, gameClock, awayScore, homeScore, down, distance);
            }
            catch { possessionProbeSummary = "probe failed"; }
            try
            {
                WriteBallSpotProbe(screenJsonPath, quarter, gameClock,
                    down, distance, scoreHudDownDistance);
            }
            catch { }
            try
            {
                WriteHudStateProbe(screenJsonPath, quarter, gameClock,
                    Read("playClock", 0, 99), down, distance);
            }
            catch { }
            try
            {
                WriteStatsProbe(screenJsonPath, quarter, gameClock, awayScore, homeScore, down, distance);
            }
            catch { }
            try
            {
                WriteToggleProbe(screenJsonPath, quarter, gameClock, Read("playClock", 0, 99), down, distance);
            }
            catch { }
            try
            {
                MaybeRunPenaltyProbeBaseline(screenJsonPath, quarter, gameClock);
            }
            catch { }
            try { MaybeRunStatsSearch(screenJsonPath); } catch { }
        }

        // ---- RESEARCH PROBE: live game/team stats -----------------------------
        // Hunts for the running box-score block. Every down change (the same
        // trigger the ball-spot probe uses) it snapshots a 512 KB window around
        // the live game record and logs the int32 slots that ROSE by a stat-
        // like step and never went down all game. Post-game, the offsets whose
        // rises track the real box score (first downs, yards, attempts,
        // penalties, TOP...) are the block we want.
        private const int StatsProbeWindowBefore = 0x40000;
        private const int StatsProbeWindowLength = 0x80000;
        private string statsProbeSignature;
        private int[] statsProbePrevious;
        private bool[] statsProbeDisqualified;
        private int[] statsProbeRises;
        private long statsProbeBase;
        private int statsProbeTicks;

        private void WriteStatsProbe(string screenJsonPath, RamReadResult quarter, RamReadResult gameClock,
            RamReadResult awayScore, RamReadResult homeScore, RamReadResult down, RamReadResult distance)
        {
            if (!down.Available || !distance.Available) return;
            List<long> quarterAddresses = CopyConfiguredAddresses("quarter");
            if (quarterAddresses.Count != 1) return;
            string signature = down.Value + "|" + distance.Value + "|"
                + (awayScore.Available ? awayScore.Value : -1) + "|" + (homeScore.Available ? homeScore.Value : -1)
                + "|" + (quarter.Available ? quarter.Value : -1);
            if (String.Equals(signature, statsProbeSignature, StringComparison.Ordinal)) return;
            statsProbeSignature = signature;

            long block = quarterAddresses[0] - 0xC8;
            long windowBase = block - StatsProbeWindowBefore;
            if (windowBase < 0) windowBase = 0;
            byte[] bytes;
            try { bytes = scanner.ReadBytes(windowBase, StatsProbeWindowLength); }
            catch { return; }
            int slots = bytes.Length / 4;
            int[] current = new int[slots];
            for (int index = 0; index < slots; index++) current[index] = BitConverter.ToInt32(bytes, index * 4);

            if (statsProbePrevious == null || statsProbeBase != windowBase || statsProbePrevious.Length != slots)
            {
                statsProbePrevious = current;
                statsProbeBase = windowBase;
                statsProbeDisqualified = new bool[slots];
                statsProbeRises = new int[slots];
                statsProbeTicks = 0;
                Dictionary<string, object> start = new Dictionary<string, object>
                {
                    { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "kind", "window" },
                    { "windowBase", "0x" + windowBase.ToString("X", CultureInfo.InvariantCulture) },
                    { "gameRecord", "0x" + block.ToString("X", CultureInfo.InvariantCulture) },
                    { "length", StatsProbeWindowLength },
                    { "note", "offsets below are relative to windowBase; the live game record sits at +0x40000" }
                };
                AppendProbeLine(screenJsonPath, "stats-probe.jsonl", start);
                return;
            }

            statsProbeTicks++;
            Dictionary<int, int[]> rises = ResearchProbeHelpers.DiffMonotonicCounters(
                statsProbePrevious, current, statsProbeDisqualified, statsProbeRises, 5000, 200, 400);
            statsProbePrevious = current;
            Dictionary<string, object> up = new Dictionary<string, object>();
            foreach (KeyValuePair<int, int[]> rise in rises)
                up["0x" + (rise.Key * 4).ToString("X", CultureInfo.InvariantCulture)] = rise.Value;

            Dictionary<string, object> entry = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "kind", "tick" },
                { "quarter", quarter.Available ? (object)quarter.Value : null },
                { "clock", gameClock.Available ? (object)gameClock.Value : null },
                { "awayScore", awayScore.Available ? (object)awayScore.Value : null },
                { "homeScore", homeScore.Available ? (object)homeScore.Value : null },
                { "down", down.Value },
                { "distance", distance.Value },
                { "riseCount", rises.Count },
                { "up", up }
            };
            AppendProbeLine(screenJsonPath, "stats-probe.jsonl", entry);

            // Every 8th tick, the running shortlist: slots that rose at least
            // three times and never fell - the candidates worth matching to
            // the box score.
            if (statsProbeTicks % 8 == 0)
            {
                Dictionary<string, object> steady = new Dictionary<string, object>();
                int listed = 0;
                for (int index = 0; index < slots && listed < 600; index++)
                {
                    if (statsProbeDisqualified[index] || statsProbeRises[index] < 3) continue;
                    steady["0x" + (index * 4).ToString("X", CultureInfo.InvariantCulture)] = new int[] { statsProbeRises[index], current[index] };
                    listed++;
                }
                Dictionary<string, object> summary = new Dictionary<string, object>
                {
                    { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "kind", "steady" },
                    { "ticks", statsProbeTicks },
                    { "quarter", quarter.Available ? (object)quarter.Value : null },
                    { "clock", gameClock.Available ? (object)gameClock.Value : null },
                    { "awayScore", awayScore.Available ? (object)awayScore.Value : null },
                    { "homeScore", homeScore.Available ? (object)homeScore.Value : null },
                    { "candidates", steady }
                };
                AppendProbeLine(screenJsonPath, "stats-probe.jsonl", summary);
            }
        }

        // ---- Play-call menu candidate (from the toggle probe) ------------------
        // Offsets relative to the live game record (quarter address - 0xC8):
        // -0x118, -0xF8, -0x70, -0x50 read 0 while the picker is open, 1
        // otherwise; -0xF0 and -0x48 are the inverse. All six must agree.
        private static readonly int[] PlayCallZeroWhenOpen = new int[] { -0x118, -0xF8, -0x70, -0x50 };
        private static readonly int[] PlayCallOneWhenOpen = new int[] { -0xF0, -0x48 };
        private int lastPlayCallState = -1;
        private object ReadPlayCallOpenCandidate()
        {
            try
            {
                List<long> quarterAddresses = CopyConfiguredAddresses("quarter");
                if (quarterAddresses.Count != 1) return null;
                long block = quarterAddresses[0] - 0xC8;
                byte[] bytes = scanner.ReadBytes(block - 0x120, 0x120);
                int expectZero = -1;
                foreach (int offset in PlayCallZeroWhenOpen)
                {
                    int value = bytes[offset + 0x120];
                    if (value > 1) return null;
                    if (expectZero == -1) expectZero = value;
                    else if (expectZero != value) return null;
                }
                foreach (int offset in PlayCallOneWhenOpen)
                {
                    int value = bytes[offset + 0x120];
                    if (value > 1 || value == expectZero) return null;
                }
                bool open = expectZero == 0;
                int state = open ? 1 : 0;
                if (state != lastPlayCallState)
                {
                    lastPlayCallState = state;
                    RamReadResult quarter = Read("quarter", 1, 20);
                    RamReadResult clock = Read("gameClockSeconds", 0, 3600);
                    RamReadResult playClock = Read("playClock", 0, 99);
                    Dictionary<string, object> entry = new Dictionary<string, object>
                    {
                        { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                        { "open", open },
                        { "quarter", quarter.Available ? (object)quarter.Value : null },
                        { "clock", clock.Available ? (object)clock.Value : null },
                        { "playClock", playClock.Available ? (object)playClock.Value : null }
                    };
                    AppendProbeLine(probeOutputSeedPath, "playcall-probe.jsonl", entry);
                }
                return open;
            }
            catch { return null; }
        }

        // ---- RESEARCH PROBE: play-call menu (byte toggles) -------------------
        // Every ~250 ms, the bytes within +-8 KB of the live game record that
        // flipped between tiny values (0..3). A menu-open flag flips exactly
        // when the picker opens and closes; the tester notes those moments (or
        // we correlate with the play-clock reset) and the offset falls out.
        private const int ToggleProbeRadius = 0x2000;
        private byte[] toggleProbePrevious;
        private long toggleProbeBase;
        private DateTime toggleProbeLastUtc = DateTime.MinValue;

        private void WriteToggleProbe(string screenJsonPath, RamReadResult quarter, RamReadResult gameClock,
            RamReadResult playClock, RamReadResult down, RamReadResult distance)
        {
            DateTime now = DateTime.UtcNow;
            if ((now - toggleProbeLastUtc).TotalMilliseconds < 250) return;
            toggleProbeLastUtc = now;
            List<long> quarterAddresses = CopyConfiguredAddresses("quarter");
            if (quarterAddresses.Count != 1) return;
            long block = quarterAddresses[0] - 0xC8;
            long windowBase = block - ToggleProbeRadius;
            if (windowBase < 0) windowBase = 0;
            byte[] bytes;
            try { bytes = scanner.ReadBytes(windowBase, ToggleProbeRadius * 2); }
            catch { return; }
            if (toggleProbePrevious == null || toggleProbeBase != windowBase || toggleProbePrevious.Length != bytes.Length)
            {
                toggleProbePrevious = bytes;
                toggleProbeBase = windowBase;
                Dictionary<string, object> start = new Dictionary<string, object>
                {
                    { "t", now.ToString("o", CultureInfo.InvariantCulture) },
                    { "kind", "window" },
                    { "windowBase", "0x" + windowBase.ToString("X", CultureInfo.InvariantCulture) },
                    { "gameRecord", "0x" + block.ToString("X", CultureInfo.InvariantCulture) },
                    { "note", "offsets are relative to windowBase; the game record sits at +0x2000; only byte flips between 0..3 are logged" }
                };
                AppendProbeLine(screenJsonPath, "toggle-probe.jsonl", start);
                return;
            }
            Dictionary<int, int[]> changes = ResearchProbeHelpers.DiffSmallBytes(toggleProbePrevious, bytes, 3, 80);
            toggleProbePrevious = bytes;
            if (changes.Count == 0) return;
            Dictionary<string, object> flips = new Dictionary<string, object>();
            foreach (KeyValuePair<int, int[]> change in changes)
                flips["0x" + change.Key.ToString("X", CultureInfo.InvariantCulture)] = change.Value;
            Dictionary<string, object> entry = new Dictionary<string, object>
            {
                { "t", now.ToString("o", CultureInfo.InvariantCulture) },
                { "kind", "flip" },
                { "quarter", quarter.Available ? (object)quarter.Value : null },
                { "clock", gameClock.Available ? (object)gameClock.Value : null },
                { "playClock", playClock.Available ? (object)playClock.Value : null },
                { "down", down.Available ? (object)down.Value : null },
                { "distance", distance.Available ? (object)distance.Value : null },
                { "flips", flips }
            };
            AppendProbeLine(screenJsonPath, "toggle-probe.jsonl", entry);
        }

        // ---- RESEARCH PROBE: box score by known values (round 2) ---------------
        // Round 1 proved the box score does NOT live within 256 KB of the game
        // record. Round 2 is tester-assisted: at halftime the tester types the
        // stats screen into the app, which writes probe-request.json next to
        // the live file; the reader searches the whole private heap below
        // 4 GB for clusters of those exact numbers (int32 and int16 layouts)
        // and dumps each cluster with its neighbourhood.
        private DateTime statsRequestLastCheckUtc = DateTime.MinValue;
        private DateTime statsRequestHandledUtc = DateTime.MinValue;
        private int statsSearchRunning;

        private void MaybeRunStatsSearch(string screenJsonPath)
        {
            if (String.IsNullOrWhiteSpace(screenJsonPath)) return;
            if ((DateTime.UtcNow - statsRequestLastCheckUtc).TotalSeconds < 2) return;
            statsRequestLastCheckUtc = DateTime.UtcNow;
            string folder = Path.GetDirectoryName(screenJsonPath);
            if (String.IsNullOrWhiteSpace(folder)) return;
            string requestPath = Path.Combine(folder, "probe-request.json");
            if (!File.Exists(requestPath)) return;
            DateTime written = File.GetLastWriteTimeUtc(requestPath);
            if (written <= statsRequestHandledUtc) return;
            statsRequestHandledUtc = written;
            if (Interlocked.CompareExchange(ref statsSearchRunning, 1, 0) != 0) return;
            string json;
            try { json = File.ReadAllText(requestPath); } catch { Interlocked.Exchange(ref statsSearchRunning, 0); return; }
            RamReadResult quarter = Read("quarter", 1, 20);
            RamReadResult clock = Read("gameClockSeconds", 0, 3600);
            int quarterValue = quarter.Available ? quarter.Value : -1;
            int clockValue = clock.Available ? clock.Value : -1;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { RunStatsSearch(screenJsonPath, json, quarterValue, clockValue); }
                catch (Exception error)
                {
                    Dictionary<string, object> failed = new Dictionary<string, object>
                    {
                        { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                        { "kind", "error" }, { "error", error.Message }
                    };
                    AppendProbeLine(screenJsonPath, "stats-search.jsonl", failed);
                }
                finally { Interlocked.Exchange(ref statsSearchRunning, 0); }
            });
        }

        private void RunStatsSearch(string screenJsonPath, string requestJson, int quarter, int clock)
        {
            Stopwatch watch = Stopwatch.StartNew();
            Dictionary<string, object> request = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(requestJson);
            List<int> values = new List<int>();
            Dictionary<string, object> echo = new Dictionary<string, object>();
            foreach (KeyValuePair<string, object> item in request)
            {
                int parsed;
                if (item.Value != null && Int32.TryParse(Convert.ToString(item.Value, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
                {
                    values.Add(parsed);
                    echo[item.Key] = parsed;
                }
            }
            Dictionary<string, object> header = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "kind", "start" }, { "quarter", quarter }, { "clock", clock }, { "request", echo }
            };
            AppendProbeLine(screenJsonPath, "stats-search.jsonl", header);
            if (values.Count == 0) return;
            List<MemoryScanner.ValueCluster> clusters = scanner.FindValueClustersBelow4G(values.ToArray(), 256, 5, 200);
            int written = 0;
            foreach (MemoryScanner.ValueCluster cluster in clusters)
            {
                byte[] around;
                try { around = scanner.ReadBytes(Math.Max(0, cluster.Start - 64), 64 + 320); }
                catch { continue; }
                Dictionary<string, object> entry = new Dictionary<string, object>
                {
                    { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "kind", "cluster" },
                    { "start", "0x" + cluster.Start.ToString("X", CultureInfo.InvariantCulture) },
                    { "width", cluster.Width },
                    { "distinct", cluster.DistinctValues },
                    { "hits", cluster.Hits },
                    { "ints", ResearchProbeHelpers.Int32Window(around, 64, 80) },
                    { "shorts", ResearchProbeHelpers.Int16Window(around, 64, 80) }
                };
                AppendProbeLine(screenJsonPath, "stats-search.jsonl", entry);
                written++;
            }
            Dictionary<string, object> footer = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "kind", "done" }, { "clusters", written }, { "elapsedMs", watch.ElapsedMilliseconds }
            };
            AppendProbeLine(screenJsonPath, "stats-search.jsonl", footer);
        }

        // ---- RESEARCH PROBE: penalty card (type + player) ---------------------
        // The FLAG banner we already read carries no type or player. The
        // result card that shows "Holding - Offense - #72" must hold that data
        // in an object of its own. Twice per flag (at the banner, and ~25 s
        // later when the card is gone) plus once at baseline, this logs:
        //   * every occurrence of a penalty word in the ScoreHud heap window,
        //     with the 32 ints around it (a player id / team id / yards sit
        //     near the text in a typical UI record), and
        //   * every heap object whose vtable sits in the ScoreHud vtable
        //     neighbourhood (the family the team/message/down objects belong
        //     to), with its first 32 ints and any strings it points at.
        // Text present at the flag but gone afterwards is the live card.
        private const int PenaltyFlagMessageId = 1150630092;
        private int penaltyProbeRunning;
        private readonly Queue<KeyValuePair<string, string>> penaltyProbeQueue = new Queue<KeyValuePair<string, string>>();
        private bool penaltyProbeBaselineDone;
        private DateTime penaltyProbeFlagUtc = DateTime.MinValue;
        private bool penaltyProbeAfterQueued;
        private bool penaltyProbeCardQueued;
        private DateTime firstLivePublishUtc = DateTime.MinValue;

        private void MaybeRunPenaltyProbeBaseline(string screenJsonPath, RamReadResult quarter, RamReadResult gameClock)
        {
            if (firstLivePublishUtc == DateTime.MinValue) firstLivePublishUtc = DateTime.UtcNow;
            if (!penaltyProbeBaselineDone && (DateTime.UtcNow - firstLivePublishUtc).TotalSeconds > 45)
            {
                penaltyProbeBaselineDone = true;
                StartPenaltyProbe(screenJsonPath, "baseline");
            }
            if (penaltyProbeCardQueued && (DateTime.UtcNow - penaltyProbeFlagUtc).TotalSeconds > 12)
            {
                // The referee announcement + result card come ~10 s after the
                // banner; the speech/NIS strings only exist then.
                penaltyProbeCardQueued = false;
                StartPenaltyProbe(screenJsonPath, "card");
            }
            if (penaltyProbeAfterQueued && (DateTime.UtcNow - penaltyProbeFlagUtc).TotalSeconds > 40)
            {
                penaltyProbeAfterQueued = false;
                StartPenaltyProbe(screenJsonPath, "after");
            }
        }

        private void NotePenaltyFlagForProbe(ScoreHudMessageCandidate message)
        {
            if (message == null) return;
            bool isFlag = message.MessageId == PenaltyFlagMessageId
                || String.Equals(message.DisplayText, "FLAG", StringComparison.OrdinalIgnoreCase)
                || String.Equals(message.InfoText, "PENALTY", StringComparison.OrdinalIgnoreCase);
            if (!isFlag) return;
            if ((DateTime.UtcNow - penaltyProbeFlagUtc).TotalSeconds < 20) return;
            penaltyProbeFlagUtc = DateTime.UtcNow;
            penaltyProbeAfterQueued = true;
            penaltyProbeCardQueued = true;
            BeginPenaltyRead();
            StartPenaltyProbe(probeOutputSeedPath, "flag");
        }

        // ---- Live penalty read (production) ------------------------------------
        // After a FLAG, poll the heap for the three anchors every few seconds
        // for 40 s; the first parse wins and is published for 45 s.
        private static readonly string[] PenaltyAnchors = new string[] { "ctxn=PENALTY_", "SoundWaves/bPENALTY_", "enabledState: 2" };
        private PenaltyRead currentPenalty;
        private DateTime currentPenaltyUtc = DateTime.MinValue;
        private DateTime currentPenaltyFlagUtc = DateTime.MinValue;
        private int penaltyReadRunning;
        private DateTime penaltyReadWindowEndUtc = DateTime.MinValue;
        private DateTime penaltyReadLastAttemptUtc = DateTime.MinValue;

        private void BeginPenaltyRead()
        {
            currentPenaltyFlagUtc = DateTime.UtcNow;
            penaltyReadWindowEndUtc = DateTime.UtcNow.AddSeconds(40);
            penaltyReadLastAttemptUtc = DateTime.MinValue;
            // A new flag supersedes whatever was announced before it.
            currentPenalty = null;
        }

        private void MaybeContinuePenaltyRead()
        {
            if (DateTime.UtcNow > penaltyReadWindowEndUtc) return;
            if (currentPenalty != null && currentPenaltyUtc >= currentPenaltyFlagUtc) return;
            if ((DateTime.UtcNow - penaltyReadLastAttemptUtc).TotalSeconds < 4) return;
            if (Interlocked.CompareExchange(ref penaltyReadRunning, 1, 0) != 0) return;
            penaltyReadLastAttemptUtc = DateTime.UtcNow;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    Dictionary<string, List<long>> hits = scanner.FindAsciiTextsPrivateBelow4G(PenaltyAnchors, 8);
                    PenaltyRead best = null;
                    string[] order = new string[] { "ctxn=PENALTY_", "SoundWaves/bPENALTY_", "enabledState: 2" };
                    foreach (string anchor in order)
                    {
                        List<long> addresses;
                        if (!hits.TryGetValue(anchor, out addresses)) continue;
                        foreach (long address in addresses)
                        {
                            byte[] around;
                            try { around = scanner.ReadBytes(Math.Max(0, address - 96), 96 + 160); } catch { continue; }
                            string text = ResearchProbeHelpers.AsciiRun(around, 0, 96) + ResearchProbeHelpers.AsciiPreview(around, 96, 160);
                            PenaltyRead read = PenaltyTextParser.Parse(text);
                            if (read != null && !String.IsNullOrEmpty(read.Type)) { best = read; break; }
                        }
                        if (best != null) break;
                    }
                    if (best != null)
                    {
                        currentPenalty = best;
                        currentPenaltyUtc = DateTime.UtcNow;
                    }
                }
                catch { }
                finally { Interlocked.Exchange(ref penaltyReadRunning, 0); }
            });
        }

        private List<Dictionary<string, object>> HudTextsDictionary()
        {
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            List<ScoreHudTextCandidate> texts = scanner.LastScoreHudTexts;
            if (texts == null) return list;
            foreach (ScoreHudTextCandidate item in texts)
            {
                if (item == null || item.Texts == null || item.Texts.Count == 0) continue;
                list.Add(new Dictionary<string, object>
                {
                    { "kind", item.Kind },
                    { "texts", new List<string>(item.Texts) },
                    { "playerId", item.PlayerId },
                    { "teamId", item.TeamId },
                    { "teamSide", MessageTeamSide(item.TeamId, orientedAwayScoreHudTeamId, orientedHomeScoreHudTeamId) },
                    { "displayTime", item.DisplayTime }
                });
                if (list.Count >= 12) break;
            }
            return list;
        }

        private Dictionary<string, object> CurrentPenaltyDictionary()
        {
            try { MaybeContinuePenaltyRead(); } catch { }
            PenaltyRead read = currentPenalty;
            if (read == null) return null;
            if ((DateTime.UtcNow - currentPenaltyUtc).TotalSeconds > 45) { currentPenalty = null; return null; }
            return new Dictionary<string, object>
            {
                { "type", read.Type },
                { "code", read.Code },
                { "side", read.Side },
                { "source", read.Source },
                { "flagAt", currentPenaltyFlagUtc.ToString("o", CultureInfo.InvariantCulture) },
                { "readAt", currentPenaltyUtc.ToString("o", CultureInfo.InvariantCulture) }
            };
        }

        private void StartPenaltyProbe(string screenJsonPath, string phase)
        {
            if (String.IsNullOrWhiteSpace(screenJsonPath)) return;
            if (Interlocked.CompareExchange(ref penaltyProbeRunning, 1, 0) != 0)
            {
                // A scan is running (the baseline took ~25 s in the probe game
                // and swallowed the flag scan). Queue it; the worker drains.
                lock (penaltyProbeQueue)
                {
                    if (penaltyProbeQueue.Count < 6) penaltyProbeQueue.Enqueue(new KeyValuePair<string, string>(screenJsonPath, phase));
                }
                return;
            }
            RamReadResult quarter = Read("quarter", 1, 20);
            RamReadResult clock = Read("gameClockSeconds", 0, 3600);
            int quarterValue = quarter.Available ? quarter.Value : -1;
            int clockValue = clock.Available ? clock.Value : -1;
            List<Dictionary<string, object>> messagesNow = new List<Dictionary<string, object>>(recentScoreHudMessages);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { RunPenaltyProbe(screenJsonPath, phase, quarterValue, clockValue, messagesNow); }
                catch (Exception error)
                {
                    Dictionary<string, object> failed = new Dictionary<string, object>
                    {
                        { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                        { "phase", phase }, { "kind", "error" }, { "error", error.Message }
                    };
                    AppendProbeLine(screenJsonPath, "penalty-probe.jsonl", failed);
                }
                finally
                {
                    Interlocked.Exchange(ref penaltyProbeRunning, 0);
                    KeyValuePair<string, string> next = new KeyValuePair<string, string>(null, null);
                    lock (penaltyProbeQueue) { if (penaltyProbeQueue.Count > 0) next = penaltyProbeQueue.Dequeue(); }
                    if (next.Key != null) StartPenaltyProbe(next.Key, next.Value);
                }
            });
        }

        private void RunPenaltyProbe(string screenJsonPath, string phase, int quarter, int clock,
            List<Dictionary<string, object>> messagesNow)
        {
            Stopwatch watch = Stopwatch.StartNew();
            Dictionary<string, object> header = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "phase", phase }, { "kind", "start" },
                { "quarter", quarter }, { "clock", clock },
                { "messages", messagesNow }
            };
            AppendProbeLine(screenJsonPath, "penalty-probe.jsonl", header);

            // (a) penalty words in the private heap below 4 GB
            Dictionary<string, List<long>> textHits =
                scanner.FindAsciiTextsPrivateBelow4G(ResearchProbeHelpers.PenaltyWords, 24);
            int textCount = 0;
            foreach (KeyValuePair<string, List<long>> pair in textHits)
            {
                foreach (long address in pair.Value)
                {
                    byte[] around;
                    try { around = scanner.ReadBytes(Math.Max(0, address - 96), 96 + 224); }
                    catch { continue; }
                    Dictionary<string, object> entry = new Dictionary<string, object>
                    {
                        { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                        { "phase", phase }, { "kind", "text" },
                        { "word", pair.Key },
                        { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                        { "text", ResearchProbeHelpers.AsciiPreview(around, 96, 200) },
                        { "before", ResearchProbeHelpers.AsciiRun(around, 0, 96) },
                        { "intsBefore", ResearchProbeHelpers.Int32Window(around, 32, 16) },
                        { "intsAfter", ResearchProbeHelpers.Int32Window(around, 96 + 32, 16) }
                    };
                    AppendProbeLine(screenJsonPath, "penalty-probe.jsonl", entry);
                    textCount++;
                }
            }

            // (b) the ScoreHud object family: sweep the vtable neighbourhood
            long moduleBase = scanner.Process.MainModule.BaseAddress.ToInt64();
            List<long> targets = new List<long>();
            // Relative to the (possibly rebased) team vtable so the research
            // window survives a game patch: the family spans team-0x568 to
            // team+0xA98 in every observed build.
            long familyBase = moduleBase + GameProfile.ScoreHudTeamVtableOffset;
            for (long vtable = familyBase - 0x568L; vtable <= familyBase + 0xA98L; vtable += 8) targets.Add(vtable);
            long knownTeam = familyBase,
                knownDown = moduleBase + GameProfile.ScoreHudDownDistanceVtableOffset,
                knownMessage = moduleBase + GameProfile.ScoreHudMessageVtableOffset;
            Dictionary<long, List<long>> objects = scanner.FindPrivateInt64ReferencesBelow4G(targets.ToArray(), 12);
            int objectCount = 0;
            foreach (KeyValuePair<long, List<long>> pair in objects)
            {
                if (pair.Value.Count == 0) continue;
                if (pair.Key == knownTeam || pair.Key == knownDown || pair.Key == knownMessage) continue;
                foreach (long address in pair.Value)
                {
                    byte[] body;
                    try { body = scanner.ReadBytes(address, 0x100); }
                    catch { continue; }
                    List<string> strings = new List<string>();
                    for (int offset = 8; offset + 8 <= body.Length && strings.Count < 6; offset += 8)
                    {
                        long pointer = BitConverter.ToInt64(body, offset);
                        if (pointer < 0x10000 || pointer >= 0x100000000L) continue;
                        byte[] text;
                        try { text = scanner.ReadBytes(pointer, 48); } catch { continue; }
                        string preview = ResearchProbeHelpers.AsciiPreview(text, 0, 48);
                        if (preview.Length >= 3) strings.Add(ResearchProbeHelpers.HexOffset(offset) + "=" + preview);
                    }
                    Dictionary<string, object> entry = new Dictionary<string, object>
                    {
                        { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                        { "phase", phase }, { "kind", "object" },
                        { "vtableOffset", "0x" + (pair.Key - moduleBase).ToString("X", CultureInfo.InvariantCulture) },
                        { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                        { "ints", ResearchProbeHelpers.Int32Window(body, 8, 32) },
                        { "strings", strings }
                    };
                    AppendProbeLine(screenJsonPath, "penalty-probe.jsonl", entry);
                    objectCount++;
                }
            }
            Dictionary<string, object> footer = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "phase", phase }, { "kind", "done" },
                { "textHits", textCount }, { "objects", objectCount },
                { "elapsedMs", watch.ElapsedMilliseconds }
            };
            AppendProbeLine(screenJsonPath, "penalty-probe.jsonl", footer);
        }

        private void WritePossessionProbe(string screenJsonPath,
            RamReadResult rawPossession, RamReadResult verifiedPossession,
            RamReadResult quarter, RamReadResult gameClock,
            RamReadResult awayScore, RamReadResult homeScore,
            RamReadResult down, RamReadResult distance)
        {
            // Source 1: the legacy record's possession word, raw and verified.
            object legacyRaw = rawPossession.Available ? (object)rawPossession.Value : null;
            bool legacyVerified = verifiedPossession.Available;

            // Source 2: the timeout-clone byte. Each verified clone context
            // carries it at (home counter - 0x13); the layout invariant is
            // asserted by TimeoutClonePossessionAddressLayoutIsSafe.
            List<long> homeSlots = CopyConfiguredAddresses("timeoutSlotTeamIdZero");
            homeSlots.Sort();
            List<object> cloneFlags = new List<object>();
            for (int index = 0; index < homeSlots.Count; index++)
            {
                try
                {
                    int value = ReadSingleByte(homeSlots[index] - 0x13);
                    cloneFlags.Add(value >= 0 && value <= 1 ? (object)value : "out-of-range:" + value);
                }
                catch { cloneFlags.Add("unreadable"); }
            }

            // Source 3: the ScoreHud team objects' +72 possession flag, read
            // from the same oriented objects that carry rank and record.
            ScoreHudTeamCandidate awayTeam;
            ScoreHudTeamCandidate homeTeam;
            object hudAway = TryReadConfiguredRankObject("awayRank", out awayTeam)
                ? (object)awayTeam.HasPossession : null;
            object hudHome = TryReadConfiguredRankObject("homeRank", out homeTeam)
                ? (object)homeTeam.HasPossession : null;

            string signature = (legacyRaw ?? "-") + "|" + legacyVerified
                + "|" + String.Join(",", ConvertProbeValues(cloneFlags))
                + "|" + (hudAway ?? "-") + "|" + (hudHome ?? "-");
            possessionProbeSummary = "legacy=" + (legacyRaw ?? "?")
                + (legacyVerified ? "(verified)" : "(unverified)")
                + " clone=[" + String.Join(",", ConvertProbeValues(cloneFlags)) + "]"
                + " hud=" + (hudAway ?? "?") + "/" + (hudHome ?? "?");
            if (String.Equals(signature, possessionProbeSignature, StringComparison.Ordinal)) return;
            possessionProbeSignature = signature;

            Dictionary<string, object> entry = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "quarter", quarter.Available ? (object)quarter.Value : null },
                { "clock", gameClock.Available ? (object)gameClock.Value : null },
                { "awayScore", awayScore.Available ? (object)awayScore.Value : null },
                { "homeScore", homeScore.Available ? (object)homeScore.Value : null },
                { "down", down.Available ? (object)down.Value : null },
                { "distance", distance.Available ? (object)distance.Value : null },
                { "legacyRaw", legacyRaw },
                { "legacyVerified", legacyVerified },
                { "cloneHomeFlags", cloneFlags },
                { "hudAwayPossession", hudAway },
                { "hudHomePossession", hudHome }
            };
            AppendProbeLine(screenJsonPath, "possession-probe.jsonl", entry);
        }

        private static string[] ConvertProbeValues(List<object> values)
        {
            string[] result = new string[values.Count];
            for (int index = 0; index < values.Count; index++)
                result[index] = Convert.ToString(values[index], CultureInfo.InvariantCulture);
            return result;
        }

        // Known wide-block offsets (scores, downs, quarter, timeouts, clock and
        // score digit cells, play clock) - everything the 2026-08-15 probe game
        // identified. The ball-spot sweep skips these so a new value stands out.
        private static readonly HashSet<int> KnownWideBlockOffsets = new HashSet<int>
        {
            0x90, 0x98, 0xA0, 0xB0, 0xB8, 0xC0, 0xC8, 0xE0, 0xE8, 0xF0, 0xF8,
            0x100, 0x108, 0x110, 0x118, 0x120, 0x128, 0x130, 0x138, 0x140,
            0x148, 0x150, 0x158, 0x160, 0x168, 0x170, 0x180
        };

        private void WriteBallSpotProbe(string screenJsonPath,
            RamReadResult quarter, RamReadResult gameClock,
            RamReadResult down, RamReadResult distance,
            ScoreHudDownDistanceCandidate scoreHudDownDistance)
        {
            if (!down.Available || !distance.Available) return;
            string signature = down.Value + "|" + distance.Value;
            if (String.Equals(signature, ballSpotProbeSignature, StringComparison.Ordinal)) return;
            ballSpotProbeSignature = signature;

            // ROUND 2 (2026-08-15): the catalog window was unreadable all of
            // game one and the 8-byte-stride wide dump identified everything it
            // touched as known scoreboard values (the 0x168/0x170 "ball spot"
            // candidates were play-clock digits). This round sweeps the WHOLE
            // block at 4-byte stride - half the slots were never looked at -
            // skipping known offsets. The ball spot is a 0..50 yard number
            // with a territory (own/opponent) indicator likely adjacent, and
            // it moves at every down change, which is this log's trigger. The
            // field-goal distance the play picker shows is yards-to-goal + 17,
            // so finding this slot is what unlocks FG distance on the bug.
            Dictionary<string, object> wideWindow = new Dictionary<string, object>();
            List<long> quarterAddresses = CopyConfiguredAddresses("quarter");
            string coreSignature = ConfiguredCoreSignature();
            if (quarterAddresses.Count != 1
                || !coreSignature.EndsWith(":W", StringComparison.Ordinal)) return;
            try
            {
                long block = quarterAddresses[0] - 0xC8;
                byte[] bytes = scanner.ReadBytes(block, 0x300);
                for (int offset = 0; offset + 4 <= bytes.Length; offset += 4)
                {
                    if (KnownWideBlockOffsets.Contains(offset)) continue;
                    int value = BitConverter.ToInt32(bytes, offset);
                    if (value >= 1 && value <= 120)
                        wideWindow["0x" + offset.ToString("X", CultureInfo.InvariantCulture)] = value;
                }
            }
            catch { return; }
            // ROUND 4 (2026-08-19): testers see "1st & 9" where the game shows
            // 10 - the int core is probably a truncated float. Dump every
            // float in the block that looks like a yardage (0.25..110) so the
            // true yards-to-go / ball spot can be identified offline.
            Dictionary<string, object> wideFloats = new Dictionary<string, object>();
            try
            {
                long block = quarterAddresses[0] - 0xC8;
                byte[] bytes = scanner.ReadBytes(block, 0x300);
                for (int offset = 0; offset + 4 <= bytes.Length; offset += 4)
                {
                    float value = BitConverter.ToSingle(bytes, offset);
                    if (float.IsNaN(value) || float.IsInfinity(value)) continue;
                    if (value < 0.25f || value > 110f) continue;
                    if (value == (float)Math.Floor(value) && KnownWideBlockOffsets.Contains(offset)) continue;
                    wideFloats["0x" + offset.ToString("X", CultureInfo.InvariantCulture)] = Math.Round(value, 3);
                }
            }
            catch { }
            if (wideWindow.Count == 0 && wideFloats.Count == 0) return;

            Dictionary<string, object> entry = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "quarter", quarter.Available ? (object)quarter.Value : null },
                { "clock", gameClock.Available ? (object)gameClock.Value : null },
                { "down", down.Value },
                { "distance", distance.Value },
                { "wideFloats", wideFloats },
                // The filtered current candidate was null at every down change
                // of the probe game; the last-seen object (any age) is the
                // ground truth this log actually needs.
                { "scoreHudDisplay", scoreHudDownDistance != null ? scoreHudDownDistance.Display
                    : (lastScoreHudDownDistance != null ? lastScoreHudDownDistance.Display : null) },
                { "wide", wideWindow }
            };
            AppendProbeLine(screenJsonPath, "ballspot-probe.jsonl", entry);
        }

        // Per-field freshness for consumers. Downstream apps (OCR hybrids,
        // stream tools) need to distinguish "score unchanged because nobody
        // scored" from "reader gone stale" - a distinction only the reader can
        // make, since it re-verifies every field from memory on every tick.
        // Each published field gets a changedAt stamp; a frozen value whose
        // clock siblings keep advancing is genuinely unchanged, never stale.
        private readonly Dictionary<string, string> publishedFieldValues =
            new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, DateTime> publishedFieldChangedAt =
            new Dictionary<string, DateTime>(StringComparer.Ordinal);

        internal static bool NotePublishedFieldValue(Dictionary<string, string> values,
            Dictionary<string, DateTime> changedAt, string field, string value, DateTime nowUtc)
        {
            string previous;
            bool seen = values.TryGetValue(field, out previous);
            // Transitions to and from null (unavailable) count as changes so
            // consumers see exactly when a field dropped out or came back.
            bool changed = !seen || !String.Equals(previous, value, StringComparison.Ordinal);
            if (changed)
            {
                values[field] = value;
                changedAt[field] = nowUtc;
            }
            return changed;
        }

        private void NoteRead(string field, RamReadResult read, DateTime nowUtc)
        {
            NotePublishedFieldValue(publishedFieldValues, publishedFieldChangedAt, field,
                read.Available ? read.Value.ToString(CultureInfo.InvariantCulture) : null, nowUtc);
        }

        private Dictionary<string, object> BuildFreshness(DateTime nowUtc)
        {
            Dictionary<string, object> freshness = new Dictionary<string, object>();
            foreach (KeyValuePair<string, DateTime> entry in publishedFieldChangedAt)
            {
                double seconds = (nowUtc - entry.Value).TotalSeconds;
                freshness[entry.Key] = new Dictionary<string, object>
                {
                    { "changedAt", entry.Value.ToString("o", CultureInfo.InvariantCulture) },
                    { "secondsSinceChange", seconds < 0 ? 0 : Math.Round(seconds, 1) }
                };
            }
            return freshness;
        }

        // PROBE. Hunting the game's "HUD hidden" state so the overlay can
        // auto-hide during the play picker (bugs cover the play-call screen).
        // The game blanks its own scorebug there, so SOME state in memory
        // flips exactly at picker-open and picker-close. Candidates watched:
        // every small-valued slot of the wide game-state block, whether all
        // down-distance objects read empty, and the HUD possession pair state.
        // A transition is logged with play-clock/game-clock context; one game
        // of play shows which signal flips at the play-call boundaries (a
        // phase slot flips twice per snap cycle with the play clock running -
        // that shape is unmistakable in the log).
        private bool lastDownDistanceAllEmpty;
        private string hudStateProbeSignature;

        private void WriteHudStateProbe(string screenJsonPath,
            RamReadResult quarter, RamReadResult gameClock, RamReadResult playClock,
            RamReadResult down, RamReadResult distance)
        {
            List<long> quarterAddresses = CopyConfiguredAddresses("quarter");
            if (quarterAddresses.Count != 1
                || !ConfiguredCoreSignature().EndsWith(":W", StringComparison.Ordinal)) return;
            // ROUND 2 (2026-08-15): the first game of probe data proved the
            // 0x80..0x188 slots are all plain scoreboard values and none flips
            // at play-picker open/close (the all-empty signal fires only on
            // scoring plays). The hidden-HUD state must live elsewhere, so
            // widen to the unexplored ranges of the same block: the header
            // below 0x80 and the tail beyond 0x188.
            Dictionary<string, object> slots = new Dictionary<string, object>();
            try
            {
                long block = quarterAddresses[0] - 0xC8;
                byte[] bytes = scanner.ReadBytes(block, 0x300);
                for (int offset = 0; offset + 4 <= bytes.Length; offset += 4)
                {
                    if (offset >= 0x80 && offset < 0x188) continue;
                    int value = BitConverter.ToInt32(bytes, offset);
                    if (value >= 0 && value <= 20)
                        slots["0x" + offset.ToString("X", CultureInfo.InvariantCulture)] = value;
                }
            }
            catch { return; }
            ScoreHudTeamCandidate awayTeam;
            ScoreHudTeamCandidate homeTeam;
            string hudPair = TryReadConfiguredRankObject("awayRank", out awayTeam)
                && TryReadConfiguredRankObject("homeRank", out homeTeam)
                ? awayTeam.HasPossession + "/" + homeTeam.HasPossession
                : "unreadable";
            // The signature deliberately excludes clocks and down/distance so
            // only PHASE changes write a line, not every ticking second.
            List<string> parts = new List<string>();
            foreach (KeyValuePair<string, object> slot in slots)
                parts.Add(slot.Key + "=" + slot.Value);
            parts.Sort(StringComparer.Ordinal);
            string signature = String.Join(",", parts.ToArray())
                + "|" + lastDownDistanceAllEmpty + "|" + hudPair;
            if (String.Equals(signature, hudStateProbeSignature, StringComparison.Ordinal)) return;
            hudStateProbeSignature = signature;
            Dictionary<string, object> entry = new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "quarter", quarter.Available ? (object)quarter.Value : null },
                { "clock", gameClock.Available ? (object)gameClock.Value : null },
                { "playClock", playClock.Available ? (object)playClock.Value : null },
                { "down", down.Available ? (object)down.Value : null },
                { "distance", distance.Available ? (object)distance.Value : null },
                { "allDownDistanceEmpty", lastDownDistanceAllEmpty },
                { "hudPossessionPair", hudPair },
                { "slots", slots }
            };
            AppendProbeLine(screenJsonPath, "hudstate-probe.jsonl", entry);
        }

        private static void AppendProbeLine(string screenJsonPath, string fileName,
            Dictionary<string, object> entry)
        {
            string folder = !String.IsNullOrWhiteSpace(screenJsonPath)
                ? Path.GetDirectoryName(screenJsonPath) : null;
            if (String.IsNullOrWhiteSpace(folder)) folder = AppDomain.CurrentDomain.BaseDirectory;
            string path = Path.Combine(folder, fileName);
            try
            {
                FileInfo info = new FileInfo(path);
                if (info.Exists && info.Length > MaximumProbeLogBytes) return;
                string line = new JavaScriptSerializer().Serialize(entry);
                using (FileStream stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read))
                using (StreamWriter writer = new StreamWriter(stream))
                    writer.WriteLine(line);
            }
            catch { }
        }

        private bool HasCachedCoreFields()
        {
            return HasConfiguredField("quarter") && HasConfiguredField("gameClockSeconds")
                && HasConfiguredField("playClock") && HasConfiguredField("homeScore")
                && HasConfiguredField("awayScore") && HasConfiguredField("down")
                && HasConfiguredField("distance");
        }

        private void BeginCacheProbe()
        {
            cacheProbeActive = true;
            cacheProbeProcessId = scanner.Process.Id;
            nextCacheProbeSampleUtc = DateTime.MinValue;
            cacheProbeFirst = null;
            cacheProbeSecond = null;
        }

        private void ResetCacheProbe()
        {
            cacheProbeActive = false;
            cacheProbeProcessId = 0;
            nextCacheProbeSampleUtc = DateTime.MinValue;
            cacheProbeFirst = null;
            cacheProbeSecond = null;
        }

        // One sample roughly every second; three coherent samples adopt the
        // cache. Any unreadable sample abandons it immediately - "can't find
        // them" means go find them manually, not keep hoping.
        private void AdvanceCacheProbe(string screenJsonPath)
        {
            if (!cacheProbeActive || scanner.Process == null || scanner.Process.HasExited
                || cacheProbeProcessId != scanner.Process.Id) return;
            if (DateTime.UtcNow < nextCacheProbeSampleUtc) return;
            nextCacheProbeSampleUtc = DateTime.UtcNow.AddMilliseconds(1000);
            RamScoreboardSnapshot sample = ReadCacheProbeSnapshot();
            if (sample == null)
            {
                // The cached addresses no longer read as a scoreboard at all.
                ResetCacheProbe();
                ClearStaleOutput(screenJsonPath);
                DiscardCachedProfile("cached scoreboard unreadable; discarded, locating from scratch");
                return;
            }
            DateTime now = DateTime.UtcNow;
            if (cacheProbeFirst == null)
            {
                cacheProbeFirst = sample;
                cacheProbeFirstAtUtc = now;
                return;
            }
            if (cacheProbeSecond == null)
            {
                cacheProbeSecond = sample;
                cacheProbeSecondAtUtc = now;
                return;
            }
            if (MemoryScanner.HasCoherentLiveWideProgression(
                cacheProbeFirst, cacheProbeSecond, sample,
                (long)(cacheProbeSecondAtUtc - cacheProbeFirstAtUtc).TotalMilliseconds,
                (long)(now - cacheProbeSecondAtUtc).TotalMilliseconds))
            {
                AdoptVerifiedCache();
                return;
            }
            // Readable but not moving - a paused game looks exactly like this.
            // Slide the window and keep watching; the full discovery running on
            // its own cadence is the guarantee this can never become a trap.
            cacheProbeFirst = cacheProbeSecond;
            cacheProbeFirstAtUtc = cacheProbeSecondAtUtc;
            cacheProbeSecond = sample;
            cacheProbeSecondAtUtc = now;
            autoDiscoverySummary = "cached scoreboard readable; waiting for it to move (paused games stay here)";
        }

        // Reads the cached core exactly the way live publication would, and
        // reuses the discovery-side snapshot validation so "looks like a live
        // scoreboard" means the same thing in both places.
        private RamScoreboardSnapshot ReadCacheProbeSnapshot()
        {
            RamReadResult quarter = Read("quarter", 1, 20);
            RamReadResult clock = Read("gameClockSeconds", 0, 3600);
            RamReadResult playClock = Read("playClock", 0, 99);
            RamReadResult homeScore = Read("homeScore", 0, 255);
            RamReadResult awayScore = Read("awayScore", 0, 255);
            RamReadResult down = Read("down", 0, 4);
            RamReadResult distance = Read("distance", 0, 99);
            if (!quarter.Available || !clock.Available || !playClock.Available
                || !homeScore.Available || !awayScore.Available
                || !down.Available || !distance.Available) return null;
            return new RamScoreboardSnapshot
            {
                // A fixed non-zero token: the progression check requires the
                // three samples to come from one address, and these all come
                // from the same configured field set by construction.
                Address = 1,
                UsesWideLayout = true,
                Quarter = quarter.Value,
                Clock = clock.Value,
                PlayClock = playClock.Value,
                HomeScore = homeScore.Value,
                AwayScore = awayScore.Value,
                Down = down.Value,
                Distance = distance.Value
            };
        }

        private void AdoptVerifiedCache()
        {
            ResetCacheProbe();
            discoveryAttemptProcessId = scanner.Process.Id;
            resolvedProcessId = scanner.Process.Id;
            profile.ProcessId = scanner.Process.Id;
            profile.ProcessStartUtcTicks = attachedProcessStartUtcTicks;
            teamKeyNames = null;
            lastAwayAssetResult = RamTextResult.Missing(0);
            nextAwayAssetScanUtc = DateTime.MinValue;
            // The same three synchronized confirmation passes a discovered core
            // gets; adoption is a shortcut past the sweep, not past the checks.
            BeginProfileConfirmation("cached scoreboard verified by live movement; confirmation pending");
        }

        private void DiscardCachedProfile(string summary)
        {
            profile.Fields.Clear();
            profile.SeedAwayTeamName = null;
            profile.SeedHomeTeamName = null;
            profile.ProcessId = 0;
            profile.ProcessStartUtcTicks = 0;
            profile.Scope = AutomaticProfileScope;
            profile.CreatedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            try
            {
                profile.Save(profilePath);
                profileWriteTimeUtc = File.GetLastWriteTimeUtc(profilePath);
            }
            catch { }
            autoDiscoverySummary = summary;
        }

        private void EnsureGameVersionInfo()
        {
            if (scanner.Process == null || scanner.Process.HasExited) return;
            if (gameVersionProcessId == scanner.Process.Id) return;
            gameVersionProcessId = scanner.Process.Id;
            gameExeVersion = null;
            gameModuleSize = 0;
            // MainModule can throw on an access-protected process; a missing
            // version then reads as null rather than crashing the refresh loop.
            try
            {
                System.Diagnostics.ProcessModule module = scanner.Process.MainModule;
                gameModuleSize = module.ModuleMemorySize;
                gameExeVersion = module.FileVersionInfo == null
                    ? null : module.FileVersionInfo.FileVersion;
            }
            catch { }
        }

        private static bool IsCompatibleAutomaticProfileScope(string scope)
        {
            // Timeout addresses from earlier scopes can contain a legal but
            // dormant 0/0 pair. Only the current sanitized scope is restored.
            return String.Equals(scope, AutomaticProfileScope, StringComparison.Ordinal);
        }

        private void MigratePreviousCurrentProcessProfile()
        {
            if (profile == null || scanner.Process == null || scanner.Process.HasExited) return;
            if (profile.ProcessId != scanner.Process.Id) return;
            if (!String.Equals(profile.Scope, PreviousAutomaticProfileScope, StringComparison.Ordinal)
                && !String.Equals(profile.Scope, EarlierAutomaticProfileScope, StringComparison.Ordinal)
                && !String.Equals(profile.Scope, OlderAutomaticProfileScope, StringComparison.Ordinal)
                && !String.Equals(profile.Scope, OldestAutomaticProfileScope, StringComparison.Ordinal)) return;
            // Keep only the proven core scoreboard for this exact process.
            // Matchup-derived pointers from earlier scopes can silently cross
            // a same-process game load, and v13 mislabeled wide +0xA0 as
            // possession. Force one fresh structural discovery for v16.
            ClearMatchupFieldsAndCaches(true);
            profile.ProcessId = 0;
            profile.ProcessStartUtcTicks = 0;
            profile.Scope = AutomaticProfileScope;
            profile.CreatedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            try
            {
                profile.Save(profilePath);
                profileWriteTimeUtc = File.GetLastWriteTimeUtc(profilePath);
            }
            catch
            {
                // The sanitized in-memory profile remains safe for this run.
            }
        }

        private void RunAutomaticDiscovery(LiveScoreboard screen)
        {
            long scanToken;
            if (!TryAcquireFullMemoryScan(out scanToken))
            {
                nextAutoDiscoveryUtc = DateTime.UtcNow.AddMilliseconds(250);
                autoDiscoverySummary = "waiting for the active RAM scan to finish";
                return;
            }
            try
            {
                RunAutomaticDiscoveryExclusive(screen);
            }
            catch
            {
                nextAutoDiscoveryUtc = DateTime.UtcNow.AddSeconds(2);
                autoDiscoverySummary = "RAM scan failed; waiting to retry";
            }
            finally
            {
                ReleaseFullMemoryScan(scanToken);
            }
        }

        private void RunAutomaticDiscoveryExclusive(LiveScoreboard screen)
        {
            bool locatingNewProcess = resolvedProcessId != scanner.Process.Id
                && (profile == null || profile.ProcessId != scanner.Process.Id
                    || !IsCompatibleAutomaticProfileScope(profile.Scope)
                    || !CurrentProcessIdentityMatchesProfile());
            if (locatingNewProcess)
            {
                // A new process or invalidated game epoch may reuse readable
                // heap addresses. Drop every side-bound field before locating.
                if (!matchupTransitionPending || !String.IsNullOrWhiteSpace(lastAwayTeamName)
                    || !String.IsNullOrWhiteSpace(lastHomeTeamName))
                    ClearMatchupFieldsAndCaches(true);
            }
            discoveryAttemptProcessId = scanner.Process.Id;
            RamAutoDiscovery discovery = scanner.DiscoverRamLayout(screen);
            // A tentative wide block can be a perfectly readable record retained
            // from a prior game. Never promote it from cache equality or an old
            // profile scope; require synchronized records or observed live change.
            // During startup, live Frostbite objects appear at slightly
            // different moments. Retry partial discovery quickly so the first
            // live play is enough; once every required field reads, Refresh no
            // longer calls discovery and this scan naturally stops.
            bool hasBothTeamNames = !String.IsNullOrWhiteSpace(discovery.AwayTeamName)
                && !String.IsNullOrWhiteSpace(discovery.HomeTeamName);
            nextAutoDiscoveryUtc = discovery.HasCoreScoreboard
                ? (hasBothTeamNames ? DateTime.UtcNow.AddMilliseconds(500) : DateTime.UtcNow.AddSeconds(5))
                : DateTime.UtcNow.AddSeconds(2);
            scoreboardCandidateCount = discovery.ScoreboardCandidateCount;
            possessionBindDiagnostic = discovery.PossessionDiagnostic;
            // The finder explains itself, but only to the --locate probe. Every
            // name problem tonight was diagnosed by running a probe alongside
            // the reader, which competes with it for CPU and answers a question
            // about a *different* scan than the one that actually publishes.
            // Carry the running reader's own reasoning into the export.
            teamRoleDiagnostic = discovery.TeamRoleDiagnostics == null
                || discovery.TeamRoleDiagnostics.Count == 0
                ? "no role diagnostics"
                : String.Join(" | ", discovery.TeamRoleDiagnostics.ToArray());
            autoDiscoverySummary = String.Format(CultureInfo.InvariantCulture,
                "scanned {0:N0} MB; scoreboard {1}; timeout copies {2}; catalog {3}; teams {4}/{5}; live distance {6}",
                discovery.BytesScanned / (1024 * 1024),
                discovery.HasCoreScoreboard ? "found" : "missing",
                discovery.HomeTimeoutAddresses.Count,
                discovery.TeamCatalogBase != 0 ? "found" : "missing",
                String.IsNullOrWhiteSpace(discovery.AwayTeamName) ? "?" : discovery.AwayTeamName,
                String.IsNullOrWhiteSpace(discovery.HomeTeamName) ? "?" : discovery.HomeTeamName,
                discovery.LiveDistanceAddresses.Count == 1 ? "unique" : discovery.LiveDistanceAddresses.Count.ToString(CultureInfo.InvariantCulture));
            if (!discovery.HasCoreScoreboard)
            {
                // A presentation transition can hide the duplicate record for
                // one sweep. Preserve an already-confirmed current-process
                // profile instead of creating an invalidate/rescan loop.
                if (resolvedProcessId == scanner.Process.Id)
                    autoDiscoverySummary += "; retained confirmed live profile";
                return;
            }

            if (matchupTransitionPending && !String.IsNullOrWhiteSpace(transitionPreviousCoreSignature)
                && !String.Equals(transitionPreviousCoreSignature, DiscoveryCoreSignature(discovery), StringComparison.Ordinal))
            {
                retiredAwayTeamName = transitionPreviousAwayTeamName;
                retiredHomeTeamName = transitionPreviousHomeTeamName;
                retiredAwayTeamAddressSignature = transitionPreviousAwayAddressSignature;
                retiredHomeTeamAddressSignature = transitionPreviousHomeAddressSignature;
                rejectRetiredOrderedPair = !String.IsNullOrWhiteSpace(retiredAwayTeamName)
                    && !String.IsNullOrWhiteSpace(retiredHomeTeamName);
            }

            long block = discovery.ScoreboardBlock;
            if (discovery.UsesWideScoreboardLayout)
            {
                SetField("quarter", new long[] { block + 0xC8 });
                SetField("gameClockSeconds", new long[] { block + 0x100 });
                SetField("playClock", new long[] { block + 0x180 });
                SetField("homeScore", new long[] { block + 0x90, block + 0xC0 });
                SetField("awayScore", new long[] { block + 0x98, block + 0xB0 });
                // Wide +0xA0 mirrors the down at +0xB8; it is not possession.
                // Legacy possession is installed below only when independently
                // synchronized. The timeout-clone byte is deliberately ignored
                // because live captures proved it is a transient UI flag.
                SetField("possessionAwayIsOne", new long[0]);
                SetField("down", new long[] { block + 0xB8 });
                SetField("distance", new long[] { block + 0x148 });
            }
            else
            {
                SetField("quarter", new long[] { block + 0xEC });
                SetField("gameClockSeconds", new long[] { block + 0xF4 });
                SetField("playClock", new long[] { block + 0xF8 });
                SetField("homeScore", new long[] { block + 0xFC });
                SetField("awayScore", new long[] { block + 0x100 });
                SetField("possessionAwayIsOne", new long[] { block + 0x108 });
                SetField("down", new long[] { block + 0x10C });
                SetField("distance", new long[] { block + 0x110 });
            }
            SetVerificationFields(discovery.VerificationScoreboardBlock, discovery.VerificationUsesWideScoreboardLayout);
            // A synchronized legacy record is verification evidence for a wide
            // primary, not a replacement for it. Keeping the wide down and
            // distance addresses here makes the per-refresh comparison truly
            // independent instead of comparing a legacy pointer to itself.
            if (!discovery.UsesWideScoreboardLayout)
            {
                if (discovery.LiveDownAddresses.Count == 1)
                    SetField("down", discovery.LiveDownAddresses);
                if (discovery.LiveDistanceAddresses.Count == 1)
                    SetField("distance", discovery.LiveDistanceAddresses);
            }
            SetField("teamCatalogBase", discovery.TeamCatalogBase == 0 ? new long[0] : new long[] { discovery.TeamCatalogBase });
            SetField("teamCatalogLength", discovery.TeamCatalogLength == 0 ? new long[0] : new long[] { discovery.TeamCatalogLength });
            SetField("homeTeamKeyAscii", new long[0]);
            SetField("awayTeamKeyAscii", new long[0]);
            ObserveMatchupDiscovery(discovery);
            // Observe can start a new matchup epoch and clear every side-bound
            // field. Install the independently synchronized possession pointer
            // only after that clear, and only when two direct reads agree.
            InstallRawTimeoutSlots(discovery, false);
            ApplyOrientedTimeoutFields();
            InstallLivePossession(discovery, false);

            profile.ProcessId = scanner.Process.Id;
            profile.ProcessStartUtcTicks = attachedProcessStartUtcTicks;
            profile.Scope = AutomaticProfileScope;
            profile.CreatedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            profile.SeedAwayTeamName = null;
            profile.SeedHomeTeamName = null;
            resolvedProcessId = scanner.Process.Id;
            teamKeyNames = null;
            lastAwayAssetResult = RamTextResult.Missing(0);
            nextAwayAssetScanUtc = DateTime.MinValue;
            BeginProfileConfirmation(autoDiscoverySummary + "; confirmation pending");
        }

        private void EnsureLiveScoreHudRankFields()
        {
            bool ranksLive = ConfiguredRankObjectIsLive("awayRank")
                && ConfiguredRankObjectIsLive("homeRank");
            if (ranksLive) return;
            if (DateTime.UtcNow < nextRankScoreHudDiscoveryUtc) return;
            nextRankScoreHudDiscoveryUtc = DateTime.UtcNow.AddSeconds(30);
            RequestScoreHudDiscovery();
        }

        private ScoreHudDownDistanceCandidate ReadScoreHudDownDistance()
        {
            ApplyCompletedScoreHudDiscovery();
            RetryRequestedScoreHudDiscovery();

            List<ScoreHudDownDistanceCandidate> liveCandidates =
                new List<ScoreHudDownDistanceCandidate>();
            List<long> addresses;
            if (profile != null && profile.Fields.TryGetValue("scoreHudDownDistance", out addresses)
                && addresses != null)
            {
                for (int index = 0; index < addresses.Count; index++)
                {
                    ScoreHudDownDistanceCandidate configured;
                    try
                    {
                        if (scanner.TryReadLiveScoreHudDownDistanceCandidate(
                            addresses[index], out configured))
                            liveCandidates.Add(configured);
                    }
                    catch { }
                }
            }

            // PROBE input: whether every known down-distance object is empty
            // right now. The game blanks its own scorebug during the play
            // picker, so this is a candidate signal for mirroring that hide.
            lastDownDistanceAllEmpty = liveCandidates.Count > 0;
            for (int index = 0; index < liveCandidates.Count; index++)
                if (!liveCandidates[index].IsEmpty) { lastDownDistanceAllEmpty = false; break; }

            RamReadResult currentDown = Read("down", 1, 4);
            RamReadResult currentDistance = Read("distance", 0, 99);

            // ScoreHud keeps separate pooled objects for the ordinary yardage
            // and Goal/Inches/Kickoff layers. Search after a score or opening/
            // halftime transition and while distance zero is still ambiguous.
            // Once a verified special object is installed, direct polling is
            // sufficient and avoids repeating a multi-gigabyte memory sweep.
            RamReadResult currentQuarter = Read("quarter", 1, 20);
            RamReadResult currentGameClock = Read("gameClockSeconds", 0, 3600);
            RamReadResult currentPlayClock = Read("playClock", 0, 99);
            RamReadResult currentHomeScore = Read("homeScore", 0, 255);
            RamReadResult currentAwayScore = Read("awayScore", 0, 255);
            DateTime now = DateTime.UtcNow;
            bool transitionBaselineInitializedNow;
            int previousDown;
            int previousDistance;
            int observedExpectedSpecial = ObserveScoreHudPresentationTransition(
                currentQuarter, currentHomeScore, currentAwayScore,
                currentDown, currentDistance, out transitionBaselineInitializedNow,
                out previousDown, out previousDistance);
            HashSet<long> activatedCandidateAddresses;
            HashSet<long> semanticCandidateChanges;
            ObserveScoreHudCandidateChanges(liveCandidates,
                transitionBaselineInitializedNow, out activatedCandidateAddresses,
                out semanticCandidateChanges);
            if (transitionBaselineInitializedNow && currentQuarter.Available
                && currentQuarter.Value >= 7)
            {
                // Third overtime and later is a mandatory two-point shootout.
                // The quarter itself is independent proof of Conversion; cold
                // attach must not wait for a running game clock that never exists.
                observedExpectedSpecial = ScoreHudExpectedConversion;
            }
            if (transitionBaselineInitializedNow)
            {
                // A cold attach has no before-state with which to tell a current
                // Kickoff/PAT object from a retained pooled object. Keep only the
                // down/distance text blank until one complete countdown cycle
                // proves ordinary scrimmage, or a Goal/Inches label is tied to
                // the live zero-distance core state.
                scoreHudColdBaselinePending = true;
                scoreHudColdBaselineResumeConfirmations = 0;
                scoreHudColdBaselineObservedPlayClock = currentPlayClock.Available
                    ? currentPlayClock.Value : -1;
                scoreHudColdBaselinePlayClockResetSeen = false;
                scoreHudColdBaselinePlayClockEpochs = 0;
                scoreHudColdBaselineObservedGameClock = currentGameClock.Available
                    ? currentGameClock.Value : -1;
                scoreHudColdBaselineGameClockMoved = false;
                scoreHudColdBaselineEpochsAtLastGameClockChange = 0;
                scoreHudColdFreshScrimmageObserved = false;
                nextScoreHudDelayedSpecialRetryUtc = now.AddSeconds(15);
            }
            bool transitionStarted = observedExpectedSpecial != ScoreHudExpectedNone;
            if (transitionStarted)
            {
                bool continuingConversion = scoreHudExpectedNonScrimmageSpecial
                        == ScoreHudExpectedConversion
                    && (observedExpectedSpecial == ScoreHudExpectedKickoff
                        || observedExpectedSpecial == ScoreHudExpectedAwaitScrimmage);
                if (!continuingConversion || scoreHudTransitionDown < 0
                    || scoreHudTransitionDistance < 0)
                {
                    scoreHudTransitionDown = previousDown;
                    scoreHudTransitionDistance = previousDistance;
                }
                scoreHudExpectedNonScrimmageSpecial = observedExpectedSpecial;
                scoreHudTransitionScanUntilUtc = now.AddSeconds(25);
                scoreHudSpecialPending = true;
                scoreHudNumericResumeConfirmations = 0;
                nextScoreHudDelayedSpecialRetryUtc = now.AddSeconds(25);
                scoreHudTransitionQuarter = currentQuarter.Available ? currentQuarter.Value : 0;
                scoreHudTransitionObservedPlayClock = currentPlayClock.Available
                    ? currentPlayClock.Value : -1;
                scoreHudTransitionPlayClockResetSeen = false;
                scoreHudTransitionAllowInitialPlayClockEpoch =
                    (observedExpectedSpecial == ScoreHudExpectedConversion
                        || observedExpectedSpecial == ScoreHudExpectedKickoff)
                    && currentPlayClock.Available && currentPlayClock.Value > 0;
                scoreHudTransitionPlayClockEpochs = 0;
                scoreHudTransitionObservedGameClock = currentGameClock.Available
                    ? currentGameClock.Value : -1;
                scoreHudTransitionGameClockMoved = false;
                scoreHudTransitionEpochsAtLastGameClockChange = 0;
                scoreHudExpectedSpecialObserved = false;
                scoreHudTransitionFreshScrimmageObserved = false;
                scoreHudTransitionFreshScrimmageEpoch = -1;
                scoreHudFreshKickoffObserved = false;
                scoreHudColdBaselinePending = false;
                scoreHudColdBaselineResumeConfirmations = 0;
                scoreHudColdBaselineObservedPlayClock = -1;
                scoreHudColdBaselinePlayClockResetSeen = false;
                scoreHudColdBaselinePlayClockEpochs = 0;
                scoreHudColdBaselineObservedGameClock = -1;
                scoreHudColdBaselineGameClockMoved = false;
                scoreHudColdBaselineEpochsAtLastGameClockChange = 0;
                scoreHudColdFreshScrimmageObserved = false;
            }

            if (scoreHudExpectedNonScrimmageSpecial != ScoreHudExpectedNone)
                ObservePlayClockEpoch(currentPlayClock,
                    ref scoreHudTransitionObservedPlayClock,
                    ref scoreHudTransitionPlayClockResetSeen,
                    ref scoreHudTransitionAllowInitialPlayClockEpoch,
                    ref scoreHudTransitionPlayClockEpochs);
            if (scoreHudColdBaselinePending)
            {
                bool allowInitialColdEpoch = false;
                ObservePlayClockEpoch(currentPlayClock,
                    ref scoreHudColdBaselineObservedPlayClock,
                    ref scoreHudColdBaselinePlayClockResetSeen,
                    ref allowInitialColdEpoch,
                    ref scoreHudColdBaselinePlayClockEpochs);
            }
            if (scoreHudExpectedNonScrimmageSpecial != ScoreHudExpectedNone)
                ObserveGameClockProgress(currentGameClock,
                    ref scoreHudTransitionObservedGameClock,
                    ref scoreHudTransitionGameClockMoved,
                    ref scoreHudTransitionEpochsAtLastGameClockChange,
                    scoreHudTransitionPlayClockEpochs);
            if (scoreHudColdBaselinePending)
                ObserveGameClockProgress(currentGameClock,
                    ref scoreHudColdBaselineObservedGameClock,
                    ref scoreHudColdBaselineGameClockMoved,
                    ref scoreHudColdBaselineEpochsAtLastGameClockChange,
                    scoreHudColdBaselinePlayClockEpochs);

            bool inOvertime = (currentQuarter.Available && currentQuarter.Value >= 5)
                || scoreHudTransitionQuarter >= 5;
            bool inTwoPointShootout = (currentQuarter.Available && currentQuarter.Value >= 7)
                || scoreHudTransitionQuarter >= 7;
            bool rawDistanceIsAmbiguous = currentDistance.Available
                && currentDistance.Value == 0;
            bool zeroDistanceStarted = rawDistanceIsAmbiguous
                && !scoreHudZeroDistanceActive;
            if (rawDistanceIsAmbiguous)
            {
                if (zeroDistanceStarted || !currentDown.Available
                    || scoreHudTrustedZeroDistanceDown != currentDown.Value)
                {
                    scoreHudZeroDistanceActive = true;
                    scoreHudTrustedZeroDistanceAddresses.Clear();
                    scoreHudTrustedZeroDistanceDown = currentDown.Available
                        ? currentDown.Value : -1;
                    nextScoreHudZeroDistanceRetryUtc = now;
                }
                for (int index = 0; index < liveCandidates.Count; index++)
                {
                    ScoreHudDownDistanceCandidate candidate = liveCandidates[index];
                    if (ScoreHudZeroDistanceProofMatches(candidate, currentDown,
                            semanticCandidateChanges))
                        scoreHudTrustedZeroDistanceAddresses.Add(candidate.Address);
                }
            }
            else
            {
                scoreHudZeroDistanceActive = false;
                scoreHudTrustedZeroDistanceAddresses.Clear();
                scoreHudTrustedZeroDistanceDown = -1;
                nextScoreHudZeroDistanceRetryUtc = DateTime.MinValue;
            }

            bool conversionVisibleNow = HasVisibleScoreHudDown(liveCandidates, -1);
            bool freshKickoffVisible = HasFreshVisibleScoreHudDown(
                liveCandidates, semanticCandidateChanges, 0);
            if (scoreHudExpectedNonScrimmageSpecial == ScoreHudExpectedConversion
                && !inOvertime && freshKickoffVisible)
                scoreHudFreshKickoffObserved = true;
            if (FailedConversionKickoffPromotionIsSafe(
                    scoreHudExpectedNonScrimmageSpecial, inOvertime,
                    scoreHudExpectedSpecialObserved, conversionVisibleNow,
                    scoreHudFreshKickoffObserved,
                    scoreHudTransitionPlayClockEpochs))
            {
                // A failed conversion has no score edge. Promote only when the
                // conversion we actually observed is gone and a newly activated
                // Kickoff object appears after a complete phase boundary.
                scoreHudExpectedNonScrimmageSpecial = ScoreHudExpectedKickoff;
                scoreHudTransitionScanUntilUtc = now.AddSeconds(25);
                nextScoreHudDelayedSpecialRetryUtc = now.AddSeconds(25);
                scoreHudTransitionObservedPlayClock = currentPlayClock.Available
                    ? currentPlayClock.Value : -1;
                scoreHudTransitionPlayClockResetSeen = false;
                scoreHudTransitionAllowInitialPlayClockEpoch = currentPlayClock.Available
                    && currentPlayClock.Value > 0;
                scoreHudTransitionPlayClockEpochs = 0;
                scoreHudTransitionObservedGameClock = currentGameClock.Available
                    ? currentGameClock.Value : -1;
                scoreHudTransitionGameClockMoved = false;
                scoreHudTransitionEpochsAtLastGameClockChange = 0;
                scoreHudExpectedSpecialObserved = false;
                scoreHudTransitionFreshScrimmageObserved = false;
                scoreHudTransitionFreshScrimmageEpoch = -1;
                scoreHudFreshKickoffObserved = false;
            }

            List<ScoreHudDownDistanceCandidate> selectableCandidates =
                FilterTrustedZeroDistanceCandidates(liveCandidates,
                    rawDistanceIsAmbiguous, scoreHudTrustedZeroDistanceAddresses);
            bool transitionActive = (scoreHudExpectedNonScrimmageSpecial
                    == ScoreHudExpectedKickoff
                    || scoreHudExpectedNonScrimmageSpecial
                        == ScoreHudExpectedConversion)
                && now < scoreHudTransitionScanUntilUtc;
            // A live Goal/Inches layer and a retained pooled one look identical
            // in their own fields: both carry Distance 0 and a matching down.
            // The numeric core cannot break the tie on goal-to-go because it
            // holds yards-to-goal there rather than 0, so use the observation
            // window instead - an object left over from an earlier drive does
            // not change while it sits in the pool.
            HashSet<long> freshGoalInchesAddresses = new HashSet<long>();
            if (selectableCandidates != null)
            {
                for (int index = 0; index < selectableCandidates.Count; index++)
                {
                    ScoreHudDownDistanceCandidate candidate = selectableCandidates[index];
                    if (ScoreHudGoalOrInchesCandidate(candidate)
                        && CandidateSemanticChangeIsRecent(candidate.Address, now))
                        freshGoalInchesAddresses.Add(candidate.Address);
                }
            }
            ScoreHudDownDistanceCandidate selected = SelectScoreHudDownDistanceCandidate(
                selectableCandidates, currentDown, currentDistance,
                scoreHudExpectedNonScrimmageSpecial, freshGoalInchesAddresses);
            ScoreHudDownDistanceCandidate numericSelected =
                SelectScoreHudDownDistanceCandidate(selectableCandidates, currentDown,
                    currentDistance, ScoreHudExpectedNone, freshGoalInchesAddresses);
            bool selectedIsSpecial = ScoreHudDownDistanceIsSpecial(selected);
            bool selectedIsNonScrimmageSpecial = selected != null
                && (selected.Down == 0 || selected.Down == -1);
            if (selectedIsNonScrimmageSpecial)
                scoreHudExpectedSpecialObserved = true;
            bool expectedSpecialCompleted = scoreHudExpectedSpecialObserved
                && !selectedIsNonScrimmageSpecial;
            bool exactNumericAvailable = AuthoritativeScrimmageScoreHudCandidateMatches(
                numericSelected, currentDown, currentDistance);
            bool positiveCoreNumericAvailable = PositiveCoreNumericResumeCandidateIsSafe(
                currentDown, currentDistance, selectedIsNonScrimmageSpecial);
            bool exactNumericBecameFresh = exactNumericAvailable
                && numericSelected != null
                && semanticCandidateChanges.Contains(numericSelected.Address);
            if (scoreHudColdBaselinePending && inOvertime
                && exactNumericBecameFresh)
                scoreHudColdFreshScrimmageObserved = true;
            if (scoreHudExpectedNonScrimmageSpecial != ScoreHudExpectedNone
                && exactNumericBecameFresh)
            {
                scoreHudTransitionFreshScrimmageObserved = true;
                scoreHudTransitionFreshScrimmageEpoch =
                    scoreHudTransitionPlayClockEpochs;
            }
            bool zeroDistanceResolved = rawDistanceIsAmbiguous && selectedIsSpecial
                && !selectedIsNonScrimmageSpecial;
            bool zeroDistanceScanDue = rawDistanceIsAmbiguous && !zeroDistanceResolved
                && now >= nextScoreHudZeroDistanceRetryUtc;
            bool transitionDownDistanceChanged = currentDown.Available
                && currentDistance.Available
                && scoreHudTransitionDown >= 0 && scoreHudTransitionDistance >= 0
                && (currentDown.Value != scoreHudTransitionDown
                    || currentDistance.Value != scoreHudTransitionDistance);
            bool canonicalSeriesStart = currentDown.Available
                && currentDistance.Available && currentDown.Value == 1
                && (currentDistance.Value == 10
                    || (currentDistance.Value == 0
                        && ScoreHudDownDistanceIsSpecial(numericSelected)));
            bool transitionHasPostClockEpoch = scoreHudTransitionGameClockMoved
                && scoreHudTransitionPlayClockEpochs
                    > scoreHudTransitionEpochsAtLastGameClockChange;
            bool coldHasPostClockEpoch = scoreHudColdBaselineGameClockMoved
                && scoreHudColdBaselinePlayClockEpochs
                    > scoreHudColdBaselineEpochsAtLastGameClockChange;
            bool transitionClockResumeProof = ScoreHudClockResumeProofIsSafe(
                scoreHudTransitionGameClockMoved, transitionHasPostClockEpoch,
                selectedIsNonScrimmageSpecial);
            bool coldClockResumeProof = ScoreHudClockResumeProofIsSafe(
                scoreHudColdBaselineGameClockMoved, coldHasPostClockEpoch,
                selectedIsNonScrimmageSpecial);
            bool coldBaselineNumericResumeEvidence = ColdScoreHudNumericResumeIsSafe(
                exactNumericAvailable, positiveCoreNumericAvailable,
                coldClockResumeProof, coldClockResumeProof,
                inOvertime, scoreHudColdFreshScrimmageObserved,
                scoreHudColdBaselinePlayClockEpochs);
            bool coldBaselineNumericResume = scoreHudColdBaselinePending
                && ScoreHudNumericRetirementIsAllowed(
                    selectedIsNonScrimmageSpecial,
                    coldBaselineNumericResumeEvidence);
            scoreHudColdBaselineResumeConfirmations = AdvanceConsecutiveConfirmation(
                coldBaselineNumericResume, scoreHudColdBaselineResumeConfirmations);
            if ((scoreHudColdBaselinePending && selectedIsSpecial
                    && !selectedIsNonScrimmageSpecial)
                || scoreHudColdBaselineResumeConfirmations >= 3)
            {
                scoreHudColdBaselinePending = false;
                scoreHudColdBaselineResumeConfirmations = 0;
                scoreHudColdBaselineObservedPlayClock = -1;
                scoreHudColdBaselinePlayClockResetSeen = false;
                scoreHudColdBaselinePlayClockEpochs = 0;
                scoreHudColdBaselineObservedGameClock = -1;
                scoreHudColdBaselineGameClockMoved = false;
                scoreHudColdBaselineEpochsAtLastGameClockChange = 0;
            }
            bool matchingNumericResumeEvidence = ScoreHudNumericResumeIsSafe(
                    scoreHudExpectedNonScrimmageSpecial, inOvertime,
                    exactNumericAvailable, positiveCoreNumericAvailable,
                    transitionDownDistanceChanged,
                    canonicalSeriesStart, scoreHudTransitionPlayClockEpochs,
                    transitionClockResumeProof, transitionClockResumeProof,
                    expectedSpecialCompleted, inTwoPointShootout,
                    scoreHudTransitionFreshScrimmageObserved,
                    scoreHudTransitionFreshScrimmageEpoch);
            bool matchingNumericResume = scoreHudExpectedNonScrimmageSpecial != ScoreHudExpectedNone
                && ScoreHudNumericRetirementIsAllowed(
                    selectedIsNonScrimmageSpecial,
                    matchingNumericResumeEvidence);
            scoreHudNumericResumeConfirmations = AdvanceConsecutiveConfirmation(
                matchingNumericResume, scoreHudNumericResumeConfirmations);
            if (scoreHudNumericResumeConfirmations >= 3)
            {
                // Retained pooled Kickoff/PAT objects are known to stay non-empty
                // mid-drive. Independent clock-cycle or OT down-change evidence
                // therefore retires the expectation even if one of those stale
                // objects still claims to be visible.
                scoreHudSpecialPending = false;
                ClearScoreHudPresentationExpectation();
                selected = numericSelected;
                selectedIsSpecial = ScoreHudDownDistanceIsSpecial(selected);
                selectedIsNonScrimmageSpecial = selected != null
                    && (selected.Down == 0 || selected.Down == -1);
                transitionActive = false;
            }
            else if (selectedIsNonScrimmageSpecial
                && !scoreHudFreshKickoffObserved
                && !ShouldSuppressExpectedScoreHudSpecial(
                    scoreHudExpectedNonScrimmageSpecial, inOvertime,
                    scoreHudTransitionGameClockMoved,
                    scoreHudTransitionPlayClockEpochs, inTwoPointShootout))
            {
                scoreHudSpecialPending = false;
                scoreHudColdBaselinePending = false;
                scoreHudColdBaselineResumeConfirmations = 0;
                scoreHudColdBaselineObservedPlayClock = -1;
                scoreHudColdBaselinePlayClockResetSeen = false;
                scoreHudColdBaselinePlayClockEpochs = 0;
                scoreHudColdBaselineObservedGameClock = -1;
                scoreHudColdBaselineGameClockMoved = false;
                scoreHudColdBaselineEpochsAtLastGameClockChange = 0;
            }
            else if (scoreHudExpectedNonScrimmageSpecial != ScoreHudExpectedNone)
            {
                // The scan deadline throttles expensive searches; it never
                // authorizes the underlying numeric layer. Stay blank until a
                // matching special or independently proven scrimmage resumes.
                scoreHudSpecialPending = true;
            }
            else if (rawDistanceIsAmbiguous)
                scoreHudSpecialPending = selected == null;
            else
            {
                scoreHudSpecialPending = scoreHudColdBaselinePending;
                scoreHudNumericResumeConfirmations = 0;
                nextScoreHudDelayedSpecialRetryUtc = DateTime.MinValue;
            }

            // A new down or a new distance is the moment ScoreHud can have
            // allocated a fresh special layer, so it is the moment worth looking.
            bool downDistanceChangedSinceLastScan =
                currentDown.Available && currentDistance.Available
                && (currentDown.Value != lastScannedDown
                    || currentDistance.Value != lastScannedDistance);
            if (currentDown.Available && currentDistance.Available)
            {
                lastScannedDown = currentDown.Value;
                lastScannedDistance = currentDistance.Value;
            }

            if (transitionBaselineInitializedNow)
            {
                if (rawDistanceIsAmbiguous)
                    nextScoreHudZeroDistanceRetryUtc = now.Add(ScoreHudZeroDistanceRetry);
                RequestScoreHudDiscovery();
            }
            else if (ShouldRequestScoreHudSpecialDiscovery(transitionStarted,
                    transitionActive,
                    scoreHudExpectedNonScrimmageSpecial == ScoreHudExpectedNone
                        && zeroDistanceScanDue,
                    transitionActive ? selectedIsNonScrimmageSpecial : selectedIsSpecial,
                    downDistanceChangedSinceLastScan))
            {
                if (zeroDistanceScanDue)
                    nextScoreHudZeroDistanceRetryUtc = now.Add(ScoreHudZeroDistanceRetry);
                // Milliseconds-scale look in the known pooled neighborhoods so
                // the next refresh can already poll a freshly allocated layer;
                // the background sweep below stays as the authority.
                TryFastScoreHudDownDistanceScan();
                RequestScoreHudDiscovery();
            }
            else if ((scoreHudExpectedNonScrimmageSpecial == ScoreHudExpectedKickoff
                    || scoreHudExpectedNonScrimmageSpecial == ScoreHudExpectedConversion)
                && !selectedIsNonScrimmageSpecial
                && now >= nextScoreHudDelayedSpecialRetryUtc)
            {
                // If the user pauses through the fast search window, preserve
                // the semantic expectation and retry slowly. A time limit may
                // throttle discovery but must never authorize stale yardage.
                nextScoreHudDelayedSpecialRetryUtc = now.AddSeconds(15);
                RequestScoreHudDiscovery();
            }
            else if (scoreHudColdBaselinePending
                && now >= nextScoreHudDelayedSpecialRetryUtc)
            {
                nextScoreHudDelayedSpecialRetryUtc = now.AddSeconds(15);
                RequestScoreHudDiscovery();
            }

            if (scoreHudSpecialPending) return null;
            if (selected != null) return RememberScoreHudDownDistance(selected);
            bool hasActiveCandidate = false;
            for (int index = 0; index < liveCandidates.Count; index++)
                if (!liveCandidates[index].IsEmpty) { hasActiveCandidate = true; break; }
            if (hasActiveCandidate || rawDistanceIsAmbiguous) return null;
            return RecentScoreHudDownDistance();
        }

        private void ClearScoreHudPresentationExpectation()
        {
            scoreHudExpectedNonScrimmageSpecial = ScoreHudExpectedNone;
            scoreHudNumericResumeConfirmations = 0;
            nextScoreHudDelayedSpecialRetryUtc = DateTime.MinValue;
            scoreHudTransitionScanUntilUtc = DateTime.MinValue;
            scoreHudTransitionQuarter = 0;
            scoreHudTransitionDown = -1;
            scoreHudTransitionDistance = -1;
            scoreHudTransitionObservedPlayClock = -1;
            scoreHudTransitionPlayClockResetSeen = false;
            scoreHudTransitionAllowInitialPlayClockEpoch = false;
            scoreHudTransitionPlayClockEpochs = 0;
            scoreHudTransitionObservedGameClock = -1;
            scoreHudTransitionGameClockMoved = false;
            scoreHudTransitionEpochsAtLastGameClockChange = 0;
            scoreHudExpectedSpecialObserved = false;
            scoreHudTransitionFreshScrimmageObserved = false;
            scoreHudTransitionFreshScrimmageEpoch = -1;
            scoreHudFreshKickoffObserved = false;
        }

        internal static void ObservePlayClockEpoch(RamReadResult currentPlayClock,
            ref int observedPlayClock, ref bool resetSeen,
            ref bool allowInitialCountdown, ref int completedEpochs)
        {
            if (!currentPlayClock.Available) return;
            int value = currentPlayClock.Value;
            if (observedPlayClock < 0)
            {
                observedPlayClock = value;
                return;
            }
            if (value > observedPlayClock)
                resetSeen = true;
            else if (value > 0 && value < observedPlayClock
                && (resetSeen || allowInitialCountdown))
            {
                completedEpochs++;
                resetSeen = false;
                allowInitialCountdown = false;
            }
            observedPlayClock = value;
        }

        internal static void ObserveGameClockProgress(RamReadResult currentGameClock,
            ref int observedGameClock, ref bool clockMoved,
            ref int epochsAtLastClockChange, int completedPlayClockEpochs)
        {
            if (!currentGameClock.Available) return;
            int value = currentGameClock.Value;
            if (observedGameClock < 0)
            {
                observedGameClock = value;
                return;
            }
            if (value < observedGameClock && !clockMoved)
            {
                clockMoved = true;
                epochsAtLastClockChange = completedPlayClockEpochs;
            }
            else if (value > observedGameClock)
            {
                clockMoved = false;
                epochsAtLastClockChange = completedPlayClockEpochs;
            }
            observedGameClock = value;
        }

        internal static bool ScoreHudNumericResumeIsSafe(int expectedSpecial,
            bool inOvertime, bool exactNumericAvailable,
            bool positiveCoreNumericAvailable,
            bool downDistanceChanged, bool canonicalSeriesStart,
            int completedPlayClockEpochs, bool gameClockMoved,
            bool postGameClockPlayClockEpoch,
            bool expectedSpecialCompleted, bool inTwoPointShootout,
            bool freshScrimmageObserved, int freshScrimmageEpoch)
        {
            if (!inOvertime)
            {
                if (expectedSpecial != ScoreHudExpectedNone
                    && (exactNumericAvailable || positiveCoreNumericAvailable)
                    && gameClockMoved && postGameClockPlayClockEpoch) return true;
                if (!exactNumericAvailable) return false;
                bool plausibleScrimmage = downDistanceChanged || canonicalSeriesStart;
                if (expectedSpecial == ScoreHudExpectedKickoff)
                    return freshScrimmageObserved && plausibleScrimmage
                        && freshScrimmageEpoch >= 2
                        && completedPlayClockEpochs >= 2;
                if (expectedSpecial == ScoreHudExpectedConversion)
                    return freshScrimmageObserved && plausibleScrimmage
                        && freshScrimmageEpoch >= 3
                        && completedPlayClockEpochs >= 3;
                return false;
            }
            if (!exactNumericAvailable) return false;
            if (expectedSpecial == ScoreHudExpectedKickoff) return false;
            // In clockless overtime, pooled conversion/numeric objects and
            // timeout-driven play-clock resets do not independently prove that
            // the presentation advanced to the next possession. Stay blank.
            if (expectedSpecial == ScoreHudExpectedConversion
                || expectedSpecial == ScoreHudExpectedAwaitScrimmage) return false;
            return false;
        }

        internal static bool PositiveCoreNumericResumeCandidateIsSafe(
            RamReadResult down, RamReadResult distance,
            bool nonScrimmageSpecialVisible)
        {
            return !nonScrimmageSpecialVisible
                && down.Available && down.Value >= 1 && down.Value <= 4
                && distance.Available && distance.Value > 0;
        }

        internal static bool ScoreHudClockResumeProofIsSafe(
            bool gameClockMoved, bool postGameClockPlayClockEpoch,
            bool nonScrimmageSpecialVisible)
        {
            return gameClockMoved && postGameClockPlayClockEpoch
                && !nonScrimmageSpecialVisible;
        }

        internal static bool ScoreHudNumericRetirementIsAllowed(
            bool nonScrimmageSpecialVisible, bool resumeEvidence)
        {
            return resumeEvidence && !nonScrimmageSpecialVisible;
        }

        internal static bool ColdScoreHudNumericResumeIsSafe(
            bool exactNumericAvailable, bool positiveCoreNumericAvailable,
            bool gameClockMoved,
            bool postGameClockPlayClockEpoch, bool inOvertime,
            bool freshScrimmageObserved, int completedPlayClockEpochs)
        {
            // With no before-state, only a running-clock play followed by a new
            // play-clock epoch proves the presentation beneath it is scrimmage.
            if (inOvertime) return false;
            return (exactNumericAvailable || positiveCoreNumericAvailable)
                && gameClockMoved && postGameClockPlayClockEpoch;
        }

        internal static bool ShouldSuppressExpectedScoreHudSpecial(
            int expectedSpecial, bool inOvertime, bool gameClockMoved,
            int completedPlayClockEpochs, bool inTwoPointShootout)
        {
            if (expectedSpecial == ScoreHudExpectedNone) return false;
            if (!inOvertime && gameClockMoved) return true;
            if (expectedSpecial == ScoreHudExpectedKickoff)
                return completedPlayClockEpochs >= 2;
            if (expectedSpecial == ScoreHudExpectedConversion)
                return !inTwoPointShootout && completedPlayClockEpochs >= 2;
            return true;
        }

        private static bool AuthoritativeScrimmageScoreHudCandidateMatches(
            ScoreHudDownDistanceCandidate candidate, RamReadResult currentDown,
            RamReadResult currentDistance)
        {
            if (candidate == null || candidate.IsEmpty
                || candidate.Down < 1 || candidate.Down > 4
                || !currentDown.Available || !currentDistance.Available
                || candidate.Down != currentDown.Value) return false;
            string display = (candidate.Display ?? String.Empty).ToUpperInvariant();
            bool specialZero = display.Contains("GOAL") || display.Contains("INCH");
            if (currentDistance.Value == 0)
                return specialZero && candidate.Distance == 0;
            return currentDistance.Value > 0 && !specialZero
                && candidate.Distance == currentDistance.Value;
        }

        private int ObserveScoreHudPresentationTransition(
            RamReadResult quarter, RamReadResult homeScore, RamReadResult awayScore,
            RamReadResult down, RamReadResult distance,
            out bool baselineInitializedNow, out int previousDown,
            out int previousDistance)
        {
            baselineInitializedNow = false;
            previousDown = scoreHudTransitionBaselineDown;
            previousDistance = scoreHudTransitionBaselineDistance;
            if (scanner.Process == null || scanner.Process.HasExited
                || !quarter.Available || !homeScore.Available || !awayScore.Available)
                return ScoreHudExpectedNone;
            int processId = scanner.Process.Id;
            if (!scoreHudTransitionBaselineInitialized
                || scoreHudTransitionBaselineProcessId != processId)
            {
                scoreHudTransitionBaselineInitialized = true;
                scoreHudTransitionBaselineProcessId = processId;
                scoreHudTransitionBaselineQuarter = quarter.Value;
                scoreHudTransitionBaselineHomeScore = homeScore.Value;
                scoreHudTransitionBaselineAwayScore = awayScore.Value;
                if (down.Available && distance.Available)
                {
                    scoreHudTransitionBaselineDown = down.Value;
                    scoreHudTransitionBaselineDistance = distance.Value;
                }
                else
                {
                    scoreHudTransitionBaselineDown = -1;
                    scoreHudTransitionBaselineDistance = -1;
                }
                previousDown = scoreHudTransitionBaselineDown;
                previousDistance = scoreHudTransitionBaselineDistance;
                baselineInitializedNow = true;
                return ScoreHudExpectedNone;
            }

            previousDown = scoreHudTransitionBaselineDown;
            previousDistance = scoreHudTransitionBaselineDistance;
            int expected = ExpectedScoreHudSpecialForTransition(
                scoreHudTransitionBaselineQuarter,
                scoreHudTransitionBaselineHomeScore,
                scoreHudTransitionBaselineAwayScore,
                quarter.Value, homeScore.Value, awayScore.Value);
            // Update immediately, including while PAT/Kickoff is visible. The
            // logical game-state baseline intentionally pauses in those states
            // and therefore cannot safely drive this one-shot scan trigger.
            scoreHudTransitionBaselineQuarter = quarter.Value;
            scoreHudTransitionBaselineHomeScore = homeScore.Value;
            scoreHudTransitionBaselineAwayScore = awayScore.Value;
            if (down.Available && distance.Available)
            {
                scoreHudTransitionBaselineDown = down.Value;
                scoreHudTransitionBaselineDistance = distance.Value;
            }
            return expected;
        }

        internal static int ExpectedScoreHudSpecialForTransition(
            int previousQuarter, int previousHomeScore, int previousAwayScore,
            int currentQuarter, int currentHomeScore, int currentAwayScore)
        {
            if (currentQuarter != previousQuarter
                && (currentQuarter == 1 || currentQuarter == 3))
                return ScoreHudExpectedKickoff;
            if (currentQuarter != previousQuarter && currentQuarter >= 5)
                return currentQuarter >= 7
                    ? ScoreHudExpectedConversion
                    : ScoreHudExpectedAwaitScrimmage;
            int homeDelta = currentHomeScore - previousHomeScore;
            int awayDelta = currentAwayScore - previousAwayScore;
            bool scoreChanged = homeDelta != 0 || awayDelta != 0;
            if (!scoreChanged) return ScoreHudExpectedNone;
            if (homeDelta < 0 || awayDelta < 0 || (homeDelta > 0 && awayDelta > 0))
                return ScoreHudExpectedAwaitScrimmage;
            int scoreDelta = homeDelta + awayDelta;
            if (scoreDelta <= 0) return ScoreHudExpectedAwaitScrimmage;
            if (scoreDelta == 6) return ScoreHudExpectedConversion;
            if (currentQuarter >= 7 && scoreDelta == 2)
                return ScoreHudExpectedConversion;
            if (scoreDelta == 1 || scoreDelta == 2 || scoreDelta == 3
                || scoreDelta == 7 || scoreDelta == 8)
                return currentQuarter >= 5
                    ? ScoreHudExpectedAwaitScrimmage
                    : ScoreHudExpectedKickoff;
            return ScoreHudExpectedAwaitScrimmage;
        }

        internal static int ExpectedScoreHudSpecialForColdBaseline(
            bool baselineInitializedNow, bool currentDownAvailable,
            bool visibleKickoff, bool visibleConversion)
        {
            // Without a pre-attach observation, even one visible pooled object
            // can be retained from an earlier presentation. Never assign a
            // Kickoff/Conversion meaning at cold attach from visibility alone.
            return ScoreHudExpectedNone;
        }

        internal static bool FailedConversionKickoffObservationIsValid(
            int expectedSpecial, bool conversionWasSeen,
            bool kickoffWasVisibleAtConversionStart,
            bool conversionVisibleNow, bool kickoffVisibleNow)
        {
            // Pooled Kickoff objects can remain non-empty for an entire drive;
            // visibility is not independent evidence that a conversion ended.
            // Runtime promotion is instead tied to regulation game-clock motion.
            return false;
        }

        internal static bool FailedConversionKickoffPromotionIsSafe(
            int expectedSpecial, bool inOvertime, bool conversionWasObserved,
            bool conversionVisibleNow, bool freshKickoffWasObserved,
            int completedPlayClockEpochs)
        {
            // A failed try has no score edge, and retained pooled Down -1/0
            // objects plus timeout play-clock resets cannot prove the next
            // presentation phase. Keep it pending instead of guessing Kickoff.
            return false;
        }

        internal static int AdvanceConsecutiveConfirmation(
            bool observationIsValid, int currentConfirmations)
        {
            return observationIsValid ? currentConfirmations + 1 : 0;
        }

        private static bool HasVisibleScoreHudDown(
            List<ScoreHudDownDistanceCandidate> candidates, int down)
        {
            if (candidates == null) return false;
            for (int index = 0; index < candidates.Count; index++)
                if (candidates[index] != null && !candidates[index].IsEmpty
                    && candidates[index].Down == down) return true;
            return false;
        }

        internal bool TryAcquireFullMemoryScan(out long token)
        {
            lock (fullMemoryScanSync)
            {
                if (fullMemoryScanRunning)
                {
                    token = 0;
                    return false;
                }
                fullMemoryScanRunning = true;
                token = ++fullMemoryScanToken;
                return true;
            }
        }

        internal void ReleaseFullMemoryScan(long token)
        {
            lock (fullMemoryScanSync)
            {
                if (fullMemoryScanRunning && token == fullMemoryScanToken)
                    fullMemoryScanRunning = false;
            }
        }

        private void RequestScoreHudDiscovery()
        {
            if (scanner.Process == null || scanner.Process.HasExited
                || resolvedProcessId != scanner.Process.Id) return;
            int processId = scanner.Process.Id;
            int generation;
            int discoveryMatchupGeneration;
            lock (scoreHudDiscoverySync)
            {
                scoreHudDiscoveryRequested = true;
                if (scoreHudDiscoveryRunning || DateTime.UtcNow < nextScoreHudDiscoveryUtc) return;
                scoreHudDiscoveryRunning = true;
                generation = scoreHudDiscoveryGeneration;
                discoveryMatchupGeneration = matchupGeneration;
                nextScoreHudDiscoveryUtc = DateTime.UtcNow.Add(ScoreHudDiscoveryInterval());
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                ScoreHudDiscoveryResult result = null;
                long scanToken = 0;
                bool scanAcquired = false;
                try
                {
                    lock (scoreHudDiscoverySync)
                        if (generation != scoreHudDiscoveryGeneration) return;
                    if (TryAcquireFullMemoryScan(out scanToken))
                    {
                        scanAcquired = true;
                        lock (scoreHudDiscoverySync)
                            if (generation != scoreHudDiscoveryGeneration) return;
                        ScoreHudDiscoveryResult collected = new ScoreHudDiscoveryResult(
                            processId, discoveryMatchupGeneration);
                        Process game = Process.GetProcessById(processId);
                        using (MemoryScanner backgroundScanner = new MemoryScanner())
                        {
                            backgroundScanner.Attach(game);
                            backgroundScanner.FindLiveScoreHudSnapshot(
                                CancellationToken.None, out collected.Teams,
                                out collected.DownDistance, out collected.Messages);
                        }
                        result = collected;
                    }
                }
                catch { }
                finally
                {
                    if (scanToken != 0) ReleaseFullMemoryScan(scanToken);
                }
                lock (scoreHudDiscoverySync)
                {
                    if (generation == scoreHudDiscoveryGeneration)
                    {
                        if (result != null)
                        {
                            pendingScoreHudDiscovery = result;
                            scoreHudDiscoveryRequested = false;
                        }
                        scoreHudDiscoveryRunning = false;
                        nextScoreHudDiscoveryUtc = result == null && !scanAcquired
                            ? DateTime.UtcNow.AddMilliseconds(250)
                            : DateTime.UtcNow.Add(ScoreHudDiscoveryInterval());
                    }
                }
            });
        }

        // A zero reading from the numeric core means Goal or Inches is on screen
        // right now, and the down-and-distance plate stays blank until the
        // labelled layer is located. The retry was throttled to 15 seconds
        // because a sweep used to cost several; it now costs about one, and a
        // 4th & Inches is over long before 15 seconds elapse. Retry promptly:
        // the window is short and the plate is empty for every bit of it.
        private static readonly TimeSpan ScoreHudZeroDistanceRetry =
            TimeSpan.FromSeconds(1);

        private int lastScannedDown = -1;
        private int lastScannedDistance = -1;

        // Fast path for freshly allocated special layers (Goal, Inches,
        // Kickoff, PAT): the pooled neighborhoods of every down-distance
        // address seen this process. A targeted window scan there finds a new
        // object in milliseconds where the full sweep needs a second-plus -
        // the difference between "4th & Inches" appearing with the snap or
        // after it. Additive only; the full sweep remains the authority.
        private readonly HashSet<long> scoreHudDownDistanceAnchors = new HashSet<long>();
        private DateTime nextFastScoreHudScanUtc = DateTime.MinValue;

        private void TryFastScoreHudDownDistanceScan()
        {
            if (scanner.Process == null || scanner.Process.HasExited
                || resolvedProcessId != scanner.Process.Id
                || scoreHudDownDistanceAnchors.Count == 0) return;
            if (DateTime.UtcNow < nextFastScoreHudScanUtc) return;
            nextFastScoreHudScanUtc = DateTime.UtcNow.AddMilliseconds(400);
            List<ScoreHudDownDistanceCandidate> found;
            try
            {
                found = scanner.FindDownDistanceCandidatesNear(
                    scoreHudDownDistanceAnchors, 12);
            }
            catch { return; }
            if (found.Count == 0) return;
            List<long> merged = CopyConfiguredAddresses("scoreHudDownDistance");
            bool changed = false;
            for (int index = 0; index < found.Count; index++)
            {
                long address = found[index].Address;
                RememberScoreHudDownDistanceAnchor(address);
                if (merged.Contains(address)) continue;
                merged.Add(address);
                changed = true;
            }
            if (!changed) return;
            merged.Sort();
            if (merged.Count > 32) merged.RemoveRange(0, merged.Count - 32);
            SetField("scoreHudDownDistance", merged);
        }

        private void RememberScoreHudDownDistanceAnchor(long address)
        {
            if (address > 0 && scoreHudDownDistanceAnchors.Count < 256)
                scoreHudDownDistanceAnchors.Add(address);
        }

        // DIAGNOSTIC. Records why timeout binding declined on the last attempt,
        // published as discovery.timeoutBind. Every path that gives up on the
        // timeout fields sets this, so a failure names its own cause instead of
        // being indistinguishable from "not there".
        private string timeoutBindDiagnostic = "not attempted";
        // DIAGNOSTIC: whether the slot install ran at all, and why it declined.
        private string timeoutInstallDiagnostic = "never called";
        // Timeout copies are not always present in a single sweep. When they
        // are missing, keep re-running discovery on a slow cadence instead of
        // giving up until the process or matchup changes.
        private DateTime nextTimeoutRecoveryDiscoveryUtc = DateTime.MinValue;
        // Bounded retries for the ScoreHud-derived fields, reset per matchup
        // AND per quarter. The per-matchup reset alone meant a budget burned
        // in the 1st quarter left timeouts unrecoverable for the remaining
        // three - observed as a 23-minute timeout blackout in a live Dynasty
        // game. A quarter is a natural bound: at most 18 sweeps 10s apart per
        // quarter, and a loss in any quarter gets a fresh chance in the next.
        private const int MaximumScoreHudRecoveryAttempts = 18;
        private int scoreHudRecoveryAttempts;
        private int scoreHudRecoveryQuarter = -1;
        // Consecutive sweeps where the bound sides stopped matching their
        // scores. Enough of them means the orientation is wrong, not that a
        // score was caught mid-update.
        private int lostScoreHudBindCount;
        private string catalogTimeoutDiagnostic = "not checked";
        // Why ranks and records are or are not bound. The rank/record path
        // had no diagnostic at all, so a silent early return was
        // indistinguishable from the game simply having no ranked teams.
        private string rankBindDiagnostic = "never called";
        private string teamIdNamesDiagnostic = "never called";
        private string teamRoleDiagnostic = "never called";
        private string matchupBindDiagnostic = "never called";
        // How the currently published pair was obtained. A fallback pair has
        // no labelled role binding to validate against, so checks that assume
        // one must be skipped for it rather than treated as a failure.
        private bool lastMatchupFromFallback;

        // DIAGNOSTIC. Why possession had no address on the last discovery.
        private string possessionBindDiagnostic = "not evaluated";

        // HUD possession. The probe game of 2026-08-13 (VT at UNC, 111
        // samples) settled the source question: the ScoreHud team objects'
        // +72 flag matched the game's derivable truth at every checkpoint -
        // scoring drives, post-score kickoffs, turnovers on downs, and a
        // safety - and was always cleanly complementary, while the timeout-
        // clone byte flapped mid-drive and the legacy record was readable for
        // only two samples. Publication rules: the two oriented objects must
        // disagree complementarily, a flip needs two consecutive agreeing
        // reads, brief read failures hold the last confirmed value (bounded),
        // and everything resets with the orientation it depends on.
        private int hudPossessionPublished = -1;
        private int hudPossessionPending = -1;
        private int hudPossessionPendingCount;
        private DateTime hudPossessionLastConfirmedUtc;
        private const int HudPossessionRequiredConfirmations = 2;
        private static readonly TimeSpan HudPossessionHoldWindow = TimeSpan.FromSeconds(120);

        // HUD timeouts, same discipline as HUD possession: per side, a value
        // needs two consecutive score-guarded reads to publish, the last
        // published value holds through brief churn, and it all resets with
        // the orientation. Diagnostic names why nothing publishes.
        private readonly int[] hudTimeoutsPublished = new int[] { -1, -1 };
        private readonly int[] hudTimeoutsPending = new int[] { -1, -1 };
        private readonly int[] hudTimeoutsPendingCount = new int[] { 0, 0 };
        private readonly DateTime[] hudTimeoutsLastConfirmedUtc = new DateTime[] { DateTime.MinValue, DateTime.MinValue };
        private const int HudTimeoutsRequiredConfirmations = 2;
        private static readonly TimeSpan HudTimeoutsHoldWindow = TimeSpan.FromSeconds(120);
        private string hudTimeoutsDiagnostic = "not attempted";

        // PROBES. Two append-only logs that cost nothing on screen and decide
        // two open questions with one game of ordinary play:
        //
        // possession-probe.jsonl records all three candidate possession sources
        // side by side (the legacy record, the timeout-clone byte at slot-0x13,
        // and the ScoreHud team objects' +72 flag) every time any of them
        // changes. Whichever source tracks the truth through kickoffs,
        // turnovers and punts is the one SelectVerifiedPossession learns to
        // trust in the next build.
        //
        // ballspot-probe.jsonl records the unidentified numeric slots near the
        // two known catalog-relative game-state values (live down +0x677F8,
        // timeouts +0x67850) on every down/distance change. One of them is
        // expected to be the ball position, which is the missing input for
        // calling Goal vs Inches when the numeric distance reads 0.
        //
        // Both logs are capped, change-driven, and wrapped so no failure can
        // reach the live export path.
        private string possessionProbeSignature;
        private string ballSpotProbeSignature;
        private string possessionProbeSummary = "not sampled";
        private const long MaximumProbeLogBytes = 5 * 1024 * 1024;

        private void RetryRequestedScoreHudDiscovery()
        {
            bool requested;
            lock (scoreHudDiscoverySync) requested = scoreHudDiscoveryRequested;
            if (requested) RequestScoreHudDiscovery();
        }

        // ScoreHud allocates a new object for each special presentation, so a
        // Kickoff, PAT, Goal or Inches can only be found by a sweep that starts
        // after it appears - and the graphic is often gone within a few seconds.
        //
        // The interval only sets the gap between attempts. Whether an attempt
        // happens at all is decided by ShouldRequestScoreHudSpecialDiscovery, and
        // a completed sweep clears the request, so ordinary play still costs one
        // sweep per new down. Only one sweep runs at a time, so a short interval
        // cannot stack scans. Given that, there is no reason to wait: retry as
        // soon as the last attempt finished.
        //
        // This previously used two seconds for anything that was not a kickoff or
        // PAT. Goal-to-go and short yardage are ordinary scrimmage downs, so they
        // took that slow path on top of the sweep itself - which is exactly why
        // they showed up late while kickoffs did not.
        private TimeSpan ScoreHudDiscoveryInterval()
        {
            return TimeSpan.FromMilliseconds(250);
        }

        private ScoreHudDownDistanceCandidate ApplyCompletedScoreHudDiscovery()
        {
            ScoreHudDiscoveryResult result = null;
            lock (scoreHudDiscoverySync)
            {
                if (pendingScoreHudDiscovery != null)
                {
                    result = pendingScoreHudDiscovery;
                    pendingScoreHudDiscovery = null;
                }
            }
            if (result == null || scanner.Process == null || scanner.Process.Id != result.ProcessId
                || result.MatchupGeneration != matchupGeneration)
                return null;

            // A game patch dangles every compiled-in ScoreHud offset at once,
            // and this is where it shows: sweep after sweep with NOTHING in
            // it. Count them; three in a row arms the offset re-derivation.
            if (result.Teams.Count == 0 && result.DownDistance.Count == 0
                && result.Messages.Count == 0)
            {
                consecutiveEmptyScoreHudSweeps++;
            }
            else
            {
                if (scoreHudRebaseApplied && !scoreHudRebaseVerifiedLogged)
                {
                    scoreHudRebaseVerifiedLogged = true;
                    LogScoreHudRebase("verified", "Rebased offsets confirmed by a live sweep: "
                        + result.Teams.Count.ToString(CultureInfo.InvariantCulture) + " team, "
                        + result.DownDistance.Count.ToString(CultureInfo.InvariantCulture) + " down-distance, "
                        + result.Messages.Count.ToString(CultureInfo.InvariantCulture) + " message objects.");
                }
                consecutiveEmptyScoreHudSweeps = 0;
            }

            foreach (ScoreHudMessageCandidate sweepMessage in result.Messages)
                if (scoreHudTextAnchors.Count < 256 && sweepMessage.Address != 0)
                    scoreHudTextAnchors.Add(sweepMessage.Address);
            RememberScoreHudMessages(result.Messages);
            scoreHudTeamCandidateCount = result.Teams.Count;
            scoreHudDownDistanceCandidateCount = result.DownDistance.Count;
            ApplyScoreHudRankCandidates(result.Teams,
                result.MatchupGeneration == matchupGeneration);
            if (result.DownDistance.Count == 0) return null;

            ScoreHudDownDistanceCandidate selected = SelectCurrentScoreHudDownDistance(result.DownDistance);
            List<long> addresses = new List<long>();
            for (int index = 0; index < result.DownDistance.Count; index++)
            {
                long address = result.DownDistance[index].Address;
                RememberScoreHudDownDistanceAnchor(address);
                if (address > 0 && !addresses.Contains(address)) addresses.Add(address);
            }
            addresses.Sort();
            SetField("scoreHudDownDistance", addresses);
            return selected;
        }

        private ScoreHudDownDistanceCandidate SelectCurrentScoreHudDownDistance(
            List<ScoreHudDownDistanceCandidate> candidates)
        {
            RamReadResult currentDown = Read("down", 1, 4);
            RamReadResult currentDistance = Read("distance", 0, 99);
            return SelectScoreHudDownDistanceCandidate(candidates, currentDown,
                currentDistance, scoreHudExpectedNonScrimmageSpecial);
        }

        private void ObserveScoreHudCandidateChanges(
            List<ScoreHudDownDistanceCandidate> candidates, bool suppressFreshness,
            out HashSet<long> activated, out HashSet<long> semanticChanges)
        {
            activated = new HashSet<long>();
            semanticChanges = new HashSet<long>();
            if (candidates == null) return;
            for (int index = 0; index < candidates.Count; index++)
            {
                ScoreHudDownDistanceCandidate candidate = candidates[index];
                if (candidate == null || candidate.Address <= 0) continue;
                string currentState = ScoreHudCandidateStateKey(candidate);
                string previousState;
                bool hadPrevious = scoreHudObservedCandidateStates.TryGetValue(
                    candidate.Address, out previousState);
                if (!suppressFreshness && hadPrevious && !candidate.IsEmpty)
                {
                    bool previousWasEmpty = previousState.StartsWith("1|",
                        StringComparison.Ordinal);
                    string previousSemantic = ScoreHudCandidateSemanticState(
                        previousState);
                    string currentSemantic = ScoreHudCandidateSemanticState(
                        currentState);
                    bool semanticChanged = !String.Equals(previousSemantic,
                        currentSemantic, StringComparison.Ordinal);
                    if (semanticChanged)
                    {
                        semanticChanges.Add(candidate.Address);
                        scoreHudCandidateSemanticChangeUtc[candidate.Address] =
                            DateTime.UtcNow;
                    }
                    if (semanticChanged || previousWasEmpty)
                    {
                        activated.Add(candidate.Address);
                        scoreHudCandidateActivationUtc[candidate.Address] =
                            DateTime.UtcNow;
                    }
                }
                scoreHudObservedCandidateStates[candidate.Address] = currentState;
            }
        }

        internal static string ScoreHudCandidateStateKey(
            ScoreHudDownDistanceCandidate candidate)
        {
            if (candidate == null) return "missing";
            return (candidate.IsEmpty ? "1" : "0") + "|"
                + candidate.Down.ToString(CultureInfo.InvariantCulture) + "|"
                + candidate.Distance.ToString(CultureInfo.InvariantCulture) + "|"
                + (candidate.Display ?? String.Empty).Trim().ToUpperInvariant();
        }

        private static string ScoreHudCandidateSemanticState(string state)
        {
            if (String.IsNullOrEmpty(state)) return String.Empty;
            int separator = state.IndexOf('|');
            return separator >= 0 && separator + 1 < state.Length
                ? state.Substring(separator + 1) : state;
        }

        private bool CandidateActivationIsRecent(long address, DateTime now)
        {
            DateTime activatedUtc;
            return address > 0
                && scoreHudCandidateActivationUtc.TryGetValue(address,
                    out activatedUtc)
                && now - activatedUtc >= TimeSpan.Zero
                && now - activatedUtc <= TimeSpan.FromSeconds(2);
        }

        private bool CandidateSemanticChangeIsRecent(long address, DateTime now)
        {
            DateTime changedUtc;
            return address > 0
                && scoreHudCandidateSemanticChangeUtc.TryGetValue(address,
                    out changedUtc)
                && now - changedUtc >= TimeSpan.Zero
                && now - changedUtc <= TimeSpan.FromSeconds(2);
        }

        // A Goal/Inches layer identifies itself by its display text, not by its
        // Distance field. A live capture on 2026-08-11 read
        // { display "3rd & Goal", down 3, distance 50 } - 50 being the same
        // not-applicable sentinel the Kickoff and PAT objects carry. Requiring
        // Distance 0, as this did, meant no genuine Goal or Inches layer ever
        // qualified, which is why the overlay kept publishing plain yardage.
        // ScoreHudDownDistanceIsSpecial already classified these by display
        // alone; this now agrees with it.
        internal static bool ScoreHudGoalOrInchesCandidate(
            ScoreHudDownDistanceCandidate candidate)
        {
            if (candidate == null || candidate.IsEmpty
                || candidate.Down < 1 || candidate.Down > 4) return false;
            string display = (candidate.Display ?? String.Empty).ToUpperInvariant();
            return display.Contains("GOAL") || display.Contains("INCH");
        }

        // The meaning a Goal/Inches candidate asserts about the current down.
        // Two candidates that disagree here cannot both be live.
        private static string ScoreHudSpecialMeaning(
            ScoreHudDownDistanceCandidate candidate)
        {
            if (!ScoreHudGoalOrInchesCandidate(candidate)) return null;
            string display = (candidate.Display ?? String.Empty).ToUpperInvariant();
            string kind = display.Contains("GOAL") ? "goal" : "inches";
            return kind + ":" + candidate.Down.ToString(CultureInfo.InvariantCulture);
        }

        internal static bool ScoreHudZeroDistanceProofMatches(
            ScoreHudDownDistanceCandidate candidate, RamReadResult currentDown,
            ISet<long> semanticChanges)
        {
            return ScoreHudGoalOrInchesCandidate(candidate)
                && currentDown != null && currentDown.Available
                && candidate.Down == currentDown.Value
                && semanticChanges != null
                && semanticChanges.Contains(candidate.Address);
        }

        internal static List<ScoreHudDownDistanceCandidate>
            FilterTrustedZeroDistanceCandidates(
                List<ScoreHudDownDistanceCandidate> candidates,
                bool zeroDistanceActive, ISet<long> trustedAddresses)
        {
            if (!zeroDistanceActive || candidates == null) return candidates;

            // The hazard here is choosing between two pooled special layers that
            // disagree - a Goal object and an Inches object sitting on the same
            // down, where a bare zero from the numeric core cannot say which is
            // live. Holding those back until one is proven fresh is correct.
            //
            // Holding back a lone self-identifying layer is not: it has nothing
            // to be confused with, and a freshly discovered object can never be
            // proven "fresh" because proof requires having watched it change,
            // which never happens to a label that appears already populated. The
            // result was a blank down-and-distance plate for the whole play on
            // 4th & Inches and on goal-line snaps. Only disambiguate when there
            // is genuinely something to disambiguate.
            string meaning = null;
            bool conflicting = false;
            for (int index = 0; index < candidates.Count && !conflicting; index++)
            {
                string candidateMeaning = ScoreHudSpecialMeaning(candidates[index]);
                if (candidateMeaning == null) continue;
                if (meaning == null) meaning = candidateMeaning;
                else if (!String.Equals(meaning, candidateMeaning, StringComparison.Ordinal))
                    conflicting = true;
            }
            if (!conflicting) return candidates;

            List<ScoreHudDownDistanceCandidate> filtered =
                new List<ScoreHudDownDistanceCandidate>();
            for (int index = 0; index < candidates.Count; index++)
            {
                ScoreHudDownDistanceCandidate candidate = candidates[index];
                if (ScoreHudGoalOrInchesCandidate(candidate)
                    && (trustedAddresses == null
                        || !trustedAddresses.Contains(candidate.Address)))
                    continue;
                filtered.Add(candidate);
            }
            return filtered;
        }

        private static bool HasFreshVisibleScoreHudDown(
            List<ScoreHudDownDistanceCandidate> candidates,
            ISet<long> freshAddresses, int down)
        {
            if (candidates == null || freshAddresses == null) return false;
            for (int index = 0; index < candidates.Count; index++)
            {
                ScoreHudDownDistanceCandidate candidate = candidates[index];
                if (candidate != null && !candidate.IsEmpty
                    && candidate.Down == down
                    && freshAddresses.Contains(candidate.Address)) return true;
            }
            return false;
        }

        internal static ScoreHudDownDistanceCandidate SelectScoreHudDownDistanceCandidate(
            List<ScoreHudDownDistanceCandidate> candidates, RamReadResult currentDown,
            RamReadResult currentDistance)
        {
            return SelectScoreHudDownDistanceCandidate(
                candidates, currentDown, currentDistance, ScoreHudExpectedNone);
        }

        internal static ScoreHudDownDistanceCandidate SelectScoreHudDownDistanceCandidate(
            List<ScoreHudDownDistanceCandidate> candidates, RamReadResult currentDown,
            RamReadResult currentDistance, int expectedNonScrimmageSpecial)
        {
            return SelectScoreHudDownDistanceCandidate(candidates, currentDown,
                currentDistance, expectedNonScrimmageSpecial, null);
        }

        // freshGoalInchesAddresses holds the Goal/Inches objects whose contents
        // were observed changing inside the live window.  It exists because the
        // numeric core does NOT report distance 0 on goal-to-go: it reports the
        // real yardage to the goal line.  Session 2026-08-11T20-20-12 recorded
        // "1st & 4" two seconds before a touchdown and never once reported
        // distance 0 across 113 down changes, so a rule that required the core
        // to read 0 could never fire on a genuine 1st & Goal.  Freshness is the
        // substitute proof: it separates the live special layer from a retained
        // pooled object without asking the numeric layer to corroborate a value
        // it does not hold.  Passing null keeps the original zero-only rule.
        internal static ScoreHudDownDistanceCandidate SelectScoreHudDownDistanceCandidate(
            List<ScoreHudDownDistanceCandidate> candidates, RamReadResult currentDown,
            RamReadResult currentDistance, int expectedNonScrimmageSpecial,
            ISet<long> freshGoalInchesAddresses)
        {
            if (candidates == null || candidates.Count == 0) return null;

            // A visible special layer is authoritative over the ordinary
            // yardage layer beneath it.  Require every eligible visible
            // special to agree semantically; conflicting pooled objects fail
            // closed instead of selecting by address or scan order.
            ScoreHudDownDistanceCandidate special = null;
            string specialKey = null;
            for (int index = 0; index < candidates.Count; index++)
            {
                ScoreHudDownDistanceCandidate candidate = candidates[index];
                if (candidate == null || candidate.IsEmpty) continue;
                string display = (candidate.Display ?? String.Empty).Trim().ToUpperInvariant();
                string key = null;
                if (candidate.Down == 0
                    && expectedNonScrimmageSpecial == ScoreHudExpectedKickoff) key = "kickoff";
                else if (candidate.Down == -1
                    && expectedNonScrimmageSpecial == ScoreHudExpectedConversion) key = "conversion";
                else if (expectedNonScrimmageSpecial == ScoreHudExpectedNone
                    && candidate.Down >= 1 && candidate.Down <= 4
                    && currentDown.Available && candidate.Down == currentDown.Value
                    && ((currentDistance.Available && currentDistance.Value == 0)
                        || (freshGoalInchesAddresses != null
                            && freshGoalInchesAddresses.Contains(candidate.Address))))
                {
                    if (display.Contains("GOAL")) key = "goal:" + candidate.Down.ToString(CultureInfo.InvariantCulture);
                    else if (display.Contains("INCH")) key = "inches:" + candidate.Down.ToString(CultureInfo.InvariantCulture);
                }
                if (key == null) continue;
                if (specialKey != null && !String.Equals(specialKey, key, StringComparison.Ordinal))
                    return null;
                if (special == null || candidate.Address < special.Address)
                {
                    special = candidate;
                    specialKey = key;
                }
            }
            if (special != null) return special;

            // Bare zero cannot distinguish Goal from Inches.  Wait for the
            // active special object rather than guessing Goal from numeric RAM.
            if (currentDistance.Available && currentDistance.Value == 0) return null;

            ScoreHudDownDistanceCandidate selected = null;
            int selectedScore = Int32.MinValue;
            for (int index = 0; index < candidates.Count; index++)
            {
                ScoreHudDownDistanceCandidate candidate = candidates[index];
                if (candidate == null || candidate.IsEmpty) continue;
                // Down 0/-1 objects are handled only by the transition-aware
                // special pass above. A retained Kickoff/PAT object must never
                // sneak back through the generic score fallback.
                if (candidate.Down == 0 || candidate.Down == -1) continue;
                string candidateDisplay = (candidate.Display ?? String.Empty).ToUpperInvariant();
                // Goal/Inches objects are also handled exclusively by the
                // distance-zero special pass. If their pooled object remains
                // visible at 2nd & 3, it is stale and cannot be scored as a
                // generic numeric candidate.
                if (candidateDisplay.Contains("GOAL") || candidateDisplay.Contains("INCH")) continue;
                if (currentDown.Available && candidate.Down != currentDown.Value) continue;
                if (currentDistance.Available && candidate.Distance != currentDistance.Value) continue;
                int score = 10;
                if (candidate.Down >= 1 && candidate.Down <= 4 && currentDown.Available)
                    score += candidate.Down == currentDown.Value ? 80 : -80;
                if (candidate.Distance >= 0 && candidate.Distance <= 100
                    && currentDistance.Available)
                    score += candidate.Distance == currentDistance.Value ? 100 : -100;
                int displayedDown;
                int displayedDistance;
                string display = (candidate.Display ?? String.Empty).Trim();
                if (TryParseNumericScoreHudDisplay(display, out displayedDown, out displayedDistance))
                {
                    if (currentDown.Available && displayedDown != currentDown.Value) continue;
                    if (currentDistance.Available && displayedDistance != currentDistance.Value) continue;
                    if (currentDown.Available) score += 80;
                    if (currentDistance.Available) score += 100;
                }
                if (score > selectedScore)
                {
                    selected = candidate;
                    selectedScore = score;
                }
            }
            return selected;
        }

        internal static bool ScoreHudDownDistanceIsSpecial(
            ScoreHudDownDistanceCandidate candidate)
        {
            if (candidate == null || candidate.IsEmpty) return false;
            if (candidate.Down == 0 || candidate.Down == -1) return true;
            string display = (candidate.Display ?? String.Empty).ToUpperInvariant();
            return candidate.Down >= 1 && candidate.Down <= 4
                && (display.Contains("GOAL") || display.Contains("INCH"));
        }

        internal static bool ShouldRequestScoreHudSpecialDiscovery(
            bool transitionStarted, bool transitionActive,
            bool rawDistanceIsAmbiguous, bool selectedIsSpecial)
        {
            return ShouldRequestScoreHudSpecialDiscovery(transitionStarted,
                transitionActive, rawDistanceIsAmbiguous, selectedIsSpecial, false);
        }

        // The reader used to go looking for a special layer in exactly two
        // situations: during a kickoff/PAT transition, or when the numeric core
        // read distance zero. A goal-to-go snap is neither. Captured live on
        // 2026-08-11 during a 1st & Goal: the object sat at 0x314A7FE0 reading
        // { display "1st & Goal", down 1, distance 50 } while the core read
        // distance 3, so nothing triggered a search and the plate published
        // "1st & 3". It appeared correctly on later goal-line snaps only because
        // an earlier search had already learned that pooled address - hence
        // "it only works after the first one".
        //
        // ScoreHud allocates these per presentation, so the moment a new one can
        // exist is the moment the down or distance changes. Refreshing then, when
        // no special layer is currently held, learns the pooled addresses as the
        // drive progresses instead of waiting for a situation that may not come.
        // This only decides when to LOOK; what may be trusted once found is
        // unchanged, and the existing discovery interval still throttles it.
        internal static bool ShouldRequestScoreHudSpecialDiscovery(
            bool transitionStarted, bool transitionActive,
            bool rawDistanceIsAmbiguous, bool selectedIsSpecial,
            bool downDistanceChanged)
        {
            return transitionStarted || (!selectedIsSpecial
                && (transitionActive || rawDistanceIsAmbiguous || downDistanceChanged));
        }

        private void RequestBackgroundRecoverySweep()
        {
            lock (teamNameDiscoverySync)
            {
                if (!teamNameDiscoveryRunning) nextTeamNameDiscoveryUtc = DateTime.MinValue;
            }
            RequestTeamNameDiscoveryIfNeeded();
            if (!HasConfiguredField("awayRank")) RequestScoreHudDiscovery();
        }

        private void RequestTeamNameDiscoveryIfNeeded()
        {
            if (scanner.Process == null || scanner.Process.HasExited
                || resolvedProcessId != scanner.Process.Id) return;

            int processId = scanner.Process.Id;
            int generation;
            int discoveryMatchupGeneration;
            lock (teamNameDiscoverySync)
            {
                if (teamNameDiscoveryRunning || DateTime.UtcNow < nextTeamNameDiscoveryUtc) return;
                teamNameDiscoveryRunning = true;
                generation = teamNameDiscoveryGeneration;
                discoveryMatchupGeneration = matchupGeneration;
                nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(15);
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                RamAutoDiscovery result = null;
                long scanToken = 0;
                bool scanAcquired = false;
                try
                {
                    lock (teamNameDiscoverySync)
                        if (generation != teamNameDiscoveryGeneration) return;
                    if (TryAcquireFullMemoryScan(out scanToken))
                    {
                        scanAcquired = true;
                        lock (teamNameDiscoverySync)
                            if (generation != teamNameDiscoveryGeneration) return;
                        Process game = Process.GetProcessById(processId);
                        using (MemoryScanner backgroundScanner = new MemoryScanner())
                        {
                            backgroundScanner.Attach(game);
                            // This worker already performs a full private-RAM sweep.
                            // Parse the core records during the same background pass
                            // so a synchronized legacy possession object can be
                            // reacquired without ever blocking the live clock loop.
                            result = backgroundScanner.DiscoverRamLayout(null);
                        }
                    }
                }
                catch { }
                finally
                {
                    if (scanToken != 0) ReleaseFullMemoryScan(scanToken);
                }
                lock (teamNameDiscoverySync)
                {
                    if (generation == teamNameDiscoveryGeneration)
                    {
                        pendingTeamNameDiscovery = result;
                        pendingTeamNameDiscoveryProcessId = processId;
                        pendingTeamNameDiscoveryMatchupGeneration = discoveryMatchupGeneration;
                        teamNameDiscoveryRunning = false;
                        nextTeamNameDiscoveryUtc = result == null
                            ? (scanAcquired ? DateTime.UtcNow.AddSeconds(5)
                                : DateTime.UtcNow.AddMilliseconds(250))
                            : DateTime.UtcNow.AddSeconds(5);
                    }
                }
            });
        }

        private static bool HasCompleteTeamNamePair(RamAutoDiscovery result)
        {
            return result != null
                && !String.IsNullOrWhiteSpace(result.AwayTeamName)
                && !String.IsNullOrWhiteSpace(result.HomeTeamName)
                && !String.Equals(result.AwayTeamName, result.HomeTeamName, StringComparison.OrdinalIgnoreCase)
                && result.AwayTeamNameAddresses != null && result.AwayTeamNameAddresses.Count > 0
                && result.HomeTeamNameAddresses != null && result.HomeTeamNameAddresses.Count > 0
                // A labelled role binding is the strongest evidence, but it is
                // absent in modes without tradition slugs. A fallback pair is
                // accepted here and still has to survive AdvanceMatchupConfirmation
                // - the same pair twice, with matching address signatures - before
                // anything is published, which is the protection the original
                // fallback lacked.
                && (result.HasLabeledTeamRoleBinding || result.TeamNamesFromFallback);
        }

        internal static bool BackgroundResultMatchesGeneration(int resultGeneration, int currentGeneration)
        {
            return resultGeneration == currentGeneration;
        }

        internal static bool AdvanceDifferentCoreConfirmation(
            ref string candidateSignature, ref int confirmations, string observedSignature)
        {
            if (String.IsNullOrWhiteSpace(observedSignature))
            {
                candidateSignature = null;
                confirmations = 0;
                return false;
            }
            if (String.Equals(candidateSignature, observedSignature, StringComparison.Ordinal))
                confirmations++;
            else
            {
                candidateSignature = observedSignature;
                confirmations = 1;
            }
            return confirmations >= 2;
        }

        private bool DiscoveryMatchesConfiguredCore(RamAutoDiscovery result)
        {
            return result != null && result.HasCoreScoreboard
                && String.Equals(ConfiguredCoreSignature(), DiscoveryCoreSignature(result), StringComparison.Ordinal);
        }

        private void ApplyCompletedTeamNameDiscovery(string screenJsonPath)
        {
            RamAutoDiscovery result = null;
            int processId = 0;
            int resultMatchupGeneration = 0;
            lock (teamNameDiscoverySync)
            {
                if (pendingTeamNameDiscovery != null)
                {
                    result = pendingTeamNameDiscovery;
                    processId = pendingTeamNameDiscoveryProcessId;
                    resultMatchupGeneration = pendingTeamNameDiscoveryMatchupGeneration;
                    pendingTeamNameDiscovery = null;
                    pendingTeamNameDiscoveryProcessId = 0;
                    pendingTeamNameDiscoveryMatchupGeneration = 0;
                }
            }
            if (result == null || scanner.Process == null || scanner.Process.Id != processId
                || resultMatchupGeneration != matchupGeneration) return;

            // Timeouts and possession are bound to neither team identity nor
            // the matchup epoch. Timeout sides come from invariant offsets
            // (+0x44 home, +0x48 away) and every value is verified again in
            // ApplyVerifiedHomeAwayTimeoutFields before publication.
            //
            // They are installed here, ahead of the gates below, because each
            // of those discards the entire discovery result on a return -
            // the moving-core proof, the different-core confirmation and the
            // ambiguous-role branch. Between them, a reader that located the
            // timeout addresses on every single scan never installed them
            // once. Observed 2026-08-12: locator returned
            // homeTimeouts [0x7FA33A74, 0x7FA33D44] while the reader reported
            // configuredCopies=0 and "clone-contexts-unsafe (slots 0/0)".
            InstallRawTimeoutSlots(result, false);
            InstallLivePossession(result, false);
            ApplyOrientedTimeoutFields();

            if (result.TeamCatalogBase != 0)
            {
                SetField("teamCatalogBase", new long[] { result.TeamCatalogBase });
                SetField("teamCatalogLength", new long[] { result.TeamCatalogLength });
                teamKeyNames = null;
            }
            if (!DiscoveryMatchesConfiguredCore(result))
            {
                // Team role objects and plausible wide blocks can both survive
                // a same-process game switch. Do not bind either one to this
                // epoch unless the same scan also proves the configured core.
                if (!result.HasCoreScoreboard)
                {
                    autoDiscoverySummary = "live scoreboard retained; background moving-core proof pending";
                    nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(5);
                    return;
                }
                coreCrossCheckDisagreements++;
                lastCoreCrossCheckUtc = DateTime.UtcNow;
                string differentSignature = DiscoveryCoreSignature(result);
                bool confirmedDifferentCore = AdvanceDifferentCoreConfirmation(
                    ref candidateDifferentCoreSignature, ref differentCoreConfirmations,
                    differentSignature);
                ClearStaleOutput(screenJsonPath);
                if (confirmedDifferentCore)
                {
                    ClearStaleOutput(screenJsonPath);
                    InvalidateProfile("different moving core confirmed twice");
                    return;
                }
                autoDiscoverySummary = "live scoreboard retained; confirming replacement moving core ("
                    + differentCoreConfirmations.ToString(CultureInfo.InvariantCulture) + "/2)";
                nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(5);
                return;
            }
            candidateDifferentCoreSignature = null;
            differentCoreConfirmations = 0;
            coreCrossCheckAgreements++;
            lastCoreCrossCheckUtc = DateTime.UtcNow;
            if (result.TeamRoleEvidenceAmbiguous && !matchupTransitionPending)
            {
                // Ambiguous role evidence means we cannot say which team is on
                // which side, so no team-bound identity may be published. It
                // does NOT invalidate everything else.
                //
                // This previously called InvalidateProfile, which resets
                // resolvedProcessId and forces a full re-discovery. In a game
                // where the role markers are simply absent that happens on
                // every background cycle, so the reader reset itself every few
                // seconds forever and timeouts, ranks and possession could
                // never bind. Observed 2026-08-12: the locator returned the
                // timeout addresses on every scan while the reader reported
                // configuredCopies=0 and "clone-contexts-unsafe (slots 0/0)".
                //
                // The timeout clones do not depend on role evidence for their
                // sides - those come from the invariant offsets documented in
                // ApplyOrientedTimeoutFields (+0x44 home, +0x48 away) - so they
                // are safe to install here. Names stay unpublished until a
                // matchup actually confirms.
                autoDiscoverySummary = "live scoreboard retained; team roles ambiguous "
                    + "(names unavailable, other fields unaffected)";
                nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(5);
                return;
            }
            ObserveMatchupDiscovery(result);
            // Timeout clone discovery is independent of team-name discovery.
            // Some live layouts expose only one role name, but the two cloned
            // timeout contexts can still be validated and staged safely. The
            // second generation check is required because Observe can begin a
            // new matchup epoch and clear every side-bound field.
            if (BackgroundResultMatchesGeneration(resultMatchupGeneration, matchupGeneration))
            {
                InstallRawTimeoutSlots(result, false);
                InstallLivePossession(result, false);
                ApplyOrientedTimeoutFields();
                possessionBindDiagnostic = result.PossessionDiagnostic;
            }
            bool completePair = HasCompleteTeamNamePair(result);
            autoDiscoverySummary = String.Format(CultureInfo.InvariantCulture,
                completePair && matchupTransitionPending && teamNamePairConfirmations > 0
                    ? "live scoreboard retained; confirming background teams {0}/{1} ({2}/2)"
                    : "live scoreboard retained; background teams {0}/{1}",
                matchupTransitionPending && !String.IsNullOrWhiteSpace(candidateAwayTeamName)
                    ? candidateAwayTeamName : (String.IsNullOrWhiteSpace(lastAwayTeamName) ? "?" : lastAwayTeamName),
                matchupTransitionPending && !String.IsNullOrWhiteSpace(candidateHomeTeamName)
                    ? candidateHomeTeamName : (String.IsNullOrWhiteSpace(lastHomeTeamName) ? "?" : lastHomeTeamName),
                teamNamePairConfirmations);
            if (!matchupTransitionPending && !String.IsNullOrWhiteSpace(lastAwayTeamName)
                && !String.IsNullOrWhiteSpace(lastHomeTeamName)) SaveCompleteProfileCache();
        }

        private void ObserveMatchupDiscovery(RamAutoDiscovery result)
        {
            // Timeouts and possession do not depend on knowing which teams are
            // playing. They used to be installed only further down this method,
            // behind the team-name gate below - so whenever the game did not
            // expose team markers, a discovery that had *already located the
            // timeout addresses* was discarded whole, and timeouts, possession
            // and ranks all went blank together with the names.
            //
            // Observed 2026-08-12: the locator returned
            // homeTimeouts [0x7FA33A74, 0x7FA33D44] on every single scan while
            // the running reader reported configuredCopies=0, purely because
            // the matchup could not be identified.
            //
            // Install what does not need an identity first. The verification in
            // ApplyVerifiedHomeAwayTimeoutFields is unchanged, so nothing is
            // published that has not been proven on its own terms.
            if (!HasCompleteTeamNamePair(result))
            {
                // Say which half of the pair test failed. "No names" and "names
                // but no addresses" and "names the exporter will not trust" are
                // three different bugs that used to look identical from outside.
                matchupBindDiagnostic = "pair rejected: away='"
                    + (result.AwayTeamName ?? "") + "' home='" + (result.HomeTeamName ?? "")
                    + "' addresses " + (result.AwayTeamNameAddresses == null ? 0 : result.AwayTeamNameAddresses.Count)
                    + "," + (result.HomeTeamNameAddresses == null ? 0 : result.HomeTeamNameAddresses.Count)
                    + " labeled=" + result.HasLabeledTeamRoleBinding
                    + " fallback=" + result.TeamNamesFromFallback;
                return;
            }
            string awaySignature = AddressSignature(result.AwayTeamNameAddresses);
            string homeSignature = AddressSignature(result.HomeTeamNameAddresses);
            if (rejectRetiredOrderedPair
                && String.Equals(retiredAwayTeamName, result.AwayTeamName, StringComparison.OrdinalIgnoreCase)
                && String.Equals(retiredHomeTeamName, result.HomeTeamName, StringComparison.OrdinalIgnoreCase)
                && String.Equals(retiredAwayTeamAddressSignature, awaySignature, StringComparison.Ordinal)
                && String.Equals(retiredHomeTeamAddressSignature, homeSignature, StringComparison.Ordinal))
            {
                nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(5);
                return;
            }
            // "Is this still the same game as the one already published?"
            //
            // For a labelled pair the addresses are stable and part of the
            // answer. For a pool-fallback pair they are not: the same two names
            // are found through whichever duplicate copies turn up on that
            // sweep, so the signature moves constantly. Comparing it here meant
            // an already-published matchup looked like a brand new one on the
            // very next pass, which sent the reader round a loop of
            // "team roles changed; locating the new matchup" and it published
            // nothing at all - worse than before the names were fixed.
            //
            // The teams are the identity of a matchup. Compare those.
            bool publishedPairMatches = !matchupTransitionPending
                && String.Equals(lastAwayTeamName, result.AwayTeamName, StringComparison.OrdinalIgnoreCase)
                && String.Equals(lastHomeTeamName, result.HomeTeamName, StringComparison.OrdinalIgnoreCase)
                && (result.TeamNamesFromFallback
                    || (String.Equals(AddressSignature(CopyConfiguredAddresses("awayTeamNameAscii")), awaySignature, StringComparison.Ordinal)
                        && String.Equals(AddressSignature(CopyConfiguredAddresses("homeTeamNameAscii")), homeSignature, StringComparison.Ordinal)));
            if (publishedPairMatches)
            {
                lastMatchupFromFallback = result.TeamNamesFromFallback;
                SetField("awayTeamNameAscii", result.AwayTeamNameAddresses);
                SetField("homeTeamNameAscii", result.HomeTeamNameAddresses);
                InstallTeamRoleBinding(result, true);
                InstallRawTimeoutSlots(result, false);
                InstallLivePossession(result, false);
                ApplyOrientedTimeoutFields();
                ClearMatchupCandidate();
                nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(30);
                return;
            }

            if (!matchupTransitionPending) BeginPendingMatchupTransition();
            bool confirmed = AdvanceMatchupConfirmation(
                ref candidateAwayTeamName, ref candidateHomeTeamName,
                ref candidateAwayTeamAddressSignature, ref candidateHomeTeamAddressSignature,
                ref teamNamePairConfirmations,
                result.AwayTeamName, result.HomeTeamName, awaySignature, homeSignature,
                // A labelled binding has stable addresses and keeps the stricter
                // check. A pool-fallback pair does not, so it is confirmed on the
                // names alone - see SameMatchupCandidate.
                !result.TeamNamesFromFallback);
            nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(5);
            matchupBindDiagnostic = "confirming " + (result.AwayTeamName ?? "?")
                + " at " + (result.HomeTeamName ?? "?") + ": "
                + teamNamePairConfirmations.ToString(CultureInfo.InvariantCulture) + "/2"
                + (confirmed ? " -> committed" : "");
            if (confirmed) CommitConfirmedMatchup(result);
        }

        private void CommitConfirmedMatchup(RamAutoDiscovery result)
        {
            // Both ordered names and their physical role buffers were observed
            // twice. Commit all side-bound state as one matchup epoch.
            lastAwayTeamName = result.AwayTeamName;
            lastHomeTeamName = result.HomeTeamName;
            lastMatchupFromFallback = result.TeamNamesFromFallback;
            // A new matchup gets a fresh set of recovery attempts. The ScoreHud
            // fields are cleared a few lines below, so without this reset a
            // second game in the same session would inherit an exhausted counter
            // and never re-bind its timeouts, ranks or records - which is
            // exactly what loading game two looked like.
            scoreHudRecoveryAttempts = 0;
            scoreHudRecoveryQuarter = -1;
            nextTimeoutRecoveryDiscoveryUtc = DateTime.MinValue;
            SetField("awayTeamNameAscii", result.AwayTeamNameAddresses);
            SetField("homeTeamNameAscii", result.HomeTeamNameAddresses);
            InstallTeamRoleBinding(result, true);
            InstallRawTimeoutSlots(result, true);
            InstallLivePossession(result, false);
            SetField("awayRank", new long[0]);
            SetField("homeRank", new long[0]);
            SetField("awayTimeouts", new long[0]);
            SetField("homeTimeouts", new long[0]);
            lastAwayRank = -1;
            lastHomeRank = -1;
            lastAwayRankGeneration = -1;
            lastHomeRankGeneration = -1;
            ResetScoreHudOrientation();
            CancelScoreHudDiscovery();
            CancelTeamNameDiscovery();
            matchupTransitionPending = false;
            retiredAwayTeamName = null;
            retiredHomeTeamName = null;
            retiredAwayTeamAddressSignature = null;
            retiredHomeTeamAddressSignature = null;
            rejectRetiredOrderedPair = false;
            ClearTransitionPreviousSnapshot();
            ClearMatchupCandidate();
            ResetLogicalState();
            profile.SeedAwayTeamName = lastAwayTeamName;
            profile.SeedHomeTeamName = lastHomeTeamName;
            nextTeamNameDiscoveryUtc = DateTime.UtcNow.AddSeconds(30);
            nextRankScoreHudDiscoveryUtc = DateTime.MinValue;
            RequestScoreHudDiscovery();
            SaveCompleteProfileCache();
        }

        private void InstallTeamRoleBinding(RamAutoDiscovery result, bool clearWhenMissing)
        {
            if (result != null && result.HasLabeledTeamRoleBinding)
            {
                SetField("teamRoleAllocationBase", new long[] { result.TeamRoleAllocationBase });
                SetField("awayTeamRoleLabel", new long[] { result.AwayTeamRoleLabelAddress });
                SetField("homeTeamRoleLabel", new long[] { result.HomeTeamRoleLabelAddress });
                SetField("awayTeamRoleReference", new long[] { result.AwayTeamRoleReferenceAddress });
                SetField("homeTeamRoleReference", new long[] { result.HomeTeamRoleReferenceAddress });
                SetField("awayTeamRoleDescriptor", new long[] { result.AwayTeamRoleDescriptorAddress });
                SetField("homeTeamRoleDescriptor", new long[] { result.HomeTeamRoleDescriptorAddress });
                SetField("awayTeamRoleVector", new long[] { result.AwayTeamRoleVectorAddress });
                SetField("homeTeamRoleVector", new long[] { result.HomeTeamRoleVectorAddress });
                return;
            }
            if (!clearWhenMissing) return;
            SetField("teamRoleAllocationBase", new long[0]);
            SetField("awayTeamRoleLabel", new long[0]);
            SetField("homeTeamRoleLabel", new long[0]);
            SetField("awayTeamRoleReference", new long[0]);
            SetField("homeTeamRoleReference", new long[0]);
            SetField("awayTeamRoleDescriptor", new long[0]);
            SetField("homeTeamRoleDescriptor", new long[0]);
            SetField("awayTeamRoleVector", new long[0]);
            SetField("homeTeamRoleVector", new long[0]);
        }

        private void InstallRawTimeoutSlots(RamAutoDiscovery result, bool clearWhenMissing)
        {
            List<long> slotZero;
            List<long> slotOther;
            int homeCount = result == null || result.HomeTimeoutAddresses == null
                ? -1 : result.HomeTimeoutAddresses.Count;
            int awayCount = result == null || result.AwayTimeoutAddresses == null
                ? -1 : result.AwayTimeoutAddresses.Count;
            if (TrySelectBackgroundTimeoutSlots(result, out slotZero, out slotOther))
            {
                timeoutInstallDiagnostic = "installed (home=" + slotZero.Count
                    + " away=" + slotOther.Count + ")";
                // The two verified clones expose invariant side counters:
                // +0x44 is home and +0x48 is away. Keep the historical cache
                // field names internal; publication applies the proven mapping.
                SetField("timeoutSlotTeamIdZero", slotZero);
                SetField("timeoutSlotTeamIdOther", slotOther);
            }
            else
            {
                timeoutInstallDiagnostic = "selection declined (result home=" + homeCount
                    + " away=" + awayCount + ", clearWhenMissing="
                    + (clearWhenMissing ? "yes" : "no") + ")";
            }
            if (!TrySelectBackgroundTimeoutSlots(result, out slotZero, out slotOther)
                && clearWhenMissing)
            {
                SetField("timeoutSlotTeamIdZero", new long[0]);
                SetField("timeoutSlotTeamIdOther", new long[0]);
                SetField("awayTimeouts", new long[0]);
                SetField("homeTimeouts", new long[0]);
            }
            // The clone +0x31 byte is a presentation/play-state flag. It was
            // observed flipping while quarter, clock, score, and down were
            // unchanged, so it is not authoritative possession. Never publish
            // or preserve it as a live side indicator.
            SetField("timeoutCloneHomePossession", new long[0]);
        }

        private bool InstallTimeoutCloneHomePossession(
            RamAutoDiscovery result, bool clearWhenMissing)
        {
            List<long> home = result == null || result.HomeTimeoutAddresses == null
                ? new List<long>() : new List<long>(result.HomeTimeoutAddresses);
            List<long> away = result == null || result.AwayTimeoutAddresses == null
                ? new List<long>() : new List<long>(result.AwayTimeoutAddresses);
            List<long> possession = result == null
                    || result.TimeoutCloneHomePossessionAddresses == null
                ? new List<long>()
                : new List<long>(result.TimeoutCloneHomePossessionAddresses);
            home.Sort();
            away.Sort();
            possession.Sort();
            if (String.Equals(ConfiguredCoreSignature(), DiscoveryCoreSignature(result), StringComparison.Ordinal)
                && TimeoutClonePossessionAddressLayoutIsSafe(home, away, possession))
            {
                try
                {
                    int firstA = ReadSingleByte(possession[0]);
                    int firstB = ReadSingleByte(possession[1]);
                    int secondA = ReadSingleByte(possession[0]);
                    int secondB = ReadSingleByte(possession[1]);
                    if (TimeoutCloneHomePossessionReadsAreSafe(
                        possession.Count, firstA, firstB, secondA, secondB))
                    {
                        SetField("timeoutCloneHomePossession", possession);
                        return true;
                    }
                }
                catch { }
            }
            if (clearWhenMissing)
                SetField("timeoutCloneHomePossession", new long[0]);
            return false;
        }

        internal static bool TimeoutClonePossessionAddressLayoutIsSafe(
            IList<long> home, IList<long> away, IList<long> possession)
        {
            if (home == null || away == null || possession == null
                || home.Count != 2 || away.Count != 2 || possession.Count != 2)
                return false;
            if (!MemoryScanner.ExactTimeoutClonePairIsSafe(
                    possession.Count, possession[0] - 0x31, possession[1] - 0x31))
                return false;
            for (int index = 0; index < 2; index++)
            {
                if (home[index] - possession[index] != 0x13
                    || away[index] - possession[index] != 0x17)
                    return false;
            }
            return true;
        }

        internal static bool TimeoutCloneHomePossessionReadsAreSafe(
            int addressCount, int firstA, int firstB, int secondA, int secondB)
        {
            return addressCount == 2
                && firstA >= 0 && firstA <= 1
                && firstA == firstB && firstA == secondA && firstA == secondB;
        }

        internal static int AwayPossessionFromHomeFlag(int homePossession)
        {
            return homePossession == 1 ? 0 : 1;
        }

        private int ReadSingleByte(long address)
        {
            byte[] bytes = scanner.ReadBytes(address, 1);
            if (bytes == null || bytes.Length != 1)
                throw new InvalidOperationException("Could not read the possession byte.");
            return bytes[0];
        }

        private bool InstallLivePossession(RamAutoDiscovery result, bool clearWhenMissing)
        {
            if (result != null && result.VerificationScoreboardBlock != 0
                && result.LivePossessionAddresses != null
                && result.LivePossessionAddresses.Count == 1
                && String.Equals(ConfiguredCoreSignature(), DiscoveryCoreSignature(result), StringComparison.Ordinal)
                && DiscoveryVerificationRecordAgrees(result))
            {
                long address = result.LivePossessionAddresses[0];
                try
                {
                    int first = scanner.ReadInt32(address);
                    int second = scanner.ReadInt32(address);
                    if (LivePossessionReadIsSafe(1, first, second))
                    {
                        SetVerificationFields(
                            result.VerificationScoreboardBlock,
                            result.VerificationUsesWideScoreboardLayout);
                        SetField("possessionAwayIsOne", new long[] { address });
                        return true;
                    }
                }
                catch { }
            }
            if (clearWhenMissing) SetField("possessionAwayIsOne", new long[0]);
            return false;
        }

        internal static bool LivePossessionReadIsSafe(int addressCount, int first, int second)
        {
            return addressCount == 1 && first >= 0 && first <= 1 && first == second;
        }

        private bool DiscoveryVerificationRecordAgrees(RamAutoDiscovery result)
        {
            if (result == null || result.VerificationScoreboardBlock == 0) return false;
            RamReadResult quarter = Read("quarter", 1, 20);
            RamReadResult clock = Read("gameClockSeconds", 0, 3600);
            RamReadResult playClock = Read("playClock", 0, 99);
            RamReadResult homeScore = Read("homeScore", 0, 255);
            RamReadResult awayScore = Read("awayScore", 0, 255);
            RamReadResult down = Read("down", 0, 4);
            RamReadResult distance = Read("distance", 0, 99);
            if (!quarter.Available || !clock.Available || !playClock.Available
                || !homeScore.Available || !awayScore.Available
                || !down.Available || !distance.Available) return false;
            try
            {
                long block = result.VerificationScoreboardBlock;
                int verifyQuarter = scanner.ReadInt32(block + (result.VerificationUsesWideScoreboardLayout ? 0xC8 : 0xEC));
                int verifyClock = scanner.ReadInt32(block + (result.VerificationUsesWideScoreboardLayout ? 0x100 : 0xF4));
                int verifyPlayClock = scanner.ReadInt32(block + (result.VerificationUsesWideScoreboardLayout ? 0x180 : 0xF8));
                int verifyHomeScore = scanner.ReadInt32(block + (result.VerificationUsesWideScoreboardLayout ? 0x90 : 0xFC));
                int verifyAwayScore = scanner.ReadInt32(block + (result.VerificationUsesWideScoreboardLayout ? 0x98 : 0x100));
                int verifyDown = scanner.ReadInt32(block + (result.VerificationUsesWideScoreboardLayout ? 0xB8 : 0x10C));
                int verifyDistance = scanner.ReadInt32(block + (result.VerificationUsesWideScoreboardLayout ? 0x148 : 0x110));
                return quarter.Value == verifyQuarter
                    && Math.Abs(clock.Value - verifyClock) <= 2
                    && Math.Abs(playClock.Value - verifyPlayClock) <= 2
                    && homeScore.Value == verifyHomeScore
                    && awayScore.Value == verifyAwayScore
                    && down.Value == verifyDown
                    && distance.Value == verifyDistance;
            }
            catch { return false; }
        }

        private bool TrySelectBackgroundTimeoutSlots(RamAutoDiscovery result,
            out List<long> slotZeroAddresses, out List<long> slotOtherAddresses)
        {
            slotZeroAddresses = new List<long>();
            slotOtherAddresses = new List<long>();
            if (result == null || result.HomeTimeoutAddresses == null
                || result.AwayTimeoutAddresses == null) return false;
            int count = Math.Min(result.HomeTimeoutAddresses.Count, result.AwayTimeoutAddresses.Count);
            if (result.HomeTimeoutAddresses.Count != 2
                || result.AwayTimeoutAddresses.Count != 2
                || !MemoryScanner.ExactTimeoutClonePairIsSafe(
                    count,
                    result.HomeTimeoutAddresses[0] - 0x44,
                    result.HomeTimeoutAddresses[1] - 0x44)
                || result.AwayTimeoutAddresses[0] - result.HomeTimeoutAddresses[0] != 4
                || result.AwayTimeoutAddresses[1] - result.HomeTimeoutAddresses[1] != 4)
                return false;
            Dictionary<int, List<int>> pairIndexes = new Dictionary<int, List<int>>();
            int bestKey = -1;
            int bestCount = 0;
            for (int index = 0; index < count; index++)
            {
                try
                {
                    int home = scanner.ReadInt32(result.HomeTimeoutAddresses[index]);
                    int away = scanner.ReadInt32(result.AwayTimeoutAddresses[index]);
                    if (home < 0 || home > 3 || away < 0 || away > 3) continue;
                    int key = home * 4 + away;
                    List<int> indexes;
                    if (!pairIndexes.TryGetValue(key, out indexes))
                        pairIndexes[key] = indexes = new List<int>();
                    indexes.Add(index);
                    if (indexes.Count > bestCount)
                    {
                        bestKey = key;
                        bestCount = indexes.Count;
                    }
                }
                catch { }
            }
            // Two independent presentation copies must agree before replacing
            // timeout addresses already used by the live exporter.
            if (bestKey < 0 || bestCount != 2) return false;
            int equallySupportedPairs = 0;
            foreach (KeyValuePair<int, List<int>> pair in pairIndexes)
                if (pair.Value.Count == bestCount) equallySupportedPairs++;
            if (equallySupportedPairs != 1) return false;
            foreach (int index in pairIndexes[bestKey])
            {
                slotZeroAddresses.Add(result.HomeTimeoutAddresses[index]);
                slotOtherAddresses.Add(result.AwayTimeoutAddresses[index]);
            }
            // Verify the same two-copy slot pair a second time before it can be
            // staged for the current matchup transaction.
            int expectedZero = bestKey / 4;
            int expectedOther = bestKey % 4;
            for (int index = 0; index < slotZeroAddresses.Count; index++)
            {
                try
                {
                    if (scanner.ReadInt32(slotZeroAddresses[index]) != expectedZero
                        || scanner.ReadInt32(slotOtherAddresses[index]) != expectedOther)
                        return false;
                }
                catch { return false; }
            }
            return true;
        }

        private ScoreHudDownDistanceCandidate RememberScoreHudDownDistance(
            ScoreHudDownDistanceCandidate candidate)
        {
            lastScoreHudDownDistance = candidate;
            lastScoreHudDownDistanceSeenUtc = DateTime.UtcNow;
            return candidate;
        }

        private ScoreHudDownDistanceCandidate RecentScoreHudDownDistance()
        {
            return lastScoreHudDownDistance != null
                && DateTime.UtcNow - lastScoreHudDownDistanceSeenUtc <= TimeSpan.FromSeconds(1)
                ? lastScoreHudDownDistance
                : null;
        }

        private bool ScoreHudDownDistanceMatchesCurrentState(
            ScoreHudDownDistanceCandidate candidate, RamReadResult numericDown,
            RamReadResult numericDistance)
        {
            if (candidate == null) return false;
            TimeSpan age = DateTime.UtcNow - lastScoreHudDownDistanceSeenUtc;
            if (candidate.Down >= 1 && candidate.Down <= 4)
            {
                if (!numericDown.Available || numericDown.Value != candidate.Down) return false;
                int displayedDown;
                int displayedDistance;
                string displayUpper = (candidate.Display ?? String.Empty).ToUpperInvariant();
                if (displayUpper.Contains("GOAL") || displayUpper.Contains("INCH"))
                    return age <= TimeSpan.FromSeconds(1)
                        && numericDistance.Available && numericDistance.Value == 0;
                if (TryParseNumericScoreHudDisplay(candidate.Display, out displayedDown, out displayedDistance))
                    return age <= TimeSpan.FromSeconds(1)
                        && displayedDown == numericDown.Value
                        && (!numericDistance.Available
                            || HudDistanceAgreesWithCore(displayedDistance, numericDistance.Value));
                return age <= TimeSpan.FromSeconds(1);
            }
            // PAT, 2PT, and kickoff replace the ordinary numeric down. Once a
            // pooled object disappears, retain it for at most one refresh-sized
            // grace window rather than carrying it into the next scrimmage.
            return age <= TimeSpan.FromSeconds(1)
                && ((candidate.Down == 0
                        && scoreHudExpectedNonScrimmageSpecial == ScoreHudExpectedKickoff)
                    || (candidate.Down == -1
                        && scoreHudExpectedNonScrimmageSpecial == ScoreHudExpectedConversion));
        }

        // PROBE. Every ScoreHud message the game publishes - flags, touchdown
        // banners, milestones - carries a message id, two text lines, and the
        // PlayerId/TeamId it is about. Only the two conversion ids have ever
        // been decoded; this logs each distinct message once so a single game
        // of play yields the full vocabulary: which id means TOUCHDOWN, which
        // means FLAG, and whether the info text already names the scorer.
        private readonly HashSet<string> loggedScoreHudMessages = new HashSet<string>();
        private string probeOutputSeedPath;
        // The same messages, published raw in the live export. The consumer
        // asked for the information, not a decoded presentation - so every
        // banner's text, player id and team id go straight into the feed and
        // classification can happen downstream (or never).
        private readonly List<Dictionary<string, object>> recentScoreHudMessages =
            new List<Dictionary<string, object>>();
        private const int MaximumRecentMessages = 12;

        internal static string MessageTeamSide(int teamId, int awayTeamId, int homeTeamId)
        {
            if (teamId <= 0) return null;
            if (teamId == awayTeamId) return "away";
            if (teamId == homeTeamId) return "home";
            return null;
        }

        private void LogScoreHudMessagesProbe(List<ScoreHudMessageCandidate> messages)
        {
            if (messages == null || String.IsNullOrWhiteSpace(probeOutputSeedPath)) return;
            for (int index = 0; index < messages.Count; index++)
            {
                ScoreHudMessageCandidate message = messages[index];
                // The address is part of the identity: the game allocates a
                // fresh object per banner, so a second FLAG with identical
                // text is a new object. Without it every repeat of a banner
                // was swallowed (probe game 2026-08-18: 3 flags, 1 logged).
                string signature = message.Address.ToString("X", CultureInfo.InvariantCulture)
                    + "|" + message.MessageId + "|" + (message.DisplayText ?? "")
                    + "|" + (message.InfoText ?? "") + "|" + message.PlayerId
                    + "|" + message.TeamId;
                if (loggedScoreHudMessages.Count > 2000) loggedScoreHudMessages.Clear();
                if (!loggedScoreHudMessages.Add(signature)) continue;
                RamReadResult quarter = Read("quarter", 1, 20);
                RamReadResult clock = Read("gameClockSeconds", 0, 3600);
                RamReadResult awayScore = Read("awayScore", 0, 255);
                RamReadResult homeScore = Read("homeScore", 0, 255);
                Dictionary<string, object> entry = new Dictionary<string, object>
                {
                    { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "quarter", quarter.Available ? (object)quarter.Value : null },
                    { "clock", clock.Available ? (object)clock.Value : null },
                    { "awayScore", awayScore.Available ? (object)awayScore.Value : null },
                    { "homeScore", homeScore.Available ? (object)homeScore.Value : null },
                    { "messageId", message.MessageId },
                    { "displayText", message.DisplayText },
                    { "infoText", message.InfoText },
                    { "playerId", message.PlayerId },
                    { "teamId", message.TeamId },
                    // Which side the message is about, resolved against the
                    // oriented team ids so consumers (and the flag indicator)
                    // never have to map raw catalog ids themselves.
                    { "teamSide", MessageTeamSide(message.TeamId,
                        orientedAwayScoreHudTeamId, orientedHomeScoreHudTeamId) },
                    { "color", message.Color },
                    { "displayTime", message.DisplayTime }
                };
                AppendProbeLine(probeOutputSeedPath, "messages-probe.jsonl", entry);
                recentScoreHudMessages.Add(entry);
                if (recentScoreHudMessages.Count > MaximumRecentMessages)
                    recentScoreHudMessages.RemoveAt(0);
                try { NotePenaltyFlagForProbe(message); } catch { }
            }
        }

        private void RememberScoreHudMessages(List<ScoreHudMessageCandidate> messages)
        {
            if (messages == null || messages.Count == 0) return;
            try { LogScoreHudMessagesProbe(messages); } catch { }
            ScoreHudMessageCandidate selected = messages[0];
            for (int index = 0; index < messages.Count; index++)
            {
                if (messages[index].MessageId == 331713552
                    || messages[index].MessageId == -1004160968)
                {
                    selected = messages[index];
                    lastConversionMessageId = selected.MessageId;
                    lastConversionMessageSeenUtc = DateTime.UtcNow;
                    break;
                }
            }
            lastScoreHudMessage = selected;
            lastScoreHudMessageSeenUtc = DateTime.UtcNow;
        }

        private ScoreHudMessageCandidate CurrentScoreHudMessage()
        {
            return lastScoreHudMessage != null
                && DateTime.UtcNow - lastScoreHudMessageSeenUtc <= TimeSpan.FromSeconds(3)
                ? lastScoreHudMessage
                : null;
        }

        private int CurrentConversionMessageId()
        {
            return DateTime.UtcNow - lastConversionMessageSeenUtc <= TimeSpan.FromSeconds(5)
                ? lastConversionMessageId
                : 0;
        }

        private bool CanRecoverProfileDuringSpecialState()
        {
            return scanner.Process != null
                && discoveryAttemptProcessId == scanner.Process.Id
                && (profile.ProcessId == 0 || CurrentProcessIdentityMatchesProfile())
                && !String.IsNullOrWhiteSpace(lastAwayTeamName)
                && !String.IsNullOrWhiteSpace(lastHomeTeamName)
                && HasConfiguredField("quarter")
                && HasConfiguredField("gameClockSeconds")
                && HasConfiguredField("homeScore")
                && HasConfiguredField("awayScore")
                && HasConfiguredField("homeTimeouts")
                && HasConfiguredField("awayTimeouts");
        }

        private static bool IsVisibleNonScrimmageSpecialState(ScoreHudDownDistanceCandidate candidate)
        {
            return candidate != null && !candidate.IsEmpty
                && (candidate.Down == 0 || candidate.Down == -1);
        }

        private static Dictionary<string, object> ScoreHudDownDistanceDictionary(
            ScoreHudDownDistanceCandidate candidate)
        {
            if (candidate == null)
            {
                return new Dictionary<string, object>
                {
                    { "available", false },
                    { "address", null },
                    { "display", null },
                    { "down", null },
                    { "distance", null },
                    { "style", null },
                    { "isEmpty", null }
                };
            }
            return new Dictionary<string, object>
            {
                { "available", true },
                { "address", "0x" + candidate.Address.ToString("X", CultureInfo.InvariantCulture) },
                { "display", candidate.Display },
                { "down", candidate.Down },
                { "distance", candidate.Distance },
                { "style", candidate.Style },
                { "isEmpty", candidate.IsEmpty }
            };
        }

        private static bool TryParseNumericScoreHudDisplay(string display, out int down, out int distance)
        {
            down = 0;
            distance = 0;
            if (String.IsNullOrWhiteSpace(display)) return false;
            System.Text.RegularExpressions.Match match = System.Text.RegularExpressions.Regex.Match(
                display,
                @"^\s*([1-4])(?:ST|ND|RD|TH)?\s*(?:&|AND)\s*([0-9]{1,2})\s*$",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return match.Success
                && Int32.TryParse(match.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out down)
                && Int32.TryParse(match.Groups[2].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out distance)
                && down >= 1 && down <= 4 && distance >= 0 && distance <= 99;
        }

        private static Dictionary<string, object> ScoreHudMessageDictionary(
            ScoreHudMessageCandidate candidate)
        {
            if (candidate == null)
            {
                return new Dictionary<string, object>
                {
                    { "available", false },
                    { "address", null },
                    { "messageId", null },
                    { "displayText", null },
                    { "infoText", null }
                };
            }
            return new Dictionary<string, object>
            {
                { "available", true },
                { "address", "0x" + candidate.Address.ToString("X", CultureInfo.InvariantCulture) },
                { "messageId", candidate.MessageId },
                { "displayText", candidate.DisplayText },
                { "infoText", candidate.InfoText }
            };
        }

        private bool ConfiguredRankObjectIsLive(string fieldName)
        {
            ScoreHudTeamCandidate candidate;
            return TryReadConfiguredRankObject(fieldName, out candidate);
        }

        // "W-L", or "W-L-T" when there are ties. Returns null rather than a
        // guess when the numbers are outside what a season can produce - the
        // reader publishes nothing before it publishes something wrong.
        internal static string FormatTeamRecord(int wins, int losses, int ties)
        {
            if (wins < 0 || wins > 99 || losses < 0 || losses > 99
                || ties < 0 || ties > 99) return null;
            string text = wins.ToString(CultureInfo.InvariantCulture)
                + "-" + losses.ToString(CultureInfo.InvariantCulture);
            if (ties > 0) text += "-" + ties.ToString(CultureInfo.InvariantCulture);
            return text;
        }

        private bool TryReadConfiguredRankObject(string fieldName, out ScoreHudTeamCandidate candidate)
        {
            return TryReadConfiguredRankObject(fieldName, -1, out candidate);
        }

        // The game keeps several clones of each team object and rebuilds them
        // constantly; watching a single address meant multi-second blind spots
        // whenever "our" clone was mid-rebuild - the dominant possession lag in
        // the 2026-08-13 probe game (~40% unreadable samples). All bound clone
        // addresses are configured now, and the first one that validates
        // answers. expectedScore is the freshness guard for state that changes
        // mid-game (the possession flag): a clone must carry the live score to
        // be believed; -1 skips the guard for fields identical across clones
        // (rank, record).
        private bool TryReadConfiguredRankObject(string fieldName, int expectedScore,
            out ScoreHudTeamCandidate candidate)
        {
            candidate = null;
            List<long> addresses;
            if (profile == null || !profile.Fields.TryGetValue(fieldName, out addresses)
                || addresses == null || addresses.Count == 0) return false;
            for (int index = 0; index < addresses.Count; index++)
            {
                ScoreHudTeamCandidate current;
                try
                {
                    if (!scanner.TryReadLiveScoreHudTeamCandidate(addresses[index] - 44, out current))
                        continue;
                }
                catch { continue; }
                if (expectedScore >= 0 && current.Score != expectedScore) continue;
                candidate = current;
                return true;
            }
            return false;
        }

        // Identity is stricter than the rank/record read. Every readable clone
        // must still describe the oriented team at the live score, and all
        // matching clones must agree on the TeamBuilder bit. A disagreeing clone
        // makes the side unavailable for this tick instead of allowing address
        // order to choose which identity wins.
        private bool TryReadConfiguredTeamIdentity(string fieldName, int expectedScore,
            int expectedTeamId, out ScoreHudTeamCandidate candidate)
        {
            candidate = null;
            if (expectedScore < 0 || expectedScore > 255
                || expectedTeamId < 1 || expectedTeamId > 2047) return false;
            List<long> addresses;
            if (profile == null || !profile.Fields.TryGetValue(fieldName, out addresses)
                || addresses == null || addresses.Count == 0) return false;
            for (int index = 0; index < addresses.Count; index++)
            {
                ScoreHudTeamCandidate current;
                try
                {
                    if (!scanner.TryReadLiveScoreHudTeamCandidate(addresses[index] - 44, out current))
                        continue;
                }
                catch { continue; }
                if (current.Score != expectedScore || current.TeamId != expectedTeamId) continue;
                if (candidate != null && candidate.IsTeambuilder != current.IsTeambuilder)
                {
                    candidate = null;
                    return false;
                }
                if (candidate == null || current.Address > candidate.Address) candidate = current;
            }
            return candidate != null;
        }

        // Pure gate kept internal for the executable self-test. Publication is
        // all-or-nothing because a correct ID on one side is not enough to prove
        // that the other side belongs to the same live matchup epoch.
        internal static bool ScoreHudTeamIdentityPairIsSafe(bool orientationMatchesCurrentEpoch,
            RamReadResult awayScore, RamReadResult homeScore,
            int orientedAwayTeamId, int orientedHomeTeamId,
            ScoreHudTeamCandidate away, ScoreHudTeamCandidate home)
        {
            if (!orientationMatchesCurrentEpoch || awayScore == null || homeScore == null
                || !awayScore.Available || !homeScore.Available
                || awayScore.Value < 0 || awayScore.Value > 255
                || homeScore.Value < 0 || homeScore.Value > 255) return false;
            if (orientedAwayTeamId < 1 || orientedAwayTeamId > 2047
                || orientedHomeTeamId < 1 || orientedHomeTeamId > 2047
                || orientedAwayTeamId == orientedHomeTeamId) return false;
            if (away == null || home == null || away.Address <= 0 || home.Address <= 0
                || away.Address == home.Address) return false;
            if (away.TeamId != orientedAwayTeamId || home.TeamId != orientedHomeTeamId
                || away.TeamId == home.TeamId
                || away.Score != awayScore.Value || home.Score != homeScore.Value) return false;
            return (away.IsTeambuilder == 0 || away.IsTeambuilder == 1)
                && (home.IsTeambuilder == 0 || home.IsTeambuilder == 1);
        }

        private RamReadResult ReadLiveRank(string fieldName, ref int lastValue,
            ref int lastValueGeneration, ref string lastRecord)
        {
            ScoreHudTeamCandidate candidate;
            if (TryReadConfiguredRankObject(fieldName, out candidate))
            {
                lastValue = candidate.Rank;
                lastValueGeneration = matchupGeneration;
                // One read, both fields. A record that fails the sanity check
                // clears the cache instead of leaving the previous game's.
                lastRecord = FormatTeamRecord(candidate.Wins, candidate.Losses, candidate.Ties);
                return new RamReadResult(true, candidate.Rank, 1, 1, 1);
            }
            return lastValue >= 0 && lastValueGeneration == matchupGeneration
                ? new RamReadResult(true, lastValue, 0, 1, 1)
                : RamReadResult.Missing(HasConfiguredField(fieldName) ? 1 : 0);
        }

        // The team catalog is a fixed-stride table: one 0xD8-byte record per
        // team, short key at +0, display name at +32. Every ScoreHud team
        // object carries a TeamId. If that id is the record index, then team
        // names are available from the very same object that already supplies
        // rank, record, score and timeouts - no role markers, no tradition
        // slugs, no pointer chase, and none of the name deadlock that
        // currently blocks all three of those fields.
        //
        // This only observes and reports. Nothing is published from it until
        // the mapping is confirmed against a game whose teams are known. The
        // anchor is the record at index 0, which should read AIRFOR/Air Force:
        // if the anchor is right the base and stride are right, and only the
        // id-to-index assumption is in question.
        private string DescribeTeamIdCatalogNames(List<ScoreHudTeamCandidate> teams)
        {
            long catalogBase = SingleConfiguredAddress("teamCatalogBase");
            if (catalogBase == 0) return "catalog address not configured";
            if (teams == null || teams.Count == 0) return "no ScoreHud team objects";
            string anchor;
            try
            {
                anchor = scanner.ReadAsciiString(catalogBase, 16) + "/"
                    + scanner.ReadAsciiString(catalogBase + 32, 31);
            }
            catch { anchor = "unreadable"; }
            List<int> reported = new List<int>();
            List<string> seen = new List<string>();
            for (int i = 0; i < teams.Count && reported.Count < 6; i++)
            {
                ScoreHudTeamCandidate team = teams[i];
                if (reported.Contains(team.TeamId)) continue;
                reported.Add(team.TeamId);
                string entry = team.TeamId.ToString(CultureInfo.InvariantCulture)
                    + " r" + team.Rank.ToString(CultureInfo.InvariantCulture)
                    + (team.RawRank != team.Rank
                        ? "(raw " + team.RawRank.ToString(CultureInfo.InvariantCulture) + ")"
                        : String.Empty)
                    + " s" + team.Score.ToString(CultureInfo.InvariantCulture) + "=";
                try
                {
                    long record = catalogBase + (long)team.TeamId * 0xD8;
                    string key = scanner.ReadAsciiString(record, 16);
                    string name = scanner.ReadAsciiString(record + 32, 31);
                    entry += (String.IsNullOrWhiteSpace(key) ? "?" : key)
                        + "/" + (String.IsNullOrWhiteSpace(name) ? "?" : name);
                }
                catch { entry += "unreadable"; }
                entry += DescribeDisplayPointer(team);
                seen.Add(entry);
            }
            // Distinct ids matter more than the raw count: several clones of one
            // team still cannot orient a scoreboard, and that reads very
            // differently from genuinely having found both sides.
            return "anchor0=" + anchor
                + " objects=" + teams.Count.ToString(CultureInfo.InvariantCulture)
                + " distinct=" + reported.Count.ToString(CultureInfo.InvariantCulture)
                + " | " + String.Join("  ", seen.ToArray());
        }

        // Every ScoreHud team object carries a pointer at +24 that the parser
        // reads and nothing has ever used. If it leads to the team's display
        // name then names come from the same object as rank, record, score and
        // timeouts, which is what the catalog route failed to deliver:
        // indexing the catalog by TeamId returned Fresno State for a Pitt v USC
        // game, because record 0 is AIRFOR and the table is alphabetical, so
        // the row number is not the game's team id.
        //
        // Report what is actually at the other end - a string, a pointer to a
        // string, or neither - rather than assuming. Both encodings are tried
        // because the game stores some names UTF-16 and some ASCII.
        private string DescribeDisplayPointer(ScoreHudTeamCandidate team)
        {
            if (team.DisplayPointer == 0) return " [display=null]";
            string direct = ReadableTextAt(team.DisplayPointer);
            if (direct != null) return " [display->" + direct + "]";
            // Not text itself: try one level of indirection, which is how a
            // wrapper object around a string would look.
            for (int offset = 0; offset <= 0x30; offset += 8)
            {
                long inner;
                try { inner = BitConverter.ToInt64(scanner.ReadBytes(team.DisplayPointer + offset, 8), 0); }
                catch { break; }
                if (inner == 0) continue;
                string text = ReadableTextAt(inner);
                if (text != null) return " [display+0x" + offset.ToString("X") + "->" + text + "]";
            }
            return " [display=" + team.DisplayPointer.ToString("X") + " no text]";
        }

        // A run of printable characters that looks like a name, in either
        // ASCII or UTF-16. Returns null when the bytes are not text.
        private string ReadableTextAt(long address)
        {
            byte[] bytes;
            try { bytes = scanner.ReadBytes(address, 64); }
            catch { return null; }
            StringBuilder ascii = new StringBuilder();
            for (int i = 0; i < bytes.Length && bytes[i] != 0; i++)
            {
                if (bytes[i] < 0x20 || bytes[i] > 0x7E) { ascii.Length = 0; break; }
                ascii.Append((char)bytes[i]);
            }
            if (ascii.Length >= 3) return ascii.ToString();
            StringBuilder wide = new StringBuilder();
            for (int i = 0; i + 1 < bytes.Length; i += 2)
            {
                if (bytes[i] == 0 && bytes[i + 1] == 0) break;
                if (bytes[i + 1] != 0 || bytes[i] < 0x20 || bytes[i] > 0x7E) { wide.Length = 0; break; }
                wide.Append((char)bytes[i]);
            }
            return wide.Length >= 3 ? wide.ToString() : null;
        }

        private string FindTeamIdInCatalog(long catalogBase, int teamId)
        {
            if (teamId <= 0) return "";
            byte[] bytes;
            try { bytes = scanner.ReadBytes(catalogBase, 0xF000); }
            catch { return " [catalog unreadable]"; }
            List<string> hits = new List<string>();
            for (int record = 0; (record + 1) * 0xD8 <= bytes.Length && hits.Count < 4; record++)
            {
                int start = record * 0xD8;
                for (int offset = 0; offset + 4 <= 0xD8; offset += 4)
                {
                    if (BitConverter.ToInt32(bytes, start + offset) != teamId) continue;
                    int nameStart = start + 32;
                    int nameEnd = nameStart;
                    while (nameEnd < bytes.Length && nameEnd < nameStart + 32
                        && bytes[nameEnd] != 0) nameEnd++;
                    string name = nameEnd > nameStart
                        ? Encoding.ASCII.GetString(bytes, nameStart, nameEnd - nameStart)
                        : "?";
                    hits.Add("+0x" + offset.ToString("X") + "->" + name);
                    break;
                }
            }
            return hits.Count == 0
                ? " [id not found in any catalog record]"
                : " [" + String.Join(" ", hits.ToArray()) + "]";
        }

        // Every discovery must belong to the active matchup. While names are
        // pending, the generation-stamped result produced after the epoch reset
        // may establish a ScoreHud identity without waiting on those names.
        internal static bool ScoreHudIdentityBindingAllowed(
            bool matchupTransitionPending, bool discoveryMatchesCurrentEpoch)
        {
            // Transition state changes whether names are ready, not whether an
            // old discovery is trustworthy. Every binding must carry the active
            // epoch; pending names are allowed only when that proof is present.
            return discoveryMatchesCurrentEpoch;
        }

        private void ApplyScoreHudRankCandidates(List<ScoreHudTeamCandidate> teams,
            bool discoveryMatchesCurrentEpoch)
        {
            scoreHudTeamCandidateCount = teams.Count;
            // Reported before any early return: the name deadlock means the
            // returns below fire in exactly the games we most need to see this
            // in, and a diagnostic that only prints on the happy path is no
            // use for diagnosing the unhappy one.
            teamIdNamesDiagnostic = DescribeTeamIdCatalogNames(teams);
            // Team names are deliberately NOT required here.
            //
            // This method decides which ScoreHud team object is home and which
            // is away, and then installs ranks, records and timeouts from them.
            // It has never used the names to do that - orientation is decided by
            // score and possession in TrySelectFreshScoreHudSides. The name check
            // that used to be on this line was a gate, not a dependency, and it
            // meant one unresolved field silently withheld three working ones:
            // observed live as ranks blank, records blank and
            // "timeoutInstall: selection declined" while the standalone locator
            // was reporting "timeoutBind: bound (home=3 away=3)" at the same
            // moment.
            //
            // A transition no longer blocks this path by itself. Unknown and
            // TeamBuilder names can remain pending indefinitely, while these
            // live objects are the only source of their stable identity. The
            // discovery must instead belong to the current matchup generation:
            // BeginPendingMatchupTransition increments that generation, cancels
            // every older ScoreHud worker and resets the orientation. This lets
            // a fresh score-guarded pair bind without allowing an old game's pair
            // to cross the epoch boundary.
            if (!ScoreHudIdentityBindingAllowed(
                    matchupTransitionPending, discoveryMatchesCurrentEpoch))
            {
                rankBindDiagnostic = "waiting: ScoreHud discovery belongs to an older matchup epoch";
                return;
            }
            if (teams.Count < 2)
            {
                rankBindDiagnostic = "no bind: only " + teams.Count
                    + " ScoreHud team object(s) found, need 2";
                return;
            }
            teams.Sort(delegate(ScoreHudTeamCandidate left, ScoreHudTeamCandidate right)
            {
                return left.Address.CompareTo(right.Address);
            });

            RamReadResult awayScore = Read("awayScore", 0, 255);
            RamReadResult homeScore = Read("homeScore", 0, 255);
            RamReadResult possession = ReadVerifiedPossession();
            ScoreHudTeamCandidate away = null;
            ScoreHudTeamCandidate home = null;
            bool distinctScoreEvidence = false;
            if (orientedAwayScoreHudTeamId >= 0 && orientedHomeScoreHudTeamId >= 0)
            {
                if (!TrySelectBoundScoreHudSides(teams, awayScore, homeScore, out away, out home))
                {
                    // A bound side stops matching when its score no longer agrees
                    // - which is exactly what happens if the provisional
                    // address-order orientation guessed the sides backwards and
                    // the game has now scored. Previously this just returned, so
                    // a wrong orientation stalled for the rest of the game and
                    // could never be re-derived. Drop the binding and orient
                    // again from whatever evidence now exists.
                    //
                    // A few consecutive misses are required first: a single miss
                    // is usually just a score updating between two reads, and
                    // tearing down a good orientation for that would thrash.
                    lostScoreHudBindCount++;
                    rankBindDiagnostic = "lost bind: no candidate matches team ids "
                        + orientedAwayScoreHudTeamId + "/" + orientedHomeScoreHudTeamId
                        + " among " + teams.Count + " objects ("
                        + lostScoreHudBindCount + " consecutive)";
                    if (lostScoreHudBindCount >= 3)
                    {
                        rankBindDiagnostic += " - re-orienting";
                        lostScoreHudBindCount = 0;
                        ResetScoreHudOrientation();
                    }
                    return;
                }
                lostScoreHudBindCount = 0;
            }
            else
            {
                bool orientedByName = false;
                if (!TrySelectFreshScoreHudSides(teams, awayScore, homeScore, possession,
                        out away, out home, out distinctScoreEvidence)
                    && !matchupTransitionPending
                    && TrySelectScoreHudSidesByName(teams, lastAwayTeamName, lastHomeTeamName,
                        CatalogNameForTeamId, awayScore, homeScore, out away, out home))
                {
                    orientedByName = true;
                }
                if (away == null || home == null)
                {
                    // Orientation needs either two different scores or a
                    // trusted possession bit to tell home from away. Say which
                    // of those is missing rather than returning in silence.
                    rankBindDiagnostic = "no orientation: scores "
                        + (awayScore.Available ? awayScore.Value.ToString(CultureInfo.InvariantCulture) : "?")
                        + "-" + (homeScore.Available ? homeScore.Value.ToString(CultureInfo.InvariantCulture) : "?")
                        + (distinctScoreEvidence ? " (distinct)" : " (tied, so possession is required)")
                        + ", possession " + (possession.Available
                            ? possession.Value.ToString(CultureInfo.InvariantCulture)
                            : "unavailable")
                        + ", " + teams.Count + " objects";
                    ResetPendingScoreHudOrientation();
                    nextRankScoreHudDiscoveryUtc = DateTime.UtcNow.AddSeconds(2);
                    return;
                }
                int requiredConfirmations = distinctScoreEvidence ? 1 : (orientedByName ? 2 : 3);
                if (pendingAwayScoreHudTeamId == away.TeamId
                    && pendingHomeScoreHudTeamId == home.TeamId
                    && pendingAwayScoreHudRank == away.Rank
                    && pendingHomeScoreHudRank == home.Rank)
                    scoreHudOrientationConfirmations++;
                else
                {
                    pendingAwayScoreHudTeamId = away.TeamId;
                    pendingHomeScoreHudTeamId = home.TeamId;
                    pendingAwayScoreHudRank = away.Rank;
                    pendingHomeScoreHudRank = home.Rank;
                    pendingAwayScoreHudAddress = away.Address;
                    pendingHomeScoreHudAddress = home.Address;
                    scoreHudOrientationConfirmations = 1;
                }
                if (scoreHudOrientationConfirmations < requiredConfirmations)
                {
                    rankBindDiagnostic = "confirming: " + scoreHudOrientationConfirmations
                        + "/" + requiredConfirmations + " agreeing reads";
                    SetField("awayRank", new long[0]);
                    SetField("homeRank", new long[0]);
                    nextRankScoreHudDiscoveryUtc = DateTime.UtcNow.AddSeconds(2);
                    return;
                }
                orientedAwayScoreHudTeamId = away.TeamId;
                orientedHomeScoreHudTeamId = home.TeamId;
                ResetPendingScoreHudOrientation();
            }

            // Both a new orientation and a successfully re-read bound pair came
            // from the generation-stamped discovery accepted above.
            orientedScoreHudMatchupGeneration = matchupGeneration;

            // Record which side ended up at the higher address, every time the
            // orientation was established by evidence we trust. This is the
            // ground truth needed to decide whether allocation order can ever
            // be used to orient a 0-0 kickoff, and it costs nothing to collect.
            rankBindDiagnostic = (matchupTransitionPending ? "bound while team names pending" : "bound")
                + " (away rank " + away.Rank + " record "
                + (FormatTeamRecord(away.Wins, away.Losses, away.Ties) ?? "?")
                + ", home rank " + home.Rank + " record "
                + (FormatTeamRecord(home.Wins, home.Losses, home.Ties) ?? "?")
                + ", order " + (away.Address > home.Address ? "away-higher" : "away-lower")
                + ")";
            // Every clone of each bound team is a valid read source; the
            // highest-address one is listed first to preserve the historical
            // preference, and readers walk the list until one validates.
            SetField("awayRank", RankObjectFieldAddresses(teams, away));
            SetField("homeRank", RankObjectFieldAddresses(teams, home));
            lastAwayRank = away.Rank;
            lastHomeRank = home.Rank;
            lastAwayRecord = FormatTeamRecord(away.Wins, away.Losses, away.Ties);
            lastHomeRecord = FormatTeamRecord(home.Wins, home.Losses, home.Ties);
            lastAwayRankGeneration = matchupGeneration;
            lastHomeRankGeneration = matchupGeneration;
            ApplyOrientedTimeoutFields(away, home);
        }

        // Orientation by team identity. Each ScoreHud team object carries a
        // TeamId that resolves to a catalog name, and the matchup's away/home
        // names are already known from the role buffers. When the two names
        // differ and exactly one team's objects match each side, that IS the
        // orientation - no score movement needed. This is what lets ranks and
        // records show from the kickoff instead of after the first score
        // (Dynasty games sat at 0-0 with both objects found and nothing
        // published). Stale objects from previous games in the same process
        // are filtered by requiring the object's score to match the live
        // score; disagreeing clone ranks are treated as ambiguous.
        internal static bool TrySelectScoreHudSidesByName(List<ScoreHudTeamCandidate> teams,
            string awayName, string homeName, Func<int, string> catalogNameForTeamId,
            RamReadResult awayScore, RamReadResult homeScore,
            out ScoreHudTeamCandidate away, out ScoreHudTeamCandidate home)
        {
            away = null;
            home = null;
            if (teams == null || catalogNameForTeamId == null) return false;
            string awaySlug = MemoryScanner.NormalizeSlug(awayName);
            string homeSlug = MemoryScanner.NormalizeSlug(homeName);
            if (String.IsNullOrEmpty(awaySlug) || String.IsNullOrEmpty(homeSlug)
                || String.Equals(awaySlug, homeSlug, StringComparison.Ordinal)) return false;
            Dictionary<int, string> slugByTeamId = new Dictionary<int, string>();
            for (int index = 0; index < teams.Count; index++)
            {
                ScoreHudTeamCandidate candidate = teams[index];
                if (awayScore.Available && candidate.Score != awayScore.Value
                    && homeScore.Available && candidate.Score != homeScore.Value) continue;
                string slug;
                if (!slugByTeamId.TryGetValue(candidate.TeamId, out slug))
                {
                    string name = null;
                    try { name = catalogNameForTeamId(candidate.TeamId); } catch { name = null; }
                    slug = MemoryScanner.NormalizeSlug(name);
                    slugByTeamId[candidate.TeamId] = slug;
                }
                if (String.IsNullOrEmpty(slug)) continue;
                bool isAway = String.Equals(slug, awaySlug, StringComparison.Ordinal);
                bool isHome = String.Equals(slug, homeSlug, StringComparison.Ordinal);
                if (isAway == isHome) continue;
                if (isAway && awayScore.Available && candidate.Score != awayScore.Value) continue;
                if (isHome && homeScore.Available && candidate.Score != homeScore.Value) continue;
                if (isAway)
                {
                    if (away == null) away = candidate;
                    else if (away.TeamId != candidate.TeamId || away.Rank != candidate.Rank) { away = null; home = null; return false; }
                    else if (candidate.Address > away.Address) away = candidate;
                }
                else
                {
                    if (home == null) home = candidate;
                    else if (home.TeamId != candidate.TeamId || home.Rank != candidate.Rank) { away = null; home = null; return false; }
                    else if (candidate.Address > home.Address) home = candidate;
                }
            }
            if (away == null || home == null || away.TeamId == home.TeamId) { away = null; home = null; return false; }
            return true;
        }

        private string CatalogNameForTeamId(int teamId)
        {
            long catalogBase = SingleConfiguredAddress("teamCatalogBase");
            if (catalogBase == 0 || teamId < 0 || teamId > 4096) return null;
            try { return scanner.ReadAsciiString(catalogBase + (long)teamId * 0xD8 + 32, 31); }
            catch { return null; }
        }

        // All clone addresses for one bound team, selected side first. Clones
        // must agree with the selected object on TeamId and Rank - the same
        // agreement TrySelectFreshScoreHudSides demands - and the list is
        // capped so a pathological sweep cannot bloat the profile.
        internal static List<long> RankObjectFieldAddresses(
            List<ScoreHudTeamCandidate> teams, ScoreHudTeamCandidate selected)
        {
            List<long> addresses = new List<long> { selected.Address + 44 };
            for (int index = 0; index < teams.Count && addresses.Count < 8; index++)
            {
                ScoreHudTeamCandidate candidate = teams[index];
                if (candidate.Address == selected.Address
                    || candidate.TeamId != selected.TeamId
                    || candidate.Rank != selected.Rank) continue;
                addresses.Add(candidate.Address + 44);
            }
            return addresses;
        }

        // Orientation of last resort, for the tied-score case with no usable
        // possession bit - which is every kickoff of every game.
        //
        // The two ScoreHud team objects are allocated in a stable order: the
        // lower address is home, the higher is away. Confirmed against two
        // separately bound games (Pitt v USC, ranked USC away at the higher
        // address both times) where the orientation had been established
        // independently by differing scores.
        //
        // This is weaker evidence than a score or a possession bit, so it is
        // treated as provisional: distinctScoreEvidence stays false, which keeps
        // the three-confirmation requirement, and the moment the scores diverge
        // TrySelectBoundScoreHudSides stops matching a wrong guess and the
        // orientation is re-derived from real evidence. A mistake corrects
        // itself within a few seconds instead of persisting for the game.
        //
        // Only ranks, records and timeouts hang off this. Scores, clock, down
        // and distance come from the core scoreboard and are unaffected.
        internal static bool TrySelectScoreHudSidesByAddressOrder(
            List<ScoreHudTeamCandidate> teams, RamReadResult awayScore, RamReadResult homeScore,
            out ScoreHudTeamCandidate away, out ScoreHudTeamCandidate home)
        {
            away = null;
            home = null;
            // Only for the genuinely tied case. If the scores differ, the caller
            // has real evidence and must use it.
            if (!awayScore.Available || !homeScore.Available
                || awayScore.Value != homeScore.Value) return false;
            int score = awayScore.Value;
            List<int> ids = new List<int>();
            for (int i = 0; i < teams.Count; i++)
            {
                if (teams[i].Score != score) continue;
                if (!ids.Contains(teams[i].TeamId)) ids.Add(teams[i].TeamId);
            }
            // Exactly two teams, or there is nothing to orient.
            if (ids.Count != 2) return false;
            long firstLowest = Int64.MaxValue;
            long secondLowest = Int64.MaxValue;
            ScoreHudTeamCandidate firstTop = null;
            ScoreHudTeamCandidate secondTop = null;
            for (int i = 0; i < teams.Count; i++)
            {
                ScoreHudTeamCandidate team = teams[i];
                if (team.Score != score) continue;
                if (team.TeamId == ids[0])
                {
                    if (team.Address < firstLowest) firstLowest = team.Address;
                    if (firstTop == null || team.Address > firstTop.Address) firstTop = team;
                }
                else if (team.TeamId == ids[1])
                {
                    if (team.Address < secondLowest) secondLowest = team.Address;
                    if (secondTop == null || team.Address > secondTop.Address) secondTop = team;
                }
            }
            if (firstTop == null || secondTop == null || firstLowest == secondLowest) return false;
            if (firstLowest < secondLowest) { home = firstTop; away = secondTop; }
            else { home = secondTop; away = firstTop; }
            return away.Address != home.Address;
        }

        internal static bool TrySelectFreshScoreHudSides(List<ScoreHudTeamCandidate> teams,
            RamReadResult awayScore, RamReadResult homeScore, RamReadResult possession,
            out ScoreHudTeamCandidate away, out ScoreHudTeamCandidate home,
            out bool distinctScoreEvidence)
        {
            away = null;
            home = null;
            distinctScoreEvidence = awayScore.Available && homeScore.Available
                && awayScore.Value != homeScore.Value;
            if (!awayScore.Available || !homeScore.Available) return false;
            bool canUsePossession = possession.Available && possession.Value <= 1;
            // Orienting by allocation order was tried here and reverted.
            //
            // The rule it used - lower address is home - was inferred from the
            // teamIdNames diagnostic, which is built before teams.Sort() runs.
            // That list was therefore never in address order, so the rule was
            // inferred from nothing. Both games it was checked against had in
            // fact bound from differing scores, so the guess was never actually
            // exercised until a Dynasty game, where it put both teams' records
            // on the wrong side.
            //
            // Wrong values are worse than missing ones. Wait for real evidence
            // until the true ordering is known - and record what that ordering
            // is, every time orientation succeeds by other means, so the
            // question can be settled with data instead of another guess.
            if (!distinctScoreEvidence && !canUsePossession) return false;

            for (int awayIndex = 0; awayIndex < teams.Count; awayIndex++)
            {
                ScoreHudTeamCandidate awayCandidate = teams[awayIndex];
                if (awayCandidate.Score != awayScore.Value) continue;
                for (int homeIndex = 0; homeIndex < teams.Count; homeIndex++)
                {
                    if (awayIndex == homeIndex) continue;
                    ScoreHudTeamCandidate homeCandidate = teams[homeIndex];
                    if (homeCandidate.Score != homeScore.Value || awayCandidate.TeamId == homeCandidate.TeamId) continue;
                    if (!distinctScoreEvidence)
                    {
                        int expectedAwayPossession = possession.Value == 1 ? 1 : 0;
                        int expectedHomePossession = expectedAwayPossession == 1 ? 0 : 1;
                        if (awayCandidate.HasPossession != expectedAwayPossession
                            || homeCandidate.HasPossession != expectedHomePossession) continue;
                    }
                    if (away == null)
                    {
                        away = awayCandidate;
                        home = homeCandidate;
                        continue;
                    }
                    // Multiple physical clones are acceptable only when they
                    // describe the exact same slot orientation and values.
                    if (away.TeamId != awayCandidate.TeamId || home.TeamId != homeCandidate.TeamId
                        || away.Rank != awayCandidate.Rank || home.Rank != homeCandidate.Rank)
                    {
                        away = null;
                        home = null;
                        return false;
                    }
                    if (awayCandidate.Address > away.Address) away = awayCandidate;
                    if (homeCandidate.Address > home.Address) home = homeCandidate;
                }
            }
            return away != null && home != null;
        }

        private bool TrySelectBoundScoreHudSides(List<ScoreHudTeamCandidate> teams,
            RamReadResult awayScore, RamReadResult homeScore,
            out ScoreHudTeamCandidate away, out ScoreHudTeamCandidate home)
        {
            away = null;
            home = null;
            for (int index = 0; index < teams.Count; index++)
            {
                ScoreHudTeamCandidate candidate = teams[index];
                if (candidate.TeamId == orientedAwayScoreHudTeamId
                    && (!awayScore.Available || candidate.Score == awayScore.Value))
                {
                    if (away != null && away.Rank != candidate.Rank) return false;
                    if (away == null || candidate.Address > away.Address) away = candidate;
                }
                if (candidate.TeamId == orientedHomeScoreHudTeamId
                    && (!homeScore.Available || candidate.Score == homeScore.Value))
                {
                    if (home != null && home.Rank != candidate.Rank) return false;
                    if (home == null || candidate.Address > home.Address) home = candidate;
                }
            }
            return away != null && home != null && away.Address != home.Address;
        }

        private void ResetPendingScoreHudOrientation()
        {
            pendingAwayScoreHudTeamId = -1;
            pendingHomeScoreHudTeamId = -1;
            pendingAwayScoreHudRank = -1;
            pendingHomeScoreHudRank = -1;
            pendingAwayScoreHudAddress = 0;
            pendingHomeScoreHudAddress = 0;
            scoreHudOrientationConfirmations = 0;
        }

        private void ApplyOrientedTimeoutFields()
        {
            // The two exact presentation clones have invariant side semantics:
            // +0x44 is home and +0x48 is away. This is independently labeled
            // by the Pittsburgh-home and UNLV-home timeout transitions. Do not
            // route these counters through transient ScoreHud team objects.
            if (!ApplyVerifiedHomeAwayTimeoutFields())
            {
                SetField("awayTimeouts", new long[0]);
                SetField("homeTimeouts", new long[0]);
            }
        }

        private bool ApplyVerifiedHomeAwayTimeoutFields()
        {
            List<long> homeAddresses = CopyConfiguredAddresses("timeoutSlotTeamIdZero");
            List<long> awayAddresses = CopyConfiguredAddresses("timeoutSlotTeamIdOther");
            homeAddresses.Sort();
            awayAddresses.Sort();
            bool clearConfiguredSlots;
            if (!ConfiguredTimeoutCloneContextsAreSafe(
                    homeAddresses, awayAddresses, out clearConfiguredSlots))
            {
                timeoutBindDiagnostic = "clone-contexts-unsafe (slots home="
                    + homeAddresses.Count.ToString(CultureInfo.InvariantCulture)
                    + " away=" + awayAddresses.Count.ToString(CultureInfo.InvariantCulture)
                    + " clear=" + (clearConfiguredSlots ? "yes" : "no") + ")";
                if (clearConfiguredSlots) ClearConfiguredTimeoutCloneSlots();
                return false;
            }
            RamReadResult home = Read("timeoutSlotTeamIdZero", 0, 3);
            RamReadResult away = Read("timeoutSlotTeamIdOther", 0, 3);
            if (!home.Available || !away.Available)
            {
                timeoutBindDiagnostic = "slot-read-unavailable (home="
                    + (home.Available ? "ok" : "no") + " away=" + (away.Available ? "ok" : "no") + ")";
                return false;
            }
            if (!VerifiedHomeAwayTimeoutCopiesAreSafe(
                    homeAddresses.Count, awayAddresses.Count, home.Value, away.Value))
            {
                timeoutBindDiagnostic = "copies-unsafe (home=" + home.Value.ToString(CultureInfo.InvariantCulture)
                    + " away=" + away.Value.ToString(CultureInfo.InvariantCulture)
                    + " counts " + homeAddresses.Count.ToString(CultureInfo.InvariantCulture)
                    + "/" + awayAddresses.Count.ToString(CultureInfo.InvariantCulture) + ")";
                return false;
            }
            if (!TimeoutCloneReadHasFullConsensus(
                    home.ConfiguredCopies, home.SuccessfulReads, home.AgreeingCopies))
            {
                timeoutBindDiagnostic = "home-no-consensus (configured=" + home.ConfiguredCopies
                    + " reads=" + home.SuccessfulReads + " agree=" + home.AgreeingCopies + ")";
                return false;
            }
            if (!TimeoutCloneReadHasFullConsensus(
                    away.ConfiguredCopies, away.SuccessfulReads, away.AgreeingCopies))
            {
                timeoutBindDiagnostic = "away-no-consensus (configured=" + away.ConfiguredCopies
                    + " reads=" + away.SuccessfulReads + " agree=" + away.AgreeingCopies + ")";
                return false;
            }

            SetField("awayTimeouts", awayAddresses);
            SetField("homeTimeouts", homeAddresses);
            RamReadResult orientedAway = Read("awayTimeouts", 0, 3);
            RamReadResult orientedHome = Read("homeTimeouts", 0, 3);
            bool clearAfterReread;
            bool contextStillSafe = ConfiguredTimeoutCloneContextsAreSafe(
                homeAddresses, awayAddresses, out clearAfterReread);
            if (!contextStillSafe)
            {
                timeoutBindDiagnostic = "reread-contexts-unsafe (clear="
                    + (clearAfterReread ? "yes" : "no") + ")";
                if (clearAfterReread) ClearConfiguredTimeoutCloneSlots();
                return false;
            }
            if (!TimeoutCloneReadHasFullConsensus(
                    orientedAway.ConfiguredCopies, orientedAway.SuccessfulReads, orientedAway.AgreeingCopies)
                || !TimeoutCloneReadHasFullConsensus(
                    orientedHome.ConfiguredCopies, orientedHome.SuccessfulReads, orientedHome.AgreeingCopies))
            {
                timeoutBindDiagnostic = "reread-no-consensus (away " + orientedAway.SuccessfulReads
                    + "/" + orientedAway.AgreeingCopies + "/" + orientedAway.ConfiguredCopies
                    + ", home " + orientedHome.SuccessfulReads
                    + "/" + orientedHome.AgreeingCopies + "/" + orientedHome.ConfiguredCopies + ")";
                return false;
            }
            if (!VerifiedHomeAwayTimeoutRereadIsValid(
                    orientedAway.Available, orientedHome.Available,
                    orientedAway.Value, orientedHome.Value,
                    away.Value, home.Value))
            {
                timeoutBindDiagnostic = "reread-mismatch (first home=" + home.Value + " away=" + away.Value
                    + ", reread home=" + orientedHome.Value + " away=" + orientedAway.Value + ")";
                return false;
            }
            if (!RuntimeCatalogTimeoutCountersMatch(orientedHome.Value, orientedAway.Value))
            {
                timeoutBindDiagnostic = "catalog-counters-mismatch (clone home="
                    + orientedHome.Value + " away=" + orientedAway.Value + ")";
                return false;
            }
            timeoutBindDiagnostic = "bound (home=" + orientedHome.Value + " away=" + orientedAway.Value + ")";
            return true;
        }

        private bool RuntimeCatalogTimeoutCountersMatch(int cloneHome, int cloneAway)
        {
            string coreSignature = ConfiguredCoreSignature();
            long catalogBase = SingleConfiguredAddress("teamCatalogBase");
            bool checkRequired = coreSignature.EndsWith(":W", StringComparison.Ordinal)
                && catalogBase != 0;
            if (!checkRequired) return true;
            try
            {
                long homeAddress = catalogBase + 0x67850;
                long awayAddress = homeAddress + 4;
                int firstHome = scanner.ReadInt32(homeAddress);
                int firstAway = scanner.ReadInt32(awayAddress);
                int secondHome = scanner.ReadInt32(homeAddress);
                int secondAway = scanner.ReadInt32(awayAddress);
                catalogTimeoutDiagnostic = "catalog reads " + firstHome + "/" + firstAway
                    + " then " + secondHome + "/" + secondAway
                    + " vs clones " + cloneHome + "/" + cloneAway;

                // A catalog counter outside 0-3 is not a disagreement, it is
                // an unreadable corroborator - this offset does not hold
                // timeout counts in every mode. Letting it veto is how two
                // clones that agree with each other, read twice each, get
                // thrown away: observed as "catalog-counters-mismatch (clone
                // home=3 away=3)" on a live game where the clones were right.
                //
                // A catalog value that IS in range and disagrees is still a
                // real conflict and still rejects.
                bool firstUsable = firstHome >= 0 && firstHome <= 3
                    && firstAway >= 0 && firstAway <= 3;
                bool secondUsable = secondHome >= 0 && secondHome <= 3
                    && secondAway >= 0 && secondAway <= 3;
                if (!firstUsable || !secondUsable)
                {
                    catalogTimeoutDiagnostic += " (catalog not usable here; check skipped)";
                    return true;
                }
                if (RuntimeCatalogTimeoutReadsAreSafe(
                    true, cloneHome, cloneAway,
                    firstHome, firstAway, secondHome, secondAway)) return true;
                // An in-range catalog that disagrees with the clones is not
                // proof the clones are wrong: it lags behind used timeouts and
                // holds a different quantity in some modes, and its false
                // vetoes are what kept verified timeouts off the scorebug for
                // whole quarters. The clones' own five-layer verification is
                // the authority; the catalog may only veto the one state it
                // exists to catch - the dormant 0/0 pair a dead game leaves.
                if (cloneHome == 0 && cloneAway == 0) return false;
                catalogTimeoutDiagnostic += " (disagrees; advisory only, clones are self-verified)";
                return true;
            }
            catch
            {
                catalogTimeoutDiagnostic = "catalog unreadable; check skipped";
                return true;
            }
        }

        internal static bool RuntimeCatalogTimeoutReadsAreSafe(
            bool checkRequired, int cloneHome, int cloneAway,
            int firstCatalogHome, int firstCatalogAway,
            int secondCatalogHome, int secondCatalogAway)
        {
            if (!checkRequired) return true;
            return MemoryScanner.CatalogTimeoutCountersCorroborateClones(
                    true, firstCatalogHome, firstCatalogAway,
                    cloneHome, cloneAway)
                && MemoryScanner.CatalogTimeoutCountersCorroborateClones(
                    true, secondCatalogHome, secondCatalogAway,
                    cloneHome, cloneAway);
        }

        private bool ConfiguredTimeoutCloneContextsAreSafe(
            List<long> homeAddresses, List<long> awayAddresses,
            out bool clearConfiguredSlots)
        {
            clearConfiguredSlots = false;
            bool layoutSafe = homeAddresses != null && awayAddresses != null
                && homeAddresses.Count == 2 && awayAddresses.Count == 2
                && TimeoutCloneConfiguredAddressLayoutIsSafe(
                    homeAddresses.Count, awayAddresses.Count,
                    homeAddresses[0], homeAddresses[1],
                    awayAddresses[0], awayAddresses[1]);
            if (!layoutSafe)
            {
                clearConfiguredSlots = true;
                return false;
            }
            long firstBase = homeAddresses[0] - 0x44;
            long secondBase = homeAddresses[1] - 0x44;
            try
            {
                byte[] first = scanner.ReadBytes(firstBase, 0x80);
                byte[] second = scanner.ReadBytes(secondBase, 0x80);
                bool firstPatternSafe = MemoryScanner.TimeoutContextMatchesKnownPattern(first);
                bool secondPatternSafe = MemoryScanner.TimeoutContextMatchesKnownPattern(second);
                clearConfiguredSlots = TimeoutCloneRuntimeFailureRequiresClearing(
                    true, firstPatternSafe, secondPatternSafe);
                if (clearConfiguredSlots) return false;
                // A counter disagreement or an in-flight update between the
                // two clones is transient: publish nothing this refresh, retain
                // the verified addresses, and recover on the next refresh.
                return MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(first, second);
            }
            catch { return false; }
        }

        internal static bool TimeoutCloneRuntimeFailureRequiresClearing(
            bool layoutSafe, bool firstPatternSafe, bool secondPatternSafe)
        {
            return !layoutSafe || !firstPatternSafe || !secondPatternSafe;
        }

        private void ClearConfiguredTimeoutCloneSlots()
        {
            SetField("timeoutSlotTeamIdZero", new long[0]);
            SetField("timeoutSlotTeamIdOther", new long[0]);
            SetField("awayTimeouts", new long[0]);
            SetField("homeTimeouts", new long[0]);
            SetField("timeoutCloneHomePossession", new long[0]);
        }

        internal static bool TimeoutCloneConfiguredAddressLayoutIsSafe(
            int homeCount, int awayCount,
            long firstHome, long secondHome,
            long firstAway, long secondAway)
        {
            return homeCount == 2 && awayCount == 2
                && firstHome > 0 && secondHome - firstHome == 0x2D0
                && firstAway == firstHome + 4
                && secondAway == secondHome + 4;
        }

        internal static bool VerifiedHomeAwayTimeoutPairIsSafe(int home, int away)
        {
            return home >= 0 && home <= 3 && away >= 0 && away <= 3;
        }

        internal static bool VerifiedHomeAwayTimeoutCopiesAreSafe(
            int homeCopies, int awayCopies, int home, int away)
        {
            return homeCopies == 2 && awayCopies == 2
                && VerifiedHomeAwayTimeoutPairIsSafe(home, away);
        }

        internal static bool TimeoutCloneReadHasFullConsensus(
            int configuredCopies, int successfulReads, int agreeingCopies)
        {
            return configuredCopies == 2 && successfulReads == 2 && agreeingCopies == 2;
        }

        internal static bool VerifiedHomeAwayTimeoutRereadIsValid(
            bool awayAvailable, bool homeAvailable, int away, int home,
            int expectedAway, int expectedHome)
        {
            return awayAvailable && homeAvailable
                && away == expectedAway && home == expectedHome;
        }

        private void ApplyOrientedTimeoutFields(ScoreHudTeamCandidate away, ScoreHudTeamCandidate home)
        {
            ApplyOrientedTimeoutFields();
        }

        private static void ClearStaleOutput(string screenJsonPath)
        {
            try
            {
                string outputPath = OutputPath(screenJsonPath);
                if (File.Exists(outputPath)) File.Delete(outputPath);
            }
            catch { }
        }

        private void SetVerificationFields(long block, bool usesWideLayout)
        {
            if (block == 0)
            {
                SetField("verifyQuarter", new long[0]);
                SetField("verifyGameClockSeconds", new long[0]);
                SetField("verifyPlayClock", new long[0]);
                SetField("verifyHomeScore", new long[0]);
                SetField("verifyAwayScore", new long[0]);
                SetField("verifyDown", new long[0]);
                SetField("verifyDistance", new long[0]);
                return;
            }
            if (usesWideLayout)
            {
                SetField("verifyQuarter", new long[] { block + 0xC8 });
                SetField("verifyGameClockSeconds", new long[] { block + 0x100 });
                SetField("verifyPlayClock", new long[] { block + 0x180 });
                SetField("verifyHomeScore", new long[] { block + 0x90, block + 0xC0 });
                SetField("verifyAwayScore", new long[] { block + 0x98, block + 0xB0 });
                SetField("verifyDown", new long[] { block + 0xB8 });
                SetField("verifyDistance", new long[] { block + 0x148 });
            }
            else
            {
                SetField("verifyQuarter", new long[] { block + 0xEC });
                SetField("verifyGameClockSeconds", new long[] { block + 0xF4 });
                SetField("verifyPlayClock", new long[] { block + 0xF8 });
                SetField("verifyHomeScore", new long[] { block + 0xFC });
                SetField("verifyAwayScore", new long[] { block + 0x100 });
                SetField("verifyDown", new long[] { block + 0x10C });
                SetField("verifyDistance", new long[] { block + 0x110 });
            }
        }

        private void BeginProfileConfirmation(string summary)
        {
            // Discovery adopting a core makes any in-flight cache probe moot.
            ResetCacheProbe();
            confirmationProcessId = scanner.Process.Id;
            confirmationPassCount = 0;
            nextConfirmationUtc = DateTime.MinValue;
            nextHealthCheckUtc = DateTime.MinValue;
            healthFailureCount = 0;
            ResetLogicalState();
            autoDiscoverySummary = summary;
        }

        private bool ConfirmProfileIfNeeded()
        {
            if (confirmationProcessId != scanner.Process.Id) return true;
            if (DateTime.UtcNow < nextConfirmationUtc) return false;
            nextConfirmationUtc = DateTime.UtcNow.AddMilliseconds(150);
            if (!ProfileIsHealthy())
            {
                InvalidateProfile("synchronized confirmation failed");
                return false;
            }
            confirmationPassCount++;
            if (confirmationPassCount < 3) return false;
            confirmationProcessId = 0;
            healthFailureCount = 0;
            nextHealthCheckUtc = DateTime.UtcNow.AddMilliseconds(500);
            autoDiscoverySummary = (autoDiscoverySummary ?? String.Empty).Replace("; confirmation pending", "; confirmed 3/3");
            SaveCompleteProfileCache();
            return true;
        }

        private bool ProfileIsHealthy()
        {
            return CachedProfileIsReadable() && ProfileTeamNamesAreHealthy() && VerificationRecordAgrees();
        }

        private bool RuntimeProfileIsHealthy()
        {
            return CachedProfileIsReadable() && ProfileTeamNamesAreHealthy();
        }

        private bool ProfileTeamNamesAreHealthy()
        {
            RamTextResult away = ReadAscii("awayTeamNameAscii", 64);
            RamTextResult home = ReadAscii("homeTeamNameAscii", 64);
            if (!String.IsNullOrWhiteSpace(profile.SeedAwayTeamName)
                && away.Available
                && !MemoryScanner.RoleDisplayNameMatchesCanonical(
                    away.Value, profile.SeedAwayTeamName)) return false;
            if (!String.IsNullOrWhiteSpace(profile.SeedHomeTeamName)
                && home.Available
                && !MemoryScanner.RoleDisplayNameMatchesCanonical(
                    home.Value, profile.SeedHomeTeamName)) return false;
            // Team presentation objects can be staggered after a game restart.
            // Known seed mismatches above still fail health; an unavailable
            // side remains pending without suppressing the valid scoreboard.
            return true;
        }

        private bool VerificationRecordAgrees()
        {
            if (!HasConfiguredField("verifyQuarter")) return true;
            RamReadResult quarter = Read("quarter", 1, 20);
            RamReadResult verifyQuarter = Read("verifyQuarter", 1, 20);
            RamReadResult clock = Read("gameClockSeconds", 0, 3600);
            RamReadResult verifyClock = Read("verifyGameClockSeconds", 0, 3600);
            RamReadResult playClock = Read("playClock", 0, 99);
            RamReadResult verifyPlayClock = Read("verifyPlayClock", 0, 99);
            RamReadResult homeScore = Read("homeScore", 0, 255);
            RamReadResult verifyHomeScore = Read("verifyHomeScore", 0, 255);
            RamReadResult awayScore = Read("awayScore", 0, 255);
            RamReadResult verifyAwayScore = Read("verifyAwayScore", 0, 255);
            RamReadResult down = Read("down", 0, 4);
            RamReadResult verifyDown = Read("verifyDown", 0, 4);
            RamReadResult distance = Read("distance", 0, 99);
            RamReadResult verifyDistance = Read("verifyDistance", 0, 99);
            return quarter.Available && verifyQuarter.Available && quarter.Value == verifyQuarter.Value
                && clock.Available && verifyClock.Available && Math.Abs(clock.Value - verifyClock.Value) <= 2
                && playClock.Available && verifyPlayClock.Available && Math.Abs(playClock.Value - verifyPlayClock.Value) <= 2
                && homeScore.Available && verifyHomeScore.Available && homeScore.Value == verifyHomeScore.Value
                && awayScore.Available && verifyAwayScore.Available && awayScore.Value == verifyAwayScore.Value
                && down.Available && verifyDown.Available && down.Value == verifyDown.Value
                && distance.Available && verifyDistance.Available && distance.Value == verifyDistance.Value;
        }

        private bool PossessionVerificationRecordAgrees()
        {
            return HasConfiguredField("possessionAwayIsOne")
                && HasConfiguredField("verifyQuarter")
                && HasConfiguredField("verifyDown")
                && HasConfiguredField("verifyDistance")
                && VerificationRecordAgrees();
        }

        // Orientation-only view: deciding which team object is home must never
        // consume the HUD possession that is read FROM those same objects, or a
        // torn-down wrong orientation could re-assert itself. Legacy only here.
        private RamReadResult ReadVerifiedPossession()
        {
            return SelectVerifiedPossession(RamReadResult.Missing(0),
                Read("possessionAwayIsOne", 0, 2), PossessionVerificationRecordAgrees());
        }

        // 1 = away has the ball, 0 = home does, -1 = no clean answer. Only a
        // complementary pair counts; both-off is a real dead-ball state and
        // both-on is a mid-update read, and neither may move the arrow.
        internal static int HudPossessionCandidate(int awayFlag, int homeFlag)
        {
            if (awayFlag == 1 && homeFlag == 0) return 1;
            if (awayFlag == 0 && homeFlag == 1) return 0;
            return -1;
        }

        private void ObserveHudPossession()
        {
            // The score freshness guard mirrors the rule the orientation itself
            // uses (a bound side must keep matching its score): only a clone
            // carrying the live score may move the arrow. Without a readable
            // score this tick, skip the guard rather than stall - the
            // complementary-pair rule and flip debounce still hold.
            RamReadResult awayScore = Read("awayScore", 0, 255);
            RamReadResult homeScore = Read("homeScore", 0, 255);
            ScoreHudTeamCandidate away;
            ScoreHudTeamCandidate home;
            if (!TryReadConfiguredRankObject("awayRank",
                    awayScore.Available ? awayScore.Value : -1, out away)
                || !TryReadConfiguredRankObject("homeRank",
                    homeScore.Available ? homeScore.Value : -1, out home)) return;
            int candidate = HudPossessionCandidate(away.HasPossession, home.HasPossession);
            if (candidate < 0) return;
            if (candidate == hudPossessionPublished)
            {
                hudPossessionLastConfirmedUtc = DateTime.UtcNow;
                hudPossessionPending = -1;
                hudPossessionPendingCount = 0;
                return;
            }
            if (candidate == hudPossessionPending) hudPossessionPendingCount++;
            else
            {
                hudPossessionPending = candidate;
                hudPossessionPendingCount = 1;
            }
            if (hudPossessionPendingCount >= HudPossessionRequiredConfirmations)
            {
                hudPossessionPublished = candidate;
                hudPossessionLastConfirmedUtc = DateTime.UtcNow;
                hudPossessionPending = -1;
                hudPossessionPendingCount = 0;
            }
        }

        // side 0 = home, 1 = away (matches the clone-slot naming).
        private void ObserveHudTimeouts(RamReadResult awayScore, RamReadResult homeScore)
        {
            if (!HasConfiguredField("awayRank") && !HasConfiguredField("homeRank"))
            {
                hudTimeoutsDiagnostic = "HUD team objects not bound";
                return;
            }
            string[] notes = new string[2];
            for (int side = 0; side < 2; side++)
            {
                bool away = side == 1;
                RamReadResult score = away ? awayScore : homeScore;
                ScoreHudTeamCandidate team;
                if (!TryReadConfiguredRankObject(away ? "awayRank" : "homeRank",
                        score != null && score.Available ? score.Value : -1, out team))
                {
                    notes[side] = "no live object";
                    continue;
                }
                int candidate = team.Timeouts;
                if (candidate < 0 || candidate > 3) { notes[side] = "object value " + candidate + " out of range"; continue; }
                notes[side] = candidate.ToString(CultureInfo.InvariantCulture);
                if (candidate == hudTimeoutsPublished[side])
                {
                    hudTimeoutsLastConfirmedUtc[side] = DateTime.UtcNow;
                    hudTimeoutsPending[side] = -1;
                    hudTimeoutsPendingCount[side] = 0;
                    continue;
                }
                if (candidate == hudTimeoutsPending[side]) hudTimeoutsPendingCount[side]++;
                else { hudTimeoutsPending[side] = candidate; hudTimeoutsPendingCount[side] = 1; }
                if (hudTimeoutsPendingCount[side] >= HudTimeoutsRequiredConfirmations)
                {
                    hudTimeoutsPublished[side] = candidate;
                    hudTimeoutsLastConfirmedUtc[side] = DateTime.UtcNow;
                    hudTimeoutsPending[side] = -1;
                    hudTimeoutsPendingCount[side] = 0;
                }
                else notes[side] += " (pending)";
            }
            hudTimeoutsDiagnostic = "home " + notes[0] + ", away " + notes[1]
                + " | published home " + hudTimeoutsPublished[0] + " away " + hudTimeoutsPublished[1];
        }

        private RamReadResult ReadHudTimeouts(bool away)
        {
            int side = away ? 1 : 0;
            if (hudTimeoutsPublished[side] >= 0
                && DateTime.UtcNow - hudTimeoutsLastConfirmedUtc[side] <= HudTimeoutsHoldWindow)
                return new RamReadResult(true, hudTimeoutsPublished[side], 1, 1, 1);
            return RamReadResult.Missing(0);
        }

        // The numeric core stores yards-to-go truncated; the HUD rounds. A live
        // HUD text for the same down that is within one yard of the core is
        // the same state and the HUD's number is the one to show. Anything
        // further apart is a stale pooled object and is ignored.
        internal static bool HudDistanceAgreesWithCore(int hudDistance, int coreDistance)
        {
            return Math.Abs(hudDistance - coreDistance) <= 1;
        }

        // The wide scoreboard block stores yards-to-go as a FLOAT at +0xA8
        // with a verification copy at +0xD8 (proven 2026-08-20: 236/236 down
        // changes agree, zero mismatches). The game's own bug displays
        // ceil(float) - which is the whole "1st & 9 vs 10" story - and shows
        // "Inches" when the float is under one yard. During a field-goal
        // attempt the same slot holds the kick distance (55.3 / 60.1 / 65 in
        // the probe game's three attempts).
        // A field-goal attempt repurposes the yards-to-go slot to hold the KICK
        // LENGTH (proven 2026-08-20: 55.736 at 4th & 14). The tell is not the
        // game's FIELD GOAL text - that text is also shown for the result, long
        // after the slot reverts - it is the slot DIVERGING from the numeric
        // yards to go while holding a legal kick length.
        internal static bool LooksLikeFieldGoalKick(double preciseYards, int distanceYards,
            int down, bool fieldGoalTextRecent)
        {
            // Upper bound 120, not a "realistic" 90: the game happily lets a
            // player line up a 96-yarder (live test 2026-08-20), and a kick
            // from your own 1-yard line would be ~116. Yards-to-go can never
            // exceed ~99, so the divergence guard still blocks normal plays.
            if (preciseYards < 18 || preciseYards > 120) return false;
            if (Math.Abs(preciseYards - distanceYards) <= 3) return false;
            return down == 4 || fieldGoalTextRecent;
        }

        internal static int DistanceFromPreciseYards(double preciseYards)
        {
            return (int)Math.Ceiling(preciseYards - 0.0005);
        }

        internal static bool PreciseYardsAreInches(double preciseYards)
        {
            return preciseYards > 0 && preciseYards < 1;
        }

        internal static bool PreciseYardsPairAgrees(double primary, double copy)
        {
            return Math.Abs(primary - copy) < 0.01;
        }

        // Every REAL kick ever captured carries a fractional spot (43.003,
        // 39.814, 52.53, 60.078) because the ball never sits dead on a line.
        // The kickoff/PAT staging constant is a perfectly round 65.000 (the
        // kickoff spot: 35-yard line = 65 to the far goal - user-identified
        // 2026-08-20 after a PAT displayed as a "65-yard field goal"), so a
        // round integer in the slot is presentation staging, not a kick.
        internal static bool PreciseLooksLikeRealSpot(double preciseYards)
        {
            return Math.Abs(preciseYards - Math.Round(preciseYards)) > 0.001;
        }

        internal static RamReadResult SelectVerifiedTimeouts(RamReadResult hud, RamReadResult clone)
        {
            // The HUD object is what the in-game bug draws; the clone slots
            // are the fallback. Nothing rather than a guess.
            if (hud != null && hud.Available && hud.Value >= 0 && hud.Value <= 3) return hud;
            if (clone != null && clone.Available && clone.Value >= 0 && clone.Value <= 3) return clone;
            int successful = clone == null ? 0 : clone.SuccessfulReads;
            int configured = clone == null ? 0 : clone.ConfiguredCopies;
            return new RamReadResult(false, 0, successful, 0, configured);
        }

        private RamReadResult ReadHudPossession()
        {
            ObserveHudPossession();
            // Hold the last confirmed side through brief object churn - the
            // oriented objects vanish for a few reads around presentations -
            // but never across the bounded window, and the whole state dies
            // with the orientation in ResetScoreHudOrientation.
            if (hudPossessionPublished >= 0
                && DateTime.UtcNow - hudPossessionLastConfirmedUtc <= HudPossessionHoldWindow)
                return new RamReadResult(true, hudPossessionPublished, 1, 1, 1);
            return RamReadResult.Missing(0);
        }

        internal static RamReadResult SelectVerifiedPossession(
            RamReadResult hud, RamReadResult legacy, bool legacyVerified)
        {
            // The HUD flag is the proven source (probe game 2026-08-13). The
            // independently synchronized legacy record remains as the fallback
            // for the rare game where it exists and the HUD never bound.
            if (hud != null && hud.Available && hud.Value <= 1) return hud;
            if (legacy != null && legacy.Available && legacy.Value <= 1 && legacyVerified)
                return legacy;
            int successful = legacy == null ? 0 : legacy.SuccessfulReads;
            int configured = legacy == null ? 0 : legacy.ConfiguredCopies;
            return new RamReadResult(false, 0, successful, 0, configured);
        }

        private RamReadResult ReadTimeoutClonePossession()
        {
            List<long> home = CopyConfiguredAddresses("timeoutSlotTeamIdZero");
            List<long> away = CopyConfiguredAddresses("timeoutSlotTeamIdOther");
            List<long> possession = CopyConfiguredAddresses("timeoutCloneHomePossession");
            home.Sort();
            away.Sort();
            possession.Sort();
            if (!TimeoutClonePossessionAddressLayoutIsSafe(home, away, possession))
                return RamReadResult.Missing(possession.Count);
            try
            {
                int firstA = ReadSingleByte(possession[0]);
                int firstB = ReadSingleByte(possession[1]);
                int secondA = ReadSingleByte(possession[0]);
                int secondB = ReadSingleByte(possession[1]);
                if (!TimeoutCloneHomePossessionReadsAreSafe(
                    possession.Count, firstA, firstB, secondA, secondB))
                    return new RamReadResult(false, 0, 2, 0, possession.Count);
                return new RamReadResult(true,
                    AwayPossessionFromHomeFlag(firstA), 2, 2, possession.Count);
            }
            catch
            {
                return RamReadResult.Missing(possession.Count);
            }
        }

        private void InvalidateProfile(string reason)
        {
            bool newGameReset = String.Equals(reason, "game state moved backward or reset", StringComparison.Ordinal);
            if (newGameReset && !String.IsNullOrWhiteSpace(lastAwayTeamName)
                && !String.IsNullOrWhiteSpace(lastHomeTeamName))
            {
                retiredAwayTeamName = lastAwayTeamName;
                retiredHomeTeamName = lastHomeTeamName;
                retiredAwayTeamAddressSignature = AddressSignature(CopyConfiguredAddresses("awayTeamNameAscii"));
                retiredHomeTeamAddressSignature = AddressSignature(CopyConfiguredAddresses("homeTeamNameAscii"));
                rejectRetiredOrderedPair = true;
            }
            else if (!newGameReset)
            {
                retiredAwayTeamName = null;
                retiredHomeTeamName = null;
                retiredAwayTeamAddressSignature = null;
                retiredHomeTeamAddressSignature = null;
                rejectRetiredOrderedPair = false;
            }
            ClearTransitionPreviousSnapshot();
            resolvedProcessId = 0;
            confirmationProcessId = 0;
            confirmationPassCount = 0;
            healthFailureCount = 0;
            coreReadFailureCount = 0;
            nextAutoDiscoveryUtc = DateTime.UtcNow.AddMilliseconds(250);
            autoDiscoverySummary = reason;
            ClearMatchupFieldsAndCaches(true);
            if (profile == null) return;
            profile.ProcessId = 0;
            profile.ProcessStartUtcTicks = 0;
            try
            {
                profile.Save(profilePath);
                profileWriteTimeUtc = File.GetLastWriteTimeUtc(profilePath);
            }
            catch { }
        }

        private void PrepareRestoredMatchupState()
        {
            if (scanner.Process == null || restoredMatchupStatePreparedProcessId == scanner.Process.Id) return;
            restoredMatchupStatePreparedProcessId = scanner.Process.Id;
            // A surviving Frostbite process can retain readable role objects
            // from the prior game. Cached text equality is therefore not proof
            // of the current matchup. The restore branch discards the core too;
            // this reset also removes every side-bound field before discovery.
            ClearMatchupFieldsAndCaches(true);
        }

        private void BeginPendingMatchupTransition(bool forceNewEpoch = false)
        {
            if (!ShouldStartNewMatchupEpoch(matchupTransitionPending, forceNewEpoch)) return;
            if (!matchupTransitionPending)
            {
                transitionPreviousCoreSignature = ConfiguredCoreSignature();
                transitionPreviousAwayTeamName = lastAwayTeamName;
                transitionPreviousHomeTeamName = lastHomeTeamName;
                transitionPreviousAwayAddressSignature = AddressSignature(CopyConfiguredAddresses("awayTeamNameAscii"));
                transitionPreviousHomeAddressSignature = AddressSignature(CopyConfiguredAddresses("homeTeamNameAscii"));
            }
            ClearMatchupFieldsAndCaches(false);
        }

        internal static bool ShouldStartNewMatchupEpoch(bool transitionAlreadyPending, bool forceNewEpoch)
        {
            return !transitionAlreadyPending || forceNewEpoch;
        }

        private void ClearMatchupFieldsAndCaches(bool clearPublishedNames)
        {
            matchupGeneration++;
            restoredMatchupStatePreparedProcessId = scanner.Process == null ? 0 : scanner.Process.Id;
            if (clearPublishedNames)
            {
                lastAwayTeamName = null;
                lastHomeTeamName = null;
            }
            if (profile != null)
            {
                SetField("awayTeamNameAscii", new long[0]);
                SetField("homeTeamNameAscii", new long[0]);
                SetField("awayTeamKeyAscii", new long[0]);
                SetField("homeTeamKeyAscii", new long[0]);
                SetField("awayRank", new long[0]);
                SetField("homeRank", new long[0]);
                SetField("possessionAwayIsOne", new long[0]);
                SetField("timeoutCloneHomePossession", new long[0]);
                SetField("awayTimeouts", new long[0]);
                SetField("homeTimeouts", new long[0]);
                SetField("timeoutSlotTeamIdZero", new long[0]);
                SetField("timeoutSlotTeamIdOther", new long[0]);
                SetField("awayTeamAssetPoolBase", new long[0]);
                SetField("awayTeamAssetPoolLength", new long[0]);
                SetField("teamRoleAllocationBase", new long[0]);
                SetField("awayTeamRoleLabel", new long[0]);
                SetField("homeTeamRoleLabel", new long[0]);
                SetField("awayTeamRoleReference", new long[0]);
                SetField("homeTeamRoleReference", new long[0]);
                SetField("awayTeamRoleDescriptor", new long[0]);
                SetField("homeTeamRoleDescriptor", new long[0]);
                SetField("awayTeamRoleVector", new long[0]);
                SetField("homeTeamRoleVector", new long[0]);
                profile.SeedAwayTeamName = null;
                profile.SeedHomeTeamName = null;
            }
            lastAwayRank = -1;
            lastHomeRank = -1;
            lastAwayRankGeneration = -1;
            lastHomeRankGeneration = -1;
            teamKeyNames = null;
            lastAwayAssetResult = RamTextResult.Missing(0);
            nextAwayAssetScanUtc = DateTime.MinValue;
            ResetScoreHudOrientation();
            CancelScoreHudDiscovery();
            CancelTeamNameDiscovery();
            ClearMatchupCandidate();
            candidateDifferentCoreSignature = null;
            differentCoreConfirmations = 0;
            lastScoreHudDownDistance = null;
            lastScoreHudDownDistanceSeenUtc = DateTime.MinValue;
            scoreHudTransitionScanUntilUtc = DateTime.MinValue;
            scoreHudSpecialPending = false;
            scoreHudNumericResumeConfirmations = 0;
            nextScoreHudDelayedSpecialRetryUtc = DateTime.MinValue;
            scoreHudZeroDistanceActive = false;
            nextScoreHudZeroDistanceRetryUtc = DateTime.MinValue;
            scoreHudColdBaselinePending = false;
            scoreHudColdBaselineResumeConfirmations = 0;
            scoreHudColdBaselineObservedPlayClock = -1;
            scoreHudColdBaselinePlayClockResetSeen = false;
            scoreHudColdBaselinePlayClockEpochs = 0;
            scoreHudColdBaselineObservedGameClock = -1;
            scoreHudColdBaselineGameClockMoved = false;
            scoreHudColdBaselineEpochsAtLastGameClockChange = 0;
            scoreHudColdFreshScrimmageObserved = false;
            scoreHudExpectedNonScrimmageSpecial = ScoreHudExpectedNone;
            scoreHudTransitionQuarter = 0;
            scoreHudTransitionDown = -1;
            scoreHudTransitionDistance = -1;
            scoreHudTransitionObservedPlayClock = -1;
            scoreHudTransitionPlayClockResetSeen = false;
            scoreHudTransitionAllowInitialPlayClockEpoch = false;
            scoreHudTransitionPlayClockEpochs = 0;
            scoreHudTransitionObservedGameClock = -1;
            scoreHudTransitionGameClockMoved = false;
            scoreHudTransitionEpochsAtLastGameClockChange = 0;
            scoreHudExpectedSpecialObserved = false;
            scoreHudTransitionFreshScrimmageObserved = false;
            scoreHudTransitionFreshScrimmageEpoch = -1;
            scoreHudFreshKickoffObserved = false;
            scoreHudObservedCandidateStates.Clear();
            scoreHudCandidateActivationUtc.Clear();
            scoreHudCandidateSemanticChangeUtc.Clear();
            scoreHudTrustedZeroDistanceAddresses.Clear();
            scoreHudTrustedZeroDistanceDown = -1;
            scoreHudTransitionBaselineInitialized = false;
            scoreHudTransitionBaselineProcessId = 0;
            scoreHudTransitionBaselineDown = -1;
            scoreHudTransitionBaselineDistance = -1;
            lastScoreHudMessage = null;
            lastScoreHudMessageSeenUtc = DateTime.MinValue;
            lastConversionMessageId = 0;
            lastConversionMessageSeenUtc = DateTime.MinValue;
            matchupTransitionPending = true;
            ResetLogicalState();
        }

        private void CancelScoreHudDiscovery()
        {
            lock (scoreHudDiscoverySync)
            {
                scoreHudDiscoveryGeneration++;
                scoreHudDiscoveryRunning = false;
                scoreHudDiscoveryRequested = false;
                pendingScoreHudDiscovery = null;
            }
            nextScoreHudDiscoveryUtc = DateTime.MinValue;
        }

        private void CancelTeamNameDiscovery()
        {
            lock (teamNameDiscoverySync)
            {
                teamNameDiscoveryGeneration++;
                teamNameDiscoveryRunning = false;
                pendingTeamNameDiscovery = null;
                pendingTeamNameDiscoveryProcessId = 0;
                pendingTeamNameDiscoveryMatchupGeneration = 0;
            }
            nextTeamNameDiscoveryUtc = DateTime.MinValue;
        }

        private void ResetScoreHudOrientation()
        {
            orientedAwayScoreHudTeamId = -1;
            orientedHomeScoreHudTeamId = -1;
            orientedScoreHudMatchupGeneration = -1;
            pendingAwayScoreHudTeamId = -1;
            pendingHomeScoreHudTeamId = -1;
            pendingAwayScoreHudRank = -1;
            pendingHomeScoreHudRank = -1;
            pendingAwayScoreHudAddress = 0;
            pendingHomeScoreHudAddress = 0;
            scoreHudOrientationConfirmations = 0;
            // HUD possession is read from the oriented objects; it cannot
            // outlive the orientation that gave the flags their sides.
            hudPossessionPublished = -1;
            hudPossessionPending = -1;
            hudPossessionPendingCount = 0;
            hudPossessionLastConfirmedUtc = DateTime.MinValue;
            ResetHudTimeouts();
        }

        private void ResetHudTimeouts()
        {
            for (int side = 0; side < 2; side++)
            {
                hudTimeoutsPublished[side] = -1;
                hudTimeoutsPending[side] = -1;
                hudTimeoutsPendingCount[side] = 0;
                hudTimeoutsLastConfirmedUtc[side] = DateTime.MinValue;
            }
        }

        private void ClearMatchupCandidate()
        {
            candidateAwayTeamName = null;
            candidateHomeTeamName = null;
            candidateAwayTeamAddressSignature = null;
            candidateHomeTeamAddressSignature = null;
            teamNamePairConfirmations = 0;
        }

        internal static string AddressSignature(IEnumerable<long> addresses)
        {
            List<long> sorted = new List<long>();
            if (addresses != null) sorted.AddRange(addresses);
            sorted.Sort();
            List<string> values = new List<string>();
            for (int index = 0; index < sorted.Count; index++)
                values.Add(sorted[index].ToString("X", CultureInfo.InvariantCulture));
            return String.Join(",", values.ToArray());
        }

        internal static bool SameMatchupCandidate(string candidateAway, string candidateHome,
            string candidateAwayAddresses, string candidateHomeAddresses,
            string observedAway, string observedHome,
            string observedAwayAddresses, string observedHomeAddresses)
        {
            return SameMatchupCandidate(candidateAway, candidateHome,
                candidateAwayAddresses, candidateHomeAddresses,
                observedAway, observedHome, observedAwayAddresses, observedHomeAddresses, true);
        }

        internal static bool SameMatchupCandidate(string candidateAway, string candidateHome,
            string candidateAwayAddresses, string candidateHomeAddresses,
            string observedAway, string observedHome,
            string observedAwayAddresses, string observedHomeAddresses,
            bool requireAddressMatch)
        {
            if (!String.Equals(candidateAway, observedAway, StringComparison.OrdinalIgnoreCase)
                || !String.Equals(candidateHome, observedHome, StringComparison.OrdinalIgnoreCase))
                return false;
            // The addresses are corroboration, not the answer. When the pair came
            // from the pool fallback they are the addresses of duplicate copies of
            // the same text, and which copies are found - and in what order -
            // varies between sweeps. Demanding a byte-identical signature then
            // resets the confirmation count on every pass, so a pair that reads
            // correctly every single time is never confirmed and the matchup
            // transition never clears. Observed live: the finder returned
            // USC/Pittsburgh on every sweep while the exporter published neither,
            // and ranks, records and timeouts stayed blocked behind it.
            //
            // The names are what gets published, so agreeing on the names twice
            // is the check that actually matters.
            if (!requireAddressMatch) return true;
            return String.Equals(candidateAwayAddresses, observedAwayAddresses, StringComparison.Ordinal)
                && String.Equals(candidateHomeAddresses, observedHomeAddresses, StringComparison.Ordinal);
        }

        internal static bool AdvanceMatchupConfirmation(ref string candidateAway, ref string candidateHome,
            ref string candidateAwayAddresses, ref string candidateHomeAddresses, ref int confirmations,
            string observedAway, string observedHome,
            string observedAwayAddresses, string observedHomeAddresses)
        {
            return AdvanceMatchupConfirmation(ref candidateAway, ref candidateHome,
                ref candidateAwayAddresses, ref candidateHomeAddresses, ref confirmations,
                observedAway, observedHome, observedAwayAddresses, observedHomeAddresses, true);
        }

        internal static bool AdvanceMatchupConfirmation(ref string candidateAway, ref string candidateHome,
            ref string candidateAwayAddresses, ref string candidateHomeAddresses, ref int confirmations,
            string observedAway, string observedHome,
            string observedAwayAddresses, string observedHomeAddresses,
            bool requireAddressMatch)
        {
            if (SameMatchupCandidate(candidateAway, candidateHome,
                candidateAwayAddresses, candidateHomeAddresses,
                observedAway, observedHome, observedAwayAddresses, observedHomeAddresses,
                requireAddressMatch))
                confirmations++;
            else
            {
                candidateAway = observedAway;
                candidateHome = observedHome;
                confirmations = 1;
            }
            // Always track the latest addresses. The confirmation is about the
            // names; the field addresses installed afterwards should be the ones
            // most recently observed, not the ones from the first sighting.
            candidateAwayAddresses = observedAwayAddresses;
            candidateHomeAddresses = observedHomeAddresses;
            // A labelled pair still waits for a second agreeing sighting.
            //
            // A fallback pair publishes on the first one. Waiting for two was
            // costing the names entirely: something between sweeps kept resetting
            // the count, so a finder that returned USC/Pittsburgh correctly on
            // every single pass sat at "1/2" forever and published nothing, with
            // ranks, records and timeouts all blocked behind it.
            //
            // Publishing immediately is safe here for the same reason the clock
            // is safe: this pair is re-read on every sweep and the newest answer
            // always wins. The hanging-teams bug came from committing a name once
            // and then caching it forever; a value that keeps re-reading corrects
            // itself within seconds instead of hanging. Showing the right teams
            // now, with a brief chance of correcting them, beats showing "Away"
            // and "Home" for an entire game.
            return confirmations >= (requireAddressMatch ? 2 : 1);
        }

        private List<long> CopyConfiguredAddresses(string fieldName)
        {
            List<long> addresses;
            return profile != null && profile.Fields.TryGetValue(fieldName, out addresses) && addresses != null
                ? new List<long>(addresses) : new List<long>();
        }

        private long SingleConfiguredAddress(string fieldName)
        {
            List<long> values = CopyConfiguredAddresses(fieldName);
            return values.Count == 1 ? values[0] : 0;
        }

        private bool ConfiguredTeamRoleBindingIsValid()
        {
            long allocationBase = SingleConfiguredAddress("teamRoleAllocationBase");
            long awayLabel = SingleConfiguredAddress("awayTeamRoleLabel");
            long homeLabel = SingleConfiguredAddress("homeTeamRoleLabel");
            long awayReference = SingleConfiguredAddress("awayTeamRoleReference");
            long homeReference = SingleConfiguredAddress("homeTeamRoleReference");
            long awayDescriptor = SingleConfiguredAddress("awayTeamRoleDescriptor");
            long homeDescriptor = SingleConfiguredAddress("homeTeamRoleDescriptor");
            long awayVector = SingleConfiguredAddress("awayTeamRoleVector");
            long homeVector = SingleConfiguredAddress("homeTeamRoleVector");
            long awayName = SingleConfiguredAddress("awayTeamNameAscii");
            long homeName = SingleConfiguredAddress("homeTeamNameAscii");
            if (allocationBase == 0 || awayLabel == 0 || homeLabel == 0
                || awayReference == 0 || homeReference == 0
                || awayDescriptor == 0 || homeDescriptor == 0
                || awayVector == 0 || homeVector == 0
                || awayName == 0 || homeName == 0) return false;
            try
            {
                return scanner.LabeledTeamRoleBindingMatches(
                    allocationBase, awayLabel, homeLabel,
                    awayReference, homeReference,
                    awayDescriptor, homeDescriptor,
                    awayVector, homeVector,
                    awayName, homeName,
                    lastAwayTeamName, lastHomeTeamName);
            }
            catch { return false; }
        }

        private string ConfiguredCoreSignature()
        {
            List<long> quarter = CopyConfiguredAddresses("quarter");
            List<long> clock = CopyConfiguredAddresses("gameClockSeconds");
            if (quarter.Count == 0 || clock.Count == 0) return String.Empty;
            long delta = clock[0] - quarter[0];
            if (delta == 0x38) return (quarter[0] - 0xC8).ToString("X", CultureInfo.InvariantCulture) + ":W";
            if (delta == 0x08) return (quarter[0] - 0xEC).ToString("X", CultureInfo.InvariantCulture) + ":N";
            return AddressSignature(new long[] { quarter[0], clock[0] });
        }

        private static string DiscoveryCoreSignature(RamAutoDiscovery discovery)
        {
            return discovery == null || discovery.ScoreboardBlock == 0
                ? String.Empty
                : discovery.ScoreboardBlock.ToString("X", CultureInfo.InvariantCulture)
                    + (discovery.UsesWideScoreboardLayout ? ":W" : ":N");
        }

        private void ClearTransitionPreviousSnapshot()
        {
            transitionPreviousCoreSignature = null;
            transitionPreviousAwayTeamName = null;
            transitionPreviousHomeTeamName = null;
            transitionPreviousAwayAddressSignature = null;
            transitionPreviousHomeAddressSignature = null;
        }

        private bool StateProgressIsLogical(int quarter, int clock, int homeScore, int awayScore)
        {
            if (lastStateProcessId != scanner.Process.Id)
            {
                lastStateProcessId = scanner.Process.Id;
                lastQuarter = quarter;
                lastClock = clock;
                lastHomeScore = homeScore;
                lastAwayScore = awayScore;
                return true;
            }
            bool valid = quarter >= lastQuarter
                && homeScore >= lastHomeScore
                && awayScore >= lastAwayScore
                && (quarter != lastQuarter || clock <= lastClock + 30);
            if (valid)
            {
                lastQuarter = quarter;
                lastClock = clock;
                lastHomeScore = homeScore;
                lastAwayScore = awayScore;
            }
            return valid;
        }

        internal static bool MatchupRediscoveryIsRequired(
            bool nonScrimmageSpecialState, int coreReadFailureCount,
            bool teamBuffersChanged)
        {
            // A proven ordered-team change is a matchup boundary regardless of
            // PAT/Kickoff/OT presentation state. Only transient core absence is
            // suppressed while a non-scrimmage layer is expected.
            return teamBuffersChanged
                || (!nonScrimmageSpecialState && coreReadFailureCount >= 5);
        }

        private void ResetLogicalState()
        {
            lastStateProcessId = 0;
            lastQuarter = 0;
            lastClock = 0;
            lastHomeScore = 0;
            lastAwayScore = 0;
            lastAwayRank = -1;
            lastHomeRank = -1;
            hasStableDownDistance = false;
            stableDown = 0;
            stableDistance = 0;
            pendingDown = 0;
            pendingDistance = 0;
            pendingDownDistanceReads = 0;
        }

        private void StabilizeDownDistance(RamReadResult down, RamReadResult distance,
            out RamReadResult exportedDown, out RamReadResult exportedDistance)
        {
            if (down.Available && distance.Available)
            {
                if (!hasStableDownDistance)
                {
                    hasStableDownDistance = true;
                    stableDown = down.Value;
                    stableDistance = distance.Value;
                    pendingDownDistanceReads = 0;
                }
                else if (down.Value == stableDown && distance.Value == stableDistance)
                {
                    pendingDownDistanceReads = 0;
                }
                else
                {
                    if (down.Value == pendingDown && distance.Value == pendingDistance)
                        pendingDownDistanceReads++;
                    else
                    {
                        pendingDown = down.Value;
                        pendingDistance = distance.Value;
                        pendingDownDistanceReads = 1;
                    }
                    // Frostbite updates the two fields separately. Eight
                    // agreeing 100 ms reads hide that brief mixed state.
                    if (pendingDownDistanceReads >= 8)
                    {
                        stableDown = pendingDown;
                        stableDistance = pendingDistance;
                        pendingDownDistanceReads = 0;
                    }
                }
            }

            if (!hasStableDownDistance)
            {
                exportedDown = down;
                exportedDistance = distance;
                return;
            }
            exportedDown = new RamReadResult(true, stableDown,
                down.SuccessfulReads, 1, Math.Max(1, down.ConfiguredCopies));
            exportedDistance = new RamReadResult(true, stableDistance,
                distance.SuccessfulReads, 1, Math.Max(1, distance.ConfiguredCopies));
        }

        private bool CachedProfileIsReadable()
        {
            return Read("quarter", 1, 20).Available
                && Read("gameClockSeconds", 0, 3600).Available
                && Read("homeScore", 0, 255).Available
                && Read("awayScore", 0, 255).Available;
        }

        private long CurrentProcessStartUtcTicks()
        {
            try
            {
                return scanner.Process == null || scanner.Process.HasExited
                    ? 0 : scanner.Process.StartTime.ToUniversalTime().Ticks;
            }
            catch { return 0; }
        }

        private bool CurrentProcessIdentityMatchesProfile()
        {
            return profile != null && scanner.Process != null
                && SameProcessIdentity(profile.ProcessId, profile.ProcessStartUtcTicks,
                    scanner.Process.Id, attachedProcessStartUtcTicks);
        }

        internal static bool SameProcessIdentity(
            int cachedProcessId, long cachedStartUtcTicks, int currentProcessId, long currentStartUtcTicks)
        {
            return cachedProcessId > 0 && cachedProcessId == currentProcessId
                && cachedStartUtcTicks > 0 && currentStartUtcTicks > 0
                && cachedStartUtcTicks == currentStartUtcTicks;
        }

        private bool HasConfiguredField(string name)
        {
            List<long> addresses;
            return profile != null && profile.Fields.TryGetValue(name, out addresses)
                && addresses != null && addresses.Count > 0;
        }

        private void SaveCompleteProfileCache()
        {
            if (matchupTransitionPending || String.IsNullOrWhiteSpace(lastAwayTeamName)
                || String.IsNullOrWhiteSpace(lastHomeTeamName) || !CachedProfileIsReadable()) return;
            profile.SeedAwayTeamName = lastAwayTeamName;
            profile.SeedHomeTeamName = lastHomeTeamName;
            try
            {
                profile.Save(profilePath);
                profileWriteTimeUtc = File.GetLastWriteTimeUtc(profilePath);
            }
            catch
            {
                // A cache speeds up a restart but is never required for live reads.
            }
        }

        private void SetField(string name, IEnumerable<long> addresses)
        {
            List<long> values = new List<long>();
            if (addresses != null) values.AddRange(addresses);
            profile.Fields[name] = values;
        }

        private bool TeamNamesDifferFromScreen(LiveScoreboard screen)
        {
            if (screen == null || String.IsNullOrWhiteSpace(screen.AwayName) || String.IsNullOrWhiteSpace(screen.HomeName)) return false;
            if (String.IsNullOrWhiteSpace(lastAwayTeamName) || String.IsNullOrWhiteSpace(lastHomeTeamName)) return true;
            return !String.Equals(screen.AwayName.Trim(), lastAwayTeamName.Trim(), StringComparison.OrdinalIgnoreCase)
                || !String.Equals(screen.HomeName.Trim(), lastHomeTeamName.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        private void LoadProfileIfNeeded()
        {
            if (!File.Exists(profilePath))
            {
                // Keep an in-memory discovery candidate long enough to finish
                // its three confirmation reads before the first cache exists.
                if (profile == null || scanner.Process == null || profile.ProcessId != scanner.Process.Id)
                    profile = null;
                return;
            }
            DateTime changed = File.GetLastWriteTimeUtc(profilePath);
            if (profile != null && changed == profileWriteTimeUtc) return;
            profile = RamLiveProfile.Load(profilePath);
            profileWriteTimeUtc = changed;
            if (String.IsNullOrWhiteSpace(lastAwayTeamName)) lastAwayTeamName = profile.SeedAwayTeamName;
            if (String.IsNullOrWhiteSpace(lastHomeTeamName)) lastHomeTeamName = profile.SeedHomeTeamName;
        }

        private RamReadResult Read(string field, int minimum, int maximum)
        {
            List<long> addresses;
            if (!profile.Fields.TryGetValue(field, out addresses) || addresses.Count == 0)
                return RamReadResult.Missing();

            Dictionary<int, int> counts = new Dictionary<int, int>();
            int successfulReads = 0;
            for (int i = 0; i < addresses.Count; i++)
            {
                try
                {
                    int value = scanner.ReadInt32(addresses[i]);
                    if (value < minimum || value > maximum) continue;
                    successfulReads++;
                    int count;
                    counts.TryGetValue(value, out count);
                    counts[value] = count + 1;
                }
                catch { }
            }
            if (counts.Count == 0) return RamReadResult.Missing(addresses.Count);

            int bestValue = 0;
            int bestCount = -1;
            foreach (KeyValuePair<int, int> pair in counts)
            {
                if (pair.Value > bestCount)
                {
                    bestValue = pair.Key;
                    bestCount = pair.Value;
                }
            }
            return new RamReadResult(true, bestValue, successfulReads, bestCount, addresses.Count);
        }

        private RamTextResult ReadAscii(string field, int maximumLength)
        {
            List<long> addresses;
            if (!profile.Fields.TryGetValue(field, out addresses) || addresses.Count == 0)
                return RamTextResult.Missing(0);
            Dictionary<string, int> counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            int successfulReads = 0;
            for (int i = 0; i < addresses.Count; i++)
            {
                try
                {
                    string value = scanner.ReadAsciiString(addresses[i], maximumLength);
                    successfulReads++;
                    if (!LooksLikeTeamName(value)) continue;
                    int count;
                    counts.TryGetValue(value, out count);
                    counts[value] = count + 1;
                }
                catch { }
            }
            if (counts.Count == 0) return RamTextResult.Missing(addresses.Count, successfulReads);
            string best = null;
            int bestCount = -1;
            foreach (KeyValuePair<string, int> pair in counts)
            {
                if (pair.Value > bestCount)
                {
                    best = pair.Key;
                    bestCount = pair.Value;
                }
            }
            return new RamTextResult(true, best, successfulReads, bestCount, addresses.Count);
        }

        private RamTextResult ReadTeamName(string displayField, string keyField)
        {
            RamTextResult display = ReadAscii(displayField, 64);
            if (display.Available) return display;
            EnsureTeamKeyNames();
            List<long> addresses;
            if (!profile.Fields.TryGetValue(keyField, out addresses) || addresses.Count == 0)
                return display;
            Dictionary<string, int> counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            int successfulReads = 0;
            for (int i = 0; i < addresses.Count; i++)
            {
                try
                {
                    string key = scanner.ReadAsciiString(addresses[i], 24).ToUpperInvariant();
                    successfulReads++;
                    string name;
                    if (String.IsNullOrWhiteSpace(key) || !teamKeyNames.TryGetValue(key, out name)) continue;
                    int count;
                    counts.TryGetValue(name, out count);
                    counts[name] = count + 1;
                }
                catch { }
            }
            if (counts.Count == 0) return RamTextResult.Missing(addresses.Count, successfulReads);
            string best = null;
            int bestCount = -1;
            foreach (KeyValuePair<string, int> pair in counts)
            {
                if (pair.Value > bestCount)
                {
                    best = pair.Key;
                    bestCount = pair.Value;
                }
            }
            return new RamTextResult(true, best, successfulReads, bestCount, addresses.Count);
        }

        internal static RamTextResult CanonicalizeRoleTeamRead(
            RamTextResult current, string expectedCanonical)
        {
            if (current == null || !current.Available || String.IsNullOrWhiteSpace(expectedCanonical)
                || !MemoryScanner.RoleDisplayNameMatchesCanonical(current.Value, expectedCanonical))
                return current;
            return new RamTextResult(true, expectedCanonical, current.SuccessfulReads,
                current.AgreeingCopies, current.ConfiguredCopies);
        }

        private RamTextResult ReadAwayTeamAssetName()
        {
            if (DateTime.UtcNow < nextAwayAssetScanUtc) return lastAwayAssetResult;
            nextAwayAssetScanUtc = DateTime.UtcNow.AddMilliseconds(500);
            List<long> baseValues;
            List<long> lengthValues;
            if (!profile.Fields.TryGetValue("awayTeamAssetPoolBase", out baseValues) || baseValues.Count == 0
                || !profile.Fields.TryGetValue("awayTeamAssetPoolLength", out lengthValues) || lengthValues.Count == 0)
                return lastAwayAssetResult = RamTextResult.Missing(0);
            byte[] bytes;
            try { bytes = scanner.ReadBytes(baseValues[0], (int)lengthValues[0]); }
            catch { return lastAwayAssetResult = RamTextResult.Missing(1); }
            byte[] needle = System.Text.Encoding.ASCII.GetBytes("content/traditions/teams/");
            HashSet<string> slugs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; index <= bytes.Length - needle.Length; index++)
            {
                bool matches = true;
                for (int j = 0; j < needle.Length; j++)
                {
                    if (bytes[index + j] != needle[j]) { matches = false; break; }
                }
                if (!matches) continue;
                int start = index + needle.Length;
                int end = start;
                while (end < bytes.Length && end < start + 64)
                {
                    byte value = bytes[end];
                    if (!((value >= (byte)'a' && value <= (byte)'z') || value == (byte)'_' || value == (byte)'-')) break;
                    end++;
                }
                if (end > start && end < bytes.Length && bytes[end] == (byte)'/')
                    slugs.Add(System.Text.Encoding.ASCII.GetString(bytes, start, end - start));
            }
            if (!String.IsNullOrWhiteSpace(lastHomeTeamName)) slugs.Remove(NormalizeSlug(lastHomeTeamName));
            if (slugs.Count != 1) return lastAwayAssetResult = RamTextResult.Missing(1, 1);
            string slug = null;
            foreach (string value in slugs) slug = value;
            string name = ResolveTeamSlug(slug);
            return lastAwayAssetResult = new RamTextResult(true, name, 1, 1, 1);
        }

        private string ResolveTeamSlug(string slug)
        {
            EnsureTeamKeyNames();
            foreach (KeyValuePair<string, string> pair in teamKeyNames)
            {
                if (String.Equals(NormalizeSlug(pair.Value), slug, StringComparison.OrdinalIgnoreCase)) return pair.Value;
            }
            string[] pieces = (slug ?? String.Empty).Replace('-', '_').Split(new char[] { '_' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < pieces.Length; i++)
            {
                string piece = pieces[i];
                pieces[i] = piece.Length == 0 ? piece : Char.ToUpperInvariant(piece[0]) + piece.Substring(1).ToLowerInvariant();
            }
            return String.Join(" ", pieces);
        }

        private static string NormalizeSlug(string value)
        {
            // Must stay identical to MemoryScanner.NormalizeSlug: only
            // whitespace, hyphens and slashes split words; other punctuation
            // vanishes without splitting, matching the game's asset slugs
            // ("Texas A&M" -> texas_am, "N.C. State" -> nc_state).
            System.Text.StringBuilder result = new System.Text.StringBuilder();
            bool separator = false;
            string text = (value ?? String.Empty).ToLowerInvariant();
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (Char.IsLetterOrDigit(c))
                {
                    if (separator && result.Length > 0) result.Append('_');
                    result.Append(c);
                    separator = false;
                }
                else if (Char.IsWhiteSpace(c) || c == '-' || c == '/' || c == '_') separator = true;
            }
            return result.ToString();
        }

        private void EnsureTeamKeyNames()
        {
            if (teamKeyNames != null) return;
            teamKeyNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            List<long> baseValues;
            List<long> lengthValues;
            if (!profile.Fields.TryGetValue("teamCatalogBase", out baseValues) || baseValues.Count == 0
                || !profile.Fields.TryGetValue("teamCatalogLength", out lengthValues) || lengthValues.Count == 0) return;
            byte[] bytes;
            try { bytes = scanner.ReadBytes(baseValues[0], (int)lengthValues[0]); }
            catch { return; }
            for (int index = 0; index <= bytes.Length - 64; index++)
            {
                if (index > 0 && bytes[index - 1] != 0) continue;
                int keyEnd = index;
                while (keyEnd < bytes.Length && keyEnd < index + 17 && bytes[keyEnd] != 0) keyEnd++;
                if (keyEnd == index || keyEnd >= bytes.Length || keyEnd >= index + 17) continue;
                string key = System.Text.Encoding.ASCII.GetString(bytes, index, keyEnd - index);
                if (!LooksLikeTeamKey(key)) continue;
                bool padded = true;
                for (int i = keyEnd; i < index + 32; i++) if (bytes[i] != 0) { padded = false; break; }
                if (!padded) continue;
                int nameStart = index + 32;
                int nameEnd = nameStart;
                while (nameEnd < bytes.Length && nameEnd < nameStart + 32 && bytes[nameEnd] != 0) nameEnd++;
                if (nameEnd == nameStart || nameEnd >= bytes.Length || nameEnd >= nameStart + 32) continue;
                string name = System.Text.Encoding.ASCII.GetString(bytes, nameStart, nameEnd - nameStart);
                if (LooksLikeTeamName(name)) teamKeyNames[key] = name;
            }
        }

        private static bool LooksLikeTeamKey(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.Length < 2 || value.Length > 16) return false;
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (!(c >= 'A' && c <= 'Z') && !Char.IsDigit(c) && c != '&' && c != '.' && c != '-' && c != ' ') return false;
            }
            return true;
        }

        private static bool LooksLikeTeamName(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.Length < 2 || value.Length > 48) return false;
            bool hasLetter = false;
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (Char.IsLetter(c)) hasLetter = true;
                else if (!(c == ' ' || c == '.' || c == '-' || c == '\'' || c == '&')) return false;
            }
            return hasLetter;
        }

        private static Dictionary<string, object> TeamNameDictionary(string cachedValue, RamTextResult current)
        {
            return new Dictionary<string, object>
            {
                { "available", !String.IsNullOrWhiteSpace(cachedValue) },
                { "value", cachedValue },
                { "currentBufferAvailable", current.Available },
                { "source", current.Available ? "ram" : (!String.IsNullOrWhiteSpace(cachedValue) ? "ram-cached" : "missing") },
                { "successfulReads", current.SuccessfulReads },
                { "agreeingCopies", current.AgreeingCopies },
                { "configuredCopies", current.ConfiguredCopies }
            };
        }

        private static Dictionary<string, object> ScreenSnapshot(LiveScoreboard screen)
        {
            if (screen == null) return null;
            return new Dictionary<string, object>
            {
                { "updatedAt", screen.UpdatedAt },
                { "awayName", screen.AwayName },
                { "homeName", screen.HomeName },
                { "awayScore", screen.AwayScore },
                { "homeScore", screen.HomeScore },
                { "awayTimeouts", screen.AwayTimeouts },
                { "homeTimeouts", screen.HomeTimeouts },
                { "quarter", screen.Quarter },
                { "gameClock", screen.GameClock },
                { "playClock", screen.PlayClock },
                { "awayPossession", screen.AwayPossession },
                { "homePossession", screen.HomePossession }
            };
        }

        // MADDEN RESEARCH (never runs for CFB27). While a Madden game is
        // live, hunt for the team objects and the team catalog in the
        // background, self-seeded with the reader's OWN live score - no
        // tester input, no pausing, non-zero values guaranteed mid-game.
        // Results append to madden-hunt.jsonl next to the live export, which
        // the app's Export Test Package picks up. Read-only, its own scanner
        // handle, and hard-capped so a session logs a few rounds at most.
        private System.Threading.Thread maddenResearchThread;
        private volatile int maddenLiveAwayScore = -1;
        private volatile int maddenLiveHomeScore = -1;
        private volatile int maddenLiveQuarter = -1;
        private volatile int maddenLiveClock = -1;
        private volatile bool maddenNicknameScanDone;
        private int maddenResearchRounds;
        private static readonly string[] NflNicknames = new string[] {
            "Cardinals", "Falcons", "Ravens", "Bills", "Panthers", "Bears",
            "Bengals", "Browns", "Cowboys", "Broncos", "Lions", "Packers",
            "Texans", "Colts", "Jaguars", "Chiefs", "Raiders", "Chargers",
            "Rams", "Dolphins", "Vikings", "Patriots", "Saints", "Giants",
            "Jets", "Eagles", "Steelers", "49ers", "Seahawks", "Buccaneers",
            "Titans", "Commanders",
            // Cities/regions: the scorebug-facing catalog likely stores the
            // display name ("Arizona") separately from the nickname row that
            // round 3 found (the stadium table at stride 0xD4).
            "Arizona", "Atlanta", "Baltimore", "Buffalo", "Carolina",
            "Chicago", "Cincinnati", "Cleveland", "Dallas", "Denver",
            "Detroit", "Green Bay", "Houston", "Indianapolis", "Jacksonville",
            "Kansas City", "Las Vegas", "Los Angeles", "Miami", "Minnesota",
            "New England", "New Orleans", "New York", "Philadelphia",
            "Pittsburgh", "San Francisco", "Seattle", "Tampa Bay",
            "Tennessee", "Washington" };

        private void MaybeStartMaddenResearch(string screenJsonPath)
        {
            if (GameProfile.Key != "madden27") return;
            if (maddenResearchThread != null && maddenResearchThread.IsAlive) return;
            int processId = scanner.Process != null ? scanner.Process.Id : 0;
            if (processId == 0) return;
            string outputFolder = Path.GetDirectoryName(OutputPath(screenJsonPath));
            maddenResearchThread = new System.Threading.Thread(delegate ()
            {
                RunMaddenResearchLoop(processId, outputFolder);
            });
            maddenResearchThread.IsBackground = true;
            maddenResearchThread.Start();
        }

        private void RunMaddenResearchLoop(int processId, string outputFolder)
        {
            string outputPath = Path.Combine(outputFolder, "madden-hunt.jsonl");
            System.Web.Script.Serialization.JavaScriptSerializer serializer =
                new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
            while (maddenResearchRounds < 12)
            {
                System.Threading.Thread.Sleep(60000);
                try
                {
                    if (scanner.Process == null || scanner.Process.HasExited
                        || scanner.Process.Id != processId) return;
                    int awayScore = maddenLiveAwayScore;
                    int homeScore = maddenLiveHomeScore;
                    // Zero-zero swamps the hunt with coincidences; wait for points.
                    if (awayScore < 0 || homeScore < 0 || awayScore + homeScore == 0) continue;
                    maddenResearchRounds++;
                    Dictionary<string, object> entry = new Dictionary<string, object>
                    {
                        { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                        { "round", maddenResearchRounds },
                        { "awayScore", awayScore },
                        { "homeScore", homeScore },
                        // Quarter/clock anchor each round so timeout burns and
                        // half transitions can be located in the dumps later.
                        { "quarter", maddenLiveQuarter },
                        { "clockSeconds", maddenLiveClock }
                    };
                    using (MemoryScanner research = new MemoryScanner())
                    {
                        research.Attach(Process.GetProcessById(processId));
                        List<string> samples = new List<string>();
                        List<string> matchDumps = new List<string>();
                        Dictionary<string, int> histogram = research.HuntScoreHudTeamObjects(
                            awayScore, homeScore, -1, -1, 24, samples,
                            // Round 6 identified 0xA9CD6B0 as player-gear objects
                            // (a decoy that hogged every dump slot) - dump only
                            // the score-tracking pair now.
                            new long[] { 0xE88ACD8L, 0xAB58298L }, matchDumps);
                        List<KeyValuePair<string, int>> ranked = new List<KeyValuePair<string, int>>(histogram);
                        ranked.Sort(delegate (KeyValuePair<string, int> left, KeyValuePair<string, int> right) { return right.Value.CompareTo(left.Value); });
                        Dictionary<string, int> top = new Dictionary<string, int>(StringComparer.Ordinal);
                        for (int index = 0; index < ranked.Count && index < 200; index++) top[ranked[index].Key] = ranked[index].Value;
                        entry["teamObjectCandidates"] = top;
                        entry["samples"] = samples;
                        entry["matchDumps"] = matchDumps;
                        // Round-4 result: these vtable offsets tracked the away
                        // score through six rounds (7->35) - the prime team-
                        // object candidates. Dump their live instances in full,
                        // including any strings they point at, so the layout
                        // (score/timeouts/wins/teamId/name pointer) can be read
                        // out and hard-bound.
                        long researchModuleBase = 0;
                        try { researchModuleBase = Process.GetProcessById(processId).MainModule.BaseAddress.ToInt64(); } catch { }
                        if (researchModuleBase != 0)
                        {
                            long[] candidateOffsets = new long[] { 0xE88ACD8L, 0xAB58298L, 0xA9CD6B0L, 0xAA14580L };
                            long[] vtables = new long[candidateOffsets.Length];
                            for (int i = 0; i < candidateOffsets.Length; i++) vtables[i] = researchModuleBase + candidateOffsets[i];
                            Dictionary<long, List<long>> refs = research.FindPrivateInt64ReferencesBelow4G(vtables, 10);
                            // v1.4.127: hand the prime team-object instances
                            // (the score-tracking vtable pair, indices 0-1) to
                            // the 150 ms timeout watcher on the export thread.
                            List<long> primeInstances = new List<long>();
                            for (int i = 0; i < 2 && i < vtables.Length; i++)
                            {
                                List<long> found;
                                if (!refs.TryGetValue(vtables[i], out found) || found == null) continue;
                                foreach (long instanceAddress in found)
                                {
                                    if (primeInstances.Count >= 16) break;
                                    if (!primeInstances.Contains(instanceAddress)) primeInstances.Add(instanceAddress);
                                }
                            }
                            if (primeInstances.Count > 0)
                                lock (maddenTeamObjectLock) { maddenTeamObjectInstances = primeInstances; }
                            List<string> dumps = new List<string>();
                            for (int i = 0; i < vtables.Length; i++)
                            {
                                List<long> addresses;
                                if (!refs.TryGetValue(vtables[i], out addresses) || addresses == null) continue;
                                int taken = 0;
                                foreach (long address in addresses)
                                {
                                    if (taken >= 6 || dumps.Count >= 24) break;
                                    try
                                    {
                                        byte[] bytes = research.ReadBytes(address, 0x140);
                                        System.Text.StringBuilder line = new System.Text.StringBuilder();
                                        line.Append("0x").Append(candidateOffsets[i].ToString("X", CultureInfo.InvariantCulture));
                                        line.Append(" @0x").Append(address.ToString("X", CultureInfo.InvariantCulture)).Append(" ints=");
                                        for (int o = 0; o + 4 <= bytes.Length; o += 4)
                                        {
                                            if (o > 0) line.Append(",");
                                            line.Append(BitConverter.ToInt32(bytes, o));
                                        }
                                        line.Append(" strings=");
                                        for (int o = 0; o + 8 <= bytes.Length; o += 8)
                                        {
                                            long pointer = BitConverter.ToInt64(bytes, o);
                                            if (pointer < 0x10000 || pointer >= 0x100000000L) continue;
                                            string text = null;
                                            try { text = research.ReadAsciiString(pointer, 48); } catch { }
                                            if (String.IsNullOrWhiteSpace(text) || text.Trim().Length < 3) continue;
                                            line.Append("+").Append(o.ToString(CultureInfo.InvariantCulture))
                                                .Append("='").Append(text.Trim()).Append("' ");
                                        }
                                        dumps.Add(line.ToString());
                                        taken++;
                                    }
                                    catch { }
                                }
                            }
                            entry["targetedDumps"] = dumps;
                        }
                        if (!maddenNicknameScanDone)
                        {
                            maddenNicknameScanDone = true;
                            List<string> targets = new List<string>();
                            foreach (string nickname in NflNicknames)
                            {
                                targets.Add(nickname);
                                targets.Add(nickname.ToUpperInvariant());
                            }
                            Dictionary<string, List<long>> hits = research.FindAsciiTextsPrivateBelow4G(targets.ToArray(), 8);
                            Dictionary<string, object> nameReport = new Dictionary<string, object>();
                            List<string> contexts = new List<string>();
                            foreach (KeyValuePair<string, List<long>> pair in hits)
                            {
                                List<string> addresses = new List<string>();
                                foreach (long address in pair.Value)
                                {
                                    addresses.Add("0x" + address.ToString("X", CultureInfo.InvariantCulture));
                                    if (contexts.Count >= 64) continue;
                                    try
                                    {
                                        byte[] context = research.ReadBytes(address - 0x80, 0x180);
                                        System.Text.StringBuilder line = new System.Text.StringBuilder();
                                        line.Append("0x").Append((address - 0x80).ToString("X", CultureInfo.InvariantCulture)).Append(" ");
                                        foreach (byte b in context) line.Append(b >= 32 && b < 127 ? (char)b : '.');
                                        contexts.Add(line.ToString());
                                    }
                                    catch { }
                                }
                                nameReport[pair.Key] = addresses;
                            }
                            entry["nicknameHits"] = nameReport;
                            entry["nicknameContexts"] = contexts;
                        }
                    }
                    File.AppendAllText(outputPath, serializer.Serialize(entry) + Environment.NewLine);
                }
                catch { /* research only; the live export must never notice */ }
            }
        }

        private string MaddenNoteLiveValues(RamReadResult awayScore, RamReadResult homeScore, string screenJsonPath)
        {
            if (GameProfile.Key == "madden27")
            {
                if (awayScore != null && awayScore.Available) maddenLiveAwayScore = awayScore.Value;
                if (homeScore != null && homeScore.Available) maddenLiveHomeScore = homeScore.Value;
                try
                {
                    RamReadResult quarter = Read("quarter", 1, 20);
                    if (quarter.Available) maddenLiveQuarter = quarter.Value;
                    RamReadResult clock = Read("gameClockSeconds", 0, 3600);
                    if (clock.Available) maddenLiveClock = clock.Value;
                }
                catch { }
                MaybeStartMaddenResearch(screenJsonPath);
            }
            return "RAM export LIVE: {0} {1} | play {2} | {3} | possession {4} | timeouts away {5}, home {6} | {7}";
        }

        private readonly HashSet<long> scoreHudTextAnchors = new HashSet<long>();
        private DateTime nextTextFastScanUtc = DateTime.MinValue;

        // --- ScoreHud offset re-derivation after a game patch -------------
        // A title update moves the vtable cluster (.rdata) and the typeinfo
        // statics (.data); every ScoreHud read then fails silently while the
        // pattern-scanned core keeps working. When three consecutive sweeps
        // come back empty during live play, hunt the down-distance object by
        // its FIELD CONTENT (core down/distance + its own "1st & 10" text),
        // read the new vtable/typeinfo off the found object, and shift the
        // whole family by the two deltas. Fail closed: an ambiguous hunt
        // changes nothing, and a wrong shift cannot publish garbage because
        // every reader still demands vtable AND typeinfo agree per object.
        private int consecutiveEmptyScoreHudSweeps;
        private bool scoreHudRebaseDone;
        private bool scoreHudRebaseApplied;
        private bool scoreHudRebaseVerifiedLogged;
        private bool scoreHudRebaseRunning;
        private int scoreHudRebaseHuntCount;
        private DateTime nextOffsetsHeartbeatUtc = DateTime.MinValue;
        private DateTime nextScoreHudRebaseAttemptUtc = DateTime.MinValue;
        private readonly object scoreHudRebaseSync = new object();
        private List<ScoreHudRebaseCandidate> pendingScoreHudRebase;
        private int pendingScoreHudRebaseDown;
        private int pendingScoreHudRebaseDistance;
        private string scoreHudRebaseSummary;
        private long lastWeakRebaseVtableOffset;
        private long lastWeakRebaseTypeInfoOffset;
        // The rebase is persisted so a reader restart applies it instantly -
        // without this, every restart needed two corroborating hunts during
        // live play before flags or any banner worked again (the 2026-08-20
        // evening regression). Keyed to the exe so the NEXT patch invalidates.
        private bool scoreHudRebaseCacheChecked;
        private bool scoreHudRebaseFromCache;
        private long appliedRebaseVtableDelta;
        private long appliedRebaseTypeInfoDelta;

        private string ScoreHudRebaseCachePath()
        {
            string folder = Path.GetDirectoryName(OutputPath(probeOutputSeedPath));
            return Path.Combine(folder, "scorehud-rebase-cache.json");
        }

        private void LoadScoreHudRebaseCache()
        {
            scoreHudRebaseCacheChecked = true;
            try
            {
                string path = ScoreHudRebaseCachePath();
                if (!File.Exists(path)) return;
                System.Web.Script.Serialization.JavaScriptSerializer serializer =
                    new System.Web.Script.Serialization.JavaScriptSerializer();
                Dictionary<string, object> data =
                    serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                long vtableDelta = Convert.ToInt64(data["vtableDelta"], CultureInfo.InvariantCulture);
                long typeInfoDelta = Convert.ToInt64(data["typeInfoDelta"], CultureInfo.InvariantCulture);
                long exeTicks = Convert.ToInt64(data["exeWriteUtcTicks"], CultureInfo.InvariantCulture);
                long moduleSize = Convert.ToInt64(data["moduleSize"], CultureInfo.InvariantCulture);
                ProcessModule module = scanner.Process.MainModule;
                if (File.GetLastWriteTimeUtc(module.FileName).Ticks != exeTicks
                    || module.ModuleMemorySize != moduleSize)
                {
                    // A newer patch than the cached one: stale, start fresh.
                    try { File.Delete(path); } catch { }
                    LogScoreHudRebase("cache-stale", "Cached rebase is for a different game build; deleted.");
                    return;
                }
                GameProfile.ApplyScoreHudRebase(vtableDelta, typeInfoDelta);
                appliedRebaseVtableDelta = vtableDelta;
                appliedRebaseTypeInfoDelta = typeInfoDelta;
                scoreHudRebaseDone = true;
                scoreHudRebaseApplied = true;
                scoreHudRebaseFromCache = true;
                scoreHudRebaseSummary = "vtables "
                    + (vtableDelta >= 0 ? "+" : "-") + "0x" + Math.Abs(vtableDelta).ToString("X", CultureInfo.InvariantCulture)
                    + ", typeinfo "
                    + (typeInfoDelta >= 0 ? "+" : "-") + "0x" + Math.Abs(typeInfoDelta).ToString("X", CultureInfo.InvariantCulture)
                    + " (cached)";
                LogScoreHudRebase("cache-applied", "Cached rebase applied at startup: " + scoreHudRebaseSummary + ".");
            }
            catch { }
        }

        private void SaveScoreHudRebaseCache(long vtableDelta, long typeInfoDelta)
        {
            try
            {
                ProcessModule module = scanner.Process.MainModule;
                System.Web.Script.Serialization.JavaScriptSerializer serializer =
                    new System.Web.Script.Serialization.JavaScriptSerializer();
                Dictionary<string, object> data = new Dictionary<string, object>
                {
                    { "vtableDelta", vtableDelta },
                    { "typeInfoDelta", typeInfoDelta },
                    { "exeWriteUtcTicks", File.GetLastWriteTimeUtc(module.FileName).Ticks },
                    { "moduleSize", (long)module.ModuleMemorySize },
                    { "savedAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }
                };
                File.WriteAllText(ScoreHudRebaseCachePath(), serializer.Serialize(data));
            }
            catch { }
        }

        private void InvalidateScoreHudRebaseCache()
        {
            // Cached deltas that no longer verify (yet another patch, or a
            // bad save): undo them, delete the cache, let the hunts re-derive.
            GameProfile.ApplyScoreHudRebase(-appliedRebaseVtableDelta, -appliedRebaseTypeInfoDelta);
            appliedRebaseVtableDelta = 0;
            appliedRebaseTypeInfoDelta = 0;
            scoreHudRebaseDone = false;
            scoreHudRebaseApplied = false;
            scoreHudRebaseFromCache = false;
            scoreHudRebaseSummary = null;
            try { File.Delete(ScoreHudRebaseCachePath()); } catch { }
            LogScoreHudRebase("cache-invalidated", "Cached rebase never verified against live objects; reverted and re-hunting.");
        }

        private void LogScoreHudRebase(string stage, string detail)
        {
            try
            {
                Dictionary<string, object> entry = new Dictionary<string, object>
                {
                    { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "stage", stage },
                    { "detail", detail }
                };
                AppendProbeLine(probeOutputSeedPath, "rebase-probe.jsonl", entry);
            }
            catch { }
        }

        // --- Play-pick kick length: RESEARCH probe ------------------------
        // The requirement is the kick distance AT PLAY SELECTION. Proven so
        // far (2026-08-20): the scoreboard block does not hold it until the
        // snap, and the play tile's "104 Yd FG" is glyph-indexed - a full
        // memory scan during a live 104-yard lineup found NO readable text.
        // But the NUMBERS live in pooled objects (104 beside 87 yards-to-goal
        // and beside yard line 13). Log every such pair during play; the
        // recurring fixed-offset template across a few kicks identifies the
        // slot to READ pre-snap. Log-only - fail closed until proven.
        private DateTime nextPlayCallFgScanUtc = DateTime.MinValue;
        private bool playCallFgScanRunning;
        private readonly object playCallFgSync = new object();
        private List<string> pendingPlayCallFgTexts;
        private int pendingFgPairDown;
        private int pendingFgPairKnown;
        private int playCallFgProbeEntries;
        private int pendingKickPairScanDistance;
        private long lastFgBannerAddress;
        private DateTime fgBannerFirstSeenUtc = DateTime.MinValue;
        private double lastPreciseSlotSample = double.NaN;
        private int fgDivergenceStreak;
        private int lastDistanceForStreak = -1;
        private int fgLatchProbeEntries;

        private void RefreshPlayCallFieldGoalText(int downValue)
        {
            if (GameProfile.Key != "cfb27") return;
            List<string> completed = null;
            lock (playCallFgSync)
            {
                if (pendingPlayCallFgTexts != null)
                {
                    completed = pendingPlayCallFgTexts;
                    pendingPlayCallFgTexts = null;
                }
            }
            if (completed != null && completed.Count > 0 && playCallFgProbeEntries < 500)
            {
                playCallFgProbeEntries++;
                try
                {
                    AppendProbeLine(probeOutputSeedPath, "fgpick-probe.jsonl",
                        new Dictionary<string, object>
                        {
                            { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                            { "down", pendingFgPairDown },
                            { "knownDistance", pendingFgPairKnown },
                            { "pairs", completed }
                        });
                }
                catch { }
            }
            // TARGETED-ONLY (2026-08-21): the generic every-down full-memory
            // sampler is RETIRED - a multi-GB sweep every few seconds during
            // play correlates with three game crashes tonight. Only a fresh
            // kick latch (rare, once per kick) triggers a scan now.
            int targeted = pendingKickPairScanDistance;
            if (targeted <= 0) return;
            if (playCallFgScanRunning) return;
            pendingKickPairScanDistance = 0;
            // 5 s, not 2: the scan now covers all sub-4GB private memory
            // (the pool region moves per match), which is a heavier sweep.
            nextPlayCallFgScanUtc = DateTime.UtcNow.AddSeconds(5);
            if (scanner.Process == null || scanner.Process.HasExited) return;
            int processId = scanner.Process.Id;
            int scanDown = downValue;
            playCallFgScanRunning = true;
            ThreadPool.QueueUserWorkItem(delegate
            {
                List<string> texts = null;
                try
                {
                    Process game = Process.GetProcessById(processId);
                    using (MemoryScanner backgroundScanner = new MemoryScanner())
                    {
                        backgroundScanner.Attach(game);
                        texts = backgroundScanner.FindKickDistancePairs(targeted, CancellationToken.None);
                    }
                }
                catch { }
                lock (playCallFgSync)
                {
                    pendingPlayCallFgTexts = texts != null ? texts : new List<string>();
                    pendingFgPairDown = scanDown;
                    pendingFgPairKnown = targeted;
                }
                playCallFgScanRunning = false;
            });
        }

        // --- Stat-table hunt (toward always-on per-player stats) ----------
        private bool statTupleHuntRunning;
        private DateTime nextStatTupleHuntUtc = DateTime.MinValue;
        private int statTupleHuntCount;
        // Banner-confirmed live-row tracking (the safe, self-contained path
        // to always-on player stats). Every stat banner is ground truth: the
        // first banner for a player scatters candidates (int16 tuple hits);
        // each LATER banner for the same player re-reads the candidates -
        // only the real accumulator row shows the NEW numbers at the same
        // spot. Confirmed rows are live per-player stats, no pausing, no
        // external scans, no user involvement.
        private sealed class StatRowCandidate
        {
            public long Address;
            public int DeltaB;
            public int PlayerId;
            public int Confirmed;
            public int Failed;
            public string Label;
            public int LastA;
            public int LastB;
            public int DriftEvents;
        }

        private readonly object statTableWatchSync = new object();
        private readonly List<StatRowCandidate> statTableWatch = new List<StatRowCandidate>();
        private readonly Dictionary<int, string> identityNames = new Dictionary<int, string>();

        // Returns true when an existing candidate for this player already
        // holds the new banner's numbers - the live row is confirmed and the
        // scan is unnecessary. Stale copies (old numbers) are dropped after
        // two misses so the watch list stays honest.
        private readonly HashSet<long> confirmedNeighborhoodDumped = new HashSet<long>();

        private bool CheckStatRowCandidates(int playerId, int first, int second)
        {
            bool confirmedAny = false;
            List<long> newlyConfirmed = new List<long>();
            lock (statTableWatchSync)
            {
                for (int index = statTableWatch.Count - 1; index >= 0; index--)
                {
                    StatRowCandidate candidate = statTableWatch[index];
                    if (candidate.PlayerId != playerId) continue;
                    int a, b;
                    try
                    {
                        byte[] bytes = scanner.ReadBytes(candidate.Address, candidate.DeltaB + 2);
                        a = BitConverter.ToInt16(bytes, 0);
                        b = BitConverter.ToInt16(bytes, candidate.DeltaB);
                    }
                    catch { statTableWatch.RemoveAt(index); continue; }
                    if (a == first && b == second)
                    {
                        if (candidate.Confirmed == 0) newlyConfirmed.Add(candidate.Address);
                        candidate.Confirmed++;
                        candidate.Failed = 0;
                        confirmedAny = true;
                    }
                    else if (candidate.Confirmed == 0 && ++candidate.Failed >= 2)
                    {
                        statTableWatch.RemoveAt(index);
                    }
                }
            }
            // A first confirmation is the map to the FULL roster table: dump
            // the row's neighborhood once so the record stride (and with it
            // every other player's row) can be derived offline.
            foreach (long address in newlyConfirmed)
                DumpConfirmedNeighborhood(address, playerId, first, second);
            return confirmedAny;
        }

        private void DumpConfirmedNeighborhood(long address, int playerId, int first, int second)
        {
            if (!confirmedNeighborhoodDumped.Add(address)) return;
            if (confirmedNeighborhoodDumped.Count > 24) return;
            try
            {
                byte[] around = scanner.ReadBytes(address - 0x480, 0x900);
                List<int> values = new List<int>();
                for (int offset = 0; offset + 2 <= around.Length; offset += 2)
                    values.Add(BitConverter.ToInt16(around, offset));
                AppendProbeLine(probeOutputSeedPath, "stattable-probe.jsonl",
                    new Dictionary<string, object>
                    {
                        { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                        { "stage", "confirmed-neighborhood" },
                        { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                        { "playerId", playerId }, { "first", first }, { "second", second },
                        { "int16s", values }
                    });
            }
            catch { }
        }

        // DRIFT CONFIRMATION (2026-08-21): no second pop-up needed. The live
        // accumulator row is the one whose values MOVE LIKE A STAT while the
        // player plays - a carry adds 0-4 to the count and a sane yardage
        // step; frozen copies never move, and junk moves implausibly. Two
        // plausible steps confirm; one implausible step disqualifies.
        internal static bool StatStepIsPlausible(int fromA, int toA, int fromB, int toB)
        {
            int da = toA - fromA;
            int db = toB - fromB;
            if (da < 0 || da > 4) return false;
            if (da == 0) return db == 0;
            return db >= -20 && db <= 99;
        }

        private List<Dictionary<string, object>> StatTableWatchRows()
        {
            List<StatRowCandidate> watched;
            lock (statTableWatchSync) watched = new List<StatRowCandidate>(statTableWatch);
            List<Dictionary<string, object>> rows = new List<Dictionary<string, object>>();
            foreach (StatRowCandidate candidate in watched)
            {
                try
                {
                    byte[] bytes = scanner.ReadBytes(candidate.Address, 0x30);
                    List<int> values = new List<int>();
                    for (int offset = 0; offset + 2 <= bytes.Length; offset += 2)
                        values.Add(BitConverter.ToInt16(bytes, offset));
                    string name;
                    identityNames.TryGetValue(candidate.PlayerId, out name);
                    int liveA = values.Count > 0 ? values[0] : 0;
                    int liveB = candidate.DeltaB / 2 < values.Count ? values[candidate.DeltaB / 2] : 0;
                    if (liveA != candidate.LastA || liveB != candidate.LastB)
                    {
                        if (StatStepIsPlausible(candidate.LastA, liveA, candidate.LastB, liveB))
                        {
                            candidate.DriftEvents++;
                            if (candidate.DriftEvents >= 2 && candidate.Confirmed == 0)
                            {
                                candidate.Confirmed = 1;
                                // Drift confirmations must feed the roster
                                // research too (they bypassed the dump,
                                // 2026-08-21 - a whole game's confirmations
                                // produced zero neighborhood captures).
                                try { DumpConfirmedNeighborhood(candidate.Address, candidate.PlayerId, liveA, liveB); } catch { }
                            }
                        }
                        else if (candidate.Confirmed == 0)
                        {
                            lock (statTableWatchSync) statTableWatch.Remove(candidate);
                            continue;
                        }
                        candidate.LastA = liveA;
                        candidate.LastB = liveB;
                    }
                    rows.Add(new Dictionary<string, object>
                    {
                        { "address", "0x" + candidate.Address.ToString("X", CultureInfo.InvariantCulture) },
                        { "playerId", candidate.PlayerId },
                        { "player", name },
                        { "label", candidate.Label },
                        { "confirmed", candidate.Confirmed },
                        { "liveA", liveA }, { "liveB", liveB },
                        { "values", values }
                    });
                }
                catch { }
            }
            // Confirmed rows first - they are the real ones.
            rows.Sort(delegate(Dictionary<string, object> left, Dictionary<string, object> right)
            {
                return ((int)right["confirmed"]).CompareTo((int)left["confirmed"]);
            });
            return rows;
        }
        // The stat objects' own PlayerId field is useless (reads 0/1 live,
        // 2026-08-20) - the real roster id rides in the identity tokens
        // ("GlassKourdey_28851") the game shows alongside the stat banner.
        private int lastIdentityTokenId;
        private DateTime lastIdentityTokenUtc = DateTime.MinValue;

        private void NoteIdentityToken(string text)
        {
            System.Text.RegularExpressions.Match match =
                System.Text.RegularExpressions.Regex.Match(text ?? "", "^([A-Za-z.'-]+)_([0-9]{3,7})$");
            if (!match.Success) return;
            lastIdentityTokenId = Int32.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
            lastIdentityTokenUtc = DateTime.UtcNow;
            if (identityNames.Count < 300) identityNames[lastIdentityTokenId] = match.Groups[1].Value;
        }

        private void MaybeHuntStatTuple(string text, int playerId)
        {
            if (GameProfile.Key != "cfb27") return;
            try { NoteIdentityToken(text); } catch { }
            // The id is the discriminator that keeps small tuples like
            // (4, 60, 1) from matching half the heap. The object's own field
            // is dead, so borrow the freshest identity token - the name plate
            // the game shows with the stat line.
            if (playerId <= 100
                && lastIdentityTokenId > 100
                && DateTime.UtcNow - lastIdentityTokenUtc <= TimeSpan.FromSeconds(15))
                playerId = lastIdentityTokenId;
            if (playerId <= 100) return;
            if (statTupleHuntRunning || statTupleHuntCount >= 30) return;
            if (DateTime.UtcNow < nextStatTupleHuntUtc) return;
            if (String.IsNullOrWhiteSpace(text)) return;
            if (!System.Text.RegularExpressions.Regex.IsMatch(text,
                "REC|CATCH|RUSH|CAR|Y(?:AR)?DS?|TKL|TD", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                return;
            System.Text.RegularExpressions.MatchCollection numbers =
                System.Text.RegularExpressions.Regex.Matches(text, "\\d+");
            if (numbers.Count < 2) return;
            int first = Int32.Parse(numbers[0].Value, CultureInfo.InvariantCulture);
            int second = Int32.Parse(numbers[1].Value, CultureInfo.InvariantCulture);
            int third = numbers.Count >= 3 ? Int32.Parse(numbers[2].Value, CultureInfo.InvariantCulture) : -1;
            if (first > 999 || second > 999) return;
            QueueStatTupleHunt(text, playerId, first, second, third);
        }

        // Shared by the banner path above and the MANUAL trigger below (the
        // user reads a box-score line aloud, the numbers land here through
        // manual-stat-hunt.json). Same throttles, same gentle paced scan.
        // Returns true when handled (confirmed or scan queued) so the manual
        // trigger knows to keep retrying a throttled request next cycle.
        private bool QueueStatTupleHunt(string text, int playerId, int first, int second, int third)
        {
            // First: does an already-watched row for this player now hold the
            // new numbers? Then the live row is CONFIRMED and no scan is
            // needed at all - the steady state costs nothing.
            bool rowConfirmed = false;
            try { rowConfirmed = CheckStatRowCandidates(playerId, first, second); } catch { }
            if (rowConfirmed)
            {
                try
                {
                    AppendProbeLine(probeOutputSeedPath, "stattable-probe.jsonl",
                        new Dictionary<string, object>
                        {
                            { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                            { "stage", "row-confirmed" }, { "text", text }, { "playerId", playerId }
                        });
                }
                catch { }
                return true;
            }
            if (statTupleHuntRunning || statTupleHuntCount >= 60) return false;
            if (DateTime.UtcNow < nextStatTupleHuntUtc) return false;
            nextStatTupleHuntUtc = DateTime.UtcNow.AddSeconds(12);
            if (scanner.Process == null || scanner.Process.HasExited) return false;
            int processId = scanner.Process.Id;
            string huntText = text;
            statTupleHuntRunning = true;
            statTupleHuntCount++;
            ThreadPool.QueueUserWorkItem(delegate
            {
                List<string> hits = new List<string>();
                List<string> tableHits = null;
                try
                {
                    Process game = Process.GetProcessById(processId);
                    using (MemoryScanner backgroundScanner = new MemoryScanner())
                    {
                        backgroundScanner.Attach(game);
                        // int32 full-memory pass RETIRED (2026-08-21): it only
                        // ever found UI copies, and big sweeps correlate with
                        // game crashes. The narrow paced int16 hunt is the
                        // one that finds real table rows.
                        tableHits = backgroundScanner.HuntStatTuplesInt16(first, second, CancellationToken.None);
                    }
                }
                catch { }
                if (tableHits != null)
                {
                    lock (statTableWatchSync)
                    {
                        foreach (string hit in tableHits)
                        {
                            System.Text.RegularExpressions.Match match =
                                System.Text.RegularExpressions.Regex.Match(hit, "^i16:0x([0-9A-F]+) \\+s([0-9]+)");
                            if (!match.Success) continue;
                            long address = Convert.ToInt64(match.Groups[1].Value, 16);
                            bool known = false;
                            foreach (StatRowCandidate existing in statTableWatch)
                                if (existing.Address == address) { known = true; break; }
                            if (!known && statTableWatch.Count < 64)
                                statTableWatch.Add(new StatRowCandidate
                                {
                                    Address = address,
                                    DeltaB = Int32.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
                                    PlayerId = playerId,
                                    Label = huntText,
                                    LastA = first,
                                    LastB = second
                                });
                        }
                    }
                }
                try
                {
                    AppendProbeLine(probeOutputSeedPath, "stattable-probe.jsonl",
                        new Dictionary<string, object>
                        {
                            { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                            { "text", huntText }, { "playerId", playerId },
                            { "numbers", new int[] { first, second, third } },
                            { "hits", hits != null ? hits : new List<string>() },
                            { "tableHits", tableHits != null ? tableHits : new List<string>() }
                        });
                }
                catch { }
                statTupleHuntRunning = false;
            });
            return true;
        }

        // MANUAL ground-truth trigger: drop manual-stat-hunt.json into the
        // data-export folder ({"label":"pitt-qb","playerId":900001,
        // "first":9,"second":20,"third":112}) and the reader hunts those
        // numbers with its own paced scan - the safe replacement for the
        // external ad-hoc scans that destabilized the game (2026-08-21).
        // The file is renamed .done once the hunt is queued or confirmed.
        private DateTime nextManualHuntCheckUtc = DateTime.MinValue;

        private void ProcessManualStatHunt()
        {
            if (GameProfile.Key != "cfb27") return;
            if (DateTime.UtcNow < nextManualHuntCheckUtc) return;
            nextManualHuntCheckUtc = DateTime.UtcNow.AddSeconds(2);
            try
            {
                string folder = Path.GetDirectoryName(OutputPath(probeOutputSeedPath));
                string path = Path.Combine(folder, "manual-stat-hunt.json");
                if (!File.Exists(path)) return;
                System.Web.Script.Serialization.JavaScriptSerializer serializer =
                    new System.Web.Script.Serialization.JavaScriptSerializer();
                Dictionary<string, object> request =
                    serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                int first = Convert.ToInt32(request["first"], CultureInfo.InvariantCulture);
                int second = Convert.ToInt32(request["second"], CultureInfo.InvariantCulture);
                int third = request.ContainsKey("third")
                    ? Convert.ToInt32(request["third"], CultureInfo.InvariantCulture) : -1;
                int playerId = request.ContainsKey("playerId")
                    ? Convert.ToInt32(request["playerId"], CultureInfo.InvariantCulture) : 900000;
                string label = request.ContainsKey("label") ? (string)request["label"] : "manual";
                if (identityNames.Count < 300 && !identityNames.ContainsKey(playerId))
                    identityNames[playerId] = label;
                if (QueueStatTupleHunt("MANUAL " + label, playerId, first, second, third))
                {
                    try { File.Delete(path + ".done"); } catch { }
                    File.Move(path, path + ".done");
                }
            }
            catch { }
        }

        // --- Value hunt: chat-driven Cheat-Engine loop -------------------
        // Claude writes value-hunt.json ({"action":"first"|"next"|"reset",
        // "value":N,"label":"turner-yards"}); the reader scans/filters and
        // writes value-hunt-status.json. At <=24 survivors it dumps each
        // one's neighborhood automatically (the "jackpot" step). Read-only,
        // paced, single burst per command - same footprint as one CE scan.
        private readonly object valueHuntSync = new object();
        private List<long> valueHuntSurvivors = new List<long>();
        private string valueHuntLabel = "";
        private bool valueHuntRunning;
        private string lastValueHuntSignature = "";
        private DateTime nextValueHuntCheckUtc = DateTime.MinValue;

        // Mirrored into the live export (ram["valueHunt"]) so the Field
        // Inspector can show the hunt's progress on screen during a session.
        private volatile string lastValueHuntState = "";
        private volatile int lastValueHuntSurvivors = -1;
        private volatile string lastValueHuntStamp = "";

        private void WriteValueHuntStatus(string state, int survivorCount, List<long> sample)
        {
            lastValueHuntState = state;
            lastValueHuntSurvivors = survivorCount;
            lastValueHuntStamp = DateTime.UtcNow.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
            try
            {
                string folder = Path.GetDirectoryName(OutputPath(probeOutputSeedPath));
                List<string> sampleHex = new List<string>();
                if (sample != null)
                    foreach (long address in sample)
                        sampleHex.Add("0x" + address.ToString("X", CultureInfo.InvariantCulture));
                File.WriteAllText(Path.Combine(folder, "value-hunt-status.json"),
                    new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(
                        new Dictionary<string, object>
                        {
                            { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                            { "label", valueHuntLabel }, { "state", state },
                            { "survivors", survivorCount }, { "sample", sampleHex }
                        }));
            }
            catch { }
        }

        private void ProcessValueHunt()
        {
            if (DateTime.UtcNow < nextValueHuntCheckUtc || valueHuntRunning) return;
            nextValueHuntCheckUtc = DateTime.UtcNow.AddSeconds(1);
            string folder;
            string path;
            string content;
            try
            {
                folder = Path.GetDirectoryName(OutputPath(probeOutputSeedPath));
                path = Path.Combine(folder, "value-hunt.json");
                if (!File.Exists(path)) return;
                content = File.ReadAllText(path);
            }
            catch { return; }
            if (content == lastValueHuntSignature) return;
            lastValueHuntSignature = content;
            string action = "";
            int value = 0;
            bool highRange = false;
            bool floatMode = false;
            try
            {
                Dictionary<string, object> request =
                    new System.Web.Script.Serialization.JavaScriptSerializer()
                        .Deserialize<Dictionary<string, object>>(content);
                action = ((string)request["action"] ?? "").ToLowerInvariant();
                if (request.ContainsKey("value"))
                    value = Convert.ToInt32(request["value"], CultureInfo.InvariantCulture);
                if (request.ContainsKey("label")) valueHuntLabel = (string)request["label"];
                // "range":"high" scans ONLY above 4GB - where the live stat
                // accumulators must live (2026-08-23: every sub-4GB hit went
                // stale while the box score kept counting).
                if (request.ContainsKey("range"))
                    highRange = "high" == ((string)request["range"] ?? "").ToLowerInvariant();
                // "type":"float" hunts float32 values instead of int16 -
                // integer encodings all proved stale copies or play logs.
                if (request.ContainsKey("type"))
                    floatMode = "float" == ((string)request["type"] ?? "").ToLowerInvariant();
            }
            catch { return; }
            if (action == "reset")
            {
                lock (valueHuntSync) valueHuntSurvivors = new List<long>();
                WriteValueHuntStatus("reset", 0, null);
                return;
            }
            if (value < -30000 || value > 30000) return;
            if (scanner.Process == null || scanner.Process.HasExited) return;
            int processId = scanner.Process.Id;
            bool isFirst = action == "first";
            if (!isFirst && action != "next") return;
            valueHuntRunning = true;
            WriteValueHuntStatus(isFirst ? "scanning" : "filtering", -1, null);
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    Process game = Process.GetProcessById(processId);
                    using (MemoryScanner backgroundScanner = new MemoryScanner())
                    {
                        backgroundScanner.Attach(game);
                        List<long> result;
                        if (isFirst)
                        {
                            result = floatMode
                                ? backgroundScanner.ScanFloat32Exact(value, 4000000, highRange, CancellationToken.None)
                                : backgroundScanner.ScanInt16Exact((short)value, 4000000, highRange, CancellationToken.None);
                        }
                        else
                        {
                            List<long> current;
                            lock (valueHuntSync) current = new List<long>(valueHuntSurvivors);
                            result = floatMode
                                ? backgroundScanner.FilterFloat32Survivors(current, value)
                                : backgroundScanner.FilterInt16Survivors(current, (short)value);
                        }
                        lock (valueHuntSync) valueHuntSurvivors = result;
                        List<long> sample = result.Count <= 24 ? result : result.GetRange(0, 24);
                        WriteValueHuntStatus("done", result.Count, sample);
                        // Jackpot: few enough survivors = dump each row's
                        // neighborhood for offline layout derivation.
                        if (result.Count > 0 && result.Count <= 24)
                        {
                            foreach (long address in result)
                            {
                                try
                                {
                                    byte[] around = backgroundScanner.ReadBytes(address - 0x480, 0x900);
                                    List<int> values = new List<int>();
                                    for (int offset = 0; offset + 2 <= around.Length; offset += 2)
                                        values.Add(BitConverter.ToInt16(around, offset));
                                    AppendProbeLine(probeOutputSeedPath, "valuehunt-dumps.jsonl",
                                        new Dictionary<string, object>
                                        {
                                            { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                                            { "label", valueHuntLabel },
                                            { "value", value },
                                            { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                                            { "int16s", values }
                                        });
                                }
                                catch { }
                            }
                        }
                    }
                }
                catch { WriteValueHuntStatus("error", -1, null); }
                valueHuntRunning = false;
            });
        }

        private void MaybeRebaseScoreHudOffsets(int downValue, int distanceValue, string downDistanceKind)
        {
            if (GameProfile.Key != "cfb27") return;
            if (!scoreHudRebaseCacheChecked) LoadScoreHudRebaseCache();
            // SELF-HEAL (2026-08-21 morning): a session showed offsets back
            // at base values by 07:04 despite cache-applied+verified at
            // 06:56 - source of the revert unknown, so detect and re-apply
            // every cycle, and log the moment it happens for diagnosis.
            if (scoreHudRebaseDone && appliedRebaseVtableDelta != 0
                && GameProfile.ScoreHudIdentityVtableOffset == 0xB0F31A8L)
            {
                LogScoreHudRebase("revert-detected",
                    "Offsets found at BASE values while a rebase is active - re-applying "
                    + "+0x" + appliedRebaseVtableDelta.ToString("X", CultureInfo.InvariantCulture) + ".");
                GameProfile.ApplyScoreHudRebase(appliedRebaseVtableDelta, appliedRebaseTypeInfoDelta);
            }
            if (DateTime.UtcNow >= nextOffsetsHeartbeatUtc)
            {
                nextOffsetsHeartbeatUtc = DateTime.UtcNow.AddSeconds(60);
                LogScoreHudRebase("offsets", "identity=0x"
                    + GameProfile.ScoreHudIdentityVtableOffset.ToString("X", CultureInfo.InvariantCulture)
                    + " statSummary=0x"
                    + GameProfile.ScoreHudStatSummaryVtableOffset.ToString("X", CultureInfo.InvariantCulture));
            }
            // NO invalidation on empty sweeps: menus and halftime produce
            // long legitimately-empty stretches, and on 2026-08-21 that rule
            // threw away a good cached rebase mid-session, silently killing
            // every ScoreHud read (no stat banner could be captured for an
            // entire game). The cache is keyed to the exe's write time and
            // module size, so a new patch invalidates it by key - emptiness
            // proves nothing and never will.
            if (scoreHudRebaseDone) return;
            List<ScoreHudRebaseCandidate> completed = null;
            lock (scoreHudRebaseSync)
            {
                if (pendingScoreHudRebase != null)
                {
                    completed = pendingScoreHudRebase;
                    pendingScoreHudRebase = null;
                }
            }
            if (completed != null)
            {
                ApplyScoreHudRebaseHunt(completed);
                return;
            }
            if (scoreHudRebaseRunning) return;
            // Full-memory hunts are expensive for the game - cap them per
            // session (the persisted cache makes them unnecessary anyway
            // except right after a brand-new EA patch).
            if (scoreHudRebaseHuntCount >= 8) return;
            if (consecutiveEmptyScoreHudSweeps < 3) return;
            if (!String.Equals(downDistanceKind, "numeric", StringComparison.Ordinal)) return;
            if (downValue < 1 || downValue > 4 || distanceValue < 1 || distanceValue > 99) return;
            if (DateTime.UtcNow < nextScoreHudRebaseAttemptUtc) return;
            nextScoreHudRebaseAttemptUtc = DateTime.UtcNow.AddSeconds(30);
            if (scanner.Process == null || scanner.Process.HasExited) return;
            int processId = scanner.Process.Id;
            int huntDown = downValue;
            int huntDistance = distanceValue;
            scoreHudRebaseHuntCount++;
            scoreHudRebaseRunning = true;
            LogScoreHudRebase("hunt", "Sweeps empty " + consecutiveEmptyScoreHudSweeps.ToString(CultureInfo.InvariantCulture)
                + "x during live play; hunting the down-distance object for " + huntDown.ToString(CultureInfo.InvariantCulture)
                + " & " + huntDistance.ToString(CultureInfo.InvariantCulture) + ".");
            ThreadPool.QueueUserWorkItem(delegate
            {
                List<ScoreHudRebaseCandidate> found = null;
                try
                {
                    Process game = Process.GetProcessById(processId);
                    using (MemoryScanner backgroundScanner = new MemoryScanner())
                    {
                        backgroundScanner.Attach(game);
                        found = backgroundScanner.HuntScoreHudDownDistanceRebase(
                            huntDown, huntDistance, CancellationToken.None);
                    }
                }
                catch { }
                lock (scoreHudRebaseSync)
                {
                    pendingScoreHudRebase = found != null ? found : new List<ScoreHudRebaseCandidate>();
                    pendingScoreHudRebaseDown = huntDown;
                    pendingScoreHudRebaseDistance = huntDistance;
                }
                scoreHudRebaseRunning = false;
            });
        }

        private void ApplyScoreHudRebaseHunt(List<ScoreHudRebaseCandidate> found)
        {
            if (found.Count == 0)
            {
                LogScoreHudRebase("miss", "Hunt found no down-distance object; will retry.");
                return;
            }
            ScoreHudRebaseCandidate winner = found[0];
            for (int index = 1; index < found.Count; index++)
                if (found[index].Matches > winner.Matches) winner = found[index];
            for (int index = 0; index < found.Count; index++)
            {
                ScoreHudRebaseCandidate rival = found[index];
                if (rival == winner) continue;
                if (rival.Matches >= winner.Matches)
                {
                    lastWeakRebaseVtableOffset = 0;
                    lastWeakRebaseTypeInfoOffset = 0;
                    LogScoreHudRebase("ambiguous", "Hunt returned "
                        + found.Count.ToString(CultureInfo.InvariantCulture)
                        + " tied candidate pairs; refusing to rebase.");
                    return;
                }
            }
            // Pooled stale plates would give the real type many instances,
            // but the patched build recycles them - live sessions showed a
            // single plate per hunt. One instance is accepted only when TWO
            // consecutive independent hunts (different moments, different
            // core states) name the exact same pair with no rivals.
            if (winner.Matches < 3)
            {
                string pairText = "vtable 0x"
                    + winner.VtableOffset.ToString("X", CultureInfo.InvariantCulture)
                    + ", typeinfo 0x"
                    + winner.TypeInfoOffset.ToString("X", CultureInfo.InvariantCulture)
                    + " (\"" + winner.Display + "\", "
                    + winner.Matches.ToString(CultureInfo.InvariantCulture) + " instance(s))";
                bool corroborated = winner.VtableOffset == lastWeakRebaseVtableOffset
                    && winner.TypeInfoOffset == lastWeakRebaseTypeInfoOffset
                    && lastWeakRebaseVtableOffset != 0;
                if (!corroborated)
                {
                    lastWeakRebaseVtableOffset = winner.VtableOffset;
                    lastWeakRebaseTypeInfoOffset = winner.TypeInfoOffset;
                    LogScoreHudRebase("weak", "Single-instance candidate " + pairText
                        + "; waiting for a second hunt to corroborate.");
                    return;
                }
                LogScoreHudRebase("corroborated", "Two consecutive hunts agree on " + pairText + ".");
            }
            long vtableDelta = winner.VtableOffset - GameProfile.ScoreHudDownDistanceVtableOffset;
            long typeInfoDelta = winner.TypeInfoOffset - GameProfile.ScoreHudDownDistanceTypeInfoOffset;
            if (vtableDelta == 0 && typeInfoDelta == 0)
            {
                scoreHudRebaseDone = true;
                LogScoreHudRebase("current", "The compiled-in offsets are still correct; empty sweeps have another cause.");
                return;
            }
            GameProfile.ApplyScoreHudRebase(vtableDelta, typeInfoDelta);
            appliedRebaseVtableDelta = vtableDelta;
            appliedRebaseTypeInfoDelta = typeInfoDelta;
            SaveScoreHudRebaseCache(vtableDelta, typeInfoDelta);
            scoreHudRebaseDone = true;
            scoreHudRebaseApplied = true;
            consecutiveEmptyScoreHudSweeps = 0;
            scoreHudTextAnchors.Clear();
            scoreHudRebaseSummary = "vtables "
                + (vtableDelta >= 0 ? "+" : "-") + "0x" + Math.Abs(vtableDelta).ToString("X", CultureInfo.InvariantCulture)
                + ", typeinfo "
                + (typeInfoDelta >= 0 ? "+" : "-") + "0x" + Math.Abs(typeInfoDelta).ToString("X", CultureInfo.InvariantCulture);
            LogScoreHudRebase("applied", "Game patch detected. ScoreHud offsets re-derived from the live \""
                + winner.Display + "\" object (" + winner.Matches.ToString(CultureInfo.InvariantCulture)
                + " instance(s)): " + scoreHudRebaseSummary + ".");
            try { RequestScoreHudDiscovery(); } catch { }
        }

        // Keep LastScoreHudTexts fresh between full sweeps: scan the pooled
        // object region (seeded by the down-distance anchors, which live in
        // the same pool family, plus every text object ever seen) every
        // export cycle while the game is live. The scan runs in the same
        // cycle that writes the export, so a banner found here reaches the
        // app in the SAME 250 ms tick - flags and field-goal text land on
        // screen in well under half a second.
        private DateTime nextAnchorSeedSweepUtc = DateTime.MinValue;

        private void RefreshScoreHudTextsFast()
        {
            if (GameProfile.Key != "cfb27") return;
            if (DateTime.UtcNow < nextTextFastScanUtc) return;
            nextTextFastScanUtc = DateTime.UtcNow.AddMilliseconds(250);
            List<long> anchors = new List<long>(scoreHudTextAnchors);
            lock (scoreHudDownDistanceAnchors)
            {
                foreach (long address in scoreHudDownDistanceAnchors) anchors.Add(address);
            }
            List<ScoreHudTextCandidate> previous = scanner.LastScoreHudTexts;
            if (previous != null)
                foreach (ScoreHudTextCandidate item in previous)
                    if (item != null && item.Address != 0) anchors.Add(item.Address);
            // The anchored scan is only as good as its anchors, and a fresh
            // session has NONE until a full ScoreHud sweep runs - which is
            // rare by design. That made v1.4.91 inert (a whole session with
            // zero banner rows). Seed via the off-thread sweep, and keep the
            // pool fresh with one sweep every 30 s thereafter.
            if (DateTime.UtcNow >= nextAnchorSeedSweepUtc)
            {
                nextAnchorSeedSweepUtc = DateTime.UtcNow.AddSeconds(anchors.Count == 0 ? 5 : 30);
                try { RequestScoreHudDiscovery(); } catch { }
            }
            if (anchors.Count == 0) return;
            List<ScoreHudTextCandidate> found;
            try { found = scanner.FindScoreHudTextCandidatesNear(anchors, 12); }
            catch { found = new List<ScoreHudTextCandidate>(); }
            if (found.Count > 0)
            {
                foreach (ScoreHudTextCandidate item in found)
                    if (scoreHudTextAnchors.Count < 256) scoreHudTextAnchors.Add(item.Address);
                scanner.LastScoreHudTexts = found;
            }
            // Banner messages ride the same pooled region: refreshing them here
            // makes FLAG appear with the game's banner instead of ~10 s late,
            // and catches FIELD GOAL presentations the sweep used to miss.
            try
            {
                List<ScoreHudMessageCandidate> messages = scanner.FindMessageCandidatesNear(anchors, 12);
                if (messages.Count > 0)
                {
                    // Message addresses are anchors too: banners pool in their
                    // own corner of the region, and the first sweep-found one
                    // teaches the fast scan where that corner is.
                    foreach (ScoreHudMessageCandidate message in messages)
                        if (scoreHudTextAnchors.Count < 256 && message.Address != 0)
                            scoreHudTextAnchors.Add(message.Address);
                    RememberScoreHudMessages(messages);
                }
            }
            catch { }
        }

        private readonly HashSet<string> statBannerSeen = new HashSet<string>(StringComparer.Ordinal);
        private int statBannerEntries;
        private int fgSpotEntries;
        private DateTime lastFieldGoalTextUtc = DateTime.MinValue;
        // The FG presentation outlives the few ticks where the reader happens
        // to catch the banner text (2026-08-20: a 55.7 yard kick produced one
        // sample). Latch the distance when text + a legal kick length line up
        // and keep publishing it through the attempt and its result.
        private int latchedFieldGoalDistance;
        private DateTime latchedFieldGoalUtc = DateTime.MinValue;
        private static readonly TimeSpan FieldGoalLatchWindow = TimeSpan.FromSeconds(25);

        private void WriteStatBannerProbe(string screenJsonPath, int quarterValue, int clockValue,
            int downValue, int distanceValue)
        {
            if (GameProfile.Key != "cfb27") return;
            List<ScoreHudTextCandidate> texts = scanner.LastScoreHudTexts;
            if (texts == null) texts = new List<ScoreHudTextCandidate>();
            string folder = Path.GetDirectoryName(OutputPath(screenJsonPath));
            System.Web.Script.Serialization.JavaScriptSerializer serializer =
                new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
            bool fieldGoalSeen = false;
            string fieldGoalText = null;
            foreach (ScoreHudTextCandidate item in texts)
            {
                if (item == null || item.Texts == null || item.Texts.Count == 0) continue;
                foreach (string text in item.Texts)
                {
                    // STRICT: only genuine field-goal text arms the latch and
                    // the fgspot dump. The old pattern also matched any "NN
                    // YDS" stat banner ("2 CATCH, 25 YDS"), which kept the
                    // trigger armed all game - a fake 19-yard FG published
                    // during a kickoff, and junk burned the whole 200-row
                    // fgspot budget before the first real kick (2026-08-20).
                    if (System.Text.RegularExpressions.Regex.IsMatch(text, "FIELD\\s*GOAL|\\bFG\\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                    { fieldGoalSeen = true; if (fieldGoalText == null) fieldGoalText = text; }
                }
                string signature = item.Kind + "|" + item.Address.ToString(CultureInfo.InvariantCulture)
                    + "|" + item.Texts[0];
                if (statBannerSeen.Contains(signature) || statBannerEntries >= 400) continue;
                statBannerSeen.Add(signature);
                // Every NEW stat banner triggers a hunt for the accumulator
                // table its numbers live in (see HuntStatTuples).
                foreach (string text in item.Texts)
                {
                    try { MaybeHuntStatTuple(text, item.PlayerId); } catch { }
                }
                statBannerEntries++;
                Dictionary<string, object> entry = new Dictionary<string, object>
                {
                    { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "quarter", quarterValue }, { "clock", clockValue },
                    { "down", downValue }, { "distance", distanceValue },
                    { "kind", item.Kind },
                    { "address", "0x" + item.Address.ToString("X", CultureInfo.InvariantCulture) },
                    { "playerId", item.PlayerId }, { "teamId", item.TeamId },
                    { "texts", item.Texts }
                };
                // Full object image: every int and every string it points at,
                // 0x180 bytes - the passing/rushing name question is answered
                // by whatever sits in the slots we have not read before.
                try
                {
                    byte[] full = scanner.ReadBytes(item.Address, 0x180);
                    List<int> ints = new List<int>();
                    for (int o = 0; o + 4 <= full.Length; o += 4) ints.Add(BitConverter.ToInt32(full, o));
                    entry["ints"] = ints;
                    List<string> strings = new List<string>();
                    for (int o = 0; o + 8 <= full.Length; o += 8)
                    {
                        long pointer = BitConverter.ToInt64(full, o);
                        if (pointer < 0x10000 || pointer >= 0x100000000L) continue;
                        string text = null;
                        try { text = scanner.ReadAsciiString(pointer, 64); } catch { }
                        if (String.IsNullOrWhiteSpace(text) || text.Trim().Length < 3) continue;
                        strings.Add("+" + o.ToString(CultureInfo.InvariantCulture) + "=" + text.Trim());
                    }
                    entry["strings"] = strings;
                }
                catch { }
                try { File.AppendAllText(Path.Combine(folder, "statbanner-probe.jsonl"), serializer.Serialize(entry) + Environment.NewLine); } catch { }
            }
            // Also check the message banners for FG text (kick meter / result).
            if (!fieldGoalSeen)
            {
                ScoreHudMessageCandidate message = CurrentScoreHudMessage();
                if (message != null)
                {
                    string text = ((message.DisplayText ?? "") + " " + (message.InfoText ?? "")).Trim();
                    if (text.Length > 0 && System.Text.RegularExpressions.Regex.IsMatch(text, "FIELD\\s*GOAL|\\bFG\\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                    { fieldGoalSeen = true; fieldGoalText = text; }
                }
            }
            if (fieldGoalSeen) lastFieldGoalTextUtc = DateTime.UtcNow;
            if (fieldGoalSeen && fgSpotEntries < 200)
            {
                List<long> quarterAddresses = CopyConfiguredAddresses("quarter");
                if (quarterAddresses.Count == 1)
                {
                    try
                    {
                        long block = quarterAddresses[0] - 0xC8;
                        byte[] bytes = scanner.ReadBytes(block, 0x300);
                        Dictionary<string, object> ints = new Dictionary<string, object>();
                        Dictionary<string, object> floats = new Dictionary<string, object>();
                        for (int offset = 0; offset + 4 <= bytes.Length; offset += 4)
                        {
                            int value = BitConverter.ToInt32(bytes, offset);
                            if (value >= 1 && value <= 120)
                                ints["0x" + offset.ToString("X", CultureInfo.InvariantCulture)] = value;
                            float real = BitConverter.ToSingle(bytes, offset);
                            if (!float.IsNaN(real) && !float.IsInfinity(real) && real >= 0.25f && real <= 110f)
                                floats["0x" + offset.ToString("X", CultureInfo.InvariantCulture)] = Math.Round(real, 3);
                        }
                        fgSpotEntries++;
                        Dictionary<string, object> entry = new Dictionary<string, object>
                        {
                            { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                            { "quarter", quarterValue }, { "clock", clockValue },
                            { "down", downValue }, { "distance", distanceValue },
                            { "fieldGoalText", fieldGoalText },
                            { "ints", ints }, { "floats", floats }
                        };
                        File.AppendAllText(Path.Combine(folder, "fgspot-probe.jsonl"), serializer.Serialize(entry) + Environment.NewLine);
                    }
                    catch { }
                }
            }
        }

        // ---------- Madden ticker (records + team stat lines) ----------
        private List<long> maddenTickerAddresses = new List<long>();
        private DateTime nextMaddenTickerScanUtc = DateTime.MinValue;

        private List<Dictionary<string, object>> MaddenTickerEntries()
        {
            List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
            if (GameProfile.MaddenTickerVtableOffset == 0) return result;
            long moduleBase = scanner.Process.MainModule.BaseAddress.ToInt64();
            long vtable = moduleBase + GameProfile.MaddenTickerVtableOffset;
            // Locating the instances is a full sweep; do it rarely and re-read
            // the addresses every publish (cheap) so records stay current.
            if (maddenTickerAddresses.Count == 0 && DateTime.UtcNow >= nextMaddenTickerScanUtc)
            {
                nextMaddenTickerScanUtc = DateTime.UtcNow.AddSeconds(45);
                try
                {
                    Dictionary<long, List<long>> refs = scanner.FindPrivateInt64ReferencesBelow4G(new long[] { vtable }, 24);
                    List<long> found;
                    if (refs.TryGetValue(vtable, out found) && found != null) maddenTickerAddresses = found;
                }
                catch { }
            }
            foreach (long address in maddenTickerAddresses)
            {
                List<string> strings = new List<string>();
                try
                {
                    byte[] bytes = scanner.ReadBytes(address, 0x140);
                    if (BitConverter.ToInt64(bytes, 0) != vtable) continue;
                    for (int offset = 0; offset + 8 <= bytes.Length; offset += 8)
                    {
                        long pointer = BitConverter.ToInt64(bytes, offset);
                        if (pointer < 0x10000 || pointer >= 0x100000000L) continue;
                        string text = null;
                        try { text = scanner.ReadAsciiString(pointer, 64); } catch { }
                        if (String.IsNullOrWhiteSpace(text)) continue;
                        text = text.Trim();
                        if (text.Length < 2) continue;
                        strings.Add(text);
                    }
                }
                catch { continue; }
                if (strings.Count == 0) continue;
                // A stat line names its own team ("CLE:  S.Sanders 3-8, ...");
                // the record that follows it belongs to that team.
                for (int index = 0; index < strings.Count; index++)
                {
                    System.Text.RegularExpressions.Match stat =
                        System.Text.RegularExpressions.Regex.Match(strings[index], "^([A-Z]{2,4}):\\s+(.+)$");
                    if (!stat.Success) continue;
                    string record = null;
                    for (int next = index + 1; next < strings.Count && next <= index + 3; next++)
                    {
                        if (System.Text.RegularExpressions.Regex.IsMatch(strings[next], "^\\(\\d{1,2}-\\d{1,2}(?:-\\d{1,2})?\\)$"))
                        { record = strings[next].Trim('(', ')'); break; }
                    }
                    result.Add(new Dictionary<string, object>
                    {
                        { "abbreviation", stat.Groups[1].Value },
                        { "statLine", stat.Groups[2].Value.Trim() },
                        { "record", record }
                    });
                }
                if (result.Count >= 8) break;
            }
            return result;
        }

        // ---------- Madden timeout discovery ----------
        // Madden has no ScoreHud team objects, so timeouts are found by
        // watching the live scoreboard block for slots that only ever step
        // DOWN by one within 0..3 - what a burned timeout looks like. Every
        // transition is logged (madden-timeout-probe.jsonl) and, once exactly
        // two slots have shown a legal burn, they publish. Fail closed: no
        // pair, no timeouts.
        private readonly Dictionary<int, int> maddenSlotValues = new Dictionary<int, int>();
        private readonly Dictionary<int, int> maddenSlotBurns = new Dictionary<int, int>();
        private readonly Dictionary<int, int> maddenSlotIllegal = new Dictionary<int, int>();
        private DateTime nextMaddenSlotSampleUtc = DateTime.MinValue;
        private const int MaddenWindowBefore = 0x400;
        private const int MaddenWindowSize = 0xC00;

        private void MaddenWatchTimeoutSlots(string screenJsonPath, int quarterValue, int clockValue)
        {
            if (DateTime.UtcNow < nextMaddenSlotSampleUtc) return;
            // 150 ms, not 400: tester game 2 showed per-team candidate slots
            // burning at the exact moments of all-calls ticks with their
            // intermediate steps missed - the counters step faster than the
            // old cadence.
            nextMaddenSlotSampleUtc = DateTime.UtcNow.AddMilliseconds(150);
            List<long> quarterAddresses = CopyConfiguredAddresses("quarter");
            if (quarterAddresses.Count != 1) return;
            long windowBase = quarterAddresses[0] - 0xC8 - MaddenWindowBefore;
            byte[] bytes;
            try { bytes = scanner.ReadBytes(windowBase, MaddenWindowSize); } catch { return; }
            string folder = Path.GetDirectoryName(OutputPath(screenJsonPath));
            for (int offset = 0; offset + 4 <= bytes.Length; offset += 4)
            {
                int value = BitConverter.ToInt32(bytes, offset);
                int previous;
                if (!maddenSlotValues.TryGetValue(offset, out previous)) { maddenSlotValues[offset] = value; continue; }
                if (value == previous) continue;
                maddenSlotValues[offset] = value;
                if (previous < 0 || previous > 3 || value < 0 || value > 3) { maddenSlotIllegal[offset] = 1; continue; }
                if (value == previous - 1)
                {
                    int burns;
                    maddenSlotBurns[offset] = maddenSlotBurns.TryGetValue(offset, out burns) ? burns + 1 : 1;
                    // Tester game 2 proved the burned slot sits inside a
                    // scoreboard struct (home score at -16, away at -8) and
                    // that the ±0x40 nonzero dump was too narrow to catch the
                    // per-team pair. Snapshot EVERY timeout-sized value
                    // (0..3) across ±0x300 instead - the pair's state at
                    // every single call identifies it in one half of play.
                    Dictionary<string, object> around = new Dictionary<string, object>();
                    for (int nearby = Math.Max(0, offset - 0x300);
                        nearby + 4 <= bytes.Length && nearby <= offset + 0x300; nearby += 4)
                    {
                        int neighbor = BitConverter.ToInt32(bytes, nearby);
                        if (neighbor >= 0 && neighbor <= 3 && nearby != offset)
                            around[(nearby - offset).ToString(CultureInfo.InvariantCulture)] = neighbor;
                        // Keep the score anchors too - they orient the struct.
                        else if (neighbor > 3 && neighbor <= 99 && nearby >= offset - 0x20 && nearby <= offset + 0x20)
                            around[(nearby - offset).ToString(CultureInfo.InvariantCulture)] = neighbor;
                    }
                    try
                    {
                        File.AppendAllText(Path.Combine(folder, "madden-timeout-probe.jsonl"),
                            new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new Dictionary<string, object>
                            {
                                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                                { "offset", "0x" + offset.ToString("X", CultureInfo.InvariantCulture) },
                                // Absolute addresses: window offsets proved
                                // non-transferable across sessions (anchor
                                // lands differently every launch).
                                { "abs", "0x" + (windowBase + offset).ToString("X", CultureInfo.InvariantCulture) },
                                { "base", "0x" + windowBase.ToString("X", CultureInfo.InvariantCulture) },
                                { "from", previous }, { "to", value },
                                { "quarter", quarterValue }, { "clock", clockValue },
                                { "burns", maddenSlotBurns[offset] },
                                { "around", around }
                            }) + Environment.NewLine);
                    }
                    catch { }
                }
                // A reset to 3 (half start) is legal and expected; anything
                // else that is not a single step down disqualifies the slot.
                else if (!(value == 3 && previous <= 3)) maddenSlotIllegal[offset] = 1;
            }
        }

        private Dictionary<string, object> MaddenTimeoutDictionary()
        {
            List<int> candidates = new List<int>();
            foreach (KeyValuePair<int, int> pair in maddenSlotBurns)
            {
                if (maddenSlotIllegal.ContainsKey(pair.Key)) continue;
                int current;
                if (!maddenSlotValues.TryGetValue(pair.Key, out current) || current < 0 || current > 3) continue;
                candidates.Add(pair.Key);
            }
            candidates.Sort();
            Dictionary<string, object> result = new Dictionary<string, object>
            {
                { "candidateCount", candidates.Count },
                { "confident", candidates.Count == 2 }
            };
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            for (int index = 0; index < candidates.Count && index < 8; index++)
            {
                int offset = candidates[index];
                list.Add(new Dictionary<string, object>
                {
                    { "offset", "0x" + offset.ToString("X", CultureInfo.InvariantCulture) },
                    { "value", maddenSlotValues[offset] },
                    { "burns", maddenSlotBurns[offset] }
                });
            }
            result["slots"] = list;
            if (candidates.Count == 2)
            {
                // Side assignment is provisional until a tester confirms.
                // CFB27's clone slots put HOME at the lower offset (+0x44
                // home, +0x48 away) - assume the same family layout here.
                result["homeTimeouts"] = maddenSlotValues[candidates[0]];
                result["awayTimeouts"] = maddenSlotValues[candidates[1]];
            }
            // v1.4.127 team-object route: sides are identified by each
            // instance containing its own live score, so when exactly one
            // shared field offset behaves like a timeout counter in both
            // instances, that pair IS home/away - it overrides the
            // provisional window guess. Fail closed at every step.
            try
            {
                long homeInstance = 0, awayInstance = 0;
                int homeBestVotes = 2, awayBestVotes = -2;
                foreach (KeyValuePair<long, int> votePair in maddenTeamSideVotes)
                {
                    if (votePair.Value > homeBestVotes) { homeBestVotes = votePair.Value; homeInstance = votePair.Key; }
                    if (votePair.Value < awayBestVotes) { awayBestVotes = votePair.Value; awayInstance = votePair.Key; }
                }
                Dictionary<string, object> teamInfo = new Dictionary<string, object>
                {
                    { "instances", maddenTeamFieldValues.Count },
                    { "homeInstance", homeInstance == 0 ? "?" : "0x" + homeInstance.ToString("X", CultureInfo.InvariantCulture) },
                    { "awayInstance", awayInstance == 0 ? "?" : "0x" + awayInstance.ToString("X", CultureInfo.InvariantCulture) }
                };
                if (homeInstance != 0 && awayInstance != 0 && homeInstance != awayInstance
                    && maddenTeamFieldValues.ContainsKey(homeInstance)
                    && maddenTeamFieldValues.ContainsKey(awayInstance))
                {
                    List<int> shared = new List<int>();
                    foreach (KeyValuePair<int, int> field in maddenTeamFieldValues[homeInstance])
                    {
                        int fieldOffset = field.Key;
                        int homeValue = field.Value;
                        int awayValue;
                        if (!maddenTeamFieldValues[awayInstance].TryGetValue(fieldOffset, out awayValue)) continue;
                        if (homeValue < 0 || homeValue > 3 || awayValue < 0 || awayValue > 3) continue;
                        if (maddenTeamFieldIllegal[homeInstance].ContainsKey(fieldOffset)
                            || maddenTeamFieldIllegal[awayInstance].ContainsKey(fieldOffset)) continue;
                        int homeBurns, awayBurns;
                        maddenTeamFieldBurns[homeInstance].TryGetValue(fieldOffset, out homeBurns);
                        maddenTeamFieldBurns[awayInstance].TryGetValue(fieldOffset, out awayBurns);
                        if (homeBurns + awayBurns < 1) continue;
                        shared.Add(fieldOffset);
                    }
                    List<string> sharedHex = new List<string>();
                    foreach (int fieldOffset in shared)
                        sharedHex.Add("+0x" + fieldOffset.ToString("X", CultureInfo.InvariantCulture));
                    teamInfo["candidateFields"] = sharedHex;
                    if (shared.Count == 1)
                    {
                        result["homeTimeouts"] = maddenTeamFieldValues[homeInstance][shared[0]];
                        result["awayTimeouts"] = maddenTeamFieldValues[awayInstance][shared[0]];
                        result["confident"] = true;
                        result["source"] = "teamObjects";
                        teamInfo["field"] = "+0x" + shared[0].ToString("X", CultureInfo.InvariantCulture);
                    }
                }
                result["teamObjects"] = teamInfo;
            }
            catch { }
            return result;
        }

        // ---------- On-demand stat-table capture probe (v1.4.131) ----------
        // 2026-08-23 proved per-player totals persist nowhere as plain
        // numbers: the box score MATERIALIZES the full table on open, at
        // fresh addresses, in the decoded postgame layout, then freezes it.
        // So capture on materialization: sweep the two small pools where the
        // rows appeared (0x2A0-0x2C8, 0x400-0x430 ranges), recognize rows by
        // SHAPE, and log them with context. Research-only: publishes nothing.
        private DateTime nextTableCaptureUtc = DateTime.MinValue;
        private string lastTableCaptureHash = "";
        private int tableCaptureLines;

        // QB row: comp@+0, att duplicated @+12/+16, yards TRIPLED @+38/+46/+54.
        internal static bool LooksLikeQbStatRow(int comp, int att12, int att16, int y38, int y46, int y54)
        {
            if (att12 != att16 || y38 != y46 || y46 != y54) return false;
            if (att12 < 1 || att12 > 80) return false;
            if (comp < 0 || comp > att12) return false;
            return y38 >= 0 && y38 <= 750;
        }

        // RB row: car@+0, long@+6, yds@+12 (weak shape - corroborate offline).
        internal static bool LooksLikeRbStatRow(int car, int lng, int yds)
        {
            if (car < 1 || car > 60) return false;
            if (lng < 0 || lng > 99 || yds < -20 || yds > 500) return false;
            if (lng > Math.Max(0, yds) && yds >= 0) return false;
            return lng > 0 || yds != 0 || car > 0;
        }

        private void ProbeMaterializedStatTable(string screenJsonPath)
        {
            if (GameProfile.Key != "cfb27") return;
            if (DateTime.UtcNow < nextTableCaptureUtc) return;
            nextTableCaptureUtc = DateTime.UtcNow.AddSeconds(10);
            if (tableCaptureLines >= 3000) return;
            long[][] windows = new long[][]
            {
                new long[] { 0x2A00000L, 0x2C80000L },
                new long[] { 0x4000000L, 0x4300000L }
            };
            List<Dictionary<string, object>> qbRows = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> rbRows = new List<Dictionary<string, object>>();
            System.Text.StringBuilder hash = new System.Text.StringBuilder();
            foreach (long[] window in windows)
            {
                long start = window[0];
                while (start < window[1])
                {
                    int chunk = (int)Math.Min(0x100000L, window[1] - start);
                    byte[] buffer;
                    try { buffer = scanner.ReadBytes(start, chunk); } catch { start += chunk; continue; }
                    if (buffer == null || buffer.Length < 0x60) { start += chunk; continue; }
                    for (int i = 0; i + 0x60 <= buffer.Length; i += 2)
                    {
                        int comp = BitConverter.ToInt16(buffer, i);
                        int att12 = BitConverter.ToInt16(buffer, i + 12);
                        int att16 = BitConverter.ToInt16(buffer, i + 16);
                        int y38 = BitConverter.ToInt16(buffer, i + 38);
                        int y46 = BitConverter.ToInt16(buffer, i + 46);
                        int y54 = BitConverter.ToInt16(buffer, i + 54);
                        if (qbRows.Count < 24 && LooksLikeQbStatRow(comp, att12, att16, y38, y46, y54)
                            && (att12 > 1 || y38 > 0))
                        {
                            long address = start + i;
                            List<int> context = new List<int>();
                            for (int o = -0x40; o + 2 <= 0x120 && i + o >= 0 && i + o + 2 <= buffer.Length; o += 2)
                                context.Add(BitConverter.ToInt16(buffer, i + o));
                            qbRows.Add(new Dictionary<string, object>
                            {
                                { "addr", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                                { "comp", comp }, { "att", att12 }, { "yds", y38 },
                                { "ctx", context }
                            });
                            hash.Append(address).Append(':').Append(comp).Append('/').Append(att12).Append('/').Append(y38).Append(';');
                        }
                        int car = comp;
                        int lng = BitConverter.ToInt16(buffer, i + 6);
                        int yds = BitConverter.ToInt16(buffer, i + 12);
                        if (rbRows.Count < 24 && LooksLikeRbStatRow(car, lng, yds) && lng > 0 && yds >= lng)
                        {
                            long address = start + i;
                            rbRows.Add(new Dictionary<string, object>
                            {
                                { "addr", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                                { "car", car }, { "long", lng }, { "yds", yds }
                            });
                        }
                    }
                    System.Threading.Thread.Sleep(3);
                    start += chunk;
                }
            }
            if (qbRows.Count == 0 && rbRows.Count == 0) return;
            string digest = hash.ToString();
            if (digest == lastTableCaptureHash) return;
            lastTableCaptureHash = digest;
            tableCaptureLines++;
            AppendProbeLine(screenJsonPath, "tablecapture-probe.jsonl", new Dictionary<string, object>
            {
                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "qbRows", qbRows },
                { "rbRows", rbRows }
            });
        }

        // ---------- Madden team-object timeout watcher (v1.4.127) ----------
        // The 2026-08-22 tester round proved per-team timeouts-remaining does
        // NOT live near the scoreboard anchor: full timeline reconstruction
        // over the entire watched window found no slot holding the 3->2->1
        // pattern at the two ground-truth timeout moments. The likeliest home
        // is the team objects the research loop already finds (the vtable
        // pair that tracked the away score across six hunt rounds). Watch
        // every timeout-sized int32 field inside each live instance with tiny
        // fixed reads - no sweeps - and log ABSOLUTE addresses, because
        // window-relative offsets proved non-transferable across sessions.
        // An instance votes itself home/away by containing its own team's
        // live score (and not the other's). Publish only when both sides are
        // identified and exactly one shared field offset behaves like a
        // timeout counter in both instances.
        private readonly object maddenTeamObjectLock = new object();
        private List<long> maddenTeamObjectInstances = new List<long>();
        private readonly Dictionary<long, Dictionary<int, int>> maddenTeamFieldValues = new Dictionary<long, Dictionary<int, int>>();
        private readonly Dictionary<long, Dictionary<int, int>> maddenTeamFieldBurns = new Dictionary<long, Dictionary<int, int>>();
        private readonly Dictionary<long, Dictionary<int, int>> maddenTeamFieldIllegal = new Dictionary<long, Dictionary<int, int>>();
        private readonly Dictionary<long, int> maddenTeamSideVotes = new Dictionary<long, int>();
        private DateTime nextMaddenTeamSampleUtc = DateTime.MinValue;
        private DateTime nextMaddenTeamSnapshotUtc = DateTime.MinValue;
        private int maddenTeamProbeLines;
        private const int MaddenTeamObjectBytes = 0x140;

        // A timeout counter may only step down by one, or reset to 3 at a
        // half start. Anything else disqualifies the field.
        internal static bool MaddenTimeoutStepLegal(int from, int to)
        {
            if (from < 0 || from > 3 || to < 0 || to > 3 || from == to) return false;
            return to == from - 1 || to == 3;
        }

        private void MaddenWatchTeamObjectTimeouts(string screenJsonPath, int quarterValue, int clockValue)
        {
            if (DateTime.UtcNow < nextMaddenTeamSampleUtc) return;
            nextMaddenTeamSampleUtc = DateTime.UtcNow.AddMilliseconds(150);
            List<long> instances;
            lock (maddenTeamObjectLock) { instances = new List<long>(maddenTeamObjectInstances); }
            if (instances.Count == 0) return;
            bool snapshot = DateTime.UtcNow >= nextMaddenTeamSnapshotUtc;
            if (snapshot) nextMaddenTeamSnapshotUtc = DateTime.UtcNow.AddSeconds(30);
            string folder = Path.GetDirectoryName(OutputPath(screenJsonPath));
            int awayScore = maddenLiveAwayScore;
            int homeScore = maddenLiveHomeScore;
            foreach (long instance in instances)
            {
                byte[] bytes;
                try { bytes = scanner.ReadBytes(instance, MaddenTeamObjectBytes); } catch { continue; }
                if (bytes == null || bytes.Length < MaddenTeamObjectBytes) continue;
                bool containsHome = false, containsAway = false;
                for (int fieldOffset = 0; fieldOffset + 4 <= bytes.Length; fieldOffset += 4)
                {
                    int fieldValue = BitConverter.ToInt32(bytes, fieldOffset);
                    if (homeScore > 0 && fieldValue == homeScore) containsHome = true;
                    if (awayScore > 0 && fieldValue == awayScore) containsAway = true;
                }
                if (containsHome != containsAway && awayScore != homeScore)
                {
                    int votes;
                    maddenTeamSideVotes.TryGetValue(instance, out votes);
                    maddenTeamSideVotes[instance] = votes + (containsHome ? 1 : -1);
                }
                Dictionary<int, int> values;
                if (!maddenTeamFieldValues.TryGetValue(instance, out values))
                {
                    values = new Dictionary<int, int>();
                    maddenTeamFieldValues[instance] = values;
                    maddenTeamFieldBurns[instance] = new Dictionary<int, int>();
                    maddenTeamFieldIllegal[instance] = new Dictionary<int, int>();
                }
                List<string> transitions = new List<string>();
                for (int fieldOffset = 0; fieldOffset + 4 <= bytes.Length; fieldOffset += 4)
                {
                    int value = BitConverter.ToInt32(bytes, fieldOffset);
                    int previous;
                    if (!values.TryGetValue(fieldOffset, out previous)) { values[fieldOffset] = value; continue; }
                    if (value == previous) continue;
                    values[fieldOffset] = value;
                    // Already disqualified: keep tracking silently, no logs.
                    if (maddenTeamFieldIllegal[instance].ContainsKey(fieldOffset)) continue;
                    if (previous < 0 || previous > 3 || value < 0 || value > 3)
                    {
                        maddenTeamFieldIllegal[instance][fieldOffset] = 1;
                        continue;
                    }
                    if (value == previous - 1)
                    {
                        int burns;
                        maddenTeamFieldBurns[instance].TryGetValue(fieldOffset, out burns);
                        maddenTeamFieldBurns[instance][fieldOffset] = burns + 1;
                    }
                    else if (!MaddenTimeoutStepLegal(previous, value))
                        maddenTeamFieldIllegal[instance][fieldOffset] = 1;
                    transitions.Add("+0x" + fieldOffset.ToString("X", CultureInfo.InvariantCulture)
                        + ":" + previous.ToString(CultureInfo.InvariantCulture)
                        + "->" + value.ToString(CultureInfo.InvariantCulture));
                }
                if ((transitions.Count > 0 || snapshot) && maddenTeamProbeLines < 5000)
                {
                    maddenTeamProbeLines++;
                    List<int> ints = new List<int>();
                    for (int fieldOffset = 0; fieldOffset + 4 <= bytes.Length; fieldOffset += 4)
                        ints.Add(BitConverter.ToInt32(bytes, fieldOffset));
                    int sideVotes;
                    maddenTeamSideVotes.TryGetValue(instance, out sideVotes);
                    try
                    {
                        File.AppendAllText(Path.Combine(folder, "madden-teamobj-probe.jsonl"),
                            new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new Dictionary<string, object>
                            {
                                { "t", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                                { "kind", transitions.Count > 0 ? "transition" : "snapshot" },
                                { "inst", "0x" + instance.ToString("X", CultureInfo.InvariantCulture) },
                                { "sideVotes", sideVotes },
                                { "quarter", quarterValue }, { "clock", clockValue },
                                { "away", awayScore }, { "home", homeScore },
                                { "changed", transitions },
                                { "ints", ints }
                            }) + Environment.NewLine);
                    }
                    catch { }
                }
            }
        }

        // Publishes the kick length for the whole attempt: latch it the first
        // tick the game's FIELD GOAL text and a legal distance coincide, then
        // hold it for the presentation. Fail closed - no text, no latch.
        // "42-YD FG GOOD", "55-YD FIELD GOAL" - the game prints the length in
        // its own banner; that number is authoritative when present.
        internal static int FieldGoalDistanceFromText(string text)
        {
            if (String.IsNullOrWhiteSpace(text)) return 0;
            System.Text.RegularExpressions.Match match = System.Text.RegularExpressions.Regex.Match(
                text, "(\\d{1,3})\\s*-?\\s*(?:YD|YARD)S?\\b[^A-Z]*(?:FG|FIELD\\s*GOAL)",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!match.Success) return 0;
            int yards = Int32.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
            return yards >= 18 && yards <= 120 ? yards : 0;
        }

        private object CurrentFieldGoalDistance(double preciseYards, int distanceYards, int down,
            string downDistanceKind)
        {
            DateTime now = DateTime.UtcNow;
            ScoreHudMessageCandidate bannerMessage = CurrentScoreHudMessage();
            if (bannerMessage != null)
            {
                int fromText = FieldGoalDistanceFromText(
                    ((bannerMessage.DisplayText ?? "") + " " + (bannerMessage.InfoText ?? "")).Trim());
                if (fromText > 0)
                {
                    if (fromText != latchedFieldGoalDistance) pendingKickPairScanDistance = fromText;
                    latchedFieldGoalDistance = fromText;
                    latchedFieldGoalUtc = now;
                }
            }
            // 20 s, not 120: the FG presentation is over well before that, and
            // a long window let post-kick slot values re-latch during the
            // ensuing kickoff (the fake 19-yarder of 2026-08-20).
            bool textRecent = now - lastFieldGoalTextUtc <= TimeSpan.FromSeconds(20);
            // In the first seconds of a NEW FIELD GOAL banner: the
            // game flips its plate to Kickoff in the same instant the banner
            // appears (proven 20:55:59.065, a real 39-yarder the scrimmage
            // gate wrongly blocked), while the slot still holds the true
            // kick length. A per-banner-instance window keeps the late-
            // kickoff fake (61 s after its banner) impossible.
            if (bannerMessage != null && bannerMessage.Address != lastFgBannerAddress
                && System.Text.RegularExpressions.Regex.IsMatch(
                    (bannerMessage.DisplayText ?? "") + " " + (bannerMessage.InfoText ?? ""),
                    "FIELD\\s*GOAL|\\bFG\\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            {
                lastFgBannerAddress = bannerMessage.Address;
                fgBannerFirstSeenUtc = now;
            }
            bool bannerFresh = lastFgBannerAddress != 0
                && now - fgBannerFirstSeenUtc <= TimeSpan.FromSeconds(5);
            // The full-trace rule (2026-08-20 kick-trace.jsonl, complete
            // recordings of a made 43 and a missed long attempt):
            // - Lining up a kick loads the KICK LENGTH into the yards-to-go
            //   slot 15+ seconds pre-snap (65 held from play-pick to snap).
            // - The one fake ("18" after the miss) was the NEXT series' real
            //   yards-to-go (18.358 = 2nd & 19) arriving ~1.4 s before the
            //   down marker caught up - a transition race, never a kick.
            // So: latch when the divergence SUSTAINS (10 export cycles =
            // 2.5 s with an unchanged distance int - lineups hold for many
            // seconds, races die in under two) or a FIELD GOAL banner is
            // fresh (makes show instantly); and RETRACT a young latch whose
            // value turns out to be the new yards-to-go.
            bool slotStable = !double.IsNaN(preciseYards)
                && Math.Abs(preciseYards - lastPreciseSlotSample) < 0.05;
            bool slotHoldsKick = !double.IsNaN(preciseYards)
                && preciseYards >= 18 && preciseYards <= 120
                && Math.Abs(preciseYards - distanceYards) > 3;
            if (slotHoldsKick && slotStable && distanceYards == lastDistanceForStreak)
                fgDivergenceStreak++;
            else
                fgDivergenceStreak = slotHoldsKick ? 1 : 0;
            lastDistanceForStreak = distanceYards;
            if (!double.IsNaN(preciseYards)) lastPreciseSlotSample = preciseYards;
            bool sustained = fgDivergenceStreak >= 10;
            bool kickoffLike = String.Equals(downDistanceKind, "kickoff", StringComparison.Ordinal)
                || String.Equals(downDistanceKind, "conversion", StringComparison.Ordinal)
                || String.Equals(downDistanceKind, "twoPointConversion", StringComparison.Ordinal);
            // DIAGNOSTIC (2026-08-20): a 65-yard lineup sustained for 15 s
            // and still never latched - some input to this decision is not
            // what the outside data says it is. Log every input per cycle
            // while the slot looks kick-like, so the next lineup writes the
            // complete decision record.
            if (slotHoldsKick && fgLatchProbeEntries < 600)
            {
                fgLatchProbeEntries++;
                try
                {
                    AppendProbeLine(probeOutputSeedPath, "fg-latch-probe.jsonl",
                        new Dictionary<string, object>
                        {
                            { "t", now.ToString("o", CultureInfo.InvariantCulture) },
                            { "precise", Math.Round(preciseYards, 3) },
                            { "dist", distanceYards }, { "down", down },
                            { "kind", downDistanceKind ?? "" },
                            { "streak", fgDivergenceStreak },
                            { "stable", slotStable }, { "sustained", sustained },
                            { "textRecent", textRecent }, { "bannerFresh", bannerFresh },
                            { "kickoffLike", kickoffLike },
                            { "latched", latchedFieldGoalDistance }
                        });
                }
                catch { }
            }
            if ((!kickoffLike || bannerFresh) && slotHoldsKick
                && ((sustained && PreciseLooksLikeRealSpot(preciseYards)) || bannerFresh)
                && LooksLikeFieldGoalKick(preciseYards, distanceYards, down,
                    textRecent || bannerFresh || sustained))
            {
                int rounded = (int)Math.Round(preciseYards);
                // A NEW latch is the research moment: the kick length is known
                // right now, so a targeted pair scan can identify the objects
                // that also knew it at play-pick time.
                if (rounded != latchedFieldGoalDistance) pendingKickPairScanDistance = rounded;
                latchedFieldGoalDistance = rounded;
                latchedFieldGoalUtc = now;
            }
            // Retraction: a young latch whose value matches the now-settled
            // yards-to-go was the transition race, not a kick - pull it
            // before anyone reads it as one.
            if (latchedFieldGoalDistance > 0
                && now - latchedFieldGoalUtc <= TimeSpan.FromSeconds(6)
                && !double.IsNaN(preciseYards)
                && Math.Abs(preciseYards - distanceYards) <= 1
                && Math.Abs(distanceYards - latchedFieldGoalDistance) <= 1)
            {
                latchedFieldGoalDistance = 0;
                latchedFieldGoalUtc = DateTime.MinValue;
            }
            if (latchedFieldGoalDistance > 0 && now - latchedFieldGoalUtc <= FieldGoalLatchWindow)
                return latchedFieldGoalDistance;
            return null;
        }

        private static string OutputPath(string screenJsonPath)
        {
            string folder = !String.IsNullOrWhiteSpace(screenJsonPath) ? Path.GetDirectoryName(screenJsonPath) : null;
            if (String.IsNullOrWhiteSpace(folder)) folder = AppDomain.CurrentDomain.BaseDirectory;
            return Path.Combine(folder, "live-game-data.json");
        }

        internal static void WriteSharedText(string path, string text)
        {
            string directory = Path.GetDirectoryName(path);
            if (String.IsNullOrWhiteSpace(directory))
                directory = AppDomain.CurrentDomain.BaseDirectory;
            Directory.CreateDirectory(directory);
            string temporaryPath = Path.Combine(directory,
                Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(temporaryPath,
                    FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (StreamWriter writer = new StreamWriter(stream))
                    writer.Write(text);
                if (File.Exists(path))
                    File.Replace(temporaryPath, path, null, true);
                else
                    File.Move(temporaryPath, path);
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
        }

        private static string FormatClock(int totalSeconds)
        {
            totalSeconds = Math.Max(0, totalSeconds);
            return (totalSeconds / 60).ToString(CultureInfo.InvariantCulture) + ":" + (totalSeconds % 60).ToString("00", CultureInfo.InvariantCulture);
        }

        private static string FormatQuarter(int quarter)
        {
            if (quarter == 1) return "1st";
            if (quarter == 2) return "2nd";
            if (quarter == 3) return "3rd";
            if (quarter == 4) return "4th";
            if (quarter >= 5) return "OT";
            return "--";
        }

        private static string FormatDownDistance(int down, int distance)
        {
            string suffix = down == 1 ? "st" : (down == 2 ? "nd" : (down == 3 ? "rd" : "th"));
            return down >= 1 && down <= 4
                ? down.ToString(CultureInfo.InvariantCulture) + suffix + " & "
                    + (distance == 0 ? "Goal" : distance.ToString(CultureInfo.InvariantCulture))
                : "--";
        }

        private static string FormatSpecialDownDistance(int down, string distanceText)
        {
            string suffix = down == 1 ? "st" : (down == 2 ? "nd" : (down == 3 ? "rd" : "th"));
            return down.ToString(CultureInfo.InvariantCulture) + suffix + " & " + distanceText;
        }

        private sealed class ScoreHudDiscoveryResult
        {
            public readonly int ProcessId;
            public readonly int MatchupGeneration;
            public List<ScoreHudTeamCandidate> Teams;
            public List<ScoreHudDownDistanceCandidate> DownDistance;
            public List<ScoreHudMessageCandidate> Messages;

            public ScoreHudDiscoveryResult(int processId, int matchupGeneration)
            {
                ProcessId = processId;
                MatchupGeneration = matchupGeneration;
                Teams = new List<ScoreHudTeamCandidate>();
                DownDistance = new List<ScoreHudDownDistanceCandidate>();
                Messages = new List<ScoreHudMessageCandidate>();
            }
        }
    }

    internal sealed class RamReadResult
    {
        public readonly bool Available;
        public readonly int Value;
        public readonly int SuccessfulReads;
        public readonly int AgreeingCopies;
        public readonly int ConfiguredCopies;

        public RamReadResult(bool available, int value, int successfulReads, int agreeingCopies, int configuredCopies)
        {
            Available = available;
            Value = value;
            SuccessfulReads = successfulReads;
            AgreeingCopies = agreeingCopies;
            ConfiguredCopies = configuredCopies;
        }

        public static RamReadResult Missing(int configuredCopies)
        {
            return new RamReadResult(false, 0, 0, 0, configuredCopies);
        }

        public static RamReadResult Missing()
        {
            return Missing(0);
        }

        public Dictionary<string, object> ToDictionary()
        {
            return new Dictionary<string, object>
            {
                { "available", Available },
                { "value", Available ? (object)Value : null },
                { "successfulReads", SuccessfulReads },
                { "agreeingCopies", AgreeingCopies },
                { "configuredCopies", ConfiguredCopies }
            };
        }
    }

    internal sealed class RamTextResult
    {
        public readonly bool Available;
        public readonly string Value;
        public readonly int SuccessfulReads;
        public readonly int AgreeingCopies;
        public readonly int ConfiguredCopies;

        public RamTextResult(bool available, string value, int successfulReads, int agreeingCopies, int configuredCopies)
        {
            Available = available;
            Value = value;
            SuccessfulReads = successfulReads;
            AgreeingCopies = agreeingCopies;
            ConfiguredCopies = configuredCopies;
        }

        public static RamTextResult Missing(int configuredCopies, int successfulReads)
        {
            return new RamTextResult(false, null, successfulReads, 0, configuredCopies);
        }

        public static RamTextResult Missing(int configuredCopies)
        {
            return Missing(configuredCopies, 0);
        }
    }

    internal sealed class RamLiveProfile
    {
        public int ProcessId;
        public long ProcessStartUtcTicks;
        public string Scope;
        public string CreatedAt;
        public string SeedAwayTeamName;
        public string SeedHomeTeamName;
        public readonly Dictionary<string, List<long>> Fields = new Dictionary<string, List<long>>(StringComparer.OrdinalIgnoreCase);

        public static RamLiveProfile Load(string path)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> root = serializer.DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
            if (root == null) throw new InvalidOperationException("The RAM profile is not valid JSON.");
            RamLiveProfile result = new RamLiveProfile();
            result.ProcessId = Integer(root, "processId");
            result.ProcessStartUtcTicks = LongInteger(root, "processStartUtcTicks");
            result.Scope = Text(root, "scope");
            result.CreatedAt = Text(root, "createdAt");
            object seedValue;
            Dictionary<string, object> seed = root.TryGetValue("teamNameSeed", out seedValue) ? seedValue as Dictionary<string, object> : null;
            if (seed != null)
            {
                result.SeedAwayTeamName = Text(seed, "away");
                result.SeedHomeTeamName = Text(seed, "home");
            }
            object fieldsValue;
            Dictionary<string, object> fields = root.TryGetValue("fields", out fieldsValue) ? fieldsValue as Dictionary<string, object> : null;
            if (fields == null) throw new InvalidOperationException("The RAM profile has no fields object.");
            foreach (KeyValuePair<string, object> pair in fields)
            {
                List<long> addresses = new List<long>();
                IEnumerable values = pair.Value as IEnumerable;
                if (values != null && !(pair.Value is string))
                {
                    foreach (object value in values) addresses.Add(ParseAddress(Convert.ToString(value, CultureInfo.InvariantCulture)));
                }
                else addresses.Add(ParseAddress(Convert.ToString(pair.Value, CultureInfo.InvariantCulture)));
                result.Fields[pair.Key] = addresses;
            }
            return result;
        }

        public void Save(string path)
        {
            Dictionary<string, object> fields = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (KeyValuePair<string, List<long>> pair in Fields)
            {
                List<string> addresses = new List<string>();
                for (int index = 0; index < pair.Value.Count; index++)
                    addresses.Add("0x" + pair.Value[index].ToString("X", CultureInfo.InvariantCulture));
                fields[pair.Key] = addresses.ToArray();
            }
            Dictionary<string, object> root = new Dictionary<string, object>
            {
                { "profileVersion", 3 },
                { "processId", ProcessId },
                { "processStartUtcTicks", ProcessStartUtcTicks },
                { "scope", Scope },
                { "createdAt", CreatedAt },
                { "teamNameSeed", new Dictionary<string, object>
                    {
                        { "away", SeedAwayTeamName ?? String.Empty },
                        { "home", SeedHomeTeamName ?? String.Empty }
                    }
                },
                { "fields", fields }
            };
            string directory = Path.GetDirectoryName(path);
            if (!String.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
            string json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue }.Serialize(root);
            using (FileStream stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read | FileShare.Delete))
            using (StreamWriter writer = new StreamWriter(stream)) writer.Write(json);
        }

        private static long ParseAddress(string text)
        {
            string value = (text ?? String.Empty).Trim();
            if (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) value = value.Substring(2);
            ulong parsed;
            if (!UInt64.TryParse(value, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out parsed))
                throw new InvalidOperationException("Invalid RAM address: " + text);
            return unchecked((long)parsed);
        }

        private static int Integer(Dictionary<string, object> map, string key)
        {
            object value;
            int result;
            return map.TryGetValue(key, out value) && Int32.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out result) ? result : 0;
        }

        private static long LongInteger(Dictionary<string, object> map, string key)
        {
            object value;
            long result;
            return map.TryGetValue(key, out value)
                && Int64.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out result)
                ? result : 0;
        }

        private static string Text(Dictionary<string, object> map, string key)
        {
            object value;
            return map.TryGetValue(key, out value) && value != null ? Convert.ToString(value, CultureInfo.InvariantCulture) : String.Empty;
        }
    }
}





