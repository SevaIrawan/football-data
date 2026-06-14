/**
 * Slug logo tim — sama di tab Result (home/away_logo_key) dan Standings (team_logo_key).
 * Override manual: logo-key-overrides.json
 */

const fs = require("fs");
const path = require("path");

const LOGO_KEY_OVERRIDES_PATH = path.join(__dirname, "logo-key-overrides.json");

function loadLogoKeyOverrides() {
  try {
    if (!fs.existsSync(LOGO_KEY_OVERRIDES_PATH)) return {};
    const raw = fs.readFileSync(LOGO_KEY_OVERRIDES_PATH, "utf8");
    const o = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

const LOGO_KEY_OVERRIDES = loadLogoKeyOverrides();

/**
 * Nama tim (ESPN displayName) → logo_key: huruf kecil, pemisah "-", tanpa token fc/cf/ss/sc.
 */
function displayNameToLogoKey(displayName) {
  const stripTokens = new Set(["fc", "cf", "ss", "sc"]);
  let s = String(displayName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\//g, "-")
    .replace(/&/g, " and ")
    .toLowerCase();

  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  const parts = s.split(/\s+/).filter(Boolean).filter((w) => !stripTokens.has(w));
  let slug = parts.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return "";

  if (LOGO_KEY_OVERRIDES[slug]) return LOGO_KEY_OVERRIDES[slug];
  return slug;
}

module.exports = { displayNameToLogoKey, loadLogoKeyOverrides, LOGO_KEY_OVERRIDES_PATH };
