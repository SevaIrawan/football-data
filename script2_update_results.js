/**
 * SCRIPT 2 — UPDATE RESULT, STATISTIK, KLASEMEN & SCORERS via ESPN API
 * ======================================================================
 * Source: 100% ESPN Hidden API (tanpa API key, gratis)
 * Data: skor, shots, possession, corners, fouls, cards, goal scorers, rank
 *
 * Cara pakai:
 * node script2_update_results.js
 *
 * Untuk sync berkala + status LIVE / jeda FT+10m gunakan `script2_live.js`
 * (lihat README_SCRAPER.md). Script ini tetap cocok untuk run manual/batch.
 *
 * Update hanya jika: ESPN menandai pertandingan selesai (completed / full time),
 * baris Sheet belum FINISHED, liga & tanggal & nama tim cocok, dan
 * waktu kickoff Sheet (GMT+7, sama seperti script1) sudah lewat ≥ 10 menit.
 */

require("dotenv").config();
const axios = require("axios");
const { google } = require("googleapis");
const { ESPN_DATES_RANGE, COMPETITIONS } = require("./season.config");

// ─── CONFIG ────────────────────────────────────────────────────────────────

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_NAME = "Result";
/** Sama seperti script1 — batas baris untuk baca data (hindari rentang tak terbatas). */
const SHEET_SCAN_MAX_ROW = 50000;
const DEBUG_ESPN = process.env.DEBUG_ESPN === "1";

/** Jeda antar tulis ke Sheet (kuota Google: Write requests per minute per user). */
const SHEETS_WRITE_MIN_INTERVAL_MS = Math.max(
  800,
  parseInt(process.env.SHEETS_WRITE_MIN_INTERVAL_MS || "1300", 10) || 1300,
);

/** Serial tanggal Google/Excel: hari sejak 30 Des 1899 (UTC). */
const SHEETS_DATE_EPOCH_UTC = Date.UTC(1899, 11, 30);

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

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

