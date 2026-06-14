@echo off
setlocal
cd /d "%~dp0"

echo Script 4 — isi stadium ^& news_update (backfill)
echo.

node script4_fill_stadium_news.js
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 (
  echo Gagal. Kode keluar: %EXITCODE%
  pause
  exit /b %EXITCODE%
)

pause
exit /b 0
