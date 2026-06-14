/**
 * SYNC PIPELINE — jalankan semua script yang mengikuti COMPETITIONS
 * ================================================================
 * Setelah tambah liga / ganti musim di season.config.js, run:
 *
 *   node run_pipeline_sync.js
 *
 * Urutan: Script 1 → 3 → 5 → 6
 * (Script 2 / 2 LIVE hasil pertandingan — jalankan terpisah / scheduler)
 */

const { spawnSync } = require("child_process");
const path = require("path");

const SCRIPTS = [
  { file: "script1_fetch_schedule.js", label: "Jadwal (Result)" },
  { file: "script3_update_matchweek.js", label: "Matchweek (GW)" },
  { file: "script5_update_standings.js", label: "Standings + History" },
  { file: "script6_update_top_players.js", label: "Top Scores + Top Assist" },
];

function main() {
  console.log("🚀 Pipeline sync — semua script mengikuti season.config.js");
  console.log("============================================================\n");

  const cwd = __dirname;

  for (const { file, label } of SCRIPTS) {
    console.log(`\n▶ ${label} (${file})`);
    console.log("─".repeat(60));

    const result = spawnSync(process.execPath, [path.join(cwd, file)], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    if (result.status !== 0) {
      console.error(`\n❌ Gagal di ${file} (exit ${result.status ?? 1})`);
      process.exit(result.status ?? 1);
    }
  }

  console.log("\n============================================================");
  console.log("✅ Pipeline sync selesai");
  console.log("   Hasil pertandingan: node script2_update_results.js");
  console.log("   LIVE scheduler   : run_script2_live.bat");
  console.log("============================================================\n");
}

main();