/** Samakan format dengan script1 (yyyy/mm/dd) untuk bandingkan dengan isi Sheet. */
function normalizeMatchDate(s) {
  const t = String(s || "").trim();
  const m = t.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (!m) return t;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function serialDayToYmd(serialInt) {
  const d = new Date(SHEETS_DATE_EPOCH_UTC + serialInt * 86400000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${mo}/${da}`;
}

/**
 * Ubah isi sel match_date (teks, serial angka, dd/mm/yyyy) → yyyy/mm/dd untuk compare & tulis ulang.
 */
function parseMatchDateCell(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const dayPart = Math.floor(v);
    if (dayPart >= 20000 && dayPart <= 100000) return serialDayToYmd(dayPart);
    return null;
  }
  const s = String(v).trim();
  const iso = /^(\d{4})[/-](\d{2})[/-](\d{2})/.exec(s);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    return `${dmy[3]}/${mm}/${dd}`;
  }
  if (/^\d{5,6}$/.test(s)) {
    const dayPart = parseInt(s, 10);
    if (dayPart >= 20000 && dayPart <= 100000) return serialDayToYmd(dayPart);
  }
  return null;
}

function comparableMatchDateFromSheet(v) {
  const ymd = parseMatchDateCell(v);
  return ymd || normalizeMatchDate(String(v || ""));
}

/**
 * Kickoff: pecahan hari (0–1), atau string hh:mm / hh:mm:ss → hh:mm:ss (GMT+7 dari script1).
 */
function formatKickoffForSheet(v) {
  if (v === null || v === undefined || v === "") return "";
  const fromFraction = (frac) => {
    const ms = Math.round(frac * 86400000);
    const hh = String(Math.floor(ms / 3600000) % 24).padStart(2, "0");
    const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };
  if (typeof v === "number" && Number.isFinite(v)) {
    const frac = v >= 1 ? v - Math.floor(v) : v;
    if (frac >= 0 && frac < 1) return fromFraction(frac);
    return "";
  }
  const s = String(v).trim();
  const timeRe = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
  const m = timeRe.exec(s);
  if (m) {
    return `${m[1].padStart(2, "0")}:${m[2]}:${(m[3] || "00").padStart(2, "0")}`;
  }
  const n = Number(s.replace(",", "."));
  if (Number.isFinite(n)) {
    const frac = n >= 1 ? n - Math.floor(n) : n;
    if (frac >= 0 && frac < 1) return fromFraction(frac);
  }
  return s;
}

function utcToGmt7Date(utcDateStr) {
  const date = new Date(utcDateStr);
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = gmt7.getUTCFullYear();
  const mo = String(gmt7.getUTCMonth() + 1).padStart(2, "0");
  const da = String(gmt7.getUTCDate()).padStart(2, "0");
  return `${y}/${mo}/${da}`;
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

function normalizeStatKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function statVal(stat) {
  const raw = stat?.displayValue ?? stat?.value ?? "";
  return String(raw).trim();
}

function parseRankFromEntry(entry, fallbackRank) {
  const stats = entry?.stats || [];
  for (const st of stats) {
    const k = normalizeStatKey(st?.name || st?.abbreviation || st?.displayName || "");
    if (k === "rank" || k === "position") {
      const n = parseInt(st?.value ?? st?.displayValue, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return fallbackRank;
}

function addRankAliases(rankMap, team, rank) {
  if (!team || !rank) return;
  if (typeof team === "string") {
    rankMap[normalizeName(team)] = rank;
    return;
  }
  const aliases = [
    team.displayName,
    team.name,
    team.shortDisplayName,
    [team.location, team.name].filter(Boolean).join(" "),
  ].filter(Boolean);
  for (const a of aliases) rankMap[normalizeName(a)] = rank;
  if (team.abbreviation) rankMap[String(team.abbreviation).toLowerCase()] = rank;
  if (team.id) rankMap[`id:${team.id}`] = rank;
}

function resolveRank(rankMap, teamName, teamAbbr) {
  return (
    rankMap[normalizeName(teamName)] ||
    rankMap[String(teamAbbr || "").toLowerCase()] ||
    ""
  );
}

function toOrdinal(n) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x) || x <= 0) return "";
  const v = x % 100;
  if (v >= 11 && v <= 13) return `${x}th`;
  switch (x % 10) {
    case 1: return `${x}st`;
    case 2: return `${x}nd`;
    case 3: return `${x}rd`;
    default: return `${x}th`;
  }
}

function parseRankMapFromSummaryStandings(summaryData) {
  const rankMap = {};
  const groups = summaryData?.standings?.groups || [];
  for (const g of groups) {
    const entries = g?.standings?.entries || [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rank = parseRankFromEntry(entry, i + 1);
      // ESPN summary kadang team object, kadang string + id di level entry
      addRankAliases(rankMap, entry?.team || entry?.teamDisplayName || "", rank);
      if (entry?.id) rankMap[`id:${entry.id}`] = rank;
      if (entry?.uid) rankMap[`uid:${entry.uid}`] = rank;
    }
  }
  return rankMap;
}

function debugLog(...args) {
  if (DEBUG_ESPN) console.log(...args);
}

/** Jeda setelah kickoff (GMT+7, sama seperti script1) sebelum boleh pull hasil dari ESPN. */
const KICKOFF_GRACE_MS = 10 * 60 * 1000;

/** Parse match_date + kickoff Sheet → timestamp UTC (kickoff dianggap zona GMT+7). */
function sheetMatchStartUtcMs(row) {
  const ymd = parseMatchDateCell(row[COL.match_date]);
  const tod = formatKickoffForSheet(row[COL.kickoff]);
  if (!ymd || !tod) return null;
  const [y, mo, da] = ymd.split("/");
  const parts = tod.split(":");
  const hh = (parts[0] || "0").padStart(2, "0");
  const mm = (parts[1] || "0").padStart(2, "0");
  const ss = (parts[2] || "00").padStart(2, "0");
  const iso = `${y}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}T${hh}:${mm}:${ss}+07:00`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function sheetKickoffGraceElapsed(row) {
  const start = sheetMatchStartUtcMs(row);
  if (start == null) return false;
  return Date.now() >= start + KICKOFF_GRACE_MS;
}

function isEspnMatchCompleted(event) {
  const t = event.competitions?.[0]?.status?.type;
  if (!t) return false;
  if (t.completed === true) return true;
  const n = t.name || "";
  return n === "STATUS_FINAL" || n === "STATUS_FULL_TIME";
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function shouldRefreshFinishedRow(row) {
  // Izinkan re-fetch untuk baris yang sudah FINISHED tapi masih ada celah data penting.
  return (
    isBlank(row[COL.corners_home]) ||
    isBlank(row[COL.corners_away]) ||
    (isBlank(row[COL.home_goal_scorers]) && isBlank(row[COL.away_goal_scorers])) ||
    isBlank(row[COL.home_league_rank]) ||
    isBlank(row[COL.away_league_rank])
  );
}

function pushUnique(arr, v) {
  const t = String(v || "").trim();
  if (!t) return;
  if (!arr.includes(t)) arr.push(t);
}

function bucketGoalEntry({
  homeScorers,
  awayScorers,
  homeId,
  awayId,
  homeName,
  awayName,
  teamId,
  teamDisplayName,
  entry,
}) {
  const teamNameNorm = normalizeName(teamDisplayName || "");
  const homeNorm = normalizeName(homeName || "");
  const awayNorm = normalizeName(awayName || "");
  if (teamId && homeId && String(teamId) === String(homeId)) {
    pushUnique(homeScorers, entry);
    return;
  }
  if (teamId && awayId && String(teamId) === String(awayId)) {
    pushUnique(awayScorers, entry);
    return;
  }
  if (teamNameNorm && (teamNameNorm === homeNorm || homeNorm.includes(teamNameNorm) || teamNameNorm.includes(homeNorm))) {
    pushUnique(homeScorers, entry);
    return;
  }
  if (teamNameNorm && (teamNameNorm === awayNorm || awayNorm.includes(teamNameNorm) || teamNameNorm.includes(awayNorm))) {
    pushUnique(awayScorers, entry);
    return;
  }
  // Jika tim tidak bisa dipetakan dengan yakin, abaikan agar tidak salah isi scorer.
}

function toNonNegativeInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function isGoalLikeType(typeValue) {
  const t = String(typeValue || "").toLowerCase();
  return t === "goal" || t === "own-goal" || t === "penalty-goal" || t === "penalty";
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
    range: `${SHEET_NAME}!A2:AI${SHEET_SCAN_MAX_ROW}`,
  });
  return res.data.values || [];
}

async function updateRow(sheets, rowIndex, values) {
  const sheetRow = rowIndex + 2;
  const row = [...values];
  while (row.length < 35) row.push("");
  const md = parseMatchDateCell(row[COL.match_date]);
  if (md) row[COL.match_date] = md;
  row[COL.kickoff] = formatKickoffForSheet(row[COL.kickoff]);
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A${sheetRow}:AI${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
  await delay(SHEETS_WRITE_MIN_INTERVAL_MS);
  return row;
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
        dates: ESPN_DATES_RANGE,
      },
      timeout: 20000,
    });

    const events = response.data?.events || [];
    // ESPN pakai STATUS_FULL_TIME (liga Eropa), bukan hanya STATUS_FINAL
    return events.filter(isEspnMatchCompleted);
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
    const homeName = homeTeam?.team?.displayName || homeTeam?.team?.name || "";
    const awayName = awayTeam?.team?.displayName || awayTeam?.team?.name || "";

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
      home_league_rank: "",
      away_league_rank: "",
      _debug_stat_keys: [],
      _debug_scoring_plays: 0,
      _debug_detail_goals: 0,
    };

    // ── Statistik dari boxscore ──
    const teams = data.boxscore?.teams || [];
    for (const t of teams) {
      const isHome = t.homeAway === "home";
      for (const stat of (t.statistics || [])) {
        const key = normalizeStatKey(stat.name || stat.displayName || stat.abbreviation || "");
        const val = statVal(stat);
        result._debug_stat_keys.push(`${t.homeAway || "?"}:${key}=${val}`);
        if (!val) continue;

        if (key.includes("shotsontarget") || key === "sot" || key.includes("shotsongoal")) {
          isHome
            ? (result.shots_on_target_home = val)
            : (result.shots_on_target_away = val);
        } else if (key.includes("possession")) {
          const num = parseFloat(val.replace("%", "")) || 0;
          const pct = num > 1 ? Math.round(num) : Math.round(num * 100);
          isHome
            ? (result.possession_home = pct)
            : (result.possession_away = pct);
        } else if (key.includes("corner")) {
          isHome
            ? (result.corners_home = val)
            : (result.corners_away = val);
        } else if (key.includes("foul")) {
          isHome
            ? (result.fouls_home = val)
            : (result.fouls_away = val);
        } else if (key.includes("yellowcard")) {
          isHome
            ? (result.yellow_cards_home = val)
            : (result.yellow_cards_away = val);
        } else if (key.includes("redcard")) {
          isHome
            ? (result.red_cards_home = val)
            : (result.red_cards_away = val);
        }
      }
    }

    // ── Goal scorers dari scoring plays ──
    const homeId = homeTeam?.team?.id;
    const awayId = awayTeam?.team?.id;
    const homeScorers = [];
    const awayScorers = [];

    for (const play of (data.scoringPlays || [])) {
      const teamId = play.team?.id;
      const teamDisplayName = play.team?.displayName || "";
      const athlete = play.athletesInvolved?.[0];
      const name = athlete?.shortName || athlete?.displayName || "";
      const minute = play.clock?.displayValue || play.period?.displayValue || "";
      if (!name) continue;
      const entry = minute ? `${name} ${minute}'` : name;
      bucketGoalEntry({
        homeScorers,
        awayScorers,
        homeId,
        awayId,
        homeName,
        awayName,
        teamId,
        teamDisplayName,
        entry,
      });
    }
    result._debug_scoring_plays = (data.scoringPlays || []).length;

    // Fallback: beberapa match menyimpan catatan gol di details, bukan scoringPlays.
    if (homeScorers.length === 0 && awayScorers.length === 0) {
      for (const d of (data.details || [])) {
        const typeText = String(d?.type?.text || d?.type?.name || "").toLowerCase();
        const typeType = String(d?.type?.type || "").toLowerCase();
        const text = String(d?.text || d?.headline || "").trim();
        const athlete = d?.athletesInvolved?.[0];
        const name = athlete?.shortName || athlete?.displayName || "";
        const minute = d?.clock?.displayValue || d?.period?.displayValue || "";
        if (!text && !name) continue;
        if (!(isGoalLikeType(typeType) || /\bgoal\b/i.test(typeText))) continue;
        result._debug_detail_goals += 1;
        const entry = name
          ? (minute ? `${name} ${minute}'` : name)
          : text;
        const teamId = d?.team?.id;
        const teamDisplayName = d?.team?.displayName || "";
        bucketGoalEntry({
          homeScorers,
          awayScorers,
          homeId,
          awayId,
          homeName,
          awayName,
          teamId,
          teamDisplayName,
          entry,
        });
      }
    }

    // Fallback lanjut: banyak match 2025/26 tidak punya scoringPlays/details,
    // tapi punya keyEvents dengan type=goal dan participants.
    if (homeScorers.length === 0 && awayScorers.length === 0) {
      for (const ev of (data.keyEvents || [])) {
        const typeText = String(ev?.type?.text || ev?.type?.name || "").toLowerCase();
        const typeType = String(ev?.type?.type || "").toLowerCase();
        const text = String(ev?.text || ev?.shortText || "").trim();
        if (!(ev?.scoringPlay === true || isGoalLikeType(typeType) || /\bgoal\b/i.test(typeText))) continue;
        const teamId = ev?.team?.id;
        const teamDisplayName = ev?.team?.displayName || "";
        const p = ev?.participants?.[0]?.athlete;
        const name = p?.shortName || p?.displayName || "";
        const minute = ev?.clock?.displayValue || ev?.period?.displayValue || "";
        const entry = name
          ? (minute ? `${name} ${minute}'` : name)
          : text;
        if (!entry) continue;
        bucketGoalEntry({
          homeScorers,
          awayScorers,
          homeId,
          awayId,
          homeName,
          awayName,
          teamId,
          teamDisplayName,
          entry,
        });
      }
    }

    // Fallback terakhir: commentary hanya jika play.type benar-benar goal (hindari false-positive "goal kick").
    if (homeScorers.length === 0 && awayScorers.length === 0) {
      for (const c of (data.commentary || [])) {
        const p = c?.play;
        const typeText = String(p?.type?.text || p?.type?.type || "").toLowerCase();
        const typeType = String(p?.type?.type || "").toLowerCase();
        const text = String(p?.text || c?.text || "").trim();
        if (!(p?.scoringPlay === true || isGoalLikeType(typeType) || /\bgoal\b/i.test(typeText))) continue;
        const athlete = p?.participants?.[0]?.athlete;
        const name = athlete?.shortName || athlete?.displayName || "";
        const minute = p?.clock?.displayValue || c?.time?.displayValue || "";
        const entry = name
          ? (minute ? `${name} ${minute}'` : name)
          : text;
        if (!entry) continue;
        bucketGoalEntry({
          homeScorers,
          awayScorers,
          homeId,
          awayId,
          homeName,
          awayName,
          teamId: p?.team?.id,
          teamDisplayName: p?.team?.displayName || "",
          entry,
        });
      }
    }

    // Guardrail final: jumlah scorer tidak boleh melebihi skor resmi.
    const homeGoals = toNonNegativeInt(result.home_score);
    const awayGoals = toNonNegativeInt(result.away_score);
    if (homeGoals === 0) homeScorers.length = 0;
    else if (homeScorers.length > homeGoals) homeScorers.length = homeGoals;
    if (awayGoals === 0) awayScorers.length = 0;
    else if (awayScorers.length > awayGoals) awayScorers.length = awayGoals;

    result.home_goal_scorers = homeScorers.join(", ");
    result.away_goal_scorers = awayScorers.join(", ");

    // Rank ambil dari standings yang embed di summary event (lebih akurat untuk "setelah match").
    // Jika tidak ada standings (mis. knockout tertentu), biarkan kosong.
    const rankMap = parseRankMapFromSummaryStandings(data);
    const homeRank =
      rankMap[`id:${homeTeam?.team?.id || ""}`] ||
      resolveRank(rankMap, homeName, homeTeam?.team?.abbreviation || "");
    const awayRank =
      rankMap[`id:${awayTeam?.team?.id || ""}`] ||
      resolveRank(rankMap, awayName, awayTeam?.team?.abbreviation || "");
    result.home_league_rank = toOrdinal(homeRank);
    result.away_league_rank = toOrdinal(awayRank);

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
    const containers = [];
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const x of node) walk(x);
        return;
      }
      if (typeof node !== "object") return;
      if (Array.isArray(node.entries) && node.entries.some((e) => e?.team)) {
        containers.push(node.entries);
      }
      for (const v of Object.values(node)) {
        if (v && (Array.isArray(v) || typeof v === "object")) walk(v);
      }
    };
    walk(response.data?.standings || response.data);

    for (const entries of containers) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const team = entry?.team;
        if (!team) continue;
        const rank = parseRankFromEntry(entry, i + 1);
        addRankAliases(rankMap, team, rank);
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
      const written = await updateRow(sheets, item.index, r);
      allRows[item.index] = written;
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
  if (DEBUG_ESPN) {
    console.log("🐞 DEBUG_ESPN=1 aktif (log detail parser & alasan data kosong)");
  }

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

    // 2. Rank akan diambil per match dari summary.standings (setelah match)
    console.log(`   Fetching rank from summary standings...`);

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
      const homeAbbrEspn = homeTeam.team?.abbreviation || "";
      const awayAbbrEspn = awayTeam.team?.abbreviation || "";
      const eventDate = utcToGmt7Date(event.date || "");

      // Cari row di Sheet yang cocok (belum FINISHED, liga sama, tanggal sama, kickoff sudah lewat +10 menit)
      const rowIndex = allRows.findIndex((row) => {
        const isFinished = (row[COL.status] || "") === "FINISHED";
        if (isFinished && !shouldRefreshFinishedRow(row)) return false;
        if ((row[COL.league_name] || "").trim() !== competition.name) return false;
        if (!sheetKickoffGraceElapsed(row)) return false;
        if (comparableMatchDateFromSheet(row[COL.match_date]) !== normalizeMatchDate(eventDate)) return false;
        return (
          nameMatch(row[COL.home_name], homeNameEspn) &&
          nameMatch(row[COL.away_name], awayNameEspn)
        );
      });

      if (rowIndex === -1) {
        debugLog(
          `   [DEBUG miss] ${competition.name} | ${eventDate} | ${homeNameEspn} vs ${awayNameEspn} | reason: row tidak match (league/date/name/kickoff+10m)`,
        );
        continue;
      }

      // 4. Fetch detail statistik dari ESPN summary
      const detail = await espnGetMatchDetail(competition.espn_code, event.id);
      await delay(300);
      if (!detail) {
        debugLog(`   [DEBUG detail] event ${event.id} summary kosong/error`);
      }

      const row = [...allRows[rowIndex]];
      while (row.length < 35) row.push("");

      // Update semua kolom
      row[COL.status]               = "FINISHED";
      row[COL.home_score]           = detail?.home_score || homeTeam.score || row[COL.home_score] || "";
      row[COL.away_score]           = detail?.away_score || awayTeam.score || row[COL.away_score] || "";
      row[COL.shots_on_target_home] = detail?.shots_on_target_home || row[COL.shots_on_target_home] || "";
      row[COL.shots_on_target_away] = detail?.shots_on_target_away || row[COL.shots_on_target_away] || "";
      row[COL.possession_home]      = detail?.possession_home || row[COL.possession_home] || "";
      row[COL.possession_away]      = detail?.possession_away || row[COL.possession_away] || "";
      row[COL.corners_home]         = detail?.corners_home || row[COL.corners_home] || "";
      row[COL.corners_away]         = detail?.corners_away || row[COL.corners_away] || "";
      row[COL.fouls_home]           = detail?.fouls_home || row[COL.fouls_home] || "";
      row[COL.fouls_away]           = detail?.fouls_away || row[COL.fouls_away] || "";
      row[COL.yellow_cards_home]    = detail?.yellow_cards_home || row[COL.yellow_cards_home] || "";
      row[COL.yellow_cards_away]    = detail?.yellow_cards_away || row[COL.yellow_cards_away] || "";
      row[COL.red_cards_home]       = detail?.red_cards_home || row[COL.red_cards_home] || "";
      row[COL.red_cards_away]       = detail?.red_cards_away || row[COL.red_cards_away] || "";
      row[COL.home_goal_scorers]    = detail?.home_goal_scorers || row[COL.home_goal_scorers] || "";
      row[COL.away_goal_scorers]    = detail?.away_goal_scorers || row[COL.away_goal_scorers] || "";

      // Update logo jika kosong
      if (!row[COL.home_logo_url] && detail?.home_logo_url)
        row[COL.home_logo_url] = detail.home_logo_url;
      if (!row[COL.away_logo_url] && detail?.away_logo_url)
        row[COL.away_logo_url] = detail.away_logo_url;

      // Update league rank
      row[COL.home_league_rank] = detail?.home_league_rank || row[COL.home_league_rank] || "";
      row[COL.away_league_rank] = detail?.away_league_rank || row[COL.away_league_rank] || "";

      if (DEBUG_ESPN) {
        const missing = [];
        if (!row[COL.corners_home] || !row[COL.corners_away]) missing.push("corners");
        if (!row[COL.home_goal_scorers] && !row[COL.away_goal_scorers]) missing.push("scorers");
        if (!row[COL.home_league_rank] || !row[COL.away_league_rank]) missing.push("rank");
        if (missing.length > 0) {
          console.log(
            `   [DEBUG fields] event ${event.id} missing=${missing.join(",")} | scoringPlays=${detail?._debug_scoring_plays ?? 0} | detailGoals=${detail?._debug_detail_goals ?? 0}`,
          );
          if (detail?._debug_stat_keys?.length) {
            console.log(`   [DEBUG stats] ${detail._debug_stat_keys.slice(0, 16).join(" | ")}`);
          }
        }
      }

      // Tulis ke Sheet (match_date & kickoff dinormalisasi ke teks seperti script1)
      const written = await updateRow(sheets, rowIndex, row);
      allRows[rowIndex] = written;
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
