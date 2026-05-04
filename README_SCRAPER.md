# Football Sheet Viewer — Scraper Scripts

Ringkasan: **Script 1** isi jadwal ke Google Sheet; **Script 2** update hasil/stat untuk match **sudah selesai** (sekali / interval besar); **Script 2 LIVE** sync berkala untuk **LIVE**, **setelah FT +10 menit**, dan **data FINISHED yang terlewat**; **Script 3** isi matchweek dari football-data.org. Liga & rentang tanggal: **`season.config.js`**.

---

## Script 1 — `script1_fetch_schedule.js`

- **Sumber:** ESPN Hidden API (tanpa API key).
- **Kapan:** sekali di awal musim atau saat perlu refresh jadwal.
- **Output:** baris di Sheet dengan status **SCHEDULED**, `generate_video` = **PENDING** (sesuai logic script).

```bash
node script1_fetch_schedule.js
```

---

## Script 2 — `script2_update_results.js`

- **Sumber:** ESPN (scoreboard + summary) untuk skor, statistik, pencetak gol, rank dari standings di summary.
- **Kapan:** jalankan **manual sekali** (atau sesekali) untuk menuntaskan banyak pertandingan **FINISHED** sekaligus — **disarankan sebelum** mengaktifkan Script 2 LIVE supaya beban awal ringan.
- **Syarat baris:** liga & tanggal & nama tim cocok dengan ESPN; kickoff Sheet (GMT+7) sudah lewat **≥ 10 menit** sebelum diperlakukan sebagai calon update hasil (hindari false positive).
- **Auto:** sampai 6 baris **FINISHED** + **PENDING** → `generate_video` = **YES** (satu batch).

```bash
node script2_update_results.js
```

---

## Script 2 LIVE — `script2_live.js`

- **Sumber:** sama seperti Script 2 (ESPN), mengikuti baris yang sudah ada di Sheet + `COMPETITIONS` + `ESPN_DATES_RANGE` di **`season.config.js`**.
- **Kapan:** Task Scheduler Windows (atau cron) **setiap 1–5 menit** (sesuaikan beban); file launcher: **`run_script2_live.bat`** (tanpa `pause`, cocok scheduler).
- **Perilaku utama:**
  - ESPN match **sedang berjalan** → kolom **status** = **LIVE**, **skor** di-update dulu; lalu statistik dari summary menyusul.
  - ESPN sudah **FT** → di Sheet tetap **LIVE** sampai **10 menit** setelah FT pertama kali terdeteksi (penyimpanan waktu di **`script2_live_state.json`**, di-gitignore); dalam jendela itu dilakukan **sync penuh** berulang; setelah itu **FINISHED** + data final.
  - Baris sudah **FINISHED** tapi statistik masih bolong → dilengkapi (sama spirit “refresh” seperti Script 2).
- **Auto:** `autoGroupVideoQueue` di akhir run (sama seperti Script 2).

```bash
node script2_live.js
```

**Urutan operasi disarankan:** `script2_update_results.js` (manual) → lalu aktifkan **Script 2 LIVE** terjadwal.

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

## Kolom Google Sheet (35 kolom)

| No | Kolom | Diisi / di-update oleh |
|----|-------|-------------------------|
| 1 | league_name | Script 1 |
| 2 | season | Script 1 |
| 3 | matchweek | Script 1 / Script 3 |
| 4 | match_date | Script 1 |
| 5 | kickoff | Script 1 |
| 6 | league_logo_url | Script 1 |
| 7 | league_logo_key | Script 1 |
| 8 | home_name | Script 1 |
| 9 | away_name | Script 1 |
| 10 | home_logo_url | Script 1 / Script 2 |
| 11 | away_logo_url | Script 1 / Script 2 |
| 12 | home_logo_key | Script 1 |
| 13 | away_logo_key | Script 1 |
| 14 | status | Script 1 (**SCHEDULED**) → Script 2 LIVE (**LIVE** / **FINISHED**) → Script 2 (**FINISHED**) |
| 15 | home_score | Script 2 / Script 2 LIVE |
| 16 | away_score | Script 2 / Script 2 LIVE |
| 17–28 | statistik & kartu & pencetak gol | Script 2 / Script 2 LIVE (ESPN summary) |
| 31 | flashscore_url | Manual / alur lain |
| 32 | generate_video | PENDING → YES (Script 2 / 2 LIVE) → DONE (Next.js) |
| 33 | uploaded_at | Next.js |
| 34–35 | home_league_rank, away_league_rank | Script 2 / Script 2 LIVE |

*(Nomor kolom = urutan A–AI seperti range Sheet `A2:AI`.)*
