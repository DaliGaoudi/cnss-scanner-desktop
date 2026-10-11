/*
 * Word-import templates travel with the licence, end to end on a throwaway install:
 *   - per template, config remembers the sha both sides last agreed on (B); at launch
 *     L (local) / S (server) / B tell who changed what: an unpushed local change is
 *     uploaded, never overwritten; a failed delete does not come back; a server
 *     change is downloaded; both changed → newer wins; the loser is backed up;
 *   - «اعتماد» pushes both kinds, «العودة للشكل القياسي» pushes null for both,
 *     Settings → upload/remove the act template pushes the act;
 *   - best-effort: server down / 5xx / 410 never throw, never touch local files;
 *   - a pending Word import (word_import/pending/) is never touched.
 * The licence server is a local stand-in, so nothing touches production.
 *
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\template-sync.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const PizZip = require('pizzip');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-tplsync-'));
process.env.CNSS_USERDATA = DATA;
const KEY_FILE = path.join(__dirname, '..', '..', 'cnss-license-server', 'keys', 'private.pem');
if (!fs.existsSync(KEY_FILE)) { console.log('SKIP: no licence-server private key at', KEY_FILE); process.exit(0); }

const license = require('../server/license');
const config = require('../server/config');
const LICENCE = 'CNSS-TEST-TPLS-0001';
const token = jwt.sign({ typ: 'activation', lic: LICENCE, fp: license.fingerprint(), customer: 'مكتب', kind: 'paid' },
    fs.readFileSync(KEY_FILE, 'utf8'), { algorithm: 'RS256', expiresIn: '400d' });

// ── three distinct, valid .docx byte strings ──
const makeDocx = (label) => {
    const z = new PizZip();
    z.file('[Content_Types].xml', '<Types/>');
    z.file('word/document.xml', `<w:document>${label}</w:document>`);
    return z.generate({ type: 'nodebuffer' });
};
const A = makeDocx('A'); const B = makeDocx('B'); const P = makeDocx('PENDING');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ── stand-in licence server: templates held in memory ──
//   mode ok    → normal
//   mode error → every template call answers 500
//   mode gone  → every template call answers 410 moved
let mode = 'ok';
const store = { act: null, list: null };
let calls = [];           // [{ url, body }]
let tamper = null;        // when set, /pull/:kind answers these bytes under the old sha
const uploadedAt = { act: '2026-10-11T10:00:00.000Z', list: '2026-10-11T10:00:00.000Z' };
const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; }).on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/api/validate') return send(200, { ok: true, token, providerContact: '+216 29 484 700' });
        if (req.url === '/api/data/pull') return send(200, { version: 0, data: null });
        if (!req.url.startsWith('/api/templates/')) return send(404, {});
        calls.push({ url: req.url, body });
        if (mode === 'error') return send(500, { error: 'boom' });
        if (mode === 'gone') return send(410, { movedToCloud: true, cloudUrl: 'https://c.tn' });
        if (!body.token || !body.fingerprint) return send(400, { error: 'no auth' });
        if (req.url === '/api/templates/push') {
            if (!['act', 'list'].includes(body.kind)) return send(400, { error: 'kind' });
            if (body.docxBase64 === null) { store[body.kind] = null; return send(200, { ok: true, sha256: null }); }
            store[body.kind] = Buffer.from(body.docxBase64, 'base64');
            uploadedAt[body.kind] = new Date().toISOString();
            return send(200, { ok: true, sha256: sha(store[body.kind]) });
        }
        if (req.url === '/api/templates/pull') {
            const templates = ['act', 'list'].filter((k) => store[k]).map((k) => ({ kind: k, sha256: sha(store[k]), size: store[k].length, uploadedAt: uploadedAt[k] }));
            return send(200, { templates });
        }
        const m = req.url.match(/^\/api\/templates\/pull\/(act|list)$/);
        if (m) {
            const buf = store[m[1]];
            if (!buf) return send(404, { error: 'none' });
            return send(200, { kind: m[1], sha256: sha(buf), docxBase64: (tamper || buf).toString('base64') });
        }
        return send(404, {});
    });
});
const listen = (port) => new Promise((r) => fake.listen(port, '127.0.0.1', r));
const unlisten = () => new Promise((r) => fake.close(r));
const templateCalls = () => calls.filter((c) => c.url.startsWith('/api/templates/'));
const pushes = () => calls.filter((c) => c.url === '/api/templates/push');

// ── local state helpers ──
const ACT = () => config.templatePath();
const LIST = () => config.listTemplatePath();
const PENDING = () => path.join(config.importDir(), 'pending', 'act.docx');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
const eq = (a, b) => (a === null || b === null ? a === b : Buffer.compare(a, b) === 0);
const rm = (p) => fs.rmSync(p, { force: true });
const BACKUPS = () => path.join(DATA, 'backups', 'templates');
const backups = () => (fs.existsSync(BACKUPS()) ? fs.readdirSync(BACKUPS()).sort().map((f) => ({ f, buf: fs.readFileSync(path.join(BACKUPS(), f)) })) : []);
const hasBackup = (buf, kind) => backups().some((b) => eq(b.buf, buf) && b.f.includes(`_${kind}`));
const syncedSha = (kind) => { const e = (config.getConfig().templateSync || {})[kind]; return e ? e.lastSyncedSha : undefined; };
const setSynced = (kind, buf) => config.updateConfig({ templateSync: { ...(config.getConfig().templateSync || {}), [kind]: { lastSyncedSha: buf ? sha(buf) : null } } });
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';
const tpl = () => require('../server/templateSync');
const waitFor = async (cond, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return cond();
};
// A clean slate for each scenario; the pending import (P) is planted every time.
function reset() {
    rm(ACT()); rm(LIST());
    store.act = null; store.list = null; tamper = null; mode = 'ok'; calls = [];
    config.updateConfig({ templateSync: {} });
    uploadedAt.act = uploadedAt.list = '2026-10-11T10:00:00.000Z';
    fs.rmSync(BACKUPS(), { recursive: true, force: true });
    license.clearMoved();
    fs.mkdirSync(path.dirname(PENDING()), { recursive: true });
    fs.writeFileSync(PENDING(), P);
}
const assertPendingIntact = () => assert.ok(eq(read(PENDING()), P), 'word_import/pending/act.docx byte-identical');

let passed = 0;
const steps = [];
const test = (name, fn) => steps.push([name, fn]);

// ── syncOnLaunch ──
test('server has an act, PC has none: downloaded, local file === server bytes', async () => {
    reset(); store.act = A;
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: ['act'], uploaded: [], deleted: [] });
    assert.ok(eq(read(ACT()), A));
    assert.strictEqual(read(LIST()), null, 'no list on either side stays absent');
    assert.strictEqual(syncedSha('act'), sha(A), 'remembered after the confirmed download');
    assert.strictEqual(backups().length, 0, 'nothing local to back up');
    assertPendingIntact();
});

test('never synced, server has a different act: it is downloaded and the local one is backed up first', async () => {
    reset(); store.act = A; fs.writeFileSync(ACT(), B);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r.downloaded, ['act']);
    assert.ok(eq(read(ACT()), A));
    assert.ok(hasBackup(B, 'act'), 'the replaced local act is in backups/templates');
    assert.strictEqual(syncedSha('act'), sha(A));
    assertPendingIntact();
});

test('same bytes on both sides: nothing downloaded or uploaded', async () => {
    reset(); store.act = A; fs.writeFileSync(ACT(), A);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: [], deleted: [] });
    assert.strictEqual(calls.filter((c) => c.url.startsWith('/api/templates/pull/')).length, 0, 'no download request');
    assert.strictEqual(pushes().length, 0);
    assert.strictEqual(syncedSha('act'), sha(A), 'agreement remembered');
    assert.strictEqual(syncedSha('list'), null);
});

test('server has none, PC has an act, never synced: one upload (backfill)', async () => {
    reset(); fs.writeFileSync(ACT(), A);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: ['act'], deleted: [] });
    assert.ok(eq(store.act, A), 'the stand-in now holds it');
    assert.ok(eq(read(ACT()), A), 'local file kept');
    assert.strictEqual(pushes().length, 1);
    assert.strictEqual(pushes()[0].body.kind, 'act');
    assert.strictEqual(syncedSha('act'), sha(A), 'remembered after the confirmed upload');
    // and only once: the next launch finds both sides equal
    calls = [];
    assert.deepStrictEqual(await tpl().syncOnLaunch(), { downloaded: [], uploaded: [], deleted: [] });
    assert.strictEqual(pushes().length, 0);
    assertPendingIntact();
});

test('server lost a template this PC had in sync: the local file is removed after a backup (server-side deletion)', async () => {
    reset(); fs.writeFileSync(ACT(), A); fs.writeFileSync(LIST(), B);
    setSynced('act', A); setSynced('list', B);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: [], deleted: ['act', 'list'] });
    assert.strictEqual(read(ACT()), null);
    assert.strictEqual(read(LIST()), null);
    assert.ok(hasBackup(A, 'act') && hasBackup(B, 'list'), 'both backed up before removal');
    assert.strictEqual(syncedSha('act'), null);
    assert.strictEqual(pushes().length, 0, 'nothing uploaded');
    assertPendingIntact();
});

test('kinds are independent: act downloaded, list backfilled in the same launch', async () => {
    reset(); store.act = A; fs.writeFileSync(LIST(), B);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual([r.downloaded, r.uploaded, r.deleted], [['act'], ['list'], []]);
    assert.ok(eq(read(ACT()), A));
    assert.ok(eq(store.list, B));
});

test('the pending Word import is untouched even when the server has a different act', async () => {
    reset(); store.act = A; store.list = B;
    await tpl().syncOnLaunch();
    assertPendingIntact();
    assert.ok(!fs.existsSync(path.join(config.importDir(), 'pending', 'list.docx')), 'nothing added to pending either');
});

test('a download that is not the announced file (wrong sha / not a docx) is ignored', async () => {
    reset(); store.act = A; fs.writeFileSync(ACT(), B);
    tamper = Buffer.from('not a zip at all');
    let r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r.downloaded, []);
    assert.ok(eq(read(ACT()), B), 'local file unchanged');
    tamper = makeDocx('SOMETHING ELSE'); // a valid docx, but not the bytes whose sha was announced
    r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r.downloaded, []);
    assert.ok(eq(read(ACT()), B), 'local file unchanged');
    assert.strictEqual(syncedSha('act'), undefined, 'nothing remembered');
    assert.strictEqual(backups().length, 0, 'nothing overwritten, nothing backed up');
});

// ── who changed what (B = the sha both sides last agreed on) ──
test('server V1, local V2 unpushed (B=V1): V2 is uploaded, the local file is untouched', async () => {
    reset(); store.act = A; fs.writeFileSync(ACT(), B); setSynced('act', A);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: ['act'], deleted: [] });
    assert.ok(eq(read(ACT()), B), 'local V2 untouched');
    assert.ok(eq(store.act, B), 'server now holds V2');
    assert.strictEqual(syncedSha('act'), sha(B));
    assert.strictEqual(backups().length, 0);
});

test('local was removed offline (B=V1, server still V1): null is pushed and the template does not come back', async () => {
    reset(); store.act = A; setSynced('act', A);       // no local file
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: ['act'], deleted: [] });
    assert.strictEqual(pushes()[0].body.docxBase64, null);
    assert.strictEqual(store.act, null);
    assert.strictEqual(read(ACT()), null);
    assert.strictEqual(syncedSha('act'), null);
});

test('server changed, local unchanged (B=V1): the new server copy is downloaded and V1 is backed up', async () => {
    reset(); store.act = B; fs.writeFileSync(ACT(), A); setSynced('act', A);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: ['act'], uploaded: [], deleted: [] });
    assert.ok(eq(read(ACT()), B));
    assert.ok(hasBackup(A, 'act'));
    assert.strictEqual(syncedSha('act'), sha(B));
    assert.strictEqual(pushes().length, 0);
});

test('both changed, the server copy is newer: it wins and the local copy is backed up', async () => {
    reset(); store.act = B; uploadedAt.act = FUTURE; fs.writeFileSync(ACT(), P); setSynced('act', A);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: ['act'], uploaded: [], deleted: [] });
    assert.ok(eq(read(ACT()), B));
    assert.ok(hasBackup(P, 'act'), 'local loser backed up');
    assert.strictEqual(pushes().length, 0);
});

test('both changed, the local copy is newer: it wins, uploaded, and the server copy is backed up', async () => {
    reset(); store.act = B; uploadedAt.act = PAST; fs.writeFileSync(ACT(), P); setSynced('act', A);
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: ['act'], deleted: [] });
    assert.ok(eq(read(ACT()), P), 'local untouched');
    assert.ok(eq(store.act, P), 'server now holds the local copy');
    assert.ok(hasBackup(B, 'act'), 'server loser backed up');
    assert.strictEqual(syncedSha('act'), sha(P));
});

test('both changed, one side is absent: the existing copy always wins (nothing is destroyed)', async () => {
    reset(); store.act = B; setSynced('act', A);                       // local deleted, server changed
    let r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r.downloaded, ['act']);
    assert.ok(eq(read(ACT()), B));
    reset(); fs.writeFileSync(ACT(), P); setSynced('act', A);          // server deleted, local changed
    r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r.uploaded, ['act']);
    assert.ok(eq(read(ACT()), P) && eq(store.act, P));
});

test('migration: the old templatesSyncedAt flag is dropped and counts as never synced (a local template is uploaded, not deleted)', async () => {
    reset(); fs.writeFileSync(ACT(), A);
    config.updateConfig({ templatesSyncedAt: '2026-10-01T00:00:00.000Z' });
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: ['act'], deleted: [] });
    assert.ok(!('templatesSyncedAt' in config.getConfig()));
    assert.ok(!('templatesSyncedAt' in JSON.parse(fs.readFileSync(config.configPath(), 'utf8'))), 'gone from config.json too');
    assert.ok(eq(read(ACT()), A));
});

// ── fail open ──
test('server answers 500: returns, local files unchanged, remembered state unchanged, no throw', async () => {
    reset(); fs.writeFileSync(ACT(), A); setSynced('act', A);
    mode = 'error';
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: [], deleted: [] });
    assert.ok(eq(read(ACT()), A), 'a failing server never deletes');
    assert.strictEqual(syncedSha('act'), sha(A));
    assertPendingIntact();
});

test('stand-in down: returns, local files unchanged, no throw', async () => {
    reset(); fs.writeFileSync(ACT(), A); setSynced('act', A);
    const port = fake.address().port;
    await unlisten();
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: [], deleted: [] });
    await tpl().pushAll();
    await tpl().pushKind('act');
    assert.ok(eq(read(ACT()), A));
    assertPendingIntact();
    await listen(port);
});

test('not activated: syncOnLaunch and pushAll make no request', async () => {
    reset(); fs.writeFileSync(ACT(), A);
    const lic = fs.readFileSync(path.join(DATA, 'license.json'), 'utf8');
    fs.writeFileSync(path.join(DATA, 'license.json'), '{}');
    assert.deepStrictEqual(await tpl().syncOnLaunch(), { downloaded: [], uploaded: [], deleted: [] });
    await tpl().pushAll();
    assert.strictEqual(templateCalls().length, 0);
    fs.writeFileSync(path.join(DATA, 'license.json'), lic);
});

test('licence moved: no request is made at all', async () => {
    reset(); store.act = A; fs.writeFileSync(LIST(), B);
    license.markMoved({ url: 'https://c.tn', at: '2026-10-11T10:00:00.000Z' });
    assert.deepStrictEqual(await tpl().syncOnLaunch(), { downloaded: [], uploaded: [], deleted: [] });
    await tpl().pushAll();
    await tpl().pushKind('list');
    assert.strictEqual(templateCalls().length, 0);
    assert.strictEqual(read(ACT()), null, 'nothing downloaded');
    assert.ok(eq(read(LIST()), B));
    license.clearMoved();
});

test('a 410 from the server marks the licence moved and stops: no second request', async () => {
    reset(); fs.writeFileSync(ACT(), A);
    mode = 'gone';
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: [], deleted: [] });
    assert.strictEqual(license.isMoved().url, 'https://c.tn');
    assert.strictEqual(templateCalls().length, 1, 'stopped after the 410');
    assert.ok(eq(read(ACT()), A));
    const n = templateCalls().length;
    await tpl().pushAll();
    assert.strictEqual(templateCalls().length, n, 'moved: no further request');
    license.clearMoved();
});

// ── pushKind / pushAll ──
test('pushKind sends the local bytes as base64; an absent file sends null', async () => {
    reset(); fs.writeFileSync(ACT(), A);
    await tpl().pushKind('act');
    await tpl().pushKind('list');
    const [pa, pl] = pushes();
    assert.deepStrictEqual([pa.body.kind, pa.body.token, typeof pa.body.fingerprint], ['act', token, 'string']);
    assert.strictEqual(pa.body.docxBase64, A.toString('base64'));
    assert.deepStrictEqual([pl.body.kind, pl.body.docxBase64], ['list', null]);
    assert.ok(eq(store.act, A));
});

test('pushAll pushes act and list', async () => {
    reset(); fs.writeFileSync(ACT(), A); fs.writeFileSync(LIST(), B);
    await tpl().pushAll();
    assert.deepStrictEqual(pushes().map((c) => c.body.kind).sort(), ['act', 'list']);
    assert.ok(eq(store.act, A) && eq(store.list, B));
});

test('a failed push keeps the remembered sha, so the next launch uploads it instead of losing it', async () => {
    reset(); store.act = A; setSynced('act', A); fs.writeFileSync(ACT(), B);
    mode = 'error';
    await tpl().pushKind('act');            // approved while the server was failing
    assert.strictEqual(syncedSha('act'), sha(A), 'not confirmed → not remembered');
    mode = 'ok';
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r.uploaded, ['act']);
    assert.ok(eq(read(ACT()), B));
    assert.ok(eq(store.act, B));
});

test('a confirmed push remembers what the server now holds', async () => {
    reset(); fs.writeFileSync(ACT(), A);
    await tpl().pushKind('act');
    assert.strictEqual(syncedSha('act'), sha(A));
    rm(ACT());
    await tpl().pushKind('act');
    assert.strictEqual(syncedSha('act'), null);
});

// ── the Word-import routes ──
let base; let auth;
const plantPending = () => {
    const dir = path.dirname(PENDING());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'act.docx'), A);
    fs.writeFileSync(path.join(dir, 'list.docx'), B);
    fs.writeFileSync(path.join(dir, 'report.json'), '{"sourceName":"x.docx"}');
    fs.writeFileSync(path.join(dir, 'source.docx'), P);
};
const call = (method, p) => fetch(base + p, { method, headers: auth }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test('POST /apply pushes act and list to the licence server', async () => {
    reset(); plantPending();
    const r = await call('POST', '/api/word-import/apply');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.ok(await waitFor(() => pushes().length >= 2), 'two pushes arrived');
    assert.deepStrictEqual(pushes().map((c) => c.body.kind).sort(), ['act', 'list']);
    assert.ok(eq(store.act, A) && eq(store.list, B));
});

test('DELETE / pushes null for both kinds', async () => {
    reset(); plantPending();
    await call('POST', '/api/word-import/apply');
    assert.ok(await waitFor(() => store.act && store.list));
    calls = [];
    const r = await call('DELETE', '/api/word-import');
    assert.strictEqual(r.status, 200);
    assert.ok(await waitFor(() => pushes().length >= 2));
    assert.deepStrictEqual(pushes().map((c) => [c.body.kind, c.body.docxBase64]).sort(), [['act', null], ['list', null]]);
    assert.strictEqual(store.act, null);
    assert.strictEqual(store.list, null);
    assert.strictEqual(read(ACT()), null);
});

test('a failing push never changes the /apply or DELETE response', async () => {
    reset(); plantPending(); mode = 'error';
    const a = await call('POST', '/api/word-import/apply');
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.body.ok, true);
    assert.ok(a.body.active);
    assert.ok(eq(read(ACT()), A), 'applied locally');
    const d = await call('DELETE', '/api/word-import');
    assert.deepStrictEqual([d.status, d.body], [200, { ok: true }]);
    await waitFor(() => pushes().length >= 4);
});

test('DELETE / whose push failed: the next launch pushes null and the template does NOT come back', async () => {
    reset(); fs.writeFileSync(ACT(), A); store.act = A; setSynced('act', A);
    mode = 'error';
    const d = await call('DELETE', '/api/word-import');
    assert.strictEqual(d.status, 200);
    assert.ok(await waitFor(() => pushes().length >= 2));
    await new Promise((x) => setTimeout(x, 100));
    assert.ok(eq(store.act, A), 'the server never heard about the delete');
    assert.strictEqual(read(ACT()), null);
    mode = 'ok'; calls = [];
    const r = await tpl().syncOnLaunch();
    assert.deepStrictEqual(r, { downloaded: [], uploaded: ['act'], deleted: [] });
    assert.strictEqual(store.act, null, 'the server dropped it');
    assert.strictEqual(read(ACT()), null, 'it did not come back');
    assert.strictEqual(syncedSha('act'), null);
});

test('Settings: POST /template pushes the new act, DELETE /template pushes null; responses unchanged', async () => {
    reset();
    const bundled = fs.readFileSync(path.join(__dirname, '..', 'server', 'assets', 'template_cnss.docx'));
    const fd = new FormData();
    fd.append('file', new Blob([bundled], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'acte.docx');
    const up = await fetch(base + '/api/settings/template', { method: 'POST', headers: auth, body: fd });
    assert.strictEqual(up.status, 200);
    assert.strictEqual((await up.json()).hasCustomTemplate, true);
    assert.ok(await waitFor(() => store.act), 'the act reached the stand-in');
    assert.ok(eq(store.act, bundled));
    assert.deepStrictEqual(pushes().map((c) => c.body.kind), ['act']);
    calls = [];
    const del = await call('DELETE', '/api/settings/template');
    assert.deepStrictEqual([del.status, del.body], [200, { success: true, hasCustomTemplate: false }]);
    assert.ok(await waitFor(() => pushes().length === 1));
    assert.deepStrictEqual([pushes()[0].body.kind, pushes()[0].body.docxBase64], ['act', null]);
    mode = 'error';                                  // a failing server never changes the response
    const fd2 = new FormData();
    fd2.append('file', new Blob([bundled]), 'acte.docx');
    calls = [];
    assert.strictEqual((await fetch(base + '/api/settings/template', { method: 'POST', headers: auth, body: fd2 })).status, 200);
    assert.ok(await waitFor(() => pushes().length === 1), 'the (failing) push was attempted');
    await new Promise((x) => setTimeout(x, 100)); // let it settle before the next scenario
});

test('/apply while moved: the 423 gate answers, so no push can happen', async () => {
    reset(); plantPending();
    license.markMoved({ url: 'https://c.tn' });
    const r = await call('POST', '/api/word-import/apply');
    assert.strictEqual(r.status, 423);
    await new Promise((x) => setTimeout(x, 150));
    assert.strictEqual(pushes().length, 0);
    license.clearMoved();
});

// ── the launch wiring: startServer runs syncOnLaunch after revalidate + pull ──
const { startServer } = require('../server/index.js');
listen(0).then(async () => {
    config.updateConfig({ licenseServerUrl: `http://127.0.0.1:${fake.address().port}`, onboardingDone: true });
    fs.writeFileSync(path.join(DATA, 'license.json'), JSON.stringify({ licenseKey: LICENCE, token }));
    store.act = A; // the office's template is waiting on the server when the app starts
    const server = await startServer({ port: 0 });
    base = `http://127.0.0.1:${server.address().port}`;
    const finish = (code) => { server.close(); fake.close(); process.exit(code); };
    try {
        assert.ok(await waitFor(() => eq(read(ACT()), A), 4000), 'launch downloaded the server act');
        assert.ok(calls.some((c) => c.url === '/api/templates/pull'), 'the launch asked for the template list');
        passed++; console.log('  ✓ startServer: the server act is on this PC after launch, without blocking listen');
        const login = await (await fetch(base + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: config.DEFAULT_PASSWORD }),
        })).json();
        assert.ok(login.token, 'logged in');
        auth = { Authorization: `Bearer ${login.token}` };
    } catch (e) { console.error(`  ✗ launch wiring\n    ${e.stack || e.message}`); finish(1); }
    for (const [name, fn] of steps) {
        try { await fn(); passed++; console.log(`  ✓ ${name}`); }
        catch (e) { console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); finish(1); }
    }
    console.log(`\n${passed} passed.`);
    finish(0);
});
