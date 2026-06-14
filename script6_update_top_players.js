/**
 * SCRIPT 6 — UPDATE TOP SCORERS & TOP ASSISTS
 * ===========================================
 * Tab Top_Scores  → top gol musim aktif (TIMPA)
 * Tab Top_Assist  → top assist musim aktif (TIMPA)
 *
 * Sumber:
 * - football-data.org /scorers (fd_code) — goals + assists sekaligus
 * - Fallback ESPN Core leaders (Goals / Assists) jika FD gagal atau fd_code null
 *
 *   node script6_update_top_players.js
 */

require("dotenv").config();
const axios = require("axios");
const { google } = require("googleapis");
const { SEASON_LABEL, COMPETITIONS, getSeasonStartYear } = require("./season.config");
const { displayNameToLogoKey } = require("./logo-key");
const { writeSheetMergeSeason } = require("./sheet-season-merge");
const {
  TOP_SCORES_SHEET_NAME,
  TOP_ASSIST_SHEET_NAME,
  TOP_PLAYERS_HEADERS,
  TOP_PLAYERS_COL,
  TOP_PLAYERS_LAST_COL,
  padTopPlayersRow,
} = require("./top-players-columns");

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;

const FD_BASE = "https://api.football-data.org/v4";
const ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

const FD_LIMIT = 25;
const ESPN_LIMIT = 15;
const CLEAR_MAX_ROW = 5000;
const REF_CACHE = new Map();

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

function numOrEmpty(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v).trim();
}

function parseEspnShortStats(shortDisplayValue) {
  const out = { played: "", goals: "", assists: "" };
  const s = String(shortDisplayValue || "");
  const m = s.match(/M:\s*(\d+)/i);
  const g = s.match(/G:\s*(\d+)/i);
  const a = s.match(/A:\s*(\d+)/i);
  if (m) out.played = m[1];
  if (g) out.goals = g[1];
  if (a) out.assists = a[1];
  return out;
}

async function resolveEspnRef(ref) {
  if (!ref) return null;
  if (REF_CACHE.has(ref)) return REF_CACHE.get(ref);
  try {
    const r = await axios.get(ref, { headers: ESPN_HEADERS, timeout: 15000 });
    REF_CACHE.set(ref, r.data);
    await delay(120);
    return r.data;
  } catch {
    REF_CACHE.set(ref, null);
    return null;
  }
}

function buildPlayerRow(competition, data, updatedAt) {
  const row = new Array(TOP_PLAYERS_HEADERS.length).fill("");
  row[TOP_PLAYERS_COL.espn_code] = competition.espn_code;
  row[TOP_PLAYERS_COL.league_name] = competition.name;
  row[TOP_PLAYERS_COL.season] = SEASON_LABEL;
  row[TOP_PLAYERS_COL.rank] = "";
  row[TOP_PLAYERS_COL.player_name] = data.player_name || "";
  row[TOP_PLAYERS_COL.player_id] = data.player_id || "";
  const teamName = data.team_name || "";
  row[TOP_PLAYERS_COL.team_name] = teamName;
  row[TOP_PLAYERS_COL.team_logo_url] = data.team_logo_url || "";
  row[TOP_PLAYERS_COL.team_logo_key] = displayNameToLogoKey(teamName);
  row[TOP_PLAYERS_COL.goals] = numOrEmpty(data.goals);
  row[TOP_PLAYERS_COL.assists] = numOrEmpty(data.assists);
  row[TOP_PLAYERS_COL.penalties] = numOrEmpty(data.penalties);
  row[TOP_PLAYERS_COL.played] = numOrEmpty(data.played);
  row[TOP_PLAYERS_COL.updated_at] = updatedAt;
  return padTopPlayersRow(row);
}

function assignRanks(rows, statKey) {
  const sorted = rows.map((r) => [...r]).sort((a, b) => {
    const av = parseInt(a[TOP_PLAYERS_COL[statKey]] || "0", 10) || 0;
    const bv = parseInt(b[TOP_PLAYERS_COL[statKey]] || "0", 10) || 0;
    return bv - av;
  });
  sorted.forEach((row, i) => {
    row[TOP_PLAYERS_COL.rank] = String(i + 1);
  });
  return sorted;
}

async function fetchFdScorers(fdCode) {
  const r = await axios.get(`${FD_BASE}/competitions/${fdCode}/scorers`, {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    params: { limit: FD_LIMIT },
    timeout: 25000,
  });
  return r.data?.scorers || [];
}

function mapFdEntry(entry) {
  const teamName = entry.team?.shortName || entry.team?.name || "";
  return {
    player_name: entry.player?.name || "",
    player_id: entry.player?.id != null ? String(entry.player.id) : "",
    team_name: teamName,
    team_logo_url: entry.team?.crest || "",
    goals: entry.goals,
    assists: entry.assists,
    penalties: entry.penalties,
    played: entry.playedMatches,
  };
}

async function fetchEspnLeaders(espnCode, seasonYear) {
  const url = `${ESPN_CORE_BASE}/${espnCode}/seasons/${seasonYear}/types/0/leaders`;
  const r = await axios.get(url, { headers: ESPN_HEADERS, timeout: 25000 });
  return r.data?.categories || [];
}

function pickCategory(categories, name) {
  return categories.find((c) => (c.displayName || c.name || "") === name);
}

