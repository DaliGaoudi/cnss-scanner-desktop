const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const { dataDir, getConfig, updateConfig, OFFICE_FIELDS } = require('./config');

/*
 * Client side of the licensing system. The app is locked to one machine by a
 * signed activation token issued by the license server. We:
 *   - compute a stable machine fingerprint (Windows MachineGuid),
 *   - activate a license key against the server (once),
 *   - verify the token OFFLINE with the embedded public key on every launch,
 *   - re-validate online about once a year to honour revocation/transfer.
 *
 * The OpenRouter key is NOT here — AI extraction goes through the server's
 * /api/ai/extract proxy (see services/cnssExtract.js), gated by this token.
 */

// Public half of the license-server signing keypair (keys/public.pem). Used to
// verify activation tokens offline — a forged token can't pass this.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr49/beybGbiE/q+JbUqC
pDKj4E/JeRHOUfglAzYsUqfsQJscCbW0RWW5GOteVFjbbrQSeueU4Kgiq0td5Tkq
GuYcT7gWRknzpzFBLKCiN9qwjdb6Lrgg/+CmsxAMdra85C9tIH8OlL1UpU9h0OYK
Hvp4j2wfLr4NdiYn1v63kl5LRnt/91NgGnONsdx3DTSZBRnXLIjOFLgOwr9Bin5w
/0opnmN4LJ4h3SndTFmLuGAeAsyMdmfQe38chgRF+uMjFmtyxUlicUnAacVeIFz2
OgJG8nA5dnL/zYurCnAHAFD5otpWQZEXTnyKnm0/9ZcmVncXrcuHG02pK2ksT90R
/QIDAQAB
-----END PUBLIC KEY-----`;

// Single rotatable config value: the license/AI server base URL.
const DEFAULT_LICENSE_SERVER = 'https://cnss-license-server.vercel.app';
const serverUrl = () => (getConfig().licenseServerUrl || DEFAULT_LICENSE_SERVER).replace(/\/+$/, '');

const APP_VERSION = (() => {
    try { return require('../package.json').version || '1.0.0'; } catch (e) { return '1.0.0'; }
})();

// A launch-time check must not hold the app hostage to a slow network.
const VALIDATE_TIMEOUT_MS = 8000;

const licenseFile = () => path.join(dataDir(), 'license.json');
const load = () => { try { return JSON.parse(fs.readFileSync(licenseFile(), 'utf8')); } catch (e) { return {}; } };
const save = (obj) => fs.writeFileSync(licenseFile(), JSON.stringify(obj, null, 2));

// ── Machine fingerprint: Windows MachineGuid (stable per OS install) ──
let _fp = null;
function fingerprint() {
    if (_fp) return _fp;
    try {
        const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8' });
        const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]+)/);
        if (m) _fp = m[1].trim();
    } catch (e) { /* fall through */ }
    if (!_fp) _fp = 'host-' + os.hostname(); // non-Windows / locked-down fallback
    return _fp;
}

// ── Moved to the cloud ──
// The provider moved this office to the web app. We keep the key and token (so an
// undo unlocks on the next good validate) and only record where the office went.
// Local files are never touched.
// Only an https cloud link is ever kept: the lock holds, but a non-https url
// (a typo, a hostile server answer) gets no open button.
const isHttps = (u) => typeof u === 'string' && /^https:\/\//i.test(u);
function markMoved({ url, at, providerContact, licenseKey } = {}) {
    const lic = load();
    const prev = lic.movedToCloud || {};
    save({
        ...lic,
        // keep the typed key so a PC that never got a token can retry activation after an undo
        licenseKey: lic.licenseKey || licenseKey || '',
        movedToCloud: { url: [url, prev.url].find(isHttps) || '', at: at || prev.at || new Date().toISOString() },
        providerContact: providerContact || lic.providerContact || '',
    });
}
function clearMoved() {
    const { movedToCloud, ...rest } = load();
    if (movedToCloud) save(rest);
}
const isMoved = () => load().movedToCloud || null;

// ── Offline status: verify the stored token with the embedded public key ──
// A trial's token expires exactly when the trial does, so this alone locks an
// expired trial — no network needed. `trialExpired` is set when the server said
// so first (e.g. the trial was cut short); a successful revalidate clears it.
function getStatus() {
    const lic = load();
    const base = { licenseKey: lic.licenseKey || '', providerContact: lic.providerContact || '' };
    // A moved office sees the cloud screen, never a payment or activation one.
    if (lic.movedToCloud) return { activated: false, reason: 'moved_to_cloud', movedToCloud: lic.movedToCloud, ...base };
    if (!lic.token) return { activated: false, ...base };
    try {
        const claims = jwt.verify(lic.token, LICENSE_PUBLIC_KEY, { algorithms: ['RS256'] });
        if (claims.fp !== fingerprint()) return { activated: false, reason: 'machine_changed', ...base };
        if (lic.trialExpired) return { activated: false, reason: 'trial_expired', ...base };
        return {
            activated: true, ...base,
            customerName: claims.customer || '',
            kind: claims.kind || 'paid',
            expiresAt: claims.kind === 'trial' ? new Date(claims.exp * 1000).toISOString() : null,
        };
    } catch (e) {
        // jwt only reports expiry once the signature checked out, so the claims
        // are ours: an expired trial says "trial over", not "invalid licence".
        const claims = e && e.name === 'TokenExpiredError' ? jwt.decode(lic.token) : null;
        return { activated: false, reason: claims && claims.kind === 'trial' ? 'trial_expired' : 'expired', ...base };
    }
}

// ── Mirror the server's office profile into local config ──
// The letterhead details are stored on the license server (entered on the first
// device, kept in sync by pushProfile on every local edit). When the server
// hands them back — on activation of a new machine, or on re-validation — we
// write them into config.json and mark onboarding done, so the customer never
// has to re-type their office details on another device.
function applyRemoteDetails(details) {
    if (!details || typeof details !== 'object') return;
    const patch = {};
    let hasAny = false;
    for (const k of OFFICE_FIELDS) {
        if (typeof details[k] === 'string') {
            patch[k] = details[k];
            if (details[k]) hasAny = true;
        }
    }
    if (!hasAny) return;          // nothing on file → let first-run onboarding run normally
    patch.onboardingDone = true; // details already exist for this license → skip re-entry
    try { updateConfig(patch); } catch (e) { /* best-effort */ }
}

// ── Activate a license key against the server (binds this machine) ──
async function activate(licenseKey) {
    const fp = fingerprint();
    const res = await fetch(`${serverUrl()}/api/activate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: String(licenseKey || '').trim(), fingerprint: fp, appVersion: APP_VERSION }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 403 && d.reason === 'moved_to_cloud') {
        markMoved({ url: d.cloudUrl, at: d.movedAt, providerContact: d.providerContact, licenseKey: String(licenseKey || '').trim() });
        throw new Error(`تم نقل مكتبكم إلى السحابة. ${isHttps(d.cloudUrl) ? 'افتحوا التطبيق على: ' + d.cloudUrl : 'تواصلوا مع المزوّد.'}`);
    }
    if (!res.ok) throw new Error(d.error || 'فشل التفعيل. تحقّق من المفتاح والاتصال بالإنترنت.');
    save({
        licenseKey: String(licenseKey).trim(), token: d.token, fingerprint: fp, lastValidated: Date.now(),
        providerContact: d.providerContact || '',
    });
    applyRemoteDetails(d.details); // pull the office profile saved on this license (no re-entry on a new device)
    // Pull the office's shared records now, so a freshly-activated device opens
    // up populated (launch-time pull ran before this machine had a token).
    // Lazy require avoids a load-time cycle with sync.js. Best-effort.
    try { await require('./sync').pull(); } catch (e) { /* offline: launch pull / manual sync will catch up */ }
    return getStatus();
}

