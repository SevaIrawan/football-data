# Football Sheet Viewer — Scraper Scripts

Ringkasan: **Script 1** isi jadwal ke Google Sheet; **Script 2** update hasil/stat untuk match **sudah selesai** (sekali / interval besar); **Script 2 LIVE** sync berkala untuk **LIVE**, **setelah FT +10 menit**, dan **data FINISHED yang terlewat**; **Script 3** isi matchweek dari football-data.org. Liga & musim: **`season.config.js`** (satu config → semua script 1–6).

**Tambah liga / ganti musim:** edit `COMPETITIONS` + `SEASON_LABEL` di config, lalu:

```bash
node run_pipeline_sync.js
```

(Jalankan Script 2 / 2 LIVE terpisah untuk hasil pertandingan.)

---

## Arsip multi-musim

| Tab | Musim lama saat musim baru |
|-----|----------------------------|
| **Result** | Tetap (append; dedupe `liga+season+tanggal+tim`) |
| **Standings** | Tetap (refresh hanya baris `season` aktif) |
| **Standings_History** | Tetap (append per pekan) |
| **Top_Scores / Top_Assist** | Tetap (refresh hanya baris `season` aktif) |

Script 2 / 2 LIVE hanya meng-update baris dengan **`season` = `SEASON_LABEL`** di config.

---

## Script 1 — `script1_fetch_schedule.js`

- **Sumber:** ESPN Hidden API (tanpa API key).
- **Kapan:** sekali di awal musim atau saat perlu refresh jadwal.
- **Output:** baris di Sheet dengan status **SCHEDULED**, `generate_video` = **PENDING**, kolom **`stadium`** dari ESPN venue.

```bash
node script1_fetch_schedule.js
```

---

## Script 2 — `script2_update_results.js`

- **Sumber:** ESPN (scoreboard + summary) untuk skor, statistik, pencetak gol, rank dari standings di summary.
- **Kapan:** jalankan **manual sekali** (atau sesekali) untuk menuntaskan banyak pertandingan **FINISHED** sekaligus — **disarankan sebelum** mengaktifkan Script 2 LIVE supaya beban awal ringan.
- **Syarat baris:** liga & tanggal & nama tim cocok dengan ESPN; kickoff Sheet (GMT+7) sudah lewat **≥ 10 menit** sebelum diperlakukan sebagai calon update hasil (hindari false positive).
- **Auto:** sampai 6 baris **FINISHED** + **PENDING** → `generate_video` = **YES** (satu batch).
- **Recap / stadium:** mengisi **`news_update`** (recap ESPN) dan melengkapi **`stadium`** jika masih kosong.

```bash
node script2_update_results.js
```

---

## Script 4 — `script4_fill_stadium_news.js`

- **Fungsi:** backfill **`stadium`** (semua baris kosong) dan **`news_update`** (baris **FINISHED** kosong) tanpa mengubah kolom lain.
- **Sumber:** ESPN scoreboard (venue) + summary (recap headline).
- **Kapan:** setelah deploy kolom baru, atau sekali untuk data lama di Sheet.

```bash
node script4_fill_stadium_news.js
```

---

## Script 2 LIVE — `script2_live.js`

- **Sumber:** sama seperti Script 2 (ESPN), mengikuti baris yang sudah ada di Sheet + `COMPETITIONS` + `ESPN_DATES_RANGE` di **`season.config.js`**.
- **Kapan:** Task Scheduler Windows (atau cron) **setiap 1–5 menit** (sesuaikan beban); file launcher: **`run_script2_live.bat`** (tanpa `pause`, cocok scheduler).
- **Perilaku utama:**
  - ESPN match **sedang berjalan** → kolom **status** = **LIVE**, **skor** di-update dulu; lalu statistik dari summary menyusul.
  - ESPN sudah **FT** → di Sheet tetap **LIVE** sampai **10 menit** setelah FT pertama kali terdeteksi (penyimpanan waktu di **`script2_live_state.json`**, di-gitignore); dalam jendela itu dilakukan **sync penuh** berulang; setelah itu **FINISHED** + data final.
  - Baris sudah **FINISHED** tapi statistik masih bolong → dilengkapi (sama spirit “refresh” seperti Script 2).
