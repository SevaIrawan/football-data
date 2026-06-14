/**
 * Schema tab Top_Scores & Top_Assist (struktur identik, beda urutan ranking).
 * Musim aktif saja — timpa setiap run Script 6.
 */

const TOP_SCORES_SHEET_NAME = "Top_Scores";
const TOP_ASSIST_SHEET_NAME = "Top_Assist";
const TOP_PLAYERS_COL_COUNT = 14;
const TOP_PLAYERS_LAST_COL = "N";

const TOP_PLAYERS_HEADERS = [
  "espn_code",
  "league_name",
  "season",
  "rank",
  "player_name",
  "player_id",
  "team_name",
  "team_logo_url",
  "team_logo_key",
  "goals",
  "assists",
  "penalties",
  "played",
  "updated_at",
];

const TOP_PLAYERS_COL = Object.fromEntries(TOP_PLAYERS_HEADERS.map((name, i) => [name, i]));

function padTopPlayersRow(row) {
  const r = Array.isArray(row) ? [...row] : [];
  while (r.length < TOP_PLAYERS_COL_COUNT) r.push("");
  return r;
}

module.exports = {
  TOP_SCORES_SHEET_NAME,
  TOP_ASSIST_SHEET_NAME,
  TOP_PLAYERS_COL_COUNT,
  TOP_PLAYERS_LAST_COL,
  TOP_PLAYERS_HEADERS,
  TOP_PLAYERS_COL,
  padTopPlayersRow,
};