// ── Re-validation on every launch (honours revocation / transfer / trial end). ──
// The server accepts an expired token here, so a trial that was extended or
// converted to a paid licence unlocks on the next launch — no key re-typing.
// Never throws; offline or 5xx keeps the current token (grace until it expires).
async function revalidate() {
    const lic = load();
    if (!lic.token) {
        // Moved before this PC ever got a token (activation was refused): after an
        // undo only a fresh activation can unlock it. 403 moved keeps it locked;
        // offline or any other failure leaves everything as it was.
        if (lic.licenseKey && lic.movedToCloud) {
            try {
                await activate(lic.licenseKey);
                try { require('./sync').resume(); } catch (e) { /* best-effort */ }
            } catch (e) { /* still moved / offline / refused: unchanged */ }
        }
        return;
    }
    try {
        const res = await fetch(`${serverUrl()}/api/validate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: lic.token, fingerprint: fingerprint() }),
            signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
        });
        const d = await res.json().catch(() => ({}));
        if (res.status === 403) {
            const providerContact = d.providerContact || lic.providerContact || '';
            // Moved to the cloud: keep key + token (an undo unlocks on the next good validate).
            if (d.reason === 'moved_to_cloud') { markMoved({ url: d.cloudUrl, at: d.movedAt, providerContact }); return; }
            // Trial over: keep the key + token so the lock screen can offer
            // "check again" once the customer has paid.
            if (d.reason === 'trial_expired') { save({ ...lic, trialExpired: true, providerContact }); return; }
            // Revoked or machine freed → re-activate; keep the key to pre-fill it.
            save({ licenseKey: lic.licenseKey, providerContact });
            return;
        }
        if (res.ok && d.token) {
            const { trialExpired, movedToCloud, ...rest } = lic;
            save({ ...rest, token: d.token, lastValidated: Date.now(), providerContact: d.providerContact || lic.providerContact || '' });
            applyRemoteDetails(d.details); // keep letterhead in sync across the customer's devices
            if (movedToCloud) { try { require('./sync').resume(); } catch (e) { /* best-effort */ } } // undo: pushing may resume
        }
    } catch (e) { /* offline: keep token */ }
}

// ── Forgotten office password: ask the provider, then set a new one once ──
// The password never leaves this PC; the server only holds the admin's
// permission, so a stranger at the login screen can't reset it on their own.
async function deviceCall(pathname) {
    const lic = load();
    if (!lic.token) throw new Error('التطبيق غير مُفعّل.');
    const res = await fetch(`${serverUrl()}${pathname}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: lic.token, fingerprint: fingerprint() }),
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
}
const passwordResetRequest = () => deviceCall('/api/password-reset/request');
const passwordResetStatus = () => deviceCall('/api/password-reset/status');
const passwordResetConsume = () => deviceCall('/api/password-reset/consume');

