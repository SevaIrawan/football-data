/**
 * SCRIPT 5 — UPDATE KLASEMEN
 * ========================
 * Tab Standings       → klasemen terkini (TIMPA setiap run)
 * Tab Standings_History → snapshot per pekan (APPEND, dedupe by matchweek)
 *
 * matchweek:
 * - Liga dengan fd_code → football-data.org currentMatchday
 * - Liga tanpa fd_code (ISL) → max matchweek dari tab Result (musim sama)
 *
 *   node script5_update_standings.js
 */

require("dotenv").config();
const axios = require("axios");
const { google } = require("googleapis");
const { SEASON_LABEL, COMPETITIONS, getSeasonStartYear } = require("./season.config");
const {
  STANDINGS_SHEET_NAME,
  STANDINGS_HEADERS,
  STANDINGS_COL,
  STANDINGS_LAST_COL,
  padStandingsRow,
  STANDINGS_HISTORY_SHEET_NAME,
  STANDINGS_HISTORY_HEADERS,
  STANDINGS_HISTORY_LAST_COL,
  standingsRowToHistoryRow,
  standingsHistoryKey,
} = require("./standings-columns");
const { COL, sheetDataRange } = require("./sheet-columns");
const { displayNameToLogoKey } = require("./logo-key");
const { writeSheetMergeSeason } = require("./sheet-season-merge");

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const RESULT_SHEET_NAME = "Result";
const RESULT_SCAN_MAX_ROW = 50000;
const HISTORY_SCAN_MAX_ROW = 50000;

const ESPN_STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports/soccer";
const FD_BASE = "https://api.football-data.org/v4";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

