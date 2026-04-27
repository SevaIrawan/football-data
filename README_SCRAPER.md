# Football Sheet Viewer — Scraper Scripts

## Dua Script Utama

### Script 1 — `script1_fetch_schedule.js`
Ambil semua jadwal musim 2025/26 dari football-data.org dan tulis ke Google Sheet.
- Liga: Premier League, Serie A, La Liga, Bundesliga, Ligue 1, Champions League
- Jalankan SEKALI di awal musim (atau kapan pun mau refresh jadwal)
- Output: semua match masuk ke Sheet dengan status = SCHEDULED, generate_video = PENDING

### Script 2 — `script2_update_results.js`
Update skor, statistik, goal scorers, dan league rank untuk match yang sudah selesai.
- Skor + goal scorers + rank → dari football-data.org (API resmi)
- Statistik detail → dari FlashScore via Puppeteer scraping
- Auto-group 6 match FINISHED → set generate_video = YES
- Jalankan sebagai cron job tiap 10 menit

---

## Setup

### 1. Install dependencies
```bash
npm install axios googleapis dotenv puppeteer-extra puppeteer-extra-plugin-stealth
```

### 2. Isi .env
Copy `.env.example` → `.env` dan isi semua nilai:

```
FOOTBALL_DATA_API_KEY=  → daftar di football-data.org (gratis)
GOOGLE_SHEET_ID=        → ambil dari URL Google Sheet
GOOGLE_SERVICE_ACCOUNT_EMAIL= → dari file JSON Service Account
GOOGLE_PRIVATE_KEY=     → dari file JSON Service Account
```

### 3. Jalankan Script 1 (sekali)
```bash
node script1_fetch_schedule.js
```

### 4. Setup Cron Job untuk Script 2 (tiap 10 menit)
```bash
# Edit crontab
crontab -e

# Tambah baris ini:
*/10 * * * * node /path/to/script2_update_results.js >> /var/log/football-scraper.log 2>&1
```

---

## Catatan Penting

### flashscore_url
Script 2 butuh kolom `flashscore_url` diisi untuk bisa scraping statistik.
Format: `https://www.flashscore.com/match/[team-a]-[team-b]/[match-id]/`

Untuk match yang sudah FINISHED tapi flashscore_url kosong:
- Skor dan goal scorers tetap terupdate dari football-data.org
- Statistik (shots, possession, dll) akan kosong

### Rate Limit football-data.org
Free tier: 10 request per menit.
Script sudah handle dengan delay 6 detik antar liga.

### FlashScore Anti-Bot
Script pakai puppeteer-extra dengan StealthPlugin untuk minimize risiko block.
Jika tetap kena block, coba tambah delay di config scrapeFlashScoreStats().

---

## Kolom Google Sheet (35 kolom)

| No | Kolom | Diisi Oleh |
|----|-------|------------|
| 1 | league_name | Script 1 |
| 2 | season | Script 1 |
| 3 | matchweek | Script 1 |
| 4 | match_date | Script 1 |
| 5 | kickoff | Script 1 |
| 6 | league_logo_url | Script 1 |
| 7 | league_logo_key | Script 1 |
| 8 | home_name | Script 1 |
| 9 | away_name | Script 1 |
| 10 | home_logo_url | Script 1 |
| 11 | away_logo_url | Script 1 |
| 12 | home_logo_key | Script 1 |
| 13 | away_logo_key | Script 1 |
| 14 | status | Script 1 (SCHEDULED) → Script 2 (FINISHED) |
| 15 | home_score | Script 2 |
| 16 | away_score | Script 2 |
| 17 | shots_on_target_home | Script 2 (FlashScore) |
| 18 | shots_on_target_away | Script 2 (FlashScore) |
| 19 | possession_home | Script 2 (FlashScore) |
| 20 | possession_away | Script 2 (FlashScore) |
| 21 | corners_home | Script 2 (FlashScore) |
| 22 | corners_away | Script 2 (FlashScore) |
| 23 | fouls_home | Script 2 (FlashScore) |
| 24 | fouls_away | Script 2 (FlashScore) |
| 25 | yellow_cards_home | Script 2 (FlashScore) |
| 26 | yellow_cards_away | Script 2 (FlashScore) |
| 27 | red_cards_home | Script 2 (FlashScore) |
| 28 | red_cards_away | Script 2 (FlashScore) |
| 29 | home_goal_scorers | Script 2 (football-data.org) |
| 30 | away_goal_scorers | Script 2 (football-data.org) |
| 31 | flashscore_url | Manual (kamu isi) |
| 32 | generate_video | PENDING → YES (Script 2 auto) → DONE (Next.js) |
| 33 | uploaded_at | Next.js (setelah upload YouTube) |
| 34 | home_league_rank | Script 2 |
| 35 | away_league_rank | Script 2 |
