@echo off
setlocal
cd /d "%~dp0"

echo Script 1 — Fetch jadwal musim (ESPN ke Google Sheet)
echo Pastikan .env sudah diisi (Google Sheet, dll.)
echo.

node script1_fetch_schedule.js
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
) else (
  echo Selesai sukses.
)
pause
exit /b %EXITCODE%