const CLEAR_MAX_ROW = 5000;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowGmt7String() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}/${mo}/${da} ${hh}:${mm}:${ss}`;
}

function statByName(entry, name) {
  for (const s of entry.stats || []) {
    if ((s.name || "") === name) {
      const v = s.displayValue ?? s.value;
      return v === undefined || v === null ? "" : String(v).trim();
    }
  }
  return "";
}

function formatBoolNational(v) {
  if (v === true) return "TRUE";
  if (v === false) return "FALSE";
  return "";
}

function buildRow(competition, groupName, entry, updatedAt) {
  const team = entry.team || {};
  const row = new Array(STANDINGS_HEADERS.length).fill("");

  row[STANDINGS_COL.espn_code] = competition.espn_code;
  row[STANDINGS_COL.league_name] = competition.name;
  row[STANDINGS_COL.season] = SEASON_LABEL;
  row[STANDINGS_COL.group_name] = groupName;
  row[STANDINGS_COL.rank] = statByName(entry, "rank");
  const teamName = team.displayName || team.name || "";
  row[STANDINGS_COL.team_name] = teamName;
  row[STANDINGS_COL.team_logo_url] = team.logos?.[0]?.href || team.logo || "";
  row[STANDINGS_COL.team_logo_key] = displayNameToLogoKey(teamName);
  row[STANDINGS_COL.team_abbr] = team.abbreviation || "";
  row[STANDINGS_COL.is_national] = formatBoolNational(team.isNational);
  row[STANDINGS_COL.played] = statByName(entry, "gamesPlayed");
  row[STANDINGS_COL.won] = statByName(entry, "wins");
  row[STANDINGS_COL.draw] = statByName(entry, "ties");
  row[STANDINGS_COL.lost] = statByName(entry, "losses");
  row[STANDINGS_COL.goals_for] = statByName(entry, "pointsFor");
  row[STANDINGS_COL.goals_against] = statByName(entry, "pointsAgainst");
  row[STANDINGS_COL.goal_diff] = statByName(entry, "pointDifferential");
  row[STANDINGS_COL.points] = statByName(entry, "points");
  row[STANDINGS_COL.ppg] = statByName(entry, "ppg");
  row[STANDINGS_COL.advanced] = statByName(entry, "advanced");
  row[STANDINGS_COL.deductions] = statByName(entry, "deductions");
  row[STANDINGS_COL.rank_change] = statByName(entry, "rankChange");
  row[STANDINGS_COL.updated_at] = updatedAt;

  return padStandingsRow(row);
}

async function getSheets() {
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

async function espnFetchStandings(espnCode) {
  const seasonYear = getSeasonStartYear();
  try {
    const url = `${ESPN_STANDINGS_BASE}/${espnCode}/standings`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: { season: seasonYear },
      timeout: 25000,
    });
    const children = response.data?.children || [];
    const seasonLabel = response.data?.season?.displayName || "";
    if (children.length === 0) return { children: [], seasonLabel };

    const totalGp = (children[0]?.standings?.entries || []).reduce((sum, e) => {
      const gp = parseInt(statByName(e, "gamesPlayed"), 10);
      return sum + (Number.isFinite(gp) ? gp : 0);
    }, 0);
    if (totalGp === 0) {
      console.warn(
        `   ⚠ Semua tim gamesPlayed=0 (${seasonLabel}) — cek SEASON_LABEL / musim di season.config.js`,
      );
    }

    return { children, seasonLabel };
  } catch (error) {
    console.error(`   ✗ ESPN standings ${espnCode}: ${error.message}`);
    return null;
  }
}

function parseStandingsRows(competition, children, updatedAt) {
  const rows = [];
  for (const child of children) {
    const groupName = child.name || child.abbreviation || competition.name;
    const entries = child.standings?.entries || [];
    for (const entry of entries) {
      if (!entry?.team) continue;
      rows.push(buildRow(competition, groupName, entry, updatedAt));
    }
  }
  return rows;
}

async function fetchFdCurrentMatchweekMap() {
  const map = {};
  if (!FOOTBALL_DATA_API_KEY) return map;

  for (const c of COMPETITIONS) {
    if (!c.fd_code) continue;
    try {
      const r = await axios.get(`${FD_BASE}/competitions/${c.fd_code}`, {
        headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
        timeout: 15000,
      });
      const md = r.data?.currentSeason?.currentMatchday;
      if (Number.isFinite(md) && md > 0) map[c.fd_code] = md;
      await delay(350);
    } catch (e) {
      console.warn(`   ⚠ FD matchday ${c.fd_code}: ${e.response?.status || e.message}`);
    }
  }
  return map;
}

async function fetchMaxMatchweekFromResult(sheets) {
  const map = {};
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: sheetDataRange(RESULT_SCAN_MAX_ROW, RESULT_SHEET_NAME),
    });
    for (const row of res.data.values || []) {
      const league = String(row[COL.league_name] || "").trim();
      const season = String(row[COL.season] || "").trim();
      if (season !== SEASON_LABEL || !league) continue;
      const mw = parseInt(String(row[COL.matchweek] || "").trim(), 10);
      if (!Number.isFinite(mw) || mw <= 0) continue;
      map[league] = Math.max(map[league] || 0, mw);
    }
  } catch (e) {
    console.warn(`   ⚠ Baca matchweek Result: ${e.message}`);
  }
  return map;
}

function resolveMatchweek(competition, fdMap, resultMap) {
  if (competition.fd_code && fdMap[competition.fd_code]) {
    return fdMap[competition.fd_code];
  }
  if (resultMap[competition.name]) return resultMap[competition.name];
  return "";
}

async function writeStandingsSheet(sheets, allRows) {
  const result = await writeSheetMergeSeason(sheets, {
    sheetId: GOOGLE_SHEET_ID,
    sheetName: STANDINGS_SHEET_NAME,
    headers: STANDINGS_HEADERS,
    lastCol: STANDINGS_LAST_COL,
    clearMaxRow: CLEAR_MAX_ROW,
    newRows: allRows,
    seasonColIndex: STANDINGS_COL.season,
    currentSeason: SEASON_LABEL,
  });
  if (result.keptOtherSeasons > 0) {
    console.log(`   ℹ Standings: ${result.keptOtherSeasons} baris musim lama dipertahankan`);
  }
}

async function loadHistoryKeys(sheets) {
  const keys = new Set();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${STANDINGS_HISTORY_SHEET_NAME}!A2:${STANDINGS_HISTORY_LAST_COL}${HISTORY_SCAN_MAX_ROW}`,
    });
    for (const row of res.data.values || []) {
      keys.add(standingsHistoryKey(row));
    }
  } catch (_) {
    /* tab belum ada — keys kosong */
  }
  return keys;
}

