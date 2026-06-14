@echo off
cd /d "%~dp0"
echo Script 5b - Backfill Standings_History (team_logo_key + migrasi schema)
node script5_backfill_standings_history.js
pause
