const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const license = require('./license');

/*
 * The office's Word-import templates (the act and the monthly bill) travel with
 * the licence, so a second PC or the cloud app prints in the same look.
 *
 * The licence server keeps ONE copy of each kind per licence:
 *   POST /api/templates/push        {token, fingerprint, kind, docxBase64|null}
 *   POST /api/templates/pull        {token, fingerprint} → {templates:[{kind, sha256, ...}]}
 *   POST /api/templates/pull/:kind  {token, fingerprint} → {kind, sha256, docxBase64}
 *
 * Only the ACTIVE files (config.templatePath() / listTemplatePath()) are ever
 * read or written here. A Word import still awaiting «اعتماد» lives in
 * word_import/pending/ and is never touched.
 *
 * Everything is best-effort and fails open: offline, a 5xx, a bad download or a
 * moved licence leaves the local files exactly as they were and is retried on
 * the next launch. A 410 records the move (the office is locked) and stops.
 *
 * Per template (act, list) config.json keeps `templateSync[kind].lastSyncedSha`:
 * the sha256 (or null = absent) both sides agreed on at the last CONFIRMED push or
 * download. With L = local sha, S = server sha, B = that remembered sha, launch
 * can tell who changed what, so an unpushed local change is never overwritten and
 * a failed delete never comes back. See reconcile(). Before a local template is
 * overwritten or deleted it is copied to <dataDir>/backups/templates/ (kept).
 */

const KINDS = ['act', 'list'];
const REQUEST_TIMEOUT_MS = 30000;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EMPTY = () => ({ downloaded: [], uploaded: [], deleted: [] });

const localPath = (kind) => (kind === 'act' ? config.templatePath() : config.listTemplatePath());
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readLocal = (kind) => { try { return fs.readFileSync(localPath(kind)); } catch (e) { return null; } };

// Token + fingerprint, or null when this PC isn't activated (sync is then a no-op).
function ctx() {
    try { return license.activationContext(); } catch (e) { return null; }
}

// Raised by call() on a 410, so the caller stops its whole run.
class Gone extends Error {}

