using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace CollegeFootballRamDiagnostic
{
    internal sealed class MainForm : Form
    {
        private readonly MemoryScanner scanner = new MemoryScanner();
        private readonly System.Windows.Forms.Timer liveTimer = new System.Windows.Forms.Timer();
        private readonly ManualExpectedOverride manualOverride = new ManualExpectedOverride();
        private readonly List<Dictionary<string, object>> scanHistory = new List<Dictionary<string, object>>();
        private readonly RamLiveExporter ramExporter;
        private CancellationTokenSource scanCancellation;
        private DateTime nextAutoAttachUtc;
        private LiveScoreboard live;
        private string liveJsonPath;
        private string reportFolder;

        private Label processLabel;
        private TextBox jsonPathBox;
        private Label liveLabel;
        private Label ramExportLabel;
        private ComboBox fieldBox;
        private NumericUpDown toleranceBox;
        private Label expectedLabel;
        private Label expectedSourceLabel;
        private Label manualValueLabel;
        private TextBox manualValueBox;
        private Button useManualButton;
        private Label candidateLabel;
        private ProgressBar progressBar;
        private ListView candidatesView;
        private TextBox logBox;
        private Button attachButton;
        private Button firstScanButton;
        private Button nextExactButton;
        private Button changedButton;
        private Button unchangedButton;
        private Button increasedButton;
        private Button decreasedButton;
        private Button resetButton;
        private Button stopButton;
        private Button saveButton;

        public MainForm()
        {
            Text = "College Football 27 - Read-Only RAM Diagnostic";
            Width = 1160;
            Height = 790;
            MinimumSize = new Size(980, 680);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9F);
            BackColor = Color.FromArgb(245, 247, 250);
            liveJsonPath = DefaultLiveJsonPath();
            reportFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "reports");
            ramExporter = new RamLiveExporter(scanner, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ram-live-profile.json"));
            BuildInterface();
            liveTimer.Interval = 100;
            liveTimer.Tick += delegate { RefreshLiveState(); };
            liveTimer.Start();
            FormClosed += delegate { scanner.Dispose(); if (scanCancellation != null) scanCancellation.Cancel(); };
            Shown += delegate { AttachToGame(false); RefreshLiveState(); };
        }

        private void BuildInterface()
        {
            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.Padding = new Padding(14);
            root.ColumnCount = 1;
            root.RowCount = 7;
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 60));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 40));
            Controls.Add(root);

            Label title = new Label();
            title.AutoSize = true;
            title.Font = new Font("Segoe UI Semibold", 18F);
            title.Text = "Read-only RAM diagnostic";
            root.Controls.Add(title, 0, 0);

            TableLayoutPanel connection = new TableLayoutPanel();
            connection.Dock = DockStyle.Top;
            connection.AutoSize = true;
            connection.ColumnCount = 4;
            connection.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            connection.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            connection.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            connection.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            connection.Controls.Add(new Label { Text = "Game process:", AutoSize = true, Margin = new Padding(0, 8, 8, 0) }, 0, 0);
            processLabel = new Label { Text = "Not attached", AutoSize = true, Margin = new Padding(0, 8, 8, 0), ForeColor = Color.DarkRed };
            connection.Controls.Add(processLabel, 1, 0);
            attachButton = new Button { Text = "Attach / refresh", AutoSize = true };
            attachButton.Click += delegate { AttachToGame(true); };
            connection.Controls.Add(attachButton, 2, 0);
            Button openReports = new Button { Text = "Open reports", AutoSize = true };
            openReports.Click += delegate { Directory.CreateDirectory(reportFolder); Process.Start("explorer.exe", "\"" + reportFolder + "\""); };
            connection.Controls.Add(openReports, 3, 0);
            root.Controls.Add(connection, 0, 1);

            TableLayoutPanel feed = new TableLayoutPanel();
            feed.Dock = DockStyle.Top;
            feed.AutoSize = true;
            feed.ColumnCount = 3;
            feed.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            feed.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            feed.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            feed.Controls.Add(new Label { Text = "Live scoreboard JSON:", AutoSize = true, Margin = new Padding(0, 8, 8, 0) }, 0, 0);
            jsonPathBox = new TextBox { Dock = DockStyle.Fill, Text = liveJsonPath };
            jsonPathBox.TextChanged += delegate { liveJsonPath = jsonPathBox.Text.Trim(); };
            feed.Controls.Add(jsonPathBox, 1, 0);
            Button browse = new Button { Text = "Browse", AutoSize = true };
            browse.Click += BrowseJson;
            feed.Controls.Add(browse, 2, 0);
            liveLabel = new Label { Text = "Waiting for live scoreboard data...", AutoSize = true, Margin = new Padding(0, 7, 0, 8), ForeColor = Color.FromArgb(35, 70, 110) };
            feed.SetColumnSpan(liveLabel, 3);
            feed.Controls.Add(liveLabel, 0, 1);
            ramExportLabel = new Label { Text = "RAM export: waiting for game attachment...", AutoSize = true, Margin = new Padding(0, 0, 0, 8), ForeColor = Color.DarkGreen };
            feed.SetColumnSpan(ramExportLabel, 3);
            feed.Controls.Add(ramExportLabel, 0, 2);
            root.Controls.Add(feed, 0, 2);

            FlowLayoutPanel controls = new FlowLayoutPanel();
            controls.Dock = DockStyle.Top;
            controls.AutoSize = true;
            controls.WrapContents = true;
            controls.Controls.Add(new Label { Text = "Field", AutoSize = true, Margin = new Padding(0, 9, 5, 0) });
            fieldBox = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 220 };
            List<FieldChoice> fields = FieldChoice.All();
            for (int i = 0; i < fields.Count; i++) fieldBox.Items.Add(fields[i]);
            fieldBox.SelectedIndex = 3;
            fieldBox.SelectedIndexChanged += delegate
            {
                manualOverride.Clear();
                if (manualValueBox != null) manualValueBox.Clear();
                UseRecommendedTolerance();
                UpdateManualUi();
                UpdateExpected();
            };
            controls.Controls.Add(fieldBox);
            controls.Controls.Add(new Label { Text = "Tolerance", AutoSize = true, Margin = new Padding(12, 9, 5, 0) });
            toleranceBox = new NumericUpDown { Minimum = 0, Maximum = 10000, DecimalPlaces = 0, Width = 75 };
            controls.Controls.Add(toleranceBox);
            expectedLabel = new Label { Text = "Expected: --", AutoSize = true, Margin = new Padding(14, 9, 12, 0), Font = new Font("Segoe UI Semibold", 9F) };
            controls.Controls.Add(expectedLabel);
            expectedSourceLabel = new Label { Text = "Source: LIVE", AutoSize = true, Margin = new Padding(0, 9, 12, 0), ForeColor = Color.DarkGreen };
            controls.Controls.Add(expectedSourceLabel);
            manualValueLabel = new Label { Text = "Manual (M:SS)", AutoSize = true, Margin = new Padding(0, 9, 5, 0) };
            controls.Controls.Add(manualValueLabel);
            manualValueBox = new TextBox { Width = 82 };
            manualValueBox.KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Enter)
                {
                    ArmManualValue();
                    e.SuppressKeyPress = true;
                }
            };
            controls.Controls.Add(manualValueBox);
            useManualButton = NewButton("Use once", ArmManualValue);
            controls.Controls.Add(useManualButton);
            candidateLabel = new Label { Text = "0 candidates", AutoSize = true, Margin = new Padding(2, 9, 12, 0), ForeColor = Color.FromArgb(35, 70, 110) };
            controls.Controls.Add(candidateLabel);
            firstScanButton = NewButton("First scan", delegate { BeginFirstScan(); });
            nextExactButton = NewButton("Next: live value", delegate { BeginNextScan(ScanComparison.Exact); });
            changedButton = NewButton("Changed", delegate { BeginNextScan(ScanComparison.Changed); });
            unchangedButton = NewButton("Unchanged", delegate { BeginNextScan(ScanComparison.Unchanged); });
            increasedButton = NewButton("Increased", delegate { BeginNextScan(ScanComparison.Increased); });
            decreasedButton = NewButton("Decreased", delegate { BeginNextScan(ScanComparison.Decreased); });
            resetButton = NewButton("Reset", ResetScan);
            stopButton = NewButton("Stop", StopScan);
            saveButton = NewButton("Save candidates", SaveReport);
            controls.Controls.Add(firstScanButton);
            controls.Controls.Add(nextExactButton);
            controls.Controls.Add(changedButton);
            controls.Controls.Add(unchangedButton);
            controls.Controls.Add(increasedButton);
            controls.Controls.Add(decreasedButton);
            controls.Controls.Add(resetButton);
            controls.Controls.Add(stopButton);
            controls.Controls.Add(saveButton);
            root.Controls.Add(controls, 0, 3);

            progressBar = new ProgressBar { Dock = DockStyle.Fill, Style = ProgressBarStyle.Continuous };
            root.Controls.Add(progressBar, 0, 4);

            candidatesView = new ListView();
            candidatesView.Dock = DockStyle.Fill;
            candidatesView.View = View.Details;
            candidatesView.FullRowSelect = true;
            candidatesView.GridLines = true;
            candidatesView.Columns.Add("Address", 190);
            candidatesView.Columns.Add("Current Int32", 140);
            candidatesView.Columns.Add("CollegeFB27.exe offset", 210);
            candidatesView.Columns.Add("Meaning", 430);
            root.Controls.Add(candidatesView, 0, 5);

            logBox = new TextBox();
            logBox.Dock = DockStyle.Fill;
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BackColor = Color.White;
            root.Controls.Add(logBox, 0, 6);

            UseRecommendedTolerance();
            UpdateManualUi();
            SetBusy(false);
            Log("This tool requests PROCESS_VM_READ only. It cannot write to or patch the game.");
            Log("Best first target: pause the game, scan Game clock (total seconds), resume, then press Next: live value after the clock changes.");
        }

        private Button NewButton(string text, Action action)
        {
            Button button = new Button { Text = text, AutoSize = true };
            button.Click += delegate { action(); };
            return button;
        }

        private string DefaultLiveJsonPath()
        {
            DirectoryInfo folder = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (int depth = 0; depth < 6 && folder != null; depth++)
            {
                string unpacked = Path.Combine(folder.FullName, "win-unpacked");
                if (Directory.Exists(unpacked))
                {
                    return Path.Combine(unpacked, "UserData", "data-export", "live-scoreboard.json");
                }
                folder = folder.Parent;
            }
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "live-scoreboard.json");
        }

        private void BrowseJson(object sender, EventArgs e)
        {
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Filter = "Live scoreboard JSON|live-scoreboard.json|JSON files|*.json|All files|*.*";
            dialog.FileName = jsonPathBox.Text;
            if (dialog.ShowDialog(this) == DialogResult.OK) jsonPathBox.Text = dialog.FileName;
        }

        private void AttachToGame(bool showErrors)
        {
            try
            {
                Process[] processes = Process.GetProcessesByName(GameProfile.ProcessName);
                if (processes.Length == 0) throw new InvalidOperationException("CollegeFB27.exe is not running.");
                scanner.Attach(processes[0]);
                ramExporter.Reset();
                processLabel.Text = "Attached read-only to CollegeFB27.exe (PID " + processes[0].Id.ToString(CultureInfo.InvariantCulture) + ")";
                processLabel.ForeColor = Color.DarkGreen;
                Log(processLabel.Text);
                RefreshCandidateView();
            }
            catch (Exception error)
            {
                processLabel.Text = "Not attached: " + error.Message;
                processLabel.ForeColor = Color.DarkRed;
                Log(processLabel.Text);
                if (showErrors) MessageBox.Show(this, error.Message, "Could not attach", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void RefreshLiveState()
        {
            try
            {
                AutoAttachIfNeeded();
                if (String.IsNullOrWhiteSpace(liveJsonPath) || !File.Exists(liveJsonPath))
                {
                    liveLabel.Text = "Waiting for live-scoreboard.json. Start the test scoreboard reader.";
                    RefreshRamExport();
                    return;
                }
                string text = ReadSharedText(liveJsonPath);
                live = LiveScoreboard.Parse(text);
                liveLabel.Text = live.Summary();
                UpdateExpected();
                RefreshRamExport();
            }
            catch (Exception error)
            {
                liveLabel.Text = "Could not read live JSON: " + error.Message;
            }
        }

        private void AutoAttachIfNeeded()
        {
            if (scanner.Process != null && !scanner.Process.HasExited) return;
            if (DateTime.UtcNow < nextAutoAttachUtc) return;
            nextAutoAttachUtc = DateTime.UtcNow.AddSeconds(2);
            Process[] processes = Process.GetProcessesByName(GameProfile.ProcessName);
            if (processes.Length == 0)
            {
                processLabel.Text = "Waiting for CollegeFB27.exe to start...";
                processLabel.ForeColor = Color.DarkGoldenrod;
                return;
            }
            scanner.Attach(processes[0]);
            ramExporter.Reset();
            processLabel.Text = "Attached read-only to CollegeFB27.exe (PID " + processes[0].Id.ToString(CultureInfo.InvariantCulture) + ")";
            processLabel.ForeColor = Color.DarkGreen;
            Log(processLabel.Text + " (automatic reattach)");
            RefreshCandidateView();
        }

        private void RefreshRamExport()
        {
            try
            {
                ramExportLabel.Text = ramExporter.Refresh(live, liveJsonPath);
                ramExportLabel.ForeColor = ramExportLabel.Text.StartsWith("RAM export LIVE", StringComparison.Ordinal) ? Color.DarkGreen : Color.DarkGoldenrod;
            }
            catch (Exception error)
            {
                ramExportLabel.Text = "RAM export unavailable: " + error.Message;
                ramExportLabel.ForeColor = Color.DarkRed;
            }
        }

        private static string ReadSharedText(string path)
        {
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (StreamReader reader = new StreamReader(stream)) return reader.ReadToEnd();
        }

        private FieldChoice SelectedField()
        {
            return fieldBox.SelectedItem as FieldChoice;
        }

        private int LiveExpectedValue()
        {
            FieldChoice field = SelectedField();
            if (field == null || live == null) throw new InvalidOperationException("The live scoreboard file has not supplied a value yet.");
            long value = field.ReadValue(live);
            if (value > Int32.MaxValue || value < Int32.MinValue) throw new InvalidOperationException("The selected value does not fit in a 32-bit integer.");
            return (int)value;
        }

        private ScanExpectation PrepareExactExpectation()
        {
            FieldChoice field = SelectedField();
            if (field == null) throw new InvalidOperationException("Choose a field first.");
            ScanExpectation expectation = new ScanExpectation();
            expectation.FieldName = field.Name;
            expectation.Tolerance = (double)toleranceBox.Value;
            if (manualOverride.AppliesTo(field))
            {
                expectation.Source = "manual";
                expectation.ManualInput = manualOverride.Input;
                expectation.Value = manualOverride.Value;
            }
            else
            {
                expectation.Source = "live";
                expectation.ManualInput = null;
                expectation.Value = LiveExpectedValue();
            }
            return expectation;
        }

        private ScanExpectation PrepareComparisonExpectation()
        {
            FieldChoice field = SelectedField();
            ScanExpectation expectation = new ScanExpectation();
            expectation.FieldName = field == null ? null : field.Name;
            expectation.Source = "not-used";
            expectation.ManualInput = null;
            expectation.Tolerance = (double)toleranceBox.Value;
            try { expectation.Value = LiveExpectedValue(); }
            catch { expectation.Value = 0; }
            return expectation;
        }

        private void ArmManualValue()
        {
            FieldChoice field = SelectedField();
            if (field == null) return;
            int converted;
            string error;
            if (!field.TryParseManual(manualValueBox.Text, out converted, out error))
            {
                MessageBox.Show(this, error, "Invalid manual value", MessageBoxButtons.OK, MessageBoxIcon.Information);
                manualValueBox.Focus();
                return;
            }
            manualOverride.Arm(field, manualValueBox.Text, converted);
            Log("Manual value armed for one exact scan: " + field.Name + " = "
                + converted.ToString(CultureInfo.InvariantCulture) + " (typed " + manualOverride.Input + ").");
            UpdateExpected();
        }

        private void UpdateManualUi()
        {
            FieldChoice field = SelectedField();
            if (manualValueLabel != null)
            {
                manualValueLabel.Text = "Manual (" + (field == null ? "value" : field.ManualHint) + ")";
            }
        }

        private void UseRecommendedTolerance()
        {
            FieldChoice field = SelectedField();
            if (field != null && toleranceBox != null) toleranceBox.Value = (decimal)field.RecommendedTolerance;
        }

        private void UpdateExpected()
        {
            FieldChoice field = SelectedField();
            if (field != null && manualOverride.AppliesTo(field))
            {
                expectedLabel.Text = "Expected: " + manualOverride.Value.ToString(CultureInfo.InvariantCulture);
                expectedSourceLabel.Text = "Source: MANUAL (next exact scan only)";
                expectedSourceLabel.ForeColor = Color.DarkOrange;
                nextExactButton.Text = "Next: manual value";
                return;
            }
            try { expectedLabel.Text = "Expected: " + LiveExpectedValue().ToString(CultureInfo.InvariantCulture); }
            catch { expectedLabel.Text = "Expected: --"; }
            expectedSourceLabel.Text = "Source: LIVE";
            expectedSourceLabel.ForeColor = Color.DarkGreen;
            nextExactButton.Text = "Next: live value";
        }

        private void BeginFirstScan()
        {
            ScanExpectation expectation;
            try
            {
                expectation = PrepareExactExpectation();
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "No live value", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            BeginScan(delegate(CancellationToken token, Action<ScanProgress> progress)
            {
                scanner.FirstScan(expectation.Value, expectation.Tolerance, token, progress);
            }, "First exact Int32 scan", ScanComparison.Exact, expectation, true);
        }

        private void BeginNextScan(ScanComparison comparison)
        {
            ScanExpectation expectation;
            try
            {
                expectation = comparison == ScanComparison.Exact
                    ? PrepareExactExpectation()
                    : PrepareComparisonExpectation();
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "No live value", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            BeginScan(delegate(CancellationToken token, Action<ScanProgress> progress)
            {
                scanner.NextScan(comparison, expectation.Value, expectation.Tolerance, token, progress);
            }, "Next scan: " + comparison.ToString(), comparison, expectation, comparison == ScanComparison.Exact);
        }

        private async void BeginScan(
            Action<CancellationToken, Action<ScanProgress>> operation,
            string description,
            ScanComparison comparison,
            ScanExpectation expectation,
            bool consumeManual)
        {
            if (scanCancellation != null) return;
            if (scanner.Process == null || scanner.Process.HasExited)
            {
                AttachToGame(true);
                if (scanner.Process == null) return;
            }
            if (consumeManual && String.Equals(expectation.Source, "manual", StringComparison.Ordinal))
            {
                string consumedInput;
                int consumedValue;
                if (!manualOverride.Consume(SelectedField(), out consumedInput, out consumedValue))
                {
                    MessageBox.Show(this, "The manual value is no longer armed for this field.", "Manual value expired", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                manualValueBox.Clear();
                UpdateExpected();
            }
            scanCancellation = new CancellationTokenSource();
            CancellationTokenSource localCancellation = scanCancellation;
            Dictionary<string, object> audit = new Dictionary<string, object>
            {
                { "startedAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                { "field", expectation.FieldName },
                { "comparison", comparison.ToString() },
                { "expectedSource", expectation.Source },
                { "manualInput", expectation.ManualInput },
                { "expectedValue", expectation.Value },
                { "tolerance", expectation.Tolerance },
                { "status", "running" }
            };
            scanHistory.Add(audit);
            SetBusy(true);
            Log(description + " started for " + expectation.FieldName + " = "
                + expectation.Value.ToString(CultureInfo.InvariantCulture) + " from " + expectation.Source + ".");
            try
            {
                await Task.Run(delegate
                {
                    operation(localCancellation.Token, delegate(ScanProgress value)
                    {
                        BeginInvoke(new Action(delegate { ShowProgress(value); }));
                    });
                });
                audit["completedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                audit["candidateCount"] = scanner.CandidateCount;
                audit["status"] = "completed";
                Log(description + " completed. " + scanner.CandidateCount.ToString("N0", CultureInfo.InvariantCulture) + " candidates remain.");
            }
            catch (OperationCanceledException)
            {
                audit["completedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                audit["candidateCount"] = scanner.CandidateCount;
                audit["status"] = "cancelled";
                Log(description + " stopped by the user.");
            }
            catch (Exception error)
            {
                audit["completedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                audit["candidateCount"] = scanner.CandidateCount;
                audit["status"] = "failed";
                audit["error"] = error.Message;
                Log(description + " failed: " + error.Message);
                MessageBox.Show(this, error.Message, "Scan failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                if (scanCancellation == localCancellation) scanCancellation = null;
                SetBusy(false);
                RefreshCandidateView();
            }
        }

        private void ShowProgress(ScanProgress value)
        {
            long total = Math.Max(1, value.TotalBytes);
            progressBar.Value = (int)Math.Max(0, Math.Min(100, value.BytesRead * 100L / total));
            candidateLabel.Text = value.CandidateCount.ToString("N0", CultureInfo.InvariantCulture) + " candidates";
        }

        private void RefreshCandidateView()
        {
            candidatesView.BeginUpdate();
            candidatesView.Items.Clear();
            List<MemoryCandidate> rows = scanner.SnapshotCandidates(250);
            FieldChoice field = SelectedField();
            for (int i = 0; i < rows.Count; i++)
            {
                MemoryCandidate candidate = rows[i];
                ListViewItem item = new ListViewItem("0x" + candidate.Address.ToString("X16", CultureInfo.InvariantCulture));
                item.SubItems.Add(candidate.LastValue.ToString(CultureInfo.InvariantCulture));
                item.SubItems.Add(scanner.ModuleOffset(candidate.Address));
                item.SubItems.Add(field == null ? String.Empty : field.Name);
                candidatesView.Items.Add(item);
            }
            candidatesView.EndUpdate();
            candidateLabel.Text = scanner.CandidateCount.ToString("N0", CultureInfo.InvariantCulture) + " candidates" + (scanner.CandidateCount > rows.Count ? " (showing first 250)" : String.Empty);
        }

        private void ResetScan()
        {
            if (scanCancellation != null) return;
            scanner.Reset();
            scanHistory.Clear();
            progressBar.Value = 0;
            RefreshCandidateView();
            Log("Candidate list reset.");
        }

        private void StopScan()
        {
            if (scanCancellation != null) scanCancellation.Cancel();
        }

        private void SaveReport()
        {
            try
            {
                Directory.CreateDirectory(reportFolder);
                FieldChoice field = SelectedField();
                List<MemoryCandidate> rows = scanner.SnapshotCandidates(Math.Min(scanner.CandidateCount, 10000));
                List<Dictionary<string, object>> candidates = new List<Dictionary<string, object>>();
                for (int i = 0; i < rows.Count; i++)
                {
                    candidates.Add(new Dictionary<string, object>
                    {
                        { "address", "0x" + rows[i].Address.ToString("X16", CultureInfo.InvariantCulture) },
                        { "value", rows[i].LastValue },
                        { "moduleOffset", scanner.ModuleOffset(rows[i].Address) }
                    });
                }
                Dictionary<string, object> lastScan = scanHistory.Count == 0
                    ? null
                    : scanHistory[scanHistory.Count - 1];
                object liveExpected = null;
                if (live != null && field != null) liveExpected = field.ReadValue(live);
                Dictionary<string, object> pendingManual = null;
                if (field != null && manualOverride.AppliesTo(field))
                {
                    pendingManual = new Dictionary<string, object>
                    {
                        { "field", manualOverride.FieldName },
                        { "input", manualOverride.Input },
                        { "convertedValue", manualOverride.Value }
                    };
                }
                Dictionary<string, object> report = new Dictionary<string, object>
                {
                    { "createdAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "process", scanner.Process == null ? null : scanner.Process.ProcessName },
                    { "processId", scanner.Process == null ? 0 : scanner.Process.Id },
                    { "field", field == null ? null : field.Name },
                    { "expectedValue", lastScan == null ? liveExpected : lastScan["expectedValue"] },
                    { "expectedSource", lastScan == null ? "live" : lastScan["expectedSource"] },
                    { "manualInput", lastScan == null ? null : lastScan["manualInput"] },
                    { "tolerance", lastScan == null ? (object)toleranceBox.Value : lastScan["tolerance"] },
                    { "liveExpectedValue", liveExpected },
                    { "pendingManualOverride", pendingManual },
                    { "scanHistory", scanHistory },
                    { "candidateCount", scanner.CandidateCount },
                    { "savedCandidateCount", candidates.Count },
                    { "candidates", candidates }
                };
                string name = DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss", CultureInfo.InvariantCulture) + "-" + SafeName(field == null ? "scan" : field.Name) + ".json";
                string path = Path.Combine(reportFolder, name);
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Int32.MaxValue;
                File.WriteAllText(path, serializer.Serialize(report));
                Log("Saved report: " + path);
                MessageBox.Show(this, path, "Report saved", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Could not save report", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static string SafeName(string value)
        {
            char[] invalid = Path.GetInvalidFileNameChars();
            string result = value.ToLowerInvariant().Replace(' ', '-');
            for (int i = 0; i < invalid.Length; i++) result = result.Replace(invalid[i], '-');
            return result;
        }

        private void SetBusy(bool busy)
        {
            attachButton.Enabled = !busy;
            fieldBox.Enabled = !busy;
            toleranceBox.Enabled = !busy;
            manualValueBox.Enabled = !busy;
            useManualButton.Enabled = !busy;
            firstScanButton.Enabled = !busy;
            nextExactButton.Enabled = !busy;
            changedButton.Enabled = !busy;
            unchangedButton.Enabled = !busy;
            increasedButton.Enabled = !busy;
            decreasedButton.Enabled = !busy;
            resetButton.Enabled = !busy;
            saveButton.Enabled = !busy;
            stopButton.Enabled = busy;
        }

        private void Log(string message)
        {
            string line = DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "  " + message;
            logBox.AppendText(line + Environment.NewLine);
        }
    }

    internal sealed class ScanExpectation
    {
        public string FieldName;
        public string Source;
        public string ManualInput;
        public int Value;
        public double Tolerance;
    }
}
