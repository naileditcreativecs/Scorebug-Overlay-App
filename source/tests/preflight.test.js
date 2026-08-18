'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { looksLikeArchivePath, reportText, runPreflight } = require('../src/preflight');

const healthy = {
  readerExePath: 'C:\\CFB27Overlay\\resources\\app.asar.unpacked\\ram-reader\\CollegeFB27RamReader.exe',
  readerExeExists: true,
  readerLaunchFailures: 0,
  readerLaunchError: null,
  readerRunning: true,
  dataFolderWritable: true,
  dataFolderPath: 'C:\\CFB27Overlay\\UserData\\data-export',
  appPath: 'C:\\CFB27Overlay\\A test for this.exe',
  elevated: true,
  sourceMode: 'ram',
  singleInstance: true,
  defenderDetection: null,
};

test('a healthy install has no findings', () => {
  const r = runPreflight(healthy);
  assert.strictEqual(r.level, 'ok');
  assert.deepStrictEqual(r.findings, []);
  assert.match(reportText(r), /No launch problems detected/);
});

test('missing reader exe is called out as antivirus, naming Defender when known', () => {
  const r = runPreflight({ ...healthy, readerExeExists: false });
  assert.strictEqual(r.level, 'bad');
  assert.strictEqual(r.findings[0].id, 'reader-missing');
  assert.match(r.findings[0].title, /antivirus/i);
  const named = runPreflight({ ...healthy, readerExeExists: false, defenderDetection: 'Trojan:Win32/Wacatac' });
  assert.match(named.findings[0].title, /Windows Security quarantined .*Wacatac/);
  assert.ok(named.findings[0].fix.some((s) => /Exclusions/.test(s)));
});

test('a reader that exists but cannot start is a blocked-reader finding', () => {
  const r = runPreflight({ ...healthy, readerRunning: false, readerLaunchFailures: 3 });
  assert.strictEqual(r.findings[0].id, 'reader-blocked');
  const withError = runPreflight({ ...healthy, readerRunning: false, readerLaunchError: 'spawn EPERM' });
  assert.match(withError.findings[0].why, /EPERM/);
  // Present, running, and one old failure: not a finding.
  assert.strictEqual(runPreflight({ ...healthy, readerLaunchFailures: 1 }).findings.length, 0);
});

test('unwritable data folder, zip path, screen mode, second instance, elevation', () => {
  assert.strictEqual(runPreflight({ ...healthy, dataFolderWritable: false }).findings[0].id, 'data-folder');
  assert.strictEqual(runPreflight({ ...healthy, appPath: 'C:\\Users\\x\\AppData\\Local\\Temp\\Rar$EXa1234\\A test for this.exe' }).findings[0].id, 'inside-zip');
  assert.strictEqual(runPreflight({ ...healthy, sourceMode: 'screen' }).findings[0].id, 'source-mode');
  const second = runPreflight({ ...healthy, singleInstance: false });
  assert.deepStrictEqual([second.level, second.findings[0].id], ['warn', 'second-instance']);
  const elev = runPreflight({ ...healthy, elevated: false });
  assert.deepStrictEqual([elev.level, elev.findings[0].id], ['info', 'elevation']);
  assert.strictEqual(runPreflight({ ...healthy, elevated: null }).findings.length, 0);
});

test('archive path detection covers the common extractors and plain zip mounts', () => {
  assert.ok(looksLikeArchivePath('C:\\Users\\a\\AppData\\Local\\Temp\\7zO8C1\\A test for this.exe'));
  assert.ok(looksLikeArchivePath('C:\\Users\\a\\AppData\\Local\\Temp\\wzabcd\\A test for this.exe'));
  assert.ok(looksLikeArchivePath('C:\\Users\\a\\Downloads\\CFB27-Scoreboard-Overlay-v1.4.19.zip\\A test for this.exe'));
  assert.ok(!looksLikeArchivePath('C:\\CFB27Overlay\\A test for this.exe'));
  assert.ok(!looksLikeArchivePath('D:\\Games\\zip tools\\A test for this.exe'));
});

test('severity rolls up to the worst finding and the report lists every fix step', () => {
  const r = runPreflight({ ...healthy, elevated: false, singleInstance: false, readerExeExists: false });
  assert.strictEqual(r.level, 'bad');
  const text = reportText(r, { appVersion: '1.4.20', generatedAt: 'T' });
  assert.match(text, /App version: 1.4.20/);
  assert.match(text, /Found 3 issue\(s\)/);
  assert.match(text, /\[BAD\]/);
  assert.match(text, /\[WARN\]/);
  assert.match(text, /\[INFO\]/);
});
