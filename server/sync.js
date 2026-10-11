const fs = require('fs');
const path = require('path');
const { dataDir } = require('./config');
const license = require('./license');
const db = require('./db');

/*
 * Record sync across the office's devices.
 *
 * Records live in the local SQLite DB; the license server keeps ONE shared JSON
 * snapshot per license. We push the local records up after every change and pull
 * the latest down on launch, so a customer's machines all show the same data.
 *
 * Safe under the office's "one device at a time" usage: the server versions each
 * snapshot, a device pulls on launch before editing, and a stale push is refused
 * (409) and resolved by re-pulling — so a newer snapshot is never clobbered.
 *
 * Everything here is best-effort: any network/offline failure leaves the local
 * database untouched.
 */

// The tables that make up an office's record set (see server/schema.js). A
// snapshot from an older app version has no cnss_acte key: the table is then
// emptied and its cards simply count as not yet in a محضر.
const TABLES = ['cnss', 'cnss_oeuvre', 'cnss_acte'];

const stateFile = () => path.join(dataDir(), 'sync.json');
const loadState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; } };
const saveState = (s) => { try { fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2)); } catch (e) { /* ignore */ } };
const getVersion = () => parseInt(loadState().version, 10) || 0;
const setVersion = (v) => saveState({ ...loadState(), version: parseInt(v, 10) || 0 });

// Shrink-guard state (persisted so the warning survives a restart). Set when the
// server refuses a push with 422 because our local snapshot is drastically
// smaller than the stored one (a wiped/corrupted local DB). While set, automatic
// pushing is paused until the user resolves it from Settings. See push().
const getGuard = () => loadState().shrinkGuard || null;
const setGuard = (g) => saveState({ ...loadState(), shrinkGuard: g || null });

// Activation token + machine fingerprint, or null when the app isn't activated
// yet (sync is simply a no-op until then).
function ctx() {
    try { return license.activationContext(); } catch (e) { return null; }
}

