using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace CollegeFootballRamDiagnostic
{
    // Pure helpers for the research probes (penalty / stats / toggle). Kept
    // free of process access so the self-test can prove them offline.
    internal static class ResearchProbeHelpers
    {
        // The words the game's penalty result card is expected to contain.
        // Distinctive fragments, both title case and upper case; the probe
        // logs every occurrence in the ScoreHud heap window at flag time and
        // ~25 s later so the live card's copy can be told from the static
        // string table (present at both times).
        public static readonly string[] PenaltyWords = new string[]
        {
            // Round 2 (probe game 2026-08-18) found the live penalty in three
            // places, none of them the on-screen card text: the commentary
            // speech context ("ctxn=PENALTY_DEF_ENCROACHMENT_WITHIN_5_YARDS&
            // snti=..&cdwn=..&ytof=.."), the announcer clip path
            // ("Sound/Speech/BASE/SoundWaves/bPENALTY_DEF_ENCROACHMENT") and
            // the referee-presentation node ("Penalty_0632_Encroachment_01 -
            // 0): enabledState: 2, activated: 1"). Search those anchors first;
            // the bare words stay as a fallback.
            "ctxn=PENALTY", "SoundWaves/bPENALTY", "enabledState: 2", "NIS_Penalty_", "AFT_DEF_PENALTY", "AFT_OFF_PENALTY",
            "Holding", "HOLDING", "Interference", "INTERFERENCE", "False Start", "FALSE START", "FalseStart",
            "Offside", "OFFSIDE", "Facemask", "FACEMASK", "Face Mask", "FACE MASK",
            "Roughing", "ROUGHING", "Encroachment", "ENCROACHMENT", "Delay of Game", "DELAY OF GAME", "DelayOfGame", "DELAY_OF_GAME",
            "Illegal", "ILLEGAL", "Unsportsmanlike", "UNSPORTSMANLIKE", "Personal Foul", "PERSONAL FOUL", "PersonalFoul",
            "Targeting", "TARGETING", "Grounding", "GROUNDING", "Clipping", "CLIPPING",
            "Chop Block", "CHOP BLOCK", "Horse Collar", "HORSE COLLAR", "Neutral Zone", "NEUTRAL ZONE",
            "Too Many", "TOO MANY", "Ineligible", "INELIGIBLE", "Tripping", "TRIPPING",
            "Kick Catch", "KICK CATCH"
        };

        // Compare two int32 snapshots of the same window. Returns the offsets
        // whose value rose by 1..maxStep and stayed inside 0..maxValue - the
        // shape a running stat (yards, first downs, attempts) has - and marks
        // any offset that ever went DOWN as disqualified for the rest of the
        // game (a stat never decreases; a pointer or timer does).
        public static Dictionary<int, int[]> DiffMonotonicCounters(int[] previous, int[] current,
            bool[] disqualified, int[] riseCount, int maxValue, int maxStep, int maxResults)
        {
            Dictionary<int, int[]> rises = new Dictionary<int, int[]>();
            if (previous == null || current == null) return rises;
            int length = Math.Min(previous.Length, current.Length);
            for (int index = 0; index < length; index++)
            {
                if (disqualified != null && index < disqualified.Length && disqualified[index]) continue;
                int before = previous[index];
                int after = current[index];
                if (after == before) continue;
                if (after < before)
                {
                    // Going backwards is allowed only from a garbage value into
                    // range (memory reused); a real drop inside range disqualifies.
                    if (before >= 0 && before <= maxValue && after >= 0
                        && disqualified != null && index < disqualified.Length) disqualified[index] = true;
                    continue;
                }
                if (before < 0 || before > maxValue || after > maxValue) continue;
                if (after - before > maxStep) continue;
                if (riseCount != null && index < riseCount.Length) riseCount[index]++;
                if (rises.Count < maxResults) rises[index] = new int[] { before, after };
            }
            return rises;
        }

        // Byte-level toggles between tiny values (0..maxValue): the shape a
        // "menu open" flag would have.
        public static Dictionary<int, int[]> DiffSmallBytes(byte[] previous, byte[] current, int maxValue, int maxResults)
        {
            Dictionary<int, int[]> changes = new Dictionary<int, int[]>();
            if (previous == null || current == null) return changes;
            int length = Math.Min(previous.Length, current.Length);
            for (int index = 0; index < length; index++)
            {
                if (previous[index] == current[index]) continue;
                if (previous[index] > maxValue || current[index] > maxValue) continue;
                if (changes.Count >= maxResults) break;
                changes[index] = new int[] { previous[index], current[index] };
            }
            return changes;
        }

        public static string HexOffset(int offset)
        {
            return (offset < 0 ? "-0x" : "0x") + Math.Abs(offset).ToString("X", CultureInfo.InvariantCulture);
        }

        // Printable ASCII run starting at `start` (up to maxLength chars).
        public static string AsciiPreview(byte[] bytes, int start, int maxLength)
        {
            if (bytes == null || start < 0 || start >= bytes.Length) return String.Empty;
            StringBuilder builder = new StringBuilder();
            for (int index = start; index < bytes.Length && builder.Length < maxLength; index++)
            {
                byte value = bytes[index];
                if (value < 0x20 || value > 0x7E) break;
                builder.Append((char)value);
            }
            return builder.ToString();
        }

        // Printable ASCII run ENDING at `end` (walks backwards), for the text
        // that precedes a matched word.
        public static string AsciiRun(byte[] bytes, int start, int end)
        {
            if (bytes == null || end <= 0) return String.Empty;
            int begin = Math.Min(end, bytes.Length);
            int index = begin - 1;
            while (index >= start && index >= 0 && bytes[index] >= 0x20 && bytes[index] <= 0x7E) index--;
            StringBuilder builder = new StringBuilder();
            for (int i = index + 1; i < begin; i++) builder.Append((char)bytes[i]);
            return builder.ToString();
        }

        public static List<int> Int16Window(byte[] bytes, int start, int count)
        {
            List<int> values = new List<int>();
            if (bytes == null) return values;
            for (int index = 0; index < count; index++)
            {
                int offset = start + index * 2;
                if (offset < 0 || offset + 2 > bytes.Length) { values.Add(0); continue; }
                values.Add(BitConverter.ToInt16(bytes, offset));
            }
            return values;
        }

        public static List<int> Int32Window(byte[] bytes, int start, int count)
        {
            List<int> values = new List<int>();
            if (bytes == null) return values;
            for (int index = 0; index < count; index++)
            {
                int offset = start + index * 4;
                if (offset < 0 || offset + 4 > bytes.Length) { values.Add(0); continue; }
                values.Add(BitConverter.ToInt32(bytes, offset));
            }
            return values;
        }
    }
}
