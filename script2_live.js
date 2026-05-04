/**
 * SCRIPT 2 LIVE — sync berkala: SCHEDULED↔LIVE↔FINISHED + skor dulu, stat menyusul
 * =============================================================================
 * Jalankan setelah `script2_update_results.js` manual sekali (beban awal).
 *
 * Aturan ringkas:
 * - Hanya baris yang liga-nya ada di season.config.js & tanggal dalam ESPN_DATES_RANGE.
 * - Skor dari ESPN scoreboard diprioritaskan; statistik dari ESPN summary.
 * - ESPN "in progress" → status Sheet LIVE; setelah FT tunggu 10 menit (file state)
 *   sambil tetap LIVE + sync penuh, lalu status FINISHED (statistik sempat stabil).
 * - Baris FINISHED tapi data bolong → dilengkapi seperti Script 2.
 * - generate_video: auto-group sama seperti Script 2 (akhir run).
 *
 * Cara pakai:
 *   node script2_live.js
 *
 * State (gitignored): script2_live_state.json — waktu pertama mendeteksi FT per event ESPN.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");
const { ESPN_DATES_RANGE, COMPETITIONS } = require("./season.config");

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_NAME = "Result";
const SHEET_SCAN_MAX_ROW = 50000;
const DEBUG_ESPN = process.env.DEBUG_ESPN === "1";

const STATE_PATH = path.join(__dirname, "script2_live_state.json");
const FT_POST_GRACE_MS = 10 * 60 * 1000;

const SHEETS_DATE_EPOCH_UTC = Date.UTC(1899, 11, 30);
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

const COL = {
  league_name: 0,
  season: 1,
  matchweek: 2,
  match_date: 3,
  kickoff: 4,
  league_logo_url: 5,
  league_logo_key: 6,
  home_name: 7,
  away_name: 8,
  home_logo_url: 9,
  away_logo_url: 10,
  home_logo_key: 11,
  away_logo_key: 12,
  status: 13,
  home_score: 14,
  away_score: 15,
  shots_on_target_home: 16,
  shots_on_target_away: 17,
  possession_home: 18,
  possession_away: 19,
  corners_home: 20,
  corners_away: 21,
  fouls_home: 22,
  fouls_away: 23,
  yellow_cards_home: 24,
  yellow_cards_away: 25,
  red_cards_home: 26,
  red_cards_away: 27,
  home_goal_scorers: 28,
  away_goal_scorers: 29,
  flashscore_url: 30,
  generate_video: 31,
  uploaded_at: 32,
  home_league_rank: 33,
  away_league_rank: 34,
};

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
  return (name || "")
    .toLowerCase()
    .trim()
    .replace(/fc$/i, "")
    .replace(/^fc /i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatch(sheetName, espnName) {
  const s = normalizeName(sheetName);
  const e = normalizeName(espnName);
  if (s === e) return true;
  if (s.includes(e) || e.includes(s)) return true;
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
    case 1:
      return `${x}st`;
    case 2:
      return `${x}nd`;
    case 3:
      return `${x}rd`;
    default:
      return `${x}th`;
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

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function shouldRefreshFinishedRow(row) {
  return (
    isBlank(row[COL.corners_home]) ||
    isBlank(row[COL.corners_away]) ||
    (isBlank(row[COL.home_goal_scorers]) && isBlank(row[COL.away_goal_scorers])) ||
    isBlank(row[COL.home_league_rank]) ||
    isBlank(row[COL.away_league_rank])
  );
}

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

function isEspnMatchCompleted(event) {
  const t = event.competitions?.[0]?.status?.type;
  if (!t) return false;
  if (t.completed === true) return true;
  const n = t.name || "";
  return n === "STATUS_FINAL" || n === "STATUS_FULL_TIME";
}

function isEspnLive(event) {
  if (isEspnMatchCompleted(event)) return false;
  const t = event.competitions?.[0]?.status?.type;
  if (!t) return false;
  if (t.state === "in") return true;
  const n = String(t.name || "");
  if (
    /STATUS_(IN_PROGRESS|HALFTIME|END_PERIOD|FIRST_HALF|SECOND_HALF|EXTRA|OVERTIME|SHOOTOUT)/i.test(
      n,
    )
  ) {
    return true;
  }
  const short = String(t.shortDetail || t.description || "").toLowerCase();
  if (short.includes("live") || short.includes("ht") || short.includes("half")) return true;
  return false;
}

function parseEspnDatesRange(rangeStr) {
  const m = String(rangeStr || "").trim().match(/^(\d{8})-(\d{8})$/);
  if (!m) return null;
  const toYmd = (compact) =>
    `${compact.slice(0, 4)}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;
  return { startYmd: toYmd(m[1]), endYmd: toYmd(m[2]) };
}

function rowDateInEspnRange(row) {
  const r = parseEspnDatesRange(ESPN_DATES_RANGE);
  if (!r) return true;
  const ymd = comparableMatchDateFromSheet(row[COL.match_date]);
  if (!ymd || ymd.length < 8) return false;
  return ymd >= r.startYmd && ymd <= r.endYmd;
}

function scoreFromCompetitor(c) {
  if (!c) return "";
  const s = c.score;
  if (s === undefined || s === null || s === "") return "";
  if (typeof s === "object") {
    const v = s.displayValue ?? s.value ?? s.summary;
    if (v !== undefined && v !== null && v !== "") return String(v).trim();
  }
  return String(s).trim();
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
  if (
    teamNameNorm &&
    (teamNameNorm === homeNorm || homeNorm.includes(teamNameNorm) || teamNameNorm.includes(homeNorm))
  ) {
    pushUnique(homeScorers, entry);
    return;
  }
  if (
    teamNameNorm &&
    (teamNameNorm === awayNorm || awayNorm.includes(teamNameNorm) || teamNameNorm.includes(awayNorm))
  ) {
    pushUnique(awayScorers, entry);
    return;
  }
}

function toNonNegativeInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function isGoalLikeType(typeValue) {
  const t = String(typeValue || "").toLowerCase();
  return t === "goal" || t === "own-goal" || t === "penalty-goal" || t === "penalty";
}

// ─── STATE (FT +10 menit) ─────────────────────────────────────────────────

function loadLiveState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j.completedFirstSeen === "object") return j;
  } catch (_) {
    /* missing or corrupt */
  }
  return { completedFirstSeen: {} };
}

function saveLiveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.error("⚠️ Tidak bisa tulis script2_live_state.json:", e.message);
  }
}

function stateKeyForEvent(espnCode, eventId) {
  return `${espnCode}:${eventId}`;
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
  return row;
}

// ─── ESPN ──────────────────────────────────────────────────────────────────

async function espnGetScoreboardEvents(espnCode) {
  try {
    const url = `${ESPN_BASE}/${espnCode}/scoreboard`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: { limit: 1000, dates: ESPN_DATES_RANGE },
      timeout: 20000,
    });
    return response.data?.events || [];
  } catch (error) {
    console.error(`   ✗ ESPN scoreboard error: ${error.message}`);
    return [];
  }
}

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
      home_score: scoreFromCompetitor(homeTeam),
      away_score: scoreFromCompetitor(awayTeam),
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

    const teams = data.boxscore?.teams || [];
    for (const t of teams) {
      const isHome = t.homeAway === "home";
      for (const stat of t.statistics || []) {
        const key = normalizeStatKey(stat.name || stat.displayName || stat.abbreviation || "");
        const val = statVal(stat);
        result._debug_stat_keys.push(`${t.homeAway || "?"}:${key}=${val}`);
        if (!val) continue;

        if (key.includes("shotsontarget") || key === "sot" || key.includes("shotsongoal")) {
          isHome ? (result.shots_on_target_home = val) : (result.shots_on_target_away = val);
        } else if (key.includes("possession")) {
          const num = parseFloat(val.replace("%", "")) || 0;
          const pct = num > 1 ? Math.round(num) : Math.round(num * 100);
          isHome ? (result.possession_home = pct) : (result.possession_away = pct);
        } else if (key.includes("corner")) {
          isHome ? (result.corners_home = val) : (result.corners_away = val);
        } else if (key.includes("foul")) {
          isHome ? (result.fouls_home = val) : (result.fouls_away = val);
        } else if (key.includes("yellowcard")) {
          isHome ? (result.yellow_cards_home = val) : (result.yellow_cards_away = val);
        } else if (key.includes("redcard")) {
          isHome ? (result.red_cards_home = val) : (result.red_cards_away = val);
        }
      }
    }

    const homeId = homeTeam?.team?.id;
    const awayId = awayTeam?.team?.id;
    const homeScorers = [];
    const awayScorers = [];

    for (const play of data.scoringPlays || []) {
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

    if (homeScorers.length === 0 && awayScorers.length === 0) {
      for (const d of data.details || []) {
        const typeText = String(d?.type?.text || d?.type?.name || "").toLowerCase();
        const typeType = String(d?.type?.type || "").toLowerCase();
        const text = String(d?.text || d?.headline || "").trim();
        const athlete = d?.athletesInvolved?.[0];
        const name = athlete?.shortName || athlete?.displayName || "";
        const minute = d?.clock?.displayValue || d?.period?.displayValue || "";
        if (!text && !name) continue;
        if (!(isGoalLikeType(typeType) || /\bgoal\b/i.test(typeText))) continue;
        result._debug_detail_goals += 1;
        const entry = name ? (minute ? `${name} ${minute}'` : name) : text;
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

    if (homeScorers.length === 0 && awayScorers.length === 0) {
      for (const ev of data.keyEvents || []) {
        const typeText = String(ev?.type?.text || ev?.type?.name || "").toLowerCase();
        const typeType = String(ev?.type?.type || "").toLowerCase();
        const text = String(ev?.text || ev?.shortText || "").trim();
        if (!(ev?.scoringPlay === true || isGoalLikeType(typeType) || /\bgoal\b/i.test(typeText))) continue;
        const teamId = ev?.team?.id;
        const teamDisplayName = ev?.team?.displayName || "";
        const p = ev?.participants?.[0]?.athlete;
        const name = p?.shortName || p?.displayName || "";
        const minute = ev?.clock?.displayValue || ev?.period?.displayValue || "";
        const entry = name ? (minute ? `${name} ${minute}'` : name) : text;
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

    if (homeScorers.length === 0 && awayScorers.length === 0) {
      for (const c of data.commentary || []) {
        const p = c?.play;
        const typeText = String(p?.type?.text || p?.type?.type || "").toLowerCase();
        const typeType = String(p?.type?.type || "").toLowerCase();
        const text = String(p?.text || c?.text || "").trim();
        if (!(p?.scoringPlay === true || isGoalLikeType(typeType) || /\bgoal\b/i.test(typeText))) continue;
        const athlete = p?.participants?.[0]?.athlete;
        const name = athlete?.shortName || athlete?.displayName || "";
        const minute = p?.clock?.displayValue || c?.time?.displayValue || "";
        const entry = name ? (minute ? `${name} ${minute}'` : name) : text;
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

    const homeGoals = toNonNegativeInt(result.home_score);
    const awayGoals = toNonNegativeInt(result.away_score);
    if (homeGoals === 0) homeScorers.length = 0;
    else if (homeScorers.length > homeGoals) homeScorers.length = homeGoals;
    if (awayGoals === 0) awayScorers.length = 0;
    else if (awayScorers.length > awayGoals) awayScorers.length = awayGoals;

    result.home_goal_scorers = homeScorers.join(", ");
    result.away_goal_scorers = awayScorers.join(", ");

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

function applyScoresFromCompetitors(row, homeTeam, awayTeam) {
  const hs = scoreFromCompetitor(homeTeam);
  const as = scoreFromCompetitor(awayTeam);
  if (hs !== "") row[COL.home_score] = hs;
  if (as !== "") row[COL.away_score] = as;
}

function applyDetailToRow(row, detail, homeTeam, awayTeam, statusLabel) {
  while (row.length < 35) row.push("");
  row[COL.status] = statusLabel;
  row[COL.home_score] =
    detail?.home_score != null && detail.home_score !== ""
      ? String(detail.home_score).trim()
      : scoreFromCompetitor(homeTeam) || row[COL.home_score] || "";
  row[COL.away_score] =
    detail?.away_score != null && detail.away_score !== ""
      ? String(detail.away_score).trim()
      : scoreFromCompetitor(awayTeam) || row[COL.away_score] || "";

  if (detail) {
    row[COL.shots_on_target_home] = detail.shots_on_target_home || row[COL.shots_on_target_home] || "";
    row[COL.shots_on_target_away] = detail.shots_on_target_away || row[COL.shots_on_target_away] || "";
    row[COL.possession_home] = detail.possession_home || row[COL.possession_home] || "";
    row[COL.possession_away] = detail.possession_away || row[COL.possession_away] || "";
    row[COL.corners_home] = detail.corners_home || row[COL.corners_home] || "";
    row[COL.corners_away] = detail.corners_away || row[COL.corners_away] || "";
    row[COL.fouls_home] = detail.fouls_home || row[COL.fouls_home] || "";
    row[COL.fouls_away] = detail.fouls_away || row[COL.fouls_away] || "";
    row[COL.yellow_cards_home] = detail.yellow_cards_home || row[COL.yellow_cards_home] || "";
    row[COL.yellow_cards_away] = detail.yellow_cards_away || row[COL.yellow_cards_away] || "";
    row[COL.red_cards_home] = detail.red_cards_home || row[COL.red_cards_home] || "";
    row[COL.red_cards_away] = detail.red_cards_away || row[COL.red_cards_away] || "";
    row[COL.home_goal_scorers] = detail.home_goal_scorers || row[COL.home_goal_scorers] || "";
    row[COL.away_goal_scorers] = detail.away_goal_scorers || row[COL.away_goal_scorers] || "";
    row[COL.home_league_rank] = detail.home_league_rank || row[COL.home_league_rank] || "";
    row[COL.away_league_rank] = detail.away_league_rank || row[COL.away_league_rank] || "";
    if (!row[COL.home_logo_url] && detail.home_logo_url) row[COL.home_logo_url] = detail.home_logo_url;
    if (!row[COL.away_logo_url] && detail.away_logo_url) row[COL.away_logo_url] = detail.away_logo_url;
  }
}

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

function makeRowMatchKey(leagueName, ymd, home, away) {
  return `${String(leagueName).trim()}|${normalizeMatchDate(ymd)}|${normalizeName(home)}|${normalizeName(away)}`;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Script 2 LIVE — ESPN sync berkala (LIVE + FT+10m)");
  console.log("=====================================================");
  if (DEBUG_ESPN) console.log("🐞 DEBUG_ESPN=1");

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    console.error("❌ Google credentials belum lengkap di .env");
    process.exit(1);
  }

  const liveState = loadLiveState();
  const sheets = await getSheets();
  const allRows = await getAllRows(sheets);
  console.log(`   ✓ ${allRows.length} baris Sheet`);

  const leagueNames = new Set(COMPETITIONS.map((c) => c.name));
  let totalUpdated = 0;

  for (const competition of COMPETITIONS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 ${competition.name} (${competition.espn_code})`);

    const events = await espnGetScoreboardEvents(competition.espn_code);
    const eventMap = new Map();
    for (const event of events) {
      const comp = event.competitions?.[0];
      const competitors = comp?.competitors || [];
      const homeTeam = competitors.find((c) => c.homeAway === "home");
      const awayTeam = competitors.find((c) => c.homeAway === "away");
      if (!homeTeam || !awayTeam) continue;
      const homeNameEspn = homeTeam.team?.displayName || "";
      const awayNameEspn = awayTeam.team?.displayName || "";
      const eventDate = utcToGmt7Date(event.date || "");
      const key = makeRowMatchKey(competition.name, eventDate, homeNameEspn, awayNameEspn);
      eventMap.set(key, { event, homeTeam, awayTeam });
    }
    console.log(`   ✓ ${eventMap.size} event di scoreboard (unik key)`);

    let compUpdated = 0;

    for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
      const orig = allRows[rowIndex];
      const league = (orig[COL.league_name] || "").trim();
      if (!leagueNames.has(league) || league !== competition.name) continue;
      if (!rowDateInEspnRange(orig)) continue;

      const sheetDate = comparableMatchDateFromSheet(orig[COL.match_date]);
      const sheetStatus = String(orig[COL.status] || "").trim().toUpperCase();

      const rowKey = makeRowMatchKey(
        league,
        sheetDate,
        orig[COL.home_name] || "",
        orig[COL.away_name] || "",
      );
      const hit = eventMap.get(rowKey);
      if (!hit) continue;

      const { event, homeTeam, awayTeam } = hit;
      const sk = stateKeyForEvent(competition.espn_code, event.id);
      const espnDone = isEspnMatchCompleted(event);
      const espnLive = isEspnLive(event);

      if (!espnDone) {
        delete liveState.completedFirstSeen[sk];
      }

      // ── Sheet sudah FINISHED: hanya perbaiki data bolong ──
      if (sheetStatus === "FINISHED") {
        delete liveState.completedFirstSeen[sk];
        if (!espnDone || !shouldRefreshFinishedRow(orig)) continue;
        const detail = await espnGetMatchDetail(competition.espn_code, event.id);
        await delay(280);
        if (!detail) continue;
        const row = [...orig];
        applyDetailToRow(row, detail, homeTeam, awayTeam, "FINISHED");
        const written = await updateRow(sheets, rowIndex, row);
        allRows[rowIndex] = written;
        totalUpdated++;
        compUpdated++;
        console.log(`   ⟳ Lengkap data FINISHED: ${row[COL.home_name]} vs ${row[COL.away_name]}`);
        continue;
      }

      // ── ESPN belum selesai & tidak live: biarkan SCHEDULED (jangan paksa) ──
      if (!espnDone && !espnLive) {
        continue;
      }

      const row = [...orig];
      while (row.length < 35) row.push("");

      // ── LIVE (pertandingan berjalan) ──
      if (espnLive) {
        applyScoresFromCompetitors(row, homeTeam, awayTeam);
        const detail = await espnGetMatchDetail(competition.espn_code, event.id);
        await delay(280);
        if (detail) {
          applyDetailToRow(row, detail, homeTeam, awayTeam, "LIVE");
        } else {
          row[COL.status] = "LIVE";
        }
        const written = await updateRow(sheets, rowIndex, row);
        allRows[rowIndex] = written;
        totalUpdated++;
        compUpdated++;
        console.log(
          `   ▶ LIVE ${row[COL.home_name]} ${row[COL.home_score]}-${row[COL.away_score]} ${row[COL.away_name]}`,
        );
        continue;
      }

      // ── ESPN FINISHED: jeda 10 menit sebelum label FINISHED di Sheet ──
      if (espnDone) {
        const now = Date.now();
        if (!liveState.completedFirstSeen[sk]) {
          liveState.completedFirstSeen[sk] = now;
        }
        const firstSeen = liveState.completedFirstSeen[sk];
        const waited = now - firstSeen;

        applyScoresFromCompetitors(row, homeTeam, awayTeam);
        const detail = await espnGetMatchDetail(competition.espn_code, event.id);
        await delay(280);

        if (waited < FT_POST_GRACE_MS) {
          if (detail) {
            applyDetailToRow(row, detail, homeTeam, awayTeam, "LIVE");
          } else {
            row[COL.status] = "LIVE";
          }
          const written = await updateRow(sheets, rowIndex, row);
          allRows[rowIndex] = written;
          totalUpdated++;
          compUpdated++;
          const secLeft = Math.ceil((FT_POST_GRACE_MS - waited) / 1000);
          console.log(
            `   ⏳ FT window (${secLeft}s → FINISHED): ${row[COL.home_name]} ${row[COL.home_score]}-${row[COL.away_score]} ${row[COL.away_name]}`,
          );
        } else {
          if (detail) {
            applyDetailToRow(row, detail, homeTeam, awayTeam, "FINISHED");
          } else {
            applyScoresFromCompetitors(row, homeTeam, awayTeam);
            row[COL.status] = "FINISHED";
          }
          delete liveState.completedFirstSeen[sk];
          const written = await updateRow(sheets, rowIndex, row);
          allRows[rowIndex] = written;
          totalUpdated++;
          compUpdated++;
          console.log(
            `   ✓ FINISHED ${row[COL.home_name]} ${row[COL.home_score]}-${row[COL.away_score]} ${row[COL.away_name]}`,
          );
        }
      }
    }

    console.log(`   📊 ${compUpdated} baris disentuh untuk ${competition.name}`);
    await delay(1500);
  }

  saveLiveState(liveState);
  await autoGroupVideoQueue(sheets, allRows);

  console.log("\n=====================================================");
  console.log(`✅ Script 2 LIVE selesai. Total baris di-update: ${totalUpdated}`);
  console.log("=====================================================\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