// Replace the local record tables with the snapshot's rows, atomically. Only
// columns that exist locally are inserted, so a device on an older app version
// quietly ignores columns it doesn't know about.
function applySnapshot(data) {
    const conn = db.getConn();
    const insertRows = (table, rows) => {
        if (!Array.isArray(rows) || !rows.length) return;
        const localCols = new Set(conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
        const stmtCache = new Map();
        for (const row of rows) {
            const cols = Object.keys(row).filter((k) => localCols.has(k));
            if (!cols.length) continue;
            const sig = cols.join(',');
            let stmt = stmtCache.get(sig);
            if (!stmt) {
                stmt = conn.prepare(
                    `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
                );
                stmtCache.set(sig, stmt);
            }
            stmt.run(cols.map((c) => (row[c] === undefined ? null : row[c])));
        }
    };
    const tx = conn.transaction((snap) => {
        // Delete children first, then re-seed parents before children.
        for (let i = TABLES.length - 1; i >= 0; i--) conn.prepare(`DELETE FROM ${TABLES[i]}`).run();
        for (const t of TABLES) insertRows(t, snap[t]);
    });
    tx(data || {});
}

// Build the snapshot to upload from the current local records.
function buildSnapshot() {
    const data = {};
    for (const t of TABLES) data[t] = db.all(`SELECT * FROM ${t}`);
    return data;
}

let _syncing = false;

// ── Pull the latest snapshot and apply it if newer than what we last saw. ──
async function pull() {
    const c = ctx();
    if (!c || _syncing) return;
    _syncing = true;
    try {
        const res = await fetch(`${license.serverUrl()}/api/data/pull`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: c.token, fingerprint: c.fingerprint }),
        });
        if (!res.ok) return;
        const d = await res.json().catch(() => ({}));
        if (d && d.version > getVersion() && d.data) {
            applySnapshot(d.data);
            setVersion(d.version);
        } else if (d && d.version === 0) {
            // Server has nothing yet → seed it from this device on the next push.
        }
    } catch (e) { /* offline: keep local data */ }
    finally { _syncing = false; }
}

// ── Push local records up. On a stale-version 409, pull and let the next change
//    re-push (under one-at-a-time use this is effectively never hit). On a 422
//    shrink-guard, pause auto-push and record it for the user to resolve. ──
async function push() {
    const c = ctx();
    if (!c || _syncing) return;
    if (getGuard()) return;        // paused: local looks wiped, waiting for the user
    _syncing = true;
    try {
        const res = await fetch(`${license.serverUrl()}/api/data/push`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: c.token, fingerprint: c.fingerprint, baseVersion: getVersion(), data: buildSnapshot() }),
        });
        if (res.ok) {
            const d = await res.json().catch(() => ({}));
            if (d && d.version) setVersion(d.version);
        } else if (res.status === 409) {
            _syncing = false;          // release before re-entering pull()
            await pull();
            return;
        } else if (res.status === 422) {
            // The server rejected this push as a suspicious shrink. Do NOT retry —
            // record it and stop auto-pushing so we can't hammer the endpoint. The
            // user resolves it (pull server copy, or force overwrite) from Settings.
            const d = await res.json().catch(() => ({}));
            if (d && d.shrinkGuard) {
                setGuard({
                    currentCount: d.currentCount, newCount: d.newCount,
                    currentVersion: d.currentVersion, at: Date.now(),
                });
            }
            return;
        }
    } catch (e) { /* offline: snapshot stays local; retried on next change/launch */ }
    finally { _syncing = false; }
}

// ── Debounced push: collapse a burst of edits into one upload. ──
let _timer = null;
function pushSoon(delay = 1500) {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => { _timer = null; push().catch(() => {}); }, delay);
}

// Drop a debounced push that hasn't fired yet (the licence is being left).
function cancelPending() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
}

// Push now and report whether the server has our latest records — used before
// leaving a licence. Same rules as push(); never throws.
async function flush() {
    cancelPending();
    if (!ctx() || getGuard()) return false;
    const before = getVersion();
    await push();
    return getVersion() > before;
}

// Pull, then push — used by the manual "sync now" button.
async function syncNow() {
    await pull();
    await push();
}

// ── Shrink-guard resolutions (invoked from Settings) ──────────────────────────
// The two exits a user has when auto-push is paused by a shrink-guard.

// Resolution A (recommended): discard the local records and take the server copy,
// then clear the guard and let normal sync resume. Applies unconditionally — the
// server version equals ours (our push was refused), so ordinary pull() wouldn't.
async function resolvePullServer() {
    const c = ctx();
    if (!c || _syncing) return { ok: false };
    _syncing = true;
    try {
        const res = await fetch(`${license.serverUrl()}/api/data/pull`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: c.token, fingerprint: c.fingerprint }),
        });
        if (!res.ok) return { ok: false };
        const d = await res.json().catch(() => ({}));
        if (d && d.data) { applySnapshot(d.data); setVersion(d.version); }
        setGuard(null);
        return { ok: true };
    } catch (e) {
        return { ok: false };
    } finally { _syncing = false; }
}

// Resolution B (destructive): keep the local records and overwrite the server's
// larger snapshot with them, via a force push that skips the guard. Clears the
// guard on success. Guarded in the UI behind a scary confirmation.
async function resolveForceOverwrite() {
    const c = ctx();
    if (!c || _syncing) return { ok: false };
    _syncing = true;
    try {
        const res = await fetch(`${license.serverUrl()}/api/data/push`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: c.token, fingerprint: c.fingerprint,
                baseVersion: getVersion(), data: buildSnapshot(), force: true,
            }),
        });
        if (res.ok) {
            const d = await res.json().catch(() => ({}));
            if (d && d.version) setVersion(d.version);
            setGuard(null);
            return { ok: true };
        }
        if (res.status === 409) {
            // The server moved on since the guard was set — safer to pull than to
            // clobber a now-newer snapshot. Fall back to taking the server copy.
            _syncing = false;
            const r = await resolvePullServer();
            return r.ok ? { ok: true, pulled: true } : { ok: false };
        }
        return { ok: false };
    } catch (e) {
        return { ok: false };
    } finally { _syncing = false; }
}

module.exports = {
    pull, push, pushSoon, syncNow, flush, cancelPending,
    guardState: getGuard, resolvePullServer, resolveForceOverwrite,
};