async function ensureHistoryHeader(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${STANDINGS_HISTORY_SHEET_NAME}!A1:${STANDINGS_HISTORY_LAST_COL}1`,
  });
  const row = res.data.values?.[0] || [];
  const ok =
    row.length >= STANDINGS_HISTORY_HEADERS.length &&
    STANDINGS_HISTORY_HEADERS.every((h, i) => row[i] === h);
  if (!ok) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${STANDINGS_HISTORY_SHEET_NAME}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [STANDINGS_HISTORY_HEADERS] },
    });
    console.log(`   ✓ Header Standings_History diperbaiki (A1:${STANDINGS_HISTORY_LAST_COL}1)`);
  }
}

function leagueWeekAlreadyInHistory(keys, season, espnCode, matchweek) {
  const prefix = `${season}|${espnCode}|${matchweek}|`;
  for (const k of keys) {
    if (k.startsWith(prefix)) return true;
  }
  return false;
}

async function appendHistoryRows(sheets, historyRows) {
  if (!historyRows.length) return;

  await ensureHistoryHeader(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${STANDINGS_HISTORY_SHEET_NAME}!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: historyRows },
  });
}

async function main() {
  console.log("🚀 Script 5 — Update klasemen");
  console.log("   Standings (refresh musim aktif, arsip musim lama tetap) + History append");
  console.log("============================================================");

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error("❌ Google credentials belum lengkap di .env");
    process.exit(1);
  }

  const sheets = await getSheets();
  const updatedAt = nowGmt7String();
  const fdMap = await fetchFdCurrentMatchweekMap();
  const resultMwMap = await fetchMaxMatchweekFromResult(sheets);
  const historyKeys = await loadHistoryKeys(sheets);

  const allRows = [];
  const historyToAppend = [];
  let skipped = 0;
  let historySkippedLeagues = 0;

  for (const competition of COMPETITIONS) {
    console.log(`\n📡 ${competition.name} (${competition.espn_code})...`);
    const fetched = await espnFetchStandings(competition.espn_code);
    await delay(400);

    if (!fetched || fetched.children.length === 0) {
      console.log("   ⚠ Tidak ada data klasemen");
      skipped++;
      continue;
    }

    if (fetched.seasonLabel) {
      console.log(`   ℹ ESPN season: ${fetched.seasonLabel}`);
    }

    const rows = parseStandingsRows(competition, fetched.children, updatedAt);
    console.log(`   ✓ ${fetched.children.length} grup/fase, ${rows.length} tim`);
    allRows.push(...rows);

    const matchweek = resolveMatchweek(competition, fdMap, resultMwMap);
    if (matchweek === "") {
      console.log("   ⏭ History: matchweek tidak diketahui (skip append pekan ini)");
      historySkippedLeagues++;
      continue;
    }

    if (leagueWeekAlreadyInHistory(historyKeys, SEASON_LABEL, competition.espn_code, matchweek)) {
      console.log(`   ⏭ History: GW/MW ${matchweek} sudah tersimpan`);
      historySkippedLeagues++;
      continue;
    }

    for (const row of rows) {
      const hRow = standingsRowToHistoryRow(row, matchweek);
      historyToAppend.push(hRow);
      historyKeys.add(standingsHistoryKey(hRow));
    }
    console.log(`   📎 History: akan append GW/MW ${matchweek} (${rows.length} baris)`);
  }

  if (allRows.length === 0) {
    console.error("\n❌ Tidak ada data klasemen untuk ditulis.");
    process.exit(1);
  }

  console.log(`\n✍️  Standings — timpa ${allRows.length} baris...`);
  await writeStandingsSheet(sheets, allRows);

  if (historyToAppend.length > 0) {
    console.log(`✍️  Standings_History — append ${historyToAppend.length} baris...`);
    await appendHistoryRows(sheets, historyToAppend);
  } else {
    console.log("ℹ️  Standings_History — tidak ada snapshot pekan baru");
  }

  console.log("\n============================================================");
  console.log(`✅ Selesai — Standings: ${allRows.length} baris`);
  console.log(`   History append: ${historyToAppend.length} baris`);
  console.log(`   updated_at: ${updatedAt} (GMT+7)`);
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
