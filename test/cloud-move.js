/*
 * A licence moved to the cloud, end to end on a throwaway install:
 *   - a validate that answers 403 moved_to_cloud locks the app but keeps the token;
 *   - the local API answers 423 except licence status/refresh and health;
 *   - a push answered 410 locks too and stops all further pushes;
 *   - a later good validate (undo) unlocks AND resumes pushing;
 *   - a licence server that is down never locks anything.
 * The licence server is a local stand-in, so nothing touches production.
 *
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\cloud-move.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-move-'));
process.env.CNSS_USERDATA = DATA;
const KEY_FILE = path.join(__dirname, '..', '..', 'cnss-license-server', 'keys', 'private.pem');
if (!fs.existsSync(KEY_FILE)) { console.log('SKIP: no licence-server private key at', KEY_FILE); process.exit(0); }

const license = require('../server/license');
const config = require('../server/config');
const LICENCE = 'CNSS-TEST-MOVE-0001';
const CLOUD = 'https://c.tn';
const token = jwt.sign({ typ: 'activation', lic: LICENCE, fp: license.fingerprint(), customer: 'مكتب', kind: 'paid' },
    fs.readFileSync(KEY_FILE, 'utf8'), { algorithm: 'RS256', expiresIn: '400d' });

// ── stand-in licence server with a mode switch ──
//   ok     → validate 200 (fresh token), push 200
//   moved  → validate 403 moved_to_cloud
//   gone   → validate 200, push 410
let mode = 'ok';
const calls = [];
const pushCount = () => calls.filter((c) => c === '/api/data/push').length;
const fake = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
        calls.push(req.url);
        const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/api/validate') {
            if (mode === 'moved') {
                return send(403, { ok: false, reason: 'moved_to_cloud', cloudUrl: CLOUD, movedAt: '2026-10-11T10:00:00.000Z', providerContact: '+216 29 484 700' });
            }
            return send(200, { ok: true, token, providerContact: '+216 29 484 700' });
        }
        if (req.url === '/api/activate') {
            return send(403, { ok: false, reason: 'moved_to_cloud', cloudUrl: CLOUD, movedAt: '2026-10-11T10:00:00.000Z', error: 'x' });
        }
        if (req.url === '/api/data/push') {
            return mode === 'gone' ? send(410, { movedToCloud: true, cloudUrl: CLOUD }) : send(200, { ok: true, version: 1 });
        }
        if (req.url === '/api/data/pull') return send(200, { version: 0, data: null });
        return send(404, {});
    });
});
const listen = (port) => new Promise((r) => fake.listen(port, '127.0.0.1', r));
const unlisten = () => new Promise((r) => fake.close(r));

let base;
const local = async (method, p) => {
    const r = await fetch(base + p, { method });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};
const sync = () => require('../server/sync');

let passed = 0;
const steps = [];
const test = (name, fn) => steps.push([name, fn]);

test('set up: an activated office', async () => {
    fs.writeFileSync(path.join(DATA, 'license.json'), JSON.stringify({ licenseKey: LICENCE, token }));
    assert.strictEqual(license.getStatus().activated, true);
    assert.strictEqual(license.isMoved(), null);
});

// ── fail open ──
test('licence server down: revalidate changes nothing and nothing locks', async () => {
    const port = fake.address().port;
    await unlisten();
    await license.revalidate();
    assert.strictEqual(license.isMoved(), null);
    assert.strictEqual(license.getStatus().activated, true);
    assert.strictEqual((await local('GET', '/api/settings/public')).status, 200, 'local API still answers');
    await listen(port);
});

// ── 410 on push ──
test('a push answered 410 locks the office and the next push makes no request', async () => {
    mode = 'gone';
    const before = pushCount();
    await sync().push();
    assert.strictEqual(pushCount(), before + 1, 'the first push reached the server');
    assert.strictEqual(license.isMoved().url, CLOUD);
    assert.ok(license.load().token, 'token kept');
    assert.strictEqual(license.getStatus().reason, 'moved_to_cloud');
    await sync().push();
    await sync().push();
    assert.strictEqual(pushCount(), before + 1, 'no further push request while moved');
});

// ── undo ──
test('undo: a good validate unlocks and pushing resumes', async () => {
    mode = 'ok';
    await license.revalidate();
    assert.strictEqual(license.isMoved(), null);
    assert.strictEqual(license.getStatus().activated, true);
    const before = pushCount();
    await sync().push();
    assert.strictEqual(pushCount(), before + 1, 'push request is made again');
});

// ── 403 on validate ──
test('validate answered 403 moved_to_cloud: locked, token and key kept, provider phone shown', async () => {
    mode = 'moved';
    await license.revalidate();
    assert.strictEqual(license.isMoved().url, CLOUD);
    assert.strictEqual(license.isMoved().at, '2026-10-11T10:00:00.000Z');
    assert.ok(license.load().token, 'token kept');
    assert.strictEqual(license.load().licenseKey, LICENCE, 'key kept');
    const st = license.getStatus();
    assert.strictEqual(st.activated, false);
    assert.strictEqual(st.reason, 'moved_to_cloud');
    assert.deepStrictEqual(st.movedToCloud, { url: CLOUD, at: '2026-10-11T10:00:00.000Z' });
    assert.strictEqual(st.licenseKey, LICENCE);
    assert.strictEqual(st.providerContact, '+216 29 484 700');
});

test('while moved: local API answers 423, except licence status and health', async () => {
    const r = await local('GET', '/api/cnss');
    assert.strictEqual(r.status, 423);
    assert.deepStrictEqual(r.body, { code: 'moved_to_cloud', cloudUrl: CLOUD });
    assert.strictEqual((await local('POST', '/api/cnss')).status, 423, 'writes too');
    assert.strictEqual((await local('POST', '/api/auth/login')).status, 423);
    const st = await local('GET', '/api/license/status');
    assert.strictEqual(st.status, 200);
    assert.strictEqual(st.body.reason, 'moved_to_cloud');
    assert.strictEqual((await local('GET', '/api/health')).status, 200);
});

test('while moved: no push request is made', async () => {
    const before = pushCount();
    await sync().push();
    assert.strictEqual(pushCount(), before);
});

test('/api/license/refresh stays open and unlocks once the move is undone', async () => {
    mode = 'ok';
    const r = await local('POST', '/api/license/refresh');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.activated, true);
    assert.strictEqual(license.isMoved(), null);
    assert.strictEqual((await local('GET', '/api/license/status')).body.activated, true);
});

test('a moved office that was 410-locked unlocks and resumes after the undo (flag reset)', async () => {
    mode = 'gone';
    await sync().push();
    assert.ok(license.isMoved());
    mode = 'ok';
    await license.revalidate();
    const before = pushCount();
    await sync().push();
    assert.strictEqual(pushCount(), before + 1);
});

test('activation refused with 403 moved_to_cloud saves the moved state and explains where to go', async () => {
    fs.writeFileSync(path.join(DATA, 'license.json'), JSON.stringify({ licenseKey: LICENCE, token }));
    mode = 'moved';
    await assert.rejects(() => license.activate(LICENCE), (e) => e.message.includes(CLOUD));
    assert.strictEqual(license.isMoved().url, CLOUD);
    assert.strictEqual(license.getStatus().reason, 'moved_to_cloud');
});

const { startServer } = require('../server/index.js');
listen(0).then(async () => {
    config.updateConfig({ licenseServerUrl: `http://127.0.0.1:${fake.address().port}` });
    const server = await startServer({ port: 0 });
    base = `http://127.0.0.1:${server.address().port}`;
    await new Promise((r) => setTimeout(r, 400)); // let the launch-time revalidate/pull settle
    for (const [name, fn] of steps) {
        try { await fn(); passed++; console.log(`  ✓ ${name}`); }
        catch (e) { console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); server.close(); fake.close(); process.exit(1); }
    }
    server.close(); fake.close();
    console.log(`\n${passed} passed.`);
    process.exit(0);
});