// POST to the licence server. Resolves the parsed body on 2xx, null on 404 (the
// caller decides what a missing item means), throws Gone on 410 (after recording
// the move) and a plain Error on anything else.
async function call(c, route, extra = {}) {
    const res = await fetch(`${license.serverUrl()}/api/templates/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: c.token, fingerprint: c.fingerprint, ...extra }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 410) {
        const d = await res.json().catch(() => ({}));
        license.markMoved({ url: d && d.cloudUrl });
        throw new Gone('moved to the cloud');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`licence server answered ${res.status}`);
    return res.json();
}

// ── Per-template sync state: config.templateSync[kind].lastSyncedSha ──
// undefined = never synced; null = both sides had none; string = the agreed sha.
// The pre-release flag `templatesSyncedAt` is dropped: those PCs count as never synced.
function migrate() {
    const cfg = config.getConfig();
    if ('templatesSyncedAt' in cfg) {
        delete cfg.templatesSyncedAt;
        config.updateConfig({});
    }
}
const lastSynced = (kind) => {
    const e = (config.getConfig().templateSync || {})[kind];
    return e && e.lastSyncedSha !== undefined ? e.lastSyncedSha : undefined;
};
const setLastSynced = (kind, sha) => {
    try {
        config.updateConfig({ templateSync: { ...(config.getConfig().templateSync || {}), [kind]: { lastSyncedSha: sha } } });
    } catch (e) { /* ignore */ }
};

// Copy a local template aside before it is overwritten or deleted. Never deleted.
function backup(kind, buf, suffix = '') {
    const dir = path.join(config.dataDir(), 'backups', 'templates');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, `${stamp}_${kind}${suffix}.docx`), buf);
}

// Replace a local template atomically (a crash never leaves half a docx).
function writeLocal(kind, buf) {
    const dest = localPath(kind);
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
}

// One run at a time: a launch sync and an «اعتماد» push never interleave.
let _queue = Promise.resolve();
const serialized = (fn) => {
    const run = _queue.then(fn, fn);
    _queue = run.catch(() => {});
    return run;
};

async function pushKindNow(kind) {
    if (!KINDS.includes(kind) || license.isMoved()) return;
    const c = ctx();
    if (!c) return;
    const buf = readLocal(kind);
    try {
        await call(c, 'push', { kind, docxBase64: buf ? buf.toString('base64') : null });
        setLastSynced(kind, buf ? sha256(buf) : null); // confirmed: the server has exactly this
    } catch (e) { /* not confirmed: the remembered sha stays, so the next launch pushes it again */ }
}

// Send this kind's local file up (an absent file sends null = delete). Never throws.
const pushKind = (kind) => serialized(() => pushKindNow(kind)).catch(() => {});
// Push both kinds, e.g. after «اعتماد» or «العودة للشكل القياسي».
const pushAll = () => serialized(async () => { for (const k of KINDS) await pushKindNow(k); }).catch(() => {});

// Fetch one kind; null unless it really is the announced docx.
async function fetchServerCopy(c, meta) {
    const d = await call(c, `pull/${meta.kind}`);
    if (!d || typeof d.docxBase64 !== 'string') return null;
    const buf = Buffer.from(d.docxBase64, 'base64');
    if (buf.length < 4 || !buf.subarray(0, 4).equals(ZIP_MAGIC)) return null;
    return sha256(buf) === meta.sha256 ? buf : null;
}

// Take the server's copy (backing up what it replaces). False when the download is unusable.
async function takeServer(c, kind, meta, out) {
    const buf = await fetchServerCopy(c, meta);
    if (!buf) return false;
    const local = readLocal(kind);
    if (local) backup(kind, local);
    writeLocal(kind, buf);
    setLastSynced(kind, meta.sha256);
    out.downloaded.push(kind);
    return true;
}

// Send the local state up: its bytes, or null when the local file is absent.
async function sendLocal(c, kind, local, out) {
    await call(c, 'push', { kind, docxBase64: local ? local.toString('base64') : null });
    setLastSynced(kind, local ? sha256(local) : null);
    out.uploaded.push(kind);
}

// Both sides changed since they last agreed: the newer write wins, the loser is backed up.
// A side that is simply absent never beats one that exists (nothing is destroyed).
async function bothChanged(c, kind, local, meta, out) {
    if (!local) return takeServer(c, kind, meta, out);
    if (!meta) { await sendLocal(c, kind, local, out); return true; }
    const serverAt = Date.parse(meta.uploadedAt);
    const localAt = fs.statSync(localPath(kind)).mtimeMs;
    if (Number.isFinite(serverAt) && serverAt > localAt) return takeServer(c, kind, meta, out);
    const theirs = await fetchServerCopy(c, meta);
    if (theirs) backup(kind, theirs, '_server');
    await sendLocal(c, kind, local, out);
    return true;
}

// One kind: L = local sha, S = server sha, B = last confirmed sha. Returns false on a failure
// that should keep the remembered state (retried next launch).
async function reconcile(c, kind, meta, out) {
    const local = readLocal(kind);
    const L = local ? sha256(local) : null;
    const S = meta ? meta.sha256 : null;
    const B = lastSynced(kind);
    if (L === S) { if (B !== L) setLastSynced(kind, L); return true; }
    if (B === undefined) {                       // never synced on this PC
        if (S) return takeServer(c, kind, meta, out);
        await sendLocal(c, kind, local, out);    // server lacks it, local has it: backfill
        return true;
    }
    if (L === B) {                               // only the server changed
        if (S) return takeServer(c, kind, meta, out);
        backup(kind, local);                     // deleted on the server (L is B, non-null here)
        fs.unlinkSync(localPath(kind));
        setLastSynced(kind, null);
        out.deleted.push(kind);
        return true;
    }
    if (S === B) { await sendLocal(c, kind, local, out); return true; }  // only this PC changed
    return bothChanged(c, kind, local, meta, out);
}

async function syncOnLaunchNow() {
    const out = EMPTY();
    if (license.isMoved()) return out;
    const c = ctx();
    if (!c) return out;
    try {
        migrate();
        const listing = await call(c, 'pull');
        if (!listing || !Array.isArray(listing.templates)) return out;
        const onServer = new Map(listing.templates.map((t) => [t.kind, t]));
        for (const kind of KINDS) {
            try {
                await reconcile(c, kind, onServer.get(kind) || null, out);
            } catch (e) {
                if (e instanceof Gone) return out;
                // keep the local file and the remembered sha; retry next launch
            }
        }
    } catch (e) { /* offline or a 5xx: keep everything, retry next launch */ }
    return out;
}

// Reconcile this PC's templates with the server's. Never throws.
const syncOnLaunch = () => serialized(syncOnLaunchNow).catch(() => EMPTY());

module.exports = { pushKind, pushAll, syncOnLaunch };
