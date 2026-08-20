using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CollegeFootballRamDiagnostic
{
    // Which game this reader is attached to. CFB27 is the default and is the
    // only game with proven memory signatures; Madden 27 support is
    // EXPERIMENTAL groundwork - the reader attaches and runs its automatic
    // pattern locator, but the ScoreHud object offsets are unknown (zero =
    // skip that subsystem) until probe games map them. Selected with the
    // "--game madden27" argument; anything else leaves CFB27 untouched.
    internal static class GameProfile
    {
        public static string Key = "cfb27";
        public static string ProcessName = "CollegeFB27";
        // ScoreHud vtable offsets from the module base. Zero disables the
        // ScoreHud sweep for that object type (fail closed, no guessing).
        public static long ScoreHudTeamVtableOffset = 0xB0F3168L;
        public static long ScoreHudDownDistanceVtableOffset = 0xB0F3128L;
        public static long ScoreHudMessageVtableOffset = 0xB0F3368L;
        public static long ScoreHudStatLineVtableOffset = 0xB0F3148L;
        public static long ScoreHudStatSummaryVtableOffset = 0xB0F3388L;
        // Player identity tokens ("AbshireCameron_33901") live on this type
        // right next to the stat banners (probe 2026-08-18) - the likely
        // source of the missing passing/rushing player names.
        public static long ScoreHudIdentityVtableOffset = 0xB0F31A8L;
        // Madden only: the scoreboard ticker object that carries per-team
        // records and Madden's own team stat lines (capture round 7).
        public static long MaddenTickerVtableOffset = 0;
        public static long ScoreHudDownDistanceTypeInfoOffset = 0xE158810L;
        public static long ScoreHudTeamTypeInfoOffset = 0xE158930L;
        public static long ScoreHudMessageTypeInfoOffset = 0xE159488L;
        public static long ScoreHudAlertVtableOffset = 0xB0F3268L;
        public static long ScoreHudAlertTypeInfoOffset = 0xE158DB0L;

        // A game title update recompiles the exe and every one of the offsets
        // above goes stale at once - the sweep silently finds nothing (first
        // hit: the 2026-08-20 patch). The vtables all move together (.rdata)
        // and the typeinfo statics all move together (.data), so two deltas
        // re-derived from ONE live object rebase the whole family. Zero
        // offsets stay zero: they mean "subsystem disabled", not an address.
        public static void ApplyScoreHudRebase(long vtableDelta, long typeInfoDelta)
        {
            if (ScoreHudTeamVtableOffset != 0) ScoreHudTeamVtableOffset += vtableDelta;
            if (ScoreHudDownDistanceVtableOffset != 0) ScoreHudDownDistanceVtableOffset += vtableDelta;
            if (ScoreHudMessageVtableOffset != 0) ScoreHudMessageVtableOffset += vtableDelta;
            if (ScoreHudStatLineVtableOffset != 0) ScoreHudStatLineVtableOffset += vtableDelta;
            if (ScoreHudStatSummaryVtableOffset != 0) ScoreHudStatSummaryVtableOffset += vtableDelta;
            if (ScoreHudIdentityVtableOffset != 0) ScoreHudIdentityVtableOffset += vtableDelta;
            if (ScoreHudAlertVtableOffset != 0) ScoreHudAlertVtableOffset += vtableDelta;
            if (ScoreHudDownDistanceTypeInfoOffset != 0) ScoreHudDownDistanceTypeInfoOffset += typeInfoDelta;
            if (ScoreHudTeamTypeInfoOffset != 0) ScoreHudTeamTypeInfoOffset += typeInfoDelta;
            if (ScoreHudMessageTypeInfoOffset != 0) ScoreHudMessageTypeInfoOffset += typeInfoDelta;
            if (ScoreHudAlertTypeInfoOffset != 0) ScoreHudAlertTypeInfoOffset += typeInfoDelta;
        }

        // Reads "--game <key>" from anywhere in the argument list. Unknown
        // keys are ignored so a typo can never change how CFB27 reads.
        public static void ApplyArguments(string[] args)
        {
            if (args == null) return;
            for (int index = 0; index < args.Length - 1; index++)
            {
                if (!String.Equals(args[index], "--game", StringComparison.OrdinalIgnoreCase)) continue;
                string key = (args[index + 1] ?? "").Trim().ToLowerInvariant();
                if (key == "madden27")
                {
                    Key = "madden27";
                    ProcessName = "Madden27";
                    ScoreHudTeamVtableOffset = 0;
                    ScoreHudDownDistanceVtableOffset = 0;
                    ScoreHudMessageVtableOffset = 0;
                    ScoreHudStatLineVtableOffset = 0;
                    ScoreHudStatSummaryVtableOffset = 0;
                    ScoreHudIdentityVtableOffset = 0;
                    ScoreHudDownDistanceTypeInfoOffset = 0;
                    ScoreHudTeamTypeInfoOffset = 0;
                    ScoreHudMessageTypeInfoOffset = 0;
                    ScoreHudAlertVtableOffset = 0;
                    ScoreHudAlertTypeInfoOffset = 0;
                    MaddenTickerVtableOffset = 0xCAE8DC4L;
                }
                return;
            }
        }
    }

    internal enum ScanComparison
    {
        Exact,
        Changed,
        Unchanged,
        Increased,
        Decreased
    }

    internal sealed class MemoryCandidate
    {
        public long Address;
        public int LastValue;
    }

    internal sealed class ScanProgress
    {
        public long BytesRead;
        public long TotalBytes;
        public int CandidateCount;
        public string Region;
    }

    internal sealed class MemoryLayout
    {
        public int RegionCount;
        public long TotalBytes;
        public bool SampleReadPassed;
    }

    internal sealed class RamAutoDiscovery
    {
        // DIAGNOSTIC. Possession is only ever taken from a "legacy" scoreboard
        // record that independently agrees with the moving wide record. When no
        // such pair exists there is no possession address at all, which reads
        // downstream as simply "unavailable" with no way to tell whether the
        // legacy record is absent or merely disagreeing. This records which.
        public string PossessionDiagnostic = "not evaluated";
        public long ScoreboardBlock;
        public bool UsesWideScoreboardLayout;
        public long VerificationScoreboardBlock;
        public bool VerificationUsesWideScoreboardLayout;
        public long TentativeWideScoreboardBlock;
        public int ScoreboardCandidateCount;
        public readonly List<RamScoreboardSnapshot> ScoreboardCandidates = new List<RamScoreboardSnapshot>();
        public readonly List<long> HomeTimeoutAddresses = new List<long>();
        public readonly List<long> AwayTimeoutAddresses = new List<long>();
        // The exact timeout-clone structure also carries a dedicated
        // is-home-team-in-possession byte at +0x31. Keep it separate from
        // legacy possession pointers because its encoding is 0=away, 1=home.
        public readonly List<long> TimeoutCloneHomePossessionAddresses = new List<long>();
        public readonly List<long> LivePossessionAddresses = new List<long>();
        public readonly List<long> LiveDownAddresses = new List<long>();
        public readonly List<long> LiveDistanceAddresses = new List<long>();
        public readonly List<RamTimeoutSnapshot> TimeoutCandidates = new List<RamTimeoutSnapshot>();
        public long TeamCatalogBase;
        public int TeamCatalogLength;
        public readonly List<long> HomeTeamNameAddresses = new List<long>();
        public readonly List<long> AwayTeamNameAddresses = new List<long>();
        public long AwayTeamAssetPoolBase;
        public int AwayTeamAssetPoolLength;
        public long TeamRoleAllocationBase;
        public long AwayTeamRoleLabelAddress;
        public long HomeTeamRoleLabelAddress;
        public long AwayTeamRoleReferenceAddress;
        public long HomeTeamRoleReferenceAddress;
        public long AwayTeamRoleDescriptorAddress;
        public long HomeTeamRoleDescriptorAddress;
        public long AwayTeamRoleVectorAddress;
        public long HomeTeamRoleVectorAddress;
        public bool TeamRoleEvidenceAmbiguous;
        public string HomeTeamName;
        public string AwayTeamName;
        public long HomeTeamMarkerAddress;
        public readonly Dictionary<string, int> TeamNameCandidateCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        public readonly List<string> ActiveTraditionSlugs = new List<string>();
        public readonly List<string> TeamRoleDiagnostics = new List<string>();
        public int RegionsScanned;
        public long BytesScanned;

        // Set when the team names came from the older pool analysis instead
        // of the labelled role vectors. Kept separate so the exporter can
        // apply the extra confirmation these addresses need.
        public bool TeamNamesFromFallback;

        public bool HasCoreScoreboard { get { return ScoreboardBlock != 0; } }
        public bool HasLabeledTeamRoleBinding
        {
            get
            {
                return TeamRoleAllocationBase != 0
                    && AwayTeamRoleLabelAddress != 0 && HomeTeamRoleLabelAddress != 0
                    && AwayTeamRoleReferenceAddress != 0 && HomeTeamRoleReferenceAddress != 0
                    && AwayTeamRoleDescriptorAddress != 0 && HomeTeamRoleDescriptorAddress != 0
                    && AwayTeamRoleVectorAddress != 0 && HomeTeamRoleVectorAddress != 0;
            }
        }
    }

    internal sealed class RamScoreboardSnapshot
    {
        public long Address;
        public int Score;
        public int Quarter;
        public int Clock;
        public int PlayClock;
        public int HomeScore;
        public int AwayScore;
        public int Possession;
        public int Down;
        public int Distance;
        public bool UsesWideLayout;
        public bool LiveChangeObserved;
    }

    internal sealed class RamTimeoutSnapshot
    {
        public long Address;
        public int Similarity;
        public int Home;
        public int Away;
    }

    internal sealed class ManualValueCluster
    {
        public long AnchorAddress;
        public readonly Dictionary<int, List<long>> Matches = new Dictionary<int, List<long>>();
    }

    internal sealed class RankOrderCandidate
    {
        public long RankOneTeamField;
        public int Stride;
        public int Matched;
    }

    internal sealed class RankPairOffsetCandidate
    {
        public int Delta;
        public int Count;
        public readonly List<long> AwayAddresses = new List<long>();
    }

    internal sealed class RankFieldLayoutCandidate
    {
        public long BaseAddress;
        public long FirstPointer;
    }

    internal sealed class RankPairContextCandidate
    {
        public long AwayAddress;
        public int Delta;
        public ulong RawHash;
        public ulong PointerNormalizedHash;
        public ulong ShapeHash;
    }

    internal sealed class ScoreHudTeamCandidate
    {
        public long Address;
        public long TypePointer;
        public long RuntimeTypeInfo;
        public long Header;
        public long DisplayPointer;
        public int Color;
        public int TeamId;
        // Rank is normalised: 1-25 for a ranked team, 0 for anything else.
        // RawRank keeps whatever the game actually stored, because "unranked"
        // is not necessarily zero and we need to be able to see what it is.
        public int Rank;
        public int RawRank;
        public int Ties;
        public int Timeouts;
        public int Losses;
        public int Score;
        public int Challenges;
        public int Wins;
        public int HasPossession;
        public int IsTeambuilder;
    }

    internal sealed class ScoreHudDownDistanceCandidate
    {
        public long Address;
        public long Header;
        public long DisplayPointer;
        public string Display;
        public int Down;
        public int Distance;
        public int Style;
        public bool IsEmpty;
    }

    internal sealed class ScoreHudAlertCandidate
    {
        public long Address;
        public long Header;
        public long TextPointer;
        public string Text;
    }

    // A ScoreHud presentation object of a type the reader does not decode
    // field-by-field yet - the stat lower-thirds ("T.Dixon 4 Rec, 60 Yds, 1
    // TD", "29 YDS, 0 TDs, 0 INTs") seen in the 2026-08-18 probe game. Passed
    // through as text so bugs can show them and so the layout can be learned.
    internal sealed class ScoreHudTextCandidate
    {
        public long Address;
        public string Kind;          // vtable offset, e.g. "0xB0F3148"
        public List<string> Texts = new List<string>();
        public int PlayerId;         // int at +48 (same slot as messages) - unverified
        public int TeamId;           // int at +52 (same slot as messages) - unverified
        public int DisplayTime;      // int at +56
    }

    internal sealed class ScoreHudMessageCandidate
    {
        public long Address;
        public long Header;
        public long DisplayTextPointer;
        public long InfoTextPointer;
        public string DisplayText;
        public string InfoText;
        public int MessageId;
        public int Color;
        public int PlayerId;
        public int TeamId;
        public int DisplayTime;
    }

    internal sealed class ScoreHudRebaseCandidate
    {
        public long VtableOffset;
        public long TypeInfoOffset;
        public int Matches;
        public string Display;
    }

    internal sealed class TypeInfoHeadCandidate
    {
        public long SignatureAddress;
        public long GlobalAddress;
        public long HeadPointer;
    }

    internal sealed class MemoryScanner : IDisposable
    {
        private const uint ProcessVmRead = 0x0010;
        private const uint ProcessQueryInformation = 0x0400;
        private const uint MemCommit = 0x1000;
        private const uint MemPrivate = 0x20000;
        private const uint PageNoAccess = 0x01;
        private const uint PageGuard = 0x100;
        private const int ChunkSize = 1024 * 1024;
        private const int PageSize = 4096;
        private const int MaximumCandidates = 12000000;
        private static readonly byte[] TimeoutContextPattern = Convert.FromBase64String(
            "AAAAAP7///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8PAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAgEE=");

        private IntPtr processHandle = IntPtr.Zero;
        private Process process;
        private List<MemoryCandidate> candidates = new List<MemoryCandidate>();

        public int CandidateCount { get { return candidates.Count; } }
        public Process Process { get { return process; } }

        public void Attach(Process target)
        {
            DisposeHandle();
            if (target == null) throw new ArgumentNullException("target");
            processHandle = NativeMethods.OpenProcess(ProcessVmRead | ProcessQueryInformation, false, target.Id);
            if (processHandle == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows would not grant read-only access to " + GameProfile.ProcessName + ".exe.");
            }
            process = target;
            candidates.Clear();
        }

        public void Reset()
        {
            candidates.Clear();
        }

        public MemoryLayout ProbeLayout()
        {
            EnsureAttached();
            List<MemoryRegion> regions = EnumerateRegions();
            MemoryLayout result = new MemoryLayout();
            result.RegionCount = regions.Count;
            for (int i = 0; i < regions.Count; i++) result.TotalBytes += regions[i].Size;
            if (regions.Count > 0)
            {
                byte[] sample = new byte[4];
                result.SampleReadPassed = Read(regions[0].BaseAddress, sample, sample.Length) > 0;
            }
            return result;
        }

        public List<MemoryCandidate> SnapshotCandidates(int maximum)
        {
            int count = Math.Min(Math.Max(0, maximum), candidates.Count);
            List<MemoryCandidate> copy = new List<MemoryCandidate>(count);
            for (int i = 0; i < count; i++)
            {
                copy.Add(new MemoryCandidate { Address = candidates[i].Address, LastValue = candidates[i].LastValue });
            }
            return copy;
        }

        public void FirstScan(int expected, double tolerance, CancellationToken token, Action<ScanProgress> progress)
        {
            EnsureAttached();
            List<MemoryRegion> regions = EnumerateRegions();
            long total = 0;
            for (int i = 0; i < regions.Count; i++) total += regions[i].Size;
            long completed = 0;
            List<MemoryCandidate> found = new List<MemoryCandidate>();
            byte[] buffer = new byte[ChunkSize];

            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long offset = 0;
                while (offset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int requested = (int)Math.Min(buffer.Length, region.Size - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead >= 4)
                    {
                        int alignment = (int)((4 - ((region.BaseAddress + offset) & 3)) & 3);
                        for (int index = alignment; index <= bytesRead - 4; index += 4)
                        {
                            int value = buffer[index]
                                | (buffer[index + 1] << 8)
                                | (buffer[index + 2] << 16)
                                | (buffer[index + 3] << 24);
                            if (Math.Abs((double)value - expected) <= tolerance)
                            {
                                found.Add(new MemoryCandidate { Address = region.BaseAddress + offset + index, LastValue = value });
                                if (found.Count >= MaximumCandidates)
                                {
                                    throw new InvalidOperationException("The scan found more than 12 million candidates. Choose a less common value, such as a non-zero score or the game clock, then scan again.");
                                }
                            }
                        }
                    }
                    offset += requested;
                    completed += requested;
                    if (progress != null && (completed % (32L * 1024 * 1024) < requested))
                    {
                        progress(new ScanProgress { BytesRead = completed, TotalBytes = total, CandidateCount = found.Count, Region = FormatAddress(region.BaseAddress) });
                    }
                }
            }
            candidates = found;
            if (progress != null) progress(new ScanProgress { BytesRead = total, TotalBytes = total, CandidateCount = found.Count, Region = "complete" });
        }

        public void FirstScanBelow(int expected, double tolerance, long exclusiveMaximumAddress,
            CancellationToken token, int alignmentModulo = 1, int alignmentRemainder = 0,
            int secondAlignmentRemainder = -1)
        {
            EnsureAttached();
            if (alignmentModulo < 1) throw new ArgumentOutOfRangeException("alignmentModulo");
            if (alignmentRemainder < 0 || alignmentRemainder >= alignmentModulo)
                throw new ArgumentOutOfRangeException("alignmentRemainder");
            if (secondAlignmentRemainder >= alignmentModulo)
                throw new ArgumentOutOfRangeException("secondAlignmentRemainder");
            List<MemoryRegion> regions = EnumerateRegions();
            List<MemoryCandidate> found = new List<MemoryCandidate>();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= exclusiveMaximumAddress) continue;
                long readableSize = Math.Min(region.Size, exclusiveMaximumAddress - region.BaseAddress);
                long offset = 0;
                while (offset < readableSize)
                {
                    token.ThrowIfCancellationRequested();
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead >= 4)
                    {
                        int alignment = (int)((4 - ((region.BaseAddress + offset) & 3)) & 3);
                        for (int index = alignment; index <= bytesRead - 4; index += 4)
                        {
                            long candidateAddress = region.BaseAddress + offset + index;
                            long remainder = candidateAddress % alignmentModulo;
                            if (remainder != alignmentRemainder
                                && remainder != secondAlignmentRemainder) continue;
                            int value = BitConverter.ToInt32(buffer, index);
                            if (Math.Abs((double)value - expected) > tolerance) continue;
                            found.Add(new MemoryCandidate { Address = candidateAddress, LastValue = value });
                            if (found.Count >= MaximumCandidates)
                                throw new InvalidOperationException("The low-memory scan still found more than 12 million candidates.");
                        }
                    }
                    offset += requested;
                }
            }
            candidates = found;
        }

        public void NextScan(ScanComparison comparison, int expected, double tolerance, CancellationToken token, Action<ScanProgress> progress)
        {
            EnsureAttached();
            List<MemoryCandidate> kept = new List<MemoryCandidate>();
            byte[] page = new byte[PageSize];
            int index = 0;
            while (index < candidates.Count)
            {
                token.ThrowIfCancellationRequested();
                long pageBase = candidates[index].Address & ~(PageSize - 1L);
                int bytesRead = Read(pageBase, page, page.Length);
                while (index < candidates.Count && (candidates[index].Address & ~(PageSize - 1L)) == pageBase)
                {
                    MemoryCandidate candidate = candidates[index++];
                    int pageOffset = (int)(candidate.Address - pageBase);
                    if (pageOffset >= 0 && pageOffset <= bytesRead - 4)
                    {
                        int value = page[pageOffset]
                            | (page[pageOffset + 1] << 8)
                            | (page[pageOffset + 2] << 16)
                            | (page[pageOffset + 3] << 24);
                        if (ValueMatches(candidate.LastValue, value, comparison, tolerance, expected))
                        {
                            candidate.LastValue = value;
                            kept.Add(candidate);
                        }
                    }
                }
                if (progress != null && (index % 100000 < 100))
                {
                    progress(new ScanProgress { BytesRead = index, TotalBytes = candidates.Count, CandidateCount = kept.Count, Region = FormatAddress(pageBase) });
                }
            }
            candidates = kept;
            if (progress != null) progress(new ScanProgress { BytesRead = index, TotalBytes = index, CandidateCount = kept.Count, Region = "complete" });
        }

        public static bool ValueMatches(int previous, int current, ScanComparison comparison, double tolerance)
        {
            return ValueMatches(previous, current, comparison, tolerance, current);
        }

        public static bool ValueMatches(int previous, int current, ScanComparison comparison, double tolerance, int expected)
        {
            switch (comparison)
            {
                case ScanComparison.Exact: return Math.Abs((double)current - expected) <= tolerance;
                case ScanComparison.Changed: return current != previous;
                case ScanComparison.Unchanged: return current == previous;
                case ScanComparison.Increased: return current > previous;
                case ScanComparison.Decreased: return current < previous;
                default: return false;
            }
        }

        public string ModuleOffset(long address)
        {
            try
            {
                ProcessModule module = process.MainModule;
                long start = module.BaseAddress.ToInt64();
                long end = start + module.ModuleMemorySize;
                return address >= start && address < end ? "+0x" + (address - start).ToString("X", CultureInfo.InvariantCulture) : "heap/private";
            }
            catch
            {
                return "unknown";
            }
        }

        public int ReadInt32(long address)
        {
            byte[] bytes = new byte[4];
            int count = Read(address, bytes, bytes.Length);
            if (count != 4) throw new Win32Exception("Could not read the selected address.");
            return BitConverter.ToInt32(bytes, 0);
        }

        public long ReadInt64(long address)
        {
            byte[] bytes = new byte[8];
            int count = Read(address, bytes, bytes.Length);
            if (count != 8) throw new Win32Exception("Could not read the selected address.");
            return BitConverter.ToInt64(bytes, 0);
        }

        public string ReadAsciiString(long address, int maximumLength)
        {
            if (maximumLength < 1 || maximumLength > 512) throw new ArgumentOutOfRangeException("maximumLength");
            byte[] bytes = new byte[maximumLength];
            int count = Read(address, bytes, bytes.Length);
            if (count <= 0) throw new Win32Exception("Could not read the selected text address.");
            int length = 0;
            while (length < count && bytes[length] != 0)
            {
                if (bytes[length] < 32 || bytes[length] > 126) break;
                length++;
            }
            return System.Text.Encoding.ASCII.GetString(bytes, 0, length).Trim();
        }

        public byte[] ReadBytes(long address, int length)
        {
            if (length < 1 || length > 4 * 1024 * 1024) throw new ArgumentOutOfRangeException("length");
            byte[] bytes = new byte[length];
            int count = Read(address, bytes, bytes.Length);
            if (count <= 0) throw new Win32Exception("Could not read the selected memory range.");
            if (count != bytes.Length) Array.Resize(ref bytes, count);
            return bytes;
        }

        public bool LabeledTeamRoleBindingMatches(long allocationBase,
            long awayLabelAddress, long homeLabelAddress,
            long awayReferenceAddress, long homeReferenceAddress,
            long awayDescriptorAddress, long homeDescriptorAddress,
            long awayVectorAddress, long homeVectorAddress,
            long awayTeamNameAddress, long homeTeamNameAddress,
            string expectedAwayTeam, string expectedHomeTeam)
        {
            EnsureAttached();
            if (allocationBase == 0 || String.IsNullOrWhiteSpace(expectedAwayTeam)
                || String.IsNullOrWhiteSpace(expectedHomeTeam)) return false;
            byte[] awayLabel = Encoding.ASCII.GetBytes("Team Away");
            byte[] homeLabel = Encoding.ASCII.GetBytes("Team Home");
            if (!ExactStandaloneAsciiMatches(awayLabelAddress, awayLabel, allocationBase, null)
                || !ExactStandaloneAsciiMatches(homeLabelAddress, homeLabel, allocationBase, null)) return false;
            Dictionary<string, string> noCatalog = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            LabeledVectorRoleReference away;
            LabeledVectorRoleReference home;
            if (!TryReadStableLabeledVectorReference(awayReferenceAddress, awayLabelAddress,
                    allocationBase, noCatalog, null, out away)
                || !TryReadStableLabeledVectorReference(homeReferenceAddress, homeLabelAddress,
                    allocationBase, noCatalog, null, out home)) return false;
            return away.DescriptorAddress == awayDescriptorAddress
                && home.DescriptorAddress == homeDescriptorAddress
                && away.VectorBegin == awayVectorAddress && home.VectorBegin == homeVectorAddress
                && away.TeamNameAddress == awayTeamNameAddress
                && home.TeamNameAddress == homeTeamNameAddress
                && away.Allocator != 0 && away.Allocator == home.Allocator
                && !String.Equals(away.TeamName, home.TeamName, StringComparison.OrdinalIgnoreCase)
                && RoleDisplayNameMatchesCanonical(away.TeamName, expectedAwayTeam)
                && RoleDisplayNameMatchesCanonical(home.TeamName, expectedHomeTeam);
        }

        public bool LabeledTeamRoleBindingMatches(RamAutoDiscovery discovery)
        {
            return discovery != null && discovery.HasLabeledTeamRoleBinding
                && LabeledTeamRoleBindingMatches(
                    discovery.TeamRoleAllocationBase,
                    discovery.AwayTeamRoleLabelAddress, discovery.HomeTeamRoleLabelAddress,
                    discovery.AwayTeamRoleReferenceAddress, discovery.HomeTeamRoleReferenceAddress,
                    discovery.AwayTeamRoleDescriptorAddress, discovery.HomeTeamRoleDescriptorAddress,
                    discovery.AwayTeamRoleVectorAddress, discovery.HomeTeamRoleVectorAddress,
                    discovery.AwayTeamNameAddresses.Count == 1 ? discovery.AwayTeamNameAddresses[0] : 0,
                    discovery.HomeTeamNameAddresses.Count == 1 ? discovery.HomeTeamNameAddresses[0] : 0,
                    discovery.AwayTeamName, discovery.HomeTeamName);
        }

        public long[] FindInt32Near(long address, int radius, int expected)
        {
            EnsureAttached();
            if (radius < 4 || radius > 4 * 1024 * 1024) throw new ArgumentOutOfRangeException("radius");
            long wantedStart = address - radius;
            long wantedEnd = address + radius;
            List<long> matches = new List<long>();
            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long start = Math.Max(wantedStart, region.BaseAddress);
                long end = Math.Min(wantedEnd, region.BaseAddress + region.Size);
                start = (start + 3) & ~3L;
                if (end - start < 4) continue;
                int length = (int)Math.Min(end - start, 2L * radius);
                byte[] bytes = new byte[length];
                int count = Read(start, bytes, length);
                for (int offset = 0; offset <= count - 4; offset += 4)
                    if (BitConverter.ToInt32(bytes, offset) == expected)
                        matches.Add(start + offset);
            }
            return matches.ToArray();
        }

        public long[] FindAsciiText(string value)
        {
            EnsureAttached();
            if (String.IsNullOrWhiteSpace(value)) throw new ArgumentException("Text is required.");
            byte[] pattern = Encoding.ASCII.GetBytes(value);
            List<long> matches = new List<long>();
            HashSet<long> seen = new HashSet<long>();
            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                if (region.Size < pattern.Length || region.Size > 32L * 1024 * 1024) continue;
                byte[] buffer = new byte[(int)region.Size];
                int bytesRead = Read(region.BaseAddress, buffer, buffer.Length);
                if (bytesRead < pattern.Length) continue;
                int search = 0;
                while (search <= bytesRead - pattern.Length)
                {
                    int hit = Array.IndexOf(buffer, pattern[0], search, bytesRead - search);
                    if (hit < 0 || hit > bytesRead - pattern.Length) break;
                    search = hit + 1;
                    if (!Matches(buffer, hit, pattern, -1, -1)) continue;
                    long address = region.BaseAddress + hit;
                    if (seen.Add(address)) matches.Add(address);
                    if (matches.Count >= 512) return matches.ToArray();
                }
            }
            return matches.ToArray();
        }

        public long[] FindAsciiTextAll(string value, int maximumMatches)
        {
            EnsureAttached();
            if (String.IsNullOrWhiteSpace(value)) throw new ArgumentException("Text is required.");
            if (maximumMatches < 1 || maximumMatches > 4096) throw new ArgumentOutOfRangeException("maximumMatches");
            byte[] pattern = Encoding.ASCII.GetBytes(value);
            List<long> matches = new List<long>();
            HashSet<long> seen = new HashSet<long>();
            List<MemoryRegion> regions = EnumerateAllReadableRegions();
            byte[] buffer = new byte[ChunkSize + pattern.Length - 1];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long offset = 0;
                while (offset < region.Size)
                {
                    int requested = (int)Math.Min(ChunkSize, region.Size - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead >= pattern.Length)
                    {
                        int search = 0;
                        while (search <= bytesRead - pattern.Length)
                        {
                            int hit = Array.IndexOf(buffer, pattern[0], search, bytesRead - search);
                            if (hit < 0 || hit > bytesRead - pattern.Length) break;
                            search = hit + 1;
                            if (!Matches(buffer, hit, pattern, -1, -1)) continue;
                            long address = region.BaseAddress + offset + hit;
                            if (seen.Add(address)) matches.Add(address);
                            if (matches.Count >= maximumMatches) return matches.ToArray();
                        }
                    }
                    if (requested <= pattern.Length) break;
                    offset += requested - (pattern.Length - 1);
                }
            }
            return matches.ToArray();
        }

        // Multi-pattern ASCII search restricted to the private heap below 4 GB -
        // where every ScoreHud object has been found so far. Cheap enough to
        // run at flag time (~0.5 GB), unlike the whole-process FindAsciiTextsAll.
        // MADDEN ROUND-2 PROBE. Hunts for ScoreHud-style team objects when
        // the vtable offsets are unknown: an object headed by a pointer into
        // the game module whose ints match the live scoreboard the tester
        // typed in - score at some offset X, timeouts at X-8, a plausible
        // win count at X+8 (the exact relation the CFB27 team object has at
        // X=60). Reports a histogram of (vtable offset, X) pairs; the real
        // team object class dominates it because the game keeps many clones.
        internal static bool HuntPatternMatches(byte[] bytes, int offset, int score, int timeouts)
        {
            if (offset < 8 || offset + 12 > bytes.Length) return false;
            if (BitConverter.ToInt32(bytes, offset) != score) return false;
            int slotTimeouts = BitConverter.ToInt32(bytes, offset - 8);
            // timeouts < 0 is a wildcard: the caller does not know the live
            // count (that is what the hunt is trying to find), so any legal
            // 0..3 qualifies.
            if (timeouts >= 0 ? slotTimeouts != timeouts : (slotTimeouts < 0 || slotTimeouts > 3)) return false;
            int wins = BitConverter.ToInt32(bytes, offset + 8);
            return wins >= 0 && wins <= 40;
        }

        public Dictionary<string, int> HuntScoreHudTeamObjects(int awayScore, int homeScore,
            int awayTimeouts, int homeTimeouts, int maximumSamples, List<string> samples)
        {
            return HuntScoreHudTeamObjects(awayScore, homeScore, awayTimeouts, homeTimeouts,
                maximumSamples, samples, null, null);
        }

        // matchDumpVtableOffsets/matchDumps: full 0x140-byte dumps (with any
        // pointed-at strings) of instances of the named types AT THE MOMENT
        // they match the live score - round-5 data showed that dumping "the
        // first N references" instead captures pools and vtable directories,
        // never the ~26 instances actually holding the score.
        public Dictionary<string, int> HuntScoreHudTeamObjects(int awayScore, int homeScore,
            int awayTimeouts, int homeTimeouts, int maximumSamples, List<string> samples,
            long[] matchDumpVtableOffsets, List<string> matchDumps)
        {
            EnsureAttached();
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long moduleEnd = moduleBase + process.MainModule.ModuleMemorySize;
            HashSet<long> dumpVtables = new HashSet<long>();
            if (matchDumpVtableOffsets != null)
                foreach (long offset in matchDumpVtableOffsets) dumpVtables.Add(moduleBase + offset);
            Dictionary<string, int> histogram = new Dictionary<string, int>(StringComparer.Ordinal);
            // Both-sides tracking: an object type whose instances match BOTH
            // teams' scores in the same sweep is a team-object candidate even
            // if it is not in the requested dump set - the backstop for the
            // requested pair being wrong. Two sample addresses per side.
            Dictionary<long, long[]> bothSides = matchDumps != null ? new Dictionary<long, long[]>() : null;
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[1 << 20];
            foreach (MemoryRegion region in regions)
            {
                if (region.BaseAddress >= 0x100000000L) break;
                for (long chunk = region.BaseAddress; chunk < region.BaseAddress + region.Size; chunk += buffer.Length)
                {
                    int size = (int)Math.Min(buffer.Length, region.BaseAddress + region.Size - chunk);
                    int read = ReadIntoBuffer(chunk, buffer, size);
                    if (read < 0x90) continue;
                    for (int start = 0; start + 0x90 <= read; start += 8)
                    {
                        long vtable = BitConverter.ToInt64(buffer, start);
                        if (vtable < moduleBase || vtable >= moduleEnd) continue;
                        bool objectMatched = false;
                        for (int x = 32; x <= 120; x += 4)
                        {
                            if (start + x + 12 > read) break;
                            // A zero score matches half of memory (round-3 data:
                            // the 0-score side produced 300k+ coincidences per key
                            // and crowded every real hit out of the kept top-N).
                            // Only a side with points on the board can identify
                            // the team object; the other side rides along once
                            // the vtable is known.
                            bool away = awayScore > 0 && HuntPatternMatches(buffer, start + x, awayScore, awayTimeouts);
                            bool home = !away && homeScore > 0 && HuntPatternMatches(buffer, start + x, homeScore, homeTimeouts);
                            if (!away && !home) continue;
                            objectMatched = true;
                            string key = "0x" + (vtable - moduleBase).ToString("X", CultureInfo.InvariantCulture)
                                + "@+" + x.ToString(CultureInfo.InvariantCulture)
                                + (away ? " away" : " home");
                            int count;
                            histogram[key] = histogram.TryGetValue(key, out count) ? count + 1 : 1;
                            if (bothSides != null && awayScore != homeScore)
                            {
                                long[] slots;
                                if (!bothSides.TryGetValue(vtable, out slots))
                                {
                                    if (bothSides.Count < 96) bothSides[vtable] = slots = new long[4];
                                }
                                if (slots != null)
                                {
                                    int baseIndex = away ? 0 : 2;
                                    if (slots[baseIndex] == 0) slots[baseIndex] = chunk + start;
                                    else if (slots[baseIndex + 1] == 0 && slots[baseIndex] != chunk + start) slots[baseIndex + 1] = chunk + start;
                                }
                            }
                            if (matchDumps != null && dumpVtables.Contains(vtable)
                                && CountDumpsFor(matchDumps, vtable - moduleBase) < 12)
                                DumpObject(chunk + start, key, matchDumps);
                            if (samples != null && samples.Count < maximumSamples)
                            {
                                StringBuilder ints = new StringBuilder();
                                for (int i = 24; i <= 120 && start + i + 4 <= read; i += 4)
                                {
                                    if (i > 24) ints.Append(",");
                                    ints.Append(BitConverter.ToInt32(buffer, start + i));
                                }
                                samples.Add("0x" + (chunk + start).ToString("X", CultureInfo.InvariantCulture)
                                    + " " + key + " ints[24..120]=" + ints);
                            }
                        }
                        // Loose dump: a requested-pair instance whose score sits
                        // OUTSIDE the strict timeouts/wins relation - covers the
                        // layout not matching the CFB27 relation at all.
                        if (!objectMatched && matchDumps != null && dumpVtables.Contains(vtable)
                            && CountDumpsFor(matchDumps, vtable - moduleBase) < 12)
                        {
                            for (int o = 32; o <= 120 && start + o + 4 <= read; o += 4)
                            {
                                int value = BitConverter.ToInt32(buffer, start + o);
                                if ((awayScore > 0 && value == awayScore) || (homeScore > 0 && value == homeScore))
                                {
                                    DumpObject(chunk + start, "0x" + (vtable - moduleBase).ToString("X", CultureInfo.InvariantCulture)
                                        + "@+" + o.ToString(CultureInfo.InvariantCulture) + " loose", matchDumps);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            // Both-sides backstop: dump instances of every type that matched
            // BOTH scores this sweep (score-holding team objects must), so a
            // wrong requested pair still leaves the real one in this zip.
            if (bothSides != null && matchDumps != null)
            {
                foreach (KeyValuePair<long, long[]> pair in bothSides)
                {
                    if (matchDumps.Count >= 64) break;
                    long[] slots = pair.Value;
                    if (slots[0] == 0 || slots[2] == 0) continue;
                    string label = "0x" + (pair.Key - moduleBase).ToString("X", CultureInfo.InvariantCulture) + " both";
                    for (int i = 0; i < 4; i++)
                        if (slots[i] != 0) DumpObject(slots[i], label + (i < 2 ? "-away" : "-home"), matchDumps);
                }
            }
            return histogram;
        }

        private void DumpObject(long address, string label, List<string> dumps)
        {
            if (dumps.Count >= 64) return;
            try
            {
                byte[] full = ReadBytes(address, 0x140);
                StringBuilder line = new StringBuilder();
                line.Append(label).Append(" @0x").Append(address.ToString("X", CultureInfo.InvariantCulture)).Append(" ints=");
                for (int o = 0; o + 4 <= full.Length; o += 4)
                {
                    if (o > 0) line.Append(",");
                    line.Append(BitConverter.ToInt32(full, o));
                }
                line.Append(" strings=");
                for (int o = 0; o + 8 <= full.Length; o += 8)
                {
                    long pointer = BitConverter.ToInt64(full, o);
                    if (pointer < 0x10000 || pointer >= 0x100000000L) continue;
                    string text = null;
                    try { text = ReadAsciiString(pointer, 48); } catch { }
                    if (String.IsNullOrWhiteSpace(text) || text.Trim().Length < 3) continue;
                    line.Append("+").Append(o.ToString(CultureInfo.InvariantCulture))
                        .Append("='").Append(text.Trim()).Append("' ");
                }
                dumps.Add(line.ToString());
            }
            catch { }
        }

        // Round-6 lesson: one prolific decoy type (player gear objects) filled
        // every dump slot before the real pair was reached. Cap per type.
        private static int CountDumpsFor(List<string> dumps, long vtableOffset)
        {
            string prefix = "0x" + vtableOffset.ToString("X", CultureInfo.InvariantCulture) + "@";
            int count = 0;
            foreach (string dump in dumps) if (dump.StartsWith(prefix, StringComparison.Ordinal)) count++;
            return count;
        }

        private int ReadIntoBuffer(long address, byte[] buffer, int size)
        {
            try
            {
                byte[] chunk = ReadBytes(address, size);
                Array.Copy(chunk, buffer, chunk.Length);
                return chunk.Length;
            }
            catch { return -1; }
        }

        public Dictionary<string, List<long>> FindAsciiTextsPrivateBelow4G(string[] values, int maximumPerValue)
        {
            EnsureAttached();
            if (values == null || values.Length == 0) throw new ArgumentException("Text values are required.");
            Dictionary<string, List<long>> result = new Dictionary<string, List<long>>(StringComparer.Ordinal);
            // First-byte dispatch: one pass over each chunk, only the patterns
            // that start with the byte under the cursor are compared. The
            // naive per-pattern loop took ~25 s per scan in the probe game.
            List<KeyValuePair<string, byte[]>>[] byFirst = new List<KeyValuePair<string, byte[]>>[256];
            int longest = 1;
            for (int index = 0; index < values.Length; index++)
            {
                if (String.IsNullOrWhiteSpace(values[index]) || result.ContainsKey(values[index])) continue;
                byte[] pattern = Encoding.ASCII.GetBytes(values[index]);
                result.Add(values[index], new List<long>());
                if (byFirst[pattern[0]] == null) byFirst[pattern[0]] = new List<KeyValuePair<string, byte[]>>();
                byFirst[pattern[0]].Add(new KeyValuePair<string, byte[]>(values[index], pattern));
                if (pattern.Length > longest) longest = pattern.Length;
            }
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize + longest];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                long offset = 0;
                while (offset < region.Size)
                {
                    int requested = (int)Math.Min(buffer.Length, region.Size - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead <= 0) break;
                    for (int position = 0; position < bytesRead; position++)
                    {
                        List<KeyValuePair<string, byte[]>> candidates = byFirst[buffer[position]];
                        if (candidates == null) continue;
                        for (int candidateIndex = 0; candidateIndex < candidates.Count; candidateIndex++)
                        {
                            byte[] pattern = candidates[candidateIndex].Value;
                            if (position + pattern.Length > bytesRead) continue;
                            bool match = true;
                            for (int k = 1; k < pattern.Length; k++)
                            {
                                if (buffer[position + k] != pattern[k]) { match = false; break; }
                            }
                            if (!match) continue;
                            List<long> hits = result[candidates[candidateIndex].Key];
                            long address = region.BaseAddress + offset + position;
                            if (hits.Count < maximumPerValue && (hits.Count == 0 || hits[hits.Count - 1] != address)) hits.Add(address);
                        }
                    }
                    if (requested <= longest) break;
                    offset += requested - (longest - 1);
                }
            }
            return result;
        }

        public sealed class ValueCluster
        {
            public long Start;
            public int Width;
            public int DistinctValues;
            public List<string> Hits = new List<string>();
        }

        // Where do several known numbers sit close together? Scans the private
        // heap below 4 GB for the given values as int32 (4-aligned) and int16
        // (2-aligned) and returns windows of `windowBytes` holding at least
        // `minimumDistinct` DISTINCT wanted values (values 0..5 are too
        // common to count toward the minimum but are still reported).
        public List<ValueCluster> FindValueClustersBelow4G(int[] values, int windowBytes, int minimumDistinct, int maximumClusters)
        {
            EnsureAttached();
            HashSet<int> wanted = new HashSet<int>(values);
            List<KeyValuePair<long, int>> hits = new List<KeyValuePair<long, int>>();
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            foreach (MemoryRegion region in regions)
            {
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                long offset = 0;
                while (offset < region.Size)
                {
                    int requested = (int)Math.Min(buffer.Length, region.Size - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead <= 0) break;
                    long chunkAddress = region.BaseAddress + offset;
                    int alignment = (int)((2 - (chunkAddress & 1)) & 1);
                    for (int position = alignment; position + 2 <= bytesRead; position += 2)
                    {
                        long address = chunkAddress + position;
                        short shortValue = BitConverter.ToInt16(buffer, position);
                        if (wanted.Contains(shortValue) && Math.Abs(shortValue) > 5) hits.Add(new KeyValuePair<long, int>(address, shortValue));
                        if ((address & 3) == 0 && position + 4 <= bytesRead)
                        {
                            int intValue = BitConverter.ToInt32(buffer, position);
                            if (wanted.Contains(intValue) && Math.Abs(intValue) > 5) hits.Add(new KeyValuePair<long, int>(address, intValue));
                        }
                        if (hits.Count > 3000000) break;
                    }
                    if (requested <= 4) break;
                    offset += requested - 4;
                }
            }
            hits.Sort(delegate(KeyValuePair<long, int> a, KeyValuePair<long, int> b) { return a.Key.CompareTo(b.Key); });
            List<ValueCluster> clusters = new List<ValueCluster>();
            int start = 0;
            long lastClusterEnd = -1;
            for (int index = 0; index < hits.Count && clusters.Count < maximumClusters; index++)
            {
                while (hits[index].Key - hits[start].Key > windowBytes) start++;
                HashSet<int> distinct = new HashSet<int>();
                for (int k = start; k <= index; k++) distinct.Add(hits[k].Value);
                if (distinct.Count < minimumDistinct) continue;
                if (hits[start].Key <= lastClusterEnd) continue;
                // A lookup curve (0,3,6,8,11,13,15...) matches many small
                // numbers by accident: skip windows whose hits are strictly
                // increasing with address.
                bool ascending = true;
                for (int k = start + 1; k <= index; k++)
                {
                    if (hits[k].Value <= hits[k - 1].Value) { ascending = false; break; }
                }
                if (ascending && index - start >= 3) continue;
                ValueCluster cluster = new ValueCluster();
                cluster.Start = hits[start].Key;
                cluster.Width = (int)(hits[index].Key - hits[start].Key) + 4;
                cluster.DistinctValues = distinct.Count;
                for (int k = start; k <= index && cluster.Hits.Count < 24; k++)
                    cluster.Hits.Add("+0x" + (hits[k].Key - hits[start].Key).ToString("X", CultureInfo.InvariantCulture) + "=" + hits[k].Value);
                clusters.Add(cluster);
                lastClusterEnd = hits[index].Key;
            }
            return clusters;
        }

        // Every private-heap object (below 4 GB) whose first 8 bytes point at
        // one of `targets` - used to enumerate the ScoreHud object family by
        // sweeping the vtable neighbourhood around the three known types.
        public Dictionary<long, List<long>> FindPrivateInt64ReferencesBelow4G(long[] targets, int maximumPerTarget)
        {
            EnsureAttached();
            if (targets == null || targets.Length == 0) throw new ArgumentException("Targets are required.");
            Dictionary<long, List<long>> result = new Dictionary<long, List<long>>();
            HashSet<long> wanted = new HashSet<long>();
            for (int index = 0; index < targets.Length; index++)
            {
                if (!result.ContainsKey(targets[index])) result.Add(targets[index], new List<long>());
                wanted.Add(targets[index]);
            }
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                long offset = 0;
                while (offset < region.Size)
                {
                    int requested = (int)Math.Min(buffer.Length, region.Size - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead <= 0) break;
                    long chunkAddress = region.BaseAddress + offset;
                    int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                    for (int byteIndex = alignment; byteIndex <= bytesRead - 8; byteIndex += 8)
                    {
                        long value = BitConverter.ToInt64(buffer, byteIndex);
                        if (!wanted.Contains(value)) continue;
                        List<long> bucket = result[value];
                        if (bucket.Count < maximumPerTarget) bucket.Add(chunkAddress + byteIndex);
                    }
                    if (requested <= 8) break;
                    offset += requested - 8;
                }
            }
            return result;
        }

        public Dictionary<string, List<long>> FindAsciiTextsAll(string[] values, int maximumPerValue,
            CancellationToken token)
        {
            EnsureAttached();
            if (values == null || values.Length == 0) throw new ArgumentException("Text values are required.");
            if (maximumPerValue < 1 || maximumPerValue > 4096) throw new ArgumentOutOfRangeException("maximumPerValue");
            Dictionary<string, List<long>> result = new Dictionary<string, List<long>>(StringComparer.Ordinal);
            Dictionary<string, byte[]> patterns = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            int longest = 1;
            for (int index = 0; index < values.Length; index++)
            {
                if (String.IsNullOrWhiteSpace(values[index])) throw new ArgumentException("Text values cannot be blank.");
                if (patterns.ContainsKey(values[index])) continue;
                byte[] pattern = Encoding.ASCII.GetBytes(values[index]);
                patterns.Add(values[index], pattern);
                result.Add(values[index], new List<long>());
                longest = Math.Max(longest, pattern.Length);
            }

            List<MemoryRegion> regions = EnumerateAllReadableRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long offset = 0;
                while (offset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int requested = (int)Math.Min(buffer.Length, region.Size - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead >= 1)
                    {
                        foreach (KeyValuePair<string, byte[]> item in patterns)
                        {
                            List<long> hits = result[item.Key];
                            if (hits.Count >= maximumPerValue || bytesRead < item.Value.Length) continue;
                            int search = 0;
                            while (search <= bytesRead - item.Value.Length)
                            {
                                int hit = Array.IndexOf(buffer, item.Value[0], search, bytesRead - search);
                                if (hit < 0 || hit > bytesRead - item.Value.Length) break;
                                search = hit + 1;
                                if (!Matches(buffer, hit, item.Value, -1, -1)) continue;
                                long address = region.BaseAddress + offset + hit;
                                if (hits.Count == 0 || hits[hits.Count - 1] != address) hits.Add(address);
                                if (hits.Count >= maximumPerValue) break;
                            }
                        }
                    }
                    if (requested <= longest) break;
                    offset += requested - (longest - 1);
                }
            }
            return result;
        }

        public Dictionary<long, List<long>> FindInt64References(long[] targets, int maximumPerTarget,
            CancellationToken token)
        {
            EnsureAttached();
            if (targets == null || targets.Length == 0) throw new ArgumentException("Targets are required.");
            if (maximumPerTarget < 1 || maximumPerTarget > 100000) throw new ArgumentOutOfRangeException("maximumPerTarget");
            Dictionary<long, List<long>> result = new Dictionary<long, List<long>>();
            for (int index = 0; index < targets.Length; index++)
                if (!result.ContainsKey(targets[index])) result.Add(targets[index], new List<long>());

            List<MemoryRegion> regions = EnumerateAllReadableRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long offset = 0;
                while (offset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int requested = (int)Math.Min(buffer.Length, region.Size - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    long chunkAddress = region.BaseAddress + offset;
                    int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                    for (int byteIndex = alignment; byteIndex <= bytesRead - 8; byteIndex += 8)
                    {
                        long value = BitConverter.ToInt64(buffer, byteIndex);
                        List<long> hits;
                        if (!result.TryGetValue(value, out hits) || hits.Count >= maximumPerTarget) continue;
                        hits.Add(chunkAddress + byteIndex);
                    }
                    if (requested <= 8) break;
                    offset += requested - 8;
                }
            }
            return result;
        }

        // The region walk is the dominant cost of every locate - measured on a
        // live game at 8.5 s for the scoreboard sweep and 6.7 s for the
        // special-down sweep. Regions are disjoint and independently readable,
        // so the walk parallelises without changing what is found.
        //
        // The result order is reproduced exactly, not merely approximately.
        // EnumerateRegions returns regions in ascending address order and the
        // hits within a region are produced in ascending order, so
        // concatenating per-region results in region order rebuilds the same
        // sequence the sequential scan emitted. Applying the per-target cap
        // during that merge keeps the same first-N entries the sequential
        // early-return kept. The duplicate that the deliberate 8-byte chunk
        // overlap can emit is preserved rather than removed, so callers that
        // count candidates see exactly what they saw before.
        //
        // ReadProcessMemory is thread-safe and the handle is read-only here;
        // each worker owns its buffer, and the target list and region list are
        // never written during the walk.
        private Dictionary<long, List<long>> ScanPrivateInt64References(long[] targets,
            long maximumAddress, int maximumPerTarget, CancellationToken token)
        {
            return ScanPrivateInt64References(targets, maximumAddress, maximumPerTarget,
                token, null, null);
        }

        // restrictToRegionBases limits the walk to regions that produced hits
        // last time. hitRegionBases, when supplied, collects the regions that
        // produced hits on this walk so the next one can be narrowed.
        private Dictionary<long, List<long>> ScanPrivateInt64References(long[] targets,
            long maximumAddress, int maximumPerTarget, CancellationToken token,
            HashSet<long> restrictToRegionBases, HashSet<long> hitRegionBases)
        {
            Dictionary<long, List<long>> result = new Dictionary<long, List<long>>();
            for (int index = 0; index < targets.Length; index++)
                if (!result.ContainsKey(targets[index])) result.Add(targets[index], new List<long>());

            List<MemoryRegion> regions = EnumerateRegions();
            List<KeyValuePair<long, long>>[] perRegion =
                new List<KeyValuePair<long, long>>[regions.Count];

            // This runs while the game is being played. Leave the machine to it.
            int workers = Environment.ProcessorCount - 2;
            if (workers > 8) workers = 8;
            if (workers < 1) workers = 1;
            ParallelOptions options = new ParallelOptions();
            options.MaxDegreeOfParallelism = workers;

            Parallel.For(0, regions.Count, options, delegate(int regionIndex)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress >= maximumAddress) return;
                if (restrictToRegionBases != null
                    && !restrictToRegionBases.Contains(region.BaseAddress)) return;
                long readableSize = Math.Min(region.Size, maximumAddress - region.BaseAddress);
                if (readableSize <= 0) return;
                List<KeyValuePair<long, long>> hits = null;
                int[] perTargetCount = new int[targets.Length];
                byte[] buffer = new byte[ChunkSize];
                long offset = 0;
                while (offset < readableSize)
                {
                    token.ThrowIfCancellationRequested();
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    long chunkAddress = region.BaseAddress + offset;
                    int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                    for (int byteIndex = alignment; byteIndex <= bytesRead - 8; byteIndex += 8)
                    {
                        long value = BitConverter.ToInt64(buffer, byteIndex);
                        // Targets number one to three, so a linear compare beats
                        // the per-value dictionary lookup this replaced.
                        for (int targetIndex = 0; targetIndex < targets.Length; targetIndex++)
                        {
                            if (targets[targetIndex] != value) continue;
                            // One region can never need to supply more than the
                            // global cap, so bounding it here keeps memory finite
                            // if a searched value turns out to be very common.
                            if (perTargetCount[targetIndex] >= maximumPerTarget) break;
                            perTargetCount[targetIndex]++;
                            if (hits == null) hits = new List<KeyValuePair<long, long>>();
                            hits.Add(new KeyValuePair<long, long>(value, chunkAddress + byteIndex));
                            break;
                        }
                    }
                    if (requested <= 8) break;
                    offset += requested - 8;
                }
                perRegion[regionIndex] = hits;
            });

            for (int regionIndex = 0; regionIndex < perRegion.Length; regionIndex++)
            {
                List<KeyValuePair<long, long>> hits = perRegion[regionIndex];
                if (hits == null || hits.Count == 0) continue;
                if (hitRegionBases != null) hitRegionBases.Add(regions[regionIndex].BaseAddress);
                for (int hitIndex = 0; hitIndex < hits.Count; hitIndex++)
                {
                    List<long> bucket = result[hits[hitIndex].Key];
                    if (bucket.Count >= maximumPerTarget) continue;
                    bucket.Add(hits[hitIndex].Value);
                }
            }
            return result;
        }

        public List<long> FindPrivateInt64References(long target, long maximumAddress, int maximumMatches,
            CancellationToken token)
        {
            EnsureAttached();
            if (maximumAddress <= 0) throw new ArgumentOutOfRangeException("maximumAddress");
            if (maximumMatches < 1 || maximumMatches > 100000) throw new ArgumentOutOfRangeException("maximumMatches");
            return ScanPrivateInt64References(new long[] { target },
                maximumAddress, maximumMatches, token)[target];
        }

        public Dictionary<long, List<long>> FindPrivateInt64References(long[] targets, long maximumAddress,
            int maximumPerTarget, CancellationToken token)
        {
            EnsureAttached();
            if (targets == null || targets.Length == 0) throw new ArgumentException("Targets are required.");
            if (maximumAddress <= 0) throw new ArgumentOutOfRangeException("maximumAddress");
            if (maximumPerTarget < 1 || maximumPerTarget > 100000) throw new ArgumentOutOfRangeException("maximumPerTarget");
            return ScanPrivateInt64References(targets, maximumAddress, maximumPerTarget, token);
        }

        public Dictionary<int, List<long>> FindPrivateInt32References(int[] targets, long maximumAddress,
            int maximumPerTarget, CancellationToken token)
        {
            EnsureAttached();
            if (targets == null || targets.Length == 0) throw new ArgumentException("Targets are required.");
            if (maximumAddress <= 0) throw new ArgumentOutOfRangeException("maximumAddress");
            if (maximumPerTarget < 1 || maximumPerTarget > 100000) throw new ArgumentOutOfRangeException("maximumPerTarget");
            Dictionary<int, List<long>> result = new Dictionary<int, List<long>>();
            foreach (int target in targets)
                if (!result.ContainsKey(target)) result.Add(target, new List<long>());
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress >= maximumAddress) continue;
                long readableSize = Math.Min(region.Size, maximumAddress - region.BaseAddress);
                long offset = 0;
                while (offset < readableSize)
                {
                    token.ThrowIfCancellationRequested();
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    long chunkAddress = region.BaseAddress + offset;
                    int alignment = (int)((4 - (chunkAddress & 3)) & 3);
                    for (int byteIndex = alignment; byteIndex <= bytesRead - 4; byteIndex += 4)
                    {
                        int value = BitConverter.ToInt32(buffer, byteIndex);
                        List<long> hits;
                        if (!result.TryGetValue(value, out hits) || hits.Count >= maximumPerTarget) continue;
                        hits.Add(chunkAddress + byteIndex);
                    }
                    if (requested <= 4) break;
                    offset += requested - 4;
                }
            }
            return result;
        }

        public Dictionary<int, List<long>> FindPrivateUInt16References(int[] targets, long maximumAddress,
            int maximumPerTarget, CancellationToken token)
        {
            EnsureAttached();
            if (targets == null || targets.Length == 0) throw new ArgumentException("Targets are required.");
            if (maximumAddress <= 0) throw new ArgumentOutOfRangeException("maximumAddress");
            if (maximumPerTarget < 1 || maximumPerTarget > 100000) throw new ArgumentOutOfRangeException("maximumPerTarget");
            Dictionary<int, List<long>> result = new Dictionary<int, List<long>>();
            foreach (int target in targets)
            {
                if (target < 0 || target > UInt16.MaxValue) throw new ArgumentOutOfRangeException("targets");
                if (!result.ContainsKey(target)) result.Add(target, new List<long>());
            }
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress >= maximumAddress) continue;
                long readableSize = Math.Min(region.Size, maximumAddress - region.BaseAddress);
                long offset = 0;
                while (offset < readableSize)
                {
                    token.ThrowIfCancellationRequested();
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    long chunkAddress = region.BaseAddress + offset;
                    for (int byteIndex = 0; byteIndex <= bytesRead - 2; byteIndex++)
                    {
                        int value = buffer[byteIndex] | (buffer[byteIndex + 1] << 8);
                        List<long> hits;
                        if (!result.TryGetValue(value, out hits) || hits.Count >= maximumPerTarget) continue;
                        hits.Add(chunkAddress + byteIndex);
                    }
                    if (requested <= 2) break;
                    offset += requested - 1;
                }
            }
            return result;
        }

        public List<long> FindByteMatches(byte target, long[][] ranges, int maximumMatches, CancellationToken token)
        {
            EnsureAttached();
            if (ranges == null || ranges.Length == 0) throw new ArgumentException("Ranges are required.");
            if (maximumMatches < 1 || maximumMatches > 5000000) throw new ArgumentOutOfRangeException("maximumMatches");
            List<long> result = new List<long>();
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            foreach (long[] range in ranges)
            {
                if (range == null || range.Length != 2 || range[0] < 0 || range[1] <= range[0]) continue;
                for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
                {
                    MemoryRegion region = regions[regionIndex];
                    long start = Math.Max(range[0], region.BaseAddress);
                    long end = Math.Min(range[1], region.BaseAddress + region.Size);
                    if (end <= start) continue;
                    long offset = 0;
                    while (start + offset < end)
                    {
                        token.ThrowIfCancellationRequested();
                        int requested = (int)Math.Min(buffer.Length, end - start - offset);
                        int bytesRead = Read(start + offset, buffer, requested);
                        for (int index = 0; index < bytesRead; index++)
                        {
                            if (buffer[index] != target) continue;
                            result.Add(start + offset + index);
                            if (result.Count >= maximumMatches) return result;
                        }
                        if (requested <= 0) break;
                        offset += requested;
                    }
                }
            }
            return result;
        }

        public List<RankPairContextCandidate> FindRankPairContexts(byte awayRank, byte homeRank,
            int maximumMatches, CancellationToken token)
        {
            EnsureAttached();
            if (maximumMatches < 1 || maximumMatches > 500000) throw new ArgumentOutOfRangeException("maximumMatches");
            int[] deltas = new int[] { 3, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96,
                104, 112, 120, 128, 144, 160, 168, 192, 224, 256 };
            const int context = 32;
            int overlap = deltas[deltas.Length - 1] + context + 1;
            const int coreSize = 1024 * 1024;
            List<RankPairContextCandidate> result = new List<RankPairContextCandidate>();
            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long coreOffset = 0;
                while (coreOffset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, region.Size - coreOffset);
                    int requested = (int)Math.Min(region.Size - coreOffset, coreLength + overlap);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + coreOffset, buffer, requested);
                    long chunkAddress = region.BaseAddress + coreOffset;
                    int first = coreOffset == 0 ? context : 0;
                    for (int index = first; index < coreLength && index < bytesRead; index++)
                    {
                        if (buffer[index] != awayRank) continue;
                        for (int deltaIndex = 0; deltaIndex < deltas.Length; deltaIndex++)
                        {
                            int delta = deltas[deltaIndex];
                            if (index + delta >= bytesRead || buffer[index + delta] != homeRank) continue;
                            int windowStart = index - context;
                            int windowLength = delta + context * 2 + 1;
                            if (windowStart < 0 || windowStart + windowLength > bytesRead) continue;
                            long awayAddress = chunkAddress + index;
                            result.Add(new RankPairContextCandidate
                            {
                                AwayAddress = awayAddress,
                                Delta = delta,
                                RawHash = HashRankContext(buffer, windowStart, windowLength, index, index + delta,
                                    chunkAddress, false, false),
                                PointerNormalizedHash = HashRankContext(buffer, windowStart, windowLength, index,
                                    index + delta, chunkAddress, true, false),
                                ShapeHash = HashRankContext(buffer, windowStart, windowLength, index, index + delta,
                                    chunkAddress, true, true)
                            });
                            if (result.Count >= maximumMatches) return result;
                        }
                    }
                    if (coreLength <= 0) break;
                    coreOffset += coreLength;
                }
            }
            return result;
        }

        public Dictionary<int, List<ScoreHudTeamCandidate>> FindScoreHudTeamCandidates(int[] ranks,
            int maximumPerRank, CancellationToken token)
        {
            EnsureAttached();
            if (ranks == null || ranks.Length == 0) throw new ArgumentException("Ranks are required.");
            if (maximumPerRank < 1 || maximumPerRank > 100000) throw new ArgumentOutOfRangeException("maximumPerRank");
            Dictionary<int, List<ScoreHudTeamCandidate>> result = new Dictionary<int, List<ScoreHudTeamCandidate>>();
            foreach (int rank in ranks)
            {
                if (rank < 0 || rank > 25) throw new ArgumentOutOfRangeException("ranks");
                if (!result.ContainsKey(rank)) result.Add(rank, new List<ScoreHudTeamCandidate>());
            }
            const int recordLength = 80;
            const int coreSize = 1024 * 1024;
            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long coreOffset = 0;
                while (coreOffset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, region.Size - coreOffset);
                    int requested = (int)Math.Min(region.Size - coreOffset, coreLength + recordLength);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + coreOffset, buffer, requested);
                    long chunkAddress = region.BaseAddress + coreOffset;
                    int first = (int)((8 - (chunkAddress & 7)) & 7);
                    for (int index = first; index < coreLength && index + recordLength <= bytesRead; index += 8)
                    {
                        int rank = BitConverter.ToInt32(buffer, index + 44);
                        List<ScoreHudTeamCandidate> matches;
                        if (!result.TryGetValue(rank, out matches) || matches.Count >= maximumPerRank) continue;
                        int teamId = BitConverter.ToInt32(buffer, index + 40);
                        int ties = BitConverter.ToInt32(buffer, index + 48);
                        int timeouts = BitConverter.ToInt32(buffer, index + 52);
                        int losses = BitConverter.ToInt32(buffer, index + 56);
                        int score = BitConverter.ToInt32(buffer, index + 60);
                        int challenges = BitConverter.ToInt32(buffer, index + 64);
                        int wins = BitConverter.ToInt32(buffer, index + 68);
                        int possession = buffer[index + 72];
                        int teambuilder = buffer[index + 73];
                        if (teamId < 1 || teamId > 10000 || ties < 0 || ties > 99
                            || timeouts < 0 || timeouts > 3 || losses < 0 || losses > 99
                            || score < 0 || score > 255 || challenges < 0 || challenges > 3
                            || wins < 0 || wins > 99 || possession > 1 || teambuilder > 1) continue;
                        long typePointer = BitConverter.ToInt64(buffer, index);
                        long displayPointer = BitConverter.ToInt64(buffer, index + 24);
                        int color = BitConverter.ToInt32(buffer, index + 32);
                        matches.Add(new ScoreHudTeamCandidate
                        {
                            Address = chunkAddress + index,
                            TypePointer = typePointer,
                            DisplayPointer = displayPointer,
                            Color = color,
                            TeamId = teamId,
                            Rank = rank,
                            Ties = ties,
                            Timeouts = timeouts,
                            Losses = losses,
                            Score = score,
                            Challenges = challenges,
                            Wins = wins,
                            HasPossession = possession,
                            IsTeambuilder = teambuilder
                        });
                    }
                    if (coreLength <= 0) break;
                    coreOffset += coreLength;
                }
            }
            return result;
        }

        // A real poll ranking is 1-25. Anything else - zero, a sentinel, a
        // leftover - means the team is not ranked, and the rest of the reader
        // only ever has to distinguish "ranked Nth" from "not ranked".
        internal static int NormalizeTeamRank(int rank)
        {
            return rank >= 1 && rank <= 25 ? rank : 0;
        }

        public List<ScoreHudTeamCandidate> FindScoreHudTeamCandidatesByScores(
            int awayScore, int homeScore, CancellationToken token)
        {
            EnsureAttached();
            List<ScoreHudTeamCandidate> result = new List<ScoreHudTeamCandidate>();
            HashSet<long> seen = new HashSet<long>();
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long moduleEnd = moduleBase + process.MainModule.ModuleMemorySize;
            const int recordLength = 80;
            const int coreSize = 1024 * 1024;
            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L
                    || region.Size < recordLength) continue;
                long readableSize = Math.Min(region.Size, 0x100000000L - region.BaseAddress);
                long coreOffset = 0;
                while (coreOffset < readableSize)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, readableSize - coreOffset);
                    int requested = (int)Math.Min(readableSize - coreOffset, coreLength + recordLength);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + coreOffset, buffer, requested);
                    long chunkAddress = region.BaseAddress + coreOffset;
                    int first = (int)((8 - (chunkAddress & 7)) & 7);
                    for (int index = first; index < coreLength && index + recordLength <= bytesRead; index += 8)
                    {
                        int score = BitConverter.ToInt32(buffer, index + 60);
                        if (score != awayScore && score != homeScore) continue;
                        long vtable = BitConverter.ToInt64(buffer, index);
                        long runtimeTypeInfo = BitConverter.ToInt64(buffer, index + 8);
                        if (vtable < moduleBase || vtable >= moduleEnd
                            || runtimeTypeInfo < moduleBase || runtimeTypeInfo >= moduleEnd) continue;
                        long header = BitConverter.ToInt64(buffer, index + 16);
                        if ((header & 0x0000800000000000L) != 0) continue;
                        int teamId = BitConverter.ToInt32(buffer, index + 40);
                        int rank = BitConverter.ToInt32(buffer, index + 44);
                        int ties = BitConverter.ToInt32(buffer, index + 48);
                        int timeouts = BitConverter.ToInt32(buffer, index + 52);
                        int losses = BitConverter.ToInt32(buffer, index + 56);
                        int challenges = BitConverter.ToInt32(buffer, index + 64);
                        int wins = BitConverter.ToInt32(buffer, index + 68);
                        int possession = buffer[index + 72];
                        int teambuilder = buffer[index + 73];
                        // An unranked team is not required to store rank 0.
                        // Demanding 0-25 here silently discarded the entire team
                        // object of any unranked side: observed live on Pitt v
                        // USC, where USC (ranked 15) was found and Pittsburgh
                        // (unranked) was not, leaving one team object where
                        // orientation needs two - which is why ranks, records and
                        // timeouts could not bind at all.
                        //
                        // This is the same mistake as assuming a Goal/Inches
                        // layer carries distance 0 when it actually carries 50:
                        // "not applicable" is a sentinel, not a zero. Accept a
                        // wide band and normalise below; the vtable, type info,
                        // header and the remaining field ranges are what identify
                        // a team object, and they are unaffected.
                        if (teamId < 0 || teamId > 10000 || rank < -1 || rank > 1000
                            || ties < 0 || ties > 99 || timeouts < 0 || timeouts > 3
                            || losses < 0 || losses > 99 || challenges < 0 || challenges > 3
                            || wins < 0 || wins > 99 || possession > 1 || teambuilder > 1) continue;
                        long address = chunkAddress + index;
                        if (!seen.Add(address)) continue;
                        result.Add(new ScoreHudTeamCandidate
                        {
                            Address = address,
                            TypePointer = vtable,
                            RuntimeTypeInfo = runtimeTypeInfo,
                            Header = header,
                            DisplayPointer = BitConverter.ToInt64(buffer, index + 24),
                            Color = BitConverter.ToInt32(buffer, index + 32),
                            TeamId = teamId,
                            Rank = NormalizeTeamRank(rank),
                            RawRank = rank,
                            Ties = ties,
                            Timeouts = timeouts,
                            Losses = losses,
                            Score = score,
                            Challenges = challenges,
                            Wins = wins,
                            HasPossession = possession,
                            IsTeambuilder = teambuilder
                        });
                    }
                    if (coreLength <= 0) break;
                    coreOffset += coreLength;
                }
            }
            result.Sort(delegate(ScoreHudTeamCandidate left, ScoreHudTeamCandidate right)
            {
                return left.Address.CompareTo(right.Address);
            });
            return result;
        }

        public List<ScoreHudTeamCandidate> FindLiveScoreHudTeamCandidates(CancellationToken token)
        {
            List<ScoreHudTeamCandidate> teams;
            List<ScoreHudDownDistanceCandidate> downDistance;
            List<ScoreHudMessageCandidate> messages;
            FindLiveScoreHudSnapshot(token, out teams, out downDistance, out messages);
            return teams;
        }

        public List<RamTimeoutSnapshot> FindGameStateTimeoutCandidates(CancellationToken token)
        {
            EnsureAttached();
            List<RamTimeoutSnapshot> result = new List<RamTimeoutSnapshot>();
            HashSet<long> seen = new HashSet<long>();
            const int contextLength = 0x64;
            const int coreSize = 1024 * 1024;
            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                if (region.Size < contextLength) continue;
                long coreOffset = 0;
                while (coreOffset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, region.Size - coreOffset);
                    int requested = (int)Math.Min(region.Size - coreOffset, coreLength + contextLength);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + coreOffset, buffer, requested);
                    long chunkAddress = region.BaseAddress + coreOffset;
                    int first = (int)((4 - (chunkAddress & 3)) & 3);
                    for (int index = first; index < coreLength && index + contextLength <= bytesRead; index += 4)
                    {
                        // This is the non-presentation game-state structure that
                        // remains allocated when the native ScoreHud is hidden.
                        // The two dynamic counters begin at +0x1C/+0x20.
                        if (BitConverter.ToInt32(buffer, index + 0x28) != 0x00080104
                            || BitConverter.ToInt32(buffer, index + 0x2C) != 0x00040004)
                            continue;
                        int home = BitConverter.ToInt32(buffer, index + 0x1C);
                        int away = BitConverter.ToInt32(buffer, index + 0x20);
                        long homeAddress = chunkAddress + index + 0x1C;
                        if (!seen.Add(homeAddress)) continue;
                        result.Add(new RamTimeoutSnapshot
                        {
                            Address = homeAddress,
                            Similarity = 100,
                            Home = home,
                            Away = away
                        });
                    }
                    if (coreLength <= 0) break;
                    coreOffset += coreLength;
                }
            }
            result.Sort(delegate(RamTimeoutSnapshot left, RamTimeoutSnapshot right)
            {
                return left.Address.CompareTo(right.Address);
            });
            return result;
        }

        public long[] FindAdjacentInt32Pairs(int firstValue, int secondValue, CancellationToken token)
        {
            EnsureAttached();
            List<long> result = new List<long>();
            HashSet<long> seen = new HashSet<long>();
            const int coreSize = 1024 * 1024;
            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L || region.Size < 8) continue;
                long readableSize = Math.Min(region.Size, 0x100000000L - region.BaseAddress);
                long coreOffset = 0;
                while (coreOffset < readableSize)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, readableSize - coreOffset);
                    int requested = (int)Math.Min(readableSize - coreOffset, coreLength + 8);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + coreOffset, buffer, requested);
                    long chunkAddress = region.BaseAddress + coreOffset;
                    int first = (int)((4 - (chunkAddress & 3)) & 3);
                    for (int index = first; index < coreLength && index + 12 <= bytesRead; index += 4)
                    {
                        if (BitConverter.ToInt32(buffer, index) != firstValue
                            || BitConverter.ToInt32(buffer, index + 4) != secondValue
                            || BitConverter.ToInt32(buffer, index + 8) == secondValue) continue;
                        if (index >= 4 && BitConverter.ToInt32(buffer, index - 4) == firstValue) continue;
                        long address = chunkAddress + index;
                        if (seen.Add(address)) result.Add(address);
                    }
                    if (coreLength <= 0) break;
                    coreOffset += coreLength;
                }
            }
            result.Sort();
            return result.ToArray();
        }

        public int ScoreTimeoutPresentationContext(long homeTimeoutAddress)
        {
            EnsureAttached();
            byte[] pattern = TimeoutContextPattern;
            long contextAddress = homeTimeoutAddress - 0x44;
            byte[] buffer = ReadBytes(contextAddress, pattern.Length);
            if (buffer.Length != pattern.Length) return 0;
            return TimeoutContextSimilarity(buffer, 0, pattern);
        }

        // Pointer slots in these pooled objects also hold raw bytes that
        // decode as short garbage ("`O\K", "H,&K"). Publishing those crowded
        // the real stat banners out of hudTexts entirely (2026-08-20). Keep
        // only strings that look like something the game would draw.
        internal static bool LooksLikeDisplayText(string text)
        {
            if (String.IsNullOrWhiteSpace(text)) return false;
            string trimmed = text.Trim();
            if (trimmed.Length < 4 || trimmed.Length > 96) return false;
            int letters = 0;
            int digits = 0;
            bool hasSpace = false, hasUnderscore = false, hasSeparator = false;
            foreach (char c in trimmed)
            {
                if (c < 32 || c > 126) return false;
                if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) letters++;
                if (c >= '0' && c <= '9') digits++;
                if (c == ' ') hasSpace = true;
                if (c == '_') hasUnderscore = true;
                if (c == ',' || c == '.' || c == '/' || c == '&') hasSeparator = true;
                if (c == '`' || c == '\\' || c == '^' || c == '~' || c == '|') return false;
            }
            if (letters < 3) return false;
            // Engine identifiers crowd the 12 text slots and starve real stat
            // banners (2026-08-20: "ZoneCoverage_SpyReceiver", "x5QK",
            // "/user/profile/..." outnumbered stats 10:1).
            if (trimmed[0] == '/') return false;
            if (hasUnderscore)
            {
                // Player identity tokens ("AbdoulayeSyPape_6133") are the ONE
                // underscore family worth keeping: letters, one underscore,
                // then digits to the end.
                if (!System.Text.RegularExpressions.Regex.IsMatch(trimmed,
                    "^[A-Za-z.'-]+_[0-9]+$")) return false;
            }
            // A digit buried in a single unspaced token ("x5QK") is a pooled
            // identifier, never broadcast text - real stat lines always carry
            // a space or a separator next to their numbers.
            if (digits > 0 && !hasSpace && !hasSeparator && !hasUnderscore) return false;
            return true;
        }

        private static long OffsetOrZero(long moduleBase, long offset)
        {
            return offset == 0 ? 0 : moduleBase + offset;
        }

        public void FindLiveScoreHudSnapshot(CancellationToken token,
            out List<ScoreHudTeamCandidate> teams,
            out List<ScoreHudDownDistanceCandidate> downDistance,
            out List<ScoreHudMessageCandidate> messages)
        {
            EnsureAttached();
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long expectedTeamVtable = OffsetOrZero(moduleBase, GameProfile.ScoreHudTeamVtableOffset);
            long expectedDownDistanceVtable = OffsetOrZero(moduleBase, GameProfile.ScoreHudDownDistanceVtableOffset);
            long expectedMessageVtable = OffsetOrZero(moduleBase, GameProfile.ScoreHudMessageVtableOffset);
            // Two more ScoreHud object types ride along in the same sweep: the
            // player stat line and the stat summary banners (probe 2026-08-18).
            long expectedStatLineVtable = OffsetOrZero(moduleBase, GameProfile.ScoreHudStatLineVtableOffset);
            long expectedStatSummaryVtable = OffsetOrZero(moduleBase, GameProfile.ScoreHudStatSummaryVtableOffset);
            long expectedIdentityVtable = OffsetOrZero(moduleBase, GameProfile.ScoreHudIdentityVtableOffset);
            List<long> scoreHudTargetList = new List<long>();
            foreach (long target in new long[]
                { expectedTeamVtable, expectedDownDistanceVtable, expectedMessageVtable,
                  expectedStatLineVtable, expectedStatSummaryVtable, expectedIdentityVtable })
                if (target != 0) scoreHudTargetList.Add(target);
            long[] scoreHudTargets = scoreHudTargetList.ToArray();
            // A game whose ScoreHud offsets are not mapped yet (Madden
            // groundwork) skips the sweep entirely - nothing is guessed.
            if (scoreHudTargets.Length == 0)
            {
                teams = new List<ScoreHudTeamCandidate>();
                downDistance = new List<ScoreHudDownDistanceCandidate>();
                messages = new List<ScoreHudMessageCandidate>();
                LastScoreHudTexts = new List<ScoreHudTextCandidate>();
                return;
            }

            // ScoreHud allocates a fresh object for every special presentation,
            // so a Kickoff or PAT is always at an address never seen before and
            // the reader has to search for it while the graphic is on screen.
            // Those objects are pooled inside a small set of heap regions
            // though: every address observed on 2026-08-11 fell between
            // 0x2F000000 and 0x32000000, a ~50 MB window out of the 458 MB a
            // full sweep covers. Searching last sweep's regions first is what
            // makes the difference between reporting a kickoff and missing it.
            //
            // This can only ever DELAY the exhaustive sweep, never replace it.
            // It is abandoned the instant it finds nothing, and it is refused
            // after three consecutive uses so a full sweep always follows
            // shortly - a stale object cannot become permanently sticky, and a
            // new object allocated outside the known regions is always found.
            // WITHDRAWN 2026-08-11. The narrowed scan above was accepted as
            // successful when it found ANY of the three object types. Team and
            // message objects are almost always present, so it nearly always
            // "succeeded" - while a down-distance object allocated into a region
            // outside the remembered set was simply not seen, and the guaranteed
            // full sweep only ran every fourth scan. A Kickoff, Goal or Inches
            // could therefore be missed three times out of four. The narrowing
            // was worth ~400 ms; being right about a special down is worth more.
            //
            // A correct version would have to treat each object type separately
            // and refuse to conclude a type is absent from a partial scan. Left
            // out until that is built and measured.
            Dictionary<long, List<long>> references = ScanPrivateInt64References(
                scoreHudTargets, 0x100000000L, 64, token, null, null);

            teams = new List<ScoreHudTeamCandidate>();
            foreach (long address in references[expectedTeamVtable])
            {
                ScoreHudTeamCandidate candidate;
                if (TryReadLiveScoreHudTeamCandidate(address, out candidate)) teams.Add(candidate);
            }

            downDistance = new List<ScoreHudDownDistanceCandidate>();
            foreach (long address in references[expectedDownDistanceVtable])
            {
                ScoreHudDownDistanceCandidate candidate;
                if (TryReadLiveScoreHudDownDistanceCandidate(address, out candidate)) downDistance.Add(candidate);
            }

            messages = new List<ScoreHudMessageCandidate>();
            foreach (long address in references[expectedMessageVtable])
            {
                ScoreHudMessageCandidate candidate;
                if (TryReadLiveScoreHudMessageCandidate(address, out candidate)) messages.Add(candidate);
            }
            List<ScoreHudTextCandidate> texts = new List<ScoreHudTextCandidate>();
            foreach (long vtable in new long[] { expectedStatLineVtable, expectedStatSummaryVtable, expectedIdentityVtable })
            {
                if (vtable == 0) continue;
                foreach (long address in references[vtable])
                {
                    ScoreHudTextCandidate candidate;
                    if (TryReadScoreHudTextCandidate(address, vtable, moduleBase, out candidate)) texts.Add(candidate);
                    if (texts.Count >= 18) break;
                }
            }
            LastScoreHudTexts = texts;
        }

        public List<ScoreHudTextCandidate> LastScoreHudTexts = new List<ScoreHudTextCandidate>();

        // Reads every ASCII string an object points at (8-byte slots from +24)
        // plus the message-shaped ints, without assuming a full layout.
        public bool TryReadScoreHudTextCandidate(long address, long expectedVtable, long moduleBase, out ScoreHudTextCandidate candidate)
        {
            candidate = null;
            const long defaultObjectFlag = 0x0000800000000000L;
            byte[] bytes;
            try { bytes = ReadBytes(address, 0x100); }
            catch { return false; }
            if (BitConverter.ToInt64(bytes, 0) != expectedVtable) return false;
            long header = BitConverter.ToInt64(bytes, 16);
            if ((header & defaultObjectFlag) != 0) return false;
            ScoreHudTextCandidate result = new ScoreHudTextCandidate();
            result.Address = address;
            result.Kind = "0x" + (expectedVtable - moduleBase).ToString("X", CultureInfo.InvariantCulture);
            result.PlayerId = BitConverter.ToInt32(bytes, 48);
            result.TeamId = BitConverter.ToInt32(bytes, 52);
            result.DisplayTime = BitConverter.ToInt32(bytes, 56);
            for (int offset = 24; offset + 8 <= bytes.Length && result.Texts.Count < 8; offset += 8)
            {
                long pointer = BitConverter.ToInt64(bytes, offset);
                if (pointer < 0x10000 || pointer >= 0x100000000L) continue;
                string text;
                try { text = ReadAsciiString(pointer, 96); } catch { continue; }
                if (!LooksLikeDisplayText(text)) continue;
                text = text.Trim();
                if (!result.Texts.Contains(text)) result.Texts.Add(text);
            }
            if (result.Texts.Count == 0) return false;
            candidate = result;
            return true;
        }

        public bool TryReadLiveScoreHudTeamCandidate(long address, out ScoreHudTeamCandidate candidate)
        {
            EnsureAttached();
            candidate = null;
            long scoreHudTeamVtableOffset = GameProfile.ScoreHudTeamVtableOffset;
            long scoreHudTeamTypeInfoOffset = GameProfile.ScoreHudTeamTypeInfoOffset;
            const long defaultObjectFlag = 0x0000800000000000L;
            if (scoreHudTeamVtableOffset == 0) return false;
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long expectedVtable = moduleBase + scoreHudTeamVtableOffset;
            long expectedTypeInfo = moduleBase + scoreHudTeamTypeInfoOffset;
            byte[] bytes;
            try { bytes = ReadBytes(address, 80); }
            catch { return false; }
            long vtable = BitConverter.ToInt64(bytes, 0);
            long runtimeTypeInfo = BitConverter.ToInt64(bytes, 8);
            long header = BitConverter.ToInt64(bytes, 16);
            if (vtable != expectedVtable || runtimeTypeInfo != expectedTypeInfo
                || (header & defaultObjectFlag) != 0) return false;
            int teamId = BitConverter.ToInt32(bytes, 40);
            int rank = BitConverter.ToInt32(bytes, 44);
            int ties = BitConverter.ToInt32(bytes, 48);
            int timeouts = BitConverter.ToInt32(bytes, 52);
            int losses = BitConverter.ToInt32(bytes, 56);
            int score = BitConverter.ToInt32(bytes, 60);
            int challenges = BitConverter.ToInt32(bytes, 64);
            int wins = BitConverter.ToInt32(bytes, 68);
            int possession = bytes[72];
            int teambuilder = bytes[73];
            // Same widening as the sweep: an unranked team's rank field is a
            // sentinel, not a zero, and rejecting it here would make the live
            // re-read of an unranked team's object fail every tick even after
            // the sweep had found it.
            if (teamId < 0 || teamId > 10000 || rank < -1 || rank > 1000
                || ties < 0 || ties > 99 || timeouts < 0 || timeouts > 3
                || losses < 0 || losses > 99 || score < 0 || score > 255
                || challenges < 0 || challenges > 3 || wins < 0 || wins > 99
                || possession > 1 || teambuilder > 1) return false;
            candidate = new ScoreHudTeamCandidate
            {
                Address = address,
                TypePointer = vtable,
                RuntimeTypeInfo = runtimeTypeInfo,
                Header = header,
                DisplayPointer = BitConverter.ToInt64(bytes, 24),
                Color = BitConverter.ToInt32(bytes, 32),
                TeamId = teamId,
                Rank = NormalizeTeamRank(rank),
                RawRank = rank,
                Ties = ties,
                Timeouts = timeouts,
                Losses = losses,
                Score = score,
                Challenges = challenges,
                Wins = wins,
                HasPossession = possession,
                IsTeambuilder = teambuilder
            };
            return true;
        }

        public List<ScoreHudDownDistanceCandidate> FindLiveScoreHudDownDistanceCandidates(CancellationToken token)
        {
            List<ScoreHudMessageCandidate> messages;
            return FindLiveScoreHudDownDistanceCandidates(token, out messages);
        }

        public List<ScoreHudDownDistanceCandidate> FindLiveScoreHudDownDistanceCandidates(CancellationToken token,
            out List<ScoreHudMessageCandidate> messages)
        {
            List<ScoreHudTeamCandidate> teams;
            List<ScoreHudDownDistanceCandidate> result;
            FindLiveScoreHudSnapshot(token, out teams, out result, out messages);
            return result;
        }

        // The 1 MB-aligned windows around a set of known addresses, deduplicated
        // and capped. ScoreHud pools its per-presentation objects inside a small
        // set of heap neighborhoods, so the windows around every address seen
        // this game are where the NEXT freshly allocated object almost always
        // lands - which is what makes a milliseconds-scale targeted scan
        // possible while the full sweep stays behind it as the guarantee.
        internal static List<long> AnchorScanWindows(IEnumerable<long> anchors, int maximumWindows)
        {
            const long windowSize = 0x100000;
            List<long> windows = new List<long>();
            if (anchors == null || maximumWindows <= 0) return windows;
            foreach (long anchor in anchors)
            {
                if (anchor <= 0) continue;
                long baseWindow = anchor & ~(windowSize - 1);
                // The window itself plus one neighbor on each side: a pool that
                // straddles a boundary is still covered.
                foreach (long candidate in new[] { baseWindow - windowSize, baseWindow, baseWindow + windowSize })
                {
                    if (candidate <= 0 || windows.Contains(candidate)) continue;
                    if (windows.Count >= maximumWindows) return windows;
                    windows.Add(candidate);
                }
            }
            return windows;
        }

        // Targeted complement to FindLiveScoreHudSnapshot: scan ONLY the given
        // windows for down-distance objects. This may only ever ADD candidates
        // faster - it proves nothing about absence, concludes nothing, and the
        // exhaustive sweep remains the authority (the mistake the withdrawn
        // narrowed-scan made was treating a partial scan's silence as absence).
        // Fast anchored scan for the stat-banner / identity text objects.
        // The full sweep almost never overlaps a banner's few seconds on
        // screen (2026-08-20: a whole game passed with hudTexts empty), so
        // the banner pool is re-scanned continuously around known anchors -
        // the same trick that made Goal/Inches appear with the snap.
        public List<ScoreHudTextCandidate> FindScoreHudTextCandidatesNear(
            IEnumerable<long> anchorAddresses, int maximumWindows)
        {
            EnsureAttached();
            List<ScoreHudTextCandidate> found = new List<ScoreHudTextCandidate>();
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            List<long> vtables = new List<long>();
            foreach (long offset in new long[] {
                GameProfile.ScoreHudStatLineVtableOffset,
                GameProfile.ScoreHudStatSummaryVtableOffset,
                GameProfile.ScoreHudIdentityVtableOffset })
                if (offset != 0) vtables.Add(moduleBase + offset);
            if (vtables.Count == 0) return found;
            const long windowSize = 0x100000;
            HashSet<long> seen = new HashSet<long>();
            foreach (long windowBase in AnchorScanWindows(anchorAddresses, maximumWindows))
            {
                byte[] buffer = new byte[(int)windowSize];
                int bytesRead = Read(windowBase, buffer, buffer.Length);
                int alignment = (int)((8 - (windowBase & 7)) & 7);
                for (int index = alignment; index + 8 <= bytesRead; index += 8)
                {
                    long value = BitConverter.ToInt64(buffer, index);
                    long matched = 0;
                    foreach (long vtable in vtables) if (value == vtable) { matched = vtable; break; }
                    if (matched == 0) continue;
                    long address = windowBase + index;
                    if (!seen.Add(address)) continue;
                    ScoreHudTextCandidate candidate;
                    try
                    {
                        if (TryReadScoreHudTextCandidate(address, matched, moduleBase, out candidate))
                        {
                            // Identity objects are far more numerous than the
                            // stat banners; cap them so a banner always fits.
                            bool identity = matched == moduleBase + GameProfile.ScoreHudIdentityVtableOffset;
                            int identityCount = 0;
                            if (identity)
                            {
                                foreach (ScoreHudTextCandidate existing in found)
                                    if (existing.Kind == candidate.Kind) identityCount++;
                            }
                            if (!identity || identityCount < 4) found.Add(candidate);
                        }
                    }
                    catch { }
                    if (found.Count >= 18) return found;
                }
            }
            return found;
        }

        // Fast anchored scan for the banner MESSAGE objects (FLAG, FIELD
        // GOAL, pick-six results...). They previously refreshed only on the
        // slow full sweep - the source of the ~10 s flag delay and of missed
        // field-goal presentations (2026-08-20).
        public List<ScoreHudMessageCandidate> FindMessageCandidatesNear(
            IEnumerable<long> anchorAddresses, int maximumWindows)
        {
            EnsureAttached();
            List<ScoreHudMessageCandidate> found = new List<ScoreHudMessageCandidate>();
            if (GameProfile.ScoreHudMessageVtableOffset == 0) return found;
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long expectedVtable = moduleBase + GameProfile.ScoreHudMessageVtableOffset;
            const long windowSize = 0x100000;
            HashSet<long> seen = new HashSet<long>();
            foreach (long windowBase in AnchorScanWindows(anchorAddresses, maximumWindows))
            {
                byte[] buffer = new byte[(int)windowSize];
                int bytesRead = Read(windowBase, buffer, buffer.Length);
                int alignment = (int)((8 - (windowBase & 7)) & 7);
                for (int index = alignment; index + 8 <= bytesRead; index += 8)
                {
                    if (BitConverter.ToInt64(buffer, index) != expectedVtable) continue;
                    long address = windowBase + index;
                    if (!seen.Add(address)) continue;
                    ScoreHudMessageCandidate candidate;
                    try
                    {
                        if (TryReadLiveScoreHudMessageCandidate(address, out candidate))
                            found.Add(candidate);
                    }
                    catch { }
                    if (found.Count >= 12) return found;
                }
            }
            return found;
        }

        public List<ScoreHudDownDistanceCandidate> FindDownDistanceCandidatesNear(
            IEnumerable<long> anchorAddresses, int maximumWindows)
        {
            EnsureAttached();
            List<ScoreHudDownDistanceCandidate> found = new List<ScoreHudDownDistanceCandidate>();
            if (GameProfile.ScoreHudDownDistanceVtableOffset == 0) return found;
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long expectedVtable = moduleBase + GameProfile.ScoreHudDownDistanceVtableOffset;
            const long windowSize = 0x100000;
            HashSet<long> seen = new HashSet<long>();
            foreach (long windowBase in AnchorScanWindows(anchorAddresses, maximumWindows))
            {
                byte[] buffer = new byte[(int)windowSize];
                int bytesRead = Read(windowBase, buffer, buffer.Length);
                int alignment = (int)((8 - (windowBase & 7)) & 7);
                for (int index = alignment; index + 8 <= bytesRead; index += 8)
                {
                    if (BitConverter.ToInt64(buffer, index) != expectedVtable) continue;
                    long address = windowBase + index;
                    if (!seen.Add(address)) continue;
                    ScoreHudDownDistanceCandidate candidate;
                    try
                    {
                        if (TryReadLiveScoreHudDownDistanceCandidate(address, out candidate))
                            found.Add(candidate);
                    }
                    catch { }
                }
            }
            return found;
        }

        public bool TryReadLiveScoreHudDownDistanceCandidate(long address,
            out ScoreHudDownDistanceCandidate candidate)
        {
            EnsureAttached();
            candidate = null;
            const long defaultObjectFlag = 0x0000800000000000L;
            if (GameProfile.ScoreHudDownDistanceVtableOffset == 0) return false;
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long expectedVtable = moduleBase + GameProfile.ScoreHudDownDistanceVtableOffset;
            long expectedTypeInfo = moduleBase + GameProfile.ScoreHudDownDistanceTypeInfoOffset;
            byte[] bytes;
            try { bytes = ReadBytes(address, 56); }
            catch { return false; }
            long header = BitConverter.ToInt64(bytes, 16);
            long displayPointer = BitConverter.ToInt64(bytes, 24);
            int down = BitConverter.ToInt32(bytes, 40);
            int distance = BitConverter.ToInt32(bytes, 44);
            int style = BitConverter.ToInt32(bytes, 48);
            int isEmpty = BitConverter.ToInt32(bytes, 52);
            if (BitConverter.ToInt64(bytes, 0) != expectedVtable
                || BitConverter.ToInt64(bytes, 8) != expectedTypeInfo
                || (header & defaultObjectFlag) != 0
                || down < -1 || down > 4 || distance < -1 || distance > 100
                || style < -1 || style > 20 || (isEmpty != 0 && isEmpty != 1)) return false;
            string display = String.Empty;
            if (displayPointer != 0)
            {
                try { display = ReadAsciiString(displayPointer, 64); }
                catch { }
            }
            candidate = new ScoreHudDownDistanceCandidate
            {
                Address = address,
                Header = header,
                DisplayPointer = displayPointer,
                Display = display,
                Down = down,
                Distance = distance,
                Style = style,
                IsEmpty = isEmpty != 0
            };
            return true;
        }

        public bool TryReadLiveScoreHudMessageCandidate(long address,
            out ScoreHudMessageCandidate candidate)
        {
            EnsureAttached();
            candidate = null;
            const long defaultObjectFlag = 0x0000800000000000L;
            if (GameProfile.ScoreHudMessageVtableOffset == 0) return false;
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long expectedVtable = moduleBase + GameProfile.ScoreHudMessageVtableOffset;
            long expectedTypeInfo = moduleBase + GameProfile.ScoreHudMessageTypeInfoOffset;
            byte[] bytes;
            try { bytes = ReadBytes(address, 64); }
            catch { return false; }
            long header = BitConverter.ToInt64(bytes, 16);
            if (BitConverter.ToInt64(bytes, 0) != expectedVtable
                || BitConverter.ToInt64(bytes, 8) != expectedTypeInfo
                || (header & defaultObjectFlag) != 0) return false;
            long displayTextPointer = BitConverter.ToInt64(bytes, 24);
            long infoTextPointer = BitConverter.ToInt64(bytes, 32);
            string displayText = String.Empty;
            string infoText = String.Empty;
            if (displayTextPointer != 0)
            {
                try { displayText = ReadAsciiString(displayTextPointer, 128); }
                catch { }
            }
            if (infoTextPointer != 0)
            {
                try { infoText = ReadAsciiString(infoTextPointer, 128); }
                catch { }
            }
            candidate = new ScoreHudMessageCandidate
            {
                Address = address,
                Header = header,
                DisplayTextPointer = displayTextPointer,
                InfoTextPointer = infoTextPointer,
                DisplayText = displayText,
                InfoText = infoText,
                MessageId = BitConverter.ToInt32(bytes, 40),
                Color = BitConverter.ToInt32(bytes, 44),
                PlayerId = BitConverter.ToInt32(bytes, 48),
                TeamId = BitConverter.ToInt32(bytes, 52),
                DisplayTime = BitConverter.ToInt32(bytes, 56)
            };
            return true;
        }

        public List<ScoreHudAlertCandidate> FindLiveScoreHudAlertCandidates(CancellationToken token)
        {
            EnsureAttached();
            if (GameProfile.ScoreHudAlertVtableOffset == 0) return new List<ScoreHudAlertCandidate>();
            long moduleBase = process.MainModule.BaseAddress.ToInt64();
            long expectedVtable = moduleBase + GameProfile.ScoreHudAlertVtableOffset;
            long expectedTypeInfo = moduleBase + GameProfile.ScoreHudAlertTypeInfoOffset;
            const long defaultObjectFlag = 0x0000800000000000L;
            List<long> references = FindPrivateInt64References(expectedVtable, 0x100000000L, 64, token);
            List<ScoreHudAlertCandidate> result = new List<ScoreHudAlertCandidate>();
            foreach (long address in references)
            {
                byte[] bytes;
                try { bytes = ReadBytes(address, 64); }
                catch { continue; }
                long header = BitConverter.ToInt64(bytes, 16);
                if (BitConverter.ToInt64(bytes, 0) != expectedVtable
                    || BitConverter.ToInt64(bytes, 8) != expectedTypeInfo
                    || (header & defaultObjectFlag) != 0) continue;
                long textPointer = BitConverter.ToInt64(bytes, 48);
                string value = String.Empty;
                if (textPointer != 0)
                {
                    try { value = ReadAsciiString(textPointer, 128); }
                    catch { }
                }
                result.Add(new ScoreHudAlertCandidate
                {
                    Address = address,
                    Header = header,
                    TextPointer = textPointer,
                    Text = value
                });
            }
            return result;
        }

        // After a title update the compiled-in ScoreHud offsets all dangle and
        // the sweep silently finds nothing (first hit: the 2026-08-20 patch).
        // The down-distance object can still be re-found with NO addresses:
        // its field layout, the live core down/distance (pattern-scanned, so
        // patch-proof), and its own display text ("1st & 10") identify it.
        // Each hit yields the NEW vtable and typeinfo module offsets; the
        // caller turns the unique pair into two deltas and rebases the family.
        public List<ScoreHudRebaseCandidate> HuntScoreHudDownDistanceRebase(
            int coreDown, int coreDistance, CancellationToken token)
        {
            EnsureAttached();
            ProcessModule module = process.MainModule;
            long moduleBase = module.BaseAddress.ToInt64();
            long moduleEnd = moduleBase + module.ModuleMemorySize;
            string[] ordinals = { "1st", "2nd", "3rd", "4th" };
            const long defaultObjectFlag = 0x0000800000000000L;
            Dictionary<string, ScoreHudRebaseCandidate> tally =
                new Dictionary<string, ScoreHudRebaseCandidate>(StringComparer.Ordinal);
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                token.ThrowIfCancellationRequested();
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                long readableSize = Math.Min(region.Size, 0x100000000L - region.BaseAddress);
                long offset = 0;
                while (offset < readableSize)
                {
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead >= 56)
                    {
                        long chunkAddress = region.BaseAddress + offset;
                        int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                        for (int index = alignment; index <= bytesRead - 56; index += 8)
                        {
                            long vtable = BitConverter.ToInt64(buffer, index);
                            if (vtable < moduleBase || vtable >= moduleEnd || (vtable & 7) != 0) continue;
                            long typeInfo = BitConverter.ToInt64(buffer, index + 8);
                            if (typeInfo < moduleBase || typeInfo >= moduleEnd || (typeInfo & 7) != 0) continue;
                            // In every observed build the typeinfo statics sit
                            // a few dozen MB past the vtables; the window is a
                            // cheap pre-filter, generous on both sides.
                            long spread = typeInfo - vtable;
                            if (spread < 0x1000000 || spread > 0x10000000) continue;
                            if ((BitConverter.ToInt64(buffer, index + 16) & defaultObjectFlag) != 0) continue;
                            // Stale pooled instances are welcome evidence too
                            // (ScoreHud pools dozens of old plates), so the
                            // hunt does NOT demand a match with the live core
                            // values - the first version did, missed, and the
                            // log showed why: during a kick lineup the core
                            // has already flipped while the pooled objects
                            // hold arbitrary old downs. What identifies the
                            // type is INTERNAL consistency: the object's own
                            // display string spells its own down field.
                            int down = BitConverter.ToInt32(buffer, index + 40);
                            int distance = BitConverter.ToInt32(buffer, index + 44);
                            int style = BitConverter.ToInt32(buffer, index + 48);
                            int isEmpty = BitConverter.ToInt32(buffer, index + 52);
                            if (down < 1 || down > 4 || distance < 0 || distance > 100
                                || style < -1 || style > 20 || (isEmpty != 0 && isEmpty != 1)) continue;
                            long displayPointer = BitConverter.ToInt64(buffer, index + 24);
                            if (displayPointer < 0x10000 || displayPointer >= 0x100000000L) continue;
                            string display;
                            try { display = ReadAsciiString(displayPointer, 32); }
                            catch { continue; }
                            if (display == null
                                || !display.TrimStart().StartsWith(ordinals[down - 1], StringComparison.OrdinalIgnoreCase))
                                continue;
                            string key = (vtable - moduleBase).ToString(CultureInfo.InvariantCulture)
                                + "|" + (typeInfo - moduleBase).ToString(CultureInfo.InvariantCulture);
                            ScoreHudRebaseCandidate entry;
                            if (!tally.TryGetValue(key, out entry))
                            {
                                entry = new ScoreHudRebaseCandidate
                                {
                                    VtableOffset = vtable - moduleBase,
                                    TypeInfoOffset = typeInfo - moduleBase,
                                    Display = display.Trim()
                                };
                                tally[key] = entry;
                            }
                            entry.Matches++;
                        }
                    }
                    if (requested <= 64) break;
                    offset += requested - 55;
                }
            }
            return new List<ScoreHudRebaseCandidate>(tally.Values);
        }

        // RESEARCH (2026-08-20 evening). The play-call tile's "104 Yd FG" is
        // NOT stored as readable text (a full-memory ASCII/UTF-16 scan during
        // a live 104-yard lineup found zero matches - it is glyph-indexed).
        // But the NUMBERS are there: during that same lineup the pool held
        // many objects pairing 104 with 87 (yards to goal) and 104 with 13
        // (the yard line), e.g. five objects with the yardline at +20. This
        // probe logs every such pair so the recurring template (fixed offset
        // between kick distance and field position) identifies itself across
        // a few kicks - then the pre-snap distance can be READ, fail-closed.
        // knownDistance > 0 = targeted mode, fired AT the kick when the
        // latch already knows the length: every hit is then near-certain to
        // be a real (kick, field-position) object. Generic mode (0) samples
        // during ordinary play and needs the noise filters below - the first
        // version's 60-hit budget was flooded by "116 beside 1" junk before
        // the scan ever reached the real objects (2026-08-20).
        public List<string> FindKickDistancePairs(int knownDistance, CancellationToken token)
        {
            EnsureAttached();
            List<string> found = new List<string>();
            Dictionary<int, int> perValue = new Dictionary<int, int>();
            // The whole sub-4GB private space, not a fixed window: the pool
            // moved outside 0x2C-0x40000000 when a new match started
            // (2026-08-20 21:33, collector went silent) - the region is per
            // game session, so a hard window is a time bomb.
            const long windowLow = 0x10000L;
            const long windowHigh = 0x100000000L;
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                token.ThrowIfCancellationRequested();
                MemoryRegion region = regions[regionIndex];
                long start = Math.Max(region.BaseAddress, windowLow);
                long end = Math.Min(region.BaseAddress + region.Size, windowHigh);
                if (start >= end) continue;
                long offset = 0;
                long size = end - start;
                while (offset < size)
                {
                    int requested = (int)Math.Min(buffer.Length, size - offset);
                    int bytesRead = Read(start + offset, buffer, requested);
                    int lowIndex = (int)((4 - ((start + offset) & 3)) & 3);
                    for (int index = lowIndex + 64; index + 4 <= bytesRead - 64; index += 4)
                    {
                        int value = BitConverter.ToInt32(buffer, index);
                        if (knownDistance > 0)
                        {
                            if (value != knownDistance) continue;
                        }
                        else if (value < 28 || value > 120) continue;
                        int yardsToGoal = value - 17;
                        int mirrored = 100 - yardsToGoal;
                        int seenForValue;
                        perValue.TryGetValue(value, out seenForValue);
                        if (seenForValue >= (knownDistance > 0 ? 40 : 6)) continue;
                        for (int delta = -64; delta <= 64; delta += 4)
                        {
                            if (delta == 0) continue;
                            int neighbor = BitConverter.ToInt32(buffer, index + delta);
                            string kind = null;
                            if (neighbor == yardsToGoal) kind = "ytg";
                            // Mirrored below 5 pairs with the stray 1s and 2s
                            // that fill every heap - worthless as evidence.
                            else if (neighbor == mirrored && mirrored >= 5 && mirrored <= 50) kind = "yardline";
                            if (kind == null) continue;
                            perValue[value] = seenForValue + 1;
                            found.Add("0x" + (start + offset + index).ToString("X", CultureInfo.InvariantCulture)
                                + " dist=" + value.ToString(CultureInfo.InvariantCulture)
                                + " mate=" + neighbor.ToString(CultureInfo.InvariantCulture)
                                + " delta=" + delta.ToString(CultureInfo.InvariantCulture)
                                + " kind=" + kind);
                            if (found.Count >= 100) return found;
                        }
                    }
                    if (requested <= 128) break;
                    offset += requested - 68;
                }
            }
            return found;
        }

        // RESEARCH toward always-on per-player stats: every broadcast stat
        // banner is a search warrant - the game just told us this player's
        // exact numbers, so the accumulator TABLE those numbers live in can
        // be found by scanning for the ordered tuple near the player's id.
        // Each hit logs the layout (offsets between fields, id offset); the
        // recurring layout across banners IS the table row shape.
        public List<string> HuntStatTuples(int first, int second, int third, int playerId,
            CancellationToken token)
        {
            EnsureAttached();
            List<string> found = new List<string>();
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                token.ThrowIfCancellationRequested();
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0x10000L || region.BaseAddress >= 0x100000000L) continue;
                long readableSize = Math.Min(region.Size, 0x100000000L - region.BaseAddress);
                long offset = 0;
                while (offset < readableSize)
                {
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    long chunkAddress = region.BaseAddress + offset;
                    int alignment = (int)((4 - (chunkAddress & 3)) & 3);
                    for (int index = alignment + 0x200; index + 4 <= bytesRead - 0x200; index += 4)
                    {
                        if (BitConverter.ToInt32(buffer, index) != first) continue;
                        for (int deltaSecond = 4; deltaSecond <= 0x80; deltaSecond += 4)
                        {
                            if (BitConverter.ToInt32(buffer, index + deltaSecond) != second) continue;
                            int thirdDelta = -1;
                            if (third >= 0)
                            {
                                for (int deltaThird = 4; deltaThird <= 0x80; deltaThird += 4)
                                {
                                    if (BitConverter.ToInt32(buffer, index + deltaSecond + deltaThird) == third)
                                    { thirdDelta = deltaThird; break; }
                                }
                                if (thirdDelta < 0) continue;
                            }
                            // The clincher: the player's id nearby. Without it
                            // small tuples like (4, 60, 1) are everywhere.
                            int idDelta = int.MinValue;
                            for (int deltaId = -0x200; deltaId <= 0x200; deltaId += 4)
                            {
                                if (BitConverter.ToInt32(buffer, index + deltaId) == playerId)
                                { idDelta = deltaId; break; }
                            }
                            if (idDelta == int.MinValue) continue;
                            found.Add("0x" + (chunkAddress + index).ToString("X", CultureInfo.InvariantCulture)
                                + " +s" + deltaSecond.ToString(CultureInfo.InvariantCulture)
                                + (thirdDelta >= 0 ? " +t" + thirdDelta.ToString(CultureInfo.InvariantCulture) : "")
                                + " id" + idDelta.ToString(CultureInfo.InvariantCulture));
                            if (found.Count >= 40) return found;
                            break;
                        }
                    }
                    if (requested <= 0x400) break;
                    offset += requested - 0x400;
                }
            }
            return found;
        }

        private static ulong HashRankContext(byte[] buffer, int start, int length, int awayIndex, int homeIndex,
            long chunkAddress, bool normalizePointers, bool shapeOnly)
        {
            const ulong offsetBasis = 14695981039346656037UL;
            const ulong prime = 1099511628211UL;
            ulong hash = offsetBasis;
            int end = start + length;
            for (int index = start; index < end; index++)
            {
                byte value = index == awayIndex || index == homeIndex ? (byte)0 : buffer[index];
                if (normalizePointers)
                {
                    long absolute = chunkAddress + index;
                    int alignedIndex = index - (int)(absolute & 7L);
                    if (alignedIndex >= 0 && alignedIndex + 8 <= buffer.Length)
                    {
                        ulong possiblePointer = BitConverter.ToUInt64(buffer, alignedIndex);
                        if (possiblePointer >= 0x10000UL && possiblePointer <= 0x00007FFFFFFFFFFFUL)
                            value = 0;
                    }
                }
                if (shapeOnly)
                {
                    if (value == 0) value = 0;
                    else if (value == 0xFF) value = 1;
                    else if (value <= 25) value = 2;
                    else if ((value >= (byte)'0' && value <= (byte)'9')
                        || (value >= (byte)'A' && value <= (byte)'Z')
                        || (value >= (byte)'a' && value <= (byte)'z')) value = 3;
                    else value = 4;
                }
                hash ^= value;
                hash *= prime;
            }
            return hash;
        }

        public List<long> FindModuleInt64References(long target, int maximumMatches, CancellationToken token)
        {
            EnsureAttached();
            if (maximumMatches < 1 || maximumMatches > 100000) throw new ArgumentOutOfRangeException("maximumMatches");
            ProcessModule module = process.MainModule;
            long moduleBase = module.BaseAddress.ToInt64();
            long moduleSize = module.ModuleMemorySize;
            List<long> result = new List<long>();
            byte[] buffer = new byte[ChunkSize];
            long offset = 0;
            while (offset < moduleSize)
            {
                token.ThrowIfCancellationRequested();
                int requested = (int)Math.Min(buffer.Length, moduleSize - offset);
                int bytesRead = Read(moduleBase + offset, buffer, requested);
                long chunkAddress = moduleBase + offset;
                int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                for (int byteIndex = alignment; byteIndex <= bytesRead - 8; byteIndex += 8)
                {
                    if (BitConverter.ToInt64(buffer, byteIndex) != target) continue;
                    result.Add(chunkAddress + byteIndex);
                    if (result.Count >= maximumMatches) return result;
                }
                if (requested <= 8) break;
                offset += requested - 8;
            }
            return result;
        }

        public List<long> FindModuleInt32References(int target, int maximumMatches, CancellationToken token)
        {
            EnsureAttached();
            if (maximumMatches < 1 || maximumMatches > 100000) throw new ArgumentOutOfRangeException("maximumMatches");
            ProcessModule module = process.MainModule;
            long moduleBase = module.BaseAddress.ToInt64();
            long moduleSize = module.ModuleMemorySize;
            List<long> result = new List<long>();
            byte[] buffer = new byte[ChunkSize];
            long offset = 0;
            while (offset < moduleSize)
            {
                token.ThrowIfCancellationRequested();
                int requested = (int)Math.Min(buffer.Length, moduleSize - offset);
                int bytesRead = Read(moduleBase + offset, buffer, requested);
                long chunkAddress = moduleBase + offset;
                int alignment = (int)((4 - (chunkAddress & 3)) & 3);
                for (int byteIndex = alignment; byteIndex <= bytesRead - 4; byteIndex += 4)
                {
                    if (BitConverter.ToInt32(buffer, byteIndex) != target) continue;
                    result.Add(chunkAddress + byteIndex);
                    if (result.Count >= maximumMatches) return result;
                }
                if (requested <= 4) break;
                offset += requested - 4;
            }
            return result;
        }

        public List<RankFieldLayoutCandidate> FindByteFieldPairs(int awayRank, int homeRank,
            int awayOffset, int homeOffset, int maximumMatches, CancellationToken token)
        {
            EnsureAttached();
            if (awayRank < 0 || awayRank > 255 || homeRank < 0 || homeRank > 255)
                throw new ArgumentOutOfRangeException("Rank values must fit in one byte.");
            if (awayOffset < 0 || homeOffset < 0 || awayOffset > 0x10000 || homeOffset > 0x10000)
                throw new ArgumentOutOfRangeException("Field offsets are outside the supported range.");
            if (maximumMatches < 1 || maximumMatches > 100000) throw new ArgumentOutOfRangeException("maximumMatches");

            int overlap = Math.Max(awayOffset, homeOffset) + 8;
            List<RankFieldLayoutCandidate> results = new List<RankFieldLayoutCandidate>();
            List<MemoryRegion> regions = EnumerateRegions();
            const int coreSize = 1024 * 1024;
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long coreOffset = 0;
                while (coreOffset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, region.Size - coreOffset);
                    int requested = (int)Math.Min(region.Size - coreOffset, coreLength + overlap);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + coreOffset, buffer, requested);
                    long coreAddress = region.BaseAddress + coreOffset;
                    int first = (int)((8 - (coreAddress & 7)) & 7);
                    for (int index = first; index < coreLength && index + overlap <= bytesRead; index += 8)
                    {
                        if (buffer[index + awayOffset] != (byte)awayRank
                            || buffer[index + homeOffset] != (byte)homeRank) continue;
                        results.Add(new RankFieldLayoutCandidate
                        {
                            BaseAddress = coreAddress + index,
                            FirstPointer = BitConverter.ToInt64(buffer, index)
                        });
                        if (results.Count >= maximumMatches) return results;
                    }
                    coreOffset += coreLength;
                }
            }
            return results;
        }

        public List<TypeInfoHeadCandidate> FindTypeInfoHeadCandidates(CancellationToken token)
        {
            EnsureAttached();
            ProcessModule module = process.MainModule;
            long moduleBase = module.BaseAddress.ToInt64();
            long moduleSize = module.ModuleMemorySize;
            byte[][] signatures = new byte[][]
            {
                new byte[] { 0x48, 0x8B, 0x05, 0, 0, 0, 0, 0x48, 0x89, 0x41, 0x08, 0x48, 0x89, 0x0D, 0, 0, 0, 0, 0xC3 },
                new byte[] { 0x48, 0x8B, 0x05, 0, 0, 0, 0, 0x48, 0x89, 0x41, 0x08, 0x48, 0x89, 0x0D, 0, 0, 0, 0 },
                new byte[] { 0x48, 0x8B, 0x05, 0, 0, 0, 0, 0x48, 0x89, 0x41, 0x08, 0x48, 0x89, 0x0D, 0, 0, 0, 0, 0x48, 0, 0, 0xC3 },
                new byte[] { 0x48, 0x8B, 0x05, 0, 0, 0, 0, 0x48, 0x89, 0x05, 0, 0, 0, 0, 0x48, 0x8D, 0x05, 0, 0, 0, 0, 0x48, 0x89, 0x05, 0, 0, 0, 0, 0xE9 },
                new byte[] { 0x48, 0x39, 0x1D, 0, 0, 0, 0, 0, 0, 0x48, 0x8B, 0x43, 0x10 }
            };
            bool[][] wildcards = new bool[][]
            {
                new bool[] { false, false, false, true, true, true, true, false, false, false, false, false, false, false, true, true, true, true, false },
                new bool[] { false, false, false, true, true, true, true, false, false, false, false, false, false, false, true, true, true, true },
                new bool[] { false, false, false, true, true, true, true, false, false, false, false, false, false, false, true, true, true, true, false, true, true, false },
                new bool[] { false, false, false, true, true, true, true, false, false, false, true, true, true, true, false, false, false, true, true, true, true, false, false, false, true, true, true, true, false },
                new bool[] { false, false, false, true, true, true, true, true, true, false, false, false, false }
            };
            int longestSignature = 0;
            for (int signatureIndex = 0; signatureIndex < signatures.Length; signatureIndex++)
                longestSignature = Math.Max(longestSignature, signatures[signatureIndex].Length);
            List<TypeInfoHeadCandidate> results = new List<TypeInfoHeadCandidate>();
            byte[] buffer = new byte[ChunkSize];
            long offset = 0;
            while (offset < moduleSize)
            {
                token.ThrowIfCancellationRequested();
                int requested = (int)Math.Min(buffer.Length, moduleSize - offset);
                int bytesRead = Read(moduleBase + offset, buffer, requested);
                for (int index = 0; index <= bytesRead - 7; index++)
                {
                    for (int signatureIndex = 0; signatureIndex < signatures.Length; signatureIndex++)
                    {
                        byte[] signature = signatures[signatureIndex];
                        bool[] wildcard = wildcards[signatureIndex];
                        if (index > bytesRead - signature.Length) continue;
                        bool matches = true;
                        for (int sigIndex = 0; sigIndex < signature.Length; sigIndex++)
                        {
                            if (wildcard[sigIndex] || buffer[index + sigIndex] == signature[sigIndex]) continue;
                            matches = false;
                            break;
                        }
                        if (!matches) continue;
                        long signatureAddress = moduleBase + offset + index;
                        int displacement = BitConverter.ToInt32(buffer, index + 3);
                        long globalAddress = signatureAddress + 7 + displacement;
                        long headPointer;
                        try { headPointer = ReadInt64(globalAddress); }
                        catch { continue; }
                        results.Add(new TypeInfoHeadCandidate
                        {
                            SignatureAddress = signatureAddress,
                            GlobalAddress = globalAddress,
                            HeadPointer = headPointer
                        });
                        if (results.Count >= 64) return results;
                    }
                }
                if (requested <= longestSignature) break;
                offset += requested - (longestSignature - 1);
            }
            return results;
        }

        public long[] FindTypedInt32Fields(int expected)
        {
            EnsureAttached();
            List<long> matches = new List<long>();
            HashSet<long> seen = new HashSet<long>();
            List<MemoryRegion> regions = EnumerateRegions();
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                long readableSize = Math.Min(region.Size, 0x100000000L - region.BaseAddress);
                long offset = 0;
                while (offset < readableSize)
                {
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead >= 0x30)
                    {
                        long chunkAddress = region.BaseAddress + offset;
                        int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                        int index = alignment;
                        while (index < 0x10) index += 8;
                        for (; index <= bytesRead - 0x18; index += 8)
                        {
                            if (BitConverter.ToInt32(buffer, index) != expected) continue;
                            if (BitConverter.ToInt32(buffer, index - 0x0C) != 0
                                || BitConverter.ToInt32(buffer, index - 0x10) == 0
                                || BitConverter.ToInt64(buffer, index - 0x08) == 0
                                || BitConverter.ToInt32(buffer, index + 0x04) != 0
                                || BitConverter.ToInt64(buffer, index + 0x08) != 0) continue;
                            long address = chunkAddress + index;
                            if (seen.Add(address)) matches.Add(address);
                        }
                    }
                    if (requested <= 0x40) break;
                    offset += requested - 0x40;
                }
            }
            return matches.ToArray();
        }

        public List<ManualValueCluster> FindInt32Clusters(int anchorExpected, int[] expectedValues, int radius, CancellationToken token)
        {
            EnsureAttached();
            if (expectedValues == null || expectedValues.Length == 0) throw new ArgumentException("Expected values are required.");
            if (radius < 16 || radius > 0x10000) throw new ArgumentOutOfRangeException("radius");
            List<ManualValueCluster> results = new List<ManualValueCluster>();
            List<MemoryRegion> regions = EnumerateRegions();
            const int coreSize = 1024 * 1024;
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long coreOffset = 0;
                while (coreOffset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, region.Size - coreOffset);
                    long readOffset = Math.Max(0, coreOffset - radius);
                    long readEnd = Math.Min(region.Size, coreOffset + coreLength + radius);
                    int requested = (int)(readEnd - readOffset);
                    byte[] buffer = new byte[requested];
                    int count = Read(region.BaseAddress + readOffset, buffer, requested);
                    if (count >= 4)
                    {
                        long coreAddress = region.BaseAddress + coreOffset;
                        int first = (int)(coreOffset - readOffset);
                        first += (int)((4 - ((coreAddress) & 3)) & 3);
                        int last = Math.Min(count - 4, (int)(coreOffset - readOffset) + coreLength - 4);
                        for (int index = first; index <= last; index += 4)
                        {
                            if (BitConverter.ToInt32(buffer, index) != anchorExpected) continue;
                            int windowStart = Math.Max(0, index - radius);
                            int windowEnd = Math.Min(count - 4, index + radius);
                            ManualValueCluster cluster = new ManualValueCluster
                            {
                                AnchorAddress = region.BaseAddress + readOffset + index
                            };
                            for (int valueIndex = 0; valueIndex < expectedValues.Length; valueIndex++)
                                if (!cluster.Matches.ContainsKey(expectedValues[valueIndex]))
                                    cluster.Matches.Add(expectedValues[valueIndex], new List<long>());
                            for (int nearby = windowStart + (int)((4 - ((region.BaseAddress + readOffset + windowStart) & 3)) & 3);
                                nearby <= windowEnd; nearby += 4)
                            {
                                int value = BitConverter.ToInt32(buffer, nearby);
                                List<long> addresses;
                                if (!cluster.Matches.TryGetValue(value, out addresses) || addresses.Count >= 32) continue;
                                addresses.Add(region.BaseAddress + readOffset + nearby);
                            }
                            bool complete = true;
                            foreach (KeyValuePair<int, List<long>> item in cluster.Matches)
                                if (item.Value.Count == 0) { complete = false; break; }
                            if (complete)
                            {
                                results.Add(cluster);
                                if (results.Count >= 256) return results;
                            }
                        }
                    }
                    coreOffset += coreLength;
                }
            }
            return results;
        }

        public List<RankOrderCandidate> FindRankOrderTables(Dictionary<int, int> rankToTeamId,
            int maxStride, CancellationToken token)
        {
            EnsureAttached();
            if (rankToTeamId == null || rankToTeamId.Count < 3) throw new ArgumentException("Rank mappings are required.");
            if (maxStride < 4 || maxStride > 0x1000 || (maxStride & 3) != 0) throw new ArgumentOutOfRangeException("maxStride");

            int anchorRank = 0;
            int anchorTeamId = Int32.MinValue;
            int maxRank = 0;
            foreach (KeyValuePair<int, int> item in rankToTeamId)
            {
                if (item.Key < 1 || item.Key > 25) throw new ArgumentOutOfRangeException("rankToTeamId");
                if (item.Value > anchorTeamId)
                {
                    anchorRank = item.Key;
                    anchorTeamId = item.Value;
                }
                if (item.Key > maxRank) maxRank = item.Key;
            }

            List<RankOrderCandidate> results = new List<RankOrderCandidate>();
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            List<MemoryRegion> regions = EnumerateRegions();
            const int coreSize = 1024 * 1024;
            int overlap = Math.Max(maxRank - 1, 25 - anchorRank) * maxStride;
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                long coreOffset = 0;
                while (coreOffset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, region.Size - coreOffset);
                    long readOffset = Math.Max(0, coreOffset - overlap);
                    long readEnd = Math.Min(region.Size, coreOffset + coreLength + overlap);
                    int requested = (int)(readEnd - readOffset);
                    byte[] buffer = new byte[requested];
                    int count = Read(region.BaseAddress + readOffset, buffer, requested);
                    if (count >= 4)
                    {
                        long coreAddress = region.BaseAddress + coreOffset;
                        int first = (int)(coreOffset - readOffset);
                        first += (int)((4 - (coreAddress & 3)) & 3);
                        int last = Math.Min(count - 4, (int)(coreOffset - readOffset) + coreLength - 4);
                        for (int index = first; index <= last; index += 4)
                        {
                            if (BitConverter.ToInt32(buffer, index) != anchorTeamId) continue;
                            for (int stride = 4; stride <= maxStride; stride += 4)
                            {
                                int matched = 0;
                                foreach (KeyValuePair<int, int> item in rankToTeamId)
                                {
                                    int target = index + (item.Key - anchorRank) * stride;
                                    if (target < 0 || target > count - 4) continue;
                                    if (BitConverter.ToInt32(buffer, target) == item.Value) matched++;
                                }
                                if (matched < rankToTeamId.Count - 1) continue;
                                long rankOne = region.BaseAddress + readOffset + index - (anchorRank - 1) * stride;
                                string key = rankOne.ToString("X", CultureInfo.InvariantCulture) + ":" + stride.ToString(CultureInfo.InvariantCulture);
                                if (!seen.Add(key)) continue;
                                results.Add(new RankOrderCandidate
                                {
                                    RankOneTeamField = rankOne,
                                    Stride = stride,
                                    Matched = matched
                                });
                                if (results.Count >= 256) return results;
                            }
                        }
                    }
                    coreOffset += coreLength;
                }
            }
            results.Sort(delegate(RankOrderCandidate left, RankOrderCandidate right)
            {
                int matchOrder = right.Matched.CompareTo(left.Matched);
                return matchOrder != 0 ? matchOrder : left.Stride.CompareTo(right.Stride);
            });
            return results;
        }

        public List<RankPairOffsetCandidate> FindInt32PairOffsets(int away, int home, int radius,
            CancellationToken token)
        {
            EnsureAttached();
            if (radius < 4 || radius > 0x10000 || (radius & 3) != 0) throw new ArgumentOutOfRangeException("radius");
            Dictionary<int, RankPairOffsetCandidate> counts = new Dictionary<int, RankPairOffsetCandidate>();
            List<MemoryRegion> regions = EnumerateRegions();
            const int coreSize = 1024 * 1024;
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                long coreOffset = 0;
                while (coreOffset < region.Size)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, region.Size - coreOffset);
                    long readOffset = Math.Max(0, coreOffset - radius);
                    long readEnd = Math.Min(region.Size, coreOffset + coreLength + radius);
                    int requested = (int)(readEnd - readOffset);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + readOffset, buffer, requested);
                    if (bytesRead >= 4)
                    {
                        List<int> homeOffsets = new List<int>();
                        int alignment = (int)((4 - ((region.BaseAddress + readOffset) & 3)) & 3);
                        for (int index = alignment; index <= bytesRead - 4; index += 4)
                            if (BitConverter.ToInt32(buffer, index) == home) homeOffsets.Add(index);

                        int first = (int)(coreOffset - readOffset);
                        first += (int)((4 - ((region.BaseAddress + coreOffset) & 3)) & 3);
                        int last = Math.Min(bytesRead - 4, (int)(coreOffset - readOffset) + coreLength - 4);
                        for (int index = first; index <= last; index += 4)
                        {
                            if (BitConverter.ToInt32(buffer, index) != away) continue;
                            int minimum = index - radius;
                            int maximum = index + radius;
                            int lower = LowerBound(homeOffsets, minimum);
                            for (int homeIndex = lower; homeIndex < homeOffsets.Count && homeOffsets[homeIndex] <= maximum; homeIndex++)
                            {
                                int delta = homeOffsets[homeIndex] - index;
                                RankPairOffsetCandidate item;
                                if (!counts.TryGetValue(delta, out item))
                                {
                                    item = new RankPairOffsetCandidate { Delta = delta };
                                    counts.Add(delta, item);
                                }
                                item.Count++;
                                if (item.AwayAddresses.Count < 12)
                                    item.AwayAddresses.Add(region.BaseAddress + readOffset + index);
                            }
                        }
                    }
                    coreOffset += coreLength;
                }
            }
            List<RankPairOffsetCandidate> results = new List<RankPairOffsetCandidate>(counts.Values);
            results.Sort(delegate(RankPairOffsetCandidate left, RankPairOffsetCandidate right)
            {
                int countOrder = right.Count.CompareTo(left.Count);
                if (countOrder != 0) return countOrder;
                return Math.Abs(left.Delta).CompareTo(Math.Abs(right.Delta));
            });
            return results;
        }

        public List<RankPairOffsetCandidate> FindFloatingPairOffsets(double away, double home,
            bool useDouble, int radius, CancellationToken token)
        {
            EnsureAttached();
            int width = useDouble ? 8 : 4;
            if (radius < width || radius > 0x10000 || (radius % width) != 0) throw new ArgumentOutOfRangeException("radius");
            long awayBits = useDouble
                ? BitConverter.ToInt64(BitConverter.GetBytes(away), 0)
                : BitConverter.ToInt32(BitConverter.GetBytes((float)away), 0);
            long homeBits = useDouble
                ? BitConverter.ToInt64(BitConverter.GetBytes(home), 0)
                : BitConverter.ToInt32(BitConverter.GetBytes((float)home), 0);
            Dictionary<int, RankPairOffsetCandidate> counts = new Dictionary<int, RankPairOffsetCandidate>();
            List<MemoryRegion> regions = EnumerateRegions();
            const int coreSize = 1024 * 1024;
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress >= 0x100000000L) continue;
                long readableSize = Math.Min(region.Size, 0x100000000L - region.BaseAddress);
                long coreOffset = 0;
                while (coreOffset < readableSize)
                {
                    token.ThrowIfCancellationRequested();
                    int coreLength = (int)Math.Min(coreSize, readableSize - coreOffset);
                    long readOffset = Math.Max(0, coreOffset - radius);
                    long readEnd = Math.Min(readableSize, coreOffset + coreLength + radius);
                    int requested = (int)(readEnd - readOffset);
                    byte[] buffer = new byte[requested];
                    int bytesRead = Read(region.BaseAddress + readOffset, buffer, requested);
                    if (bytesRead >= width)
                    {
                        List<int> homeOffsets = new List<int>();
                        int alignment = (int)((width - ((region.BaseAddress + readOffset) % width)) % width);
                        for (int index = alignment; index <= bytesRead - width; index += width)
                        {
                            long bits = useDouble ? BitConverter.ToInt64(buffer, index) : BitConverter.ToInt32(buffer, index);
                            if (bits == homeBits) homeOffsets.Add(index);
                        }
                        int first = (int)(coreOffset - readOffset);
                        first += (int)((width - ((region.BaseAddress + coreOffset) % width)) % width);
                        int last = Math.Min(bytesRead - width, (int)(coreOffset - readOffset) + coreLength - width);
                        for (int index = first; index <= last; index += width)
                        {
                            long bits = useDouble ? BitConverter.ToInt64(buffer, index) : BitConverter.ToInt32(buffer, index);
                            if (bits != awayBits) continue;
                            int lower = LowerBound(homeOffsets, index - radius);
                            for (int homeIndex = lower; homeIndex < homeOffsets.Count && homeOffsets[homeIndex] <= index + radius; homeIndex++)
                            {
                                int delta = homeOffsets[homeIndex] - index;
                                RankPairOffsetCandidate item;
                                if (!counts.TryGetValue(delta, out item))
                                {
                                    item = new RankPairOffsetCandidate { Delta = delta };
                                    counts.Add(delta, item);
                                }
                                item.Count++;
                                if (item.AwayAddresses.Count < 24)
                                    item.AwayAddresses.Add(region.BaseAddress + readOffset + index);
                            }
                        }
                    }
                    coreOffset += coreLength;
                }
            }
            List<RankPairOffsetCandidate> results = new List<RankPairOffsetCandidate>(counts.Values);
            results.Sort(delegate(RankPairOffsetCandidate left, RankPairOffsetCandidate right)
            {
                int countOrder = right.Count.CompareTo(left.Count);
                return countOrder != 0 ? countOrder : Math.Abs(left.Delta).CompareTo(Math.Abs(right.Delta));
            });
            return results;
        }

        private static int LowerBound(List<int> values, int expected)
        {
            int low = 0;
            int high = values.Count;
            while (low < high)
            {
                int middle = low + ((high - low) >> 1);
                if (values[middle] < expected) low = middle + 1;
                else high = middle;
            }
            return low;
        }

        public RamAutoDiscovery DiscoverTeamNames(CancellationToken token)
        {
            EnsureAttached();
            byte[] catalogPattern = new byte[41];
            Encoding.ASCII.GetBytes("AIRFOR").CopyTo(catalogPattern, 0);
            Encoding.ASCII.GetBytes("Air Force").CopyTo(catalogPattern, 32);
            byte[] homeMarker = Encoding.ASCII.GetBytes("Team Home");
            byte[] awayMarker = Encoding.ASCII.GetBytes("Team Away");
            byte[] traditionPrefix = Encoding.ASCII.GetBytes("content/traditions/teams/");
            byte[] timeoutPattern = TimeoutContextPattern;
            List<MemoryHit> catalogHits = new List<MemoryHit>();
            List<TeamMarkerHit> homeMarkers = new List<TeamMarkerHit>();
            List<MemoryHit> awayMarkers = new List<MemoryHit>();
            List<TraditionHit> traditionHits = new List<TraditionHit>();
            List<MemoryHit> timeoutContexts = new List<MemoryHit>();
            HashSet<long> seenCatalogs = new HashSet<long>();
            HashSet<long> seenHomeMarkers = new HashSet<long>();
            HashSet<long> seenAwayMarkers = new HashSet<long>();
            HashSet<long> seenTraditions = new HashSet<long>();
            HashSet<long> seenTimeouts = new HashSet<long>();
            RamAutoDiscovery result = new RamAutoDiscovery();

            List<MemoryRegion> regions = EnumerateRegions();
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                token.ThrowIfCancellationRequested();
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                if (region.Size < 64 || region.Size > 32L * 1024 * 1024) continue;
                byte[] buffer = new byte[(int)region.Size];
                int bytesRead = Read(region.BaseAddress, buffer, buffer.Length);
                if (bytesRead < 64) continue;
                result.RegionsScanned++;
                result.BytesScanned += bytesRead;
                FindCatalogHits(buffer, bytesRead, region, catalogPattern, catalogHits, seenCatalogs);
                FindHomeMarkerHits(buffer, bytesRead, region, homeMarker, homeMarkers, seenHomeMarkers);
                FindStandaloneMarkerHits(buffer, bytesRead, region, awayMarker, awayMarkers, seenAwayMarkers);
                FindTraditionHits(buffer, bytesRead, region, traditionPrefix, traditionHits, seenTraditions);
                for (int index = 0x65; index <= bytesRead - timeoutPattern.Length + 0x65; index++)
                {
                    // The state word at +0x04 changes as the presentation
                    // object is rebuilt, so it cannot be used as the anchor.
                    // This seven-byte marker at +0x65 is stable across the
                    // verified 3->2->1->0 timeout transitions.
                    if (buffer[index] != 0x01 || buffer[index + 1] != 0x01
                        || buffer[index + 2] != 0x00 || buffer[index + 3] != 0x01
                        || buffer[index + 4] != 0x00 || buffer[index + 5] != 0x00
                        || buffer[index + 6] != 0x00) continue;
                    int start = index - 0x65;
                    if (start < 0 || start + timeoutPattern.Length > bytesRead) continue;
                    int home = BitConverter.ToInt32(buffer, start + 0x44);
                    int away = BitConverter.ToInt32(buffer, start + 0x48);
                    if (home < 0 || home > 3 || away < 0 || away > 3) continue;
                    long address = region.BaseAddress + start;
                    if (MatchesTimeoutContext(buffer, start, timeoutPattern)
                        && seenTimeouts.Add(address))
                        timeoutContexts.Add(new MemoryHit(address, region));
                }
            }

            if (catalogHits.Count > 0)
            {
                catalogHits.Sort(delegate(MemoryHit left, MemoryHit right)
                {
                    int sizeOrder = left.RegionSize.CompareTo(right.RegionSize);
                    return sizeOrder != 0 ? sizeOrder : left.Address.CompareTo(right.Address);
                });
                result.TeamCatalogBase = catalogHits[0].Address;
                result.TeamCatalogLength = 0xF000;
            }
            Dictionary<string, string> catalogNames = ReadCatalogNames(
                result.TeamCatalogBase, result.TeamCatalogLength);
            KeepOnlyClonedTimeoutContexts(timeoutContexts, timeoutPattern);
            timeoutContexts.Sort(delegate(MemoryHit left, MemoryHit right)
            {
                return left.Address.CompareTo(right.Address);
            });
            for (int index = 0; index < timeoutContexts.Count; index++)
            {
                result.HomeTimeoutAddresses.Add(timeoutContexts[index].Address + 0x44);
                result.AwayTimeoutAddresses.Add(timeoutContexts[index].Address + 0x48);
                result.TimeoutCloneHomePossessionAddresses.Add(timeoutContexts[index].Address + 0x31);
            }
            ChooseVerifiedRoleTeams(result, homeMarkers, awayMarkers, traditionHits, catalogNames, regions);
            return result;
        }

        public RamAutoDiscovery DiscoverRamLayout(LiveScoreboard screen)
        {
            EnsureAttached();

            byte[] scoreboardHeader = Convert.FromBase64String(
                "/wAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AAAAAP////8AAAAA////////////AAAA/////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////8AAAAA/////wAAAAD/////AAAAAP////8AAAAA/////wAAAAD/////AAAAAP////8AAAAA/////wAAAAD/////AAAAAP////8AAAAA");
            byte[] timeoutPattern = TimeoutContextPattern;
            byte[] catalogPattern = new byte[41];
            Encoding.ASCII.GetBytes("AIRFOR").CopyTo(catalogPattern, 0);
            Encoding.ASCII.GetBytes("Air Force").CopyTo(catalogPattern, 32);
            byte[] homeMarker = Encoding.ASCII.GetBytes("Team Home");
            byte[] awayMarker = Encoding.ASCII.GetBytes("Team Away");
            byte[] traditionPrefix = Encoding.ASCII.GetBytes("content/traditions/teams/");

            List<RamBlockCandidate> scoreboardCandidates = new List<RamBlockCandidate>();
            List<MemoryHit> timeoutContexts = new List<MemoryHit>();
            List<RamTimeoutSnapshot> looseTimeoutContexts = new List<RamTimeoutSnapshot>();
            List<MemoryHit> catalogHits = new List<MemoryHit>();
            List<TeamMarkerHit> homeMarkers = new List<TeamMarkerHit>();
            List<MemoryHit> awayMarkers = new List<MemoryHit>();
            List<TraditionHit> traditionHits = new List<TraditionHit>();
            HashSet<long> seenScoreboards = new HashSet<long>();
            HashSet<long> seenTimeouts = new HashSet<long>();
            HashSet<long> seenLiveDistances = new HashSet<long>();
            HashSet<long> seenCatalogs = new HashSet<long>();
            HashSet<long> seenHomeMarkers = new HashSet<long>();
            HashSet<long> seenAwayMarkers = new HashSet<long>();
            HashSet<long> seenTraditions = new HashSet<long>();
            long synchronizedDownAddress = 0;
            long synchronizedDistanceAddress = 0;
            long synchronizedPossessionAddress = 0;

            RamAutoDiscovery result = new RamAutoDiscovery();
            List<MemoryRegion> regions = EnumerateRegions();

            // REVERTED 2026-08-11. This loop was parallelised with per-region
            // accumulation and a per-worker reused buffer, which cut a locate
            // from 8.5 s to 5.6 s. It also stopped the timeout clones being
            // discovered at all - verified by comparing --locate output against
            // the previous build, where homeTimeouts/awayTimeouts came back as
            // 0x7FAE2844/0x7FAE2B14 and under the parallel version came back
            // empty. The A/B that approved the change compared team, catalog
            // and scoreboard fields but not the timeout addresses, so the
            // regression shipped. Timeouts matter more than three seconds.
            //
            // If this is attempted again: check EVERY field --locate reports,
            // not a sample, and work out which of the two changes (concurrency
            // or buffer reuse) is responsible before assuming either is safe.
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                if (region.Size < 128 || region.Size > 32L * 1024 * 1024) continue;

                byte[] buffer = new byte[(int)region.Size];
                int bytesRead = Read(region.BaseAddress, buffer, buffer.Length);
                if (bytesRead < 128) continue;
                result.RegionsScanned++;
                result.BytesScanned += bytesRead;

                int alignment = (int)((8 - (region.BaseAddress & 7)) & 7);
                for (int index = alignment; index <= bytesRead - 0x114; index += 8)
                {
                    long address = region.BaseAddress + index;

                    // The real live yards-to-go value is an aligned field in
                    // a typed Frostbite object. Its field hash and surrounding
                    // zero slots stay fixed while the object address changes.
                    // This signature was isolated through verified 10->6->5
                    // transitions; the old catalog value lagged by a play.
                    if (LooksLikeLiveDistance(buffer, index, bytesRead)
                        && seenLiveDistances.Add(address))
                        result.LiveDistanceAddresses.Add(address);
                    if (BitConverter.ToInt64(buffer, index + 0xE0) == address + 0xEC)
                    {
                        // The presentation layer can change the otherwise-static bytes at the
                        // front of this block between matchups.  The self-pointer at +0xE0 and
                        // the validated live fields are the stable part of the structure, so
                        // keep the old header as a ranking signal instead of a hard rejection.
                        bool exactScoreboardHeader = Matches(buffer, index, scoreboardHeader, -1, -1);
                        RamBlockCandidate candidate = ReadBlockCandidate(buffer, index, address, screen);
                        if (candidate != null && seenScoreboards.Add(address))
                        {
                            if (exactScoreboardHeader) candidate.Score += 1000;
                            scoreboardCandidates.Add(candidate);
                        }
                    }

                    // Current builds also expose a wider game-state record.  Its values are
                    // stored in 64-bit slots and the two scores are duplicated, which gives
                    // us a restart-safe structural signature that needs no screen snapshot.
                    int wideQuarter = index <= bytesRead - 0x188 ? BitConverter.ToInt32(buffer, index + 0xC8) : 0;
                    if (index <= bytesRead - 0x188 && wideQuarter >= 1 && wideQuarter <= 20
                        && BitConverter.ToInt32(buffer, index + 0xCC) == 0)
                    {
                        RamBlockCandidate wideCandidate = ReadWideBlockCandidate(buffer, index, address, screen);
                        // Ignore the millions of dormant objects that happen
                        // to share the wide slot layout. A live game has a
                        // running game clock plus at least one initialized
                        // play-state field (or a non-zero score).
                        bool activeWithoutScreen = screen != null
                            || (wideCandidate != null && wideCandidate.Clock >= 5
                                && (wideCandidate.PlayClock >= 5
                                    || wideCandidate.HomeScore > 0 || wideCandidate.AwayScore > 0
                                    || wideCandidate.Down > 0 || wideCandidate.Distance > 0));
                        if (wideCandidate != null && activeWithoutScreen && seenScoreboards.Add(address))
                            scoreboardCandidates.Add(wideCandidate);
                    }
                }

                // When the UI object is rebuilt without either legacy marker,
                // a trustworthy screen snapshot can seed a narrow structural
                // search.  Quarter plus both scores makes the first filter very
                // selective; the remaining clock/play/down fields are validated
                // by ReadBlockCandidate and used to rank the matches.
                if (screen != null && screen.QuarterNumber > 0 && (screen.AwayScore != 0 || screen.HomeScore != 0))
                {
                    int structuralAlignment = (int)((4 - (region.BaseAddress & 3)) & 3);
                    for (int index = structuralAlignment; index <= bytesRead - 0x114; index += 4)
                    {
                        if (BitConverter.ToInt32(buffer, index + 0xEC) != screen.QuarterNumber) continue;
                        if (BitConverter.ToInt32(buffer, index + 0xFC) != screen.HomeScore) continue;
                        if (BitConverter.ToInt32(buffer, index + 0x100) != screen.AwayScore) continue;
                        long address = region.BaseAddress + index;
                        if (seenScoreboards.Contains(address)) continue;
                        RamBlockCandidate candidate = ReadBlockCandidate(buffer, index, address, screen);
                        if (candidate == null) continue;
                        candidate.Score += 700;
                        seenScoreboards.Add(address);
                        scoreboardCandidates.Add(candidate);
                    }
                }

                for (int index = 0x65; index <= bytesRead - timeoutPattern.Length + 0x65; index++)
                {
                    if (buffer[index] != 0x01 || buffer[index + 1] != 0x01
                        || buffer[index + 2] != 0x00 || buffer[index + 3] != 0x01
                        || buffer[index + 4] != 0x00 || buffer[index + 5] != 0x00
                        || buffer[index + 6] != 0x00) continue;
                    int start = index - 0x65;
                    if (start < 0 || start + timeoutPattern.Length > bytesRead) continue;
                    int home = BitConverter.ToInt32(buffer, start + 0x44);
                    int away = BitConverter.ToInt32(buffer, start + 0x48);
                    if (home < 0 || home > 3 || away < 0 || away > 3) continue;
                    long address = region.BaseAddress + start;
                    int similarity = TimeoutContextSimilarity(buffer, start, timeoutPattern);
                    // Only 41 bytes remain static after the documented mode/state
                    // ranges are masked. Keep near matches visible in diagnostics;
                    // this list is advisory and never bypasses the exact clone gate.
                    if (similarity >= 38)
                    {
                        looseTimeoutContexts.Add(new RamTimeoutSnapshot
                        {
                            Address = address,
                            Similarity = similarity,
                            Home = home,
                            Away = away
                        });
                    }
                    if (MatchesTimeoutContext(buffer, start, timeoutPattern)
                        && seenTimeouts.Add(address))
                        timeoutContexts.Add(new MemoryHit(address, region));
                }

                FindCatalogHits(buffer, bytesRead, region, catalogPattern, catalogHits, seenCatalogs);
                FindHomeMarkerHits(buffer, bytesRead, region, homeMarker, homeMarkers, seenHomeMarkers);
                FindStandaloneMarkerHits(buffer, bytesRead, region, awayMarker, awayMarkers, seenAwayMarkers);
                FindTraditionHits(buffer, bytesRead, region, traditionPrefix, traditionHits, seenTraditions);
            }

            if (result.LiveDistanceAddresses.Count == 0)
                FindLiveDistanceAddresses(regions, result.LiveDistanceAddresses);

            // Some presentations retain a legacy verification record at a
            // stable offset before the team catalog. Add it before temporal
            // sampling so it can corroborate a moving wide record. It is not
            // sufficient by itself to publish a core.
            for (int i = 0; i < catalogHits.Count; i++)
            {
                long address = catalogHits[i].Address - 0x3D94;
                if (address <= 0 || seenScoreboards.Contains(address)) continue;
                byte[] block = new byte[0x114];
                int fallbackBytesRead = Read(address, block, block.Length);
                if (fallbackBytesRead < block.Length) continue;
                RamBlockCandidate candidate = ReadBlockCandidate(block, 0, address, screen);
                if (candidate == null) continue;
                candidate.Score += 500;
                seenScoreboards.Add(address);
                scoreboardCandidates.Add(candidate);
            }

            // Always sample temporal movement. A dormant wide/legacy pair can
            // remain perfectly synchronized, and previously that alone skipped
            // the temporal pass and allowed a static initialization record to
            // beat the real moving scoreboard.
            PromoteChangingWideCandidates(scoreboardCandidates, screen);
            if (!HasSynchronizedScoreboardPair(scoreboardCandidates))
            {
                List<RamBlockCandidate> wideSeeds = new List<RamBlockCandidate>();
                for (int candidateIndex = 0; candidateIndex < scoreboardCandidates.Count; candidateIndex++)
                {
                    RamBlockCandidate candidate = scoreboardCandidates[candidateIndex];
                    if (candidate.UsesWideLayout) wideSeeds.Add(candidate);
                }
                wideSeeds.Sort(delegate(RamBlockCandidate left, RamBlockCandidate right)
                {
                    return right.Score.CompareTo(left.Score);
                });
                if (wideSeeds.Count > 1) wideSeeds.RemoveRange(1, wideSeeds.Count - 1);
                // With no screen input, a changing wide record is stronger
                // evidence than a long structural sweep that can race a live
                // clock. Publish that record after the exporter confirms it
                // three more times. The high fallback remains available only
                // when an explicit diagnostic screen seed is supplied.
                bool observedLiveWide = false;
                for (int seedIndex = 0; seedIndex < wideSeeds.Count; seedIndex++)
                    if (wideSeeds[seedIndex].LiveChangeObserved) { observedLiveWide = true; break; }
                if (!observedLiveWide && screen != null)
                    FindHighScoreboardCandidates(regions, scoreboardHeader, screen, scoreboardCandidates, seenScoreboards, result, wideSeeds);
            }

            result.ScoreboardCandidateCount = scoreboardCandidates.Count;
            if (scoreboardCandidates.Count > 0)
            {
                scoreboardCandidates.Sort(delegate(RamBlockCandidate left, RamBlockCandidate right)
                {
                    int scoreOrder = right.Score.CompareTo(left.Score);
                    return scoreOrder != 0 ? scoreOrder : right.Address.CompareTo(left.Address);
                });
                RamBlockCandidate primary = null;
                RamBlockCandidate synchronizedLegacy = null;

                // Retain one strongly game-like static candidate for a safe
                // same-session profile migration. Normal cold discovery still
                // requires either temporal movement or an agreeing record.
                for (int candidateIndex = 0; candidateIndex < scoreboardCandidates.Count; candidateIndex++)
                {
                    RamBlockCandidate candidate = scoreboardCandidates[candidateIndex];
                    if (candidate.UsesWideLayout
                        && (candidate.Clock >= 15 || (candidate.Clock >= 1
                            && (candidate.HomeScore > 0 || candidate.AwayScore > 0)))
                        && candidate.PlayClock >= 5
                        && ((candidate.Down >= 1 && candidate.Down <= 4)
                            || candidate.HomeScore > 0 || candidate.AwayScore > 0))
                    {
                        result.TentativeWideScoreboardBlock = candidate.Address;
                        break;
                    }
                }

                // A newly located static wide/legacy pair can be a retained or
                // one-time initialization record. Select only a wide record
                // that demonstrated two consecutive, coherent countdown
                // transitions during this scan. If a legacy copy agrees with
                // that moving record, retain it only as independent
                // verification/possession evidence.
                // Prefer a moving wide record that also has an independently
                // synchronized legacy record. If none exists, fall back to the
                // highest-ranked moving wide record. A merely moving decoy must
                // not beat a moving record with corroboration.
                for (int selectionPass = 0; selectionPass < 2 && primary == null; selectionPass++)
                {
                    for (int wideIndex = 0; wideIndex < scoreboardCandidates.Count && primary == null; wideIndex++)
                    {
                        RamBlockCandidate wide = scoreboardCandidates[wideIndex];
                        if (!wide.UsesWideLayout || !wide.LiveChangeObserved) continue;
                        RamBlockCandidate firstSynchronizedLegacy = null;
                        int synchronizedPossession = -1;
                        bool possessionConflict = false;
                        for (int legacyIndex = 0; legacyIndex < scoreboardCandidates.Count; legacyIndex++)
                        {
                            RamBlockCandidate legacy = scoreboardCandidates[legacyIndex];
                            if (legacy.UsesWideLayout) continue;
                            if (legacy.Quarter == wide.Quarter
                                && Math.Abs(legacy.Clock - wide.Clock) <= 1
                                && Math.Abs(legacy.PlayClock - wide.PlayClock) <= 1
                                && legacy.HomeScore == wide.HomeScore
                                && legacy.AwayScore == wide.AwayScore
                                // Down and distance are part of the synchronized
                                // record too. Allowing the legacy copy to match
                                // only the clock/scores can pair a current wide
                                // record with a retained previous-play copy.
                                && legacy.Down == wide.Down
                                && legacy.Distance == wide.Distance)
                            {
                                if (firstSynchronizedLegacy == null)
                                {
                                    firstSynchronizedLegacy = legacy;
                                    synchronizedPossession = legacy.Possession;
                                }
                                else if (legacy.Possession != synchronizedPossession)
                                    possessionConflict = true;
                            }
                        }
                        RamBlockCandidate agreeingLegacy = possessionConflict ? null : firstSynchronizedLegacy;
                        bool hasSynchronizedLegacy = firstSynchronizedLegacy != null;
                        if ((selectionPass == 0 && !hasSynchronizedLegacy)
                            || (selectionPass == 1 && hasSynchronizedLegacy)) continue;
                        primary = wide;
                        synchronizedLegacy = agreeingLegacy;
                    }
                }

                // Never publish a lone legacy record or a static synchronized
                // pair. Both can survive a matchup change. A paused/static
                // startup intentionally remains unavailable until gameplay
                // supplies temporal proof.

                // Diagnostic only - counts what the pairing above had to work
                // with, so an empty possession address can name its own cause.
                int movingWideCandidates = 0;
                int legacyCandidates = 0;
                for (int index = 0; index < scoreboardCandidates.Count; index++)
                {
                    RamBlockCandidate candidate = scoreboardCandidates[index];
                    if (!candidate.UsesWideLayout) legacyCandidates++;
                    else if (candidate.LiveChangeObserved) movingWideCandidates++;
                }
                result.PossessionDiagnostic = synchronizedLegacy != null
                    ? "paired (legacy 0x" + synchronizedLegacy.Address.ToString("X", CultureInfo.InvariantCulture)
                        + ", possession=" + synchronizedLegacy.Possession.ToString(CultureInfo.InvariantCulture) + ")"
                    : "no synchronized legacy (moving wide=" + movingWideCandidates.ToString(CultureInfo.InvariantCulture)
                        + ", legacy candidates=" + legacyCandidates.ToString(CultureInfo.InvariantCulture)
                        + ", total=" + scoreboardCandidates.Count.ToString(CultureInfo.InvariantCulture)
                        + ", primary=" + (primary != null ? "found" : "none") + ")";

                if (primary != null)
                {
                    result.ScoreboardBlock = primary.Address;
                    result.UsesWideScoreboardLayout = primary.UsesWideLayout;
                    if (primary.UsesWideLayout && synchronizedLegacy != null)
                    {
                        result.VerificationScoreboardBlock = synchronizedLegacy.Address;
                        result.VerificationUsesWideScoreboardLayout = synchronizedLegacy.UsesWideLayout;
                        synchronizedPossessionAddress = synchronizedLegacy.Address + 0x108;
                        synchronizedDownAddress = synchronizedLegacy.Address + 0x10C;
                        synchronizedDistanceAddress = synchronizedLegacy.Address + 0x110;
                    }
                }
                for (int i = 0; i < scoreboardCandidates.Count && i < 512; i++)
                {
                    RamBlockCandidate candidate = scoreboardCandidates[i];
                    result.ScoreboardCandidates.Add(new RamScoreboardSnapshot
                    {
                        Address = candidate.Address,
                        Score = candidate.Score,
                        Quarter = candidate.Quarter,
                        Clock = candidate.Clock,
                        PlayClock = candidate.PlayClock,
                        HomeScore = candidate.HomeScore,
                        AwayScore = candidate.AwayScore,
                        Possession = candidate.Possession,
                        Down = candidate.Down,
                        Distance = candidate.Distance
                        , UsesWideLayout = candidate.UsesWideLayout
                        , LiveChangeObserved = candidate.LiveChangeObserved
                    });
                }
            }

            KeepOnlyClonedTimeoutContexts(timeoutContexts, timeoutPattern);
            timeoutContexts.Sort(delegate(MemoryHit left, MemoryHit right) { return left.Address.CompareTo(right.Address); });
            for (int i = 0; i < timeoutContexts.Count; i++)
            {
                result.HomeTimeoutAddresses.Add(timeoutContexts[i].Address + 0x44);
                result.AwayTimeoutAddresses.Add(timeoutContexts[i].Address + 0x48);
                result.TimeoutCloneHomePossessionAddresses.Add(timeoutContexts[i].Address + 0x31);
            }
            looseTimeoutContexts.Sort(delegate(RamTimeoutSnapshot left, RamTimeoutSnapshot right)
            {
                int scoreOrder = right.Similarity.CompareTo(left.Similarity);
                return scoreOrder != 0 ? scoreOrder : left.Address.CompareTo(right.Address);
            });
            for (int i = 0; i < looseTimeoutContexts.Count && i < 100; i++)
                result.TimeoutCandidates.Add(looseTimeoutContexts[i]);

            if (catalogHits.Count > 0)
            {
                catalogHits.Sort(delegate(MemoryHit left, MemoryHit right)
                {
                    int sizeOrder = left.RegionSize.CompareTo(right.RegionSize);
                    return sizeOrder != 0 ? sizeOrder : left.Address.CompareTo(right.Address);
                });
                result.TeamCatalogBase = catalogHits[0].Address;
                result.TeamCatalogLength = 0xF000;
            }

            // The current wide game-state layout keeps the two remaining-
            // timeout counters in a stable catalog-relative pair.  This pair
            // was isolated across verified 3->2->1 home-team transitions; the
            // adjacent away counter remained at 3. Use it only to corroborate
            // the exact two-clone presentation topology. The exporter requires
            // both clones, so replacing them with this one direct address would
            // make a successful discovery impossible to publish safely.
            if (result.UsesWideScoreboardLayout && result.TeamCatalogBase != 0
                && (result.HomeTimeoutAddresses.Count > 0
                    || result.AwayTimeoutAddresses.Count > 0))
            {
                long homeTimeoutAddress = result.TeamCatalogBase + 0x67850;
                long awayTimeoutAddress = homeTimeoutAddress + 4;
                bool corroborated = false;
                bool hasPresentationConsensus = false;
                int presentationHome = -1;
                int presentationAway = -1;
                try
                {
                    int homeTimeouts = ReadInt32(homeTimeoutAddress);
                    int awayTimeouts = ReadInt32(awayTimeoutAddress);
                    hasPresentationConsensus = TryReadTimeoutConsensus(
                        result.HomeTimeoutAddresses, result.AwayTimeoutAddresses,
                        out presentationHome, out presentationAway);
                    corroborated = CatalogTimeoutCountersCorroborateClones(
                        hasPresentationConsensus,
                        homeTimeouts, awayTimeouts,
                        presentationHome, presentationAway);
                }
                catch { }
                // The catalog word may not overrule a clone pair that already
                // passed its own five-layer verification. It lags behind used
                // timeouts and does not hold timeout counts in every mode -
                // observed live vetoing a correct 3/3 - and every discovery it
                // wrongly vetoed burned one of the exporter's bounded recovery
                // attempts, which is how timeouts stayed blank for 23 minutes
                // of a live Dynasty game on 2026-08-12. The one case it is
                // still needed for is the dormant 0/0 pair a dead game can
                // leave behind, which structure alone cannot tell from a real
                // late-game 0/0.
                if (TimeoutCatalogVetoApplies(hasPresentationConsensus,
                    presentationHome, presentationAway, corroborated))
                {
                    result.HomeTimeoutAddresses.Clear();
                    result.AwayTimeoutAddresses.Clear();
                    result.TimeoutCloneHomePossessionAddresses.Clear();
                }
            }

            if (result.TeamCatalogBase != 0)
            {
                long liveDownAddress = result.TeamCatalogBase + 0x677F8;
                try
                {
                    int liveDown = ReadInt32(liveDownAddress);
                    if (liveDown >= 1 && liveDown <= 4)
                        result.LiveDownAddresses.Add(liveDownAddress);
                }
                catch { }
            }

            if (synchronizedPossessionAddress != 0
                && synchronizedDownAddress != 0 && synchronizedDistanceAddress != 0)
            {
                result.LivePossessionAddresses.Clear();
                result.LiveDownAddresses.Clear();
                result.LiveDistanceAddresses.Clear();
                result.LivePossessionAddresses.Add(synchronizedPossessionAddress);
                result.LiveDownAddresses.Add(synchronizedDownAddress);
                result.LiveDistanceAddresses.Add(synchronizedDistanceAddress);
            }

            Dictionary<string, string> catalogNames = ReadCatalogNames(result.TeamCatalogBase, result.TeamCatalogLength);
            ChooseVerifiedRoleTeams(result, homeMarkers, awayMarkers, traditionHits, catalogNames, regions);
            return result;
        }

        private void PromoteChangingWideCandidates(List<RamBlockCandidate> candidates, LiveScoreboard screen)
        {
            // A single initialization write is not liveness. Sample two full
            // timer intervals and require the same structurally valid address
            // to count down coherently in both. This rejects the cold-start
            // 1Q 0:31/play-clock-0 decoy that initialized once and then froze.
            Dictionary<long, RamBlockCandidate> baselineSamples = new Dictionary<long, RamBlockCandidate>();
            Dictionary<long, RamBlockCandidate> middleSamples = new Dictionary<long, RamBlockCandidate>();
            Dictionary<long, RamBlockCandidate> finalSamples = new Dictionary<long, RamBlockCandidate>();
            Stopwatch sampleClock = Stopwatch.StartNew();
            for (int index = 0; index < candidates.Count; index++)
            {
                RamBlockCandidate candidate = candidates[index];
                if (!candidate.UsesWideLayout) continue;
                byte[] block = new byte[0x188];
                int bytesRead = Read(candidate.Address, block, block.Length);
                if (bytesRead < block.Length) continue;
                RamBlockCandidate baseline = ReadWideBlockCandidate(block, 0, candidate.Address, screen);
                if (baseline != null) baselineSamples[candidate.Address] = baseline;
            }
            if (baselineSamples.Count == 0) return;
            long baselineAtMs = sampleClock.ElapsedMilliseconds;
            Thread.Sleep(1050);
            for (int index = 0; index < candidates.Count; index++)
            {
                RamBlockCandidate candidate = candidates[index];
                if (!candidate.UsesWideLayout || !baselineSamples.ContainsKey(candidate.Address)) continue;
                byte[] block = new byte[0x188];
                int bytesRead = Read(candidate.Address, block, block.Length);
                if (bytesRead < block.Length) continue;
                RamBlockCandidate middle = ReadWideBlockCandidate(block, 0, candidate.Address, screen);
                if (middle != null) middleSamples[candidate.Address] = middle;
            }
            if (middleSamples.Count == 0) return;
            long middleAtMs = sampleClock.ElapsedMilliseconds;
            Thread.Sleep(1050);
            for (int index = 0; index < candidates.Count; index++)
            {
                RamBlockCandidate candidate = candidates[index];
                if (!candidate.UsesWideLayout || !middleSamples.ContainsKey(candidate.Address)) continue;
                byte[] block = new byte[0x188];
                int bytesRead = Read(candidate.Address, block, block.Length);
                if (bytesRead < block.Length) continue;
                RamBlockCandidate final = ReadWideBlockCandidate(block, 0, candidate.Address, screen);
                if (final != null) finalSamples[candidate.Address] = final;
            }
            long finalAtMs = sampleClock.ElapsedMilliseconds;
            for (int index = 0; index < candidates.Count; index++)
            {
                RamBlockCandidate candidate = candidates[index];
                RamBlockCandidate baseline;
                RamBlockCandidate middle;
                RamBlockCandidate final;
                if (!candidate.UsesWideLayout
                    || !baselineSamples.TryGetValue(candidate.Address, out baseline)
                    || !middleSamples.TryGetValue(candidate.Address, out middle)
                    || !finalSamples.TryGetValue(candidate.Address, out final)) continue;
                if (HasCoherentLiveWideProgression(
                    WideSnapshot(baseline), WideSnapshot(middle), WideSnapshot(final),
                    middleAtMs - baselineAtMs, finalAtMs - middleAtMs))
                {
                    candidate.Score += 5000;
                    candidate.LiveChangeObserved = true;
                }
                CopyCandidateState(candidate, final);
            }

            // Synchronization must compare records from the same moment. The
            // wide candidates now hold the final sample, so refresh every
            // legacy candidate at that same final epoch before pairing them.
            for (int index = 0; index < candidates.Count; index++)
            {
                RamBlockCandidate candidate = candidates[index];
                if (candidate.UsesWideLayout) continue;
                byte[] block = new byte[0x114];
                int bytesRead = Read(candidate.Address, block, block.Length);
                if (bytesRead < block.Length) continue;
                RamBlockCandidate final = ReadBlockCandidate(block, 0, candidate.Address, screen);
                if (final != null) CopyCandidateState(candidate, final);
            }
        }

        private static void CopyCandidateState(RamBlockCandidate target, RamBlockCandidate source)
        {
            target.Quarter = source.Quarter;
            target.Clock = source.Clock;
            target.PlayClock = source.PlayClock;
            target.HomeScore = source.HomeScore;
            target.AwayScore = source.AwayScore;
            target.Possession = source.Possession;
            target.Down = source.Down;
            target.Distance = source.Distance;
        }

        private static RamScoreboardSnapshot WideSnapshot(RamBlockCandidate candidate)
        {
            return new RamScoreboardSnapshot
            {
                Address = candidate.Address,
                Quarter = candidate.Quarter,
                Clock = candidate.Clock,
                PlayClock = candidate.PlayClock,
                HomeScore = candidate.HomeScore,
                AwayScore = candidate.AwayScore,
                Down = candidate.Down,
                Distance = candidate.Distance,
                UsesWideLayout = candidate.UsesWideLayout
            };
        }

        internal static bool HasCoherentLiveWideProgression(
            RamScoreboardSnapshot first, RamScoreboardSnapshot second, RamScoreboardSnapshot third)
        {
            return HasCoherentLiveWideProgression(first, second, third, 1050, 1050);
        }

        internal static bool HasCoherentLiveWideProgression(
            RamScoreboardSnapshot first, RamScoreboardSnapshot second, RamScoreboardSnapshot third,
            long firstIntervalMilliseconds, long secondIntervalMilliseconds)
        {
            if (!StrongLiveWideSnapshot(first) || !StrongLiveWideSnapshot(second)
                || !StrongLiveWideSnapshot(third)) return false;
            if (first.Address == 0 || first.Address != second.Address || first.Address != third.Address)
                return false;
            return IsCoherentCountdownInterval(first, second, firstIntervalMilliseconds)
                && IsCoherentCountdownInterval(second, third, secondIntervalMilliseconds);
        }

        private static bool StrongLiveWideSnapshot(RamScoreboardSnapshot value)
        {
            return value != null && value.UsesWideLayout
                && value.Quarter >= 1 && value.Quarter <= 10
                && value.Clock >= 0 && value.Clock <= 900
                && value.PlayClock >= 0 && value.PlayClock <= 99
                && value.HomeScore >= 0 && value.HomeScore <= 255
                && value.AwayScore >= 0 && value.AwayScore <= 255
                && ((value.Down >= 1 && value.Down <= 4)
                    || (value.Down == 0 && value.Distance == 0))
                && value.Distance >= 0 && value.Distance <= 99;
        }

        private static bool IsCoherentCountdownInterval(
            RamScoreboardSnapshot before, RamScoreboardSnapshot after, long elapsedMilliseconds)
        {
            if (before.Quarter != after.Quarter
                || before.HomeScore != after.HomeScore || before.AwayScore != after.AwayScore
                || before.Down != after.Down || before.Distance != after.Distance) return false;
            int clockDrop = before.Clock - after.Clock;
            int playClockDrop = before.PlayClock - after.PlayClock;
            int maximumDrop = (int)Math.Max(2L,
                Math.Min(5L, ((Math.Max(1L, elapsedMilliseconds) + 999L) / 1000L) + 1L));
            return clockDrop >= 0 && clockDrop <= maximumDrop
                && playClockDrop >= 0 && playClockDrop <= maximumDrop
                && (clockDrop > 0 || playClockDrop > 0);
        }

        private static bool HasSynchronizedScoreboardPair(List<RamBlockCandidate> candidates)
        {
            for (int wideIndex = 0; wideIndex < candidates.Count; wideIndex++)
            {
                RamBlockCandidate wide = candidates[wideIndex];
                if (!wide.UsesWideLayout) continue;
                for (int legacyIndex = 0; legacyIndex < candidates.Count; legacyIndex++)
                {
                    RamBlockCandidate legacy = candidates[legacyIndex];
                    if (legacy.UsesWideLayout) continue;
                    if (legacy.Quarter == wide.Quarter
                        && Math.Abs(legacy.Clock - wide.Clock) <= 1
                        && Math.Abs(legacy.PlayClock - wide.PlayClock) <= 1
                        && legacy.HomeScore == wide.HomeScore
                        && legacy.AwayScore == wide.AwayScore
                        && legacy.Down == wide.Down
                        && legacy.Distance == wide.Distance) return true;
                }
            }
            return false;
        }

        private void FindLiveDistanceAddresses(List<MemoryRegion> regions, List<long> result)
        {
            HashSet<long> seen = new HashSet<long>(result);
            byte[] buffer = new byte[ChunkSize];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.BaseAddress < 0 || region.BaseAddress >= 0x100000000L) continue;
                long readableSize = Math.Min(region.Size, 0x100000000L - region.BaseAddress);
                long offset = 0;
                while (offset < readableSize)
                {
                    int requested = (int)Math.Min(buffer.Length, readableSize - offset);
                    int bytesRead = Read(region.BaseAddress + offset, buffer, requested);
                    if (bytesRead >= 0x30)
                    {
                        long chunkAddress = region.BaseAddress + offset;
                        int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                        int index = alignment;
                        while (index < 0x10) index += 8;
                        for (; index <= bytesRead - 0x28; index += 8)
                        {
                            if (!LooksLikeLiveDistance(buffer, index, bytesRead)) continue;
                            long address = chunkAddress + index;
                            if (seen.Add(address)) result.Add(address);
                        }
                    }
                    if (requested <= 0x40) break;
                    offset += requested - 0x40;
                }
            }
        }

        private static bool LooksLikeLiveDistance(byte[] buffer, int index, int bytesRead)
        {
            if (index < 0x10 || index > bytesRead - 0x28) return false;
            int value = BitConverter.ToInt32(buffer, index);
            return BitConverter.ToInt32(buffer, index - 0x10) == unchecked((int)0xCDBEACB9)
                && BitConverter.ToInt32(buffer, index - 0x0C) == 0
                && BitConverter.ToInt64(buffer, index - 0x08) != 0
                && value >= 0 && value <= 99
                && BitConverter.ToInt32(buffer, index + 0x04) == 0
                && BitConverter.ToInt64(buffer, index + 0x08) == 0;
        }

        private void FindHighScoreboardCandidates(
            List<MemoryRegion> regions,
            byte[] scoreboardHeader,
            LiveScoreboard screen,
            List<RamBlockCandidate> candidates,
            HashSet<long> seen,
            RamAutoDiscovery result,
            List<RamBlockCandidate> wideSeeds)
        {
            // This pass stays sequential: the header search below returns early
            // on the first candidate that matches a trusted screen, so which
            // candidate wins depends on region order. Only the per-region
            // allocation is removed - up to 32 MB per region, every region,
            // zeroed by the runtime before the read overwrites it. Reuse is safe
            // because every read below is bounded by bytesRead.
            byte[] buffer = new byte[0];
            byte[] seedBlock = new byte[0x188];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.Size < 0x114 || region.Size > 32L * 1024 * 1024) continue;
                int regionSize = (int)region.Size;
                if (buffer.Length < regionSize) buffer = new byte[regionSize];
                int bytesRead = Read(region.BaseAddress, buffer, regionSize);
                if (bytesRead < 0x114) continue;
                result.RegionsScanned++;
                result.BytesScanned += bytesRead;

                // The header signature is primarily useful for presentation
                // records allocated above the first 4 GB.  Keep that search,
                // but do not limit the synchronized structural search below
                // to high addresses: Frostbite can rebuild either record in a
                // low heap while the game process remains open.
                if (region.BaseAddress >= 0x100000000L)
                {
                    int alignment = (int)((8 - (region.BaseAddress & 7)) & 7);
                    for (int index = alignment; index <= bytesRead - 0x114; index += 8)
                    {
                        if (buffer[index] != 0xFF || !Matches(buffer, index, scoreboardHeader, -1, -1)) continue;
                        long address = region.BaseAddress + index;
                        if (seen.Contains(address)) continue;
                        RamBlockCandidate candidate = ReadBlockCandidate(buffer, index, address, screen);
                        if (candidate == null) continue;
                        candidate.Score += 1000;
                        seen.Add(address);
                        candidates.Add(candidate);
                        if (MatchesTrustedScreen(candidate, screen)) return;
                    }
                }

                // A same-process game change can leave the current legacy
                // presentation record without the normal header/self-pointer
                // signature.  The independently discovered wide record is a
                // safe internal seed: require every fast-changing core field
                // to agree before accepting a headerless legacy record.
                for (int seedIndex = 0; seedIndex < wideSeeds.Count; seedIndex++)
                {
                    RamBlockCandidate seed = wideSeeds[seedIndex];
                    if (Read(seed.Address, seedBlock, seedBlock.Length) < seedBlock.Length) continue;
                    RamBlockCandidate freshSeed = ReadWideBlockCandidate(seedBlock, 0, seed.Address, screen);
                    if (freshSeed == null) continue;
                    seed.Quarter = freshSeed.Quarter;
                    seed.Clock = freshSeed.Clock;
                    seed.PlayClock = freshSeed.PlayClock;
                    seed.HomeScore = freshSeed.HomeScore;
                    seed.AwayScore = freshSeed.AwayScore;
                    seed.Down = freshSeed.Down;
                    seed.Distance = freshSeed.Distance;

                    int structuralSeedOffset = 0xEC;
                    int structuralSeedValue = seed.Quarter;
                    if (seed.AwayScore > 0) { structuralSeedOffset = 0x100; structuralSeedValue = seed.AwayScore; }
                    else if (seed.HomeScore > 0) { structuralSeedOffset = 0xFC; structuralSeedValue = seed.HomeScore; }
                    int structuralSearch = structuralSeedOffset;
                    while (structuralSearch <= bytesRead - 4)
                    {
                        int hit = Array.IndexOf(buffer, (byte)structuralSeedValue, structuralSearch, bytesRead - structuralSearch);
                        if (hit < 0) break;
                        structuralSearch = hit + 1;
                        if (hit > bytesRead - 4) break;
                        if (buffer[hit + 1] != 0 || buffer[hit + 2] != 0 || buffer[hit + 3] != 0) continue;
                        int index = hit - structuralSeedOffset;
                        if (index < 0 || index > bytesRead - 0x114) continue;
                        long address = region.BaseAddress + index;
                        if ((address & 3) != 0 || seen.Contains(address)) continue;
                        if (BitConverter.ToInt32(buffer, index + 0xEC) != seed.Quarter) continue;
                        int clock = BitConverter.ToInt32(buffer, index + 0xF4);
                        int playClock = BitConverter.ToInt32(buffer, index + 0xF8);
                        int homeScore = BitConverter.ToInt32(buffer, index + 0xFC);
                        int awayScore = BitConverter.ToInt32(buffer, index + 0x100);
                        int down = BitConverter.ToInt32(buffer, index + 0x10C);
                        int distance = BitConverter.ToInt32(buffer, index + 0x110);
                        if (Math.Abs((long)clock - seed.Clock) > 2
                            || Math.Abs((long)playClock - seed.PlayClock) > 2
                            || homeScore != seed.HomeScore
                            || awayScore != seed.AwayScore
                            || down != seed.Down
                            || distance != seed.Distance) continue;
                        RamBlockCandidate candidate = ReadBlockCandidate(buffer, index, address, screen);
                        if (candidate == null) continue;
                        candidate.Score += 1200;
                        seen.Add(address);
                        candidates.Add(candidate);
                        return;
                    }
                }

                if (screen == null || screen.QuarterNumber <= 0 || (screen.AwayScore == 0 && screen.HomeScore == 0)) continue;
                int seedValue = screen.AwayScore != 0 ? screen.AwayScore : screen.HomeScore;
                int seedOffset = screen.AwayScore != 0 ? 0x100 : 0xFC;
                if (seedValue < 0 || seedValue > 255) continue;
                int search = seedOffset;
                while (search <= bytesRead - 4)
                {
                    int hit = Array.IndexOf(buffer, (byte)seedValue, search, bytesRead - search);
                    if (hit < 0) break;
                    search = hit + 1;
                    if (buffer[hit + 1] != 0 || buffer[hit + 2] != 0 || buffer[hit + 3] != 0) continue;
                    int index = hit - seedOffset;
                    if (index < 0 || index > bytesRead - 0x114) continue;
                    if (((region.BaseAddress + index) & 3) != 0) continue;
                    if (BitConverter.ToInt32(buffer, index + 0xEC) != screen.QuarterNumber) continue;
                    if (BitConverter.ToInt32(buffer, index + 0xFC) != screen.HomeScore) continue;
                    if (BitConverter.ToInt32(buffer, index + 0x100) != screen.AwayScore) continue;
                    long address = region.BaseAddress + index;
                    if (seen.Contains(address)) continue;
                    RamBlockCandidate candidate = ReadBlockCandidate(buffer, index, address, screen);
                    if (candidate == null) continue;
                    candidate.Score += 700;
                    seen.Add(address);
                    candidates.Add(candidate);
                    if (MatchesTrustedScreen(candidate, screen)) return;
                }
            }
        }

        private static bool MatchesTrustedScreen(RamBlockCandidate candidate, LiveScoreboard screen)
        {
            if (candidate == null || screen == null || screen.QuarterNumber <= 0) return false;
            return candidate.Quarter == screen.QuarterNumber
                && candidate.HomeScore == screen.HomeScore
                && candidate.AwayScore == screen.AwayScore
                && Math.Abs(candidate.Clock - screen.GameClockSeconds) <= 30;
        }

        private static RamBlockCandidate ReadBlockCandidate(byte[] buffer, int index, long address, LiveScoreboard screen)
        {
            int quarter = BitConverter.ToInt32(buffer, index + 0xEC);
            int clock = BitConverter.ToInt32(buffer, index + 0xF4);
            int playClock = BitConverter.ToInt32(buffer, index + 0xF8);
            int homeScore = BitConverter.ToInt32(buffer, index + 0xFC);
            int awayScore = BitConverter.ToInt32(buffer, index + 0x100);
            int possession = BitConverter.ToInt32(buffer, index + 0x108);
            int down = BitConverter.ToInt32(buffer, index + 0x10C);
            int distance = BitConverter.ToInt32(buffer, index + 0x110);
            if (quarter < 1 || quarter > 20 || clock < 0 || clock > 3600 || playClock < 0 || playClock > 99
                || homeScore < 0 || homeScore > 255 || awayScore < 0 || awayScore > 255
                || possession < 0 || possession > 1 || down < 0 || down > 4 || distance < 0 || distance > 99) return null;

            int score = 1;
            if (screen != null)
            {
                if (screen.QuarterNumber > 0) score += quarter == screen.QuarterNumber ? 200 : -100;
                int clockDifference = Math.Abs(clock - screen.GameClockSeconds);
                score += clockDifference <= 2 ? 160 : (clockDifference <= 10 ? 80 : (clockDifference <= 30 ? 20 : 0));
                int playDifference = Math.Abs(playClock - screen.PlayClock);
                score += playDifference <= 2 ? 30 : (playDifference <= 10 ? 10 : 0);
                if (homeScore == screen.HomeScore) score += 15;
                if (awayScore == screen.AwayScore) score += 15;
                if (screen.Down > 0 && down == screen.Down) score += 10;
                if (screen.Distance > 0 && distance == screen.Distance) score += 5;
            }
            return new RamBlockCandidate
            {
                Address = address,
                Score = score,
                Quarter = quarter,
                Clock = clock,
                PlayClock = playClock,
                HomeScore = homeScore,
                AwayScore = awayScore,
                Possession = possession,
                Down = down,
                Distance = distance
            };
        }

        private static RamBlockCandidate ReadWideBlockCandidate(byte[] buffer, int index, long address, LiveScoreboard screen)
        {
            int homeScore = BitConverter.ToInt32(buffer, index + 0x90);
            int awayScore = BitConverter.ToInt32(buffer, index + 0x98);
            // +0xA0 is a second copy of the down, not possession. Treating it
            // as away/home made the possession indicator follow 1st/2nd down
            // and also rejected live records on 3rd and 4th down.
            int duplicateDown = BitConverter.ToInt32(buffer, index + 0xA0);
            int quarter = BitConverter.ToInt32(buffer, index + 0xC8);
            int clock = BitConverter.ToInt32(buffer, index + 0x100);
            int distance = BitConverter.ToInt32(buffer, index + 0x148);
            int down = BitConverter.ToInt32(buffer, index + 0xB8);
            int playClock = BitConverter.ToInt32(buffer, index + 0x180);

            int[] slotOffsets = new int[] { 0x90, 0x98, 0xA0, 0xB0, 0xB8, 0xC0, 0xC8, 0x100, 0x148, 0x180 };
            for (int i = 0; i < slotOffsets.Length; i++)
                if (BitConverter.ToInt32(buffer, index + slotOffsets[i] + 4) != 0) return null;
            if (homeScore < 0 || homeScore > 255 || awayScore < 0 || awayScore > 255
                || BitConverter.ToInt32(buffer, index + 0xC0) != homeScore
                || BitConverter.ToInt32(buffer, index + 0xB0) != awayScore
                || !WideDuplicateDownMatches(duplicateDown, down) || quarter < 1 || quarter > 10
                // College quarters never start above 15:00. Rejecting larger
                // values keeps a dormant record from winning after a new game
                // is loaded in the same process.
                || clock < 0 || clock > 900 || playClock < 0 || playClock > 99
                // Before the first offensive state is created, Frostbite keeps
                // the live down slot at zero.  Accept that short startup state
                // so we can retain the correct record and observe the same slot
                // becoming 1..4 without waiting for another full RAM scan.
                || down < 0 || down > 4 || distance < 0 || distance > 99) return null;

            int score = 2000;
            // Dormant stat records reuse this schema. The active game record is
            // normally the only copy with a non-zero running clock, so live-
            // looking values rank it without relying on any screen input.
            if (clock >= 5) score += 1000;
            else if (clock > 0) score += 100;
            if (playClock >= 5) score += 100;
            if (homeScore > 0 || awayScore > 0) score += 100;
            if (distance > 0) score += 50;
            if (screen != null)
            {
                if (screen.QuarterNumber > 0) score += quarter == screen.QuarterNumber ? 200 : -100;
                int clockDifference = Math.Abs(clock - screen.GameClockSeconds);
                score += clockDifference <= 2 ? 160 : (clockDifference <= 10 ? 80 : (clockDifference <= 30 ? 20 : 0));
                if (homeScore == screen.HomeScore) score += 30;
                if (awayScore == screen.AwayScore) score += 30;
                if (screen.Down > 0 && down == screen.Down) score += 10;
                if (screen.Distance > 0 && distance == screen.Distance) score += 10;
            }
            return new RamBlockCandidate
            {
                Address = address,
                Score = score,
                Quarter = quarter,
                Clock = clock,
                PlayClock = playClock,
                HomeScore = homeScore,
                AwayScore = awayScore,
                Possession = -1,
                Down = down,
                Distance = distance,
                UsesWideLayout = true
            };
        }

        internal static bool WideDuplicateDownMatches(int duplicateDown, int down)
        {
            return down >= 0 && down <= 4 && duplicateDown == down;
        }

        private static bool Matches(byte[] buffer, int start, byte[] pattern, int wildcardStart, int wildcardLength)
        {
            if (start < 0 || start + pattern.Length > buffer.Length) return false;
            int wildcardEnd = wildcardStart < 0 ? -1 : wildcardStart + wildcardLength;
            for (int i = 0; i < pattern.Length; i++)
            {
                if (i >= wildcardStart && i < wildcardEnd) continue;
                if (buffer[start + i] != pattern[i]) return false;
            }
            return true;
        }

        internal static bool MatchesTimeoutContext(byte[] buffer, int start, byte[] pattern)
        {
            if (start < 0 || start + pattern.Length > buffer.Length) return false;
            for (int i = 0; i < pattern.Length; i++)
            {
                if (!TimeoutPatternByteIsDynamic(i)
                    && buffer[start + i] != pattern[i]) return false;
            }
            return true;
        }

        private static bool TimeoutPatternByteIsDynamic(int index)
        {
            return (index >= 0x04 && index <= 0x23)
                || (index >= 0x30 && index <= 0x31)
                || index == 0x38 || (index >= 0x3C && index <= 0x3E)
                || index == 0x41
                || (index >= 0x44 && index <= 0x63)
                || (index >= 0x6C && index <= 0x73)
                || (index >= 0x78 && index <= 0x7F);
        }

        private bool TryReadTimeoutConsensus(List<long> homeAddresses, List<long> awayAddresses,
            out int home, out int away)
        {
            home = 0;
            away = 0;
            if (homeAddresses == null || awayAddresses == null
                || homeAddresses.Count != 2 || awayAddresses.Count != 2) return false;
            try
            {
                int firstHome = ReadInt32(homeAddresses[0]);
                int firstAway = ReadInt32(awayAddresses[0]);
                int secondHome = ReadInt32(homeAddresses[1]);
                int secondAway = ReadInt32(awayAddresses[1]);
                if (!ExactTimeoutCounterConsensusIsSafe(
                        homeAddresses.Count, awayAddresses.Count,
                        firstHome, firstAway, secondHome, secondAway)) return false;
                home = firstHome;
                away = firstAway;
                return true;
            }
            catch { return false; }
        }

        internal static bool ExactTimeoutCounterConsensusIsSafe(
            int homeAddressCount, int awayAddressCount,
            int firstHome, int firstAway, int secondHome, int secondAway)
        {
            return homeAddressCount == 2 && awayAddressCount == 2
                && firstHome >= 0 && firstHome <= 3
                && firstAway >= 0 && firstAway <= 3
                && firstHome == secondHome && firstAway == secondAway;
        }

        internal static bool CatalogTimeoutCountersCorroborateClones(
            bool hasExactCloneConsensus,
            int catalogHome, int catalogAway, int cloneHome, int cloneAway)
        {
            return hasExactCloneConsensus
                && catalogHome >= 0 && catalogHome <= 3
                && catalogAway >= 0 && catalogAway <= 3
                && catalogHome == cloneHome && catalogAway == cloneAway;
        }

        // When the unreliable catalog word is allowed to discard a clone pair
        // that verified itself: only for the dormant-zero signature. A pair
        // without internal consensus is discarded as before - that is the
        // clones disagreeing with each other, not the catalog disagreeing
        // with the clones.
        internal static bool TimeoutCatalogVetoApplies(
            bool hasExactCloneConsensus, int cloneHome, int cloneAway,
            bool catalogCorroborates)
        {
            if (!hasExactCloneConsensus) return true;
            if (cloneHome != 0 || cloneAway != 0) return false;
            return !catalogCorroborates;
        }

        private void KeepOnlyClonedTimeoutContexts(
            List<MemoryHit> contexts, byte[] timeoutPattern)
        {
            if (contexts == null || contexts.Count == 0) return;
            const long cloneDelta = 0x2D0;
            Dictionary<long, MemoryHit> byAddress = new Dictionary<long, MemoryHit>();
            for (int index = 0; index < contexts.Count; index++)
                if (!byAddress.ContainsKey(contexts[index].Address))
                    byAddress.Add(contexts[index].Address, contexts[index]);

            List<MemoryHit> confirmed = new List<MemoryHit>();
            HashSet<long> added = new HashSet<long>();
            for (int index = 0; index < contexts.Count; index++)
            {
                MemoryHit first = contexts[index];
                MemoryHit second;
                if (!byAddress.TryGetValue(first.Address + cloneDelta, out second)) continue;
                try
                {
                    byte[] firstBytes = ReadBytes(first.Address, 0x80);
                    byte[] secondBytes = ReadBytes(second.Address, 0x80);
                    if (!TimeoutClonePairMatchesPatternAndStructure(
                            firstBytes, secondBytes, timeoutPattern)) continue;
                    int firstHome = BitConverter.ToInt32(firstBytes, 0x44);
                    int firstAway = BitConverter.ToInt32(firstBytes, 0x48);

                    // A complete second structural read protects against
                    // catching either clone during a presentation rebuild.
                    byte[] firstAgain = ReadBytes(first.Address, 0x80);
                    byte[] secondAgain = ReadBytes(second.Address, 0x80);
                    if (!TimeoutClonePairMatchesPatternAndStructure(
                            firstAgain, secondAgain, timeoutPattern)
                        || BitConverter.ToInt32(firstAgain, 0x44) != firstHome
                        || BitConverter.ToInt32(firstAgain, 0x48) != firstAway) continue;
                    if (added.Add(first.Address)) confirmed.Add(first);
                    if (added.Add(second.Address)) confirmed.Add(second);
                }
                catch { }
            }
            confirmed.Sort(delegate(MemoryHit left, MemoryHit right)
            {
                return left.Address.CompareTo(right.Address);
            });
            contexts.Clear();
            // A valid live presentation exposes one and only one cloned pair.
            // Multiple overlapping/retained pairs are ambiguous across matchup
            // epochs, so keep none rather than publishing a plausible value.
            if (confirmed.Count == 2
                && ExactTimeoutClonePairIsSafe(
                    confirmed.Count, confirmed[0].Address, confirmed[1].Address))
                contexts.AddRange(confirmed);
        }

        internal static bool ExactTimeoutClonePairIsSafe(
            int count, long firstAddress, long secondAddress)
        {
            return count == 2 && firstAddress > 0
                && secondAddress - firstAddress == 0x2D0;
        }

        internal static bool TimeoutCloneCopiesAreStructurallySafe(
            byte[] first, byte[] second)
        {
            if (first == null || second == null || first.Length < 0x80 || second.Length < 0x80)
                return false;
            for (int index = 0; index < 0x80; index++)
            {
                // The two presentation clones are written sequentially.  Live
                // captures proved that pattern-dynamic words (notably +0x3C)
                // can differ for a few milliseconds while the same update is
                // propagated to the second clone.  Each record is independently
                // checked against the static timeout signature by the caller;
                // only static bytes and the authoritative counters must agree.
                if (!TimeoutPatternByteIsDynamic(index)
                    && first[index] != second[index]) return false;
            }
            int firstHome = BitConverter.ToInt32(first, 0x44);
            int firstAway = BitConverter.ToInt32(first, 0x48);
            int secondHome = BitConverter.ToInt32(second, 0x44);
            int secondAway = BitConverter.ToInt32(second, 0x48);
            // +0x5C/+0x60 mirror the counters in some presentation modes but are
            // zeroed in others (including the live West Virginia/Pittsburgh
            // presentation).  They are not part of the portable timeout record.
            // Safety comes from the exact +0x2D0 clone pair, agreement on every
            // structural byte and both authoritative counters, the 0..3 bounds,
            // and the complete second read in KeepOnlyClonedTimeoutContexts.
            return firstHome == secondHome && firstAway == secondAway
                && firstHome >= 0 && firstHome <= 3
                && firstAway >= 0 && firstAway <= 3;
        }

        internal static bool TimeoutClonePairMatchesPatternAndStructure(
            byte[] first, byte[] second, byte[] pattern)
        {
            return first != null && second != null && pattern != null
                && MatchesTimeoutContext(first, 0, pattern)
                && MatchesTimeoutContext(second, 0, pattern)
                && TimeoutCloneCopiesAreStructurallySafe(first, second);
        }

        internal static bool TimeoutClonePairMatchesKnownPatternAndStructure(
            byte[] first, byte[] second)
        {
            return TimeoutClonePairMatchesPatternAndStructure(
                first, second, TimeoutContextPattern);
        }

        internal static bool TimeoutContextMatchesKnownPattern(byte[] value)
        {
            return value != null
                && MatchesTimeoutContext(value, 0, TimeoutContextPattern);
        }

        internal static int TimeoutContextSimilarity(byte[] buffer, int start, byte[] pattern)
        {
            if (start < 0 || start + pattern.Length > buffer.Length) return 0;
            int matched = 0;
            for (int i = 0; i < pattern.Length; i++)
            {
                if (!TimeoutPatternByteIsDynamic(i)
                    && buffer[start + i] == pattern[i]) matched++;
            }
            return matched;
        }

        private static void FindCatalogHits(byte[] buffer, int count, MemoryRegion region, byte[] pattern, List<MemoryHit> hits, HashSet<long> seen)
        {
            for (int index = 0; index <= count - pattern.Length; index++)
            {
                if (buffer[index] != pattern[0] || !Matches(buffer, index, pattern, -1, -1)) continue;
                long address = region.BaseAddress + index;
                if (seen.Add(address)) hits.Add(new MemoryHit(address, region));
            }
        }

        private static void FindHomeMarkerHits(byte[] buffer, int count, MemoryRegion region, byte[] marker, List<TeamMarkerHit> hits, HashSet<long> seen)
        {
            for (int index = 0; index <= count - marker.Length; index++)
            {
                if (buffer[index] != marker[0] || !Matches(buffer, index, marker, -1, -1)) continue;
                long address = region.BaseAddress + index;
                if (!seen.Add(address)) continue;
                TeamMarkerHit hit = new TeamMarkerHit(address, region);
                // The live display-name buffers can be several megabytes away
                // from the Team Home marker within the same Frostbite pool.
                // Collect the pool's standalone strings here; ChooseActiveTeams
                // later restricts them to the two active tradition slugs.
                int end = count;
                for (int textStart = 0; textStart < end; textStart++)
                {
                    if (textStart > 0 && buffer[textStart - 1] != 0) continue;
                    int textEnd = textStart;
                    while (textEnd < end && textEnd < textStart + 49 && buffer[textEnd] >= 32 && buffer[textEnd] <= 126) textEnd++;
                    int length = textEnd - textStart;
                    if (length < 2 || textEnd >= end || buffer[textEnd] != 0) continue;
                    string value = Encoding.ASCII.GetString(buffer, textStart, length).Trim();
                    if (!LooksLikeTeamName(value) || String.Equals(value, "Team Home", StringComparison.OrdinalIgnoreCase)) continue;
                    hit.Names.Add(new TextAddress(value, region.BaseAddress + textStart));
                    textStart = textEnd;
                }
                hits.Add(hit);
            }
        }

        private static void FindStandaloneMarkerHits(byte[] buffer, int count, MemoryRegion region,
            byte[] marker, List<MemoryHit> hits, HashSet<long> seen)
        {
            if (buffer == null || marker == null || marker.Length == 0) return;
            for (int index = 1; index <= count - marker.Length - 1; index++)
            {
                if (buffer[index - 1] != 0 || buffer[index + marker.Length] != 0
                    || buffer[index] != marker[0] || !Matches(buffer, index, marker, -1, -1)) continue;
                long address = region.BaseAddress + index;
                if (seen.Add(address)) hits.Add(new MemoryHit(address, region));
            }
        }

        private static void FindTraditionHits(byte[] buffer, int count, MemoryRegion region, byte[] prefix, List<TraditionHit> hits, HashSet<long> seen)
        {
            for (int index = 0; index <= count - prefix.Length; index++)
            {
                if (buffer[index] != prefix[0] || !Matches(buffer, index, prefix, -1, -1)) continue;
                int start = index + prefix.Length;
                int end = start;
                while (end < count && end < start + 64)
                {
                    byte value = buffer[end];
                    if (!((value >= (byte)'a' && value <= (byte)'z') || value == (byte)'_' || value == (byte)'-')) break;
                    end++;
                }
                if (end == start || end >= count || buffer[end] != (byte)'/') continue;
                long address = region.BaseAddress + index;
                if (seen.Add(address)) hits.Add(new TraditionHit(address, region, Encoding.ASCII.GetString(buffer, start, end - start)));
            }
        }

        private Dictionary<string, string> ReadCatalogNames(long address, int length)
        {
            Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (address == 0 || length <= 0) return result;
            byte[] bytes;
            try { bytes = ReadBytes(address, length); }
            catch { return result; }
            // FindCatalogHits anchors address at record zero (AIRFOR). Team
            // records are fixed 0xD8-byte entries; scanning unaligned bytes can
            // mistake padded injury/venue strings for team keys.
            for (int index = 0; index <= bytes.Length - 64; index += 0xD8)
            {
                if (index > 0 && bytes[index - 1] != 0) continue;
                int keyEnd = index;
                while (keyEnd < bytes.Length && keyEnd < index + 17 && bytes[keyEnd] != 0) keyEnd++;
                if (keyEnd == index || keyEnd >= bytes.Length || keyEnd >= index + 17) continue;
                string key = Encoding.ASCII.GetString(bytes, index, keyEnd - index);
                if (!LooksLikeTeamKey(key)) continue;
                bool padded = true;
                for (int i = keyEnd; i < index + 32; i++) if (bytes[i] != 0) { padded = false; break; }
                if (!padded) continue;
                int nameStart = index + 32;
                int nameEnd = nameStart;
                while (nameEnd < bytes.Length && nameEnd < nameStart + 32 && bytes[nameEnd] != 0) nameEnd++;
                if (nameEnd == nameStart || nameEnd >= bytes.Length || nameEnd >= nameStart + 32) continue;
                string name = Encoding.ASCII.GetString(bytes, nameStart, nameEnd - nameStart);
                if (LooksLikeTeamName(name)) result[NormalizeSlug(name)] = name;
            }
            return result;
        }

        private void ChooseVerifiedRoleTeams(RamAutoDiscovery result, List<TeamMarkerHit> homeMarkers,
            List<MemoryHit> awayMarkers, List<TraditionHit> traditions,
            Dictionary<string, string> catalogNames, List<MemoryRegion> regions)
        {
            result.TeamRoleDiagnostics.Add("labels home=" + (homeMarkers == null ? 0 : homeMarkers.Count)
                + " away=" + (awayMarkers == null ? 0 : awayMarkers.Count));
            LabeledVectorRoleResolution labeledResolution = TryChooseLabeledVectorRoleTeams(
                result, homeMarkers, awayMarkers, traditions, catalogNames, regions);
            if (labeledResolution == LabeledVectorRoleResolution.Unique) return;
            if (labeledResolution == LabeledVectorRoleResolution.IncompleteOrAmbiguous)
            {
                // The labelled route could not decide - in Play Now the
                // tradition slugs it needs are simply absent. Rather than
                // publish nothing, fall back to the older pool analysis and
                // mark the result so the exporter knows these names came from
                // raw text addresses and must be confirmed before use.
                //
                // This path used to return empty-handed, which is why builds
                // with the labelled-vector rework stopped reading names that
                // older builds read every time.
                result.TeamRoleEvidenceAmbiguous = true;
                ChooseActiveTeams(result, homeMarkers, traditions, catalogNames);
                bool recovered = !String.IsNullOrWhiteSpace(result.AwayTeamName)
                    && !String.IsNullOrWhiteSpace(result.HomeTeamName)
                    && !String.Equals(result.AwayTeamName, result.HomeTeamName,
                        StringComparison.OrdinalIgnoreCase);
                result.TeamNamesFromFallback = recovered;
                result.TeamRoleDiagnostics.Add(recovered
                    ? "labeled-vector ambiguous; recovered names from pool fallback"
                    : "labeled-vector ambiguous; pool fallback found no usable pair");
                if (!recovered)
                {
                    result.HomeTeamName = null;
                    result.AwayTeamName = null;
                    result.HomeTeamNameAddresses.Clear();
                    result.AwayTeamNameAddresses.Clear();
                }
                return;
            }

            // No labeled-vector evidence was present. This is the common case,
            // not an edge case: in Play Now the role vectors carry no references
            // to the markers (refs=0) and there are no tradition slugs to map
            // them with, so the labeled route has nothing to work from.
            //
            // The old pool analysis still runs and still gets the right answer.
            // Proven on a live Pitt v USC game: the 08-11 01:50 reader, which
            // used this finder, reported away='Usc' home='Pittsburgh', while the
            // 08-11 03:47 reader that added the labeled-vector rework reported
            // nothing at all on the very same game. The names were never missing
            // from memory - they were computed here and then deleted below.
            //
            // Deleting them was a deliberate trade for safety: raw text
            // addresses could rebind to the wrong teams across a same-process
            // game load, which is the hanging-teams bug. But withholding is only
            // the right default when there is something better to wait for, and
            // here there is not - so keep the answer and mark it as needing the
            // extra confirmation instead.
            //
            // TeamNamesFromFallback makes the exporter run this pair through
            // AdvanceMatchupConfirmation: the same ordered pair, with matching
            // address signatures, observed twice before anything is published,
            // and dropped the moment the matchup changes. That is the protection
            // the original fallback lacked and the reason it was switched off.
            ChooseActiveTeams(result, homeMarkers, traditions, catalogNames);
            bool recoveredWithoutLabels = !String.IsNullOrWhiteSpace(result.AwayTeamName)
                && !String.IsNullOrWhiteSpace(result.HomeTeamName)
                && !String.Equals(result.AwayTeamName, result.HomeTeamName,
                    StringComparison.OrdinalIgnoreCase);
            result.TeamNamesFromFallback = recoveredWithoutLabels;
            result.TeamRoleDiagnostics.Add(recoveredWithoutLabels
                ? "no labeled-vector evidence; recovered names from pool fallback"
                : "no authoritative labeled-vector role binding");
            if (!recoveredWithoutLabels)
            {
                result.HomeTeamName = null;
                result.AwayTeamName = null;
                result.HomeTeamMarkerAddress = 0;
                result.HomeTeamNameAddresses.Clear();
                result.AwayTeamNameAddresses.Clear();
                result.AwayTeamAssetPoolBase = 0;
                result.AwayTeamAssetPoolLength = 0;
            }
        }

        private LabeledVectorRoleResolution TryChooseLabeledVectorRoleTeams(RamAutoDiscovery result,
            List<TeamMarkerHit> homeMarkers, List<MemoryHit> awayMarkers,
            List<TraditionHit> traditions, Dictionary<string, string> catalogNames,
            List<MemoryRegion> regions)
        {
            if (result == null || homeMarkers == null || awayMarkers == null
                || traditions == null || catalogNames == null || catalogNames.Count == 0
                || regions == null) return LabeledVectorRoleResolution.None;

            byte[] homeLabel = Encoding.ASCII.GetBytes("Team Home");
            byte[] awayLabel = Encoding.ASCII.GetBytes("Team Away");
            LabeledVectorRolePair selected = null;
            HashSet<string> selectedKeys = new HashSet<string>(StringComparer.Ordinal);
            Dictionary<long, List<LabeledVectorRoleReference>> referenceCache =
                new Dictionary<long, List<LabeledVectorRoleReference>>();
            int validatedHomeReferenceCount = 0;
            int validatedAwayReferenceCount = 0;
            int uniquePairCount = 0;

            // Resolve every away label up front. A one-sided or multiply
            // referenced vector is authoritative evidence of an incomplete or
            // rebuilding current role structure and must block weaker fallbacks.
            for (int awayIndex = 0; awayIndex < awayMarkers.Count; awayIndex++)
            {
                MemoryHit away = awayMarkers[awayIndex];
                if (!ExactStandaloneAsciiMatches(away.Address, awayLabel,
                    away.AllocationBase, regions)) continue;
                List<LabeledVectorRoleReference> awayReferences =
                    FindValidatedLabeledVectorReferences(
                        away.Address, away.AllocationBase, catalogNames, regions);
                referenceCache[away.Address] = awayReferences;
                validatedAwayReferenceCount += awayReferences.Count;
                result.TeamRoleDiagnostics.Add("away " + FormatAddress(away.Address)
                    + " refs=" + awayReferences.Count);
            }

            for (int homeIndex = 0; homeIndex < homeMarkers.Count; homeIndex++)
            {
                TeamMarkerHit home = homeMarkers[homeIndex];
                if (!ExactStandaloneAsciiMatches(home.Address, homeLabel, home.AllocationBase, regions)) continue;
                List<LabeledVectorRoleReference> homeReferences;
                if (!referenceCache.TryGetValue(home.Address, out homeReferences))
                {
                    homeReferences = FindValidatedLabeledVectorReferences(
                        home.Address, home.AllocationBase, catalogNames, regions);
                    referenceCache[home.Address] = homeReferences;
                }
                result.TeamRoleDiagnostics.Add("home " + FormatAddress(home.Address)
                    + " refs=" + homeReferences.Count);
                validatedHomeReferenceCount += homeReferences.Count;
                if (homeReferences.Count != 1) continue;

                HashSet<string> allocationTraditions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int traditionIndex = 0; traditionIndex < traditions.Count; traditionIndex++)
                    if (traditions[traditionIndex].AllocationBase == home.AllocationBase)
                        allocationTraditions.Add(NormalizeSlug(traditions[traditionIndex].Slug));

                for (int awayIndex = 0; awayIndex < awayMarkers.Count; awayIndex++)
                {
                    MemoryHit away = awayMarkers[awayIndex];
                    if (away.AllocationBase != home.AllocationBase
                        || !ExactStandaloneAsciiMatches(away.Address, awayLabel, home.AllocationBase, regions)) continue;
                    List<LabeledVectorRoleReference> awayReferences;
                    if (!referenceCache.TryGetValue(away.Address, out awayReferences))
                    {
                        awayReferences = FindValidatedLabeledVectorReferences(
                            away.Address, home.AllocationBase, catalogNames, regions);
                        referenceCache[away.Address] = awayReferences;
                        validatedAwayReferenceCount += awayReferences.Count;
                        result.TeamRoleDiagnostics.Add("away " + FormatAddress(away.Address)
                            + " refs=" + awayReferences.Count);
                    }
                    if (awayReferences.Count != 1) continue;

                    LabeledVectorRoleReference homeReference = homeReferences[0];
                    LabeledVectorRoleReference awayReference = awayReferences[0];
                    if (homeReference.Allocator == 0
                        || homeReference.Allocator != awayReference.Allocator
                        || homeReference.ReferenceAddress == awayReference.ReferenceAddress
                        || homeReference.DescriptorAddress == awayReference.DescriptorAddress
                        || homeReference.VectorBegin == awayReference.VectorBegin) continue;

                    string canonicalHome;
                    string canonicalAway;
                    if (!TryResolveRoleTeamCanonical(homeReference.TeamName,
                            allocationTraditions, catalogNames, out canonicalHome)
                        || !TryResolveRoleTeamCanonical(awayReference.TeamName,
                            allocationTraditions, catalogNames, out canonicalAway)
                        || String.Equals(canonicalHome, canonicalAway,
                            StringComparison.OrdinalIgnoreCase)) continue;
                    homeReference.TeamName = canonicalHome;
                    awayReference.TeamName = canonicalAway;

                    string key = awayReference.ReferenceAddress.ToString("X16", CultureInfo.InvariantCulture)
                        + ":" + homeReference.ReferenceAddress.ToString("X16", CultureInfo.InvariantCulture);
                    if (!selectedKeys.Add(key)) continue;
                    uniquePairCount++;
                    if (selected == null) selected = new LabeledVectorRolePair
                    {
                        AllocationBase = home.AllocationBase,
                        HomeLabelAddress = home.Address,
                        Away = awayReference,
                        Home = homeReference
                    };
                }
            }

            if (!LabeledVectorEvidenceIsUnique(
                    validatedHomeReferenceCount, validatedAwayReferenceCount, uniquePairCount))
                return LabeledVectorEvidenceBlocksLegacyFallback(
                    validatedHomeReferenceCount, validatedAwayReferenceCount)
                    ? LabeledVectorRoleResolution.IncompleteOrAmbiguous
                    : LabeledVectorRoleResolution.None;
            if (selected == null) return LabeledVectorRoleResolution.IncompleteOrAmbiguous;
            result.TeamRoleDiagnostics.Add("authoritative labeled-vector pair");
            result.AwayTeamName = selected.Away.TeamName;
            result.HomeTeamName = selected.Home.TeamName;
            result.HomeTeamMarkerAddress = selected.HomeLabelAddress;
            result.TeamRoleAllocationBase = selected.AllocationBase;
            result.AwayTeamRoleLabelAddress = selected.Away.LabelAddress;
            result.HomeTeamRoleLabelAddress = selected.Home.LabelAddress;
            result.AwayTeamRoleReferenceAddress = selected.Away.ReferenceAddress;
            result.HomeTeamRoleReferenceAddress = selected.Home.ReferenceAddress;
            result.AwayTeamRoleDescriptorAddress = selected.Away.DescriptorAddress;
            result.HomeTeamRoleDescriptorAddress = selected.Home.DescriptorAddress;
            result.AwayTeamRoleVectorAddress = selected.Away.VectorBegin;
            result.HomeTeamRoleVectorAddress = selected.Home.VectorBegin;
            result.AwayTeamNameAddresses.Clear();
            result.HomeTeamNameAddresses.Clear();
            result.AwayTeamNameAddresses.Add(selected.Away.TeamNameAddress);
            result.HomeTeamNameAddresses.Add(selected.Home.TeamNameAddress);
            result.AwayTeamAssetPoolBase = 0;
            result.AwayTeamAssetPoolLength = 0;
            for (int traditionIndex = 0; traditionIndex < traditions.Count; traditionIndex++)
            {
                TraditionHit tradition = traditions[traditionIndex];
                if (tradition.AllocationBase != selected.AllocationBase
                    || result.ActiveTraditionSlugs.Contains(tradition.Slug)) continue;
                result.ActiveTraditionSlugs.Add(tradition.Slug);
            }
            result.TeamNameCandidateCounts[selected.Away.TeamName] = 1;
            result.TeamNameCandidateCounts[selected.Home.TeamName] = 1;
            return LabeledVectorRoleResolution.Unique;
        }

        internal static bool LabeledVectorEvidenceBlocksLegacyFallback(
            int validatedHomeReferences, int validatedAwayReferences)
        {
            return validatedHomeReferences > 0 || validatedAwayReferences > 0;
        }

        internal static bool LabeledVectorEvidenceIsUnique(
            int validatedHomeReferences, int validatedAwayReferences, int uniquePairs)
        {
            return validatedHomeReferences == 1 && validatedAwayReferences == 1 && uniquePairs == 1;
        }

        private List<LabeledVectorRoleReference> FindValidatedLabeledVectorReferences(
            long labelAddress, long allocationBase, Dictionary<string, string> catalogNames,
            List<MemoryRegion> regions)
        {
            List<LabeledVectorRoleReference> result = new List<LabeledVectorRoleReference>();
            HashSet<long> seen = new HashSet<long>();
            byte[] buffer = new byte[ChunkSize + 8];
            for (int regionIndex = 0; regionIndex < regions.Count; regionIndex++)
            {
                MemoryRegion region = regions[regionIndex];
                if (region.AllocationBase != allocationBase || region.Size < 16) continue;
                long offset = 0;
                while (offset < region.Size)
                {
                    int requested = (int)Math.Min(buffer.Length, region.Size - offset);
                    long chunkAddress = region.BaseAddress + offset;
                    int bytesRead = Read(chunkAddress, buffer, requested);
                    if (bytesRead < 16) break;
                    int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                    for (int byteIndex = alignment; byteIndex <= bytesRead - 16; byteIndex += 8)
                    {
                        if (BitConverter.ToInt64(buffer, byteIndex) != labelAddress) continue;
                        long referenceAddress = chunkAddress + byteIndex;
                        if (!seen.Add(referenceAddress)) continue;
                        LabeledVectorRoleReference reference;
                        if (TryReadStableLabeledVectorReference(referenceAddress, labelAddress,
                            allocationBase, catalogNames, regions, out reference)) result.Add(reference);
                    }
                    if (requested <= 16) break;
                    offset += requested - 8;
                }
            }
            result.Sort(delegate(LabeledVectorRoleReference left, LabeledVectorRoleReference right)
            {
                return left.ReferenceAddress.CompareTo(right.ReferenceAddress);
            });
            return result;
        }

        private bool TryReadStableLabeledVectorReference(long referenceAddress, long labelAddress,
            long allocationBase, Dictionary<string, string> catalogNames,
            List<MemoryRegion> regions, out LabeledVectorRoleReference result)
        {
            result = null;
            LabeledVectorRoleReference first;
            LabeledVectorRoleReference second;
            if (!TryReadLabeledVectorReference(referenceAddress, labelAddress, allocationBase,
                catalogNames, regions, out first)
                || !TryReadLabeledVectorReference(referenceAddress, labelAddress, allocationBase,
                    catalogNames, regions, out second)
                || !LabeledVectorReferenceMatches(first, second)) return false;
            result = second;
            return true;
        }

        private bool TryReadLabeledVectorReference(long referenceAddress, long labelAddress,
            long allocationBase, Dictionary<string, string> catalogNames,
            List<MemoryRegion> regions, out LabeledVectorRoleReference result)
        {
            result = null;
            if (!AddressRangeIsInAllocation(referenceAddress, 16, allocationBase, regions)) return false;
            byte[] referenceBytes = new byte[16];
            if (Read(referenceAddress, referenceBytes, referenceBytes.Length) != referenceBytes.Length
                || BitConverter.ToInt64(referenceBytes, 0) != labelAddress) return false;
            long descriptorAddress = BitConverter.ToInt64(referenceBytes, 8);
            if (!AddressRangeIsInAllocation(descriptorAddress, 0x38, allocationBase, regions)) return false;
            byte[] descriptor = new byte[0x38];
            if (Read(descriptorAddress, descriptor, descriptor.Length) != descriptor.Length) return false;
            long begin = BitConverter.ToInt64(descriptor, 0x00);
            long end = BitConverter.ToInt64(descriptor, 0x08);
            long capacity = BitConverter.ToInt64(descriptor, 0x10);
            long allocator = BitConverter.ToInt64(descriptor, 0x18);
            long current = BitConverter.ToInt64(descriptor, 0x20);
            long anchor = BitConverter.ToInt64(descriptor, 0x28);
            long count = BitConverter.ToInt64(descriptor, 0x30);
            if (!LabeledVectorDescriptorShapeIsValid(
                    begin, end, capacity, allocator, current, anchor, count)
                || !AddressRangeIsInAllocation(begin, 0x10, allocationBase, regions)) return false;
            byte[] vector = new byte[0x10];
            if (Read(begin, vector, vector.Length) != vector.Length) return false;
            int teamSlotOffset = (int)(current - begin);
            int placeholderSlotOffset = (int)(anchor - begin);
            long teamNameAddress = BitConverter.ToInt64(vector, teamSlotOffset);
            long placeholderAddress = BitConverter.ToInt64(vector, placeholderSlotOffset);
            string placeholder;
            string teamText;
            if (!TryReadExactStandaloneAscii(placeholderAddress, allocationBase, regions, 16, out placeholder)
                || !String.Equals(placeholder, "N/A", StringComparison.Ordinal)
                || !TryReadExactStandaloneAscii(teamNameAddress, allocationBase, regions, 64, out teamText))
                return false;
            string canonicalTeam;
            if (!LooksLikeTeamName(teamText)) return false;
            if (catalogNames.TryGetValue(NormalizeSlug(teamText), out canonicalTeam))
            {
                if (!String.Equals(teamText, canonicalTeam, StringComparison.OrdinalIgnoreCase)) return false;
            }
            else
            {
                // Some playable teams use the alternate Frostbite catalog
                // record shape and are absent from the compact key/name map.
                // The ordered pair is still accepted only when this exact
                // standalone name has a same-allocation tradition slug.
                canonicalTeam = teamText;
            }
            result = new LabeledVectorRoleReference
            {
                LabelAddress = labelAddress,
                ReferenceAddress = referenceAddress,
                DescriptorAddress = descriptorAddress,
                VectorBegin = begin,
                Allocator = allocator,
                PlaceholderAddress = placeholderAddress,
                TeamNameAddress = teamNameAddress,
                TeamName = canonicalTeam
            };
            return true;
        }

        private bool ExactStandaloneAsciiMatches(long address, byte[] expected, long allocationBase,
            List<MemoryRegion> regions)
        {
            if (expected == null || expected.Length == 0) return false;
            string value;
            if (!TryReadExactStandaloneAscii(address, allocationBase, regions,
                expected.Length + 1, out value)) return false;
            return String.Equals(value, Encoding.ASCII.GetString(expected), StringComparison.Ordinal);
        }

        private bool TryReadExactStandaloneAscii(long address, long allocationBase,
            List<MemoryRegion> regions, int maximumLength, out string value)
        {
            value = null;
            if (address <= 0 || maximumLength <= 0
                || !AddressRangeIsInAllocation(address - 1, 1, allocationBase, regions)
                || !AddressRangeIsInAllocation(address, maximumLength + 1, allocationBase, regions)) return false;
            byte[] prefix = new byte[1];
            byte[] bytes = new byte[maximumLength + 1];
            if (Read(address - 1, prefix, 1) != 1 || prefix[0] != 0
                || Read(address, bytes, bytes.Length) != bytes.Length) return false;
            int end = 0;
            while (end < maximumLength && bytes[end] != 0) end++;
            if (end == 0 || end >= maximumLength || bytes[end] != 0) return false;
            for (int index = 0; index < end; index++)
                if (bytes[index] < 32 || bytes[index] > 126) return false;
            value = Encoding.ASCII.GetString(bytes, 0, end);
            return true;
        }

        private bool AddressRangeIsInAllocation(long address, int length, long allocationBase,
            List<MemoryRegion> regions)
        {
            if (address <= 0 || length <= 0) return false;
            if (regions == null)
            {
                NativeMethods.MemoryBasicInformation info;
                int structureSize = Marshal.SizeOf(typeof(NativeMethods.MemoryBasicInformation));
                int returned = NativeMethods.VirtualQueryEx(processHandle, new IntPtr(address),
                    out info, new IntPtr(structureSize));
                if (returned == 0 || info.State != MemCommit || info.Type != MemPrivate
                    || (info.Protect & PageGuard) != 0 || (info.Protect & PageNoAccess) != 0
                    || info.AllocationBase.ToInt64() != allocationBase) return false;
                long baseAddress = info.BaseAddress.ToInt64();
                long size = unchecked((long)info.RegionSize.ToUInt64());
                if (size < length || address < baseAddress) return false;
                long relative = address - baseAddress;
                return relative >= 0 && relative <= size - length;
            }
            for (int index = 0; index < regions.Count; index++)
            {
                MemoryRegion region = regions[index];
                if (region.AllocationBase != allocationBase || region.Size < length
                    || address < region.BaseAddress) continue;
                long relative = address - region.BaseAddress;
                if (relative >= 0 && relative <= region.Size - length) return true;
            }
            return false;
        }

        private static bool LabeledVectorReferenceMatches(
            LabeledVectorRoleReference first, LabeledVectorRoleReference second)
        {
            return first != null && second != null
                && first.LabelAddress == second.LabelAddress
                && first.ReferenceAddress == second.ReferenceAddress
                && first.DescriptorAddress == second.DescriptorAddress
                && first.VectorBegin == second.VectorBegin
                && first.Allocator == second.Allocator
                && first.PlaceholderAddress == second.PlaceholderAddress
                && first.TeamNameAddress == second.TeamNameAddress
                && String.Equals(first.TeamName, second.TeamName, StringComparison.Ordinal);
        }

        internal static bool LabeledVectorDescriptorShapeIsValid(long begin, long end,
            long capacity, long allocator, long current, long anchor, long count)
        {
            return begin > 0 && begin <= Int64.MaxValue - 0x10
                && end == begin + 0x10 && capacity == end
                && allocator != 0 && count == 1
                && ((current == begin && anchor == begin + 8)
                    || (current == begin + 8 && anchor == begin));
        }

        private static void ChooseActiveTeams(RamAutoDiscovery result, List<TeamMarkerHit> markers, List<TraditionHit> traditions, Dictionary<string, string> catalogNames)
        {
            TeamMarkerHit bestMarker = null;
            string bestHomeName = null;
            List<long> bestAddresses = null;
            int bestCount = -1;
            for (int markerIndex = 0; markerIndex < markers.Count; markerIndex++)
            {
                TeamMarkerHit marker = markers[markerIndex];
                HashSet<string> markerSlugs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int traditionIndex = 0; traditionIndex < traditions.Count; traditionIndex++)
                    if (traditions[traditionIndex].RegionBase == marker.RegionBase)
                        markerSlugs.Add(traditions[traditionIndex].Slug);
                Dictionary<string, List<long>> grouped = new Dictionary<string, List<long>>(StringComparer.OrdinalIgnoreCase);
                for (int nameIndex = 0; nameIndex < marker.Names.Count; nameIndex++)
                {
                    TextAddress item = marker.Names[nameIndex];
                    string slug = NormalizeSlug(item.Value);
                    string catalogName;
                    bool activeSlug = markerSlugs.Contains(slug);
                    if (markerSlugs.Count > 0 && !activeSlug) continue;
                    if (!catalogNames.TryGetValue(slug, out catalogName))
                    {
                        if (!activeSlug && catalogNames.Count > 0) continue;
                        catalogName = item.Value;
                    }
                    List<long> addresses;
                    if (!grouped.TryGetValue(catalogName, out addresses)) grouped[catalogName] = addresses = new List<long>();
                    addresses.Add(item.Address);
                }
                foreach (KeyValuePair<string, List<long>> pair in grouped)
                {
                    if (pair.Value.Count > bestCount)
                    {
                        bestMarker = marker;
                        bestHomeName = pair.Key;
                        bestAddresses = pair.Value;
                        bestCount = pair.Value.Count;
                    }
                }
            }
            if (bestMarker == null || String.IsNullOrWhiteSpace(bestHomeName)) return;

            result.HomeTeamName = bestHomeName;
            result.HomeTeamMarkerAddress = bestMarker.Address;
            result.HomeTeamNameAddresses.AddRange(bestAddresses);
            HashSet<string> slugs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long firstTraditionAddress = 0;
            for (int i = 0; i < traditions.Count; i++)
            {
                TraditionHit hit = traditions[i];
                if (hit.RegionBase != bestMarker.RegionBase) continue;
                slugs.Add(hit.Slug);
                if (firstTraditionAddress == 0 || hit.Address < firstTraditionAddress) firstTraditionAddress = hit.Address;
            }
            slugs.Remove(NormalizeSlug(bestHomeName));
            if (slugs.Count == 1)
            {
                string awaySlug = null;
                foreach (string value in slugs) awaySlug = value;
                string awayName;
                result.AwayTeamName = catalogNames.TryGetValue(awaySlug, out awayName) ? awayName : TitleFromSlug(awaySlug);
                for (int i = 0; i < bestMarker.Names.Count; i++)
                    if (String.Equals(NormalizeSlug(bestMarker.Names[i].Value), awaySlug, StringComparison.OrdinalIgnoreCase))
                        result.AwayTeamNameAddresses.Add(bestMarker.Names[i].Address);
            }
            if (firstTraditionAddress != 0)
            {
                long poolBase = firstTraditionAddress & ~0x1FFFFFL;
                if (poolBase < bestMarker.RegionBase) poolBase = bestMarker.RegionBase;
                long regionEnd = bestMarker.RegionBase + bestMarker.RegionSize;
                long available = regionEnd - poolBase;
                result.AwayTeamAssetPoolBase = poolBase;
                result.AwayTeamAssetPoolLength = (int)Math.Min(2L * 1024 * 1024, available);
            }

            HashSet<string> allSlugs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < traditions.Count; i++)
                if (traditions[i].RegionBase == bestMarker.RegionBase)
                    allSlugs.Add(traditions[i].Slug);
            foreach (string slug in allSlugs) result.ActiveTraditionSlugs.Add(slug);
            for (int i = 0; i < bestMarker.Names.Count; i++)
            {
                string slug = NormalizeSlug(bestMarker.Names[i].Value);
                if (allSlugs.Count > 0 && !allSlugs.Contains(slug)) continue;
                string candidateName;
                if (!catalogNames.TryGetValue(slug, out candidateName)) candidateName = bestMarker.Names[i].Value;
                int count;
                result.TeamNameCandidateCounts.TryGetValue(candidateName, out count);
                result.TeamNameCandidateCounts[candidateName] = count + 1;
            }
            if (String.IsNullOrWhiteSpace(result.AwayTeamName))
            {
                string bestAway = null;
                int bestAwayCount = -1;
                foreach (KeyValuePair<string, int> pair in result.TeamNameCandidateCounts)
                {
                    if (String.Equals(pair.Key, result.HomeTeamName, StringComparison.OrdinalIgnoreCase)) continue;
                    if (pair.Value > bestAwayCount)
                    {
                        bestAway = pair.Key;
                        bestAwayCount = pair.Value;
                    }
                }
                if (!String.IsNullOrWhiteSpace(bestAway))
                {
                    result.AwayTeamName = bestAway;
                    string awaySlug = NormalizeSlug(bestAway);
                    for (int i = 0; i < bestMarker.Names.Count; i++)
                        if (String.Equals(NormalizeSlug(bestMarker.Names[i].Value), awaySlug, StringComparison.OrdinalIgnoreCase))
                            result.AwayTeamNameAddresses.Add(bestMarker.Names[i].Address);
                }
            }
        }

        private bool ChooseExplicitRoleTeams(RamAutoDiscovery result, List<TeamMarkerHit> homeMarkers,
            Dictionary<string, string> catalogNames)
        {
            byte[] awayMarker = Encoding.ASCII.GetBytes("Team Away");
            byte[] homeMarker = Encoding.ASCII.GetBytes("Team Home");
            // Current builds also expose a compact live role record:
            //   +0x00 "Team Home", +0x20 opposing/away name,
            //   +0x30 "Team Away".
            // The home display buffers remain in the selected marker pool.
            // This record is authoritative and avoids guessing from the
            // traditions pool, which deliberately retains previous matchups.
            if (!String.IsNullOrWhiteSpace(result.HomeTeamName)
                && result.HomeTeamNameAddresses.Count > 0)
            {
                for (int markerIndex = 0; markerIndex < homeMarkers.Count; markerIndex++)
                {
                    TeamMarkerHit marker = homeMarkers[markerIndex];
                    if (marker.Address != result.HomeTeamMarkerAddress) continue;
                    byte[] compact;
                    try { compact = ReadBytes(marker.Address, 0x39); }
                    catch { continue; }
                    if (!Matches(compact, 0, homeMarker, -1, -1)
                        || !Matches(compact, 0x30, awayMarker, -1, -1)) continue;
                    string away = ReadFixedAscii(compact, 0x20, 16);
                    if (!LooksLikeTeamName(away)
                        || String.Equals(away, result.HomeTeamName, StringComparison.OrdinalIgnoreCase)) continue;
                    string catalogAway;
                    // The same 16-byte slot can hold a pointer in indirect
                    // layouts. Only a canonical catalog match proves that its
                    // bytes are an inline team name rather than printable
                    // pointer noise under a different ASLR address.
                    if (!catalogNames.TryGetValue(NormalizeSlug(away), out catalogAway)
                        || String.Equals(catalogAway, result.HomeTeamName, StringComparison.OrdinalIgnoreCase)) continue;
                    away = catalogAway;
                    result.AwayTeamName = away;
                    result.HomeTeamMarkerAddress = marker.Address;
                    result.AwayTeamNameAddresses.Clear();
                    result.AwayTeamNameAddresses.Add(marker.Address + 0x20);
                    return true;
                }
            }
            // Longer/indirect role layouts expose the two names through a
            // guarded paired-name record instead of inline at marker +0x20.
            if (TryChoosePairedRoleTeams(result, homeMarkers, catalogNames)) return true;
            for (int markerIndex = 0; markerIndex < homeMarkers.Count; markerIndex++)
            {
                if (homeMarkers[markerIndex].Address != result.HomeTeamMarkerAddress) continue;
                long blockAddress = homeMarkers[markerIndex].Address - 0x170;
                if (blockAddress <= 0) continue;
                byte[] bytes;
                try { bytes = ReadBytes(blockAddress, 0x179); }
                catch { continue; }
                if (!Matches(bytes, 0, awayMarker, -1, -1)
                    || !Matches(bytes, 0x170, homeMarker, -1, -1)) continue;
                string awayFirst = ReadFixedAscii(bytes, 0x10, 32);
                string awaySecond = ReadFixedAscii(bytes, 0x30, 32);
                string home = ReadFixedAscii(bytes, 0x100, 32);
                if (!LooksLikeTeamName(awayFirst) || !LooksLikeTeamName(home)
                    || !String.Equals(awayFirst, awaySecond, StringComparison.OrdinalIgnoreCase)
                    || String.Equals(awayFirst, home, StringComparison.OrdinalIgnoreCase)) continue;
                string catalogAway;
                string catalogHome;
                if (catalogNames.TryGetValue(NormalizeSlug(awayFirst), out catalogAway)) awayFirst = catalogAway;
                if (catalogNames.TryGetValue(NormalizeSlug(home), out catalogHome)) home = catalogHome;
                // These presentation labels describe the opposing slot that
                // follows them, so the strings are physically stored opposite
                // the score-side roles. Keep score ownership unchanged and
                // map only the two team-name buffers to their actual sides.
                result.AwayTeamName = home;
                result.HomeTeamName = awayFirst;
                result.HomeTeamMarkerAddress = homeMarkers[markerIndex].Address;
                result.AwayTeamNameAddresses.Clear();
                result.HomeTeamNameAddresses.Clear();
                result.AwayTeamNameAddresses.Add(blockAddress + 0x100);
                result.HomeTeamNameAddresses.Add(blockAddress + 0x10);
                result.HomeTeamNameAddresses.Add(blockAddress + 0x30);
                return true;
            }
            return false;
        }

        private bool TryChoosePairedRoleTeams(RamAutoDiscovery result, List<TeamMarkerHit> homeMarkers,
            Dictionary<string, string> catalogNames)
        {
            if (result == null || result.HomeTeamMarkerAddress == 0
                || homeMarkers == null || catalogNames == null || catalogNames.Count == 0) return false;
            TeamMarkerHit selectedMarker = null;
            for (int index = 0; index < homeMarkers.Count; index++)
            {
                if (homeMarkers[index].Address == result.HomeTeamMarkerAddress)
                {
                    selectedMarker = homeMarkers[index];
                    break;
                }
            }
            if (selectedMarker == null || selectedMarker.RegionSize < 0x40
                || selectedMarker.RegionSize > 32L * 1024 * 1024) return false;

            long markerHomePointer;
            string homeText;
            string canonicalHome;
            try
            {
                markerHomePointer = ReadInt64(selectedMarker.Address - 0x38);
                if (markerHomePointer < selectedMarker.RegionBase
                    || markerHomePointer >= selectedMarker.RegionBase + selectedMarker.RegionSize) return false;
                homeText = ReadAsciiString(markerHomePointer, 64);
            }
            catch { return false; }
            if (!LooksLikeTeamName(homeText)
                || !catalogNames.TryGetValue(NormalizeSlug(homeText), out canonicalHome)) return false;

            HashSet<long> homePointers = new HashSet<long>();
            homePointers.Add(markerHomePointer);
            for (int index = 0; index < selectedMarker.Names.Count; index++)
            {
                TextAddress candidate = selectedMarker.Names[index];
                if (String.Equals(NormalizeSlug(candidate.Value), NormalizeSlug(canonicalHome),
                    StringComparison.OrdinalIgnoreCase)) homePointers.Add(candidate.Address);
            }

            long moduleBase;
            try { moduleBase = process.MainModule.BaseAddress.ToInt64(); }
            catch { return false; }
            long expectedTypeGuard = moduleBase + 0xB604C78L;
            long selectedReference = 0;
            long selectedAwayPointer = 0;
            string selectedAwayName = null;
            HashSet<long> seenReferences = new HashSet<long>();
            byte[] buffer = new byte[ChunkSize];
            long offset = 0;
            while (offset < selectedMarker.RegionSize)
            {
                int requested = (int)Math.Min(buffer.Length, selectedMarker.RegionSize - offset);
                long chunkAddress = selectedMarker.RegionBase + offset;
                int bytesRead = Read(chunkAddress, buffer, requested);
                if (bytesRead < 0x20) break;
                int alignment = (int)((8 - (chunkAddress & 7)) & 7);
                for (int byteIndex = alignment; byteIndex <= bytesRead - 0x20; byteIndex += 8)
                {
                    long homePointer = BitConverter.ToInt64(buffer, byteIndex);
                    if (!homePointers.Contains(homePointer)) continue;
                    long reference = chunkAddress + byteIndex;
                    if (!seenReferences.Add(reference)) continue;
                    long awayPointer = BitConverter.ToInt64(buffer, byteIndex + 0x10);
                    long typeGuard = BitConverter.ToInt64(buffer, byteIndex + 0x18);
                    if (typeGuard != expectedTypeGuard || awayPointer == homePointer
                        || awayPointer < selectedMarker.RegionBase
                        || awayPointer >= selectedMarker.RegionBase + selectedMarker.RegionSize) continue;
                    string awayText;
                    string canonicalAway;
                    try { awayText = ReadAsciiString(awayPointer, 64); }
                    catch { continue; }
                    if (!LooksLikeTeamName(awayText)
                        || !catalogNames.TryGetValue(NormalizeSlug(awayText), out canonicalAway)
                        || String.Equals(canonicalAway, canonicalHome, StringComparison.OrdinalIgnoreCase)) continue;
                    if (selectedReference != 0 && selectedReference != reference) return false;
                    selectedReference = reference;
                    selectedAwayPointer = awayPointer;
                    selectedAwayName = canonicalAway;
                }
                if (requested <= 0x20) break;
                offset += requested - 0x20;
            }
            if (selectedReference == 0 || selectedAwayPointer == 0
                || String.IsNullOrWhiteSpace(selectedAwayName)) return false;

            List<long> validatedHomePointers = new List<long>();
            foreach (long address in homePointers)
            {
                try
                {
                    string value = ReadAsciiString(address, 64);
                    if (String.Equals(NormalizeSlug(value), NormalizeSlug(canonicalHome),
                        StringComparison.OrdinalIgnoreCase)) validatedHomePointers.Add(address);
                }
                catch { }
            }
            if (validatedHomePointers.Count == 0) return false;
            validatedHomePointers.Sort();
            result.AwayTeamName = selectedAwayName;
            result.HomeTeamName = canonicalHome;
            result.AwayTeamNameAddresses.Clear();
            result.HomeTeamNameAddresses.Clear();
            result.AwayTeamNameAddresses.Add(selectedAwayPointer);
            result.HomeTeamNameAddresses.AddRange(validatedHomePointers);
            result.HomeTeamMarkerAddress = selectedMarker.Address;
            return true;
        }

        private static string ReadFixedAscii(byte[] bytes, int start, int maximumLength)
        {
            if (bytes == null || start < 0 || start >= bytes.Length) return String.Empty;
            int end = start;
            int limit = Math.Min(bytes.Length, start + maximumLength);
            while (end < limit && bytes[end] >= 32 && bytes[end] <= 126) end++;
            return end > start ? Encoding.ASCII.GetString(bytes, start, end - start).Trim() : String.Empty;
        }

        internal static bool LooksLikeTeamKey(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.Length < 2 || value.Length > 16) return false;
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z')
                    && !Char.IsDigit(c) && c != '&' && c != '.' && c != '-' && c != ' ') return false;
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

        internal static bool RoleDisplayNameMatchesCanonical(string observed, string canonical)
        {
            if (String.IsNullOrWhiteSpace(observed) || String.IsNullOrWhiteSpace(canonical)) return false;
            observed = observed.Trim();
            canonical = canonical.Trim();
            if (String.Equals(observed, canonical, StringComparison.OrdinalIgnoreCase)) return true;

            List<string> observedTokens;
            List<bool> observedDotted;
            List<string> canonicalTokens;
            List<bool> ignoredCanonicalDots;
            TokenizeRoleDisplayName(observed, out observedTokens, out observedDotted);
            TokenizeRoleDisplayName(canonical, out canonicalTokens, out ignoredCanonicalDots);
            if (observedTokens.Count == 0 || observedTokens.Count != canonicalTokens.Count) return false;
            for (int index = 0; index < observedTokens.Count; index++)
            {
                string shortToken = observedTokens[index];
                string fullToken = canonicalTokens[index];
                if (String.Equals(shortToken, fullToken, StringComparison.OrdinalIgnoreCase)) continue;
                if (!observedDotted[index] || shortToken.Length >= fullToken.Length
                    || !fullToken.StartsWith(shortToken, StringComparison.OrdinalIgnoreCase)) return false;
            }
            return true;
        }

        internal static bool TryResolveRoleTeamCanonical(string observed,
            IEnumerable<string> allocationTraditionSlugs,
            IDictionary<string, string> catalogNames, out string canonical)
        {
            canonical = null;
            if (!LooksLikeTeamName(observed) || allocationTraditionSlugs == null
                || catalogNames == null) return false;
            string observedSlug = NormalizeSlug(observed);
            HashSet<string> normalizedTraditions = new HashSet<string>(
                StringComparer.OrdinalIgnoreCase);
            foreach (string rawSlug in allocationTraditionSlugs)
            {
                string normalized = NormalizeSlug(rawSlug);
                if (!String.IsNullOrWhiteSpace(normalized))
                    normalizedTraditions.Add(normalized);
            }

            // The labeled role vectors and their N/A anchors are pooled and can
            // retain an old matchup.  Without a current-allocation tradition,
            // neither a catalog display-name match nor a known generic FCS name
            // proves that the pair belongs to the current game.  Stay blank
            // until an independently current witness is discovered.
            if (normalizedTraditions.Count == 0)
                return false;

            HashSet<string> candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string slug in normalizedTraditions)
            {
                string catalogName;
                bool hasCatalogName = catalogNames.TryGetValue(slug, out catalogName)
                    && !String.IsNullOrWhiteSpace(catalogName);
                if (String.Equals(slug, observedSlug, StringComparison.OrdinalIgnoreCase))
                {
                    candidates.Add(hasCatalogName ? catalogName : observed.Trim());
                    continue;
                }
                if (hasCatalogName && RoleDisplayNameMatchesCanonical(observed, catalogName))
                    candidates.Add(catalogName);
            }
            if (candidates.Count != 1) return false;
            foreach (string candidate in candidates) canonical = candidate;
            return !String.IsNullOrWhiteSpace(canonical);
        }

        private static void TokenizeRoleDisplayName(string value,
            out List<string> tokens, out List<bool> dotted)
        {
            tokens = new List<string>();
            dotted = new List<bool>();
            string text = value ?? String.Empty;
            int index = 0;
            while (index < text.Length)
            {
                while (index < text.Length && !Char.IsLetterOrDigit(text[index])) index++;
                int start = index;
                while (index < text.Length && Char.IsLetterOrDigit(text[index])) index++;
                if (index <= start) continue;
                tokens.Add(text.Substring(start, index - start));
                dotted.Add(index < text.Length && text[index] == '.');
            }
        }

        internal static string NormalizeSlug(string value)
        {
            // Only whitespace, hyphens and slashes are word boundaries; other
            // punctuation vanishes WITHOUT splitting. This mirrors how the game
            // names its asset folders: "Texas A&M" is texas_am and "N.C. State"
            // is nc_state. The old rule turned every non-alphanumeric into a
            // separator, producing texas_a_m / n_c_state - slugs that match
            // nothing, which silently discarded those teams' names in any mode
            // with tradition assets present.
            StringBuilder result = new StringBuilder();
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

        private static string TitleFromSlug(string slug)
        {
            string[] pieces = (slug ?? String.Empty).Replace('-', '_').Split(new char[] { '_' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < pieces.Length; i++)
                pieces[i] = pieces[i].Length == 0 ? pieces[i] : Char.ToUpperInvariant(pieces[i][0]) + pieces[i].Substring(1).ToLowerInvariant();
            return String.Join(" ", pieces);
        }

        private List<MemoryRegion> EnumerateRegions()
        {
            List<MemoryRegion> result = new List<MemoryRegion>();
            long address = 0;
            int structureSize = Marshal.SizeOf(typeof(NativeMethods.MemoryBasicInformation));
            while (address >= 0 && address < 0x00007FFFFFFF0000L)
            {
                NativeMethods.MemoryBasicInformation info;
                int returned = NativeMethods.VirtualQueryEx(processHandle, new IntPtr(address), out info, new IntPtr(structureSize));
                if (returned == 0) break;
                long baseAddress = info.BaseAddress.ToInt64();
                long size = unchecked((long)info.RegionSize.ToUInt64());
                if (size <= 0) break;
                bool readable = info.State == MemCommit
                    && info.Type == MemPrivate
                    && (info.Protect & PageGuard) == 0
                    && (info.Protect & PageNoAccess) == 0;
                if (readable) result.Add(new MemoryRegion
                {
                    BaseAddress = baseAddress,
                    AllocationBase = info.AllocationBase.ToInt64(),
                    Size = size,
                    Protect = info.Protect
                });
                long next = baseAddress + size;
                if (next <= address) break;
                address = next;
            }
            return result;
        }

        private List<MemoryRegion> EnumerateAllReadableRegions()
        {
            List<MemoryRegion> result = new List<MemoryRegion>();
            long address = 0;
            int structureSize = Marshal.SizeOf(typeof(NativeMethods.MemoryBasicInformation));
            while (address >= 0 && address < 0x00007FFFFFFF0000L)
            {
                NativeMethods.MemoryBasicInformation info;
                int returned = NativeMethods.VirtualQueryEx(processHandle, new IntPtr(address), out info, new IntPtr(structureSize));
                if (returned == 0) break;
                long baseAddress = info.BaseAddress.ToInt64();
                long size = unchecked((long)info.RegionSize.ToUInt64());
                if (size <= 0) break;
                bool readable = info.State == MemCommit
                    && (info.Protect & PageGuard) == 0
                    && (info.Protect & PageNoAccess) == 0;
                if (readable) result.Add(new MemoryRegion
                {
                    BaseAddress = baseAddress,
                    AllocationBase = info.AllocationBase.ToInt64(),
                    Size = size,
                    Protect = info.Protect
                });
                long next = baseAddress + size;
                if (next <= address) break;
                address = next;
            }
            return result;
        }

        private int Read(long address, byte[] buffer, int requested)
        {
            IntPtr bytesRead;
            bool okay = NativeMethods.ReadProcessMemory(processHandle, new IntPtr(address), buffer, new IntPtr(requested), out bytesRead);
            return okay || bytesRead.ToInt64() > 0 ? (int)Math.Min(bytesRead.ToInt64(), requested) : 0;
        }

        private void EnsureAttached()
        {
            if (processHandle == IntPtr.Zero || process == null || process.HasExited)
            {
                throw new InvalidOperationException("Attach to " + GameProfile.ProcessName + ".exe first.");
            }
        }

        private static string FormatAddress(long value)
        {
            return "0x" + value.ToString("X16", CultureInfo.InvariantCulture);
        }

        private void DisposeHandle()
        {
            if (processHandle != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(processHandle);
                processHandle = IntPtr.Zero;
            }
            process = null;
        }

        public void Dispose()
        {
            DisposeHandle();
        }

        private sealed class MemoryRegion
        {
            public long BaseAddress;
            public long AllocationBase;
            public long Size;
            public uint Protect;
        }

        private sealed class RamBlockCandidate
        {
            public long Address;
            public int Score;
            public int Quarter;
            public int Clock;
            public int PlayClock;
            public int HomeScore;
            public int AwayScore;
            public int Possession;
            public int Down;
            public int Distance;
            public bool UsesWideLayout;
            public bool LiveChangeObserved;
        }

        private sealed class LabeledVectorRoleReference
        {
            public long LabelAddress;
            public long ReferenceAddress;
            public long DescriptorAddress;
            public long VectorBegin;
            public long Allocator;
            public long PlaceholderAddress;
            public long TeamNameAddress;
            public string TeamName;
        }

        private sealed class LabeledVectorRolePair
        {
            public long AllocationBase;
            public long HomeLabelAddress;
            public LabeledVectorRoleReference Away;
            public LabeledVectorRoleReference Home;
        }

        private enum LabeledVectorRoleResolution
        {
            None,
            Unique,
            IncompleteOrAmbiguous
        }

        private class MemoryHit
        {
            public long Address;
            public long AllocationBase;
            public long RegionBase;
            public long RegionSize;

            public MemoryHit(long address, MemoryRegion region)
            {
                Address = address;
                AllocationBase = region.AllocationBase;
                RegionBase = region.BaseAddress;
                RegionSize = region.Size;
            }
        }

        private sealed class TextAddress
        {
            public string Value;
            public long Address;

            public TextAddress(string value, long address)
            {
                Value = value;
                Address = address;
            }
        }

        private sealed class TeamMarkerHit : MemoryHit
        {
            public readonly List<TextAddress> Names = new List<TextAddress>();

            public TeamMarkerHit(long address, MemoryRegion region) : base(address, region) { }
        }

        private sealed class TraditionHit : MemoryHit
        {
            public string Slug;

            public TraditionHit(long address, MemoryRegion region, string slug) : base(address, region)
            {
                Slug = slug;
            }
        }
    }

    internal static class NativeMethods
    {
        [StructLayout(LayoutKind.Sequential)]
        internal struct MemoryBasicInformation
        {
            public IntPtr BaseAddress;
            public IntPtr AllocationBase;
            public uint AllocationProtect;
            public UIntPtr RegionSize;
            public uint State;
            public uint Protect;
            public uint Type;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ReadProcessMemory(IntPtr process, IntPtr baseAddress, [Out] byte[] buffer, IntPtr size, out IntPtr bytesRead);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern int VirtualQueryEx(IntPtr process, IntPtr address, out MemoryBasicInformation buffer, IntPtr length);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CloseHandle(IntPtr handle);
    }
}
