/*
 * The two exits from the password screen, end to end on a throwaway install:
 *   - leaving the licence ("logout"): key confirmation, last sync, seat freed,
 *     the office's files moved to a backup, the app started empty;
 *   - forgotten password: request → provider approval → new password, once.
 * The licence server is a local stand-in, so nothing touches production.
 *
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\leave-and-reset.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-leave-'));
process.env.CNSS_USERDATA = DATA;
const KEY_FILE = path.join(__dirname, '..', '..', 'cnss-license-server', 'keys', 'private.pem');
if (!fs.existsSync(KEY_FILE)) { console.log('SKIP: no licence-server private key at', KEY_FILE); process.exit(0); }

const license = require('../server/license');
const config = require('../server/config');
const LICENCE = 'CNSS-TEST-LEAV-E001';
const token = jwt.sign({ typ: 'activation', lic: LICENCE, fp: license.fingerprint(), customer: 'مكتب', kind: 'paid' },
    fs.readFileSync(KEY_FILE, 'utf8'), { algorithm: 'RS256', expiresIn: '400d' });

// ── stand-in licence server ──
const calls = [];
let resetState = 'none';
let snapshotVersion = 7;
const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
        const b = body ? JSON.parse(body) : {};
        calls.push({ url: req.url, body: b });
        const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/api/data/push') { snapshotVersion += 1; return send(200, { ok: true, version: snapshotVersion }); }
        if (req.url === '/api/data/pull') return send(200, { version: 0, data: null });
        if (req.url === '/api/deactivate') return send(b.licenseKey === LICENCE ? 200 : 403, { ok: b.licenseKey === LICENCE });
        if (req.url === '/api/password-reset/request') { resetState = 'pending'; return send(200, { state: resetState, providerContact: '+216 29 484 700' }); }
        if (req.url === '/api/password-reset/status') return send(200, { state: resetState });
        if (req.url === '/api/password-reset/consume') {
            if (resetState !== 'approved') return send(409, { error: 'لا توجد موافقة صالحة' });
            resetState = 'none';
            return send(200, { ok: true });
        }
        return send(404, {});
    });
});

let base;
const local = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};
const login = (password) => local('POST', '/api/auth/login', { password });

let passed = 0;
const steps = [];
const test = (name, fn) => steps.push([name, fn]);

test('set up: an activated office with a record and its own password', async () => {
    fs.writeFileSync(path.join(DATA, 'license.json'), JSON.stringify({ licenseKey: LICENCE, token }));
    config.updateConfig({ onboardingDone: true, officeName: 'مكتب قديم', officeJurisdiction: 'لمحكمة الإستئناف بسوسة' });
    config.setPassword('old-secret');
    const t = (await login('old-secret')).body.token;
    const r = await fetch(base + '/api/cnss', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ nom_cl2: 'SARL A', numcnss: '1' }),
    });
    assert.strictEqual(r.status, 200);
});

test('the login screen hides the password once a real one is set', async () => {
    assert.strictEqual((await local('GET', '/api/settings/public')).body.defaultPassword, null);
});

// ── forgotten password ──
test('the new password cannot be set before the provider approves', async () => {
    const r = await local('POST', '/api/license/password-reset/complete', { password: 'new-secret' });
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await login('old-secret')).status, 200, 'old password unchanged');
});
test('requesting reports pending with the provider phone', async () => {
    const r = await local('POST', '/api/license/password-reset/request');
    assert.deepStrictEqual([r.body.state, r.body.providerContact], ['pending', '+216 29 484 700']);
    assert.strictEqual((await local('GET', '/api/license/password-reset/status')).body.state, 'pending');
});
test('after approval: too-short password refused, then the new one works and the old one stops', async () => {
    resetState = 'approved';
    assert.strictEqual((await local('POST', '/api/license/password-reset/complete', { password: 'ab' })).status, 400);
    assert.strictEqual(resetState, 'approved', 'a refused short password does not spend the approval');
    const r = await local('POST', '/api/license/password-reset/complete', { password: 'new-secret' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await login('new-secret')).status, 200);
    assert.strictEqual((await login('old-secret')).status, 401);
});
test('the approval is single-use', async () => {
    assert.strictEqual((await local('POST', '/api/license/password-reset/complete', { password: 'third-one' })).status, 409);
    assert.strictEqual((await login('new-secret')).status, 200);
});

// ── leaving the licence ──
test('leaving with the wrong key changes nothing', async () => {
    const r = await local('POST', '/api/license/leave', { licenseKey: 'CNSS-NOPE-NOPE-NOPE' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(license.getStatus().activated, true);
    assert.ok(!calls.some((c) => c.url === '/api/deactivate'), 'server not even asked');
});
test('leaving with the right key: synced, seat freed, files backed up, app empty and back to activation', async () => {
    const r = await local('POST', '/api/license/leave', { licenseKey: LICENCE.toLowerCase() });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.synced, true);
    assert.strictEqual(r.body.seatFreed, true);
    const push = calls.filter((c) => c.url === '/api/data/push').pop();
    assert.strictEqual(push.body.data.cnss.length, 1, 'the last push carried the record');

    for (const f of ['cnss.db', 'license.json', 'config.json']) assert.ok(fs.existsSync(path.join(r.body.backupDir, f)), 'backup has ' + f);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(r.body.backupDir, 'config.json'), 'utf8')).officeName, 'مكتب قديم');

    assert.strictEqual(license.getStatus().activated, false);
    const gate = (await local('GET', '/api/onboarding/status')).body;
    assert.strictEqual(gate.activated, false);
    assert.strictEqual(gate.onboardingDone, false);
    assert.strictEqual(gate.profile.officeName, '');
    assert.strictEqual(gate.profile.officeJurisdiction, '', 'no Sousse defaults on a fresh start');
    assert.strictEqual((await login(config.DEFAULT_PASSWORD)).status, 200, 'password back to the default');
    assert.strictEqual((await local('GET', '/api/settings/public')).body.defaultPassword, config.DEFAULT_PASSWORD,
        'and the login screen says what it is');
});
test('the next licence starts with an empty register', async () => {
    const t = (await login(config.DEFAULT_PASSWORD)).body.token;
    const list = await (await fetch(base + '/api/cnss', { headers: { Authorization: `Bearer ${t}` } })).json();
    assert.strictEqual(list.total, 0);
});

const { startServer } = require('../server/index.js');
fake.listen(0, '127.0.0.1', async () => {
    config.updateConfig({ licenseServerUrl: `http://127.0.0.1:${fake.address().port}` });
    const server = await startServer({ port: 0 });
    base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, fn] of steps) {
        try { await fn(); passed++; console.log(`  ✓ ${name}`); }
        catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); server.close(); fake.close(); process.exit(1); }
    }
    server.close(); fake.close();
    console.log(`\n${passed} passed.`);
    process.exit(0);
});
