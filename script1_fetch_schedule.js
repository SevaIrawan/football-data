/**
 * SCRIPT 1 — FETCH JADWAL via ESPN API (musim dari season.config.js)
 * ====================================================
 * Source: ESPN Hidden API (tanpa API key, gratis)
 * Output: Tulis ke Google Sheet mulai row 2
 */

require("dotenv").config();
const axios = require("axios");
const { google } = require("googleapis");
const { SEASON_LABEL, ESPN_DATES_RANGE, COMPETITIONS } = require("./season.config");
const { COL, padRow, SHEET_COL_COUNT } = require("./sheet-columns");
const { displayNameToLogoKey, loadLogoKeyOverrides } = require("./logo-key");

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_NAME = "Result";
/** Batas baca kolom A untuk cari baris tulis pertama (hindari append yang lompat ke bawah sheet). */
const SHEET_SCAN_MAX_ROW = 50000;

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

// ─── HELPER ────────────────────────────────────────────────────────────────

/** Untuk kunci duplikat: tanggal yyyy-mm-dd di Sheet lama = sama dengan yyyy/mm/dd. */
function normalizeMatchDateForKey(s) {
  const t = String(s || "").trim();
  const m = t.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (!m) return t;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function utcToGmt7(utcDateStr) {
  const date = new Date(utcDateStr);
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  // Pakai getUTC* pada instant yang sudah di-shift agar sama dengan logika jam sebelumnya
  const y = gmt7.getUTCFullYear();
  const mo = String(gmt7.getUTCMonth() + 1).padStart(2, "0");
  const da = String(gmt7.getUTCDate()).padStart(2, "0");
  const match_date = `${y}/${mo}/${da}`; // yyyy/mm/dd untuk Sheet (USER_ENTERED)
  const hh = String(gmt7.getUTCHours()).padStart(2, "0");
  const mm = String(gmt7.getUTCMinutes()).padStart(2, "0");
  const ss = String(gmt7.getUTCSeconds()).padStart(2, "0");
  const kickoff = `${hh}:${mm}:${ss}`; // hh:mm:ss
  return { match_date, kickoff };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── GOOGLE SHEETS ─────────────────────────────────────────────────────────

async function getSheets() {
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

/** Baris pertama (1-based) di mana kolom A kosong, mulai row 2. Jika blok penuh sampai SHEET_SCAN_MAX_ROW → row berikutnya. */
async function getFirstWriteRow(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A2:A${SHEET_SCAN_MAX_ROW}`,
  });
  const values = res.data.values || [];
  for (let i = 0; i < values.length; i++) {
    const a = values[i]?.[0];
    if (a === undefined || a === null || String(a).trim() === "") {
      return 2 + i;
    }
  }
  return 2 + values.length;
}

async function getExistingKeys(sheets) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:I${SHEET_SCAN_MAX_ROW}`,
    });
    const rows = res.data.values || [];
    const set = new Set();
    for (const row of rows) {
      if (!String(row[0] || "").trim()) continue;
      const key = `${row[0]||""}|${row[1]||""}|${normalizeMatchDateForKey(row[3])}|${row[7]||""}|${row[8]||""}`;
      set.add(key);
    }
    console.log(`   ✓ ${set.size} match sudah ada di Sheet`);
    return set;
  } catch (e) {
    console.error("   ✗ Error baca Sheet:", e.message);
    return new Set();
  }
}

/** Perluas grid tab Result jika baris tulis melebihi batas Sheet saat ini. */
async function ensureSheetRowCapacity(sheets, minRow1Based) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
  });
  const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === SHEET_NAME);
  if (!sheet) throw new Error(`Tab "${SHEET_NAME}" tidak ditemukan`);

  const sheetId = sheet.properties.sheetId;
  const grid = sheet.properties.gridProperties || {};
  const currentRows = grid.rowCount || 1000;
  const currentCols = grid.columnCount || 26;
  const requests = [];

  if (minRow1Based > currentRows) {
    const add = minRow1Based - currentRows;
    requests.push({
      appendDimension: { sheetId, dimension: "ROWS", length: add },
    });
  }
  if (SHEET_COL_COUNT > currentCols) {
    requests.push({
      appendDimension: {
        sheetId,
        dimension: "COLUMNS",
        length: SHEET_COL_COUNT - currentCols,
      },
    });
  }

  if (!requests.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { requests },
  });
  const parts = [];
  if (minRow1Based > currentRows) parts.push(`+${minRow1Based - currentRows} baris`);
  if (SHEET_COL_COUNT > currentCols) parts.push(`kolom → ${SHEET_COL_COUNT}`);
  console.log(`   ℹ Tab ${SHEET_NAME} diperluas (${parts.join(", ")})`);
}

async function writeRowsBatch(sheets, rows) {
  if (!rows.length) return;

  const BATCH = 500;
  let startRow = await getFirstWriteRow(sheets);
  const totalEndRow = startRow + rows.length - 1;
  // Buffer ekstra agar musim baru tidak kena limit lagi terlalu cepat
  await ensureSheetRowCapacity(sheets, totalEndRow + 2000);

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${startRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: chunk },
    });
    console.log(
      `   ✍️  Batch ${Math.floor(i / BATCH) + 1}: ${chunk.length} baris → row ${startRow}–${startRow + chunk.length - 1}`,
    );
    startRow += chunk.length;
    await delay(1000);
  }
}

// ─── ESPN: FETCH JADWAL ────────────────────────────────────────────────────

