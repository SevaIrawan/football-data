---
name: football-data-scraper
description: >-
  Operates and troubleshoots the football-data Google Sheets scraper pipeline
  (Scripts 1–3, Script 2 LIVE, season.config.js, ESPN API, football-data.org).
  Use when working in this repo, running or scheduling scraper scripts, adding
  leagues or seasons, fixing Sheet sync/quota issues, matchweek mapping, or
  generate_video queue behavior.
---

# Football Data Scraper

Pipeline Node.js yang mengisi Google Sheet tab **Result** (`A2:AL`, 38 kolom) dari ESPN + football-data.org. Sheet dipakai alur generate video (Next.js, repo terpisah).

## Dokumentasi repo (baca bila perlu detail)

- [README_SCRAPER.md](../../README_SCRAPER.md) — alur script, kolom Sheet, setup
- [sheet-columns.js](../../sheet-columns.js) — schema tab **Result** A–AL
- [standings-columns.js](../../standings-columns.js) — schema tab **Standings** (Script 5)
- [top-players-columns.js](../../top-players-columns.js) — schema tab **Top_Scores** / **Top_Assist** (Script 6)
- [ESPN_LEAGUES_GUIDE.md](../../ESPN_LEAGUES_GUIDE.md) — daftar `espn_code`, tambah liga
- [season.config.js](../../season.config.js) — musim, range tanggal, `COMPETITIONS`
- [.env.example](../../.env.example) — variabel env (jangan commit `.env`)

## Script & urutan operasi

| Script | File | Kapan |
|--------|------|-------|
| 1 | `script1_fetch_schedule.js` | Awal musim / refresh jadwal |
| 2 | `script2_update_results.js` | Manual batch — banyak pertandingan **FINISHED** sekaligus |
| 2 LIVE | `script2_live.js` | Scheduler 1–5 menit — **LIVE**, FT+10m, lengkapi data bolong |
| 3 | `script3_update_matchweek.js` | Isi kolom **matchweek** (GW) |
| 4 | `script4_fill_stadium_news.js` | Backfill **stadium** & **news_update** |
| 5 | `script5_update_standings.js` | Sync tab **Standings** + **Standings_History** |
| 6 | `script6_update_top_players.js` | Sync tab **Top_Scores** + **Top_Assist** |

**Pipeline sync (tambah liga / musim):** `node run_pipeline_sync.js` → Script 1 + 3 + 5 + 6.

**Urutan disarankan:** Script 1 → Script 2 (manual) → aktifkan Script 2 LIVE → Script 3.

```bash
npm install
node script1_fetch_schedule.js
node script2_update_results.js
node script2_live.js
node script3_update_matchweek.js
```

**Windows launcher:** `run_script1_fetch_schedule.bat`, `run_script2_update_results.bat`, `run_script2_live.bat` (tanpa pause, untuk Task Scheduler), `run_script3_update_matchweek.bat`.

## Konfigurasi

| Apa | Di mana |
|-----|---------|
| Credential Google / API key | `.env` (gitignored) |
| Musim, range ESPN, daftar liga | `season.config.js` |
| **Index & header kolom Result (A–AL)** | **`sheet-columns.js`** |
| Override slug logo tim | `logo-key-overrides.json` |
| **Slug logo tim (Result + Standings)** | **`logo-key.js`** → `displayNameToLogoKey()` |
| GW manual (liga tanpa football-data.org) | `matchweek.manual.map.json` |
| State FT+10m (Script 2 LIVE) | `script2_live_state.json` (gitignored) |

**Env wajib (Script 1/2/2 LIVE):** `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`  
**Script 3 tambahan:** `FOOTBALL_DATA_API_KEY`  
**Opsional:** `SHEETS_WRITE_MIN_INTERVAL_MS` (default ~1300), `DEBUG_ESPN=1`

## Perilaku penting (jangan salah asumsi)

