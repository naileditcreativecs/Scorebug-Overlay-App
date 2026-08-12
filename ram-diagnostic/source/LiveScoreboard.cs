using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;

namespace CollegeFootballRamDiagnostic
{
    internal sealed class LiveScoreboard
    {
        public string AwayName;
        public int AwayScore;
        public int AwayTimeouts;
        public bool AwayPossession;
        public string HomeName;
        public int HomeScore;
        public int HomeTimeouts;
        public bool HomePossession;
        public string Quarter;
        public int QuarterNumber;
        public string GameClock;
        public int GameClockSeconds;
        public int PlayClock;
        public int Down;
        public int Distance;
        public string UpdatedAt;

        public static LiveScoreboard Parse(string json)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> root = AsMap(serializer.DeserializeObject(json));
            Dictionary<string, object> away = Child(root, "away");
            Dictionary<string, object> home = Child(root, "home");
            Dictionary<string, object> game = Child(root, "game");
            Dictionary<string, object> meta = Child(root, "meta");

            LiveScoreboard result = new LiveScoreboard();
            result.AwayName = Text(away, "name");
            result.AwayScore = Integer(away, "score");
            result.AwayTimeouts = Integer(away, "timeouts");
            result.AwayPossession = Boolean(away, "possession");
            result.HomeName = Text(home, "name");
            result.HomeScore = Integer(home, "score");
            result.HomeTimeouts = Integer(home, "timeouts");
            result.HomePossession = Boolean(home, "possession");
            result.Quarter = Text(game, "quarter");
            result.QuarterNumber = ParseQuarter(result.Quarter);
            result.GameClock = Text(game, "clock");
            result.GameClockSeconds = ParseClock(result.GameClock);
            result.PlayClock = Integer(game, "playClock");
            result.Down = Integer(game, "down");
            result.Distance = Integer(game, "distance");
            result.UpdatedAt = Text(meta, "updatedAt");
            return result;
        }

        public string Summary()
        {
            return String.Format(CultureInfo.InvariantCulture,
                "{0} {1} ({2} TO)  -  {3} {4} ({5} TO)    {6} {7}    Play clock {8}    Possession: {9}",
                AwayName, AwayScore, AwayTimeouts, HomeName, HomeScore, HomeTimeouts,
                Quarter, GameClock, PlayClock, AwayPossession ? AwayName : (HomePossession ? HomeName : "unknown"));
        }

        private static int ParseQuarter(string text)
        {
            if (String.IsNullOrWhiteSpace(text)) return 0;
            string value = text.Trim().ToUpperInvariant();
            if (value.StartsWith("1")) return 1;
            if (value.StartsWith("2")) return 2;
            if (value.StartsWith("3")) return 3;
            if (value.StartsWith("4")) return 4;
            if (value.Contains("OT")) return 5;
            return 0;
        }

        private static int ParseClock(string text)
        {
            if (String.IsNullOrWhiteSpace(text)) return 0;
            string[] pieces = text.Trim().Split(':');
            int minutes;
            int seconds;
            if (pieces.Length == 2 && Int32.TryParse(pieces[0], out minutes) && Int32.TryParse(pieces[1], out seconds))
            {
                return Math.Max(0, minutes * 60 + seconds);
            }
            return 0;
        }

        private static Dictionary<string, object> AsMap(object value)
        {
            Dictionary<string, object> map = value as Dictionary<string, object>;
            return map ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }

        private static Dictionary<string, object> Child(Dictionary<string, object> map, string key)
        {
            object value;
            return map.TryGetValue(key, out value) ? AsMap(value) : new Dictionary<string, object>();
        }

        private static string Text(Dictionary<string, object> map, string key)
        {
            object value;
            return map.TryGetValue(key, out value) && value != null ? Convert.ToString(value, CultureInfo.InvariantCulture) : String.Empty;
        }

