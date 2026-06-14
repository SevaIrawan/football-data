@echo off
setlocal
cd /d "%~dp0"

echo Pipeline sync — Script 1 + 3 + 5 + 6 (ikuti season.config.js)
echo.

node run_pipeline_sync.js
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
  pause
  exit /b %EXITCODE%
)

pause
exit /b 0
