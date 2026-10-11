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

// "Synced before" is what tells a server-side deletion apart from a backfill.
const markSynced = () => { try { config.updateConfig({ templatesSyncedAt: new Date().toISOString() }); } catch (e) { /* ignore */ } };
const forgetSynced = () => { try { config.updateConfig({ templatesSyncedAt: null }); } catch (e) { /* ignore */ } };

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
    } catch (e) {
        // The server doesn't have this change. Forget "synced" so the next launch
        // treats the file as a backfill (re-upload) instead of a server deletion.
        if (!(e instanceof Gone)) forgetSynced();
    }
}

// Send this kind's local file up (an absent file sends null = delete). Never throws.
const pushKind = (kind) => serialized(() => pushKindNow(kind)).catch(() => {});
// Push both kinds, e.g. after «اعتماد» or «العودة للشكل القياسي».
const pushAll = () => serialized(async () => { for (const k of KINDS) await pushKindNow(k); }).catch(() => {});

// Fetch one kind and keep it only if it really is the announced docx.
async function download(c, meta) {
    const d = await call(c, `pull/${meta.kind}`);
    if (!d || typeof d.docxBase64 !== 'string') return false;
    const buf = Buffer.from(d.docxBase64, 'base64');
    if (buf.length < 4 || !buf.subarray(0, 4).equals(ZIP_MAGIC)) return false;
    if (sha256(buf) !== meta.sha256) return false;
    writeLocal(meta.kind, buf);
    return true;
}

async function syncOnLaunchNow() {
    const out = EMPTY();
    if (license.isMoved()) return out;
    const c = ctx();
    if (!c) return out;
    try {
        const listing = await call(c, 'pull');
        if (!listing || !Array.isArray(listing.templates)) return out;
        const onServer = new Map(listing.templates.map((t) => [t.kind, t]));
        const syncedBefore = !!config.getConfig().templatesSyncedAt;
        let failed = false;
        for (const kind of KINDS) {
            try {
                const meta = onServer.get(kind);
                const local = readLocal(kind);
                if (meta) {
                    if (!local || sha256(local) !== meta.sha256) {
                        if (await download(c, meta)) out.downloaded.push(kind); else failed = true;
                    }
                } else if (local && syncedBefore) {
                    fs.unlinkSync(localPath(kind));            // deleted on the server since the last sync
                    out.deleted.push(kind);
                } else if (local) {
                    await call(c, 'push', { kind, docxBase64: local.toString('base64') });
                    out.uploaded.push(kind);                   // approved before this release: backfill once
                }
            } catch (e) {
                if (e instanceof Gone) return out;
                failed = true;                                  // keep the local file; retry next launch
            }
        }
        if (!failed) markSynced();
    } catch (e) { /* offline or a 5xx: keep everything, retry next launch */ }
    return out;
}

// Reconcile this PC's templates with the server's. Never throws.
const syncOnLaunch = () => serialized(syncOnLaunchNow).catch(() => EMPTY());

module.exports = { pushKind, pushAll, syncOnLaunch };
