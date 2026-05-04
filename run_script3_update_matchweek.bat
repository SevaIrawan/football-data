@echo off
setlocal
cd /d "%~dp0"

echo Script 3 — Update Matchweek (GW)
echo Pastikan .env sudah diisi (API key, Google Sheet, dll.)
echo.

node script3_update_matchweek.js
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
) else (
  echo Selesai sukses.
)
pause
exit /b %EXITCODE%
