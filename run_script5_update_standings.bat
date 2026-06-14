@echo off
setlocal
cd /d "%~dp0"

echo Script 5 — Update klasemen (Standings + Standings_History)
echo.

node script5_update_standings.js
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
  pause
  exit /b %EXITCODE%
)

pause
exit /b 0