async function espnFetchAllMatches(espnCode) {
  try {
    const url = `${ESPN_BASE}/${espnCode}/scoreboard`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: {
        limit: 1000,
        dates: ESPN_DATES_RANGE,
      },
      timeout: 30000,
    });

    const events = response.data?.events || [];
    const leagueLogoUrl = response.data?.leagues?.[0]?.logos?.[0]?.href || "";
    console.log(`   ✓ ${events.length} events dari ESPN`);
    return { events, leagueLogoUrl };
  } catch (error) {
    console.error(`   ✗ Error ESPN ${espnCode}: ${error.message}`);
    return { events: [], leagueLogoUrl: "" };
  }
}

// ─── TRANSFORM EVENT KE KOLOM SHEET (A–AL) ────────────────────────────────

function transformEvent(event, competition, fallbackLeagueLogoUrl = "") {
  try {
    const comp = event.competitions?.[0];
    if (!comp) return null;

    const competitors = comp.competitors || [];
    const homeTeam = competitors.find((c) => c.homeAway === "home");
    const awayTeam = competitors.find((c) => c.homeAway === "away");
    if (!homeTeam || !awayTeam) return null;

    const dateStr = event.date || comp.date || "";
    if (!dateStr) return null;

    const { match_date, kickoff } = utcToGmt7(dateStr);

    const homeName = homeTeam.team?.displayName || homeTeam.team?.name || "";
    const awayName = awayTeam.team?.displayName || awayTeam.team?.name || "";
    if (!homeName || !awayName) return null;

    const homeLogoUrl = homeTeam.team?.logo || homeTeam.team?.logos?.[0]?.href || "";
    const awayLogoUrl = awayTeam.team?.logo || awayTeam.team?.logos?.[0]?.href || "";
    const homeKey = displayNameToLogoKey(homeName);
    const awayKey = displayNameToLogoKey(awayName);
    // Untuk endpoint scoreboard, logo liga tersedia di response.leagues[0].logos.
    const leagueLogo = comp.league?.logos?.[0]?.href || fallbackLeagueLogoUrl || "";
    const matchweek = event.week?.number || comp.week?.number || "";

    const statusType = comp.status?.type?.name || "";
    let status = "SCHEDULED";
    if (statusType === "STATUS_FINAL") status = "FINISHED";
    else if (statusType === "STATUS_IN_PROGRESS") status = "LIVE";

    const homeScore = status === "FINISHED" ? (homeTeam.score || "") : "";
    const awayScore = status === "FINISHED" ? (awayTeam.score || "") : "";
    const stadium = comp.venue?.fullName || "";

    const row = new Array(SHEET_COL_COUNT).fill("");
    row[COL.league_name] = competition.name;
    row[COL.season] = SEASON_LABEL;
    row[COL.matchweek] = matchweek;
    row[COL.match_date] = match_date;
    row[COL.kickoff] = kickoff;
    row[COL.league_logo_url] = leagueLogo;
    row[COL.league_logo_key] = competition.logo_key;
    row[COL.home_name] = homeName;
    row[COL.away_name] = awayName;
    row[COL.home_logo_url] = homeLogoUrl;
    row[COL.away_logo_url] = awayLogoUrl;
    row[COL.home_logo_key] = homeKey;
    row[COL.away_logo_key] = awayKey;
    row[COL.status] = status;
    row[COL.home_score] = homeScore;
    row[COL.away_score] = awayScore;
    row[COL.generate_video] = "PENDING";
    row[COL.stadium] = stadium;
    return padRow(row);
  } catch (e) {
    return null;
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Script 1 — Fetch Jadwal via ESPN API");
  console.log("========================================");
  const ovCount = Object.keys(loadLogoKeyOverrides()).length;
  if (ovCount) console.log(`   ℹ logo-key-overrides.json: ${ovCount} entri`);

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error("❌ Google credentials belum lengkap di .env");
    process.exit(1);
  }

  console.log("\n🔗 Connecting ke Google Sheets...");
  const sheets = await getSheets();
  console.log("   ✓ Connected");

  const existing = await getExistingKeys(sheets);

  let totalNew = 0;

  for (const competition of COMPETITIONS) {
    console.log(`\n📡 Fetching ${competition.name} (${competition.espn_code})...`);

    const { events, leagueLogoUrl } = await espnFetchAllMatches(competition.espn_code);

    if (events.length === 0) {
      console.log("   ⚠ Tidak ada data dari ESPN");
      await delay(2000);
      continue;
    }

    const newRows = [];
    let skipped = 0;

    for (const event of events) {
      const row = transformEvent(event, competition, leagueLogoUrl);
      if (!row) { skipped++; continue; }

      // Cek duplikat: league|season|date|home|away
      const key = `${row[0]}|${row[1]}|${normalizeMatchDateForKey(row[3])}|${row[7]}|${row[8]}`;
      if (existing.has(key)) { skipped++; continue; }

      newRows.push(row);
      existing.add(key);
    }

    console.log(`   📋 ${newRows.length} baru, ${skipped} skip`);

    if (newRows.length > 0) {
      await writeRowsBatch(sheets, newRows);
      totalNew += newRows.length;
      console.log(`   ✅ ${newRows.length} match berhasil ditulis`);
    } else {
      console.log(`   ⏭  Semua sudah ada di Sheet`);
    }

    await delay(2000);
  }

  console.log("\n========================================");
  console.log(`✅ Selesai! Total ${totalNew} match ditulis ke Sheet`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});