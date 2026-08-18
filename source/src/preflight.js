'use strict';

// Launch-time diagnosis. Everything the app can determine BEFORE a game is
// running that would stop the memory reader from ever producing a read:
// antivirus removed or blocks the reader exe, the data folder cannot be
// written, the app runs from inside a zip, the wrong source mode is on, an
// elevation mismatch is likely. Each finding says what was found, why it
// blocks reading, and the exact fix. Pure and injectable so every failure
// can be simulated in tests.

const READER_EXE = 'CollegeFB27RamReader.exe';

const AV_EXCLUSION_STEPS = [
  'Windows Security: Virus & threat protection > Protection history > restore the reader, then Manage settings > Exclusions > add the app folder.',
  `Other antivirus (Avast, AVG, Norton, McAfee, Bitdefender, Kaspersky): open its quarantine, restore ${READER_EXE}, then add the whole app folder as an exception.`,
  'Then click Re-check below - no restart needed.',
];

function finding(id, severity, title, why, fix, detail) {
  return { id, severity, title, why, fix: Array.isArray(fix) ? fix : [fix], detail: detail || null };
}

function looksLikeArchivePath(appPath) {
  const p = String(appPath || '').replace(/\//g, '\\').toLowerCase();
  return /\\temp\\(rar\$|7z[a-z0-9]*|wz[a-z0-9]*|_?zip)/.test(p)
    || /\.zip\\/.test(p)
    || /appdata\\local\\temp\\.*\\a test for this\.exe$/.test(p);
}

/**
 * env fields:
 *  readerExePath, readerExeExists, readerLaunchFailures (spawn errors or
 *  sub-second exits in a row), readerLaunchError (last spawn error text),
 *  readerRunning, dataFolderWritable, dataFolderPath, appPath,
 *  elevated (true/false/null=unknown), sourceMode ('ram'|'auto'|'screen'),
 *  singleInstance (false when another copy holds the lock),
 *  defenderDetection (Defender threat name for the reader, if known).
 */
function runPreflight(env = {}) {
  const findings = [];

  if (env.sourceMode === 'screen') {
    findings.push(finding('source-mode', 'bad', 'The app is set to the old screen reader',
      'Nothing reads game memory in Screen mode, so scores, names and clocks stay blank.',
      ['Control panel > Reader & live data > choose "Memory reader" (RAM).']));
  }

  if (env.readerExeExists === false) {
    findings.push(finding('reader-missing', 'bad',
      env.defenderDetection
        ? `Windows Security quarantined the game reader (${env.defenderDetection})`
        : 'The game reader is missing - almost always removed by antivirus',
      `${READER_EXE} should be in the app folder but is not there. Without it nothing can be read from the game.`,
      AV_EXCLUSION_STEPS,
      env.readerExePath));
  } else if (Number(env.readerLaunchFailures) >= 2 || (env.readerLaunchError && !env.readerRunning)) {
    findings.push(finding('reader-blocked', 'bad', 'Something is stopping the game reader from running',
      `${READER_EXE} is present but Windows refuses to start it, or it is killed the moment it starts (${env.readerLaunchError || `${env.readerLaunchFailures} failed launches in a row`}). Antivirus, SmartScreen or an app-control policy is the usual cause.`,
      [
        `Right-click ${READER_EXE} > Properties > if there is an "Unblock" box, tick it and Apply.`,
        ...AV_EXCLUSION_STEPS,
      ]));
  }

  if (env.dataFolderWritable === false) {
    findings.push(finding('data-folder', 'bad', 'Windows is blocking the app from saving its data files',
      'The reader publishes the live game data as files. If that folder cannot be written, the scorebug never receives anything. Controlled Folder Access, a read-only/Program Files location, or a OneDrive-only folder cause this.',
      [
        'Windows Security > Virus & threat protection > Ransomware protection > Controlled folder access > Allow an app through > add this app.',
        'Or move the app folder somewhere simple like C:\\CFB27Overlay (not Program Files, not inside OneDrive).',
      ],
      env.dataFolderPath));
  }

  if (looksLikeArchivePath(env.appPath)) {
    findings.push(finding('inside-zip', 'bad', 'The app is running from inside the zip file',
      'Windows extracted it to a temporary folder just to run it. Settings, logos and the reader\'s data land in that temp folder and get wiped, and antivirus is far more likely to block the reader there.',
      ['Close the app, extract the whole zip to a normal folder (for example C:\\CFB27Overlay), and run it from there.'],
      env.appPath));
  }

  if (env.singleInstance === false) {
    findings.push(finding('second-instance', 'warn', 'Another copy of the app is already open',
      'Two copies fight over the reader and the overlay; only the first one is doing the work.',
      ['Close this copy and use the one that is already open (check the system tray).']));
  }

  if (env.elevated === false) {
    findings.push(finding('elevation', 'info', 'Not running as Administrator',
      'That is fine unless College Football 27 itself runs as Administrator - then Windows will not let this app see the game\'s memory and the reader waits forever.',
      ['If the game (or its launcher) is set to run as Administrator, right-click this app > Run as administrator too, or turn that off for the game.']));
  }

  const worst = findings.some((f) => f.severity === 'bad') ? 'bad'
    : (findings.some((f) => f.severity === 'warn') ? 'warn' : (findings.length ? 'info' : 'ok'));
  return { level: worst, findings };
}

function reportText(result, { appVersion, generatedAt } = {}) {
  const lines = [
    '=== CFB27 Scoreboard Overlay - launch diagnosis ===',
    `Generated: ${generatedAt || new Date().toISOString()}`,
    `App version: ${appVersion || 'unknown'}`,
    '',
    result.findings.length ? `Found ${result.findings.length} issue(s):` : 'No launch problems detected.',
  ];
  for (const f of result.findings) {
    lines.push('', `[${f.severity.toUpperCase()}] ${f.title}`, `  Why: ${f.why}`);
    for (const step of f.fix) lines.push(`  Fix: ${step}`);
    if (f.detail) lines.push(`  Detail: ${f.detail}`);
  }
  return lines.join('\n');
}

module.exports = { READER_EXE, looksLikeArchivePath, reportText, runPreflight };
