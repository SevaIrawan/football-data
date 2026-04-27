/**
 * SCRIPT 1 — FETCH JADWAL MUSIM 2025/26 via ESPN API
 * ====================================================
 * Source: ESPN Hidden API (tanpa API key, gratis)
 * Output: Tulis ke Google Sheet, status = SCHEDULED, generate_video = PENDING
 *
 * Cara pakai:
 * 1. npm install axios googleapis dotenv
 * 2. node script1_fetch_schedule.js
 */

require("dotenv").config();
const axios = require("axios");
const { google } = require("googleapis");

// ─── CONFIG ────────────────────────────────────────────────────────────────

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_NAME = "Result";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

const COMPETITIONS = [
  { espn_code: "eng.1",          name: "Premier League",   logo_key: "premier-league" },
  { espn_code: "esp.1",          name: "La Liga",          logo_key: "la-liga" },
  { espn_code: "ita.1",          name: "Serie A",          logo_key: "serie-a" },
  { espn_code: "ger.1",          name: "Bundesliga",       logo_key: "bundesliga" },
  { espn_code: "fra.1",          name: "Ligue 1",          logo_key: "ligue-1" },
  { espn_code: "uefa.champions", name: "Champions League", logo_key: "champions-league" },
];

const SEASON = "2025";

// ─── HELPER ────────────────────────────────────────────────────────────────

function utcToGmt7(utcDateStr) {
  const date = new Date(utcDateStr);
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const match_date = gmt7.toISOString().split("T")[0];
  const hh = String(gmt7.getUTCHours()).padStart(2, "0");
  const mm = String(gmt7.getUTCMinutes()).padStart(2, "0");
  return { match_date, kickoff: `${hh}:${mm}` };
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

async function getExisting(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A2:N`,
  });
  const rows = res.data.values || [];
  const set = new Set();
  for (const row of rows) {
    const key = `${row[0]||""}|${row[3]||""}|${row[7]||""}|${row[8]||""}`;
    set.add(key);
  }
  return set;
}

async function writeRows(sheets, rows) {
  if (!rows.length) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

// ─── ESPN: FETCH JADWAL ────────────────────────────────────────────────────

async function espnFetchSchedule(espnCode) {
  try {
    // Fetch semua match musim 2025/26
    // ESPN scoreboard dengan parameter season
    const url = `${ESPN_BASE}/${espnCode}/scoreboard`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: {
        limit: 1000,
        seasontype: 2, // regular season
        dates: "20250801-20260701",
      },
      timeout: 20000,
    });

    return response.data?.events || [];
  } catch (error) {
    // Coba endpoint alternatif
    try {
      const url2 = `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${espnCode}/seasons/${SEASON}/types/2/events`;
      const res2 = await axios.get(url2, {
        headers: ESPN_HEADERS,
        params: { limit: 1000 },
        timeout: 20000,
      });
      return res2.data?.items || [];
    } catch (err2) {
      console.error(`   ✗ Error fetch ${espnCode}: ${error.message}`);
      return [];
    }
  }
}

// ─── TRANSFORM KE FORMAT SHEET (35 KOLOM) ─────────────────────────────────

function transformEvent(event, competition) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const homeTeam = competitors.find((c) => c.homeAway === "home");
  const awayTeam = competitors.find((c) => c.homeAway === "away");
  if (!homeTeam || !awayTeam) return null;

  const { match_date, kickoff } = utcToGmt7(event.date || comp.date || "");
  const matchweek = event.week?.number || comp.week || "";
  const leagueLogo = event.competitions?.[0]?.league?.logos?.[0]?.href || "";

  const homeLogoUrl = homeTeam.team?.logos?.[0]?.href || homeTeam.team?.logo || "";
  const awayLogoUrl = awayTeam.team?.logos?.[0]?.href || awayTeam.team?.logo || "";
  const homeKey = (homeTeam.team?.abbreviation || homeTeam.team?.shortDisplayName || "")
    .toLowerCase().replace(/\s+/g, "-");
  const awayKey = (awayTeam.team?.abbreviation || awayTeam.team?.shortDisplayName || "")
    .toLowerCase().replace(/\s+/g, "-");

  const statusType = comp.status?.type?.name || "";
  let status = "SCHEDULED";
  if (statusType === "STATUS_FINAL") status = "FINISHED";
  else if (statusType === "STATUS_IN_PROGRESS") status = "LIVE";

  return [
    competition.name,                              // 1. league_name
    "2025/26",                                     // 2. season
    matchweek,                                     // 3. matchweek
    match_date,                                    // 4. match_date
    kickoff,                                       // 5. kickoff
    leagueLogo,                                    // 6. league_logo_url
    competition.logo_key,                          // 7. league_logo_key
    homeTeam.team?.displayName || "",              // 8. home_name
    awayTeam.team?.displayName || "",              // 9. away_name
    homeLogoUrl,                                   // 10. home_logo_url
    awayLogoUrl,                                   // 11. away_logo_url
    homeKey,                                       // 12. home_logo_key
    awayKey,                                       // 13. away_logo_key
    status,                                        // 14. status
    status === "FINISHED" ? (homeTeam.score || "") : "", // 15. home_score
    status === "FINISHED" ? (awayTeam.score || "") : "", // 16. away_score
    "", "", "", "", "", "", "", "",                 // 17-24. statistik (kosong, diisi Script 2)
    "", "", "", "", "", "",                         // 25-30. cards + scorers
    "",                                            // 31. flashscore_url
    "PENDING",                                     // 32. generate_video
    "",                                            // 33. uploaded_at
    "",                                            // 34. home_league_rank
    "",                                            // 35. away_league_rank
  ];
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Script 1 — Fetch Jadwal via ESPN API");
  console.log("========================================");

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    console.error("❌ Google Sheets credentials belum lengkap");
    process.exit(1);
  }

  console.log("\n🔗 Connecting ke Google Sheets...");
  const sheets = await getSheets();
  const existing = await getExisting(sheets);
  console.log(`   ✓ ${existing.size} match sudah ada di Sheet`);

  let totalNew = 0;

  for (const competition of COMPETITIONS) {
    console.log(`\n📡 Fetching ${competition.name} (${competition.espn_code})...`);

    const events = await espnFetchSchedule(competition.espn_code);
    console.log(`   ✓ ${events.length} events ditemukan`);

    const newRows = [];
    for (const event of events) {
      const row = transformEvent(event, competition);
      if (!row) continue;

      const key = `${row[0]}|${row[3]}|${row[7]}|${row[8]}`;
      if (existing.has(key)) continue;

      newRows.push(row);
      existing.add(key);
    }

    if (newRows.length > 0) {
      console.log(`   ✍️  Menulis ${newRows.length} match baru...`);
      await writeRows(sheets, newRows);
      totalNew += newRows.length;
    } else {
      console.log(`   ⏭  Semua sudah ada di Sheet`);
    }

    console.log("   ⏳ Delay 2 detik...");
    await delay(2000);
  }

  console.log("\n========================================");
  console.log(`✅ Selesai! ${totalNew} match baru ditambahkan`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
