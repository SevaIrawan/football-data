/**
 * SCRIPT 4 — ISI STADIUM & NEWS_UPDATE
 * ===================================
 * Backfill / update terfokus untuk baris Result yang masih kosong:
 * - stadium (AL): ESPN scoreboard / summary → venue.fullName
 * - news_update (AK): ESPN summary → article.headline (hanya baris FINISHED)
 *
 * Jalankan setelah deploy kolom baru atau untuk menyapu data lama.
 *
 *   node script4_fill_stadium_news.js
 */

require("dotenv").config();
const axios = require("axios");
const { google } = require("googleapis");
const { ESPN_DATES_RANGE, COMPETITIONS } = require("./season.config");
const {
  COL,
  COL_NEWS_LETTER,
  COL_STADIUM_LETTER,
  padRow,
  sheetDataRange,
} = require("./sheet-columns");

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SHEET_NAME = "Result";
const SHEET_SCAN_MAX_ROW = 50000;

const SHEETS_WRITE_MIN_INTERVAL_MS = Math.max(
  800,
  parseInt(process.env.SHEETS_WRITE_MIN_INTERVAL_MS || "1300", 10) || 1300,
);

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

const SHEETS_DATE_EPOCH_UTC = Date.UTC(1899, 11, 30);

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

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

function utcToGmt7Date(utcDateStr) {
  const date = new Date(utcDateStr);
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = gmt7.getUTCFullYear();
  const mo = String(gmt7.getUTCMonth() + 1).padStart(2, "0");
  const da = String(gmt7.getUTCDate()).padStart(2, "0");
  return `${y}/${mo}/${da}`;
}

function normalizeName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatch(sheetName, espnName) {
  const a = normalizeName(sheetName);
  const b = normalizeName(espnName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const wordsA = a.split(" ").filter((w) => w.length > 2);
  const wordsB = b.split(" ").filter((w) => w.length > 2);
  return wordsA.some((w) => b.includes(w)) && wordsB.some((w) => a.includes(w));
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

async function getAllRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: sheetDataRange(SHEET_SCAN_MAX_ROW, SHEET_NAME),
  });
  return res.data.values || [];
}

async function updateCell(sheets, sheetRow, colLetter, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!${colLetter}${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
  await delay(SHEETS_WRITE_MIN_INTERVAL_MS);
}

async function espnFetchAllEvents(espnCode) {
  try {
    const url = `${ESPN_BASE}/${espnCode}/scoreboard`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: { limit: 1000, dates: ESPN_DATES_RANGE },
      timeout: 30000,
    });
    return response.data?.events || [];
  } catch (error) {
    console.error(`   ✗ ESPN scoreboard ${espnCode}: ${error.message}`);
    return [];
  }
}

function venueFromEvent(event) {
  const comp = event?.competitions?.[0];
  return String(comp?.venue?.fullName || "").trim();
}

function findMatchingEvent(events, row) {
  const league = (row[COL.league_name] || "").trim();
  const targetDate = comparableMatchDateFromSheet(row[COL.match_date]);
  const homeSheet = row[COL.home_name] || "";
  const awaySheet = row[COL.away_name] || "";

  for (const event of events) {
    const comp = event.competitions?.[0];
    const competitors = comp?.competitors || [];
    const homeTeam = competitors.find((c) => c.homeAway === "home");
    const awayTeam = competitors.find((c) => c.homeAway === "away");
    if (!homeTeam || !awayTeam) continue;

    const eventDate = utcToGmt7Date(event.date || "");
    if (normalizeMatchDate(eventDate) !== normalizeMatchDate(targetDate)) continue;

    const homeEspn = homeTeam.team?.displayName || "";
    const awayEspn = awayTeam.team?.displayName || "";
    if (nameMatch(homeSheet, homeEspn) && nameMatch(awaySheet, awayEspn)) {
      return event;
    }
  }
  return null;
}