- **Sumber data hasil/stat:** 100% ESPN (scoreboard + summary). `flashscore_url` tidak diisi Script 2/LIVE.
- **Timezone kickoff di Sheet:** GMT+7 (sama seperti Script 1).
- **Update hasil:** kickoff Sheet sudah lewat ≥ **10 menit**; hindari false positive.
- **Script 2 LIVE:** baris **FINISHED** di Sheet dilewati; hanya proses SCHEDULED/LIVE relevan (hari ini & kemarin GMT+7 untuk scoreboard).
- **FT+10m:** setelah ESPN FT, status Sheet tetap **LIVE** 10 menit (state di `script2_live_state.json`), lalu **FINISHED** + data final.
- **generate_video:** PENDING → (auto batch ≤6 FINISHED+PENDING) → YES → DONE di Next.js.
- **stadium:** diisi Script 1 dari ESPN `venue.fullName`.
- **news_update:** recap pertandingan dari ESPN `article.headline` (Script 2 / 2 LIVE, setelah FT).
- **Rate limit Sheets:** jeda antar write; naikkan `SHEETS_WRITE_MIN_INTERVAL_MS` jika kena quota.

## Tambah liga baru

1. Cari `espn_code` valid di [ESPN_LEAGUES_GUIDE.md](../../ESPN_LEAGUES_GUIDE.md).
2. Tambah objek di `COMPETITIONS` di `season.config.js`:
   - `espn_code` — wajib
   - `fd_code` — untuk Script 3 & 6; `null` jika tidak ada di football-data.org
   - `name` — harus konsisten dengan kolom `league_name` di Sheet
   - `logo_key` — slug logo liga
3. **`node run_pipeline_sync.js`** — update jadwal, GW, standings, top players sekaligus
4. Run Script 1 saja jika hanya perlu jadwal — jika HTTP 400, `espn_code` salah/unsupported untuk range tanggal.
4. Jika `fd_code` null, isi GW lewat `matchweek.manual.map.json` (kunci: league + season + match_date + home + away).
5. Run Script 2 manual, lalu Script 2 LIVE jika perlu.

## Ganti musim

Edit di `season.config.js`:

```js
const SEASON_LABEL = "2026/27";
const ESPN_DATES_RANGE = "20260801-20270701";
```

Data musim lama **tidak dihapus** (Result append; Standings / Top_* merge by season). Jalankan `run_pipeline_sync.js` untuk isi data musim baru. Script 2 / 2 LIVE hanya sentuh baris `season` = label aktif.

## Troubleshooting

| Gejala | Cek |
|--------|-----|
| Baris tidak ter-update | Nama tim / liga / tanggal Sheet vs ESPN; kickoff belum +10m; status sudah FINISHED (LIVE skip) |
| Quota Google Sheets write | Naikkan `SHEETS_WRITE_MIN_INTERVAL_MS`; kurangi interval scheduler LIVE |
| GW kosong (ISL dll.) | `fd_code: null` → pakai `matchweek.manual.map.json` |
| Logo key salah | Tambah entry di `logo-key-overrides.json` |
| ESPN debug | `set DEBUG_ESPN=1` lalu jalankan Script 2 atau 2 LIVE |
| Script 1 error 400 | `espn_code` atau `ESPN_DATES_RANGE` tidak cocok |

## Task Scheduler (Windows)

- Action: `run_script2_live.bat` atau `node.exe` + path penuh `script2_live.js`
- **Start in:** folder repo
- Interval: 1–5 menit (sesuaikan jumlah liga)

## Legacy

Folder `files ESPN/` berisi versi lama script — **bukan** entry point utama. Pakai script di root repo.

## Prinsip saat mengubah kode

- Minimalkan diff; jangan ubah script lain tanpa diminta.
- Credential hanya di `.env`, never commit secrets.
- Setelah ubah matching tim/tanggal/status, verifikasi konsisten di Script 1, 2, dan 2 LIVE.
