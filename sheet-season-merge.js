/**
 * Gabung baris Sheet: timpa musim aktif saja, musim lama tetap.
 * Dipakai Standings, Top_Scores, Top_Assist.
 */

async function loadSheetDataRows(sheets, sheetId, sheetName, lastCol, scanMaxRow = 50000) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2:${lastCol}${scanMaxRow}`,
    });
    return res.data.values || [];
  } catch {
    return [];
  }
}

function normSeason(v) {
  return String(v || "").trim();
}

/** Buang baris musim aktif dari data lama, sisipkan baris baru musim aktif. */
function mergeRowsBySeason(existingRows, newRows, seasonColIndex, currentSeason) {
  const cur = normSeason(currentSeason);
  const kept = (existingRows || []).filter((row) => normSeason(row[seasonColIndex]) !== cur);
  return [...kept, ...(newRows || [])];
}

async function writeSheetMergeSeason(sheets, opts) {
  const {
    sheetId,
    sheetName,
    headers,
    lastCol,
    clearMaxRow = 5000,
    newRows,
    seasonColIndex,
    currentSeason,
  } = opts;

  const existing = await loadSheetDataRows(sheets, sheetId, sheetName, lastCol);
  const merged = mergeRowsBySeason(existing, newRows, seasonColIndex, currentSeason);
  const keptOther = merged.length - (newRows || []).length;

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${sheetName}!A2:${lastCol}${clearMaxRow}`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers, ...merged] },
  });

  return { total: merged.length, keptOtherSeasons: keptOther, currentSeasonRows: (newRows || []).length };
}

module.exports = {
  loadSheetDataRows,
  mergeRowsBySeason,
  writeSheetMergeSeason,
};
