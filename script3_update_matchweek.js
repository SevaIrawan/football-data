/**
 * SCRIPT 3 — UPDATE MATCHWEEK (GW) BERDASARKAN DATA SHEET
 * ========================================================
 * Source GW: football-data.org (field: matchday)
 *
 * Aturan:
 * - Hanya update kolom matchweek (kolom C).
 * - Hanya isi jika data matchday benar-benar ada dan match dengan row Sheet.
 * - Jika kompetisi tidak punya GW/matchday (mis. knockout tertentu), biarkan kosong.
 *
 * Cara pakai:
 * node script3_update_matchweek.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");
const { COMPETITIONS } = require("./season.config");
const { COL, sheetDataRange } = require("./sheet-columns");

// ─── CONFIG ────────────────────────────────────────────────────────────────

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_NAME = "Result";
const SHEET_SCAN_MAX_ROW = 50000;

const FD_BASE = "https://api.football-data.org/v4";
const MANUAL_GW_MAP_PATH = path.join(__dirname, "matchweek.manual.map.json");

// league_name di Sheet -> competition code di football-data.org (dari config terpusat)
const LEAGUE_TO_FD_CODE = Object.fromEntries(
  COMPETITIONS
    .filter((c) => c.fd_code)
    .map((c) => [c.name, c.fd_code]),
);

// Alias khusus untuk merapatkan perbedaan penamaan tim antar source.
// Key dan value dalam bentuk "sudah dinormalisasi".
const TEAM_ALIASES = {
  // UCL / Eropa
  "bayern munich": "bayern munchen",
  "bayern munchen": "bayern munchen",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "internazionale": "inter milan",
  "inter": "inter milan",
  "man city": "manchester city",
  "man utd": "manchester united",
  "atletico": "atletico madrid",
  "atletico de madrid": "atletico madrid",
  "sl benfica": "benfica",
  "sporting cp": "sporting",
  "rb salzburg": "red bull salzburg",
  "shakhtar donetsk": "shakhtar donetsk",
  "fk qarabag": "qarabag",
  "qarabag fk": "qarabag",
  "bodoglimt": "bodo glimt",
  "bodo glimt": "bodo glimt",
  "fk bodo glimt": "bodo glimt",
  "fc copenhagen": "kobenhavn",
  "f c kobenhavn": "kobenhavn",
  "kobenhavn": "kobenhavn",
  "olympiacos": "olympiacos",
  "olympiakos": "olympiacos",
  "sparta praha": "sparta prague",
  "slavia praha": "slavia prague",
  "young boys": "young boys",
  "psv": "psv eindhoven",
  "juve": "juventus",
  "real": "real madrid",
  "dortmund": "borussia dortmund",
  "ac milan": "milan",
  "kairat almaty": "kairat almaty",
  "ajax amsterdam": "ajax",
  "afc ajax": "ajax",
  "ajax": "ajax",
  "psv eindhoven": "psv eindhoven",
  "psv": "psv eindhoven",
  "as monaco": "monaco",
  "monaco": "monaco",
  "villarreal": "villarreal",
  "villarreal cf": "villarreal",
  "fk qarabag": "qarabag",
  "qarabag": "qarabag",
  "pafos fc": "pafos",
  "pafos": "pafos",
  "bayer leverkusen": "bayer leverkusen",
  "bayer 04 leverkusen": "bayer leverkusen",
};

// Kolom index — lihat sheet-columns.js (matchweek = kolom C)

// ─── HELPER ────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeName(name) {
  const base = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .trim()
    .replace(/\./g, " ")
    .replace(/'/g, "")
    .replace(/&/g, " and ")
    .replace(/-/g, " ")
    .replace(/\b(football club|club)\b/g, " ")
    .replace(/\bafc\b/g, " ")
    .replace(/\bfk\b/g, " ")
    .replace(/\bcf\b/g, " ")
    .replace(/\bac\b/g, " ")
    .replace(/\bas\b/g, " ")
    .replace(/\bfc\b/g, " ")
    .replace(/\bsv\b/g, " ")
    .replace(/\bvfl\b/g, " ")
    .replace(/\btsg\b/g, " ")
    .replace(/\bsc\b/g, " ")
    .replace(/\bborussia\b/g, " ")
    .replace(/\bassociation\b/g, " ")
    .replace(/\bdeportivo\b/g, " ")
    .replace(/\b1\b/g, " ")
    .replace(/\b05\b/g, " ")
    .replace(/\b04\b/g, " ")
    .replace(/\b1899\b/g, " ")
    .replace(/\b1846\b/g, " ")
    .replace(/\b1910\b/g, " ")
    .replace(/\bmunchen\b/g, "munich")
    .replace(/\bkoln\b/g, "cologne")
    .replace(/\bmgladbach\b/g, "monchengladbach")
    .replace(/\bst pauli\b/g, "saint pauli")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  return base;
}

function canonicalTeamName(name) {
  const n = normalizeName(name);
  return TEAM_ALIASES[n] || n;
}

function nameMatch(sheetName, srcName) {
  const s = canonicalTeamName(sheetName);
  const e = canonicalTeamName(srcName);
  if (!s || !e) return false;
  if (s === e) return true;
  if (s.includes(e) || e.includes(s)) return true;
  const sWords = new Set(s.split(" ").filter((w) => w.length >= 4));
  const eWords = new Set(e.split(" ").filter((w) => w.length >= 4));
  let overlap = 0;
  for (const w of eWords) {
    if (sWords.has(w)) overlap++;
  }
  // Cukup ketat: minimal 2 kata overlap atau 1 kata panjang unik
  if (overlap >= 2) return true;
  if (overlap === 1) {
    const longest = [...eWords].sort((a, b) => b.length - a.length)[0] || "";
    if (longest.length >= 7 && s.includes(longest)) return true;
  }
  return false;
}

function parseSeasonStartYear(seasonStr) {
  // "2025/26" -> 2025
  const m = String(seasonStr || "").match(/^(\d{4})\s*[/\-]/);
  if (m) return parseInt(m[1], 10);
  // fallback: jika sudah "2025"
  const y = parseInt(String(seasonStr || "").trim(), 10);
  return Number.isFinite(y) ? y : null;
}

function toGmt7Ymd(utcDateStr) {
  const date = new Date(utcDateStr);
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = gmt7.getUTCFullYear();
  const mo = String(gmt7.getUTCMonth() + 1).padStart(2, "0");
  const da = String(gmt7.getUTCDate()).padStart(2, "0");
  return `${y}/${mo}/${da}`;
}

function normalizeMatchDateCell(v) {
  // dukung yyyy/mm/dd atau dd/mm/yyyy dari Sheet
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function kickoffKey(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function sourceKickoffKey(utcDateStr) {
  const k = new Date(utcDateStr);
  const gmt7 = new Date(k.getTime() + 7 * 60 * 60 * 1000);
  const hh = String(gmt7.getUTCHours()).padStart(2, "0");
  const mm = String(gmt7.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function normCode(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function normLeague(v) {
  return String(v || "").toLowerCase().trim();
}

function normSeason(v) {
  return String(v || "").trim();
}

function buildManualKey({ league, season, match_date, home_name, away_name }) {
  const leagueKey = normLeague(league);
  const seasonKey = normSeason(season);
  const dateKey = normalizeMatchDateCell(match_date);
  const homeKey = canonicalTeamName(home_name);
  const awayKey = canonicalTeamName(away_name);
  return `${leagueKey}|${seasonKey}|${dateKey}|${homeKey}|${awayKey}`;
}

function loadManualGwMap() {
  if (!fs.existsSync(MANUAL_GW_MAP_PATH)) {
    return new Map();
  }
  let raw = "";
  try {
    raw = fs.readFileSync(MANUAL_GW_MAP_PATH, "utf8");
  } catch (error) {
    console.error(`⚠ Gagal baca ${MANUAL_GW_MAP_PATH}: ${error.message}`);
    return new Map();
  }

  let parsed = [];
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`⚠ JSON invalid di ${MANUAL_GW_MAP_PATH}: ${error.message}`);
    return new Map();
  }

  if (!Array.isArray(parsed)) {
    console.error(`⚠ Format ${MANUAL_GW_MAP_PATH} harus array.`);
    return new Map();
  }

  const map = new Map();
  for (const item of parsed) {
    const gw = Number(item?.matchweek);
    if (!Number.isFinite(gw) || gw <= 0) continue;
    const key = buildManualKey({
      league: item?.league_name || item?.league || "",
      season: item?.season || "",
      match_date: item?.match_date || item?.date || "",
      home_name: item?.home_name || item?.home || "",
      away_name: item?.away_name || item?.away || "",
    });
    if (!key.includes("||") && key.split("|").every(Boolean)) {
      map.set(key, String(gw));
    }
  }
  return map;
}

function chooseBestMatch(sheetRow, candidates) {
  const sheetDate = normalizeMatchDateCell(sheetRow[COL.match_date]);
  const home = sheetRow[COL.home_name] || "";
  const away = sheetRow[COL.away_name] || "";
  const kickoff = String(sheetRow[COL.kickoff] || "").trim();
  const koKey = kickoffKey(kickoff);
  const homeCode = normCode(sheetRow[COL.home_logo_key]);
  const awayCode = normCode(sheetRow[COL.away_logo_key]);

  const byDate = candidates.filter((m) => toGmt7Ymd(m.utcDate) === sheetDate);
  const pool = byDate.length ? byDate : candidates;

  const scored = pool
    .map((m) => {
      let score = 0;
      const hm = nameMatch(home, m.homeTeam?.name || "");
      const am = nameMatch(away, m.awayTeam?.name || "");
      if (hm) score += 2;
      if (am) score += 2;
      const srcHomeCode = normCode(m.homeTeam?.tla || m.homeTeam?.shortName || "");
      const srcAwayCode = normCode(m.awayTeam?.tla || m.awayTeam?.shortName || "");
      const codeHomeMatch = homeCode && srcHomeCode && (homeCode === srcHomeCode || homeCode.includes(srcHomeCode) || srcHomeCode.includes(homeCode));
      const codeAwayMatch = awayCode && srcAwayCode && (awayCode === srcAwayCode || awayCode.includes(srcAwayCode) || srcAwayCode.includes(awayCode));
      if (codeHomeMatch) score += 3;
      if (codeAwayMatch) score += 3;
      const srcKo = sourceKickoffKey(m.utcDate);
      if (koKey && koKey === srcKo) score += 1;
      return { m, score, hm, am, srcKo, codeHomeMatch, codeAwayMatch };
    })
    .sort((a, b) => b.score - a.score);

  // Mode strict: kombinasi kuat (nama atau kode)
  const strict = scored.filter((x) => x.score >= 4);
  if (strict.length) return strict[0].m;

  // Fallback aman: jika pada tanggal+kickoff yang sama hanya ada 1 kandidat
  // dan minimal satu tim cocok, pakai kandidat tersebut.
  if (koKey) {
    const koPool = scored.filter((x) => x.srcKo === koKey);
    if (koPool.length === 1 && (koPool[0].hm || koPool[0].am)) {
      return koPool[0].m;
    }
  }

  // Fallback akhir: jika tanggal hanya punya 1 kandidat dan minimal satu tim cocok.
  if (byDate.length === 1) {
    const only = scored.find((x) => x.m === byDate[0]);
    if (only && (only.hm || only.am)) return only.m;
  }

  return null;
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
    range: sheetDataRange(SHEET_SCAN_MAX_ROW, SHEET_NAME),
  });
  return res.data.values || [];
}

async function batchUpdateMatchweek(sheets, updates) {
  if (!updates.length) return;
  const data = updates.map((u) => ({
    range: `${SHEET_NAME}!C${u.sheetRow}`,
    values: [[u.matchweek]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}

// ─── FOOTBALL-DATA.ORG ────────────────────────────────────────────────────

async function fetchMatchesByCompetitionAndSeason(fdCode, seasonYear) {
  try {
    const url = `${FD_BASE}/competitions/${fdCode}/matches`;
    const response = await axios.get(url, {
      headers: {
        "X-Auth-Token": FOOTBALL_DATA_API_KEY,
      },
      params: {
        season: seasonYear,
      },
      timeout: 30000,
    });
    return response.data?.matches || [];
  } catch (error) {
    console.error(`   ✗ Error ambil ${fdCode} season ${seasonYear}: ${error.message}`);
    return [];
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Script 3 — Update Matchweek (GW)");
  console.log("====================================");

  if (!FOOTBALL_DATA_API_KEY || !GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error("❌ Credentials belum lengkap (.env)");
    process.exit(1);
  }

  console.log("\n🔗 Connecting ke Google Sheets...");
  const sheets = await getSheets();
  const rows = await getAllRows(sheets);
  console.log(`   ✓ ${rows.length} baris terbaca`);
  const manualGwMap = loadManualGwMap();
  if (manualGwMap.size > 0) {
    console.log(`   ✓ ${manualGwMap.size} mapping manual GW terbaca (${MANUAL_GW_MAP_PATH})`);
  } else {
    console.log(`   ℹ Mapping manual GW kosong / belum ada (${MANUAL_GW_MAP_PATH})`);
  }

  // Group row berdasarkan (league + seasonStartYear) supaya API call hemat
  const groups = new Map();
  const skippedNoFdByLeague = new Map();
  const skippedNoSeason = new Map();
  const updates = [];
  let matchedManual = 0;
  let updatedManual = 0;
  const manualHandledRows = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const league = String(row[COL.league_name] || "").trim();
    const manualKey = buildManualKey({
      league,
      season: row[COL.season],
      match_date: row[COL.match_date],
      home_name: row[COL.home_name],
      away_name: row[COL.away_name],
    });
    const manualGw = manualGwMap.get(manualKey);
    if (manualGw) {
      matchedManual++;
      manualHandledRows.add(i);
      const current = String(row[COL.matchweek] || "").trim();
      if (current !== manualGw) {
        updates.push({
          sheetRow: i + 2,
          matchweek: manualGw,
        });
        updatedManual++;
      }
      continue;
    }

    const fdCode = LEAGUE_TO_FD_CODE[league];
    if (!fdCode) {
      if (league) {
        skippedNoFdByLeague.set(league, (skippedNoFdByLeague.get(league) || 0) + 1);
      }
      continue;
    }
    const seasonYear = parseSeasonStartYear(row[COL.season]);
    if (!seasonYear) {
      if (league) {
        skippedNoSeason.set(league, (skippedNoSeason.get(league) || 0) + 1);
      }
      continue;
    }

    const key = `${league}|${fdCode}|${seasonYear}`;
    if (!groups.has(key)) {
      groups.set(key, { league, fdCode, seasonYear, rowIndexes: [] });
    }
    groups.get(key).rowIndexes.push(i);
  }

  if (skippedNoFdByLeague.size > 0) {
    console.log("\n⚠ Liga di Sheet tanpa fd_code di season.config (GW tidak diproses):");
    for (const [lg, cnt] of [...skippedNoFdByLeague.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   - ${lg}: ${cnt} baris`);
    }
    console.log("   (Isi fd_code di season.config jika football-data.org punya kompetisi itu.)");
  }
  if (skippedNoSeason.size > 0) {
    console.log("\n⚠ Baris dengan season tidak terbaca (kolom B):");
    for (const [lg, cnt] of [...skippedNoSeason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   - ${lg}: ${cnt} baris`);
    }
  }

  if (groups.size === 0) {
    if (updates.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < updates.length; i += BATCH) {
        const chunk = updates.slice(i, i + BATCH);
        await batchUpdateMatchweek(sheets, chunk);
        console.log(`   ✍️  Batch ${Math.floor(i / BATCH) + 1}: ${chunk.length} row matchweek diupdate`);
        await delay(700);
      }
    }
    console.log("⚠ Tidak ada grup liga/season valid untuk diproses.");
    console.log(`   Manual match     : ${matchedManual}`);
    console.log(`   Manual diupdate  : ${updatedManual}`);
    return;
  }

  let scanned = 0;
  let matched = 0;
  let skippedNoGw = 0;
  let skippedNoFdTotal = 0;
  for (const n of skippedNoFdByLeague.values()) skippedNoFdTotal += n;
  let skippedNoSeasonTotal = 0;
  for (const n of skippedNoSeason.values()) skippedNoSeasonTotal += n;

  for (const group of groups.values()) {
    console.log(`\n📡 ${group.league} (${group.fdCode}) season ${group.seasonYear}...`);
    const matches = await fetchMatchesByCompetitionAndSeason(group.fdCode, group.seasonYear);
    if (!matches.length) {
      console.log("   ⚠ Tidak ada data match dari source GW");
      await delay(500);
      continue;
    }

    console.log(`   ✓ ${matches.length} match source terbaca`);

    for (const idx of group.rowIndexes) {
      if (manualHandledRows.has(idx)) continue;
      scanned++;
      const row = rows[idx];
      const best = chooseBestMatch(row, matches);
      if (!best) continue;
      matched++;

      const matchday = best.matchday;
      // Sesuai requirement: kalau GW tidak ada, biarkan kosong (jangan paksa)
      if (!Number.isFinite(matchday) || matchday <= 0) {
        skippedNoGw++;
        continue;
      }

      const current = String(row[COL.matchweek] || "").trim();
      const next = String(matchday);
      if (current === next) continue;

      updates.push({
        sheetRow: idx + 2, // row 2 = index 0
        matchweek: next,
      });
    }

    await delay(500);
  }

  if (updates.length > 0) {
    // Batch per 500 update range
    const BATCH = 500;
    for (let i = 0; i < updates.length; i += BATCH) {
      const chunk = updates.slice(i, i + BATCH);
      await batchUpdateMatchweek(sheets, chunk);
      console.log(`   ✍️  Batch ${Math.floor(i / BATCH) + 1}: ${chunk.length} row matchweek diupdate`);
      await delay(700);
    }
  }

  console.log("\n====================================");
  console.log(`✅ Selesai`);
  console.log(`   Row discan      : ${scanned}`);
  console.log(`   Row match source: ${matched}`);
  console.log(`   Manual match    : ${matchedManual}`);
  console.log(`   Manual diupdate : ${updatedManual}`);
  console.log(`   Skip no fd_code : ${skippedNoFdTotal}`);
  console.log(`   Skip no season  : ${skippedNoSeasonTotal}`);
  console.log(`   Skip no GW      : ${skippedNoGw}`);
  console.log(`   Row diupdate    : ${updates.length}`);
  console.log("====================================\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});

