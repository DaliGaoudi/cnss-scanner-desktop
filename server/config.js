const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

/*
 * App configuration for the single-office CNSS scanner.
 *
 * Everything the office can rotate lives in ONE JSON file (config.json) inside
 * the user-data directory — never inside the install folder, so a reinstall or
 * update never wipes it. On first run we seed it from the embedded defaults
 * below.
 *
 *   openrouterApiKey — the embedded OpenRouter key (rotate by editing the value
 *                      in config.json, or this constant before re-packaging).
 *   passwordHash     — bcrypt hash of the single shared office password
 *                      (rotate with `npm run set-password -- <newPassword>`).
 *   jwtSecret        — local-only token secret.
 */

// ── Embedded defaults (single trusted office) ──
// NOTE: the OpenRouter key is no longer embedded here — AI extraction goes
// through the license server's proxy (see server/license.js + cnssExtract.js).
const DEFAULT_PASSWORD = 'cnss2026';
const DEFAULT_JWT_SECRET = 'cnss_office_local_token_secret';

// Where config.json + the SQLite DB live. Electron sets CNSS_USERDATA to
// app.getPath('userData'); standalone tools/scripts fall back to the same
// folder so they edit the SAME config the app uses. Electron names that folder
// after package.json "name" (cnss-scanner-desktop), not build.productName — a
// fallback of "CNSS Scanner" made `npm run set-password` report success while
// changing a config the app never reads.
const USERDATA_FOLDER = 'cnss-scanner-desktop';
function dataDir() {
    let d = process.env.CNSS_USERDATA;
    if (!d) {
        if (process.platform === 'win32' && process.env.APPDATA) {
            d = path.join(process.env.APPDATA, USERDATA_FOLDER);
        } else {
            d = path.join(os.homedir(), '.cnss-scanner');
        }
    }
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
}

const configPath = () => path.join(dataDir(), 'config.json');
const dbPath = () => path.join(dataDir(), 'cnss.db');

// Customer-uploaded act template. When present it overrides the bundled default
// (server/assets/template_cnss.docx). Lives in the writable data dir so updates
// to the app never clobber it.
const templatePath = () => path.join(dataDir(), 'template_cnss.docx');
// Same for the monthly bill (قائمة مصاريف) — written by the Word import.
const listTemplatePath = () => path.join(dataDir(), 'template_list.docx');
// Word import working folder: the pending result awaiting «اعتماد», and the
// report of the active one.
const importDir = () => path.join(dataDir(), 'word_import');

// The office-location wording the template hardcoded before it became settings.
//   officeJurisdiction → "العدل المنفذ بالدائرة القضائية {…}"
//   cnssBureau         → "بواسطة مكتبه الجهوي {…}."
//   cnssRegion         → "المدير الجهوي للشؤون الإجتماعية {…}"
const SOUSSE_DEFAULTS = {
    officeJurisdiction: 'لمحكمة الإستئناف بسوسة',
    cnssBureau: 'بسوسة الكائن بشارع الجمهورية بسوسة',
    cnssRegion: 'بسوسة',
};

let _cfg = null;