- **Recap / stadium:** mengisi **`news_update`** dan **`stadium`** (backup) saat sync LIVE / FT.
- **Auto:** `autoGroupVideoQueue` di akhir run (sama seperti Script 2).

```bash
node script2_live.js
```

**Urutan operasi disarankan:** `script2_update_results.js` (manual) → lalu aktifkan **Script 2 LIVE** terjadwal.

---

## Script 5 — `script5_update_standings.js`

- **Tab Standings:** klasemen **terkini** — **TIMPA** setiap run (~150 baris).
- **Tab Standings_History:** snapshot **per pekan** — **APPEND** (dedupe per `matchweek` + tim + grup).
- **Sumber:** ESPN v2 standings + `matchweek` dari football-data.org (`fd_code`) atau max `matchweek` tab Result (ISL).
- **Kapan:** manual atau terjadwal (mis. 1× seminggu setelah GW selesai).

**Buat tab kosong `Standings_History` di Google Sheet** (header ditulis otomatis run pertama).

```bash
node script5_update_standings.js
```

Schema: **`standings-columns.js`** — Standings 23 kolom (A–W), History 24 kolom (A–X, + `matchweek` kolom D). Kolom logo tim: `team_logo_url` + **`team_logo_key`** (slug sama seperti `home_logo_key` / `away_logo_key` di Result; logic di **`logo-key.js`**).

---

## Script 6 — `script6_update_top_players.js`

- **Tab Top_Scores:** top gol musim aktif — **TIMPA** setiap run.
- **Tab Top_Assist:** top assist musim aktif — **TIMPA** setiap run.
- **Sumber:** football-data.org `/scorers` (`fd_code`); fallback ESPN Core `leaders` (Goals / Assists).
- **`.env`:** `FOOTBALL_DATA_API_KEY` disarankan (Script 3 key yang sama).
- **ISL** (`fd_code: null`): ESPN leaders sering kosong — baris liga skip + log peringatan.

```bash
node script6_update_top_players.js
```

Schema: **`top-players-columns.js`** — 14 kolom A–N (termasuk `team_logo_key` via **`logo-key.js`**).

---

## Script 3 — `script3_update_matchweek.js`

- **Sumber:** football-data.org untuk **matchday** / GW.
- **`.env`:** butuh `FOOTBALL_DATA_API_KEY` (+ Google Sheet).

```bash
node script3_update_matchweek.js
```

---

## Launcher `.bat` (Windows)

| File | Fungsi |
|------|--------|
| `run_script1_fetch_schedule.bat` | Script 1 (ada `pause`) |
| `run_script2_update_results.bat` | Script 2 manual (ada `pause`) |
| `run_script2_live.bat` | Script 2 LIVE untuk scheduler (**tanpa** `pause`) |
| `run_script3_update_matchweek.bat` | Script 3 (ada `pause`) |
| `run_script4_fill_stadium_news.bat` | Script 4 backfill stadium & news (ada `pause`) |
| `run_script5_update_standings.bat` | Script 5 klasemen tab Standings (ada `pause`) |
| `run_script6_update_top_players.bat` | Script 6 top scorer & assist (ada `pause`) |
| **`run_pipeline_sync.bat`** | **Script 1 + 3 + 5 + 6** setelah tambah liga / ganti musim |

Untuk Task Scheduler: **Action** memanggil `run_script2_live.bat` atau `node.exe` dengan argumen path penuh ke `script2_live.js` dan **Start in** = folder repo.

---

## Setup

### 1. Dependencies

```bash
npm install
```

### 2. `.env`

Salin `.env.example` → `.env` dan isi (minimal untuk Script 1/2/2 LIVE):

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Untuk **Script 3** saja tambahkan `FOOTBALL_DATA_API_KEY`.

