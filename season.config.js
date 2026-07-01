/**
 * Konfigurasi musim terpusat — SATU SUMBER untuk semua script (1–6).
 * Tambah liga: cukup objek baru di COMPETITIONS, lalu jalankan run_pipeline_sync.bat
 *
 * Ubah musim: SEASON_LABEL + ESPN_DATES_RANGE. Data musim lama di Sheet tidak dihapus
 * (Result append; Standings / Top_* merge per season; Standings_History append).
 */

const SEASON_LABEL = "2026/27";
const ESPN_DATES_RANGE = "20260801-20270701";

/**
 * season start year untuk endpoint yang perlu param season numerik.
 * Diambil dari "YYYY/YY", contoh "2026/27" -> 2026
 */
function getSeasonStartYear() {
  const m = String(SEASON_LABEL).match(/^(\d{4})\s*[/\-]/);
  if (m) return parseInt(m[1], 10);
  const y = parseInt(String(SEASON_LABEL).trim(), 10);
  return Number.isFinite(y) ? y : 2026;
}

/**
 * Tambah liga baru cukup tambah objek di bawah.
 * - espn_code: untuk Script1/2 (ESPN) & Script5 (klasemen)
 * - fd_code  : untuk Script3 (football-data.org, GW)
 * - logo_key : key logo liga di Sheet
 */
const COMPETITIONS = [
  { espn_code: "eng.1",          fd_code: "PL",  name: "Premier League",   logo_key: "premier-league" },
  { espn_code: "esp.1",          fd_code: "PD",  name: "La Liga",          logo_key: "la-liga" },
  { espn_code: "ita.1",          fd_code: "SA",  name: "Serie A",          logo_key: "serie-a" },
  { espn_code: "ger.1",          fd_code: "BL1", name: "Bundesliga",       logo_key: "bundesliga" },
  { espn_code: "fra.1",          fd_code: "FL1", name: "Ligue 1",          logo_key: "ligue-1" },
  { espn_code: "uefa.champions", fd_code: "CL",  name: "Champions League", logo_key: "champions-league" },
  { espn_code: "idn.1",          fd_code: null,   name: "Indonesian Super League", logo_key: "indonesian-super-league" },
];

module.exports = {
  SEASON_LABEL,
  ESPN_DATES_RANGE,
  COMPETITIONS,
  getSeasonStartYear,
};