        private static int Integer(Dictionary<string, object> map, string key)
        {
            object value;
            int result;
            if (!map.TryGetValue(key, out value) || value == null) return 0;
            return Int32.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out result) ? result : 0;
        }

        private static bool Boolean(Dictionary<string, object> map, string key)
        {
            object value;
            bool result;
            if (!map.TryGetValue(key, out value) || value == null) return false;
            return System.Boolean.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out result) && result;
        }
    }

    internal sealed class FieldChoice
    {
        public string Name;
        public Func<LiveScoreboard, long> ReadValue;
        public double RecommendedTolerance;
        public ManualInputKind ManualInputKind;
        public int Minimum;
        public int Maximum;
        public string ManualHint;

        public FieldChoice(
            string name,
            Func<LiveScoreboard, long> readValue,
            double recommendedTolerance,
            ManualInputKind manualInputKind,
            int minimum,
            int maximum,
            string manualHint)
        {
            Name = name;
            ReadValue = readValue;
            RecommendedTolerance = recommendedTolerance;
            ManualInputKind = manualInputKind;
            Minimum = minimum;
            Maximum = maximum;
            ManualHint = manualHint;
        }

        public override string ToString()
        {
            return Name;
        }

        public static List<FieldChoice> All()
        {
            return new List<FieldChoice>
            {
                new FieldChoice("Away score", delegate(LiveScoreboard s) { return s.AwayScore; }, 0, ManualInputKind.Integer, 0, 255, "0-255"),
                new FieldChoice("Home score", delegate(LiveScoreboard s) { return s.HomeScore; }, 0, ManualInputKind.Integer, 0, 255, "0-255"),
                new FieldChoice("Quarter (1-4, OT=5)", delegate(LiveScoreboard s) { return s.QuarterNumber; }, 0, ManualInputKind.Integer, 1, 5, "1-5"),
                new FieldChoice("Game clock (total seconds)", delegate(LiveScoreboard s) { return s.GameClockSeconds; }, 2, ManualInputKind.ClockSeconds, 0, 0, "M:SS"),
                new FieldChoice("Game clock (milliseconds)", delegate(LiveScoreboard s) { return s.GameClockSeconds * 1000L; }, 2500, ManualInputKind.ClockMilliseconds, 0, 0, "M:SS"),
                new FieldChoice("Play clock", delegate(LiveScoreboard s) { return s.PlayClock; }, 2, ManualInputKind.Integer, 0, 99, "0-99"),
                new FieldChoice("Away timeouts", delegate(LiveScoreboard s) { return s.AwayTimeouts; }, 0, ManualInputKind.Integer, 0, 3, "0-3"),
                new FieldChoice("Home timeouts", delegate(LiveScoreboard s) { return s.HomeTimeouts; }, 0, ManualInputKind.Integer, 0, 3, "0-3"),
                new FieldChoice("Possession (away=1, home=0)", delegate(LiveScoreboard s) { return s.AwayPossession ? 1 : 0; }, 0, ManualInputKind.Possession, 0, 1, "away/home")
            };
        }

        public bool TryParseManual(string input, out int value, out string error)
        {
            value = 0;
            error = null;
            string text = (input ?? String.Empty).Trim();
            if (text.Length == 0)
            {
                error = "Enter a manual value first.";
                return false;
            }

            if (ManualInputKind == ManualInputKind.Possession)
            {
                if (String.Equals(text, "away", StringComparison.OrdinalIgnoreCase)) value = 1;
                else if (String.Equals(text, "home", StringComparison.OrdinalIgnoreCase)) value = 0;
                else
                {
                    error = "Enter away or home for possession.";
                    return false;
                }
                return true;
            }

            if (ManualInputKind == ManualInputKind.ClockSeconds || ManualInputKind == ManualInputKind.ClockMilliseconds)
            {
                string[] pieces = text.Split(':');
                int minutes;
                int seconds;
                if (pieces.Length != 2
                    || !Int32.TryParse(pieces[0], NumberStyles.None, CultureInfo.InvariantCulture, out minutes)
                    || !Int32.TryParse(pieces[1], NumberStyles.None, CultureInfo.InvariantCulture, out seconds)
                    || minutes < 0 || seconds < 0 || seconds > 59)
                {
                    error = "Enter the clock as M:SS, for example 4:51.";
                    return false;
                }
                long totalSeconds = (long)minutes * 60L + seconds;
                long converted = ManualInputKind == ManualInputKind.ClockMilliseconds
                    ? totalSeconds * 1000L
                    : totalSeconds;
                if (converted > Int32.MaxValue)
                {
                    error = "That clock value is too large for a 32-bit scan.";
                    return false;
                }
                value = (int)converted;
                return true;
            }

            int numeric;
            if (!Int32.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out numeric)
                || numeric < Minimum || numeric > Maximum)
            {
                error = "Enter a whole number from " + Minimum.ToString(CultureInfo.InvariantCulture)
                    + " through " + Maximum.ToString(CultureInfo.InvariantCulture) + ".";
                return false;
            }
            value = numeric;
            return true;
        }
    }

    internal enum ManualInputKind
    {
        Integer,
        ClockSeconds,
        ClockMilliseconds,
        Possession
    }

    internal sealed class ManualExpectedOverride
    {
        public bool Armed { get; private set; }
        public string FieldName { get; private set; }
        public string Input { get; private set; }
        public int Value { get; private set; }

        public void Arm(FieldChoice field, string input, int value)
        {
            if (field == null) throw new ArgumentNullException("field");
            Armed = true;
            FieldName = field.Name;
            Input = (input ?? String.Empty).Trim();
            Value = value;
        }

        public bool AppliesTo(FieldChoice field)
        {
            return Armed && field != null && String.Equals(FieldName, field.Name, StringComparison.Ordinal);
        }

        public bool Consume(FieldChoice field, out string input, out int value)
        {
            input = null;
            value = 0;
            if (!AppliesTo(field)) return false;
            input = Input;
            value = Value;
            Clear();
            return true;
        }

        public void Clear()
        {
            Armed = false;
            FieldName = null;
            Input = null;
            Value = 0;
        }
    }
}