async function espnFetchRecapAndVenue(espnCode, eventId) {
  try {
    const url = `${ESPN_BASE}/${espnCode}/summary`;
    const response = await axios.get(url, {
      headers: ESPN_HEADERS,
      params: { event: eventId },
      timeout: 20000,
    });
    const data = response.data;
    const comp = data.header?.competitions?.[0];
    return {
      news_update: String(data.article?.headline || "").trim(),
      stadium: String(
        data.gameInfo?.venue?.fullName || comp?.venue?.fullName || "",
      ).trim(),
    };
  } catch (error) {
    console.error(`   ✗ ESPN summary event ${eventId}: ${error.message}`);
    return { news_update: "", stadium: "" };
  }
}

async function main() {
  console.log("🚀 Script 4 — Isi stadium & news_update");
  console.log("========================================");

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error("❌ Google credentials belum lengkap di .env");
    process.exit(1);
  }

  const sheets = await getSheets();
  const allRows = await getAllRows(sheets);
  console.log(`   ✓ ${allRows.length} baris Sheet`);

  const leagueByName = Object.fromEntries(COMPETITIONS.map((c) => [c.name, c]));
  const eventsByLeague = {};

  for (const competition of COMPETITIONS) {
    console.log(`\n📡 Cache ESPN ${competition.name}...`);
    eventsByLeague[competition.name] = await espnFetchAllEvents(competition.espn_code);
    console.log(`   ✓ ${eventsByLeague[competition.name].length} events`);
    await delay(500);
  }

  let stadiumFilled = 0;
  let newsFilled = 0;
  let skipped = 0;
  let notFound = 0;

  console.log("\n🔍 Proses baris kosong...\n");

  for (let i = 0; i < allRows.length; i++) {
    const row = padRow(allRows[i]);
    const league = (row[COL.league_name] || "").trim();
    if (!league) continue;

    const competition = leagueByName[league];
    if (!competition) continue;

    const status = String(row[COL.status] || "").trim().toUpperCase();
    const needsStadium = isBlank(row[COL.stadium]);
    const needsNews = status === "FINISHED" && isBlank(row[COL.news_update]);

    if (!needsStadium && !needsNews) {
      skipped++;
      continue;
    }

    const events = eventsByLeague[league] || [];
    const event = findMatchingEvent(events, row);
    if (!event) {
      notFound++;
      console.log(
        `   ⚠ miss: ${row[COL.home_name]} vs ${row[COL.away_name]} (${comparableMatchDateFromSheet(row[COL.match_date])})`,
      );
      continue;
    }

    const sheetRow = i + 2;
    let newStadium = "";
    let newNews = "";

    if (needsStadium) {
      newStadium = venueFromEvent(event);
    }

    if (needsNews) {
      const recap = await espnFetchRecapAndVenue(competition.espn_code, event.id);
      await delay(300);
      newNews = recap.news_update;
      if (needsStadium && !newStadium) newStadium = recap.stadium;
    }

    if (needsStadium && newStadium) {
      await updateCell(sheets, sheetRow, COL_STADIUM_LETTER, newStadium);
      row[COL.stadium] = newStadium;
      stadiumFilled++;
    }

    if (needsNews && newNews) {
      await updateCell(sheets, sheetRow, COL_NEWS_LETTER, newNews);
      row[COL.news_update] = newNews;
      newsFilled++;
    }

    allRows[i] = row;

    const parts = [];
    if (newStadium) parts.push(`stadium=${newStadium}`);
    if (newNews) parts.push(`news=${newNews.slice(0, 60)}${newNews.length > 60 ? "…" : ""}`);
    if (parts.length) {
      console.log(`   ✓ ${row[COL.home_name]} vs ${row[COL.away_name]} | ${parts.join(" | ")}`);
    } else if (needsStadium || needsNews) {
      console.log(
        `   – ${row[COL.home_name]} vs ${row[COL.away_name]} | ESPN tidak punya data (stadium/recap)`,
      );
    }
  }

  console.log("\n========================================");
  console.log(`✅ Selesai — stadium: ${stadiumFilled}, news_update: ${newsFilled}`);
  console.log(`   skip (sudah lengkap): ${skipped}, tidak match ESPN: ${notFound}`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
