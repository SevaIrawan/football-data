@echo off
setlocal
cd /d "%~dp0"

REM Tanpa "pause" — cocok untuk Task Scheduler Windows.
echo Script 2 LIVE — sync berkala (LIVE / FT+10m / lengkapi data)
echo.

node script2_live.js
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
  exit /b %EXITCODE%
)

exit /b 0
