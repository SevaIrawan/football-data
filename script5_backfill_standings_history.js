/**
 * SCRIPT 5b — BACKFILL STANDINGS_HISTORY
 * ======================================
 * Migrasi baris lama ke schema baru (+ team_logo_key) dan isi slug logo
 * dengan logic yang sama seperti tab Result (logo-key.js).
 *
 *   node script5_backfill_standings_history.js
 */

require("dotenv").config();
const { google } = require("googleapis");
const { displayNameToLogoKey } = require("./logo-key");
const {
  STANDINGS_HISTORY_SHEET_NAME,
  STANDINGS_HISTORY_HEADERS,
  STANDINGS_HISTORY_COL,
  STANDINGS_HISTORY_LAST_COL,
  STANDINGS_HISTORY_COL_COUNT,
  padStandingsHistoryRow,
} = require("./standings-columns");

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SCAN_MAX_ROW = 50000;
const CLEAR_MAX_ROW = 50000;

/** Schema sebelum team_logo_key (23 kolom A–W). */
const OLD_HISTORY_HEADERS = [
  "espn_code",
  "league_name",
  "season",
  "matchweek",
  "group_name",
  "rank",
  "team_name",
  "team_abbr",
  "team_logo_url",
  "is_national",
  "played",
  "won",
  "draw",
  "lost",
  "goals_for",
  "goals_against",
  "goal_diff",
  "points",
  "ppg",
  "advanced",
  "deductions",
  "rank_change",
  "updated_at",
];

const OLD_COL = Object.fromEntries(OLD_HISTORY_HEADERS.map((name, i) => [name, i]));

function headersMatch(a, b) {
  if (!Array.isArray(a) || a.length < b.length) return false;
  return b.every((h, i) => a[i] === h);
}

function isUrl(v) {
  return /^https?:\/\//i.test(String(v || "").trim());
}

/** Baris data tanpa header valid — tebak layout dari isi sel. */
function detectRowLayout(row) {
  if (isUrl(row[7])) return "new";
  if (isUrl(row[8])) return "old";
  if (String(row[8] || "").trim() && !isUrl(row[8])) return "new";
  return "old";
}

function migrateOldRow(row) {
  const out = new Array(STANDINGS_HISTORY_COL_COUNT).fill("");
  const teamName = String(row[OLD_COL.team_name] || "").trim();

  out[STANDINGS_HISTORY_COL.espn_code] = row[OLD_COL.espn_code] ?? "";
  out[STANDINGS_HISTORY_COL.league_name] = row[OLD_COL.league_name] ?? "";
  out[STANDINGS_HISTORY_COL.season] = row[OLD_COL.season] ?? "";
  out[STANDINGS_HISTORY_COL.matchweek] = row[OLD_COL.matchweek] ?? "";
  out[STANDINGS_HISTORY_COL.group_name] = row[OLD_COL.group_name] ?? "";
  out[STANDINGS_HISTORY_COL.rank] = row[OLD_COL.rank] ?? "";
  out[STANDINGS_HISTORY_COL.team_name] = teamName;
  out[STANDINGS_HISTORY_COL.team_logo_url] = row[OLD_COL.team_logo_url] ?? "";
  out[STANDINGS_HISTORY_COL.team_logo_key] = displayNameToLogoKey(teamName);
  out[STANDINGS_HISTORY_COL.team_abbr] = row[OLD_COL.team_abbr] ?? "";
  out[STANDINGS_HISTORY_COL.is_national] = row[OLD_COL.is_national] ?? "";
  out[STANDINGS_HISTORY_COL.played] = row[OLD_COL.played] ?? "";
  out[STANDINGS_HISTORY_COL.won] = row[OLD_COL.won] ?? "";
  out[STANDINGS_HISTORY_COL.draw] = row[OLD_COL.draw] ?? "";
  out[STANDINGS_HISTORY_COL.lost] = row[OLD_COL.lost] ?? "";
  out[STANDINGS_HISTORY_COL.goals_for] = row[OLD_COL.goals_for] ?? "";
  out[STANDINGS_HISTORY_COL.goals_against] = row[OLD_COL.goals_against] ?? "";
  out[STANDINGS_HISTORY_COL.goal_diff] = row[OLD_COL.goal_diff] ?? "";
  out[STANDINGS_HISTORY_COL.points] = row[OLD_COL.points] ?? "";
  out[STANDINGS_HISTORY_COL.ppg] = row[OLD_COL.ppg] ?? "";
  out[STANDINGS_HISTORY_COL.advanced] = row[OLD_COL.advanced] ?? "";
  out[STANDINGS_HISTORY_COL.deductions] = row[OLD_COL.deductions] ?? "";
  out[STANDINGS_HISTORY_COL.rank_change] = row[OLD_COL.rank_change] ?? "";
  out[STANDINGS_HISTORY_COL.updated_at] = row[OLD_COL.updated_at] ?? "";
  return padStandingsHistoryRow(out);
}

