/**
 * SCRIPT 1 — FETCH JADWAL MUSIM 2025/26 via ESPN API
 * ====================================================
 * Source: ESPN Hidden API (tanpa API key, gratis)
 * Output: Tulis ke Google Sheet mulai row 2
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");
const { SEASON_LABEL, ESPN_DATES_RANGE, COMPETITIONS } = require("./season.config");

// ─── CONFIG ────────────────────────────────────────────────────────────────

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

const LOGO_KEY_OVERRIDES_PATH = path.join(__dirname, "logo-key-overrides.json");

/** Slug dari displayName ESPN → fallback Next.js bila URL logo kosong. */
function loadLogoKeyOverrides() {
  try {
    if (!fs.existsSync(LOGO_KEY_OVERRIDES_PATH)) return {};
    const raw = fs.readFileSync(LOGO_KEY_OVERRIDES_PATH, "utf8");
    const o = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

const LOGO_KEY_OVERRIDES = loadLogoKeyOverrides();

/**
 * Nama tim (ESPN) → logo_key: huruf kecil, pemisah "-", tanpa token fc/cf/ss/sc,
 * "/" jadi "-". Cocokkan file opsional logo-key-overrides.json (slug → slug final).
 */
function displayNameToLogoKey(displayName) {
  const stripTokens = new Set(["fc", "cf", "ss", "sc"]);
  let s = String(displayName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\//g, "-")
    .replace(/&/g, " and ")
    .toLowerCase();

  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  const parts = s.split(/\s+/).filter(Boolean).filter((w) => !stripTokens.has(w));
  let slug = parts.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return "";

  if (LOGO_KEY_OVERRIDES[slug]) return LOGO_KEY_OVERRIDES[slug];
  return slug;
}

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
      const key = `${row[0]||""}|${normalizeMatchDateForKey(row[3])}|${row[7]||""}|${row[8]||""}`;
      set.add(key);
    }
    console.log(`   ✓ ${set.size} match sudah ada di Sheet`);
    return set;
  } catch (e) {
    console.error("   ✗ Error baca Sheet:", e.message);
    return new Set();
  }
}

async function writeRowsBatch(sheets, rows) {
  if (!rows.length) return;

  // Pakai update ke baris kosong pertama (kolom A), bukan append — append sering melompat
  // ke bawah jika ada sel/format di baris jauh atau “table” Sheets terdeteksi salah.
  const BATCH = 500;
  let startRow = await getFirstWriteRow(sheets);

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

// ─── TRANSFORM EVENT KE 35 KOLOM ──────────────────────────────────────────

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

    return [
      competition.name,    // 1.  league_name
      SEASON_LABEL,        // 2.  season
      matchweek,           // 3.  matchweek
      match_date,          // 4.  match_date
      kickoff,             // 5.  kickoff
      leagueLogo,          // 6.  league_logo_url
      competition.logo_key,// 7.  league_logo_key
      homeName,            // 8.  home_name
      awayName,            // 9.  away_name
      homeLogoUrl,         // 10. home_logo_url
      awayLogoUrl,         // 11. away_logo_url
      homeKey,             // 12. home_logo_key
      awayKey,             // 13. away_logo_key
      status,              // 14. status
      homeScore,           // 15. home_score
      awayScore,           // 16. away_score
      "",                  // 17. shots_on_target_home
      "",                  // 18. shots_on_target_away
      "",                  // 19. possession_home
      "",                  // 20. possession_away
      "",                  // 21. corners_home
      "",                  // 22. corners_away
      "",                  // 23. fouls_home
      "",                  // 24. fouls_away
      "",                  // 25. yellow_cards_home
      "",                  // 26. yellow_cards_away
      "",                  // 27. red_cards_home
      "",                  // 28. red_cards_away
      "",                  // 29. home_goal_scorers
      "",                  // 30. away_goal_scorers
      "",                  // 31. flashscore_url
      "PENDING",           // 32. generate_video
      "",                  // 33. uploaded_at
      "",                  // 34. home_league_rank
      "",                  // 35. away_league_rank
    ];
  } catch (e) {
    return null;
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Script 1 — Fetch Jadwal via ESPN API");
  console.log("========================================");
  const ovCount = Object.keys(LOGO_KEY_OVERRIDES).length;
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

      // Cek duplikat: league|date|home|away
      const key = `${row[0]}|${normalizeMatchDateForKey(row[3])}|${row[7]}|${row[8]}`;
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