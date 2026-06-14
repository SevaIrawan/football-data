/**
 * Schema kolom tab Result — satu sumber kebenaran untuk semua script.
 * Range data baris: A2:AL (38 kolom).
 */

const RESULT_SHEET_NAME = "Result";
const SHEET_COL_COUNT = 38;
const SHEET_LAST_COL = "AL";

/** Urutan header A–AL (harus sama dengan baris header di Google Sheet). */
const SHEET_HEADERS = [
  "league_name", // A
  "season", // B
  "matchweek", // C
  "match_date", // D
  "kickoff", // E
  "league_logo_url", // F
  "league_logo_key", // G
  "home_name", // H
  "away_name", // I
  "home_logo_url", // J
  "away_logo_url", // K
  "home_logo_key", // L
  "away_logo_key", // M
  "status", // N
  "home_score", // O
  "away_score", // P
  "shots_on_target_home", // Q
  "shots_on_target_away", // R
  "possession_home", // S
  "possession_away", // T
  "corners_home", // U
  "corners_away", // V
  "fouls_home", // W
  "fouls_away", // X
  "yellow_cards_home", // Y
  "yellow_cards_away", // Z
  "red_cards_home", // AA
  "red_cards_away", // AB
  "home_goal_scorers", // AC
  "away_goal_scorers", // AD
  "flashscore_url", // AE
  "generate_video", // AF
  "uploaded_at", // AG
  "home_league_rank", // AH
  "away_league_rank", // AI
  "tickerScores", // AJ — manual / alur lain
  "news_update", // AK — recap pertandingan (Script 2 / 2 LIVE)
  "stadium", // AL — Script 1
];

const COL = Object.fromEntries(SHEET_HEADERS.map((name, i) => [name, i]));

/** Kolom status…news_update — dipakai Script 2 / 2 LIVE untuk deteksi perubahan. */
const COL_UPDATE_START = COL.status;
const COL_UPDATE_END = COL.news_update;

/** Huruf kolom untuk update parsial (AK / AL). */
const COL_NEWS_LETTER = "AK";
const COL_STADIUM_LETTER = "AL";

function colIndexToLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function padRow(row) {
  const r = Array.isArray(row) ? [...row] : [];
  while (r.length < SHEET_COL_COUNT) r.push("");
  return r;
}

function sheetDataRange(maxRow, sheetName = RESULT_SHEET_NAME) {
  return `${sheetName}!A2:${SHEET_LAST_COL}${maxRow}`;
}

function sheetRowRange(sheetRow, sheetName = RESULT_SHEET_NAME) {
  return `${sheetName}!A${sheetRow}:${SHEET_LAST_COL}${sheetRow}`;
}

module.exports = {
  RESULT_SHEET_NAME,
  SHEET_COL_COUNT,
  SHEET_LAST_COL,
  SHEET_HEADERS,
  COL,
  COL_UPDATE_START,
  COL_UPDATE_END,
  COL_NEWS_LETTER,
  COL_STADIUM_LETTER,
  colIndexToLetter,
  padRow,
  sheetDataRange,
  sheetRowRange,
};
