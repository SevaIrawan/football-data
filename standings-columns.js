/**
 * Schema kolom tab Standings & Standings_History.
 * Standings = klasemen terkini (timpa).
 * Standings_History = snapshot per pekan (append + matchweek).
 *
 * Urutan logo tim sama seperti Result: team_name → team_logo_url → team_logo_key
 */

const STANDINGS_SHEET_NAME = "Standings";
const STANDINGS_COL_COUNT = 23;
const STANDINGS_LAST_COL = "W";

const STANDINGS_HEADERS = [
  "espn_code",
  "league_name",
  "season",
  "group_name",
  "rank",
  "team_name",
  "team_logo_url",
  "team_logo_key",
  "team_abbr",
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

const STANDINGS_COL = Object.fromEntries(STANDINGS_HEADERS.map((name, i) => [name, i]));

// ─── Standings_History (+ matchweek setelah season) ───────────────────────

const STANDINGS_HISTORY_SHEET_NAME = "Standings_History";
const STANDINGS_HISTORY_COL_COUNT = 24;
const STANDINGS_HISTORY_LAST_COL = "X";

const STANDINGS_HISTORY_HEADERS = [
  "espn_code",
  "league_name",
  "season",
  "matchweek",
  "group_name",
  "rank",
  "team_name",
  "team_logo_url",
  "team_logo_key",
  "team_abbr",
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

const STANDINGS_HISTORY_COL = Object.fromEntries(
  STANDINGS_HISTORY_HEADERS.map((name, i) => [name, i]),
);

function padStandingsRow(row) {
  const r = Array.isArray(row) ? [...row] : [];
  while (r.length < STANDINGS_COL_COUNT) r.push("");
  return r;
}

function padStandingsHistoryRow(row) {
  const r = Array.isArray(row) ? [...row] : [];
  while (r.length < STANDINGS_HISTORY_COL_COUNT) r.push("");
  return r;
}

function standingsRowToHistoryRow(standingsRow, matchweek) {
  const s = padStandingsRow(standingsRow);
  const h = new Array(STANDINGS_HISTORY_COL_COUNT).fill("");
  h[STANDINGS_HISTORY_COL.espn_code] = s[STANDINGS_COL.espn_code];
  h[STANDINGS_HISTORY_COL.league_name] = s[STANDINGS_COL.league_name];
  h[STANDINGS_HISTORY_COL.season] = s[STANDINGS_COL.season];
  h[STANDINGS_HISTORY_COL.matchweek] = matchweek === "" || matchweek == null ? "" : String(matchweek);
  h[STANDINGS_HISTORY_COL.group_name] = s[STANDINGS_COL.group_name];
  h[STANDINGS_HISTORY_COL.rank] = s[STANDINGS_COL.rank];
  h[STANDINGS_HISTORY_COL.team_name] = s[STANDINGS_COL.team_name];
  h[STANDINGS_HISTORY_COL.team_logo_url] = s[STANDINGS_COL.team_logo_url];
  h[STANDINGS_HISTORY_COL.team_logo_key] = s[STANDINGS_COL.team_logo_key];
  h[STANDINGS_HISTORY_COL.team_abbr] = s[STANDINGS_COL.team_abbr];
  h[STANDINGS_HISTORY_COL.is_national] = s[STANDINGS_COL.is_national];
  h[STANDINGS_HISTORY_COL.played] = s[STANDINGS_COL.played];
  h[STANDINGS_HISTORY_COL.won] = s[STANDINGS_COL.won];
  h[STANDINGS_HISTORY_COL.draw] = s[STANDINGS_COL.draw];
  h[STANDINGS_HISTORY_COL.lost] = s[STANDINGS_COL.lost];
  h[STANDINGS_HISTORY_COL.goals_for] = s[STANDINGS_COL.goals_for];
  h[STANDINGS_HISTORY_COL.goals_against] = s[STANDINGS_COL.goals_against];
  h[STANDINGS_HISTORY_COL.goal_diff] = s[STANDINGS_COL.goal_diff];
  h[STANDINGS_HISTORY_COL.points] = s[STANDINGS_COL.points];
  h[STANDINGS_HISTORY_COL.ppg] = s[STANDINGS_COL.ppg];
  h[STANDINGS_HISTORY_COL.advanced] = s[STANDINGS_COL.advanced];
  h[STANDINGS_HISTORY_COL.deductions] = s[STANDINGS_COL.deductions];
  h[STANDINGS_HISTORY_COL.rank_change] = s[STANDINGS_COL.rank_change];
  h[STANDINGS_HISTORY_COL.updated_at] = s[STANDINGS_COL.updated_at];
  return padStandingsHistoryRow(h);
}

/** Kunci dedupe snapshot per pekan. */
function standingsHistoryKey(row) {
  const r = padStandingsHistoryRow(row);
  return [
    r[STANDINGS_HISTORY_COL.season],
    r[STANDINGS_HISTORY_COL.espn_code],
    r[STANDINGS_HISTORY_COL.matchweek],
    r[STANDINGS_HISTORY_COL.group_name],
    r[STANDINGS_HISTORY_COL.team_name],
  ].join("|");
}

function standingsSheetRange(maxRow, sheetName = STANDINGS_SHEET_NAME) {
  return `${sheetName}!A1:${STANDINGS_LAST_COL}${maxRow}`;
}

module.exports = {
  STANDINGS_SHEET_NAME,
  STANDINGS_COL_COUNT,
  STANDINGS_LAST_COL,
  STANDINGS_HEADERS,
  STANDINGS_COL,
  STANDINGS_HISTORY_SHEET_NAME,
  STANDINGS_HISTORY_COL_COUNT,
  STANDINGS_HISTORY_LAST_COL,
  STANDINGS_HISTORY_HEADERS,
  STANDINGS_HISTORY_COL,
  padStandingsRow,
  padStandingsHistoryRow,
  standingsRowToHistoryRow,
  standingsHistoryKey,
  standingsSheetRange,
};
