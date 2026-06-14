@echo off
setlocal
cd /d "%~dp0"

echo Script 6 — Top Scorers ^& Top Assists (Top_Scores + Top_Assist)
echo.

node script6_update_top_players.js
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
  pause
  exit /b %EXITCODE%
)

pause
exit /b 0