// ── Word import: ask the licence server where the case data sits in an act ──
// Sends only numbered text blocks, never the file. Throws with an Arabic message.
async function templateMap(blocks) {
    const ctx = activationContext();
    const res = await fetch(`${serverUrl()}/api/ai/template-map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ctx, blocks }),
        signal: AbortSignal.timeout(TEMPLATE_MAP_TIMEOUT_MS),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.mapping) throw new Error(d.error || 'تعذّر الاتصال بخادم الترخيص.');
    return d.mapping;
}
const TEMPLATE_MAP_TIMEOUT_MS = 120000; // reading a whole act takes the model a while

// ── Leave the licence ("logout" on the password screen) ──
// Disconnects this PC from its key so another key can be activated (e.g. the
// seller's demo key, or an office that forgot its password). In order:
//   1. the customer re-types the key — a stranger at the PC can't disconnect it;
//   2. last push, so the server holds the latest records (best-effort);
//   3. the server frees this PC's seat (best-effort; the admin can free it too);
//   4. this office's local files move to backups/<time>_<key>/ — never deleted —
//      and the app starts empty, so the next licence never sees them. Re-activating
//      the same key brings the records back from the server.
const OFFICE_FILES = ['cnss.db', 'cnss.db-wal', 'cnss.db-shm', 'license.json', 'sync.json',
    'template_cnss.docx', 'template_list.docx', 'word_import'];

async function leave(typedKey) {
    const lic = load();
    const key = String(lic.licenseKey || '').trim().toUpperCase();
    if (!key) throw new Error('لا يوجد ترخيص مفعّل على هذا الجهاز.');
    if (String(typedKey || '').trim().toUpperCase() !== key) {
        throw new Error('مفتاح الترخيص غير مطابق للمفتاح المفعّل على هذا الجهاز.');
    }

    const sync = require('./sync'); // lazy: sync.js requires this module
    const synced = await sync.flush();

    let seatFreed = false;
    if (lic.token) {
        try {
            const res = await fetch(`${serverUrl()}/api/deactivate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: lic.token, fingerprint: fingerprint(), licenseKey: key }),
                signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
            });
            seatFreed = res.ok;
        } catch (e) { /* offline: the seat stays taken until the admin frees it */ }
    }

    sync.cancelPending();
    require('./db').close();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(dataDir(), 'backups', `${stamp}_${key}`);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(path.join(dataDir(), 'config.json'), path.join(backupDir, 'config.json'));
    for (const f of OFFICE_FILES) {
        const src = path.join(dataDir(), f);
        if (fs.existsSync(src)) fs.renameSync(src, path.join(backupDir, f));
    }
    require('./config').resetForNewLicence();

    return { ok: true, synced, seatFreed, backupDir };
}

// ── Report the office profile to the license server (best-effort) ──
async function pushProfile(details) {
    const lic = load();
    if (!lic.token) return { ok: false };
    try {
        const res = await fetch(`${serverUrl()}/api/profile`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: lic.token, fingerprint: fingerprint(), details: details || {} }),
        });
        return { ok: res.ok };
    } catch (e) { return { ok: false }; }
}

// ── Context the AI proxy needs (throws if not activated) ──
function activationContext() {
    const lic = load();
    const status = getStatus();
    if (!lic.token || !status.activated) {
        const err = new Error('التطبيق غير مُفعّل. أدخل مفتاح الترخيص في شاشة التفعيل.');
        err.code = 'NOT_ACTIVATED';
        throw err;
    }
    return { token: lic.token, fingerprint: fingerprint() };
}

module.exports = {
    fingerprint, getStatus, load, markMoved, clearMoved, isMoved, activate, revalidate, activationContext, pushProfile, serverUrl, leave,
    passwordResetRequest, passwordResetStatus, passwordResetConsume, templateMap,
};