function fillNewRow(row) {
  const out = padStandingsHistoryRow(row);
  const teamName = String(out[STANDINGS_HISTORY_COL.team_name] || "").trim();
  const key = String(out[STANDINGS_HISTORY_COL.team_logo_key] || "").trim();
  if (!key && teamName) {
    out[STANDINGS_HISTORY_COL.team_logo_key] = displayNameToLogoKey(teamName);
  }
  return out;
}

function transformRow(row, headerKind) {
  if (!row || !String(row[0] || "").trim()) return null;

  if (headerKind === "old") return migrateOldRow(row);

  if (headerKind === "new") return fillNewRow(row);

  return detectRowLayout(row) === "old" ? migrateOldRow(row) : fillNewRow(row);
}

function detectHeaderKind(headerRow) {
  if (headersMatch(headerRow, STANDINGS_HISTORY_HEADERS)) return "new";
  if (headersMatch(headerRow, OLD_HISTORY_HEADERS)) return "old";
  return "unknown";
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

async function main() {
  console.log("🚀 Script 5b — Backfill Standings_History (team_logo_key)");
  console.log("============================================================");

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error("❌ Google credentials belum lengkap di .env");
    process.exit(1);
  }

  const sheets = await getSheets();

  let headerRow = [];
  let dataRows = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${STANDINGS_HISTORY_SHEET_NAME}!A1:${STANDINGS_HISTORY_LAST_COL}${SCAN_MAX_ROW}`,
    });
    const values = res.data.values || [];
    headerRow = values[0] || [];
    dataRows = values.slice(1);
  } catch (e) {
    console.error("❌ Gagal baca tab Standings_History:", e.message);
    process.exit(1);
  }

  const headerKind = detectHeaderKind(headerRow);
  console.log(`   Header: ${headerKind === "new" ? "schema baru" : headerKind === "old" ? "schema lama (23 kolom)" : "tidak dikenali — tebak per baris"}`);
  console.log(`   Baris data: ${dataRows.length}`);

  if (dataRows.length === 0) {
    console.log("ℹ️  Tidak ada data — hanya perbarui header.");
  }

  const migrated = [];
  let filledKeys = 0;
  let migratedLayout = 0;

  for (const row of dataRows) {
    const kind = headerKind === "unknown" ? null : headerKind;
    const beforeKey =
      headerKind === "new"
        ? String(row[STANDINGS_HISTORY_COL.team_logo_key] || "").trim()
        : "";
    const out = transformRow(row, kind);
    if (!out) continue;

    if (headerKind === "old" || (headerKind === "unknown" && detectRowLayout(row) === "old")) {
      migratedLayout++;
    } else if (!beforeKey && out[STANDINGS_HISTORY_COL.team_logo_key]) {
      filledKeys++;
    }

    migrated.push(out);
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${STANDINGS_HISTORY_SHEET_NAME}!A2:${STANDINGS_HISTORY_LAST_COL}${CLEAR_MAX_ROW}`,
  });

  const values = [STANDINGS_HISTORY_HEADERS, ...migrated];
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${STANDINGS_HISTORY_SHEET_NAME}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  console.log("\n============================================================");
  console.log(`✅ Selesai — ${migrated.length} baris ditulis ulang`);
  console.log(`   Migrasi layout lama → baru: ${migratedLayout}`);
  console.log(`   team_logo_key diisi (schema baru): ${filledKeys}`);
  console.log(`   Header: A1:${STANDINGS_HISTORY_LAST_COL}1`);
  console.log("============================================================\n");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
