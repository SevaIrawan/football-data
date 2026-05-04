@echo off
setlocal
cd /d "%~dp0"

echo Script 2 — Update hasil, statistik, klasemen ^& scorers (ESPN)
echo Pastikan .env sudah diisi (Google Sheet, dll.)
echo.

node script2_update_results.js
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
) else (
  echo Selesai sukses.
)
pause
exit /b %EXITCODE%