async function mapEspnLeader(leader, primaryStat) {
  const parsed = parseEspnShortStats(leader.shortDisplayValue);
  const athlete = await resolveEspnRef(leader.athlete?.$ref);
  const team = await resolveEspnRef(leader.team?.$ref);

  const goals =
    primaryStat === "goals"
      ? numOrEmpty(leader.value)
      : parsed.goals || "";
  const assists =
    primaryStat === "assists"
      ? numOrEmpty(leader.value)
      : parsed.assists || "";

  const teamName = team?.displayName || team?.name || team?.shortDisplayName || "";

  return {
    player_name: athlete?.displayName || athlete?.fullName || "",
    player_id: athlete?.id != null ? String(athlete.id) : "",
    team_name: teamName,
    team_logo_url: team?.logos?.[0]?.href || team?.logo || "",
    goals,
    assists,
    penalties: "",
    played: parsed.played || "",
  };
}

async function fetchFromFd(competition, updatedAt) {
  const scorers = await fetchFdScorers(competition.fd_code);
  if (!scorers.length) return null;

  const baseRows = scorers.map((entry) =>
    buildPlayerRow(competition, mapFdEntry(entry), updatedAt),
  );
  return {
    scores: assignRanks(baseRows, "goals"),
    assists: assignRanks(baseRows, "assists"),
  };
}

async function fetchFromEspn(competition, updatedAt, seasonYear) {
  const categories = await fetchEspnLeaders(competition.espn_code, seasonYear);
  const goalsCat = pickCategory(categories, "Goals");
  const assistsCat = pickCategory(categories, "Assists");
  if (!goalsCat && !assistsCat) return null;

  const scoreRows = [];
  for (const leader of (goalsCat?.leaders || []).slice(0, ESPN_LIMIT)) {
    const data = await mapEspnLeader(leader, "goals");
    if (data.player_name) scoreRows.push(buildPlayerRow(competition, data, updatedAt));
  }

  const assistRows = [];
  for (const leader of (assistsCat?.leaders || []).slice(0, ESPN_LIMIT)) {
    const data = await mapEspnLeader(leader, "assists");
    if (data.player_name) assistRows.push(buildPlayerRow(competition, data, updatedAt));
  }

  assignRanks(scoreRows, "goals");
  assignRanks(assistRows, "assists");

  if (!scoreRows.length && !assistRows.length) return null;
  return { scores: scoreRows, assists: assistRows };
}

async function fetchLeagueTopPlayers(competition, updatedAt, seasonYear) {
  if (competition.fd_code && FOOTBALL_DATA_API_KEY) {
    try {
      const fd = await fetchFromFd(competition, updatedAt);
      if (fd) return { ...fd, source: "football-data.org" };
    } catch (e) {
      console.warn(`   ⚠ FD scorers ${competition.fd_code}: ${e.response?.status || e.message}`);
    }
    await delay(400);
  }

  try {
    const espn = await fetchFromEspn(competition, updatedAt, seasonYear);
    if (espn) return { ...espn, source: "ESPN" };
  } catch (e) {
    console.warn(`   ⚠ ESPN leaders ${competition.espn_code}: ${e.response?.status || e.message}`);
  }

  return null;
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

async function writeTopPlayersSheet(sheets, sheetName, allRows) {
  const result = await writeSheetMergeSeason(sheets, {
    sheetId: GOOGLE_SHEET_ID,
    sheetName,
    headers: TOP_PLAYERS_HEADERS,
    lastCol: TOP_PLAYERS_LAST_COL,
    clearMaxRow: CLEAR_MAX_ROW,
    newRows: allRows,
    seasonColIndex: TOP_PLAYERS_COL.season,
    currentSeason: SEASON_LABEL,
  });
  if (result.keptOtherSeasons > 0) {
    console.log(`   ℹ ${sheetName}: ${result.keptOtherSeasons} baris musim lama dipertahankan`);
  }
  return result;
}

async function main() {
  console.log("🚀 Script 6 — Top Scorers & Top Assists");
  console.log("   Top_Scores + Top_Assist (musim aktif refresh, musim lama tetap)");
  console.log("============================================================");

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error("❌ Google credentials belum lengkap di .env");
    process.exit(1);
  }

  if (!FOOTBALL_DATA_API_KEY) {
    console.warn("⚠ FOOTBALL_DATA_API_KEY kosong — hanya ESPN fallback (lebih lambat, ISL mungkin kosong)");
  }

  const sheets = await getSheets();
  const updatedAt = nowGmt7String();
  const seasonYear = getSeasonStartYear();

  const allScoreRows = [];
  const allAssistRows = [];
  let skipped = 0;

  for (const competition of COMPETITIONS) {
    console.log(`\n📡 ${competition.name} (${competition.espn_code})...`);
    const result = await fetchLeagueTopPlayers(competition, updatedAt, seasonYear);
    await delay(350);

    if (!result) {
      console.log("   ⚠ Tidak ada data top players");
      skipped++;
      continue;
    }

    console.log(
      `   ✓ ${result.source}: ${result.scores.length} scorers, ${result.assists.length} assists`,
    );
    allScoreRows.push(...result.scores);
    allAssistRows.push(...result.assists);
  }

  console.log(`\n✍️  Top_Scores — refresh ${allScoreRows.length} baris (musim ${SEASON_LABEL})...`);
  await writeTopPlayersSheet(sheets, TOP_SCORES_SHEET_NAME, allScoreRows);

  console.log(`✍️  Top_Assist — refresh ${allAssistRows.length} baris (musim ${SEASON_LABEL})...`);
  await writeTopPlayersSheet(sheets, TOP_ASSIST_SHEET_NAME, allAssistRows);

  console.log("\n============================================================");
  console.log(`✅ Selesai — Top_Scores: ${allScoreRows.length} | Top_Assist: ${allAssistRows.length}`);
  console.log(`   Liga skip: ${skipped}`);
  console.log(`   updated_at: ${updatedAt}`);
  console.log("============================================================\n");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
