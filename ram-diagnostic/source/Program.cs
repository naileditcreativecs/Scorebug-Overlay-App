using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace CollegeFootballRamDiagnostic
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0 && String.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
            {
                return SelfTest.Run(args.Length > 1 ? args[1] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--probe", StringComparison.OrdinalIgnoreCase))
            {
                return Probe.Run(args.Length > 1 ? args[1] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--locate", StringComparison.OrdinalIgnoreCase))
            {
                return LocatorProbe.Run(args.Length > 1 ? args[1] : null, args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankProbe.Run(args.Length > 1 ? args[1] : null, args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-text-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankTextProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null,
                    args.Length > 5 ? args[5] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--inspect-block", StringComparison.OrdinalIgnoreCase))
            {
                return BlockProbe.Run(args.Length > 1 ? args[1] : null, args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--cluster-probe", StringComparison.OrdinalIgnoreCase))
            {
                return ClusterProbe.Run(args.Length > 1 ? args[1] : null, args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-order-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankOrderProbe.Run(args.Length > 1 ? args[1] : null, args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-pair-offsets", StringComparison.OrdinalIgnoreCase))
            {
                return RankPairOffsetProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--field-reference-probe", StringComparison.OrdinalIgnoreCase))
            {
                return FieldReferenceProbe.Run(args.Length > 1 ? args[1] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-layout-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankLayoutProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-vtable-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankVtableProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--typeinfo-head-probe", StringComparison.OrdinalIgnoreCase))
            {
                return TypeInfoHeadProbe.Run(args.Length > 1 ? args[1] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--pointer-probe", StringComparison.OrdinalIgnoreCase))
            {
                return PointerProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--private-pointer-probe", StringComparison.OrdinalIgnoreCase))
            {
                return PointerProbe.RunPrivate(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--multi-pointer-probe", StringComparison.OrdinalIgnoreCase))
            {
                return MultiPointerProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--typeinfo-node-probe", StringComparison.OrdinalIgnoreCase))
            {
                return TypeInfoNodeProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--field-array-probe", StringComparison.OrdinalIgnoreCase))
            {
                return FieldArrayProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--module-pointer-probe", StringComparison.OrdinalIgnoreCase))
            {
                return ModulePointerProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--module-int32-probe", StringComparison.OrdinalIgnoreCase))
            {
                return ModuleInt32Probe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-hash-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankHashProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--name-slot-probe", StringComparison.OrdinalIgnoreCase))
            {
                return NameSlotProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null,
                    args.Length > 5 ? args[5] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-id-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankIdProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-floating-pairs", StringComparison.OrdinalIgnoreCase))
            {
                return RankFloatingProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-byte-snapshot", StringComparison.OrdinalIgnoreCase))
            {
                return RankByteSnapshotProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-byte-filter", StringComparison.OrdinalIgnoreCase))
            {
                return RankByteFilterProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-teamid-probe", StringComparison.OrdinalIgnoreCase))
            {
                return RankTeamIdProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null,
                    args.Length > 5 ? args[5] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-pair-context", StringComparison.OrdinalIgnoreCase))
            {
                return RankPairContextProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-pair-context-compare", StringComparison.OrdinalIgnoreCase))
            {
                return RankPairContextCompareProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--scorehud-rank-probe", StringComparison.OrdinalIgnoreCase))
            {
                return ScoreHudRankProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--live-scorehud-probe", StringComparison.OrdinalIgnoreCase))
            {
                return LiveScoreHudProbe.Run(args.Length > 1 ? args[1] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--game-state-timeout-probe", StringComparison.OrdinalIgnoreCase))
            {
                return GameStateTimeoutProbe.Run(args.Length > 1 ? args[1] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--scorehud-score-probe", StringComparison.OrdinalIgnoreCase))
            {
                return ScoreHudScoreProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--adjacent-pair-probe", StringComparison.OrdinalIgnoreCase))
            {
                return AdjacentPairProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--filter-adjacent-pairs", StringComparison.OrdinalIgnoreCase))
            {
                return AdjacentPairFilterProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--rank-timeout-contexts", StringComparison.OrdinalIgnoreCase))
            {
                return TimeoutContextRankProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--special-down-probe", StringComparison.OrdinalIgnoreCase))
            {
                return SpecialDownProbe.Run(args.Length > 1 ? args[1] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--dump-memory", StringComparison.OrdinalIgnoreCase))
            {
                return MemoryDumpProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--learn-transition", StringComparison.OrdinalIgnoreCase))
            {
                return TransitionProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--learn-change", StringComparison.OrdinalIgnoreCase))
            {
                return ChangeProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--filter-addresses", StringComparison.OrdinalIgnoreCase))
            {
                return AddressFilterProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--filter-rank-text", StringComparison.OrdinalIgnoreCase))
            {
                return RankTextFilterProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--find-int32", StringComparison.OrdinalIgnoreCase))
            {
                return ExactValueProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--find-typed-int32", StringComparison.OrdinalIgnoreCase))
            {
                return TypedInt32Probe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--filter-pairs", StringComparison.OrdinalIgnoreCase))
            {
                return PairFilterProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null,
                    args.Length > 5 ? args[5] : null,
                    args.Length > 6 ? args[6] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--filter-near-pairs", StringComparison.OrdinalIgnoreCase))
            {
                return NearPairFilterProbe.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    args.Length > 3 ? args[3] : null,
                    args.Length > 4 ? args[4] : null,
                    args.Length > 5 ? args[5] : null,
                    args.Length > 6 ? args[6] : null);
            }
            if (args.Length > 0 && String.Equals(args[0], "--service", StringComparison.OrdinalIgnoreCase))
            {
                int parentProcessId;
                Int32.TryParse(args.Length > 3 ? args[3] : null, NumberStyles.Integer, CultureInfo.InvariantCulture, out parentProcessId);
                return RamService.Run(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 ? args[2] : null,
                    parentProcessId);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            return 0;
        }
    }

    internal static class GameStateTimeoutProbe
    {
        public static int Run(string outputPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<RamTimeoutSnapshot> candidates = scanner.FindGameStateTimeoutCandidates(CancellationToken.None);
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < candidates.Count; index++)
                    {
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "homeAddress", "0x" + candidates[index].Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "awayAddress", "0x" + (candidates[index].Address + 4).ToString("X", CultureInfo.InvariantCulture) },
                            { "home", candidates[index].Home },
                            { "away", candidates[index].Away }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "candidateCount", candidates.Count },
                        { "candidates", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class ScoreHudScoreProbe
    {
        public static int Run(string outputPath, string awayScoreText, string homeScoreText)
        {
            try
            {
                int awayScore = Int32.Parse(awayScoreText ?? "0", CultureInfo.InvariantCulture);
                int homeScore = Int32.Parse(homeScoreText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<ScoreHudTeamCandidate> candidates =
                        scanner.FindScoreHudTeamCandidatesByScores(awayScore, homeScore, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < candidates.Count; index++)
                    {
                        ScoreHudTeamCandidate candidate = candidates[index];
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + candidate.Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "vtable", "0x" + candidate.TypePointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "runtimeTypeInfo", "0x" + candidate.RuntimeTypeInfo.ToString("X", CultureInfo.InvariantCulture) },
                            { "displayPointer", "0x" + candidate.DisplayPointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "teamId", candidate.TeamId },
                            { "rank", candidate.Rank },
                            { "timeouts", candidate.Timeouts },
                            { "score", candidate.Score },
                            { "possession", candidate.HasPossession }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayScore", awayScore },
                        { "homeScore", homeScore },
                        { "candidateCount", formatted.Count },
                        { "candidates", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class AdjacentPairProbe
    {
        public static int Run(string outputPath, string firstText, string secondText)
        {
            try
            {
                int first = Int32.Parse(firstText ?? "3", CultureInfo.InvariantCulture);
                int second = Int32.Parse(secondText ?? "3", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    long[] candidates = scanner.FindAdjacentInt32Pairs(first, second, CancellationToken.None);
                    object[] formatted = new object[candidates.Length];
                    for (int index = 0; index < candidates.Length; index++)
                        formatted[index] = new Dictionary<string, object>
                        {
                            { "firstAddress", "0x" + candidates[index].ToString("X", CultureInfo.InvariantCulture) },
                            { "secondAddress", "0x" + (candidates[index] + 4).ToString("X", CultureInfo.InvariantCulture) }
                        };
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "first", first },
                        { "second", second },
                        { "candidateCount", candidates.Length },
                        { "candidates", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class AdjacentPairFilterProbe
    {
        public static int Run(string inputPath, string outputPath, string firstText, string secondText)
        {
            try
            {
                int first = Int32.Parse(firstText ?? "2", CultureInfo.InvariantCulture);
                int second = Int32.Parse(secondText ?? "3", CultureInfo.InvariantCulture);
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(inputPath));
                IEnumerable source = root.ContainsKey("candidates") ? root["candidates"] as IEnumerable : null;
                if (source == null) throw new InvalidOperationException("The input report has no candidates.");
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                List<object> kept = new List<object>();
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    foreach (object item in source)
                    {
                        Dictionary<string, object> candidate = item as Dictionary<string, object>;
                        if (candidate == null || !candidate.ContainsKey("firstAddress")) continue;
                        string text = Convert.ToString(candidate["firstAddress"], CultureInfo.InvariantCulture);
                        if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) text = text.Substring(2);
                        long address;
                        if (!Int64.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out address)) continue;
                        int currentFirst;
                        int currentSecond;
                        try
                        {
                            currentFirst = scanner.ReadInt32(address);
                            currentSecond = scanner.ReadInt32(address + 4);
                        }
                        catch { continue; }
                        if (currentFirst != first || currentSecond != second) continue;
                        kept.Add(new Dictionary<string, object>
                        {
                            { "firstAddress", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                            { "secondAddress", "0x" + (address + 4).ToString("X", CultureInfo.InvariantCulture) },
                            { "first", currentFirst },
                            { "second", currentSecond }
                        });
                    }
                }
                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "passed", true },
                    { "processId", games[0].Id },
                    { "first", first },
                    { "second", second },
                    { "candidateCount", kept.Count },
                    { "candidates", kept.ToArray() }
                }));
                return 0;
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class TimeoutContextRankProbe
    {
        public static int Run(string inputPath, string outputPath)
        {
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(inputPath));
                IEnumerable source = root.ContainsKey("candidates") ? root["candidates"] as IEnumerable : null;
                if (source == null) throw new InvalidOperationException("The input report has no candidates.");
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                List<Dictionary<string, object>> ranked = new List<Dictionary<string, object>>();
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    foreach (object item in source)
                    {
                        Dictionary<string, object> candidate = item as Dictionary<string, object>;
                        if (candidate == null || !candidate.ContainsKey("firstAddress")) continue;
                        string text = Convert.ToString(candidate["firstAddress"], CultureInfo.InvariantCulture);
                        if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) text = text.Substring(2);
                        long address;
                        if (!Int64.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out address)) continue;
                        // Presentation copies have consistently lived in this
                        // low private heap. Avoid thousands of unrelated 3/3
                        // pairs from terrain and render-data allocations.
                        if (address < 0x7E000000L || address >= 0x82000000L) continue;
                        int similarity;
                        try { similarity = scanner.ScoreTimeoutPresentationContext(address); }
                        catch { continue; }
                        ranked.Add(new Dictionary<string, object>
                        {
                            { "homeAddress", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                            { "awayAddress", "0x" + (address + 4).ToString("X", CultureInfo.InvariantCulture) },
                            { "similarity", similarity }
                        });
                    }
                }
                ranked.Sort(delegate(Dictionary<string, object> left, Dictionary<string, object> right)
                {
                    return Convert.ToInt32(right["similarity"], CultureInfo.InvariantCulture)
                        .CompareTo(Convert.ToInt32(left["similarity"], CultureInfo.InvariantCulture));
                });
                if (ranked.Count > 500) ranked.RemoveRange(500, ranked.Count - 500);
                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "passed", true },
                    { "processId", games[0].Id },
                    { "candidateCount", ranked.Count },
                    { "candidates", ranked.ToArray() }
                }));
                return 0;
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class RankByteSnapshotProbe
    {
        public static int Run(string outputPath, string awayText, string homeText)
        {
            try
            {
                int away = Int32.Parse(awayText ?? "0", CultureInfo.InvariantCulture);
                int home = Int32.Parse(homeText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                long[][] ranges = new long[][]
                {
                    new long[] { 0x1E000000L, 0x20000000L },
                    new long[] { 0x4E000000L, 0x50000000L }
                };
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<long> awayMatches = scanner.FindByteMatches((byte)away, ranges, 5000000, CancellationToken.None);
                    List<long> homeMatches = scanner.FindByteMatches((byte)home, ranges, 5000000, CancellationToken.None);
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "phase", "snapshot" },
                        { "processId", games[0].Id },
                        { "awayRank", away },
                        { "homeRank", home },
                        { "awayCandidates", Format(awayMatches) },
                        { "homeCandidates", Format(homeMatches) }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                WriteError(outputPath, error);
                return 1;
            }
        }

        internal static List<string> Format(List<long> addresses)
        {
            List<string> result = new List<string>(addresses.Count);
            foreach (long address in addresses) result.Add("0x" + address.ToString("X", CultureInfo.InvariantCulture));
            return result;
        }

        internal static long ParseAddress(object value)
        {
            string text = Convert.ToString(value, CultureInfo.InvariantCulture);
            if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) text = text.Substring(2);
            return Int64.Parse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        }

        internal static void WriteError(string path, Exception error)
        {
            if (!String.IsNullOrWhiteSpace(path))
                File.WriteAllText(path, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                {
                    { "phase", "error" },
                    { "error", error.ToString() }
                }));
        }
    }

    internal static class RankByteFilterProbe
    {
        public static int Run(string inputPath, string outputPath, string awayText, string homeText)
        {
            try
            {
                int away = Int32.Parse(awayText ?? "0", CultureInfo.InvariantCulture);
                int home = Int32.Parse(homeText ?? "0", CultureInfo.InvariantCulture);
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(inputPath));
                object[] awayInput = root["awayCandidates"] as object[];
                object[] homeInput = root["homeCandidates"] as object[];
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                List<long> keptAway = new List<long>();
                List<long> keptHome = new List<long>();
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    if (awayInput != null)
                        foreach (object value in awayInput)
                        {
                            long address = RankByteSnapshotProbe.ParseAddress(value);
                            try { if (scanner.ReadBytes(address, 1)[0] == (byte)away) keptAway.Add(address); }
                            catch { }
                        }
                    if (homeInput != null)
                        foreach (object value in homeInput)
                        {
                            long address = RankByteSnapshotProbe.ParseAddress(value);
                            try { if (scanner.ReadBytes(address, 1)[0] == (byte)home) keptHome.Add(address); }
                            catch { }
                        }
                }
                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "phase", "filtered" },
                    { "processId", games[0].Id },
                    { "awayRank", away },
                    { "homeRank", home },
                    { "awayCandidates", RankByteSnapshotProbe.Format(keptAway) },
                    { "homeCandidates", RankByteSnapshotProbe.Format(keptHome) }
                }));
                return 0;
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }
    }

    internal static class RankTeamIdProbe
    {
        private sealed class LayoutResult
        {
            public string Encoding;
            public int Delta;
            public int AwayCopies;
            public int HomeCopies;
            public int NearbyPairs;
            public readonly List<string> Samples = new List<string>();
        }

        public static int Run(string outputPath, string awayIdText, string awayRankText,
            string homeIdText, string homeRankText)
        {
            try
            {
                int awayId = Int32.Parse(awayIdText ?? "0", CultureInfo.InvariantCulture);
                int awayRank = Int32.Parse(awayRankText ?? "0", CultureInfo.InvariantCulture);
                int homeId = Int32.Parse(homeIdText ?? "0", CultureInfo.InvariantCulture);
                int homeRank = Int32.Parse(homeRankText ?? "0", CultureInfo.InvariantCulture);
                if (awayRank < 0 || awayRank > 255 || homeRank < 0 || homeRank > 255)
                    throw new ArgumentOutOfRangeException("Rank values must fit in one byte.");
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                List<LayoutResult> layouts = new List<LayoutResult>();
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<int, List<long>> refs16 = scanner.FindPrivateUInt16References(
                        new int[] { awayId, homeId }, 0x100000000L, 100000, CancellationToken.None);
                    AddLayouts(layouts, "uint16", scanner, refs16[awayId], (byte)awayRank,
                        refs16[homeId], (byte)homeRank);

                    Dictionary<int, List<long>> refs32 = scanner.FindPrivateInt32References(
                        new int[] { awayId, homeId }, 0x100000000L, 100000, CancellationToken.None);
                    AddLayouts(layouts, "int32", scanner, refs32[awayId], (byte)awayRank,
                        refs32[homeId], (byte)homeRank);

                    layouts.Sort(delegate(LayoutResult left, LayoutResult right)
                    {
                        int compared = right.NearbyPairs.CompareTo(left.NearbyPairs);
                        if (compared != 0) return compared;
                        compared = (left.AwayCopies + left.HomeCopies).CompareTo(right.AwayCopies + right.HomeCopies);
                        if (compared != 0) return compared;
                        return Math.Abs(left.Delta).CompareTo(Math.Abs(right.Delta));
                    });
                    List<object> formatted = new List<object>();
                    foreach (LayoutResult item in layouts)
                    {
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "encoding", item.Encoding },
                            { "rankDelta", item.Delta },
                            { "awayCopies", item.AwayCopies },
                            { "homeCopies", item.HomeCopies },
                            { "nearbyPairs", item.NearbyPairs },
                            { "samples", item.Samples.ToArray() }
                        });
                        if (formatted.Count >= 2048) break;
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayTeamId", awayId },
                        { "awayRank", awayRank },
                        { "homeTeamId", homeId },
                        { "homeRank", homeRank },
                        { "uint16AwayReferences", refs16[awayId].Count },
                        { "uint16HomeReferences", refs16[homeId].Count },
                        { "int32AwayReferences", refs32[awayId].Count },
                        { "int32HomeReferences", refs32[homeId].Count },
                        { "layoutCount", layouts.Count },
                        { "layouts", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }

        private static void AddLayouts(List<LayoutResult> output, string encoding, MemoryScanner scanner,
            List<long> awayReferences, byte awayRank, List<long> homeReferences, byte homeRank)
        {
            const int radius = 512;
            Dictionary<int, List<long>> away = Collect(scanner, awayReferences, awayRank, radius);
            Dictionary<int, List<long>> home = Collect(scanner, homeReferences, homeRank, radius);
            foreach (KeyValuePair<int, List<long>> item in away)
            {
                List<long> homeAddresses;
                if (!home.TryGetValue(item.Key, out homeAddresses)) continue;
                List<long> awayAddresses = item.Value;
                awayAddresses.Sort();
                homeAddresses.Sort();
                LayoutResult result = new LayoutResult
                {
                    Encoding = encoding,
                    Delta = item.Key,
                    AwayCopies = awayAddresses.Count,
                    HomeCopies = homeAddresses.Count
                };
                int left = 0;
                for (int awayIndex = 0; awayIndex < awayAddresses.Count; awayIndex++)
                {
                    long awayAddress = awayAddresses[awayIndex];
                    while (left < homeAddresses.Count && homeAddresses[left] < awayAddress - 0x10000L) left++;
                    int homeIndex = left;
                    while (homeIndex < homeAddresses.Count && homeAddresses[homeIndex] <= awayAddress + 0x10000L)
                    {
                        long homeAddress = homeAddresses[homeIndex];
                        result.NearbyPairs++;
                        if (result.Samples.Count < 12)
                            result.Samples.Add("0x" + awayAddress.ToString("X", CultureInfo.InvariantCulture)
                                + "->0x" + (awayAddress + item.Key).ToString("X", CultureInfo.InvariantCulture)
                                + ";0x" + homeAddress.ToString("X", CultureInfo.InvariantCulture)
                                + "->0x" + (homeAddress + item.Key).ToString("X", CultureInfo.InvariantCulture));
                        homeIndex++;
                    }
                }
                if (result.NearbyPairs > 0) output.Add(result);
            }
        }

        private static Dictionary<int, List<long>> Collect(MemoryScanner scanner, List<long> references,
            byte rank, int radius)
        {
            Dictionary<int, List<long>> result = new Dictionary<int, List<long>>();
            foreach (long reference in references)
            {
                byte[] bytes;
                try { bytes = scanner.ReadBytes(reference - radius, radius * 2 + 1); }
                catch { continue; }
                for (int index = 0; index < bytes.Length; index++)
                {
                    if (bytes[index] != rank) continue;
                    int delta = index - radius;
                    List<long> addresses;
                    if (!result.TryGetValue(delta, out addresses)) result[delta] = addresses = new List<long>();
                    addresses.Add(reference);
                }
            }
            return result;
        }
    }

    internal static class RankPairContextProbe
    {
        public static int Run(string outputPath, string awayRankText, string homeRankText)
        {
            try
            {
                int awayRank = Int32.Parse(awayRankText ?? "0", CultureInfo.InvariantCulture);
                int homeRank = Int32.Parse(homeRankText ?? "0", CultureInfo.InvariantCulture);
                if (awayRank < 0 || awayRank > 255 || homeRank < 0 || homeRank > 255)
                    throw new ArgumentOutOfRangeException("Rank values must fit in one byte.");
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<RankPairContextCandidate> candidates = scanner.FindRankPairContexts(
                        (byte)awayRank, (byte)homeRank, 500000, CancellationToken.None);
                    List<object> formatted = new List<object>(candidates.Count);
                    foreach (RankPairContextCandidate item in candidates)
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "awayAddress", "0x" + item.AwayAddress.ToString("X", CultureInfo.InvariantCulture) },
                            { "homeAddress", "0x" + (item.AwayAddress + item.Delta).ToString("X", CultureInfo.InvariantCulture) },
                            { "delta", item.Delta },
                            { "rawHash", item.RawHash.ToString("X16", CultureInfo.InvariantCulture) },
                            { "pointerHash", item.PointerNormalizedHash.ToString("X16", CultureInfo.InvariantCulture) },
                            { "shapeHash", item.ShapeHash.ToString("X16", CultureInfo.InvariantCulture) }
                        });
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayRank", awayRank },
                        { "homeRank", homeRank },
                        { "candidateCount", candidates.Count },
                        { "candidates", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }
    }

    internal static class RankPairContextCompareProbe
    {
        private sealed class Match
        {
            public string Kind;
            public int Delta;
            public string Hash;
            public int BaselineCount;
            public int CurrentCount;
            public string BaselineAddress;
            public string CurrentAddress;
        }

        public static int Run(string baselinePath, string currentPath, string outputPath)
        {
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> baseline = serializer.Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(baselinePath));
                Dictionary<string, object> current = serializer.Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(currentPath));
                object[] baselineCandidates = baseline["candidates"] as object[];
                object[] currentCandidates = current["candidates"] as object[];
                List<Match> matches = new List<Match>();
                int raw = AddMatches(matches, "raw", "rawHash", baselineCandidates, currentCandidates);
                int pointer = AddMatches(matches, "pointer", "pointerHash", baselineCandidates, currentCandidates);
                int shape = AddMatches(matches, "shape", "shapeHash", baselineCandidates, currentCandidates);
                matches.Sort(delegate(Match left, Match right)
                {
                    int compared = KindOrder(left.Kind).CompareTo(KindOrder(right.Kind));
                    if (compared != 0) return compared;
                    compared = (left.BaselineCount + left.CurrentCount).CompareTo(
                        right.BaselineCount + right.CurrentCount);
                    if (compared != 0) return compared;
                    return Math.Abs(left.Delta).CompareTo(Math.Abs(right.Delta));
                });
                List<object> formatted = new List<object>();
                foreach (Match item in matches)
                {
                    formatted.Add(new Dictionary<string, object>
                    {
                        { "kind", item.Kind },
                        { "delta", item.Delta },
                        { "hash", item.Hash },
                        { "baselineCount", item.BaselineCount },
                        { "currentCount", item.CurrentCount },
                        { "baselineAddress", item.BaselineAddress },
                        { "baselineHomeAddress", Add(item.BaselineAddress, item.Delta) },
                        { "currentAddress", item.CurrentAddress },
                        { "currentHomeAddress", Add(item.CurrentAddress, item.Delta) }
                    });
                    if (formatted.Count >= 10000) break;
                }
                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "passed", true },
                    { "baselineAwayRank", baseline["awayRank"] },
                    { "baselineHomeRank", baseline["homeRank"] },
                    { "currentAwayRank", current["awayRank"] },
                    { "currentHomeRank", current["homeRank"] },
                    { "rawMatchCount", raw },
                    { "pointerMatchCount", pointer },
                    { "shapeMatchCount", shape },
                    { "matches", formatted.ToArray() }
                }));
                return 0;
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }

        private static int AddMatches(List<Match> output, string kind, string hashField,
            object[] baselineCandidates, object[] currentCandidates)
        {
            Dictionary<string, List<string>> baseline = Build(baselineCandidates, hashField);
            Dictionary<string, List<string>> current = Build(currentCandidates, hashField);
            int count = 0;
            foreach (KeyValuePair<string, List<string>> item in baseline)
            {
                List<string> currentAddresses;
                if (!current.TryGetValue(item.Key, out currentAddresses)) continue;
                int split = item.Key.IndexOf('|');
                output.Add(new Match
                {
                    Kind = kind,
                    Delta = Int32.Parse(item.Key.Substring(0, split), CultureInfo.InvariantCulture),
                    Hash = item.Key.Substring(split + 1),
                    BaselineCount = item.Value.Count,
                    CurrentCount = currentAddresses.Count,
                    BaselineAddress = item.Value[0],
                    CurrentAddress = currentAddresses[0]
                });
                count++;
            }
            return count;
        }

        private static Dictionary<string, List<string>> Build(object[] candidates, string hashField)
        {
            Dictionary<string, List<string>> result = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            if (candidates == null) return result;
            foreach (object value in candidates)
            {
                Dictionary<string, object> item = value as Dictionary<string, object>;
                if (item == null) continue;
                string key = Convert.ToString(item["delta"], CultureInfo.InvariantCulture) + "|"
                    + Convert.ToString(item[hashField], CultureInfo.InvariantCulture);
                List<string> addresses;
                if (!result.TryGetValue(key, out addresses)) result[key] = addresses = new List<string>();
                if (addresses.Count < 32) addresses.Add(Convert.ToString(item["awayAddress"], CultureInfo.InvariantCulture));
            }
            return result;
        }

        private static int KindOrder(string value)
        {
            if (String.Equals(value, "raw", StringComparison.Ordinal)) return 0;
            if (String.Equals(value, "pointer", StringComparison.Ordinal)) return 1;
            return 2;
        }

        private static string Add(string addressText, int delta)
        {
            long address = RankByteSnapshotProbe.ParseAddress(addressText);
            return "0x" + (address + delta).ToString("X", CultureInfo.InvariantCulture);
        }
    }

    internal static class ScoreHudRankProbe
    {
        public static int Run(string outputPath, string awayRankText, string homeRankText)
        {
            try
            {
                int awayRank = Int32.Parse(awayRankText ?? "0", CultureInfo.InvariantCulture);
                int homeRank = Int32.Parse(homeRankText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<int, List<ScoreHudTeamCandidate>> found = scanner.FindScoreHudTeamCandidates(
                        new int[] { awayRank, homeRank }, 10000, CancellationToken.None);
                    List<ScoreHudTeamCandidate> away = found[awayRank];
                    List<ScoreHudTeamCandidate> home = found[homeRank];
                    List<object> pairs = new List<object>();
                    foreach (ScoreHudTeamCandidate awayItem in away)
                    foreach (ScoreHudTeamCandidate homeItem in home)
                    {
                        long delta = homeItem.Address - awayItem.Address;
                        if (Math.Abs(delta) > 0x10000L) continue;
                        pairs.Add(new Dictionary<string, object>
                        {
                            { "delta", delta },
                            { "sameTypePointer", awayItem.TypePointer == homeItem.TypePointer },
                            { "away", Format(awayItem) },
                            { "home", Format(homeItem) }
                        });
                        if (pairs.Count >= 10000) break;
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayRank", awayRank },
                        { "homeRank", homeRank },
                        { "awayCandidateCount", away.Count },
                        { "homeCandidateCount", home.Count },
                        { "pairCount", pairs.Count },
                        { "awayCandidates", Format(away) },
                        { "homeCandidates", Format(home) },
                        { "nearbyPairs", pairs.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }

        private static object[] Format(List<ScoreHudTeamCandidate> values)
        {
            List<object> result = new List<object>();
            foreach (ScoreHudTeamCandidate value in values) result.Add(Format(value));
            return result.ToArray();
        }

        private static Dictionary<string, object> Format(ScoreHudTeamCandidate value)
        {
            return new Dictionary<string, object>
            {
                { "address", "0x" + value.Address.ToString("X", CultureInfo.InvariantCulture) },
                { "typePointer", "0x" + value.TypePointer.ToString("X", CultureInfo.InvariantCulture) },
                { "displayPointer", "0x" + value.DisplayPointer.ToString("X", CultureInfo.InvariantCulture) },
                { "color", value.Color },
                { "teamId", value.TeamId },
                { "rank", value.Rank },
                { "ties", value.Ties },
                { "timeouts", value.Timeouts },
                { "losses", value.Losses },
                { "score", value.Score },
                { "challenges", value.Challenges },
                { "wins", value.Wins },
                { "possession", value.HasPossession },
                { "isTeambuilder", value.IsTeambuilder }
            };
        }
    }

    internal static class LiveScoreHudProbe
    {
        public static int Run(string outputPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<ScoreHudTeamCandidate> teams = scanner.FindLiveScoreHudTeamCandidates(CancellationToken.None);
                    List<object> output = new List<object>();
                    foreach (ScoreHudTeamCandidate team in teams)
                    {
                        output.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + team.Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "header", "0x" + team.Header.ToString("X", CultureInfo.InvariantCulture) },
                            { "displayPointer", "0x" + team.DisplayPointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "color", team.Color },
                            { "rank", team.Rank },
                            { "teamId", team.TeamId },
                            { "timeouts", team.Timeouts },
                            { "score", team.Score },
                            { "possession", team.HasPossession }
                        });
                    }
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "candidateCount", teams.Count },
                        { "candidates", output.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }
    }

    internal static class SpecialDownProbe
    {
        public static int Run(string outputPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<ScoreHudMessageCandidate> messages;
                    List<ScoreHudDownDistanceCandidate> downs =
                        scanner.FindLiveScoreHudDownDistanceCandidates(CancellationToken.None, out messages);
                    List<ScoreHudAlertCandidate> alerts =
                        scanner.FindLiveScoreHudAlertCandidates(CancellationToken.None);
                    List<object> downOutput = new List<object>();
                    foreach (ScoreHudDownDistanceCandidate down in downs)
                    {
                        downOutput.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + down.Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "header", "0x" + down.Header.ToString("X", CultureInfo.InvariantCulture) },
                            { "displayPointer", "0x" + down.DisplayPointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "display", down.Display },
                            { "down", down.Down },
                            { "distance", down.Distance },
                            { "style", down.Style },
                            { "isEmpty", down.IsEmpty }
                        });
                    }
                    List<object> alertOutput = new List<object>();
                    foreach (ScoreHudAlertCandidate alert in alerts)
                    {
                        alertOutput.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + alert.Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "header", "0x" + alert.Header.ToString("X", CultureInfo.InvariantCulture) },
                            { "textPointer", "0x" + alert.TextPointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "text", alert.Text }
                        });
                    }
                    List<object> messageOutput = new List<object>();
                    foreach (ScoreHudMessageCandidate message in messages)
                    {
                        messageOutput.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + message.Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "header", "0x" + message.Header.ToString("X", CultureInfo.InvariantCulture) },
                            { "messageId", message.MessageId },
                            { "displayText", message.DisplayText },
                            { "infoText", message.InfoText },
                            { "playerId", message.PlayerId },
                            { "teamId", message.TeamId },
                            { "displayTime", message.DisplayTime }
                        });
                    }
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "downDistanceCandidates", downOutput.ToArray() },
                        { "alertCandidates", alertOutput.ToArray() },
                        { "messageCandidates", messageOutput.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }
    }

    internal static class RankFloatingProbe
    {
        public static int Run(string outputPath, string awayText, string homeText)
        {
            try
            {
                double away = Double.Parse(awayText ?? "0", CultureInfo.InvariantCulture);
                double home = Double.Parse(homeText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<RankPairOffsetCandidate> floats = scanner.FindFloatingPairOffsets(
                        away, home, false, 0x400, CancellationToken.None);
                    List<RankPairOffsetCandidate> doubles = scanner.FindFloatingPairOffsets(
                        away, home, true, 0x400, CancellationToken.None);
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayRank", away },
                        { "homeRank", home },
                        { "floatPairs", Format(floats) },
                        { "doublePairs", Format(doubles) }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static object Format(List<RankPairOffsetCandidate> values)
        {
            List<object> result = new List<object>();
            foreach (RankPairOffsetCandidate value in values)
            {
                List<string> addresses = new List<string>();
                foreach (long address in value.AwayAddresses)
                    addresses.Add("0x" + address.ToString("X", CultureInfo.InvariantCulture));
                result.Add(new Dictionary<string, object>
                {
                    { "delta", value.Delta },
                    { "count", value.Count },
                    { "awayAddresses", addresses }
                });
            }
            return result;
        }
    }

    internal static class RankIdProbe
    {
        public static int Run(string outputPath, string awayRankText, string homeRankText)
        {
            try
            {
                int awayRank = Int32.Parse(awayRankText ?? "0", CultureInfo.InvariantCulture);
                int homeRank = Int32.Parse(homeRankText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<int, List<long>> references = scanner.FindPrivateInt32References(
                        new int[] { 201, 204 }, 0x100000000L, 100000, CancellationToken.None);
                    List<Dictionary<string, object>> away = Filter(scanner, references[201], awayRank);
                    List<Dictionary<string, object>> home = Filter(scanner, references[204], homeRank);
                    Dictionary<long, int> deltas = new Dictionary<long, int>();
                    foreach (Dictionary<string, object> awayItem in away)
                    foreach (Dictionary<string, object> homeItem in home)
                    {
                        long awayAddress = Convert.ToInt64(awayItem["numericAddress"], CultureInfo.InvariantCulture);
                        long homeAddress = Convert.ToInt64(homeItem["numericAddress"], CultureInfo.InvariantCulture);
                        long delta = homeAddress - awayAddress;
                        if (Math.Abs(delta) > 0x4000) continue;
                        int count;
                        deltas.TryGetValue(delta, out count);
                        deltas[delta] = count + 1;
                    }
                    List<object> deltaList = new List<object>();
                    foreach (KeyValuePair<long, int> item in deltas)
                        deltaList.Add(new Dictionary<string, object>
                        {
                            { "delta", item.Key },
                            { "count", item.Value }
                        });
                    deltaList.Sort(delegate(object left, object right)
                    {
                        Dictionary<string, object> leftItem = (Dictionary<string, object>)left;
                        Dictionary<string, object> rightItem = (Dictionary<string, object>)right;
                        return Convert.ToInt32(rightItem["count"], CultureInfo.InvariantCulture)
                            .CompareTo(Convert.ToInt32(leftItem["count"], CultureInfo.InvariantCulture));
                    });
                    if (deltaList.Count > 256) deltaList.RemoveRange(256, deltaList.Count - 256);
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayIdReferenceCount", references[201].Count },
                        { "homeIdReferenceCount", references[204].Count },
                        { "awayValueCandidateCount", away.Count },
                        { "homeValueCandidateCount", home.Count },
                        { "awayCandidates", StripNumericAddress(away) },
                        { "homeCandidates", StripNumericAddress(home) },
                        { "nearbyDeltas", deltaList }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static List<Dictionary<string, object>> Filter(MemoryScanner scanner, List<long> references, int rank)
        {
            List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
            foreach (long reference in references)
            {
                List<int> rankOffsets = new List<int>();
                bool hasTypePointer = false;
                try
                {
                    byte[] bytes = scanner.ReadBytes(reference - 0x40, 0x100);
                    for (int index = 0; index < bytes.Length; index++)
                        if (bytes[index] == (byte)rank) rankOffsets.Add(index - 0x40);
                    for (int index = 0; index <= bytes.Length - 8; index += 8)
                        if (BitConverter.ToInt64(bytes, index) == 0x14E0F4758L) hasTypePointer = true;
                }
                catch { continue; }
                if (rankOffsets.Count == 0) continue;
                result.Add(new Dictionary<string, object>
                {
                    { "numericAddress", reference },
                    { "address", "0x" + reference.ToString("X", CultureInfo.InvariantCulture) },
                    { "rankByteOffsets", rankOffsets },
                    { "hasUint8TypePointer", hasTypePointer }
                });
                if (result.Count >= 10000) break;
            }
            return result;
        }

        private static object StripNumericAddress(List<Dictionary<string, object>> values)
        {
            List<object> result = new List<object>();
            foreach (Dictionary<string, object> item in values)
                result.Add(new Dictionary<string, object>
                {
                    { "address", item["address"] },
                    { "rankByteOffsets", item["rankByteOffsets"] },
                    { "hasUint8TypePointer", item["hasUint8TypePointer"] }
                });
            return result;
        }
    }

    internal static class NameSlotProbe
    {
        public static int Run(string outputPath, string awayAddressesText, string homeAddressesText,
            string awayRankText, string homeRankText)
        {
            try
            {
                long[] awayTargets = ParseAddresses(awayAddressesText);
                long[] homeTargets = ParseAddresses(homeAddressesText);
                int awayRank = Int32.Parse(awayRankText ?? "0", CultureInfo.InvariantCulture);
                int homeRank = Int32.Parse(homeRankText ?? "0", CultureInfo.InvariantCulture);
                List<long> allTargets = new List<long>(awayTargets);
                foreach (long value in homeTargets) if (!allTargets.Contains(value)) allTargets.Add(value);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<long, List<long>> references = scanner.FindPrivateInt64References(
                        allTargets.ToArray(), 0x100000000L, 10000, CancellationToken.None);
                    List<long> awayRefs = Merge(references, awayTargets);
                    List<long> homeRefs = Merge(references, homeTargets);
                    int[] strides = new int[] { 8, 16, 24, 32, 40, 48, 56, 64 };
                    List<object> candidates = new List<object>();
                    foreach (long awayRef in awayRefs)
                    foreach (long homeRef in homeRefs)
                    foreach (int stride in strides)
                    {
                        long delta = awayRef - homeRef;
                        if (Math.Abs(delta) != stride) continue;
                        int direction = delta > 0 ? 1 : -1;
                        long awayEntry = awayRef + direction * 40L * stride;
                        long homeEntry = homeRef + direction * 44L * stride;
                        for (int valueOffset = -16; valueOffset <= 16; valueOffset++)
                        {
                            int awayValue;
                            int homeValue;
                            try
                            {
                                awayValue = scanner.ReadBytes(awayEntry + valueOffset, 1)[0];
                                homeValue = scanner.ReadBytes(homeEntry + valueOffset, 1)[0];
                            }
                            catch { continue; }
                            if (awayValue != awayRank || homeValue != homeRank) continue;
                            candidates.Add(new Dictionary<string, object>
                            {
                                { "awayNameReference", "0x" + awayRef.ToString("X", CultureInfo.InvariantCulture) },
                                { "homeNameReference", "0x" + homeRef.ToString("X", CultureInfo.InvariantCulture) },
                                { "stride", stride },
                                { "direction", direction },
                                { "valueOffset", valueOffset },
                                { "awayRankAddress", "0x" + (awayEntry + valueOffset).ToString("X", CultureInfo.InvariantCulture) },
                                { "homeRankAddress", "0x" + (homeEntry + valueOffset).ToString("X", CultureInfo.InvariantCulture) }
                            });
                        }
                    }
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayReferenceCount", awayRefs.Count },
                        { "homeReferenceCount", homeRefs.Count },
                        { "candidateCount", candidates.Count },
                        { "candidates", candidates }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static long[] ParseAddresses(string text)
        {
            string[] pieces = (text ?? String.Empty).Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            List<long> result = new List<long>();
            foreach (string piece in pieces)
            {
                string value = piece.Trim();
                if (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) value = value.Substring(2);
                result.Add(Int64.Parse(value, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
            }
            if (result.Count == 0) throw new ArgumentException("At least one name address is required.");
            return result.ToArray();
        }

        private static List<long> Merge(Dictionary<long, List<long>> references, long[] targets)
        {
            List<long> result = new List<long>();
            foreach (long target in targets)
                foreach (long reference in references[target])
                    if (!result.Contains(reference)) result.Add(reference);
            return result;
        }
    }

    internal static class RankHashProbe
    {
        public static int Run(string outputPath, string awayText, string homeText)
        {
            try
            {
                int awayRank = Int32.Parse(awayText ?? "0", CultureInfo.InvariantCulture);
                int homeRank = Int32.Parse(homeText ?? "0", CultureInfo.InvariantCulture);
                int awayHash = unchecked((int)0x009EFD37U);
                int homeHash = unchecked((int)0x009F39B7U);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<int, List<long>> references = scanner.FindPrivateInt32References(
                        new int[] { awayHash, homeHash }, 0x100000000L, 100000, CancellationToken.None);
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayRank", awayRank },
                        { "homeRank", homeRank },
                        { "awayHash", "0x" + unchecked((uint)awayHash).ToString("X8", CultureInfo.InvariantCulture) },
                        { "homeHash", "0x" + unchecked((uint)homeHash).ToString("X8", CultureInfo.InvariantCulture) },
                        { "awayReferences", Describe(scanner, references[awayHash], awayRank, homeRank) },
                        { "homeReferences", Describe(scanner, references[homeHash], awayRank, homeRank) }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static object Describe(MemoryScanner scanner, List<long> references, int awayRank, int homeRank)
        {
            List<object> result = new List<object>();
            foreach (long reference in references)
            {
                List<int> awayOffsets = new List<int>();
                List<int> homeOffsets = new List<int>();
                try
                {
                    byte[] bytes = scanner.ReadBytes(reference - 0x40, 0x100);
                    for (int index = 0; index < bytes.Length; index++)
                    {
                        if (bytes[index] == (byte)awayRank) awayOffsets.Add(index - 0x40);
                        if (bytes[index] == (byte)homeRank) homeOffsets.Add(index - 0x40);
                    }
                }
                catch { }
                result.Add(new Dictionary<string, object>
                {
                    { "address", "0x" + reference.ToString("X", CultureInfo.InvariantCulture) },
                    { "awayRankByteOffsets", awayOffsets },
                    { "homeRankByteOffsets", homeOffsets }
                });
            }
            return new Dictionary<string, object>
            {
                { "count", references.Count },
                { "items", result }
            };
        }
    }

    internal static class ModuleInt32Probe
    {
        public static int Run(string outputPath, string targetText)
        {
            try
            {
                string normalized = (targetText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                int target = unchecked((int)UInt32.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<long> references = scanner.FindModuleInt32References(target, 4096, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    foreach (long reference in references)
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "referenceAddress", "0x" + reference.ToString("X", CultureInfo.InvariantCulture) },
                            { "referenceModuleOffset", scanner.ModuleOffset(reference) }
                        });
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "target", "0x" + unchecked((uint)target).ToString("X8", CultureInfo.InvariantCulture) },
                        { "referenceCount", references.Count },
                        { "references", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class ModulePointerProbe
    {
        public static int Run(string outputPath, string targetText)
        {
            try
            {
                string normalized = (targetText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                long target = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<long> references = scanner.FindModuleInt64References(target, 4096, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    foreach (long reference in references)
                    {
                        List<string> qwords = new List<string>();
                        try
                        {
                            byte[] bytes = scanner.ReadBytes(reference - 0x80, 0x180);
                            for (int byteIndex = 0; byteIndex <= bytes.Length - 8; byteIndex += 8)
                                qwords.Add("0x" + BitConverter.ToInt64(bytes, byteIndex).ToString("X", CultureInfo.InvariantCulture));
                        }
                        catch { }
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "referenceAddress", "0x" + reference.ToString("X", CultureInfo.InvariantCulture) },
                            { "referenceModuleOffset", scanner.ModuleOffset(reference) },
                            { "qwordsFromMinus80", qwords }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "target", "0x" + target.ToString("X", CultureInfo.InvariantCulture) },
                        { "referenceCount", references.Count },
                        { "references", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class FieldArrayProbe
    {
        private sealed class FieldRecord
        {
            public long Address;
            public ulong Hash;
            public int Offset;
            public long TypePointer;
            public long NamePointer;
            public long AuxiliaryPointer;
            public long Flags;
            public string Name;
        }

        public static int Run(string outputPath, string recordText)
        {
            try
            {
                string normalized = (recordText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                long selectedAddress = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                long moduleStart = games[0].MainModule.BaseAddress.ToInt64();
                long moduleEnd = moduleStart + games[0].MainModule.ModuleMemorySize;
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    FieldRecord selected = ReadRecord(scanner, selectedAddress, moduleStart, moduleEnd);
                    if (selected == null) throw new InvalidOperationException("The selected address is not a valid field record.");
                    List<FieldRecord> before = new List<FieldRecord>();
                    ulong currentHash = selected.Hash;
                    long address = selected.Address - 0x30;
                    for (int index = 0; index < 4096; index++, address -= 0x30)
                    {
                        FieldRecord record = ReadRecord(scanner, address, moduleStart, moduleEnd);
                        if (record == null || record.Hash > currentHash) break;
                        before.Add(record);
                        currentHash = record.Hash;
                    }
                    before.Reverse();

                    List<FieldRecord> records = new List<FieldRecord>(before);
                    records.Add(selected);
                    currentHash = selected.Hash;
                    address = selected.Address + 0x30;
                    for (int index = 0; index < 4096; index++, address += 0x30)
                    {
                        FieldRecord record = ReadRecord(scanner, address, moduleStart, moduleEnd);
                        if (record == null || record.Hash < currentHash) break;
                        records.Add(record);
                        currentHash = record.Hash;
                    }

                    List<object> formatted = new List<object>();
                    foreach (FieldRecord record in records)
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + record.Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "moduleOffset", scanner.ModuleOffset(record.Address) },
                            { "hash", "0x" + record.Hash.ToString("X16", CultureInfo.InvariantCulture) },
                            { "offset", record.Offset },
                            { "typePointer", "0x" + record.TypePointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "name", record.Name },
                            { "namePointer", "0x" + record.NamePointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "auxiliaryPointer", "0x" + record.AuxiliaryPointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "flags", "0x" + record.Flags.ToString("X", CultureInfo.InvariantCulture) }
                        });
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "selectedAddress", "0x" + selected.Address.ToString("X", CultureInfo.InvariantCulture) },
                        { "arrayStart", "0x" + records[0].Address.ToString("X", CultureInfo.InvariantCulture) },
                        { "arrayEnd", "0x" + (records[records.Count - 1].Address + 0x30).ToString("X", CultureInfo.InvariantCulture) },
                        { "fieldCount", records.Count },
                        { "fields", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static FieldRecord ReadRecord(MemoryScanner scanner, long address, long moduleStart, long moduleEnd)
        {
            try
            {
                byte[] bytes = scanner.ReadBytes(address, 0x30);
                ulong hash = unchecked((ulong)BitConverter.ToInt64(bytes, 0));
                int offset = BitConverter.ToInt32(bytes, 8);
                long typePointer = BitConverter.ToInt64(bytes, 0x10);
                long namePointer = BitConverter.ToInt64(bytes, 0x18);
                long auxiliaryPointer = BitConverter.ToInt64(bytes, 0x20);
                long flags = BitConverter.ToInt64(bytes, 0x28);
                if ((hash & 0xFFUL) != 0 || offset < 0 || offset > 0x10000
                    || typePointer < moduleStart || typePointer >= moduleEnd
                    || namePointer < moduleStart || namePointer >= moduleEnd) return null;
                string name = scanner.ReadAsciiString(namePointer, 128);
                if (String.IsNullOrWhiteSpace(name)) return null;
                return new FieldRecord
                {
                    Address = address,
                    Hash = hash,
                    Offset = offset,
                    TypePointer = typePointer,
                    NamePointer = namePointer,
                    AuxiliaryPointer = auxiliaryPointer,
                    Flags = flags,
                    Name = name
                };
            }
            catch { return null; }
        }
    }

    internal static class TypeInfoNodeProbe
    {
        public static int Run(string outputPath, string targetText)
        {
            try
            {
                string normalized = (targetText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                long target = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                long moduleStart = games[0].MainModule.BaseAddress.ToInt64();
                long moduleEnd = moduleStart + games[0].MainModule.ModuleMemorySize;
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<long, List<long>> found = scanner.FindInt64References(
                        new long[] { target }, 100000, CancellationToken.None);
                    List<object> nodes = new List<object>();
                    foreach (long reference in found[target])
                    {
                        long previous;
                        long next;
                        int idFlags;
                        try
                        {
                            previous = scanner.ReadInt64(reference + 0x08);
                            next = scanner.ReadInt64(reference + 0x10);
                            idFlags = scanner.ReadInt32(reference + 0x18);
                        }
                        catch { continue; }
                        if (!LooksLikeNeighbor(scanner, previous, moduleStart, moduleEnd)
                            || !LooksLikeNeighbor(scanner, next, moduleStart, moduleEnd)) continue;
                        if (previous == 0 && next == 0) continue;
                        nodes.Add(new Dictionary<string, object>
                        {
                            { "nodeAddress", "0x" + reference.ToString("X", CultureInfo.InvariantCulture) },
                            { "nodeModuleOffset", scanner.ModuleOffset(reference) },
                            { "previous", "0x" + previous.ToString("X", CultureInfo.InvariantCulture) },
                            { "next", "0x" + next.ToString("X", CultureInfo.InvariantCulture) },
                            { "idFlags", "0x" + unchecked((uint)idFlags).ToString("X8", CultureInfo.InvariantCulture) }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "target", "0x" + target.ToString("X", CultureInfo.InvariantCulture) },
                        { "referenceCount", found[target].Count },
                        { "nodeCount", nodes.Count },
                        { "nodes", nodes }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static bool LooksLikeNeighbor(MemoryScanner scanner, long address, long moduleStart, long moduleEnd)
        {
            if (address == 0) return true;
            if (address < moduleStart || address >= moduleEnd) return false;
            try
            {
                long data = scanner.ReadInt64(address);
                return data >= moduleStart && data < moduleEnd;
            }
            catch { return false; }
        }
    }

    internal static class PointerProbe
    {
        public static int Run(string outputPath, string targetText)
        {
            try
            {
                string normalized = (targetText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                long target = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<long, List<long>> found = scanner.FindInt64References(
                        new long[] { target }, 4096, CancellationToken.None);
                    List<long> references = found[target];
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < references.Count; index++)
                    {
                        List<string> qwords = new List<string>();
                        try
                        {
                            byte[] bytes = scanner.ReadBytes(references[index] - 0x10, 0x50);
                            for (int byteIndex = 0; byteIndex <= bytes.Length - 8; byteIndex += 8)
                                qwords.Add("0x" + BitConverter.ToInt64(bytes, byteIndex).ToString("X", CultureInfo.InvariantCulture));
                        }
                        catch { }
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "referenceAddress", "0x" + references[index].ToString("X", CultureInfo.InvariantCulture) },
                            { "referenceModuleOffset", scanner.ModuleOffset(references[index]) },
                            { "qwordsFromMinus10", qwords }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "target", "0x" + target.ToString("X", CultureInfo.InvariantCulture) },
                        { "referenceCount", references.Count },
                        { "references", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        public static int RunPrivate(string outputPath, string targetText)
        {
            try
            {
                string normalized = (targetText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                long target = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<long> references = scanner.FindPrivateInt64References(
                        target, 0x100000000L, 4096, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    foreach (long reference in references)
                    {
                        List<string> qwords = new List<string>();
                        try
                        {
                            byte[] bytes = scanner.ReadBytes(reference - 0x18, 0x60);
                            for (int index = 0; index <= bytes.Length - 8; index += 8)
                                qwords.Add("0x" + BitConverter.ToInt64(bytes, index).ToString("X", CultureInfo.InvariantCulture));
                        }
                        catch { }
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "referenceAddress", "0x" + reference.ToString("X", CultureInfo.InvariantCulture) },
                            { "qwordsFromMinus18", qwords }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "target", "0x" + target.ToString("X", CultureInfo.InvariantCulture) },
                        { "referenceCount", references.Count },
                        { "references", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }
    }

    internal static class MultiPointerProbe
    {
        public static int Run(string outputPath, string targetsText)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(targetsText)) throw new ArgumentException("Comma-separated pointer values are required.");
                string[] pieces = targetsText.Split(',');
                long[] targets = new long[pieces.Length];
                for (int index = 0; index < pieces.Length; index++)
                {
                    string normalized = pieces[index].Trim();
                    if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                    targets[index] = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                }
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<long, List<long>> found = scanner.FindInt64References(targets, 100000, CancellationToken.None);
                    List<object> reports = new List<object>();
                    foreach (long target in targets)
                    {
                        List<object> formatted = new List<object>();
                        foreach (long reference in found[target])
                        {
                            formatted.Add(new Dictionary<string, object>
                            {
                                { "referenceAddress", "0x" + reference.ToString("X", CultureInfo.InvariantCulture) },
                                { "referenceModuleOffset", scanner.ModuleOffset(reference) }
                            });
                        }
                        reports.Add(new Dictionary<string, object>
                        {
                            { "target", "0x" + target.ToString("X", CultureInfo.InvariantCulture) },
                            { "referenceCount", found[target].Count },
                            { "references", formatted }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "targets", reports }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                RankByteSnapshotProbe.WriteError(outputPath, error);
                return 1;
            }
        }
    }

    internal static class TypeInfoHeadProbe
    {
        public static int Run(string outputPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<TypeInfoHeadCandidate> candidates = scanner.FindTypeInfoHeadCandidates(CancellationToken.None);
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < candidates.Count; index++)
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "signatureAddress", "0x" + candidates[index].SignatureAddress.ToString("X", CultureInfo.InvariantCulture) },
                            { "signatureModuleOffset", scanner.ModuleOffset(candidates[index].SignatureAddress) },
                            { "globalAddress", "0x" + candidates[index].GlobalAddress.ToString("X", CultureInfo.InvariantCulture) },
                            { "globalModuleOffset", scanner.ModuleOffset(candidates[index].GlobalAddress) },
                            { "headPointer", "0x" + candidates[index].HeadPointer.ToString("X", CultureInfo.InvariantCulture) },
                            { "headModuleOffset", scanner.ModuleOffset(candidates[index].HeadPointer) }
                        });
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "candidateCount", candidates.Count },
                        { "candidates", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class RankVtableProbe
    {
        public static int Run(string outputPath, string moduleOffsetText)
        {
            try
            {
                string normalized = (moduleOffsetText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                long moduleOffset = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                long moduleBase = games[0].MainModule.BaseAddress.ToInt64();
                long targetPointer = moduleBase + moduleOffset;
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<long> objects = scanner.FindPrivateInt64References(
                        targetPointer, 0x100000000L, 100000, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < objects.Count; index++)
                    {
                        int away;
                        int home;
                        try
                        {
                            away = scanner.ReadBytes(objects[index] + 0x10D, 1)[0];
                            home = scanner.ReadBytes(objects[index] + 0xD0, 1)[0];
                        }
                        catch { continue; }
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "baseAddress", "0x" + objects[index].ToString("X", CultureInfo.InvariantCulture) },
                            { "awayRank", away },
                            { "homeRank", home },
                            { "plausible", away <= 25 && home <= 25 }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "moduleBase", "0x" + moduleBase.ToString("X", CultureInfo.InvariantCulture) },
                        { "vtableModuleOffset", "0x" + moduleOffset.ToString("X", CultureInfo.InvariantCulture) },
                        { "vtablePointer", "0x" + targetPointer.ToString("X", CultureInfo.InvariantCulture) },
                        { "objectCount", objects.Count },
                        { "objects", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class RankLayoutProbe
    {
        public static int Run(string outputPath, string awayText, string homeText)
        {
            try
            {
                int away = Int32.Parse(awayText ?? "0", CultureInfo.InvariantCulture);
                int home = Int32.Parse(homeText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    int[][] layouts = new int[][]
                    {
                        new int[] { 0x10D, 0xD0 }
                    };
                    List<object> reports = new List<object>();
                    for (int layoutIndex = 0; layoutIndex < layouts.Length; layoutIndex++)
                    {
                        List<RankFieldLayoutCandidate> candidates = scanner.FindByteFieldPairs(
                            away, home, layouts[layoutIndex][0], layouts[layoutIndex][1], 100000, CancellationToken.None);
                        List<object> formatted = new List<object>();
                        for (int index = 0; index < candidates.Count; index++)
                            formatted.Add(new Dictionary<string, object>
                            {
                                { "baseAddress", "0x" + candidates[index].BaseAddress.ToString("X", CultureInfo.InvariantCulture) },
                                { "firstPointer", "0x" + candidates[index].FirstPointer.ToString("X", CultureInfo.InvariantCulture) },
                                { "firstPointerModuleOffset", scanner.ModuleOffset(candidates[index].FirstPointer) }
                            });
                        reports.Add(new Dictionary<string, object>
                        {
                            { "awayOffset", layouts[layoutIndex][0] },
                            { "homeOffset", layouts[layoutIndex][1] },
                            { "candidateCount", candidates.Count },
                            { "candidates", formatted }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayRank", away },
                        { "homeRank", home },
                        { "layouts", reports }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class FieldReferenceProbe
    {
        public static int Run(string outputPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    string[] names = new string[]
                    {
                        "awayTeamTop25Rank", "homeTeamTop25Rank",
                        "awayDisplayRank", "homeDisplayRank",
                        "awayTeamPollRank", "homeTeamPollRank"
                    };
                    Dictionary<string, List<long>> stringHits = scanner.FindAsciiTextsAll(names, 64, CancellationToken.None);
                    List<long> targets = new List<long>();
                    for (int index = 0; index < names.Length; index++)
                    {
                        List<long> hits = stringHits[names[index]];
                        for (int hitIndex = 0; hitIndex < hits.Count; hitIndex++)
                            if (!targets.Contains(hits[hitIndex])) targets.Add(hits[hitIndex]);
                    }

                    Dictionary<long, List<long>> references = targets.Count == 0
                        ? new Dictionary<long, List<long>>()
                        : scanner.FindInt64References(targets.ToArray(), 256, CancellationToken.None);
                    List<object> fields = new List<object>();
                    for (int index = 0; index < names.Length; index++)
                    {
                        List<long> hits = stringHits[names[index]];
                        List<object> locations = new List<object>();
                        for (int hitIndex = 0; hitIndex < hits.Count; hitIndex++)
                        {
                            List<long> refs;
                            if (!references.TryGetValue(hits[hitIndex], out refs)) refs = new List<long>();
                            List<string> formattedRefs = new List<string>();
                            for (int refIndex = 0; refIndex < refs.Count; refIndex++)
                                formattedRefs.Add("0x" + refs[refIndex].ToString("X", CultureInfo.InvariantCulture));
                            locations.Add(new Dictionary<string, object>
                            {
                                { "stringAddress", "0x" + hits[hitIndex].ToString("X", CultureInfo.InvariantCulture) },
                                { "moduleOffset", scanner.ModuleOffset(hits[hitIndex]) },
                                { "referenceCount", refs.Count },
                                { "references", formattedRefs }
                            });
                        }
                        fields.Add(new Dictionary<string, object>
                        {
                            { "name", names[index] },
                            { "stringCount", hits.Count },
                            { "locations", locations }
                        });
                    }

                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "fields", fields }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class RankTextProbe
    {
        public static int Run(string outputPath, string awayName, string awayRankText, string homeName, string homeRankText)
        {
            try
            {
                int awayRank = Int32.Parse(awayRankText ?? "0", CultureInfo.InvariantCulture);
                int homeRank = Int32.Parse(homeRankText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    long[] awayHits = scanner.FindAsciiText(awayName);
                    long[] homeHits = scanner.FindAsciiText(homeName);
                    Dictionary<string, object> result = new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "awayName", awayName },
                        { "awayRank", awayRank },
                        { "awayHits", Describe(scanner, awayHits, awayRank) },
                        { "homeName", homeName },
                        { "homeRank", homeRank },
                        { "homeHits", Describe(scanner, homeHits, homeRank) }
                    };
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(result));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static object[] Describe(MemoryScanner scanner, long[] nameHits, int rank)
        {
            object[] result = new object[nameHits.Length];
            for (int index = 0; index < nameHits.Length; index++)
            {
                long[] rankHits = scanner.FindInt32Near(nameHits[index], 0x10000, rank);
                string[] formattedRanks = new string[Math.Min(rankHits.Length, 256)];
                for (int rankIndex = 0; rankIndex < formattedRanks.Length; rankIndex++)
                    formattedRanks[rankIndex] = "0x" + rankHits[rankIndex].ToString("X", CultureInfo.InvariantCulture)
                        + " (" + (rankHits[rankIndex] - nameHits[index]).ToString(CultureInfo.InvariantCulture) + ")";
                List<int> rankByteOffsets = new List<int>();
                try
                {
                    byte[] nearbyBytes = scanner.ReadBytes(nameHits[index] - 0x400, 0x800);
                    for (int byteIndex = 0; byteIndex < nearbyBytes.Length; byteIndex++)
                        if (nearbyBytes[byteIndex] == (byte)rank) rankByteOffsets.Add(byteIndex - 0x400);
                }
                catch { }
                result[index] = new Dictionary<string, object>
                {
                    { "nameAddress", "0x" + nameHits[index].ToString("X", CultureInfo.InvariantCulture) },
                    { "nearbyRankCount", rankHits.Length },
                    { "nearbyRanks", formattedRanks },
                    { "nearbyRankByteOffsets", rankByteOffsets }
                };
            }
            return result;
        }
    }

    internal static class TypedInt32Probe
    {
        public static int Run(string outputPath, string expectedText)
        {
            try
            {
                int expected = Int32.Parse(expectedText ?? "0", NumberStyles.Integer, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    long[] candidates = scanner.FindTypedInt32Fields(expected);
                    object[] formatted = new object[candidates.Length];
                    for (int index = 0; index < candidates.Length; index++)
                        formatted[index] = new Dictionary<string, object>
                        {
                            { "address", "0x" + candidates[index].ToString("X", CultureInfo.InvariantCulture) },
                            { "value", expected },
                            { "fieldHash", "0x" + unchecked((uint)scanner.ReadInt32(candidates[index] - 0x10)).ToString("X8", CultureInfo.InvariantCulture) },
                            { "contextPointer", "0x" + scanner.ReadInt64(candidates[index] - 0x08).ToString("X", CultureInfo.InvariantCulture) }
                        };
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "expected", expected },
                        { "candidateCount", candidates.Length },
                        { "candidates", formatted }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class ExactValueProbe
    {
        public static int Run(string outputPath, string expectedText)
        {
            try
            {
                int expected = Int32.Parse(expectedText ?? "0", NumberStyles.Integer, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    scanner.FirstScan(expected, 0, CancellationToken.None, null);
                    List<MemoryCandidate> candidates = scanner.SnapshotCandidates(Int32.MaxValue);
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < candidates.Count; index++)
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + candidates[index].Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "value", candidates[index].LastValue }
                        });
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "expected", expected },
                        { "candidateCount", scanner.CandidateCount },
                        { "candidates", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class AddressFilterProbe
    {
        public static int Run(string inputPath, string outputPath, string expectedText)
        {
            try
            {
                int expected = Int32.Parse(expectedText ?? "2", CultureInfo.InvariantCulture);
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(inputPath));
                IEnumerable candidates = root.ContainsKey("candidates") ? root["candidates"] as IEnumerable : null;
                if (candidates == null) throw new InvalidOperationException("The input report has no candidates.");
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                List<object> kept = new List<object>();
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    foreach (object item in candidates)
                    {
                        Dictionary<string, object> candidate = item as Dictionary<string, object>;
                        if (candidate == null || !candidate.ContainsKey("address")) continue;
                        string addressText = Convert.ToString(candidate["address"], CultureInfo.InvariantCulture);
                        if (addressText.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) addressText = addressText.Substring(2);
                        long address;
                        if (!Int64.TryParse(addressText, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out address)) continue;
                        int value;
                        try { value = scanner.ReadInt32(address); }
                        catch { continue; }
                        if (value != expected) continue;
                        kept.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                            { "value", value }
                        });
                    }
                }
                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "phase", "complete" },
                    { "expected", expected },
                    { "candidateCount", kept.Count },
                    { "candidates", kept.ToArray() }
                }));
                return 0;
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "phase", "error" },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class RankTextFilterProbe
    {
        public static int Run(string inputPath, string outputPath, string side, string expectedText)
        {
            try
            {
                int expected = Int32.Parse(expectedText ?? "0", CultureInfo.InvariantCulture);
                string hitsKey = String.Equals(side, "home", StringComparison.OrdinalIgnoreCase) ? "homeHits" : "awayHits";
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(inputPath));
                IEnumerable hits = root.ContainsKey(hitsKey) ? root[hitsKey] as IEnumerable : null;
                if (hits == null) throw new InvalidOperationException("The input report has no " + hitsKey + ".");

                HashSet<long> addresses = new HashSet<long>();
                foreach (object item in hits)
                {
                    Dictionary<string, object> hit = item as Dictionary<string, object>;
                    IEnumerable nearby = hit != null && hit.ContainsKey("nearbyRanks") ? hit["nearbyRanks"] as IEnumerable : null;
                    if (nearby == null) continue;
                    foreach (object nearbyItem in nearby)
                    {
                        string value = Convert.ToString(nearbyItem, CultureInfo.InvariantCulture);
                        int end = value.IndexOf(' ');
                        string addressText = end > 0 ? value.Substring(0, end) : value;
                        if (addressText.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) addressText = addressText.Substring(2);
                        long address;
                        if (Int64.TryParse(addressText, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out address))
                            addresses.Add(address);
                    }
                }

                List<object> kept = new List<object>();
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    foreach (long address in addresses)
                    {
                        int value;
                        try { value = scanner.ReadInt32(address); }
                        catch { continue; }
                        if (value != expected) continue;
                        kept.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                            { "value", value }
                        });
                    }
                }

                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "phase", "complete" },
                    { "sourceSide", hitsKey },
                    { "sourceCandidateCount", addresses.Count },
                    { "expected", expected },
                    { "candidateCount", kept.Count },
                    { "candidates", kept.ToArray() }
                }));
                return 0;
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "phase", "error" },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class NearPairFilterProbe
    {
        private sealed class Pair
        {
            public long DownAddress;
            public long DistanceAddress;
        }

        public static int Run(string inputPath, string outputPath, string fromDownText,
            string fromDistanceText, string expectedDownText, string expectedDistanceText)
        {
            try
            {
                int fromDown = Int32.Parse(fromDownText ?? "2", CultureInfo.InvariantCulture);
                int fromDistance = Int32.Parse(fromDistanceText ?? "4", CultureInfo.InvariantCulture);
                int expectedDown = Int32.Parse(expectedDownText ?? fromDownText ?? "2", CultureInfo.InvariantCulture);
                int expectedDistance = Int32.Parse(expectedDistanceText ?? fromDistanceText ?? "4", CultureInfo.InvariantCulture);
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(inputPath));
                List<Pair> pairs = new List<Pair>();
                HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                IEnumerable existingCandidates = root.ContainsKey("candidates") ? root["candidates"] as IEnumerable : null;
                if (existingCandidates != null)
                {
                    foreach (object item in existingCandidates)
                    {
                        Dictionary<string, object> candidate = item as Dictionary<string, object>;
                        if (candidate == null || !candidate.ContainsKey("downAddress") || !candidate.ContainsKey("distanceAddress")) continue;
                        long downAddress;
                        long distanceAddress;
                        if (!TryParseAddress(Convert.ToString(candidate["downAddress"], CultureInfo.InvariantCulture), out downAddress)
                            || !TryParseAddress(Convert.ToString(candidate["distanceAddress"], CultureInfo.InvariantCulture), out distanceAddress)) continue;
                        AddPair(pairs, seen, downAddress, distanceAddress);
                    }
                }
                else
                {
                    IEnumerable clusters = root.ContainsKey("clusters") ? root["clusters"] as IEnumerable : null;
                    if (clusters == null) throw new InvalidOperationException("The input report has no clusters or pair candidates.");
                    string downKey = fromDown.ToString(CultureInfo.InvariantCulture);
                    string distanceKey = fromDistance.ToString(CultureInfo.InvariantCulture);
                    foreach (object item in clusters)
                    {
                        Dictionary<string, object> cluster = item as Dictionary<string, object>;
                        Dictionary<string, object> matches = cluster != null && cluster.ContainsKey("matches")
                            ? cluster["matches"] as Dictionary<string, object> : null;
                        if (matches == null || !matches.ContainsKey(downKey) || !matches.ContainsKey(distanceKey)) continue;
                        List<long> downs = AddressList(matches[downKey] as IEnumerable);
                        List<long> distances = AddressList(matches[distanceKey] as IEnumerable);
                        for (int downIndex = 0; downIndex < downs.Count; downIndex++)
                            for (int distanceIndex = 0; distanceIndex < distances.Count; distanceIndex++)
                                if (downs[downIndex] != distances[distanceIndex]
                                    && Math.Abs(distances[distanceIndex] - downs[downIndex]) <= 0x400)
                                    AddPair(pairs, seen, downs[downIndex], distances[distanceIndex]);
                    }
                }

                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                List<object> kept = new List<object>();
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    for (int i = 0; i < pairs.Count; i++)
                    {
                        int down;
                        int distance;
                        try
                        {
                            down = scanner.ReadInt32(pairs[i].DownAddress);
                            distance = scanner.ReadInt32(pairs[i].DistanceAddress);
                        }
                        catch { continue; }
                        if (down != expectedDown || distance != expectedDistance) continue;
                        kept.Add(new Dictionary<string, object>
                        {
                            { "downAddress", Hex(pairs[i].DownAddress) },
                            { "distanceAddress", Hex(pairs[i].DistanceAddress) },
                            { "relativeOffset", pairs[i].DistanceAddress - pairs[i].DownAddress },
                            { "down", down },
                            { "distance", distance }
                        });
                    }
                }
                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "phase", "complete" },
                    { "sourcePairCount", pairs.Count },
                    { "expectedDown", expectedDown },
                    { "expectedDistance", expectedDistance },
                    { "candidateCount", kept.Count },
                    { "candidates", kept.ToArray() }
                }));
                return 0;
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "phase", "error" },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static void AddPair(List<Pair> pairs, HashSet<string> seen, long downAddress, long distanceAddress)
        {
            string key = downAddress.ToString("X", CultureInfo.InvariantCulture) + ":" + distanceAddress.ToString("X", CultureInfo.InvariantCulture);
            if (!seen.Add(key)) return;
            pairs.Add(new Pair { DownAddress = downAddress, DistanceAddress = distanceAddress });
        }

        private static List<long> AddressList(IEnumerable values)
        {
            List<long> result = new List<long>();
            if (values == null) return result;
            foreach (object value in values)
            {
                long address;
                if (TryParseAddress(Convert.ToString(value, CultureInfo.InvariantCulture), out address)) result.Add(address);
            }
            return result;
        }

        private static bool TryParseAddress(string value, out long address)
        {
            address = 0;
            if (String.IsNullOrWhiteSpace(value)) return false;
            string text = value.Trim();
            if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) text = text.Substring(2);
            return Int64.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out address);
        }

        private static string Hex(long address)
        {
            return "0x" + address.ToString("X", CultureInfo.InvariantCulture);
        }
    }

    internal static class PairFilterProbe
    {
        public static int Run(string inputPath, string outputPath, string fromDownText,
            string fromDistanceText, string expectedDownText, string expectedDistanceText)
        {
            try
            {
                int fromDown = Int32.Parse(fromDownText ?? "2", CultureInfo.InvariantCulture);
                int fromDistance = Int32.Parse(fromDistanceText ?? "4", CultureInfo.InvariantCulture);
                int expectedDown = Int32.Parse(expectedDownText ?? fromDownText ?? "2", CultureInfo.InvariantCulture);
                int expectedDistance = Int32.Parse(expectedDistanceText ?? fromDistanceText ?? "4", CultureInfo.InvariantCulture);
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                Dictionary<string, object> root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(inputPath));
                List<long> pairStarts = new List<long>();
                HashSet<long> seen = new HashSet<long>();

                IEnumerable existingCandidates = root.ContainsKey("candidates") ? root["candidates"] as IEnumerable : null;
                if (existingCandidates != null)
                {
                    foreach (object item in existingCandidates)
                    {
                        Dictionary<string, object> candidate = item as Dictionary<string, object>;
                        if (candidate == null || !candidate.ContainsKey("downAddress")) continue;
                        long address;
                        if (TryParseAddress(Convert.ToString(candidate["downAddress"], CultureInfo.InvariantCulture), out address)
                            && seen.Add(address)) pairStarts.Add(address);
                    }
                }
                else
                {
                    IEnumerable clusters = root.ContainsKey("clusters") ? root["clusters"] as IEnumerable : null;
                    if (clusters == null) throw new InvalidOperationException("The input report has no clusters or pair candidates.");
                    string downKey = fromDown.ToString(CultureInfo.InvariantCulture);
                    string distanceKey = fromDistance.ToString(CultureInfo.InvariantCulture);
                    foreach (object item in clusters)
                    {
                        Dictionary<string, object> cluster = item as Dictionary<string, object>;
                        Dictionary<string, object> matches = cluster != null && cluster.ContainsKey("matches")
                            ? cluster["matches"] as Dictionary<string, object> : null;
                        if (matches == null || !matches.ContainsKey(downKey) || !matches.ContainsKey(distanceKey)) continue;
                        IEnumerable downs = matches[downKey] as IEnumerable;
                        IEnumerable distances = matches[distanceKey] as IEnumerable;
                        if (downs == null || distances == null) continue;
                        HashSet<long> distanceAddresses = new HashSet<long>();
                        foreach (object value in distances)
                        {
                            long address;
                            if (TryParseAddress(Convert.ToString(value, CultureInfo.InvariantCulture), out address)) distanceAddresses.Add(address);
                        }
                        foreach (object value in downs)
                        {
                            long address;
                            if (TryParseAddress(Convert.ToString(value, CultureInfo.InvariantCulture), out address)
                                && distanceAddresses.Contains(address + 0x20) && seen.Add(address)) pairStarts.Add(address);
                        }
                    }
                }

                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                List<object> kept = new List<object>();
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    for (int i = 0; i < pairStarts.Count; i++)
                    {
                        long downAddress = pairStarts[i];
                        int down;
                        int distance;
                        try
                        {
                            down = scanner.ReadInt32(downAddress);
                            distance = scanner.ReadInt32(downAddress + 0x20);
                        }
                        catch { continue; }
                        if (down != expectedDown || distance != expectedDistance) continue;
                        kept.Add(new Dictionary<string, object>
                        {
                            { "downAddress", "0x" + downAddress.ToString("X", CultureInfo.InvariantCulture) },
                            { "distanceAddress", "0x" + (downAddress + 0x20).ToString("X", CultureInfo.InvariantCulture) },
                            { "down", down },
                            { "distance", distance }
                        });
                    }
                }
                File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                {
                    { "phase", "complete" },
                    { "expectedDown", expectedDown },
                    { "expectedDistance", expectedDistance },
                    { "candidateCount", kept.Count },
                    { "candidates", kept.ToArray() }
                }));
                return 0;
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "phase", "error" },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static bool TryParseAddress(string value, out long address)
        {
            address = 0;
            if (String.IsNullOrWhiteSpace(value)) return false;
            string text = value.Trim();
            if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) text = text.Substring(2);
            return Int64.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out address);
        }
    }

    internal static class ChangeProbe
    {
        public static int Run(string outputPath, string triggerPath, string fromText)
        {
            try
            {
                int from = Int32.Parse(fromText ?? "2", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    WriteStatus(outputPath, "scanning", games[0].Id, from, 0, null);
                    scanner.FirstScanBelow(from, 0, 0x100000000L, CancellationToken.None);
                    WriteStatus(outputPath, "ready", games[0].Id, from, scanner.CandidateCount, null);
                    while (String.IsNullOrWhiteSpace(triggerPath) || !File.Exists(triggerPath))
                    {
                        if (games[0].HasExited) throw new InvalidOperationException("CollegeFB27.exe closed before the change.");
                        Thread.Sleep(100);
                    }
                    scanner.NextScan(ScanComparison.Changed, 0, 0, CancellationToken.None, null);
                    List<MemoryCandidate> candidates = scanner.SnapshotCandidates(200000);
                    List<object> formatted = new List<object>();
                    for (int i = 0; i < candidates.Count; i++)
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + candidates[i].Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "value", candidates[i].LastValue }
                        });
                    WriteStatus(outputPath, "complete", games[0].Id, from, scanner.CandidateCount, formatted.ToArray());
                    return 0;
                }
            }
            catch (Exception error)
            {
                WriteStatus(outputPath, "error", 0, 0, 0, null, error.ToString());
                return 1;
            }
        }

        private static void WriteStatus(string path, string phase, int processId, int from,
            int count, object candidates, string error = null)
        {
            if (String.IsNullOrWhiteSpace(path)) return;
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
            {
                { "phase", phase },
                { "updatedAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "processId", processId },
                { "from", from },
                { "candidateCount", count },
                { "candidates", candidates },
                { "error", error }
            }));
        }
    }

    internal static class TransitionProbe
    {
        public static int Run(string outputPath, string triggerPath, string fromText, string toText)
        {
            try
            {
                int from = Int32.Parse(fromText ?? "3", CultureInfo.InvariantCulture);
                int to = Int32.Parse(toText ?? "2", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    WriteTransitionStatus(outputPath, "scanning", games[0].Id, from, to, 0, null);
                    scanner.FirstScanBelow(from, 0, 0x100000000L, CancellationToken.None, 16, 4, 8);
                    WriteTransitionStatus(outputPath, "ready", games[0].Id, from, to, scanner.CandidateCount, null);
                    while (String.IsNullOrWhiteSpace(triggerPath) || !File.Exists(triggerPath))
                    {
                        if (games[0].HasExited) throw new InvalidOperationException("CollegeFB27.exe closed before the transition.");
                        Thread.Sleep(100);
                    }
                    scanner.NextScan(ScanComparison.Exact, to, 0, CancellationToken.None, null);
                    List<MemoryCandidate> candidates = scanner.SnapshotCandidates(100000);
                    List<object> formatted = new List<object>();
                    for (int i = 0; i < candidates.Count; i++)
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "address", "0x" + candidates[i].Address.ToString("X", CultureInfo.InvariantCulture) },
                            { "value", candidates[i].LastValue }
                        });
                    WriteTransitionStatus(outputPath, "complete", games[0].Id, from, to, scanner.CandidateCount, formatted.ToArray());
                    return 0;
                }
            }
            catch (Exception error)
            {
                WriteTransitionStatus(outputPath, "error", 0, 0, 0, 0, null, error.ToString());
                return 1;
            }
        }

        private static void WriteTransitionStatus(string path, string phase, int processId, int from, int to, int count, object candidates, string error = null)
        {
            if (String.IsNullOrWhiteSpace(path)) return;
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = Int32.MaxValue;
            File.WriteAllText(path, serializer.Serialize(new Dictionary<string, object>
            {
                { "phase", phase },
                { "updatedAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "processId", processId },
                { "from", from },
                { "to", to },
                { "candidateCount", count },
                { "candidates", candidates },
                { "error", error }
            }));
        }
    }

    internal static class MemoryDumpProbe
    {
        public static int Run(string outputPath, string addressText, string lengthText)
        {
            try
            {
                string normalized = (addressText ?? String.Empty).Trim();
                if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) normalized = normalized.Substring(2);
                long address = Int64.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                int length = Int32.Parse(lengthText ?? "4096", NumberStyles.Integer, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<string, object> result = new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                        { "length", length },
                        { "bytes", Convert.ToBase64String(scanner.ReadBytes(address, length)) }
                    };
                    if (!String.IsNullOrWhiteSpace(outputPath))
                        File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(result));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class ClusterProbe
    {
        public static int Run(string outputPath, string valuesText)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(valuesText)) throw new ArgumentException("Comma-separated values are required.");
                string[] pieces = valuesText.Split(',');
                int[] values = new int[pieces.Length];
                for (int i = 0; i < pieces.Length; i++)
                    values[i] = Int32.Parse(pieces[i], NumberStyles.Integer, CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<ManualValueCluster> clusters = scanner.FindInt32Clusters(values[0], values, 0x10000, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    for (int clusterIndex = 0; clusterIndex < clusters.Count; clusterIndex++)
                    {
                        ManualValueCluster cluster = clusters[clusterIndex];
                        Dictionary<string, object> matches = new Dictionary<string, object>();
                        foreach (KeyValuePair<int, List<long>> item in cluster.Matches)
                        {
                            List<string> addresses = new List<string>();
                            for (int i = 0; i < item.Value.Count; i++)
                                addresses.Add("0x" + item.Value[i].ToString("X", CultureInfo.InvariantCulture));
                            matches[item.Key.ToString(CultureInfo.InvariantCulture)] = addresses.ToArray();
                        }
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "anchorAddress", "0x" + cluster.AnchorAddress.ToString("X", CultureInfo.InvariantCulture) },
                            { "matches", matches }
                        });
                    }
                    Dictionary<string, object> result = new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "clusterCount", clusters.Count },
                        { "clusters", formatted.ToArray() }
                    };
                    if (!String.IsNullOrWhiteSpace(outputPath))
                        File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(result));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class RankOrderProbe
    {
        public static int Run(string outputPath, string mappingsText)
        {
            try
            {
                Dictionary<int, int> mappings = new Dictionary<int, int>();
                foreach (string piece in (mappingsText ?? String.Empty).Split(','))
                {
                    string[] pair = piece.Split(':');
                    if (pair.Length != 2) continue;
                    int rank;
                    int teamId;
                    if (Int32.TryParse(pair[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out rank)
                        && Int32.TryParse(pair[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out teamId))
                        mappings[rank] = teamId;
                }
                if (mappings.Count < 3) throw new ArgumentException("At least three rank:team mappings are required.");
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<RankOrderCandidate> candidates = scanner.FindRankOrderTables(mappings, 0x400, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < candidates.Count; index++)
                    {
                        RankOrderCandidate candidate = candidates[index];
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "rankOneTeamField", "0x" + candidate.RankOneTeamField.ToString("X", CultureInfo.InvariantCulture) },
                            { "stride", candidate.Stride },
                            { "matched", candidate.Matched },
                            { "requested", mappings.Count }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "mappingCount", mappings.Count },
                        { "candidateCount", candidates.Count },
                        { "candidates", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class RankPairOffsetProbe
    {
        public static int Run(string outputPath, string awayText, string homeText)
        {
            try
            {
                int away = Int32.Parse(awayText ?? "0", CultureInfo.InvariantCulture);
                int home = Int32.Parse(homeText ?? "0", CultureInfo.InvariantCulture);
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    List<RankPairOffsetCandidate> offsets = scanner.FindInt32PairOffsets(away, home, 0x1000, CancellationToken.None);
                    List<object> formatted = new List<object>();
                    for (int index = 0; index < offsets.Count; index++)
                    {
                        RankPairOffsetCandidate item = offsets[index];
                        string[] samples = new string[item.AwayAddresses.Count];
                        for (int sample = 0; sample < samples.Length; sample++)
                            samples[sample] = "0x" + item.AwayAddresses[sample].ToString("X", CultureInfo.InvariantCulture);
                        formatted.Add(new Dictionary<string, object>
                        {
                            { "delta", item.Delta },
                            { "count", item.Count },
                            { "awaySamples", samples }
                        });
                    }
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = Int32.MaxValue;
                    File.WriteAllText(outputPath, serializer.Serialize(new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "away", away },
                        { "home", home },
                        { "offsetCount", offsets.Count },
                        { "offsets", formatted.ToArray() }
                    }));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }
    }

    internal static class BlockProbe
    {
        public static int Run(string outputPath, string addressText)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                long address = ParseAddress(addressText);
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    Dictionary<string, object> result = new Dictionary<string, object>
                    {
                        { "passed", true },
                        { "processId", games[0].Id },
                        { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                        { "selfPointer", "0x" + scanner.ReadInt64(address + 0xE0).ToString("X", CultureInfo.InvariantCulture) },
                        { "quarter", scanner.ReadInt32(address + 0xEC) },
                        { "clock", scanner.ReadInt32(address + 0xF4) },
                        { "playClock", scanner.ReadInt32(address + 0xF8) },
                        { "homeScore", scanner.ReadInt32(address + 0xFC) },
                        { "awayScore", scanner.ReadInt32(address + 0x100) },
                        { "possession", scanner.ReadInt32(address + 0x108) },
                        { "down", scanner.ReadInt32(address + 0x10C) },
                        { "distance", scanner.ReadInt32(address + 0x110) },
                        { "nearby19", FindNearbyInt32(scanner, address, 19) },
                        { "nearby15", FindNearbyInt32(scanner, address, 15) },
                        { "bytes", Convert.ToBase64String(scanner.ReadBytes(address, 0x114)) }
                    };
                    if (!String.IsNullOrWhiteSpace(outputPath))
                        File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(result));
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static object[] FindNearbyInt32(MemoryScanner scanner, long address, int expected)
        {
            const int radius = 0x10000;
            long[] addresses = scanner.FindInt32Near(address, radius, expected);
            List<object> matches = new List<object>();
            for (int index = 0; index < addresses.Length; index++)
            {
                long matchAddress = addresses[index];
                matches.Add(new Dictionary<string, object>
                {
                    { "address", "0x" + matchAddress.ToString("X", CultureInfo.InvariantCulture) },
                    { "relativeOffset", matchAddress - address }
                });
            }
            return matches.ToArray();
        }

        private static long ParseAddress(string value)
        {
            if (String.IsNullOrWhiteSpace(value)) throw new ArgumentException("A block address is required.");
            string text = value.Trim();
            if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) text = text.Substring(2);
            long result;
            if (!Int64.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out result))
                throw new ArgumentException("The block address is invalid.");
            return result;
        }
    }

    internal static class RamService
    {
        public static int Run(string screenJsonPath, string statusPath, int parentProcessId)
        {
            if (String.IsNullOrWhiteSpace(screenJsonPath)) return 2;
            using (MemoryScanner scanner = new MemoryScanner())
            {
                RamLiveExporter exporter = new RamLiveExporter(
                    scanner,
                    Path.Combine(
                        String.IsNullOrWhiteSpace(Path.GetDirectoryName(screenJsonPath))
                            ? AppDomain.CurrentDomain.BaseDirectory
                            : Path.GetDirectoryName(screenJsonPath),
                        "ram-live-profile-cache.json"));
                int attachedProcessId = 0;
                string gameExeVersion = null;
                long gameModuleSize = 0;
                DateTime nextAttachUtc = DateTime.MinValue;
                DateTime nextStatusUtc = DateTime.MinValue;
                string status = "RAM service: starting";

                while (ParentIsRunning(parentProcessId))
                {
                    try
                    {
                        if (scanner.Process == null || scanner.Process.HasExited)
                        {
                            attachedProcessId = 0;
                            if (DateTime.UtcNow >= nextAttachUtc)
                            {
                                nextAttachUtc = DateTime.UtcNow.AddSeconds(2);
                                Process[] games = Process.GetProcessesByName("CollegeFB27");
                                if (games.Length > 0)
                                {
                                    scanner.Attach(games[0]);
                                    exporter.Reset();
                                    attachedProcessId = games[0].Id;
                                    // The exe version pins which game build these
                                    // reads were measured against. MainModule can
                                    // throw on a protected process; version then
                                    // stays null instead of losing the attach.
                                    gameExeVersion = null;
                                    gameModuleSize = 0;
                                    try
                                    {
                                        ProcessModule module = games[0].MainModule;
                                        gameModuleSize = module.ModuleMemorySize;
                                        gameExeVersion = module.FileVersionInfo == null
                                            ? null : module.FileVersionInfo.FileVersion;
                                    }
                                    catch { }
                                    status = "RAM service: attached read-only to CollegeFB27.exe";
                                }
                                else status = "RAM service: waiting for CollegeFB27.exe";
                            }
                        }

                        if (scanner.Process != null && !scanner.Process.HasExited)
                        {
                            attachedProcessId = scanner.Process.Id;
                            // Production overlay data is RAM-only. The screen
                            // JSON path is used solely to locate the export
                            // folder and is never parsed as a fallback source.
                            status = exporter.Refresh(null, screenJsonPath);
                        }
                    }
                    catch (Exception error)
                    {
                        status = "RAM service error: " + error.Message;
                    }

                    if (DateTime.UtcNow >= nextStatusUtc)
                    {
                        nextStatusUtc = DateTime.UtcNow.AddMilliseconds(500);
                        WriteStatus(statusPath, parentProcessId, attachedProcessId, status,
                            gameExeVersion, gameModuleSize);
                    }
                    Thread.Sleep(100);
                }
                WriteStatus(statusPath, parentProcessId, attachedProcessId,
                    "RAM service: parent scorebug app closed", gameExeVersion, gameModuleSize);
            }
            return 0;
        }

        private static bool TryReadScreen(string path, out LiveScoreboard value)
        {
            value = null;
            if (!File.Exists(path)) return false;
            try
            {
                using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (StreamReader reader = new StreamReader(stream)) value = LiveScoreboard.Parse(reader.ReadToEnd());
                return true;
            }
            catch { return false; }
        }

        private static bool ParentIsRunning(int processId)
        {
            if (processId <= 0) return true;
            try
            {
                Process parent = Process.GetProcessById(processId);
                return !parent.HasExited;
            }
            catch { return false; }
        }

        private static void WriteStatus(string path, int parentProcessId, int gameProcessId, string message,
            string gameExeVersion = null, long gameModuleSize = 0)
        {
            if (String.IsNullOrWhiteSpace(path)) return;
            try
            {
                string directory = Path.GetDirectoryName(path);
                if (!String.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
                string json = new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                {
                    { "running", true },
                    { "updatedAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "parentProcessId", parentProcessId },
                    { "gameProcessId", gameProcessId == 0 ? (object)null : gameProcessId },
                    { "gameExeVersion", gameProcessId == 0 ? null : gameExeVersion },
                    { "gameModuleSize", gameProcessId == 0 || gameModuleSize <= 0 ? (object)null : gameModuleSize },
                    { "message", message }
                });
                string temporary = path + ".tmp";
                File.WriteAllText(temporary, json);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            catch { }
        }
    }

    internal static class LocatorProbe
    {
        public static int Run(string outputPath, string screenJsonPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                LiveScoreboard screen = null;
                if (!String.IsNullOrWhiteSpace(screenJsonPath) && File.Exists(screenJsonPath))
                    screen = LiveScoreboard.Parse(File.ReadAllText(screenJsonPath));
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    RamAutoDiscovery value = scanner.DiscoverRamLayout(screen);
                    Dictionary<string, object> result = new Dictionary<string, object>
                    {
                        { "passed", value.HasCoreScoreboard },
                        { "processId", games[0].Id },
                        { "scoreboardBlock", Hex(value.ScoreboardBlock) },
                        { "verificationScoreboardBlock", Hex(value.VerificationScoreboardBlock) },
                        { "tentativeWideScoreboardBlock", Hex(value.TentativeWideScoreboardBlock) },
                        { "scoreboardCandidates", value.ScoreboardCandidateCount },
                        { "scoreboardCandidateDetails", CandidateDetails(value.ScoreboardCandidates) },
                        { "homeTimeouts", HexList(value.HomeTimeoutAddresses) },
                        { "awayTimeouts", HexList(value.AwayTimeoutAddresses) },
                        { "timeoutCloneHomePossessions", HexList(value.TimeoutCloneHomePossessionAddresses) },
                        { "possessionBind", value.PossessionDiagnostic },
                        { "livePossessions", HexList(value.LivePossessionAddresses) },
                        { "liveDowns", HexList(value.LiveDownAddresses) },
                        { "liveDistances", HexList(value.LiveDistanceAddresses) },
                        { "timeoutCandidateDetails", TimeoutCandidateDetails(value.TimeoutCandidates) },
                        { "teamCatalogBase", Hex(value.TeamCatalogBase) },
                        { "teamCatalogLength", value.TeamCatalogLength },
                        { "homeTeamName", value.HomeTeamName },
                        { "homeTeamMarkerAddress", Hex(value.HomeTeamMarkerAddress) },
                        { "homeTeamNameAddresses", HexList(value.HomeTeamNameAddresses) },
                        { "awayTeamName", value.AwayTeamName },
                        { "awayTeamNameAddresses", HexList(value.AwayTeamNameAddresses) },
                        { "awayTeamAssetPoolBase", Hex(value.AwayTeamAssetPoolBase) },
                        { "awayTeamAssetPoolLength", value.AwayTeamAssetPoolLength },
                        { "teamRoleAllocationBase", Hex(value.TeamRoleAllocationBase) },
                        { "awayTeamRoleLabelAddress", Hex(value.AwayTeamRoleLabelAddress) },
                        { "homeTeamRoleLabelAddress", Hex(value.HomeTeamRoleLabelAddress) },
                        { "awayTeamRoleReferenceAddress", Hex(value.AwayTeamRoleReferenceAddress) },
                        { "homeTeamRoleReferenceAddress", Hex(value.HomeTeamRoleReferenceAddress) },
                        { "awayTeamRoleDescriptorAddress", Hex(value.AwayTeamRoleDescriptorAddress) },
                        { "homeTeamRoleDescriptorAddress", Hex(value.HomeTeamRoleDescriptorAddress) },
                        { "awayTeamRoleVectorAddress", Hex(value.AwayTeamRoleVectorAddress) },
                        { "homeTeamRoleVectorAddress", Hex(value.HomeTeamRoleVectorAddress) },
                        { "teamRoleEvidenceAmbiguous", value.TeamRoleEvidenceAmbiguous },
                        { "teamRoleBindingRevalidated", scanner.LabeledTeamRoleBindingMatches(value) },
                        { "teamNameCandidateCounts", value.TeamNameCandidateCounts },
                        { "activeTraditionSlugs", value.ActiveTraditionSlugs.ToArray() },
                        { "teamRoleDiagnostics", value.TeamRoleDiagnostics.ToArray() },
                        { "regionsScanned", value.RegionsScanned },
                        { "bytesScanned", value.BytesScanned }
                    };
                    if (!String.IsNullOrWhiteSpace(outputPath))
                        File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(result));
                    return value.HasCoreScoreboard ? 0 : 2;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static string Hex(long value)
        {
            return value == 0 ? null : "0x" + value.ToString("X", CultureInfo.InvariantCulture);
        }

        private static string[] HexList(List<long> values)
        {
            string[] result = new string[values.Count];
            for (int i = 0; i < values.Count; i++) result[i] = Hex(values[i]);
            return result;
        }

        private static object[] CandidateDetails(List<RamScoreboardSnapshot> values)
        {
            object[] result = new object[values.Count];
            for (int i = 0; i < values.Count; i++)
            {
                RamScoreboardSnapshot value = values[i];
                result[i] = new Dictionary<string, object>
                {
                    { "address", Hex(value.Address) },
                    { "score", value.Score },
                    { "quarter", value.Quarter },
                    { "clock", value.Clock },
                    { "playClock", value.PlayClock },
                    { "homeScore", value.HomeScore },
                    { "awayScore", value.AwayScore },
                    { "possession", value.Possession },
                    { "down", value.Down },
                    { "distance", value.Distance },
                    { "usesWideLayout", value.UsesWideLayout },
                    { "liveChangeObserved", value.LiveChangeObserved }
                };
            }
            return result;
        }

        private static object[] TimeoutCandidateDetails(List<RamTimeoutSnapshot> values)
        {
            object[] result = new object[values.Count];
            for (int i = 0; i < values.Count; i++)
            {
                RamTimeoutSnapshot value = values[i];
                result[i] = new Dictionary<string, object>
                {
                    { "address", Hex(value.Address) },
                    { "similarity", value.Similarity },
                    { "home", value.Home },
                    { "away", value.Away }
                };
            }
            return result;
        }
    }

    internal static class RankProbe
    {
        public static int Run(string outputPath, string screenJsonPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                LiveScoreboard screen = null;
                if (!String.IsNullOrWhiteSpace(screenJsonPath) && File.Exists(screenJsonPath))
                    screen = LiveScoreboard.Parse(File.ReadAllText(screenJsonPath));
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    RamAutoDiscovery discovery = scanner.DiscoverRamLayout(screen);
                    Dictionary<string, object> result = new Dictionary<string, object>
                    {
                        { "passed", discovery.HasCoreScoreboard },
                        { "processId", games[0].Id },
                        { "awayTeamName", discovery.AwayTeamName },
                        { "homeTeamName", discovery.HomeTeamName },
                        { "expectedAwayRank", 0 },
                        { "expectedHomeRank", 2 },
                        { "scoreboardRankTwos", FindValue(scanner, discovery.ScoreboardBlock, 0x2000, 2, discovery.ScoreboardBlock) },
                        { "homeMarkerRankTwos", FindValue(scanner, discovery.HomeTeamMarkerAddress - 0x10000, 0x20000, 2, discovery.HomeTeamMarkerAddress) },
                        { "homeNameRankTwos", FindAroundAddresses(scanner, discovery.HomeTeamNameAddresses, 2) },
                        { "awayNameRankTwos", FindAroundAddresses(scanner, discovery.AwayTeamNameAddresses, 2) },
                        { "homeNameSmallValues", FindSmallValuesAroundAddresses(scanner, discovery.HomeTeamNameAddresses) },
                        { "awayNameSmallValues", FindSmallValuesAroundAddresses(scanner, discovery.AwayTeamNameAddresses) }
                    };
                    if (!String.IsNullOrWhiteSpace(outputPath))
                        File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(result));
                    return discovery.HasCoreScoreboard ? 0 : 2;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                    File.WriteAllText(outputPath, new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    {
                        { "passed", false },
                        { "error", error.ToString() }
                    }));
                return 1;
            }
        }

        private static object[] FindAroundAddresses(MemoryScanner scanner, List<long> addresses, int expected)
        {
            List<object> result = new List<object>();
            for (int i = 0; i < addresses.Count; i++)
            {
                object[] hits = FindValue(scanner, addresses[i] - 0x10000, 0x20000, expected, addresses[i]);
                for (int j = 0; j < hits.Length && result.Count < 160; j++) result.Add(hits[j]);
            }
            return result.ToArray();
        }

        private static object[] FindSmallValuesAroundAddresses(MemoryScanner scanner, List<long> addresses)
        {
            List<object> result = new List<object>();
            for (int addressIndex = 0; addressIndex < addresses.Count; addressIndex++)
            {
                long origin = addresses[addressIndex];
                long start = origin - 0x200;
                byte[] bytes;
                try { bytes = scanner.ReadBytes(start, 0x400); }
                catch { continue; }
                for (int offset = 0; offset <= bytes.Length - 4; offset += 4)
                {
                    int value = BitConverter.ToInt32(bytes, offset);
                    if (value < 1 || value > 25) continue;
                    result.Add(Hit(start + offset, start + offset - origin, value));
                }
            }
            return result.ToArray();
        }

        private static object[] FindValue(MemoryScanner scanner, long start, int length, int expected, long origin)
        {
            List<Dictionary<string, object>> hits = new List<Dictionary<string, object>>();
            if (start <= 0) return hits.ToArray();
            byte[] bytes;
            try { bytes = scanner.ReadBytes(start, length); }
            catch { return hits.ToArray(); }
            int alignment = (int)((4 - (start & 3)) & 3);
            for (int offset = alignment; offset <= bytes.Length - 4; offset += 4)
                if (BitConverter.ToInt32(bytes, offset) == expected)
                    hits.Add(Hit(start + offset, start + offset - origin, expected));
            hits.Sort(delegate(Dictionary<string, object> left, Dictionary<string, object> right)
            {
                long leftDelta = Math.Abs(Convert.ToInt64(left["relativeOffset"], CultureInfo.InvariantCulture));
                long rightDelta = Math.Abs(Convert.ToInt64(right["relativeOffset"], CultureInfo.InvariantCulture));
                return leftDelta.CompareTo(rightDelta);
            });
            if (hits.Count > 80) hits.RemoveRange(80, hits.Count - 80);
            return hits.ToArray();
        }

        private static Dictionary<string, object> Hit(long address, long relativeOffset, int value)
        {
            return new Dictionary<string, object>
            {
                { "address", "0x" + address.ToString("X", CultureInfo.InvariantCulture) },
                { "relativeOffset", relativeOffset },
                { "value", value }
            };
        }
    }

    internal static class Probe
    {
        public static int Run(string outputPath)
        {
            try
            {
                Process[] games = Process.GetProcessesByName("CollegeFB27");
                if (games.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                using (MemoryScanner scanner = new MemoryScanner())
                {
                    scanner.Attach(games[0]);
                    MemoryLayout layout = scanner.ProbeLayout();
                    string result = String.Format(CultureInfo.InvariantCulture,
                        "{{\"passed\":true,\"processId\":{0},\"readablePrivateRegions\":{1},\"readablePrivateBytes\":{2},\"sampleReadPassed\":{3}}}",
                        games[0].Id, layout.RegionCount, layout.TotalBytes, layout.SampleReadPassed ? "true" : "false");
                    if (!String.IsNullOrWhiteSpace(outputPath)) File.WriteAllText(outputPath, result);
                    return 0;
                }
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                {
                    File.WriteAllText(outputPath, "{\"passed\":false,\"error\":\"" + Escape(error.Message) + "\"}");
                }
                return 1;
            }
        }

        private static string Escape(string value)
        {
            return (value ?? String.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }

    internal static class SelfTest
    {
        public static int Run(string outputPath)
        {
            try
            {
                LiveScoreboard value = LiveScoreboard.Parse(
                    "{\"away\":{\"name\":\"Texas\",\"score\":14,\"timeouts\":2,\"possession\":true}," +
                    "\"home\":{\"name\":\"Ohio State\",\"score\":7,\"timeouts\":3,\"possession\":false}," +
                    "\"game\":{\"quarter\":\"2nd\",\"clock\":\"4:17\",\"playClock\":28,\"down\":2,\"distance\":7}," +
                    "\"meta\":{\"updatedAt\":\"2026-08-09T00:00:00.000Z\"}}");
                if (value.AwayScore != 14 || value.HomeScore != 7) throw new Exception("Score parse failed.");
                if (value.QuarterNumber != 2 || value.GameClockSeconds != 257) throw new Exception("Clock parse failed.");
                if (value.PlayClock != 28 || !value.AwayPossession) throw new Exception("Live field parse failed.");
                if (value.Down != 2 || value.Distance != 7) throw new Exception("Down and distance parse failed.");
                if (!MemoryScanner.ValueMatches(257, 255, ScanComparison.Exact, 2)) throw new Exception("Tolerance comparison failed.");
                if (!MemoryScanner.ValueMatches(10, 9, ScanComparison.Decreased, 0)) throw new Exception("Decrease comparison failed.");

                List<FieldChoice> fields = FieldChoice.All();
                FieldChoice clockSeconds = FindField(fields, "Game clock (total seconds)");
                FieldChoice clockMilliseconds = FindField(fields, "Game clock (milliseconds)");
                FieldChoice possession = FindField(fields, "Possession (away=1, home=0)");
                int manualValue;
                string manualError;
                if (!clockSeconds.TryParseManual("4:51", out manualValue, out manualError) || manualValue != 291)
                    throw new Exception("Manual M:SS seconds conversion failed.");
                if (!clockMilliseconds.TryParseManual("4:51", out manualValue, out manualError) || manualValue != 291000)
                    throw new Exception("Manual M:SS milliseconds conversion failed.");
                if (clockSeconds.TryParseManual("4:99", out manualValue, out manualError))
                    throw new Exception("Invalid manual clock was accepted.");
                if (!possession.TryParseManual("away", out manualValue, out manualError) || manualValue != 1)
                    throw new Exception("Manual possession conversion failed.");

                ManualExpectedOverride oneScan = new ManualExpectedOverride();
                oneScan.Arm(clockSeconds, "4:51", 291);
                string consumedInput;
                int consumedValue;
                if (!oneScan.Consume(clockSeconds, out consumedInput, out consumedValue)
                    || consumedInput != "4:51" || consumedValue != 291 || oneScan.Armed)
                    throw new Exception("One-scan manual override lifecycle failed.");
                if (oneScan.Consume(clockSeconds, out consumedInput, out consumedValue))
                    throw new Exception("Manual override was consumed more than once.");

                string signature = RamLiveExporter.AddressSignature(new long[] { 0x3000, 0x1000 });
                if (signature != "1000,3000") throw new Exception("Matchup address signature is not stable.");
                if (!RamLiveExporter.SameMatchupCandidate("Pittsburgh", "Texas", signature, "2000",
                    "pittsburgh", "texas", "1000,3000", "2000"))
                    throw new Exception("Identical matchup candidate was rejected.");
                if (RamLiveExporter.SameMatchupCandidate("Pittsburgh", "Texas", signature, "2000",
                    "Pittsburgh", "Texas", "1000,4000", "2000"))
                    throw new Exception("Changed matchup address set was accepted.");
                string candidateAway = null;
                string candidateHome = null;
                string candidateAwayAddresses = null;
                string candidateHomeAddresses = null;
                int matchupConfirmations = 0;
                if (RamLiveExporter.AdvanceMatchupConfirmation(ref candidateAway, ref candidateHome,
                    ref candidateAwayAddresses, ref candidateHomeAddresses, ref matchupConfirmations,
                    "Texas A&M", "Texas", "1110", "2220") || matchupConfirmations != 1)
                    throw new Exception("First matchup observation committed early.");
                if (RamLiveExporter.AdvanceMatchupConfirmation(ref candidateAway, ref candidateHome,
                    ref candidateAwayAddresses, ref candidateHomeAddresses, ref matchupConfirmations,
                    "Texas A&M", "Texas", "3330", "2220") || matchupConfirmations != 1)
                    throw new Exception("Changed matchup address set did not reset confirmation.");
                if (!RamLiveExporter.AdvanceMatchupConfirmation(ref candidateAway, ref candidateHome,
                    ref candidateAwayAddresses, ref candidateHomeAddresses, ref matchupConfirmations,
                    "Texas A&M", "Texas", "3330", "2220") || matchupConfirmations != 2)
                    throw new Exception("Second stable matchup observation did not commit.");
                if (!RamLiveExporter.VerifiedHomeAwayTimeoutPairIsSafe(3, 3)
                    || !RamLiveExporter.VerifiedHomeAwayTimeoutPairIsSafe(2, 3)
                    || RamLiveExporter.VerifiedHomeAwayTimeoutPairIsSafe(-1, 3)
                    || RamLiveExporter.VerifiedHomeAwayTimeoutPairIsSafe(2, 4))
                    throw new Exception("Verified home/away timeout range gate failed.");
                if (!RamLiveExporter.VerifiedHomeAwayTimeoutCopiesAreSafe(2, 2, 2, 3)
                    || RamLiveExporter.VerifiedHomeAwayTimeoutCopiesAreSafe(3, 2, 2, 3))
                    throw new Exception("Verified home/away timeout copy-count gate failed.");
                if (!RamLiveExporter.TimeoutCloneReadHasFullConsensus(2, 2, 2)
                    || RamLiveExporter.TimeoutCloneReadHasFullConsensus(2, 1, 1)
                    || RamLiveExporter.TimeoutCloneReadHasFullConsensus(2, 2, 1))
                    throw new Exception("Verified timeout two-copy consensus gate failed.");
                if (!MemoryScanner.ExactTimeoutClonePairIsSafe(2, 0x1000, 0x12D0)
                    || MemoryScanner.ExactTimeoutClonePairIsSafe(1, 0x1000, 0x12D0)
                    || MemoryScanner.ExactTimeoutClonePairIsSafe(3, 0x1000, 0x12D0)
                    || MemoryScanner.ExactTimeoutClonePairIsSafe(2, 0x12D0, 0x1000)
                    || MemoryScanner.ExactTimeoutClonePairIsSafe(2, 0x1000, 0x12D4))
                    throw new Exception("Exact timeout-clone pair gate failed.");
                if (!MemoryScanner.ExactTimeoutCounterConsensusIsSafe(
                        2, 2, 2, 3, 2, 3)
                    || MemoryScanner.ExactTimeoutCounterConsensusIsSafe(
                        1, 1, 2, 3, 2, 3)
                    || MemoryScanner.ExactTimeoutCounterConsensusIsSafe(
                        2, 2, 2, 3, 1, 3)
                    || MemoryScanner.ExactTimeoutCounterConsensusIsSafe(
                        2, 2, 4, 3, 4, 3))
                    throw new Exception("Timeout counter consensus was not exact two-of-two.");
                if (!MemoryScanner.CatalogTimeoutCountersCorroborateClones(
                        true, 2, 3, 2, 3)
                    || MemoryScanner.CatalogTimeoutCountersCorroborateClones(
                        false, 2, 3, 2, 3)
                    || MemoryScanner.CatalogTimeoutCountersCorroborateClones(
                        true, 3, 3, 2, 3)
                    || MemoryScanner.CatalogTimeoutCountersCorroborateClones(
                        true, 4, 3, 4, 3))
                    throw new Exception("Catalog timeout corroboration gate failed.");
                if (!RamLiveExporter.RuntimeCatalogTimeoutReadsAreSafe(
                        true, 2, 3, 2, 3, 2, 3)
                    || RamLiveExporter.RuntimeCatalogTimeoutReadsAreSafe(
                        true, 2, 3, 3, 3, 2, 3)
                    || RamLiveExporter.RuntimeCatalogTimeoutReadsAreSafe(
                        true, 2, 3, 2, 3, 1, 3)
                    || !RamLiveExporter.RuntimeCatalogTimeoutReadsAreSafe(
                        false, 2, 3, 4, 4, 4, 4))
                    throw new Exception("Runtime catalog timeout corroboration gate failed.");
                // The catalog word may only veto the dormant 0/0 signature.
                // A self-verified non-zero pair survives catalog disagreement
                // (the observed live false veto was a correct 3/3), clones
                // without internal consensus are still discarded, and a live
                // 0/0 the catalog agrees with still publishes.
                if (MemoryScanner.TimeoutCatalogVetoApplies(true, 3, 3, false)
                    || MemoryScanner.TimeoutCatalogVetoApplies(true, 2, 3, false)
                    || MemoryScanner.TimeoutCatalogVetoApplies(true, 0, 1, false)
                    || !MemoryScanner.TimeoutCatalogVetoApplies(true, 0, 0, false)
                    || MemoryScanner.TimeoutCatalogVetoApplies(true, 0, 0, true)
                    || !MemoryScanner.TimeoutCatalogVetoApplies(false, 3, 3, true))
                    throw new Exception("The timeout catalog veto is not limited to the dormant 0/0 pair.");
                if (!RamLiveExporter.TimeoutClonePossessionAddressLayoutIsSafe(
                        new long[] { 0x1044, 0x1314 },
                        new long[] { 0x1048, 0x1318 },
                        new long[] { 0x1031, 0x1301 })
                    || RamLiveExporter.TimeoutClonePossessionAddressLayoutIsSafe(
                        new long[] { 0x1044 },
                        new long[] { 0x1048 },
                        new long[] { 0x1031 })
                    || RamLiveExporter.TimeoutClonePossessionAddressLayoutIsSafe(
                        new long[] { 0x1044, 0x1314 },
                        new long[] { 0x1048, 0x1318 },
                        new long[] { 0x1031, 0x1305 }))
                    throw new Exception("Timeout-clone possession address layout gate failed.");
                if (!RamLiveExporter.TimeoutCloneHomePossessionReadsAreSafe(2, 0, 0, 0, 0)
                    || !RamLiveExporter.TimeoutCloneHomePossessionReadsAreSafe(2, 1, 1, 1, 1)
                    || RamLiveExporter.TimeoutCloneHomePossessionReadsAreSafe(1, 0, 0, 0, 0)
                    || RamLiveExporter.TimeoutCloneHomePossessionReadsAreSafe(2, 0, 1, 0, 1)
                    || RamLiveExporter.TimeoutCloneHomePossessionReadsAreSafe(2, 2, 2, 2, 2)
                    || RamLiveExporter.TimeoutCloneHomePossessionReadsAreSafe(2, 0, 0, 1, 1)
                    || RamLiveExporter.AwayPossessionFromHomeFlag(0) != 1
                    || RamLiveExporter.AwayPossessionFromHomeFlag(1) != 0)
                    throw new Exception("Timeout-clone possession consensus/mapping gate failed.");
                // Selection priority after the 2026-08-13 probe game: the HUD
                // flag wins when bound; the synchronized legacy record is the
                // fallback; an unverified legacy alone publishes nothing.
                RamReadResult hudPossession = new RamReadResult(true, 1, 1, 1, 1);
                RamReadResult legacyPossession = new RamReadResult(true, 0, 1, 1, 1);
                if (!Object.ReferenceEquals(
                        RamLiveExporter.SelectVerifiedPossession(
                            hudPossession, legacyPossession, true), hudPossession)
                    || !Object.ReferenceEquals(
                        RamLiveExporter.SelectVerifiedPossession(
                            RamReadResult.Missing(2), legacyPossession, true), legacyPossession)
                    || RamLiveExporter.SelectVerifiedPossession(
                        RamReadResult.Missing(2), legacyPossession, false).Available
                    || RamLiveExporter.SelectVerifiedPossession(
                        RamReadResult.Missing(0), RamReadResult.Missing(0), true).Available)
                    throw new Exception("Possession selection priority is wrong.");
                // Only a complementary HUD pair may move the arrow: both-off is
                // a real dead-ball state, both-on is a mid-update read.
                if (RamLiveExporter.HudPossessionCandidate(1, 0) != 1
                    || RamLiveExporter.HudPossessionCandidate(0, 1) != 0
                    || RamLiveExporter.HudPossessionCandidate(0, 0) != -1
                    || RamLiveExporter.HudPossessionCandidate(1, 1) != -1)
                    throw new Exception("HUD possession candidate rule is not complementary-only.");
                // Name-based ScoreHud orientation (ranks/records from kickoff):
                // objects bind by catalog name at a tied score; stale objects
                // whose score disagrees are ignored; disagreeing clone ranks,
                // an unknown name, or identical names refuse to orient.
                {
                    Func<int, string> names = delegate(int id)
                    {
                        if (id == 7) return "Air Force";
                        if (id == 33) return "Fresno State";
                        if (id == 9) return "Texas A&M";
                        return null;
                    };
                    RamReadResult tied = new RamReadResult(true, 0, 1, 1, 1);
                    List<ScoreHudTeamCandidate> pool = new List<ScoreHudTeamCandidate>
                    {
                        new ScoreHudTeamCandidate { Address = 0x1000, TeamId = 33, Rank = 20, Score = 0 },
                        new ScoreHudTeamCandidate { Address = 0x2000, TeamId = 7, Rank = 8, Score = 0 },
                        // stale object from an earlier game in the same process
                        new ScoreHudTeamCandidate { Address = 0x3000, TeamId = 7, Rank = 8, Score = 24 },
                    };
                    ScoreHudTeamCandidate a, h;
                    if (!RamLiveExporter.TrySelectScoreHudSidesByName(pool, "Air Force", "Fresno State", names, tied, tied, out a, out h)
                        || a.TeamId != 7 || h.TeamId != 33 || a.Address != 0x2000)
                        throw new Exception("Name orientation failed to bind a tied kickoff by catalog names.");
                    // Punctuated name matches through the slug rule.
                    List<ScoreHudTeamCandidate> punct = new List<ScoreHudTeamCandidate>
                    {
                        new ScoreHudTeamCandidate { Address = 0x1000, TeamId = 9, Rank = 3, Score = 0 },
                        new ScoreHudTeamCandidate { Address = 0x2000, TeamId = 33, Rank = 0, Score = 0 },
                    };
                    if (!RamLiveExporter.TrySelectScoreHudSidesByName(punct, "TEXAS A&M", "fresno state", names, tied, tied, out a, out h)
                        || a.TeamId != 9)
                        throw new Exception("Name orientation did not match punctuated names by slug.");
                    // Same name on both sides, or an unresolvable id: no orientation.
                    if (RamLiveExporter.TrySelectScoreHudSidesByName(pool, "Air Force", "Air Force", names, tied, tied, out a, out h)
                        || RamLiveExporter.TrySelectScoreHudSidesByName(pool, "Air Force", "Nowhere State", names, tied, tied, out a, out h))
                        throw new Exception("Name orientation guessed without two distinct matching names.");
                    // Clones of one team disagreeing on rank are ambiguous.
                    List<ScoreHudTeamCandidate> ambiguous = new List<ScoreHudTeamCandidate>
                    {
                        new ScoreHudTeamCandidate { Address = 0x1000, TeamId = 33, Rank = 20, Score = 0 },
                        new ScoreHudTeamCandidate { Address = 0x2000, TeamId = 7, Rank = 8, Score = 0 },
                        new ScoreHudTeamCandidate { Address = 0x3000, TeamId = 7, Rank = 9, Score = 0 },
                    };
                    if (RamLiveExporter.TrySelectScoreHudSidesByName(ambiguous, "Air Force", "Fresno State", names, tied, tied, out a, out h))
                        throw new Exception("Name orientation accepted clones with disagreeing ranks.");
                }
                // Message team attribution: only a positive id matching an
                // oriented side resolves; unknown ids and the -1/0 "no team"
                // sentinels stay null rather than guessing a side.
                if (RamLiveExporter.MessageTeamSide(1211, 1211, 77) != "away"
                    || RamLiveExporter.MessageTeamSide(77, 1211, 77) != "home"
                    || RamLiveExporter.MessageTeamSide(0, 1211, 77) != null
                    || RamLiveExporter.MessageTeamSide(-1, 1211, 77) != null
                    || RamLiveExporter.MessageTeamSide(5, 1211, 77) != null
                    || RamLiveExporter.MessageTeamSide(0, 0, 0) != null)
                    throw new Exception("Message team-side attribution guessed a side.");
                // Research probes: the stats diff keeps rising stat-like slots,
                // disqualifies anything that goes down inside range, and ignores
                // pointer-sized garbage; the toggle diff only reports tiny flips.
                {
                    int[] before = new int[] { 3, 120, 7, 999999, 5, 40 };
                    int[] after = new int[] { 4, 131, 6, 999998, 5, 900 };
                    bool[] disqualified = new bool[6];
                    int[] rises = new int[6];
                    Dictionary<int, int[]> up = ResearchProbeHelpers.DiffMonotonicCounters(before, after, disqualified, rises, 5000, 200, 100);
                    if (!up.ContainsKey(0) || up[0][0] != 3 || up[0][1] != 4) throw new Exception("Stats probe missed a +1 rise.");
                    if (!up.ContainsKey(1)) throw new Exception("Stats probe missed a +11 rise.");
                    if (up.ContainsKey(2) || !disqualified[2]) throw new Exception("Stats probe did not disqualify a drop.");
                    if (up.ContainsKey(3) || disqualified[3]) throw new Exception("Stats probe treated garbage as a stat.");
                    if (up.ContainsKey(4)) throw new Exception("Stats probe reported an unchanged slot.");
                    if (up.ContainsKey(5)) throw new Exception("Stats probe accepted an oversized jump.");
                    if (rises[0] != 1 || rises[1] != 1 || rises[5] != 0) throw new Exception("Stats probe rise counts are wrong.");
                    Dictionary<int, int[]> flips = ResearchProbeHelpers.DiffSmallBytes(
                        new byte[] { 0, 1, 40, 2 }, new byte[] { 1, 1, 41, 0 }, 3, 10);
                    if (!flips.ContainsKey(0) || !flips.ContainsKey(3) || flips.ContainsKey(1) || flips.ContainsKey(2))
                        throw new Exception("Toggle probe reported the wrong flips.");
                    if (ResearchProbeHelpers.AsciiPreview(new byte[] { 72, 111, 108, 100, 0, 65 }, 0, 10) != "Hold")
                        throw new Exception("ASCII preview did not stop at the terminator.");
                    // Live penalty parsing from the three anchors seen in the probe game.
                    PenaltyRead speech = PenaltyTextParser.Parse("BD13/GAME/SPCH/ABVF=1787084051&ctxn=PENALTY_DEF_ENCROACHMENT_WITHIN_5_YARDS&snti=691&cdwn=1&ytof=3");
                    if (speech == null || speech.Type != "Encroachment" || speech.Side != "defense" || speech.Source != "speech")
                        throw new Exception("Penalty speech context did not parse.");
                    PenaltyRead clip = PenaltyTextParser.Parse("Sound/Speech/BASE/SoundWaves/bPENALTY_OFF_DELAY_OF_GAME_80LESS_OVR.CDM");
                    if (clip == null || clip.Type != "Delay of Game" || clip.Side != "offense")
                        throw new Exception("Penalty clip path did not parse: " + (clip == null ? "null" : clip.Type));
                    PenaltyRead nis = PenaltyTextParser.Parse("ScriptableNode(_Penalty_0632_Encroachment_01 - 0): enabledState: 2, pendingActivation: 0");
                    if (nis == null || nis.Type != "Encroachment" || nis.Side != null || nis.Source != "nis")
                        throw new Exception("Penalty NIS node did not parse.");
                    if (PenaltyTextParser.Parse("ScriptableNode(_Penalty_0619_Offsides - -1): enabledState: 0") != null)
                        throw new Exception("An inactive penalty node was accepted.");
                    if (PenaltyTextParser.Humanize("PASS_INTERFERENCE") != "Pass Interference"
                        || PenaltyTextParser.Humanize("FACEMASK") != "Face Mask")
                        throw new Exception("Penalty name humanizing is wrong.");
                }
                // Freshness stamps for downstream consumers: a stamp moves only
                // when the published value actually changes, and transitions to
                // and from null (unavailable) count as changes.
                {
                    Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
                    Dictionary<string, DateTime> changed = new Dictionary<string, DateTime>(StringComparer.Ordinal);
                    DateTime t0 = new DateTime(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc);
                    DateTime t1 = t0.AddSeconds(5);
                    DateTime t2 = t0.AddSeconds(9);
                    if (!RamLiveExporter.NotePublishedFieldValue(values, changed, "awayScore", "14", t0)
                        || RamLiveExporter.NotePublishedFieldValue(values, changed, "awayScore", "14", t1)
                        || changed["awayScore"] != t0
                        || !RamLiveExporter.NotePublishedFieldValue(values, changed, "awayScore", "21", t1)
                        || changed["awayScore"] != t1
                        || !RamLiveExporter.NotePublishedFieldValue(values, changed, "awayScore", null, t2)
                        || changed["awayScore"] != t2
                        || RamLiveExporter.NotePublishedFieldValue(values, changed, "awayScore", null, t2.AddSeconds(1))
                        || !RamLiveExporter.NotePublishedFieldValue(values, changed, "awayScore", "21", t2.AddSeconds(2)))
                        throw new Exception("Freshness stamp rule moved on an unchanged value or missed a change.");
                }
                // Multi-clone rank/possession addresses: the selected side is
                // first, only agreeing clones (TeamId and Rank) join, capped.
                {
                    ScoreHudTeamCandidate sel = new ScoreHudTeamCandidate { Address = 0x2000, TeamId = 7, Rank = 15 };
                    List<ScoreHudTeamCandidate> pool = new List<ScoreHudTeamCandidate>
                    {
                        new ScoreHudTeamCandidate { Address = 0x1000, TeamId = 7, Rank = 15 },
                        sel,
                        new ScoreHudTeamCandidate { Address = 0x3000, TeamId = 7, Rank = 14 },
                        new ScoreHudTeamCandidate { Address = 0x4000, TeamId = 8, Rank = 15 },
                        new ScoreHudTeamCandidate { Address = 0x5000, TeamId = 7, Rank = 15 },
                    };
                    List<long> addresses = RamLiveExporter.RankObjectFieldAddresses(pool, sel);
                    if (addresses.Count != 3 || addresses[0] != 0x2000 + 44
                        || !addresses.Contains(0x1000 + 44) || !addresses.Contains(0x5000 + 44)
                        || addresses.Contains(0x3000 + 44) || addresses.Contains(0x4000 + 44))
                        throw new Exception("Rank clone address selection admitted a disagreeing clone.");
                }
                // Anchor windows: 1 MB aligned, each anchor covers itself plus
                // both neighbors, deduplicated, capped, garbage rejected.
                {
                    List<long> windows = MemoryScanner.AnchorScanWindows(
                        new long[] { 0x2F100200, 0x2F1FFF00, 0, -5 }, 12);
                    if (!windows.Contains(0x2F000000L) || !windows.Contains(0x2F100000L)
                        || !windows.Contains(0x2F200000L) || windows.Count != 3
                        || MemoryScanner.AnchorScanWindows(new long[] { 0x2F100200 }, 2).Count != 2
                        || MemoryScanner.AnchorScanWindows(null, 4).Count != 0)
                        throw new Exception("Anchor scan windows are not aligned, deduplicated and capped.");
                }
                // Slug normalization must match the game's asset folder names:
                // punctuation between letters joins, only spaces/hyphens/
                // slashes split. Every punctuated FBS name is asserted.
                if (MemoryScanner.NormalizeSlug("Texas A&M") != "texas_am"
                    || MemoryScanner.NormalizeSlug("N.C. State") != "nc_state"
                    || MemoryScanner.NormalizeSlug("LA. Tech") != "la_tech"
                    || MemoryScanner.NormalizeSlug("W. Kentucky") != "w_kentucky"
                    || MemoryScanner.NormalizeSlug("Hawai'i") != "hawaii"
                    || MemoryScanner.NormalizeSlug("Miami (OH)") != "miami_oh"
                    || MemoryScanner.NormalizeSlug("Louisiana-Monroe") != "louisiana_monroe"
                    || MemoryScanner.NormalizeSlug("Notre Dame") != "notre_dame"
                    || MemoryScanner.NormalizeSlug("  Air   Force ") != "air_force"
                    || MemoryScanner.NormalizeSlug("western_michigan") != "western_michigan"
                    || MemoryScanner.NormalizeSlug("") != "")
                    throw new Exception("Slug normalization does not match the game's asset folder names.");
                if (!RamLiveExporter.VerifiedHomeAwayTimeoutRereadIsValid(true, true, 3, 2, 3, 2)
                    || RamLiveExporter.VerifiedHomeAwayTimeoutRereadIsValid(true, true, 2, 3, 3, 2)
                    || RamLiveExporter.VerifiedHomeAwayTimeoutRereadIsValid(false, true, 3, 2, 3, 2))
                    throw new Exception("Verified home/away timeout post-set reread gate failed.");
                if (!MemoryScanner.WideDuplicateDownMatches(3, 3)
                    || MemoryScanner.WideDuplicateDownMatches(1, 2))
                    throw new Exception("Wide duplicate-down structural gate failed.");
                if (!MemoryScanner.LabeledVectorDescriptorShapeIsValid(
                        0x1000, 0x1010, 0x1010, 0x2200, 0x1008, 0x1000, 1)
                    || !MemoryScanner.LabeledVectorDescriptorShapeIsValid(
                        0x1000, 0x1010, 0x1010, 0x2200, 0x1000, 0x1008, 1)
                    || MemoryScanner.LabeledVectorDescriptorShapeIsValid(
                        0x1000, 0x1018, 0x1018, 0x2200, 0x1008, 0x1000, 1)
                    || MemoryScanner.LabeledVectorDescriptorShapeIsValid(
                        0x1000, 0x1010, 0x1010, 0, 0x1008, 0x1000, 1)
                    || MemoryScanner.LabeledVectorDescriptorShapeIsValid(
                        0x1000, 0x1010, 0x1010, 0x2200, 0x1008, 0x1000, 2)
                    || MemoryScanner.LabeledVectorDescriptorShapeIsValid(
                        0x1000, 0x1010, 0x1010, 0x2200, 0x1000, 0x1000, 1)
                    || MemoryScanner.LabeledVectorDescriptorShapeIsValid(
                        0x1000, 0x1010, 0x1010, 0x2200, 0x1010, 0x1000, 1))
                    throw new Exception("Labeled team-role vector descriptor gate failed.");
                if (!MemoryScanner.RoleDisplayNameMatchesCanonical("W. Michigan", "Western Michigan")
                    || !MemoryScanner.RoleDisplayNameMatchesCanonical("Pittsburgh", "Pittsburgh")
                    || MemoryScanner.RoleDisplayNameMatchesCanonical("W Michigan", "Western Michigan")
                    || MemoryScanner.RoleDisplayNameMatchesCanonical("W. Carolina", "Western Michigan"))
                    throw new Exception("Dynasty team abbreviation matching failed.");
                Dictionary<string, string> dynastyCatalog = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    { "western_michigan", "Western Michigan" },
                    { "pittsburgh", "Pittsburgh" }
                };
                string resolvedDynastyTeam;
                if (!MemoryScanner.TryResolveRoleTeamCanonical("W. Michigan",
                        new string[] { "western_michigan", "pittsburgh" },
                        dynastyCatalog, out resolvedDynastyTeam)
                    || !String.Equals(resolvedDynastyTeam, "Western Michigan", StringComparison.Ordinal)
                    || MemoryScanner.TryResolveRoleTeamCanonical("W. M.",
                        new string[] { "western_michigan", "western_mississippi" },
                        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                        {
                            { "western_michigan", "Western Michigan" },
                            { "western_mississippi", "Western Mississippi" }
                        }, out resolvedDynastyTeam))
                    throw new Exception("Dynasty team canonicalization was not unique and fail-closed.");
                if (!MemoryScanner.TryResolveRoleTeamCanonical("Pittsburgh",
                        new string[] { "pittsburgh" }, dynastyCatalog, out resolvedDynastyTeam)
                    || !String.Equals(resolvedDynastyTeam, "Pittsburgh", StringComparison.Ordinal))
                    throw new Exception("Tradition-backed catalog team canonicalization failed.");
                string[] genericFcsTeamNames = new string[]
                {
                    "FCS East", "FCS Midwest", "FCS Northwest", "FCS Southeast", "FCS West"
                };
                for (int genericIndex = 0; genericIndex < genericFcsTeamNames.Length; genericIndex++)
                {
                    if (MemoryScanner.TryResolveRoleTeamCanonical(genericFcsTeamNames[genericIndex],
                            new string[0], dynastyCatalog, out resolvedDynastyTeam))
                        throw new Exception("Zero-tradition generic FCS role vector was not fail-closed: "
                            + genericFcsTeamNames[genericIndex]);
                }
                if (MemoryScanner.TryResolveRoleTeamCanonical("Pittsburgh",
                        new string[0], dynastyCatalog, out resolvedDynastyTeam)
                    || MemoryScanner.TryResolveRoleTeamCanonical("Retained Raw Team",
                        new string[0], dynastyCatalog, out resolvedDynastyTeam)
                    || MemoryScanner.TryResolveRoleTeamCanonical("W. M.",
                        new string[0],
                        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                        {
                            { "western_michigan", "Western Michigan" },
                            { "western_mississippi", "Western Mississippi" }
                        }, out resolvedDynastyTeam)
                    || MemoryScanner.TryResolveRoleTeamCanonical("Pittsburgh",
                        new string[] { "western_michigan" }, dynastyCatalog,
                        out resolvedDynastyTeam))
                    throw new Exception("Zero-tradition retained team-role vectors were not fail-closed.");
                RamTextResult dynastyRawName = new RamTextResult(true, "W. Michigan", 1, 1, 1);
                RamTextResult dynastyCanonicalName = RamLiveExporter.CanonicalizeRoleTeamRead(
                    dynastyRawName, "Western Michigan");
                if (!dynastyCanonicalName.Available
                    || !String.Equals(dynastyCanonicalName.Value, "Western Michigan", StringComparison.Ordinal)
                    || dynastyCanonicalName.SuccessfulReads != 1
                    || dynastyCanonicalName.AgreeingCopies != 1
                    || dynastyCanonicalName.ConfiguredCopies != 1)
                    throw new Exception("Dynasty canonical team read lost RAM evidence.");
                if (!MemoryScanner.LooksLikeTeamKey("OREGST")
                    || !MemoryScanner.LooksLikeTeamKey("ducks")
                    || MemoryScanner.LooksLikeTeamKey("bad/key"))
                    throw new Exception("Team catalog key validation failed.");
                if (!MemoryScanner.LabeledVectorEvidenceIsUnique(1, 1, 1)
                    || MemoryScanner.LabeledVectorEvidenceIsUnique(1, 0, 0)
                    || MemoryScanner.LabeledVectorEvidenceIsUnique(2, 1, 1)
                    || MemoryScanner.LabeledVectorEvidenceIsUnique(1, 1, 2)
                    || MemoryScanner.LabeledVectorEvidenceBlocksLegacyFallback(0, 0)
                    || !MemoryScanner.LabeledVectorEvidenceBlocksLegacyFallback(1, 0)
                    || !MemoryScanner.LabeledVectorEvidenceBlocksLegacyFallback(0, 1))
                    throw new Exception("Labeled team-role ambiguity gate failed.");
                string differentCoreCandidate = null;
                int differentCoreConfirmations = 0;
                if (RamLiveExporter.AdvanceDifferentCoreConfirmation(
                        ref differentCoreCandidate, ref differentCoreConfirmations, "1000:W")
                    || differentCoreConfirmations != 1
                    || !RamLiveExporter.AdvanceDifferentCoreConfirmation(
                        ref differentCoreCandidate, ref differentCoreConfirmations, "1000:W")
                    || differentCoreConfirmations != 2)
                    throw new Exception("Replacement core confirmation gate failed.");
                if (RamLiveExporter.AdvanceDifferentCoreConfirmation(
                        ref differentCoreCandidate, ref differentCoreConfirmations, "2000:W")
                    || differentCoreConfirmations != 1)
                    throw new Exception("Replacement core signature change did not reset confirmation.");
                RamScoreboardSnapshot liveWideFirst = new RamScoreboardSnapshot
                {
                    Address = 0x2000, UsesWideLayout = true, Quarter = 1,
                    Clock = 273, PlayClock = 35, HomeScore = 0, AwayScore = 0,
                    Down = 2, Distance = 13
                };
                RamScoreboardSnapshot liveWideSecond = new RamScoreboardSnapshot
                {
                    Address = 0x2000, UsesWideLayout = true, Quarter = 1,
                    Clock = 272, PlayClock = 34, HomeScore = 0, AwayScore = 0,
                    Down = 2, Distance = 13
                };
                RamScoreboardSnapshot liveWideThird = new RamScoreboardSnapshot
                {
                    Address = 0x2000, UsesWideLayout = true, Quarter = 1,
                    Clock = 271, PlayClock = 33, HomeScore = 0, AwayScore = 0,
                    Down = 2, Distance = 13
                };
                if (!MemoryScanner.HasCoherentLiveWideProgression(
                    liveWideFirst, liveWideSecond, liveWideThird))
                    throw new Exception("Two-interval live wide progression was rejected.");
                RamScoreboardSnapshot coldDecoyFirst = new RamScoreboardSnapshot
                {
                    Address = 0x3000, UsesWideLayout = true, Quarter = 1,
                    Clock = 31, PlayClock = 20, HomeScore = 0, AwayScore = 0,
                    Down = 1, Distance = 10
                };
                RamScoreboardSnapshot coldDecoySecond = new RamScoreboardSnapshot
                {
                    Address = 0x3000, UsesWideLayout = true, Quarter = 1,
                    Clock = 30, PlayClock = 19, HomeScore = 0, AwayScore = 0,
                    Down = 1, Distance = 10
                };
                RamScoreboardSnapshot coldDecoyThird = new RamScoreboardSnapshot
                {
                    Address = 0x3000, UsesWideLayout = true, Quarter = 1,
                    Clock = 30, PlayClock = 19, HomeScore = 0, AwayScore = 0,
                    Down = 1, Distance = 10
                };
                if (MemoryScanner.HasCoherentLiveWideProgression(
                    coldDecoyFirst, coldDecoySecond, coldDecoyThird))
                    throw new Exception("One-time cold initialization was accepted as a live core.");
                RamScoreboardSnapshot staticWide = new RamScoreboardSnapshot
                {
                    Address = 0x4000, UsesWideLayout = true, Quarter = 1,
                    Clock = 31, PlayClock = 20, HomeScore = 0, AwayScore = 0,
                    Down = 1, Distance = 10
                };
                if (MemoryScanner.HasCoherentLiveWideProgression(staticWide, staticWide, staticWide))
                    throw new Exception("Static synchronized core was accepted without movement.");
                RamScoreboardSnapshot kickoffFirst = new RamScoreboardSnapshot
                {
                    Address = 0x5000, UsesWideLayout = true, Quarter = 1,
                    Clock = 300, PlayClock = 35, HomeScore = 0, AwayScore = 0,
                    Down = 0, Distance = 0
                };
                RamScoreboardSnapshot kickoffSecond = new RamScoreboardSnapshot
                {
                    Address = 0x5000, UsesWideLayout = true, Quarter = 1,
                    Clock = 299, PlayClock = 34, HomeScore = 0, AwayScore = 0,
                    Down = 0, Distance = 0
                };
                RamScoreboardSnapshot kickoffThird = new RamScoreboardSnapshot
                {
                    Address = 0x5000, UsesWideLayout = true, Quarter = 1,
                    Clock = 298, PlayClock = 33, HomeScore = 0, AwayScore = 0,
                    Down = 0, Distance = 0
                };
                if (!MemoryScanner.HasCoherentLiveWideProgression(
                    kickoffFirst, kickoffSecond, kickoffThird))
                    throw new Exception("Moving down-zero kickoff core was rejected.");
                kickoffThird.Address = 0x5008;
                if (MemoryScanner.HasCoherentLiveWideProgression(
                    kickoffFirst, kickoffSecond, kickoffThird))
                    throw new Exception("Mixed-address wide progression was accepted.");
                if (!RamLiveExporter.LivePossessionReadIsSafe(1, 0, 0)
                    || !RamLiveExporter.LivePossessionReadIsSafe(1, 1, 1)
                    || RamLiveExporter.LivePossessionReadIsSafe(1, 1, 0)
                    || RamLiveExporter.LivePossessionReadIsSafe(1, 2, 2)
                    || RamLiveExporter.LivePossessionReadIsSafe(2, 1, 1))
                    throw new Exception("Synchronized live-possession read gate failed.");
                if (!RamLiveExporter.BackgroundResultMatchesGeneration(4, 4)
                    || RamLiveExporter.BackgroundResultMatchesGeneration(4, 5))
                    throw new Exception("Background matchup-generation gate failed.");
                if (!RamLiveExporter.SameProcessIdentity(91, 123456789L, 91, 123456789L)
                    || RamLiveExporter.SameProcessIdentity(91, 123456789L, 92, 123456789L)
                    || RamLiveExporter.SameProcessIdentity(91, 123456789L, 91, 123456790L)
                    || RamLiveExporter.SameProcessIdentity(91, 0, 91, 0))
                    throw new Exception("PID/start-time process identity gate failed.");
                if (!RamLiveExporter.ShouldStartNewMatchupEpoch(false, false)
                    || RamLiveExporter.ShouldStartNewMatchupEpoch(true, false)
                    || !RamLiveExporter.ShouldStartNewMatchupEpoch(true, true))
                    throw new Exception("Repeated pending-matchup epoch reset gate failed.");
                byte[] timeoutPattern = Convert.FromBase64String(
                    "AAAAAP7///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8PAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAgEE=");
                byte[] dynamicTimeoutFixture = (byte[])timeoutPattern.Clone();
                dynamicTimeoutFixture[0x41] ^= 0x01;
                if (!MemoryScanner.MatchesTimeoutContext(dynamicTimeoutFixture, 0, timeoutPattern))
                    throw new Exception("Proven-dynamic timeout byte +0x41 was rejected.");
                byte[] staticTimeoutFixture = (byte[])timeoutPattern.Clone();
                staticTimeoutFixture[0x42] ^= 0x01;
                if (MemoryScanner.MatchesTimeoutContext(staticTimeoutFixture, 0, timeoutPattern))
                    throw new Exception("Static timeout-context mutation was accepted.");
                byte[] dynastyTimeoutPattern = Convert.FromBase64String(
                    "AAAAAAQAAAAAAQAA//////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAA//8PAAAAAAADAAAAAwAAAANjAAAAAAAABgAAAAMAAAACAAAAAwAAAAABAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAgEE=");
                byte[] dynastyDynamicTimeoutFixture = (byte[])dynastyTimeoutPattern.Clone();
                dynastyDynamicTimeoutFixture[0x14] = 0x4D;
                dynastyDynamicTimeoutFixture[0x23] = 0xC0;
                dynastyDynamicTimeoutFixture[0x44] = 2;
                dynastyDynamicTimeoutFixture[0x4D] ^= 0x01;
                if (!MemoryScanner.MatchesTimeoutContext(
                        dynastyDynamicTimeoutFixture, 0, timeoutPattern))
                    throw new Exception("Dynasty timeout counter transition was rejected.");
                byte[] dynastyStaticTimeoutFixture = (byte[])dynastyTimeoutPattern.Clone();
                dynastyStaticTimeoutFixture[0x42] ^= 0x01;
                if (MemoryScanner.MatchesTimeoutContext(
                        dynastyStaticTimeoutFixture, 0, timeoutPattern))
                    throw new Exception("Dynasty timeout static-byte mutation was accepted.");
                byte[] timeoutClone = (byte[])dynastyTimeoutPattern.Clone();
                timeoutClone[0x14] = 0x4D;
                timeoutClone[0x23] = 0xC0;
                timeoutClone[0x44] = 2;
                // These optional presentation duplicates are zero in some modes;
                // they must not be required to mirror the authoritative counters.
                timeoutClone[0x5C] = 0;
                timeoutClone[0x60] = 0;
                byte[] matchingTimeoutClone = (byte[])timeoutClone.Clone();
                if (!MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone))
                    throw new Exception("Verified Dynasty timeout clones were rejected.");
                if (!MemoryScanner.TimeoutClonePairMatchesPatternAndStructure(
                        timeoutClone, matchingTimeoutClone, timeoutPattern))
                    throw new Exception("Verified timeout pair failed its static signature gate.");
                if (!MemoryScanner.TimeoutClonePairMatchesKnownPatternAndStructure(
                        timeoutClone, matchingTimeoutClone))
                    throw new Exception("Runtime timeout signature gate rejected a valid pair.");
                matchingTimeoutClone[0x3C] ^= 0x89;
                matchingTimeoutClone[0x3D] ^= 0x4C;
                if (!MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone)
                    || !MemoryScanner.TimeoutClonePairMatchesKnownPatternAndStructure(
                        timeoutClone, matchingTimeoutClone)
                    || RamLiveExporter.TimeoutCloneRuntimeFailureRequiresClearing(
                        true, true, true))
                    throw new Exception("Asynchronous timeout clone propagation cleared verified slots.");
                matchingTimeoutClone[0x3C] ^= 0x89;
                matchingTimeoutClone[0x3D] ^= 0x4C;
                matchingTimeoutClone[0x6C] ^= 0x01;
                matchingTimeoutClone[0x7F] ^= 0x01;
                if (!MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone))
                    throw new Exception("Clone-local timeout bookkeeping was treated as structural.");
                matchingTimeoutClone = (byte[])timeoutClone.Clone();
                matchingTimeoutClone[0x42] ^= 0x01;
                if (MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone))
                    throw new Exception("Static timeout clone mismatch was accepted.");
                matchingTimeoutClone = (byte[])timeoutClone.Clone();
                timeoutClone[0x42] ^= 0x01;
                matchingTimeoutClone[0x42] ^= 0x01;
                if (!MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone)
                    || MemoryScanner.TimeoutClonePairMatchesPatternAndStructure(
                        timeoutClone, matchingTimeoutClone, timeoutPattern)
                    || MemoryScanner.TimeoutClonePairMatchesKnownPatternAndStructure(
                        timeoutClone, matchingTimeoutClone)
                    || !RamLiveExporter.TimeoutCloneRuntimeFailureRequiresClearing(
                        true, false, false))
                    throw new Exception("Matching clones bypassed the timeout static signature.");
                timeoutClone[0x42] ^= 0x01;
                matchingTimeoutClone = (byte[])timeoutClone.Clone();
                matchingTimeoutClone[0x44] = 3;
                if (MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone)
                    || RamLiveExporter.TimeoutCloneRuntimeFailureRequiresClearing(
                        true, true, true))
                    throw new Exception("Disagreeing authoritative timeout counters were accepted.");
                if (!RamLiveExporter.TimeoutCloneRuntimeFailureRequiresClearing(
                        false, true, true)
                    || !RamLiveExporter.TimeoutCloneRuntimeFailureRequiresClearing(
                        true, false, true)
                    || !RamLiveExporter.TimeoutCloneRuntimeFailureRequiresClearing(
                        true, true, false))
                    throw new Exception("Invalid timeout topology/signature did not clear cached slots.");
                matchingTimeoutClone = (byte[])timeoutClone.Clone();
                matchingTimeoutClone[0x5C] = 3;
                timeoutClone[0x5C] = 3;
                if (!MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone))
                    throw new Exception("Mode-specific timeout duplicate fields were treated as authoritative.");
                matchingTimeoutClone = (byte[])timeoutClone.Clone();
                timeoutClone[0x44] = 4;
                matchingTimeoutClone[0x44] = 4;
                if (MemoryScanner.TimeoutCloneCopiesAreStructurallySafe(
                        timeoutClone, matchingTimeoutClone))
                    throw new Exception("Out-of-range timeout counters were accepted.");
                if (!RamLiveExporter.TimeoutCloneConfiguredAddressLayoutIsSafe(
                        2, 2, 0x1044, 0x1314, 0x1048, 0x1318)
                    || RamLiveExporter.TimeoutCloneConfiguredAddressLayoutIsSafe(
                        2, 2, 0x1044, 0x1314, 0x104C, 0x1318)
                    || RamLiveExporter.TimeoutCloneConfiguredAddressLayoutIsSafe(
                        2, 1, 0x1044, 0x1314, 0x1048, 0x1318))
                    throw new Exception("Configured timeout clone address topology gate failed.");

                RamReadResult downTwo = new RamReadResult(true, 2, 1, 1, 1);
                RamReadResult distanceZero = new RamReadResult(true, 0, 1, 1, 1);
                RamReadResult distanceThree = new RamReadResult(true, 3, 1, 1, 1);
                ScoreHudDownDistanceCandidate numericDown = new ScoreHudDownDistanceCandidate
                {
                    Address = 0x3000, Display = "2nd & 3", Down = 2,
                    Distance = 3, IsEmpty = false
                };
                // Distance 50 is what the game actually stores on a Goal/Inches
                // layer - the same not-applicable sentinel Kickoff and PAT use.
                // These fixtures previously said 0, which no live object has
                // ever carried, so every assertion below passed while the real
                // feature could not fire. Captured live 2026-08-11:
                // { display "3rd & Goal", down 3, distance 50, isEmpty false }.
                ScoreHudDownDistanceCandidate inchesDown = new ScoreHudDownDistanceCandidate
                {
                    Address = 0x2000, Display = "2nd & Inches", Down = 2,
                    Distance = 50, IsEmpty = false
                };
                ScoreHudDownDistanceCandidate goalDown = new ScoreHudDownDistanceCandidate
                {
                    Address = 0x2100, Display = "2nd & Goal", Down = 2,
                    Distance = 50, IsEmpty = false
                };
                ScoreHudDownDistanceCandidate kickoffDown = new ScoreHudDownDistanceCandidate
                {
                    Address = 0x2200, Display = "Kickoff", Down = 0,
                    Distance = 50, IsEmpty = false
                };
                if (!RamLiveExporter.PositiveCoreNumericResumeCandidateIsSafe(
                        downTwo, distanceThree, false)
                    || RamLiveExporter.PositiveCoreNumericResumeCandidateIsSafe(
                        downTwo, distanceThree, true)
                    || RamLiveExporter.PositiveCoreNumericResumeCandidateIsSafe(
                        downTwo, distanceZero, false)
                    || RamLiveExporter.PositiveCoreNumericResumeCandidateIsSafe(
                        RamReadResult.Missing(), distanceThree, false))
                    throw new Exception("Positive core numeric resume visibility gate failed.");
                if (!RamLiveExporter.ScoreHudClockResumeProofIsSafe(true, true, false)
                    || RamLiveExporter.ScoreHudClockResumeProofIsSafe(true, true, true)
                    || RamLiveExporter.ScoreHudClockResumeProofIsSafe(true, false, false)
                    || RamLiveExporter.ScoreHudClockResumeProofIsSafe(false, true, false))
                    throw new Exception("ScoreHud clock resume visibility gate failed.");
                if (!RamLiveExporter.ScoreHudNumericRetirementIsAllowed(false, true)
                    || RamLiveExporter.ScoreHudNumericRetirementIsAllowed(true, true)
                    || RamLiveExporter.ScoreHudNumericRetirementIsAllowed(false, false))
                    throw new Exception("Visible ScoreHud special retired to an underlying numeric layer.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, inchesDown },
                        downTwo, distanceZero) != inchesDown)
                    throw new Exception("Visible Inches layer did not replace numeric yardage.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, goalDown },
                        downTwo, distanceZero) != goalDown)
                    throw new Exception("Visible Goal layer did not replace numeric yardage.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { goalDown },
                        downTwo, distanceThree) != null
                    || RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { inchesDown },
                        downTwo, distanceThree) != null)
                    throw new Exception("Stale same-down Goal/Inches overrode positive yardage.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, goalDown, inchesDown },
                        downTwo, distanceThree) != numericDown)
                    throw new Exception("Stale Goal/Inches blocked the matching numeric layer.");
                // Goal-to-go: the numeric core reports yards to the goal line,
                // not 0, so a rule keyed on distance 0 never fires on a real
                // 1st & Goal. A Goal/Inches layer observed changing inside the
                // live window must win over that yardage; an unchanged pooled
                // object must still lose to it, and a fresh layer whose down
                // disagrees with the core must still be refused.
                RamReadResult downThree = new RamReadResult(true, 3, 1, 1, 1);
                HashSet<long> freshGoalOnly = new HashSet<long>();
                freshGoalOnly.Add(goalDown.Address);
                HashSet<long> freshInchesOnly = new HashSet<long>();
                freshInchesOnly.Add(inchesDown.Address);
                HashSet<long> noneFresh = new HashSet<long>();
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, goalDown },
                        downTwo, distanceThree,
                        RamLiveExporter.ScoreHudExpectedNone, freshGoalOnly) != goalDown)
                    throw new Exception("Live goal-to-go Goal layer lost to yards-to-goal.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, inchesDown },
                        downTwo, distanceThree,
                        RamLiveExporter.ScoreHudExpectedNone, freshInchesOnly) != inchesDown)
                    throw new Exception("Live Inches layer lost to positive yardage.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, goalDown },
                        downTwo, distanceThree,
                        RamLiveExporter.ScoreHudExpectedNone, noneFresh) != numericDown)
                    throw new Exception("Unchanged pooled Goal object overrode live yardage.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { goalDown },
                        downThree, distanceThree,
                        RamLiveExporter.ScoreHudExpectedNone, freshGoalOnly) != null)
                    throw new Exception("Fresh Goal layer ignored a mismatched current down.");
                // Whatever the Distance field happens to hold, the display text
                // is the classifier. Accept a zero-distance variant too so a
                // future build that does zero the field is not broken by this.
                ScoreHudDownDistanceCandidate goalDownZeroDistance =
                    new ScoreHudDownDistanceCandidate
                    {
                        Address = 0x2400, Display = "2nd & Goal", Down = 2,
                        Distance = 0, IsEmpty = false
                    };
                HashSet<long> freshZeroGoal = new HashSet<long>();
                freshZeroGoal.Add(goalDownZeroDistance.Address);
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, goalDownZeroDistance },
                        downTwo, distanceThree,
                        RamLiveExporter.ScoreHudExpectedNone, freshZeroGoal) != goalDownZeroDistance)
                    throw new Exception("Zero-distance Goal variant was not accepted.");
                // An unranked team must still produce a usable team object.
                // Rejecting its rank field is how Pittsburgh's object vanished
                // from a Pitt v USC game, leaving one team where orientation
                // needs two.
                if (MemoryScanner.NormalizeTeamRank(15) != 15
                    || MemoryScanner.NormalizeTeamRank(1) != 1
                    || MemoryScanner.NormalizeTeamRank(25) != 25)
                    throw new Exception("A real poll ranking was not preserved.");
                if (MemoryScanner.NormalizeTeamRank(0) != 0
                    || MemoryScanner.NormalizeTeamRank(-1) != 0
                    || MemoryScanner.NormalizeTeamRank(26) != 0
                    || MemoryScanner.NormalizeTeamRank(99) != 0
                    || MemoryScanner.NormalizeTeamRank(255) != 0)
                    throw new Exception("An unranked sentinel was not normalised to unranked.");
                // A pool-fallback pair reads the same names every sweep but from
                // whichever duplicate copies it happens to find, so its address
                // signature moves. Confirming on the names must therefore work
                // across a changed signature - otherwise the count resets every
                // pass and a correct pair is never published.
                {
                    string cAway = null, cHome = null, cAwaySig = null, cHomeSig = null;
                    int confirmations = 0;
                    bool first = RamLiveExporter.AdvanceMatchupConfirmation(
                        ref cAway, ref cHome, ref cAwaySig, ref cHomeSig, ref confirmations,
                        "USC", "Pittsburgh", "0x1000", "0x2000", false);
                    bool second = RamLiveExporter.AdvanceMatchupConfirmation(
                        ref cAway, ref cHome, ref cAwaySig, ref cHomeSig, ref confirmations,
                        "USC", "Pittsburgh", "0x3000", "0x4000", false);
                    // A fallback pair publishes on first sighting and keeps
                    // agreeing with itself as the addresses move underneath it.
                    if (!first || !second)
                        throw new Exception("A fallback pair was not confirmed on names across moving addresses.");
                    if (cAwaySig != "0x3000" || cHomeSig != "0x4000")
                        throw new Exception("Confirmation did not track the most recent addresses.");
                    // Different teams must still reset, fallback or not.
                    // A changed matchup resets the count. On the fallback path it
                    // then republishes immediately with the new teams, which is
                    // the self-correcting behaviour that makes first-sighting
                    // publication safe.
                    bool third = RamLiveExporter.AdvanceMatchupConfirmation(
                        ref cAway, ref cHome, ref cAwaySig, ref cHomeSig, ref confirmations,
                        "Ohio State", "Michigan", "0x3000", "0x4000", false);
                    if (!third || confirmations != 1 || cAway != "Ohio State")
                        throw new Exception("A changed matchup did not take over on the fallback path.");
                    // The strict path still demands matching addresses.
                    string sAway = null, sHome = null, sAwaySig = null, sHomeSig = null;
                    int strict = 0;
                    RamLiveExporter.AdvanceMatchupConfirmation(
                        ref sAway, ref sHome, ref sAwaySig, ref sHomeSig, ref strict,
                        "USC", "Pittsburgh", "0x1000", "0x2000", true);
                    if (RamLiveExporter.AdvanceMatchupConfirmation(
                        ref sAway, ref sHome, ref sAwaySig, ref sHomeSig, ref strict,
                        "USC", "Pittsburgh", "0x9000", "0xA000", true))
                        throw new Exception("The strict path confirmed despite a changed address signature.");
                }
                // Team records come off the same object as the rank. A season
                // record is "W-L"; ties only appear when there are any, so the
                // common case stays two numbers wide on the scorebug.
                if (RamLiveExporter.FormatTeamRecord(0, 0, 0) != "0-0")
                    throw new Exception("A fresh 0-0 record was not formatted as 0-0.");
                if (RamLiveExporter.FormatTeamRecord(9, 3, 0) != "9-3")
                    throw new Exception("A win-loss record was not formatted as W-L.");
                if (RamLiveExporter.FormatTeamRecord(7, 4, 1) != "7-4-1")
                    throw new Exception("A tie was not included in the record.");
                // Out-of-range numbers mean the address is not a team object.
                // Publish nothing rather than a fabricated record.
                if (RamLiveExporter.FormatTeamRecord(-1, 0, 0) != null
                    || RamLiveExporter.FormatTeamRecord(0, 250, 0) != null
                    || RamLiveExporter.FormatTeamRecord(0, 0, 100) != null)
                    throw new Exception("An impossible record was published instead of withheld.");
                if (!RamLiveExporter.ScoreHudGoalOrInchesCandidate(goalDown)
                    || !RamLiveExporter.ScoreHudGoalOrInchesCandidate(inchesDown)
                    || !RamLiveExporter.ScoreHudGoalOrInchesCandidate(goalDownZeroDistance)
                    || RamLiveExporter.ScoreHudGoalOrInchesCandidate(numericDown)
                    || RamLiveExporter.ScoreHudGoalOrInchesCandidate(kickoffDown))
                    throw new Exception("Goal/Inches classification by display text failed.");
                // 4th & Inches and goal-line snaps are exactly when the numeric
                // core reads zero, which turns on the zero-distance staleness
                // filter. A real Goal/Inches layer carries the 50 sentinel and
                // must pass straight through it; only a bare-zero candidate is
                // held back until proven live. Getting this wrong blanks the
                // down-and-distance plate for the whole play.
                HashSet<long> noTrustedAddresses = new HashSet<long>();
                List<ScoreHudDownDistanceCandidate> filteredLone =
                    RamLiveExporter.FilterTrustedZeroDistanceCandidates(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, inchesDown },
                        true, noTrustedAddresses);
                if (!filteredLone.Contains(inchesDown) || !filteredLone.Contains(numericDown))
                    throw new Exception("Zero-distance filter dropped a lone Inches layer.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        filteredLone, downTwo, distanceZero) != inchesDown)
                    throw new Exception("Lone Inches layer lost while the core read zero distance.");
                List<ScoreHudDownDistanceCandidate> filteredConflict =
                    RamLiveExporter.FilterTrustedZeroDistanceCandidates(
                        new List<ScoreHudDownDistanceCandidate> { goalDown, inchesDown },
                        true, noTrustedAddresses);
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        filteredConflict, downTwo, distanceZero) != null)
                    throw new Exception("Disagreeing Goal and Inches layers were not held back.");
                // A goal-to-go snap is neither a transition nor a zero distance,
                // so nothing used to trigger a search and the Goal layer was
                // never fetched. A new down or distance must now prompt one when
                // no special layer is held, and must not when one already is.
                if (!RamLiveExporter.ShouldRequestScoreHudSpecialDiscovery(
                        false, false, false, false, true))
                    throw new Exception("A new down/distance did not prompt a special-layer search.");
                if (RamLiveExporter.ShouldRequestScoreHudSpecialDiscovery(
                        false, false, false, true, true))
                    throw new Exception("A held special layer was needlessly re-searched.");
                if (RamLiveExporter.ShouldRequestScoreHudSpecialDiscovery(
                        false, false, false, false, false))
                    throw new Exception("An unchanged down/distance prompted a search.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, kickoffDown },
                        downTwo, distanceThree) != numericDown)
                    throw new Exception("Stale Kickoff layer replaced a live scrimmage down.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, kickoffDown },
                        downTwo, distanceThree,
                        RamLiveExporter.ScoreHudExpectedKickoff) != kickoffDown)
                    throw new Exception("Transition-backed Kickoff did not replace underlying yardage.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { kickoffDown },
                        downTwo, distanceThree) != null)
                    throw new Exception("Lone stale Kickoff entered the generic fallback.");
                ScoreHudDownDistanceCandidate patDown = new ScoreHudDownDistanceCandidate
                {
                    Address = 0x2300, Display = "PAT", Down = -1,
                    Distance = 50, IsEmpty = false
                };
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { patDown },
                        downTwo, distanceThree) != null
                    || RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, patDown },
                        downTwo, distanceThree,
                        RamLiveExporter.ScoreHudExpectedConversion) != patDown)
                    throw new Exception("PAT transition/stale-state gate failed.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { kickoffDown, goalDown },
                        downTwo, distanceZero,
                        RamLiveExporter.ScoreHudExpectedKickoff) != kickoffDown)
                    throw new Exception("Expected Kickoff conflicted with stale Goal yardage.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { kickoffDown, patDown },
                        downTwo, distanceThree,
                        RamLiveExporter.ScoreHudExpectedConversion) != patDown)
                    throw new Exception("Expected conversion did not ignore stale Kickoff.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { kickoffDown, patDown },
                        RamReadResult.Missing(), RamReadResult.Missing()) != null)
                    throw new Exception("Cold attach guessed a non-scrimmage special class.");
                inchesDown.IsEmpty = true;
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, inchesDown },
                        downTwo, distanceThree) != numericDown)
                    throw new Exception("Hidden special layer replaced live numeric yardage.");
                inchesDown.IsEmpty = false;
                inchesDown.Down = 3;
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown, inchesDown },
                        downTwo, distanceThree) != numericDown)
                    throw new Exception("Mismatched-down special layer replaced numeric yardage.");
                inchesDown.Down = 2;
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { goalDown, inchesDown },
                        downTwo, distanceZero) != null)
                    throw new Exception("Conflicting visible special layers did not fail closed.");
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        new List<ScoreHudDownDistanceCandidate> { numericDown },
                        downTwo, distanceZero) != null)
                    throw new Exception("Ambiguous bare distance zero was guessed as Goal.");
                HashSet<long> trustedZeroDistance = new HashSet<long>();
                List<ScoreHudDownDistanceCandidate> filteredZeroDistance =
                    RamLiveExporter.FilterTrustedZeroDistanceCandidates(
                        new List<ScoreHudDownDistanceCandidate> { goalDown, inchesDown },
                        true, trustedZeroDistance);
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        filteredZeroDistance, downTwo, distanceZero) != null)
                    throw new Exception("Pre-edge pooled Goal/Inches candidate was trusted.");
                trustedZeroDistance.Add(inchesDown.Address);
                filteredZeroDistance = RamLiveExporter.FilterTrustedZeroDistanceCandidates(
                    new List<ScoreHudDownDistanceCandidate> { goalDown, inchesDown },
                    true, trustedZeroDistance);
                if (RamLiveExporter.SelectScoreHudDownDistanceCandidate(
                        filteredZeroDistance, downTwo, distanceZero) != inchesDown
                    || String.Equals(RamLiveExporter.ScoreHudCandidateStateKey(goalDown),
                        RamLiveExporter.ScoreHudCandidateStateKey(inchesDown),
                        StringComparison.Ordinal))
                    throw new Exception("Fresh zero-distance special activation was not isolated.");
                HashSet<long> semanticZeroDistanceChange = new HashSet<long>
                    { inchesDown.Address };
                RamReadResult downOne = new RamReadResult(true, 1, 1, 1, 1);
                if (RamLiveExporter.ScoreHudZeroDistanceProofMatches(
                        inchesDown, downOne, semanticZeroDistanceChange)
                    || !RamLiveExporter.ScoreHudZeroDistanceProofMatches(
                        inchesDown, downTwo, semanticZeroDistanceChange)
                    || RamLiveExporter.ScoreHudZeroDistanceProofMatches(
                        inchesDown, downTwo, new HashSet<long>()))
                    throw new Exception("Zero-distance proof was not bound to the live down and semantic edge.");
                if (RamLiveExporter.ShouldRequestScoreHudSpecialDiscovery(
                        false, true, true, true))
                    throw new Exception("Resolved special state scheduled another full RAM sweep.");
                if (!RamLiveExporter.ShouldRequestScoreHudSpecialDiscovery(
                        true, true, false, true))
                    throw new Exception("A new score/quarter transition did not schedule one fresh scan.");
                if (!RamLiveExporter.ShouldRequestScoreHudSpecialDiscovery(
                        false, true, false, false))
                    throw new Exception("Unresolved special transition did not keep searching.");

                if (RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 0, 0, 1, 6, 0) != RamLiveExporter.ScoreHudExpectedConversion
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 6, 0, 1, 7, 0) != RamLiveExporter.ScoreHudExpectedKickoff
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 0, 0, 1, 0, 2) != RamLiveExporter.ScoreHudExpectedKickoff
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 0, 0, 1, 3, 0) != RamLiveExporter.ScoreHudExpectedKickoff
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 0, 0, 1, 7, 0) != RamLiveExporter.ScoreHudExpectedKickoff
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 0, 0, 1, 0, 8) != RamLiveExporter.ScoreHudExpectedKickoff
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        2, 10, 7, 3, 10, 7) != RamLiveExporter.ScoreHudExpectedKickoff
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 0, 0, 1, 4, 0) != RamLiveExporter.ScoreHudExpectedAwaitScrimmage
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        4, 21, 21, 5, 21, 21) != RamLiveExporter.ScoreHudExpectedAwaitScrimmage
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        5, 21, 21, 5, 24, 21) != RamLiveExporter.ScoreHudExpectedAwaitScrimmage
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        5, 21, 21, 5, 27, 21) != RamLiveExporter.ScoreHudExpectedConversion
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        6, 28, 28, 7, 28, 28) != RamLiveExporter.ScoreHudExpectedConversion
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        7, 28, 28, 7, 30, 28) != RamLiveExporter.ScoreHudExpectedConversion
                    || RamLiveExporter.ExpectedScoreHudSpecialForTransition(
                        1, 0, 0, 1, 0, 0) != RamLiveExporter.ScoreHudExpectedNone)
                    throw new Exception("ScoreHud transition class inference failed.");
                if (RamLiveExporter.ExpectedScoreHudSpecialForColdBaseline(
                        true, true, true, false) != RamLiveExporter.ScoreHudExpectedNone
                    || RamLiveExporter.ExpectedScoreHudSpecialForColdBaseline(
                        true, false, true, false) != RamLiveExporter.ScoreHudExpectedNone
                    || RamLiveExporter.ExpectedScoreHudSpecialForColdBaseline(
                        true, false, false, true) != RamLiveExporter.ScoreHudExpectedNone
                    || RamLiveExporter.ExpectedScoreHudSpecialForColdBaseline(
                        true, false, true, true) != RamLiveExporter.ScoreHudExpectedNone)
                    throw new Exception("Cold attach trusted a retained pooled special.");
                if (RamLiveExporter.FailedConversionKickoffObservationIsValid(
                        RamLiveExporter.ScoreHudExpectedConversion,
                        true, false, false, true))
                    throw new Exception("Pooled Kickoff visibility advanced a conversion.");
                if (RamLiveExporter.FailedConversionKickoffPromotionIsSafe(
                        RamLiveExporter.ScoreHudExpectedConversion,
                        false, true, false, true, 1)
                    || RamLiveExporter.FailedConversionKickoffPromotionIsSafe(
                         RamLiveExporter.ScoreHudExpectedConversion,
                         false, true, false, true, 2)
                    || RamLiveExporter.FailedConversionKickoffPromotionIsSafe(
                         RamLiveExporter.ScoreHudExpectedConversion,
                         true, true, false, true, 2)
                    || RamLiveExporter.FailedConversionKickoffPromotionIsSafe(
                         RamLiveExporter.ScoreHudExpectedConversion,
                         false, true, true, true, 2))
                    throw new Exception("Failed-conversion Kickoff phase gate failed.");

                int observedPlayClock = 23;
                bool playClockResetSeen = false;
                bool allowInitialPlayClockEpoch = false;
                int completedPlayClockEpochs = 0;
                RamLiveExporter.ObservePlayClockEpoch(
                    new RamReadResult(true, 23, 1, 1, 1),
                    ref observedPlayClock, ref playClockResetSeen,
                    ref allowInitialPlayClockEpoch,
                    ref completedPlayClockEpochs);
                RamLiveExporter.ObservePlayClockEpoch(
                    new RamReadResult(true, 25, 1, 1, 1),
                    ref observedPlayClock, ref playClockResetSeen,
                    ref allowInitialPlayClockEpoch,
                    ref completedPlayClockEpochs);
                RamLiveExporter.ObservePlayClockEpoch(
                    new RamReadResult(true, 24, 1, 1, 1),
                    ref observedPlayClock, ref playClockResetSeen,
                    ref allowInitialPlayClockEpoch,
                    ref completedPlayClockEpochs);
                if (completedPlayClockEpochs != 1)
                    throw new Exception("Post-transition play-clock epoch was not detected.");
                int conversionPlayClock = 24;
                bool conversionResetSeen = false;
                bool allowInitialConversionEpoch = true;
                int conversionEpochs = 0;
                RamLiveExporter.ObservePlayClockEpoch(
                    new RamReadResult(true, 23, 1, 1, 1),
                    ref conversionPlayClock, ref conversionResetSeen,
                    ref allowInitialConversionEpoch,
                    ref conversionEpochs);
                RamLiveExporter.ObservePlayClockEpoch(
                    new RamReadResult(true, 25, 1, 1, 1),
                    ref conversionPlayClock, ref conversionResetSeen,
                    ref allowInitialConversionEpoch,
                    ref conversionEpochs);
                RamLiveExporter.ObservePlayClockEpoch(
                    new RamReadResult(true, 24, 1, 1, 1),
                    ref conversionPlayClock, ref conversionResetSeen,
                    ref allowInitialConversionEpoch,
                    ref conversionEpochs);
                if (conversionEpochs != 2)
                    throw new Exception("Initial conversion and next-phase play-clock epochs were not separated.");

                int observedGameClock = 300;
                bool gameClockMoved = false;
                int epochsAtLastGameClockChange = 0;
                RamLiveExporter.ObserveGameClockProgress(
                    new RamReadResult(true, 299, 1, 1, 1),
                    ref observedGameClock, ref gameClockMoved,
                    ref epochsAtLastGameClockChange, 1);
                RamLiveExporter.ObserveGameClockProgress(
                    new RamReadResult(true, 298, 1, 1, 1),
                    ref observedGameClock, ref gameClockMoved,
                    ref epochsAtLastGameClockChange, 2);
                bool postGameClockEpoch = gameClockMoved
                    && 2 > epochsAtLastGameClockChange;
                if (!gameClockMoved || epochsAtLastGameClockChange != 1
                    || !postGameClockEpoch)
                    throw new Exception("Post-play game/play-clock lifecycle was not detected.");

                if (RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedKickoff, false,
                        true, false, false, true, 1, false, false, false, false, false, -1)
                    || !RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedKickoff, false,
                        true, false, false, true, 1, true, true, false, false, false, -1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedConversion, false,
                        true, false, false, true, 3, false, true, false, false, false, -1)
                    || !RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedConversion, false,
                        true, false, false, true, 1, true, true, false, false, false, -1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedAwaitScrimmage, true,
                        true, false, false, false, 1, false, false, false, false, false, -1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                         RamLiveExporter.ScoreHudExpectedAwaitScrimmage, true,
                         true, false, false, true, 1, false, false, false, false, true, 1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                         RamLiveExporter.ScoreHudExpectedConversion, true,
                         true, false, true, false, 2, false, false, false, false, true, 2)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                         RamLiveExporter.ScoreHudExpectedConversion, true,
                         true, false, false, true, 2, false, false, false, false, false, -1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                         RamLiveExporter.ScoreHudExpectedConversion, true,
                         true, false, false, true, 2, false, false, true, false, true, 2)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedConversion, true,
                        true, false, false, true, 4, false, false, true, true, true, 2)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedKickoff, false,
                        true, false, false, true, 2, false, false, false, false, false, -1)
                    || !RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedKickoff, false,
                        true, false, false, true, 2, false, false, false, false, true, 2)
                    || !RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedConversion, false,
                        true, false, false, true, 3, false, false, false, false, true, 3)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedKickoff, false,
                        false, false, true, true, 3, true, true, true, false, true, 3)
                    || !RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedKickoff, false,
                        false, true, false, true, 1, true, true, false, false, false, -1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedKickoff, false,
                        false, true, false, true, 1, false, true, false, false, true, 1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedNone, false,
                        false, true, false, true, 1, true, true, false, false, false, -1)
                    || RamLiveExporter.ScoreHudNumericResumeIsSafe(
                        RamLiveExporter.ScoreHudExpectedConversion, true,
                        false, true, true, true, 3, true, true, true, false, true, 3)
                    || RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                        true, false, false, true, false, false, 1)
                    || RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                        true, false, true, false, false, false, 1)
                    || !RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                        true, false, true, true, false, false, 1)
                    || RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                        true, false, false, false, true, false, 1)
                    || RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                         true, false, false, false, true, true, 1)
                    || !RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                         false, true, true, true, false, false, 1)
                    || RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                         false, true, false, true, false, false, 1)
                    || RamLiveExporter.ColdScoreHudNumericResumeIsSafe(
                         false, true, true, true, true, false, 1))
                    throw new Exception("ScoreHud transition retirement gate failed.");
                if (RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedKickoff, false, false, 0, false)
                    || RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedKickoff, false, false, 1, false)
                    || !RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedKickoff, false, false, 2, false)
                    || RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedConversion, false, false, 1, false)
                    || !RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedConversion, false, false, 2, false)
                    || RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedConversion, true, false, 1, false)
                    || !RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedConversion, true, false, 2, false)
                    || RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedConversion, true, false, 4, true)
                    || !RamLiveExporter.ShouldSuppressExpectedScoreHudSpecial(
                        RamLiveExporter.ScoreHudExpectedKickoff, false, true, 0, false))
                    throw new Exception("Stale expected special was not suppressed safely.");

                if (!RamLiveExporter.MatchupRediscoveryIsRequired(true, 0, true)
                    || RamLiveExporter.MatchupRediscoveryIsRequired(true, 5, false)
                    || !RamLiveExporter.MatchupRediscoveryIsRequired(false, 5, false))
                    throw new Exception("Special-state matchup transition gate failed.");

                RamLiveExporter scanGate = new RamLiveExporter(null, null);
                long firstScanToken;
                long secondScanToken;
                if (!scanGate.TryAcquireFullMemoryScan(out firstScanToken)
                    || scanGate.TryAcquireFullMemoryScan(out secondScanToken))
                    throw new Exception("Full-memory scan coordinator allowed overlap.");
                scanGate.ReleaseFullMemoryScan(firstScanToken + 1);
                if (scanGate.TryAcquireFullMemoryScan(out secondScanToken))
                    throw new Exception("A stale scan token released the active scan.");
                scanGate.ReleaseFullMemoryScan(firstScanToken);
                if (!scanGate.TryAcquireFullMemoryScan(out secondScanToken))
                    throw new Exception("Full-memory scan coordinator did not release.");
                scanGate.ReleaseFullMemoryScan(secondScanToken);

                List<ScoreHudTeamCandidate> tiedScoreTeams = new List<ScoreHudTeamCandidate>
                {
                    new ScoreHudTeamCandidate { Address = 0x1000, TeamId = 0, Rank = 7, Timeouts = 2, Score = 0, HasPossession = 1 },
                    new ScoreHudTeamCandidate { Address = 0x2000, TeamId = 33, Rank = 8, Timeouts = 3, Score = 0, HasPossession = 0 }
                };
                ScoreHudTeamCandidate selectedAway;
                ScoreHudTeamCandidate selectedHome;
                bool distinctScoreEvidence;
                if (!RamLiveExporter.TrySelectFreshScoreHudSides(tiedScoreTeams,
                    new RamReadResult(true, 0, 1, 1, 1), new RamReadResult(true, 0, 1, 1, 1),
                    new RamReadResult(true, 1, 1, 1, 1),
                    out selectedAway, out selectedHome, out distinctScoreEvidence)
                    || distinctScoreEvidence || selectedAway.Rank != 7 || selectedHome.Rank != 8)
                    throw new Exception("Possession-oriented tied-score rank mapping failed.");

                tiedScoreTeams[0].HasPossession = 0;
                if (RamLiveExporter.TrySelectFreshScoreHudSides(tiedScoreTeams,
                    new RamReadResult(true, 0, 1, 1, 1), new RamReadResult(true, 0, 1, 1, 1),
                    new RamReadResult(true, 1, 1, 1, 1),
                    out selectedAway, out selectedHome, out distinctScoreEvidence))
                    throw new Exception("Ambiguous tied-score rank mapping was accepted.");

                List<ScoreHudTeamCandidate> distinctScoreTeams = new List<ScoreHudTeamCandidate>
                {
                    new ScoreHudTeamCandidate { Address = 0x3000, TeamId = 41, Rank = 12, Score = 7, HasPossession = 0 },
                    new ScoreHudTeamCandidate { Address = 0x4000, TeamId = 52, Rank = 4, Score = 14, HasPossession = 0 }
                };
                if (!RamLiveExporter.TrySelectFreshScoreHudSides(distinctScoreTeams,
                    new RamReadResult(true, 14, 1, 1, 1), new RamReadResult(true, 7, 1, 1, 1),
                    RamReadResult.Missing(), out selectedAway, out selectedHome, out distinctScoreEvidence)
                    || !distinctScoreEvidence || selectedAway.TeamId != 52 || selectedHome.TeamId != 41)
                    throw new Exception("Distinct-score rank orientation failed.");

                string atomicDirectory = Path.Combine(Path.GetTempPath(),
                    "cfb27-ram-self-test-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(atomicDirectory);
                try
                {
                    string atomicPath = Path.Combine(atomicDirectory, "live-game-data.json");
                    RamLiveExporter.WriteSharedText(atomicPath, "{\"sequence\":1}");
                    RamLiveExporter.WriteSharedText(atomicPath, "{\"sequence\":2}");
                    if (!String.Equals(File.ReadAllText(atomicPath), "{\"sequence\":2}",
                            StringComparison.Ordinal)
                        || Directory.GetFiles(atomicDirectory, "*.tmp").Length != 0)
                        throw new Exception("Atomic shared-output replacement failed.");
                }
                finally
                {
                    if (Directory.Exists(atomicDirectory))
                        Directory.Delete(atomicDirectory, true);
                }

                string result = "{\"passed\":true,\"away\":\"Texas\",\"clockSeconds\":257,\"manualClockSeconds\":291,\"oneScanOverride\":true,\"matchupConfirmationTests\":true,\"rankOrientationTests\":true,\"fixedSideTimeoutTests\":true,\"possessionFailClosedTests\":true,\"wideDuplicateDownTests\":true,\"wideProgressionTests\":true,\"teamRoleVectorTests\":true,\"roleBindingLifecycleTests\":true,\"processIdentityTests\":true,\"timeoutContextMaskTests\":true,\"specialDownStateTests\":true,\"atomicSharedOutputTests\":true,\"fullScanCoordinatorTests\":true,\"backgroundGenerationTests\":true,\"pendingEpochRestartTests\":true}";
                if (!String.IsNullOrWhiteSpace(outputPath)) File.WriteAllText(outputPath, result);
                return 0;
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(outputPath))
                {
                    File.WriteAllText(outputPath, "{\"passed\":false,\"error\":\"" + Escape(error.Message) + "\"}");
                }
                return 1;
            }
        }

        private static string Escape(string value)
        {
            return (value ?? String.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static FieldChoice FindField(List<FieldChoice> fields, string name)
        {
            for (int i = 0; i < fields.Count; i++)
            {
                if (String.Equals(fields[i].Name, name, StringComparison.Ordinal)) return fields[i];
            }
            throw new Exception("Missing field choice: " + name);
        }
    }
}