### 3. Opsional debug

```bash
set DEBUG_ESPN=1
node script2_live.js
```

---

## Catatan penting

### Rate limit & beban

- **Google Sheets:** tiap baris yang di-update memakai satu **write** API. Ada batas **write per menit per user**; Script 2 dan Script 2 LIVE menambah jeda antar tulis (default ~1,3 s; bisa naikkan lewat `SHEETS_WRITE_MIN_INTERVAL_MS` di `.env`). Dulu bisa “cepat” lalu kena error — itu normal jika melewati kuota sesaat.
- Banyak panggilan **ESPN summary** per run (tiap baris relevan). Interval scheduler jangan terlalu agresif bila banyak liga.
- Script 2 (batch) tetap berguna untuk **menyapu** banyak FT sekaligus sebelum mengandalkan LIVE.

### `flashscore_url`

Kolom tetap ada di Sheet; **Script 2 / 2 LIVE saat ini tidak** mengisi statistik dari FlashScore (semua dari ESPN). Kolom bisa dipakai alur lain.

---

## Kolom Google Sheet (38 kolom, A–AL)

Schema terpusat di **`sheet-columns.js`** — semua script mengacu ke file ini.

| No | Kolom | Huruf | Diisi / di-update oleh |
|----|-------|-------|-------------------------|
| 1 | league_name | A | Script 1 |
| 2 | season | B | Script 1 |
| 3 | matchweek | C | Script 1 / Script 3 |
| 4 | match_date | D | Script 1 |
| 5 | kickoff | E | Script 1 |
| 6–7 | league_logo_url, league_logo_key | F–G | Script 1 |
| 8–13 | home/away name, logo, logo_key | H–M | Script 1 |
| 14 | status | N | Script 1 → Script 2 LIVE → Script 2 |
| 15–16 | home_score, away_score | O–P | Script 2 / Script 2 LIVE |
| 17–28 | statistik, kartu, pencetak gol | Q–AB | Script 2 / Script 2 LIVE |
| 31 | flashscore_url | AE | Manual / alur lain |
| 32 | generate_video | AF | PENDING → YES (Script 2 / 2 LIVE) → DONE (Next.js) |
| 33 | uploaded_at | AG | Next.js |
| 34–35 | home_league_rank, away_league_rank | AH–AI | Script 2 / Script 2 LIVE |
| 36 | tickerScores | AJ | Manual / alur lain |
| 37 | news_update | AK | Script 2 / Script 2 LIVE (recap ESPN `article.headline`) |
| 38 | stadium | AL | Script 1 (ESPN `venue.fullName`) |

*(Range baca/tulis baris data: `A2:AL`.)*

---

## Tab Standings & Standings_History

| Tab | Perilaku | Kolom |
|-----|----------|-------|
| **Standings** | Refresh musim aktif; musim lama tetap | 23 kolom A–W (+ `team_logo_key`) |
| **Standings_History** | Append — 1 snapshot per pekan/liga | 24 kolom A–X (+ **`matchweek`** kolom D) |

Script 5 mengisi keduanya. History tidak menimpa pekan lama; skip otomatis jika GW/MW sudah ada.

**Backfill History** (schema lama / `team_logo_key` kosong): `node script5_backfill_standings_history.js`

Schema: **`standings-columns.js`**. Tambah kompetisi lewat `COMPETITIONS` + `espn_code` ESPN.

---

## Tab Top_Scores & Top_Assist

| Tab | Perilaku | Kolom |
|-----|----------|-------|
| **Top_Scores** | Refresh musim aktif; musim lama tetap | 14 kolom A–N |
| **Top_Assist** | Refresh musim aktif; musim lama tetap | 14 kolom A–N (schema sama) |

Script 6 mengisi keduanya. Filter Sheet by kolom **`season`** untuk lihat musim tertentu.

Schema: **`top-players-columns.js`**.
