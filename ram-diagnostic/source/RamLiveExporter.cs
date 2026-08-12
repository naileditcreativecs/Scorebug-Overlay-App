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
        private int pendingAwayScoreHudTeamId = -1;
        private int pendingHomeScoreHudTeamId = -1;
        private int pendingAwayScoreHudRank = -1;
        private int pendingHomeScoreHudRank = -1;
        private long pendingAwayScoreHudAddress;
        private long pendingHomeScoreHudAddress;
        private int scoreHudOrientationConfirmations;
        private bool matchupTransitionPending;
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

        public RamLiveExporter(MemoryScanner scanner, string profilePath)
        {
            this.scanner = scanner;
            this.profilePath = profilePath;
        }

        public void Reset()
        {
            profile = null;
            profileWriteTimeUtc = DateTime.MinValue;
            lastAwayTeamName = null;
            lastHomeTeamName = null;
            teamKeyNames = null;
            nextAwayAssetScanUtc = DateTime.MinValue;
            lastAwayAssetResult = RamTextResult.Missing(0);
            resolvedProcessId = 0;
            attachedProcessStartUtcTicks = CurrentProcessStartUtcTicks();
            discoveryAttemptProcessId = 0;
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

        public string Refresh(LiveScoreboard screen, string screenJsonPath)
        {
            // The shipped overlay is RAM-only. Never let a stale/blank screen
            // snapshot influence discovery, validation, or published fields.
            screen = null;
            if (scanner.Process == null || scanner.Process.HasExited)
                return "RAM export: waiting for CollegeFB27.exe";

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
            if (resolvedProcessId != scanner.Process.Id
                && IsCompatibleAutomaticProfileScope(profile.Scope)
                && ((profile.ProcessId == scanner.Process.Id && CurrentProcessIdentityMatchesProfile())
                    || canRecoverDuringSpecialState))
            {
                PrepareRestoredMatchupState();
                // The game process can outlive the overlay and retain a fully
                // readable prior-game core. Static cache readabilityâ€”even with
                // an agreeing legacy recordâ€”is not current-game proof. Drop all
                // addresses and force the same live-progression discovery used
                // on a cold process attach. A paused restart intentionally stays
                // blank until gameplay moves.
                ClearStaleOutput(screenJsonPath);
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
                autoDiscoverySummary = "same-process cache discarded; waiting for live progression";
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
                RunAutomaticDiscovery(screen);
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
            // The presentation-clone byte flickers without a real possession
            // change. Publish only an independently synchronized legacy record;
            // otherwise leave possession unavailable rather than guess.
            RamReadResult possession = ReadVerifiedPossession(rawPossession);
            RamReadResult down = Read("down", 1, 4);
            RamReadResult distance = Read("distance", 0, 99);
            RamReadResult stableDownRead;
            RamReadResult stableDistanceRead;
            StabilizeDownDistance(down, distance, out stableDownRead, out stableDistanceRead);
            ApplyOrientedTimeoutFields();
            RamReadResult homeTimeouts = Read("homeTimeouts", 0, 3);
            RamReadResult awayTimeouts = Read("awayTimeouts", 0, 3);
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
            if (quarter.Available && gameClock.Available
                && homeScore.Available && awayScore.Available
                && !StateProgressIsLogical(quarter.Value, gameClock.Value, homeScore.Value, awayScore.Value))
            {
                ClearStaleOutput(screenJsonPath);
                InvalidateProfile("game state moved backward or reset");
                return "RAM export: game state reset detected; locating again";
            }

            Dictionary<string, object> root = new Dictionary<string, object>();
            root["schemaVersion"] = 1;
            root["status"] = "live";
            root["updatedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            root["process"] = new Dictionary<string, object>
            {
                { "name", scanner.Process.ProcessName },
                { "id", scanner.Process.Id },
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
            string publishedAwayName = matchupTransitionPending ? null : lastAwayTeamName;
            string publishedHomeName = matchupTransitionPending ? null : lastHomeTeamName;
            ram["awayTeamName"] = TeamNameDictionary(publishedAwayName, publishedAwayRead);
            ram["homeTeamName"] = TeamNameDictionary(publishedHomeName, publishedHomeRead);
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
                    if (TryParseNumericScoreHudDisplay(scoreHudDisplay, out displayedDown, out displayedDistance)
                        && stableDownRead.Available && stableDistanceRead.Available
                        && displayedDown == stableDownRead.Value
                        && displayedDistance == stableDistanceRead.Value)
                    {
                        exportedDown = displayedDown;
                        exportedDistance = displayedDistance;
                        downDistanceKind = "numeric";
                        downDistanceText = FormatDownDistance(displayedDown, displayedDistance);
                    }
                }
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
                { "downDistanceSource", downDistanceKind != "numeric" || (stableDownRead.Available && stableDistanceRead.Available) ? "ram" : "screen" }
            };

            root["discovery"] = new Dictionary<string, object>
            {
                { "workingRamFields", new string[] { "awayTeamName", "homeTeamName", "awayRank", "homeRank", "awayRecord", "homeRecord", "awayScore", "homeScore", "quarter", "gameClock", "playClock", "possession", "down", "distance", "specialDownState", "homeTimeouts", "awayTimeouts" } },
                { "screenBackedFields", new string[0] },
                { "remainingRamWork", new string[0] },
                { "automaticLocator", autoDiscoverySummary },
                { "timeoutBind", timeoutBindDiagnostic },
                { "timeoutInstall", timeoutInstallDiagnostic },
                { "timeoutCatalog", catalogTimeoutDiagnostic },
                { "rankBind", rankBindDiagnostic },
                { "teamIdNames", teamIdNamesDiagnostic },
                { "teamRole", teamRoleDiagnostic },
                { "matchupBind", matchupBindDiagnostic },
                { "possessionBind", possessionBindDiagnostic },
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
                "RAM export LIVE: {0} {1} | play {2} | {3} | possession {4} | timeouts away {5}, home {6} | {7}",
                FormatQuarter(quarterValue), FormatClock(clockValue), playClockValue, downDistanceText,
                possession.Available ? (awayPossession ? "away" : "home") : "unknown",
                awayTimeouts.Available ? awayTimeouts.Value.ToString(CultureInfo.InvariantCulture) : "?",
                homeTimeouts.Available ? homeTimeouts.Value.ToString(CultureInfo.InvariantCulture) : "?",
                outputPath);
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
            lock (scoreHudDiscoverySync)
            {
                scoreHudDiscoveryRequested = true;
                if (scoreHudDiscoveryRunning || DateTime.UtcNow < nextScoreHudDiscoveryUtc) return;
                scoreHudDiscoveryRunning = true;
                generation = scoreHudDiscoveryGeneration;
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
                        ScoreHudDiscoveryResult collected = new ScoreHudDiscoveryResult(processId);
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
        // Bounded retries for the ScoreHud-derived fields, reset per matchup.
        private const int MaximumScoreHudRecoveryAttempts = 18;
        private int scoreHudRecoveryAttempts;
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
            if (result == null || scanner.Process == null || scanner.Process.Id != result.ProcessId)
                return null;

            RememberScoreHudMessages(result.Messages);
            scoreHudTeamCandidateCount = result.Teams.Count;
            scoreHudDownDistanceCandidateCount = result.DownDistance.Count;
            ApplyScoreHudRankCandidates(result.Teams);
            if (result.DownDistance.Count == 0) return null;

            ScoreHudDownDistanceCandidate selected = SelectCurrentScoreHudDownDistance(result.DownDistance);
            List<long> addresses = new List<long>();
            for (int index = 0; index < result.DownDistance.Count; index++)
            {
                long address = result.DownDistance[index].Address;
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
                        && (!numericDistance.Available || displayedDistance == numericDistance.Value);
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

        private void RememberScoreHudMessages(List<ScoreHudMessageCandidate> messages)
        {
            if (messages == null || messages.Count == 0) return;
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
            candidate = null;
            List<long> addresses;
            if (profile == null || !profile.Fields.TryGetValue(fieldName, out addresses)
                || addresses == null || addresses.Count != 1) return false;
            long objectAddress = addresses[0] - 44;
            try { return scanner.TryReadLiveScoreHudTeamCandidate(objectAddress, out candidate); }
            catch { return false; }
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

        private void ApplyScoreHudRankCandidates(List<ScoreHudTeamCandidate> teams)
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
            // The protections that actually matter are kept: a pending matchup
            // transition still blocks, orientation is still keyed to TeamId so a
            // different matchup cannot inherit it, and a fresh orientation still
            // needs distinct scores or a confirmed possession plus repeated
            // agreement before it binds.
            if (matchupTransitionPending)
            {
                rankBindDiagnostic = "waiting: matchup transition pending";
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
                    rankBindDiagnostic = "lost bind: no candidate matches team ids "
                        + orientedAwayScoreHudTeamId + "/" + orientedHomeScoreHudTeamId
                        + " among " + teams.Count + " objects";
                    return;
                }
            }
            else
            {
                if (!TrySelectFreshScoreHudSides(teams, awayScore, homeScore, possession,
                    out away, out home, out distinctScoreEvidence))
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
                int requiredConfirmations = distinctScoreEvidence ? 1 : 3;
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

            rankBindDiagnostic = "bound (away rank " + away.Rank + " record "
                + (FormatTeamRecord(away.Wins, away.Losses, away.Ties) ?? "?")
                + ", home rank " + home.Rank + " record "
                + (FormatTeamRecord(home.Wins, home.Losses, home.Ties) ?? "?") + ")";
            SetField("awayRank", new long[] { away.Address + 44 });
            SetField("homeRank", new long[] { home.Address + 44 });
            lastAwayRank = away.Rank;
            lastHomeRank = home.Rank;
            lastAwayRecord = FormatTeamRecord(away.Wins, away.Losses, away.Ties);
            lastHomeRecord = FormatTeamRecord(home.Wins, home.Losses, home.Ties);
            lastAwayRankGeneration = matchupGeneration;
            lastHomeRankGeneration = matchupGeneration;
            ApplyOrientedTimeoutFields(away, home);
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
                return RuntimeCatalogTimeoutReadsAreSafe(
                    true, cloneHome, cloneAway,
                    firstHome, firstAway, secondHome, secondAway);
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

        private RamReadResult ReadVerifiedPossession()
        {
            return ReadVerifiedPossession(Read("possessionAwayIsOne", 0, 2));
        }

        private RamReadResult ReadVerifiedPossession(RamReadResult raw)
        {
            return SelectVerifiedPossession(
                RamReadResult.Missing(0), raw, PossessionVerificationRecordAgrees());
        }

        internal static RamReadResult SelectVerifiedPossession(
            RamReadResult clone, RamReadResult legacy, bool legacyVerified)
        {
            // `clone` remains in this test seam so old diagnostics can prove
            // that the transient presentation byte is deliberately ignored.
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
            pendingAwayScoreHudTeamId = -1;
            pendingHomeScoreHudTeamId = -1;
            pendingAwayScoreHudRank = -1;
            pendingHomeScoreHudRank = -1;
            pendingAwayScoreHudAddress = 0;
            pendingHomeScoreHudAddress = 0;
            scoreHudOrientationConfirmations = 0;
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
                else separator = true;
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
            public List<ScoreHudTeamCandidate> Teams;
            public List<ScoreHudDownDistanceCandidate> DownDistance;
            public List<ScoreHudMessageCandidate> Messages;

            public ScoreHudDiscoveryResult(int processId)
            {
                ProcessId = processId;
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




