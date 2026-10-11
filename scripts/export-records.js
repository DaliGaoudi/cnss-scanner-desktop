/*
 * export-records.js — dump a desktop install's CNSS records to one JSON file.
 *
 * Source B of the one-way migration to the web app (source A is the licence
 * server's snapshot — see cnss-license-server/scripts/dump-snapshot.js, which
 * needs nothing from the customer's machine). Use this one when the device
 * holds changes it never managed to sync, or when there is no licence-server
 * snapshot to take.
 *
 * Usage:
 *   node scripts/export-records.js                      → %APPDATA%/CNSS Scanner/cnss.db
 *   node scripts/export-records.js --db "D:\cnss.db"    → a copy of that file
 *   node scripts/export-records.js --out records.json     (default: cnss-records-<date>.json)
 *
 * Deliberately uses node:sqlite, not the app's better-sqlite3: that native
 * module is compiled against Electron's ABI and will not load under plain node.
 * Requires Node 22.5+ (24+ recommended). The usual way to run this is to copy
 * cnss.db off the office machine and run the script here — the office PC needs
 * no Node install of its own.
 *
 * The output shape matches the sync snapshot in server/sync.js
 * ({ cnss: [...], cnss_oeuvre: [...] }), so both sources import identically.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const TABLES = ['cnss', 'cnss_oeuvre'];

const parseArgs = (argv) => {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) { args[key] = true; }
        else { args[key] = next; i++; }
    }
    return args;
};

const args = parseArgs(process.argv.slice(2));
const fail = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };

// Default to the same data dir the app uses (server/config.js), so running this
// with no arguments exports the live database.
const defaultDbPath = () => {
    let d = process.env.CNSS_USERDATA;
    if (!d) {
        d = process.platform === 'win32' && process.env.APPDATA
            ? path.join(process.env.APPDATA, 'CNSS Scanner')
            : path.join(os.homedir(), '.cnss-scanner');
    }
    return path.join(d, 'cnss.db');
};

const dbFile = args.db && args.db !== true ? args.db : defaultDbPath();
if (!fs.existsSync(dbFile)) fail(`database not found: ${dbFile}`);

// Read-only: this script must never be able to damage the office's live data.
let conn;
try { conn = new DatabaseSync(dbFile, { readOnly: true }); }
catch (e) { fail(`could not open ${dbFile}: ${e.message}`); }

const out = {
    exported_at: new Date().toISOString(),
    source: dbFile,
    counts: {},
};
try {
    for (const t of TABLES) {
        // Plain objects, so JSON.stringify sees the rows the way pg will.
        const rows = conn.prepare(`SELECT * FROM ${t}`).all().map((r) => ({ ...r }));
        out[t] = rows;
        out.counts[t] = rows.length;
    }
} catch (e) {
    fail(`could not read records: ${e.message}`);
} finally {
    conn.close();
}

const stamp = out.exported_at.slice(0, 10);
const outFile = args.out && args.out !== true ? args.out : `cnss-records-${stamp}.json`;
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

const withNotes = out.cnss.filter((r) => r.notes && String(r.notes).trim()).length;

console.log(`\n  ✓ exported ${out.counts.cnss} employer record(s) and ${out.counts.cnss_oeuvre} card(s)`);
console.log(`     from : ${dbFile}`);
console.log(`     to   : ${path.resolve(outFile)}`);
if (withNotes) console.log(`     note : ${withNotes} record(s) carry ملاحظات — see --keep-notes in the import script`);
console.log('');
