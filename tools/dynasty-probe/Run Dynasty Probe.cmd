@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)
set SAVE=%~1
set /p TEAM=Your team name as the game shows it (e.g. Pitt), or press Enter to guess: 
if "%TEAM%"=="" (
  node dynasty-probe.js %SAVE% --out "%~dp0dynasty-probe.json"
) else (
  node dynasty-probe.js %SAVE% --team "%TEAM%" --out "%~dp0dynasty-probe.json"
)
echo.
echo Wrote dynasty-probe.json next to this file. Send it with your notes.
pause