function getConfig() {
    if (_cfg) return _cfg;
    const p = configPath();
    let cfg = {};
    if (fs.existsSync(p)) {
        try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { cfg = {}; }
    }
    let changed = false;
    if (!cfg.jwtSecret) { cfg.jwtSecret = DEFAULT_JWT_SECRET; changed = true; }
    if (!cfg.passwordHash) { cfg.passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10); changed = true; }
    // Office profile — the bailiff's letterhead details (merged into the act).
    // officeName doubles as the app branding (login/header).
    if (cfg.officeName === undefined) { cfg.officeName = ''; changed = true; }   // اسم العدل المنفذ
    if (cfg.officeNameFr === undefined) { cfg.officeNameFr = ''; changed = true; } // name in Latin (French letterhead block)
    if (cfg.officeCity === undefined) { cfg.officeCity = ''; changed = true; }   // المدينة (used in the monthly list header)
    if (cfg.officeAddress === undefined) { cfg.officeAddress = ''; changed = true; }
    if (cfg.officePhone === undefined) { cfg.officePhone = ''; changed = true; }
    if (cfg.officeFax === undefined) { cfg.officeFax = ''; changed = true; }
    if (cfg.taxId === undefined) { cfg.taxId = ''; changed = true; }            // المعرف الجبائي
    if (cfg.officeRib === undefined) { cfg.officeRib = ''; changed = true; }    // RIB bancaire
    if (cfg.officeCnss === undefined) { cfg.officeCnss = ''; changed = true; }  // معرّف CNSS
    // Where the office sits, printed in the body of every محضر. These used to be
    // hardcoded to Sousse in the template, so an install that was already set up
    // keeps exactly what its acts printed; a fresh install fills them in onboarding.
    const LEGACY = cfg.onboardingDone === true;
    for (const [k, sousse] of Object.entries(SOUSSE_DEFAULTS)) {
        if (cfg[k] === undefined) { cfg[k] = LEGACY ? sousse : ''; changed = true; }
    }
    if (LEGACY && !cfg.officeCity) { cfg.officeCity = 'سوسة'; changed = true; }
    // First-run onboarding (details + password) gate.
    if (cfg.onboardingDone === undefined) { cfg.onboardingDone = false; changed = true; }
    if (changed) {
        try { fs.writeFileSync(p, JSON.stringify(cfg, null, 2)); }
        catch (e) { console.error('Failed to persist config.json:', e.message); }
    }
    _cfg = cfg;
    return cfg;
}

function saveConfig() {
    fs.writeFileSync(configPath(), JSON.stringify(getConfig(), null, 2));
}

// Merge a partial patch into config and persist. Used by the settings routes.
function updateConfig(patch) {
    const cfg = getConfig();
    Object.assign(cfg, patch);
    _cfg = cfg;
    saveConfig();
    return cfg;
}

// Start config.json over for the next licence, as on a fresh install: no office
// profile, onboarding to run, the default password (the next office may not know
// the previous one's — "forgot the password" is a reason to leave). Only the
// local token secret and a custom licence-server URL carry over.
function resetForNewLicence() {
    const prev = getConfig();
    const keep = { jwtSecret: prev.jwtSecret };
    if (prev.licenseServerUrl) keep.licenseServerUrl = prev.licenseServerUrl;
    fs.writeFileSync(configPath(), JSON.stringify(keep, null, 2));
    _cfg = null;
    return getConfig(); // re-seeds the defaults
}

function setPassword(plain) {
    return updateConfig({ passwordHash: bcrypt.hashSync(String(plain), 10) });
}

// The office-profile fields the customer fills (and can leave empty).
const OFFICE_FIELDS = ['officeName', 'officeNameFr', 'officeCity', 'officeAddress', 'officePhone', 'officeFax', 'taxId', 'officeRib', 'officeCnss',
    'officeJurisdiction', 'cnssBureau', 'cnssRegion'];

function officeProfile() {
    const c = getConfig();
    const out = {};
    OFFICE_FIELDS.forEach((k) => { out[k] = c[k] || ''; });
    return out;
}

// Map a profile object onto the act template's letterhead merge fields.
function mergeFromProfile(p = {}) {
    return {
        office_name: p.officeName || '',
        office_name_fr: p.officeNameFr || '',
        office_city: p.officeCity || '',
        office_address: p.officeAddress || '',
        office_phone: p.officePhone || '',
        office_fax: p.officeFax || '',
        office_tax_id: p.taxId || '',
        office_rib: p.officeRib || '',
        office_cnss: p.officeCnss || '',
        office_jurisdiction: p.officeJurisdiction || '',
        cnss_bureau: p.cnssBureau || '',
        cnss_region: p.cnssRegion || '',
    };
}

// Merge data from the SAVED profile (what real acts use).
function officeMergeData() {
    return mergeFromProfile(officeProfile());
}

module.exports = {
    getConfig, setPassword, updateConfig, resetForNewLicence,
    officeProfile, officeMergeData, mergeFromProfile, OFFICE_FIELDS, SOUSSE_DEFAULTS,
    dataDir, dbPath, configPath, templatePath, listTemplatePath, importDir, DEFAULT_PASSWORD,
};
