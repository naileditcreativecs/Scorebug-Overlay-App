#!/bin/bash
# Deploy source -> live test install (and the Desktop test install).
#   bash build-tools/deploy-live.sh 1.4.49
# Steps: bump version, stop app, sync src/tests/assets + reader into the
# staging tree, pack app.asar, fix integrity, launch, verify log line.
set -e
VER="$1"; [ -n "$VER" ] || { echo "usage: deploy-live.sh <version>"; exit 1; }
ROOT="/f/FromOneDrive/claude/A test for this"
BT="$ROOT/build-tools"; STAGE="$BT/staging-asar2"
APP="$ROOT/tester-builds/CFB27 Scoreboard RAM v1.3.53-test.16"
DESK="/c/Users/craft/Desktop/CFB27 Scoreboard Overlay v1.4.35/CFB27-Scoreboard-Overlay-v1.4.44"
READER="$ROOT/ram-diagnostic/build/CollegeFB27RamReader.exe"
SELFTEST="$ROOT/ram-diagnostic/build/reader-self-test.json"

# 1. version bump
sed -i "s/\"version\": \"[0-9.]*\"/\"version\": \"$VER\"/" "$ROOT/source/package.json" "$STAGE/package.json"
sed -i "s#<span id=\"app-version\" class=\"version\">v[0-9.]*</span>#<span id=\"app-version\" class=\"version\">v$VER</span>#" "$ROOT/source/src/control.html"
grep -q "v$VER" "$ROOT/source/src/control.html" || { echo "version span not updated"; exit 1; }

# 2. stop the app (exe stays locked briefly)
for i in $(seq 1 30); do
  powershell -NoProfile -Command "Get-Process 'A test for this','CollegeFB27RamReader' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
  n=$(powershell -NoProfile -Command "(Get-Process 'A test for this' -ErrorAction SilentlyContinue | Measure-Object).Count")
  [ "${n//[^0-9]/}" = "0" ] && break; sleep 1
done

# Refuse to ship a stale canonical reader. A test-named build is not enough:
# this exact executable is what the asar and standalone-reader stage receive.
if find "$ROOT/ram-diagnostic/source" -maxdepth 1 -name '*.cs' -newer "$READER" | grep -q .; then
  echo "reader source is newer than $READER; rebuild the canonical EXE first"; exit 1
fi
rm -f "$SELFTEST"
"$READER" --self-test "$SELFTEST"
grep -q '"passed":true' "$SELFTEST" || { echo "reader self-test failed"; cat "$SELFTEST" 2>/dev/null; exit 1; }
grep -q '"scoreHudTeamIdentityTests":true' "$SELFTEST" || { echo "reader identity self-test missing"; exit 1; }

# 3. sync sources
cp -r "$ROOT/source/src/." "$STAGE/src/"
cp -r "$ROOT/source/tests/." "$STAGE/tests/" 2>/dev/null || true
cp -r "$ROOT/source/assets/." "$STAGE/assets/" 2>/dev/null || true
cp -r "$ROOT/source/themes/." "$STAGE/themes/" 2>/dev/null || true
cp "$READER" "$STAGE/ram-reader/CollegeFB27RamReader.exe"
cp "$READER" "$BT/staging-reader/CollegeFB27RamReader.exe"

# 4. pack + integrity (retry while exe is busy)
cd "$BT"
node node_modules/@electron/asar/bin/asar.js pack "$STAGE" "$APP/resources/app.asar" --unpack-dir "{node_modules,ram-reader,recognition}"
for i in $(seq 1 20); do
  if node update-asar-integrity.js "$APP/A test for this.exe" "$APP/resources/app.asar"; then break; fi; sleep 2
done
test "$(sha256sum "$READER" | cut -d' ' -f1)" = "$(sha256sum "$APP/resources/app.asar.unpacked/ram-reader/CollegeFB27RamReader.exe" | cut -d' ' -f1)" || { echo "live reader != canonical reader"; exit 1; }

# 5. Desktop test install gets the same bits
if [ -d "$DESK" ]; then
  cp "$APP/A test for this.exe" "$DESK/A test for this.exe"
  cp "$APP/resources/app.asar" "$DESK/resources/app.asar"
  rm -rf "$DESK/resources/app.asar.unpacked"
  cp -r "$APP/resources/app.asar.unpacked" "$DESK/resources/app.asar.unpacked"
fi

# 6. launch + verify
cd "$APP" && powershell -NoProfile -Command "Start-Process -FilePath '.\A test for this.exe' -WorkingDirectory (Get-Location).Path"
sleep 15
LOG="$APP/UserData/logs/overlay-$(date -u +%F).log"
if grep -q "app v$VER" "$LOG" 2>/dev/null; then echo "LIVE: app v$VER running"; else echo "WARN: 'app v$VER' not found in $LOG yet"; tail -5 "$LOG" 2>/dev/null; fi
powershell -NoProfile -Command "(Get-Process 'A test for this' -ErrorAction SilentlyContinue | Measure-Object).Count; (Get-Process 'CollegeFB27RamReader' -ErrorAction SilentlyContinue | Measure-Object).Count"
