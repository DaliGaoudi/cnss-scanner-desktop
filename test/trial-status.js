/*
 * The desktop side of trial licences, offline: how server/license.js reads a
 * trial token, locks once it has expired, and unlocks again when the licence
 * server re-issues a token (trial extended / converted to paid).
 *
 * Tokens are signed with the licence server's real private key (read from the
 * sibling checkout, never shipped) because the app only trusts its embedded
 * public key. The licence server itself is a local stand-in, so nothing here
 * touches production.
 *
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\trial-status.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.CNSS_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-trial-'));
const KEY_FILE = path.join(__dirname, '..', '..', 'cnss-license-server', 'keys', 'private.pem');
if (!fs.existsSync(KEY_FILE)) { console.log('SKIP: no licence-server private key at', KEY_FILE); process.exit(0); }
const PRIVATE_KEY = fs.readFileSync(KEY_FILE, 'utf8');

const license = require('../server/license');
const { updateConfig } = require('../server/config');
const LICENSE_FILE = path.join(process.env.CNSS_USERDATA, 'license.json');

const fp = license.fingerprint();
const sign = (claims, expiresIn) => jwt.sign({ typ: 'activation', lic: 'CNSS-TEST', fp, customer: 'تجربة', ...claims },
    PRIVATE_KEY, { algorithm: 'RS256', ...(expiresIn ? { expiresIn } : {}) });
const expired = (claims) => sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 });
const store = (obj) => fs.writeFileSync(LICENSE_FILE, JSON.stringify(obj));
const stored = () => JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));

// Local stand-in for /api/validate: answers whatever the current test sets.
let reply = { status: 200, body: {} };
const fake = http.createServer((req, res) => {
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
});

let passed = 0;
const steps = [];
const test = (name, fn) => steps.push([name, fn]);

test('a running trial is activated and reports its end date', () => {
    store({ licenseKey: 'CNSS-TEST', token: sign({ kind: 'trial' }, 3 * 86400) });
    const s = license.getStatus();
    assert.strictEqual(s.activated, true);
    assert.strictEqual(s.kind, 'trial');
    assert.ok(new Date(s.expiresAt).getTime() > Date.now() + 2.9 * 86400000);
});
test('a paid licence has no end date', () => {
    store({ licenseKey: 'CNSS-TEST', token: sign({ kind: 'paid' }, '400d') });
    const s = license.getStatus();
    assert.strictEqual(s.kind, 'paid');
    assert.strictEqual(s.expiresAt, null);
});
test('a token from before trials existed (no kind) counts as paid', () => {
    store({ licenseKey: 'CNSS-TEST', token: sign({}, '400d') });
    assert.strictEqual(license.getStatus().kind, 'paid');
});
test('an expired trial locks with reason trial_expired, offline, keeping the key', () => {
    store({ licenseKey: 'CNSS-TEST', token: expired({ kind: 'trial' }), providerContact: '98 000 000' });
    const s = license.getStatus();
    assert.strictEqual(s.activated, false);
    assert.strictEqual(s.reason, 'trial_expired');
    assert.strictEqual(s.licenseKey, 'CNSS-TEST');
    assert.strictEqual(s.providerContact, '98 000 000');
});
test('an expired paid token is plain "expired", not a trial', () => {
    store({ licenseKey: 'CNSS-TEST', token: expired({ kind: 'paid' }) });
    assert.strictEqual(license.getStatus().reason, 'expired');
});
test('the AI proxy context refuses an expired trial', () => {
    store({ licenseKey: 'CNSS-TEST', token: expired({ kind: 'trial' }) });
    assert.throws(() => license.activationContext(), (e) => e.code === 'NOT_ACTIVATED');
});
test('server says trial over: token kept, app locked, contact saved', async () => {
    store({ licenseKey: 'CNSS-TEST', token: sign({ kind: 'trial' }, 3600) });
    reply = { status: 403, body: { ok: false, reason: 'trial_expired', providerContact: '98 111 111' } };
    await license.revalidate();
    const s = license.getStatus();
    assert.strictEqual(s.activated, false);
    assert.strictEqual(s.reason, 'trial_expired');
    assert.ok(stored().token, 'token kept for "check again"');
    assert.strictEqual(s.providerContact, '98 111 111');
});
test('converted to paid: revalidate swaps in the new token and unlocks', async () => {
    reply = { status: 200, body: { ok: true, token: sign({ kind: 'paid' }, '400d'), details: null } };
    await license.revalidate();
    const s = license.getStatus();
    assert.strictEqual(s.activated, true);
    assert.strictEqual(s.kind, 'paid');
    assert.strictEqual(stored().trialExpired, undefined);
});
test('revoked: the token goes, the key stays to pre-fill re-activation', async () => {
    reply = { status: 403, body: { ok: false, reason: 'revoked' } };
    await license.revalidate();
    assert.strictEqual(stored().token, undefined);
    const s = license.getStatus();
    assert.strictEqual(s.activated, false);
    assert.strictEqual(s.licenseKey, 'CNSS-TEST');
});
test('offline / server error: nothing changes', async () => {
    store({ licenseKey: 'CNSS-TEST', token: sign({ kind: 'trial' }, 3600) });
    reply = { status: 500, body: {} };
    await license.revalidate();
    assert.strictEqual(license.getStatus().activated, true);
});

fake.listen(0, '127.0.0.1', async () => {
    updateConfig({ licenseServerUrl: `http://127.0.0.1:${fake.address().port}` });
    for (const [name, fn] of steps) {
        try { await fn(); passed++; console.log(`  ✓ ${name}`); }
        catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fake.close(); process.exit(1); }
    }
    fake.close();
    console.log(`\n${passed} passed.`);
});
