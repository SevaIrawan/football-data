/**
 * SCRIPT 2 — UPDATE RESULT, STATISTIK, KLASEMEN & SCORERS via ESPN API
 * ======================================================================
 * Source: 100% ESPN Hidden API (tanpa API key, gratis)
 * Data: skor, shots, possession, corners, fouls, cards, goal scorers, rank
 *
 * Cara pakai:
 * node script2_update_results.js
 *
 * Cron job tiap 10 menit:
 * Tambah di Task Scheduler Windows atau jalankan manual
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
  { espn_code: "eng.1",          name: "Premier League" },
  { espn_code: "esp.1",          name: "La Liga" },
  { espn_code: "ita.1",          name: "Serie A" },
  { espn_code: "ger.1",          name: "Bundesliga" },
  { espn_code: "fra.1",          name: "Ligue 1" },
  { espn_code: "uefa.champions", name: "Champions League" },
];

// Kolom index (0-based) — 35 kolom
const COL = {
  league_name:          0,
  season:               1,
  matchweek:            2,
  match_date:           3,
  kickoff:              4,
  league_logo_url:      5,
  league_logo_key:      6,
  home_name:            7,
  away_name:            8,
  home_logo_url:        9,
  away_logo_url:        10,
  home_logo_key:        11,
  away_logo_key:        12,
  status:               13,
  home_score:           14,
  away_score:           15,
  shots_on_target_home: 16,
  shots_on_target_away: 17,
  possession_home:      18,
  possession_away:      19,
  corners_home:         20,
  corners_away:         21,
  fouls_home:           22,
  fouls_away:           23,
  yellow_cards_home:    24,
  yellow_cards_away:    25,
  red_cards_home:       26,
  red_cards_away:       27,
  home_goal_scorers:    28,
  away_goal_scorers:    29,
  flashscore_url:       30,
  generate_video:       31,
  uploaded_at:          32,
  home_league_rank:     33,
  away_league_rank:     34,
};

// ─── HELPER ────────────────────────────────────────────────────────────────

function utcToGmt7Date(utcDateStr) {
  const date = new Date(utcDateStr);
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return gmt7.toISOString().split("T")[0];
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeName(name) {
  return (name || "").toLowerCase().trim()
    .replace(/fc$/i, "").replace(/^fc /i, "")
    .replace(/\s+/g, " ").trim();
}

function nameMatch(sheetName, espnName) {
  const s = normalizeName(sheetName);
  const e = normalizeName(espnName);
  if (s === e) return true;
  if (s.includes(e) || e.includes(s)) return true;
  // Match kata utama (minimal 4 karakter)
  const words = e.split(" ").filter((w) => w.length >= 4);
  return words.some((w) => s.includes(w));
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

async function getAllRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A2:AI`,
  });
  return res.data.values || [];
}

async function updateRow(sheets, rowIndex, values) {
  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A${sheetRow}:AI${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

// ─── ESPN API FUNCTIONS ────────────────────────────────────────────────────

// 1. Fetch semua match FINISHED dari ESPN scoreboard
async function espnGetFinishedMatches(espnCode) {
  try {
    const url = `${ESPN_BASE}/${espnCode}/scoreboard`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: {
        limit: 1000,
        dates: "20250801-20260701",
      },
      timeout: 20000,
    });

    const events = response.data?.events || [];
    return events.filter((e) => {
      const status = e.competitions?.[0]?.status?.type?.name;
      return status === "STATUS_FINAL";
    });
  } catch (error) {
    console.error(`   ✗ ESPN scoreboard error: ${error.message}`);
    return [];
  }
}

// 2. Fetch detail statistik + goal scorers dari ESPN summary
async function espnGetMatchDetail(espnCode, eventId) {
  try {
    const url = `${ESPN_BASE}/${espnCode}/summary`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: { event: eventId },
      timeout: 20000,
    });

    const data = response.data;
    const comp = data.header?.competitions?.[0];
    if (!comp) return null;

    const competitors = comp.competitors || [];
    const homeTeam = competitors.find((c) => c.homeAway === "home");
    const awayTeam = competitors.find((c) => c.homeAway === "away");

    const result = {
      home_score: homeTeam?.score || "",
      away_score: awayTeam?.score || "",
      home_logo_url: homeTeam?.team?.logo || homeTeam?.team?.logos?.[0]?.href || "",
      away_logo_url: awayTeam?.team?.logo || awayTeam?.team?.logos?.[0]?.href || "",
      shots_on_target_home: "",
      shots_on_target_away: "",
      possession_home: "",
      possession_away: "",
      corners_home: "",
      corners_away: "",
      fouls_home: "",
      fouls_away: "",
      yellow_cards_home: "",
      yellow_cards_away: "",
      red_cards_home: "",
      red_cards_away: "",
      home_goal_scorers: "",
      away_goal_scorers: "",
    };

    // ── Statistik dari boxscore ──
    const teams = data.boxscore?.teams || [];
    for (const t of teams) {
      const isHome = t.homeAway === "home";
      for (const stat of (t.statistics || [])) {
        const key = (stat.name || stat.abbreviation || "").toLowerCase();
        const val = stat.displayValue ?? String(stat.value ?? "");

        if (key === "shotsontarget" || key === "shots on target") {
          isHome
            ? (result.shots_on_target_home = val)
            : (result.shots_on_target_away = val);
        } else if (key === "possessionpct" || key === "possession") {
          const num = parseFloat(val) || 0;
          const pct = num > 1 ? Math.round(num) : Math.round(num * 100);
          isHome
            ? (result.possession_home = pct)
            : (result.possession_away = pct);
        } else if (key === "cornerkicks" || key === "corners") {
          isHome
            ? (result.corners_home = val)
            : (result.corners_away = val);
        } else if (key === "foulscommitted" || key === "fouls") {
          isHome
            ? (result.fouls_home = val)
            : (result.fouls_away = val);
        } else if (key === "yellowcards" || key === "yellow cards") {
          isHome
            ? (result.yellow_cards_home = val)
            : (result.yellow_cards_away = val);
        } else if (key === "redcards" || key === "red cards") {
          isHome
            ? (result.red_cards_home = val)
            : (result.red_cards_away = val);
        }
      }
    }

    // ── Goal scorers dari scoring plays ──
    const homeId = homeTeam?.team?.id;
    const homeScorers = [];
    const awayScorers = [];

    for (const play of (data.scoringPlays || [])) {
      const teamId = play.team?.id;
      const athlete = play.athletesInvolved?.[0];
      const name = athlete?.shortName || athlete?.displayName || "";
      const minute = play.clock?.displayValue || play.period?.displayValue || "";
      if (!name) continue;
      const entry = minute ? `${name} ${minute}'` : name;
      if (teamId === homeId) homeScorers.push(entry);
      else awayScorers.push(entry);
    }

    result.home_goal_scorers = homeScorers.join(", ");
    result.away_goal_scorers = awayScorers.join(", ");

    return result;
  } catch (error) {
    console.error(`   ✗ ESPN summary error event ${eventId}: ${error.message}`);
    return null;
  }
}

// 3. Fetch klasemen dari ESPN
async function espnGetStandings(espnCode) {
  try {
    const url = `${ESPN_BASE}/${espnCode}/standings`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: { season: "2025" },
      timeout: 20000,
    });

    const rankMap = {};
    const standings = response.data?.standings || [];

    for (const group of standings) {
      for (let i = 0; i < (group.entries || []).length; i++) {
        const entry = group.entries[i];
        const rank = i + 1;
        const name = entry.team?.displayName || "";
        const abbr = entry.team?.abbreviation || "";
        const short = entry.team?.shortDisplayName || "";
        if (name) rankMap[normalizeName(name)] = rank;
        if (abbr) rankMap[abbr.toLowerCase()] = rank;
        if (short) rankMap[normalizeName(short)] = rank;
      }
    }

    return rankMap;
  } catch (error) {
    console.error(`   ✗ ESPN standings error: ${error.message}`);
    return {};
  }
}

// ─── AUTO GROUP VIDEO QUEUE ─────────────────────────────────────────────────

async function autoGroupVideoQueue(sheets, allRows) {
  const pending = [];
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (
      (row[COL.status] || "") === "FINISHED" &&
      (row[COL.generate_video] || "") === "PENDING"
    ) {
      pending.push({ index: i, row });
    }
  }

  const hasYes = allRows.some((r) => (r[COL.generate_video] || "") === "YES");

  if (!hasYes && pending.length > 0) {
    const batch = pending.slice(0, 6);
    console.log(`\n🎬 Auto-set ${batch.length} match → generate_video = YES`);
    for (const item of batch) {
      const r = [...item.row];
      while (r.length < 35) r.push("");
      r[COL.generate_video] = "YES";
      await updateRow(sheets, item.index, r);
      console.log(`   ✓ ${item.row[COL.home_name]} vs ${item.row[COL.away_name]}`);
    }
  } else if (hasYes) {
    console.log("\n⏳ Masih ada batch YES aktif");
  } else {
    console.log("\n✅ Tidak ada match PENDING baru");
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Script 2 — Update via ESPN API (100%)");
  console.log("==========================================");

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    console.error("❌ Google credentials belum lengkap di .env");
    process.exit(1);
  }

  console.log("\n🔗 Connecting ke Google Sheets...");
  const sheets = await getSheets();
  const allRows = await getAllRows(sheets);
  console.log(`   ✓ ${allRows.length} baris ditemukan`);

  // Debug sample baris pertama
  if (allRows.length > 0) {
    console.log(`\n🔍 Sample Sheet row 1:`);
    console.log(`   match_date : "${allRows[0][COL.match_date]}"`);
    console.log(`   home_name  : "${allRows[0][COL.home_name]}"`);
    console.log(`   away_name  : "${allRows[0][COL.away_name]}"`);
    console.log(`   status     : "${allRows[0][COL.status]}"`);
  }

  let totalUpdated = 0;

  for (const competition of COMPETITIONS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 ${competition.name} (${competition.espn_code})`);

    // 1. Ambil semua match FINISHED dari ESPN
    console.log(`   Fetching finished matches...`);
    const finishedMatches = await espnGetFinishedMatches(competition.espn_code);
    console.log(`   ✓ ${finishedMatches.length} match FINISHED`);

    if (finishedMatches.length === 0) {
      await delay(2000);
      continue;
    }

    // 2. Ambil klasemen dari ESPN
    console.log(`   Fetching klasemen...`);
    const rankings = await espnGetStandings(competition.espn_code);
    console.log(`   ✓ ${Object.keys(rankings).length} tim di klasemen`);

    let compUpdated = 0;

    // 3. Loop tiap match FINISHED — cari di Sheet dan update
    for (const event of finishedMatches) {
      const comp = event.competitions?.[0];
      const competitors = comp?.competitors || [];
      const homeTeam = competitors.find((c) => c.homeAway === "home");
      const awayTeam = competitors.find((c) => c.homeAway === "away");
      if (!homeTeam || !awayTeam) continue;

      const homeNameEspn = homeTeam.team?.displayName || "";
      const awayNameEspn = awayTeam.team?.displayName || "";
      const eventDate = utcToGmt7Date(event.date || "");

      // Cari row di Sheet yang cocok (belum FINISHED)
      const rowIndex = allRows.findIndex((row) => {
        if ((row[COL.status] || "") === "FINISHED") return false;
        if ((row[COL.match_date] || "").trim() !== eventDate) return false;
        return (
          nameMatch(row[COL.home_name], homeNameEspn) &&
          nameMatch(row[COL.away_name], awayNameEspn)
        );
      });

      if (rowIndex === -1) continue;

      // 4. Fetch detail statistik dari ESPN summary
      const detail = await espnGetMatchDetail(competition.espn_code, event.id);
      await delay(300);

      const row = [...allRows[rowIndex]];
      while (row.length < 35) row.push("");

      // Update semua kolom
      row[COL.status]               = "FINISHED";
      row[COL.home_score]           = detail?.home_score || homeTeam.score || "";
      row[COL.away_score]           = detail?.away_score || awayTeam.score || "";
      row[COL.shots_on_target_home] = detail?.shots_on_target_home || "";
      row[COL.shots_on_target_away] = detail?.shots_on_target_away || "";
      row[COL.possession_home]      = detail?.possession_home || "";
      row[COL.possession_away]      = detail?.possession_away || "";
      row[COL.corners_home]         = detail?.corners_home || "";
      row[COL.corners_away]         = detail?.corners_away || "";
      row[COL.fouls_home]           = detail?.fouls_home || "";
      row[COL.fouls_away]           = detail?.fouls_away || "";
      row[COL.yellow_cards_home]    = detail?.yellow_cards_home || "";
      row[COL.yellow_cards_away]    = detail?.yellow_cards_away || "";
      row[COL.red_cards_home]       = detail?.red_cards_home || "";
      row[COL.red_cards_away]       = detail?.red_cards_away || "";
      row[COL.home_goal_scorers]    = detail?.home_goal_scorers || "";
      row[COL.away_goal_scorers]    = detail?.away_goal_scorers || "";

      // Update logo jika kosong
      if (!row[COL.home_logo_url] && detail?.home_logo_url)
        row[COL.home_logo_url] = detail.home_logo_url;
      if (!row[COL.away_logo_url] && detail?.away_logo_url)
        row[COL.away_logo_url] = detail.away_logo_url;

      // Update league rank
      row[COL.home_league_rank] = rankings[normalizeName(homeNameEspn)] || "";
      row[COL.away_league_rank] = rankings[normalizeName(awayNameEspn)] || "";

      // Tulis ke Sheet
      await updateRow(sheets, rowIndex, row);
      allRows[rowIndex] = row;
      totalUpdated++;
      compUpdated++;

      console.log(
        `   ✓ ${row[COL.home_name]} ${row[COL.home_score]}-${row[COL.away_score]} ${row[COL.away_name]}` +
        ` | shots: ${row[COL.shots_on_target_home]||"?"}-${row[COL.shots_on_target_away]||"?"}` +
        ` | pos: ${row[COL.possession_home]||"?"}%-${row[COL.possession_away]||"?"}%`
      );
    }

    console.log(`   📊 ${compUpdated} match diupdate untuk ${competition.name}`);
    await delay(2000);
  }

  // Auto-group 6 match → YES
  await autoGroupVideoQueue(sheets, allRows);

  console.log("\n==========================================");
  console.log(`✅ Selesai! Total ${totalUpdated} match diupdate`);
  console.log("==========================================\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
