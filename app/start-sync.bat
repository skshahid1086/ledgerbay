@echo off
title Ledgerbay Sync Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install from https://nodejs.org and try again.
  pause
  exit /b 1
)
set PORT=3000
set HOST=0.0.0.0
echo Starting Ledgerbay sync server on port %PORT% ...
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%/"
node server.mjs
pause
