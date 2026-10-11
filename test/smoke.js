/*
 * End-to-end smoke test for the carved CNSS server.
 * Run under Electron's Node (so better-sqlite3's prebuilt matches the ABI):
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules/electron/dist/electron.exe test/smoke.js [sampleFile]
 *
 * Test A (offline): create company → add card → list (sum) → generate .docx acts.
 * Test B (online):  POST /scan with a real état-de-liquidation → AI extract →
 *                    auto-create → generate the card's .docx act.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fresh, isolated data dir so we get a clean DB + a freshly seeded config.json
// (default password "cnss2026", embedded OpenRouter key).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-smoke-'));
process.env.CNSS_USERDATA = tmp;

const { startServer } = require(path.join(__dirname, '..', 'server', 'index.js'));

const isDocx = (buf) =>
    buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && // "PK" zip
    buf.includes(Buffer.from('word/document.xml'));

let failures = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { console.error('  ✗', m); failures++; };

(async () => {
    console.log('data dir:', tmp);
    const server = await startServer({ port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    console.log('server:', base);

    const auth = (token, extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

    // ── login ──
    let token;
    {
        const r = await fetch(`${base}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'cnss2026' }),
        });
        const j = await r.json();
        if (r.ok && j.token) { token = j.token; ok('login with shared password'); }
        else bad('login failed: ' + JSON.stringify(j));

        const rBad = await fetch(`${base}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'wrong' }),
        });
        if (rBad.status === 401) ok('wrong password rejected'); else bad('wrong password not rejected');
    }
    if (!token) { console.error('\nFAIL: no token'); process.exit(1); }

    // ── Test A: manual create → card → list → docx ──
    console.log('\nTest A — create / card / list / docx (offline):');
    let idCn, cardId;
    {
        const r = await fetch(`${base}/api/cnss`, {
            method: 'POST', headers: auth(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ nom_cl2: 'SARL DICIMOOV', numcnss: '612555', codeng: '00', cl2_adresse: 'Tunis' }),
        });
        const j = await r.json();
        if (r.ok && j.id_cn) { idCn = j.id_cn; ok('create company → id_cn=' + idCn + ', ref=' + j.ref); }
        else bad('create company failed: ' + JSON.stringify(j));
    }
    {
        const r = await fetch(`${base}/api/cnss/${idCn}/cards`, {
            method: 'POST', headers: auth(token, { 'Content-Type': 'application/json' }),
            // The client derives datesins from semestre and sends it; the server
            // stores it verbatim (server-side derivation is exercised via /scan).
            body: JSON.stringify({ numcarte: '4621400216', datecarte: '21-05-2026', semestre: '04/2021', dette: '2959.306', datesins: '16/01/2022' }),
        });
        const j = await r.json();
        if (r.ok && j.id_cn_oe) {
            cardId = j.id_cn_oe;
            ok('add card → id_cn_oe=' + cardId + ', datesins=' + j.datesins);
            if (j.datesins !== '16/01/2022') bad('datesins not stored, got ' + j.datesins);
        } else bad('add card failed: ' + JSON.stringify(j));
    }
    {
        const r = await fetch(`${base}/api/cnss?ref=`, { headers: auth(token) });
        const j = await r.json();
        const row = (j.data || []).find((x) => x.id_cn === idCn);
        if (row && Number(row.card_count) === 1) ok('list: card_count=1');
        else bad('list card_count wrong: ' + JSON.stringify(row && row.card_count));
        if (row && Math.abs(Number(row.total_dette) - 2959.306) < 0.001) ok('list: total_dette sums to 2959.306 (SQLite CAST)');
        else bad('total_dette wrong: ' + JSON.stringify(row && row.total_dette));
    }
    {
        const r = await fetch(`${base}/api/cnss/${idCn}/acts.docx`, { method: 'POST', headers: auth(token) });
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && isDocx(buf)) ok('POST /:id/acts.docx → valid .docx (' + buf.length + ' bytes)');
        else bad('acts.docx invalid (status ' + r.status + ', ' + buf.length + ' bytes)');
    }
    {
        // The card is now in a one-card محضر, so asking for it alone reprints that محضر.
        const r = await fetch(`${base}/api/cnss/${idCn}/actes`, {
            method: 'POST', headers: auth(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ card_ids: [cardId] }),
        });
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && isDocx(buf)) ok('POST /:id/actes (one card) → valid .docx (' + buf.length + ' bytes)');
        else bad('card محضر invalid (status ' + r.status + ')');
    }

    // ── Test B: the scan → AI extract path is now LICENSE-GATED. ──
    // It needs activation against the license server, so it's covered by the
    // dedicated test/license-e2e.js instead of this offline smoke test.
    console.log('\nTest B — scan/AI path moved to test/license-e2e.js (license-gated).');

    // ── Test C: settings — office name, password, custom template ──
    console.log('\nTest C — settings (office name / password / template):');
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    {
        let r = await fetch(`${base}/api/settings/office`, {
            method: 'PUT', headers: auth(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ officeName: 'مكتب تجريبي' }),
        });
        if (r.ok) ok('set office name'); else bad('set office name failed');
        const pub = await (await fetch(`${base}/api/settings/public`)).json();
        if (pub.officeName === 'مكتب تجريبي') ok('public endpoint reflects office name'); else bad('public office name wrong: ' + JSON.stringify(pub));
    }
    {
        let r = await fetch(`${base}/api/settings/password`, {
            method: 'PUT', headers: auth(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ currentPassword: 'cnss2026', newPassword: 'newpass1' }),
        });
        if (r.ok) ok('change password'); else bad('change password failed: ' + JSON.stringify(await r.json()));

        r = await fetch(`${base}/api/settings/password`, {
            method: 'PUT', headers: auth(token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'whatever' }),
        });
        if (r.status === 401) ok('wrong current password rejected'); else bad('wrong current password not rejected (' + r.status + ')');

        r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'newpass1' }) });
        if (r.ok) ok('login with NEW password works'); else bad('new password login failed');
        r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'cnss2026' }) });
        if (r.status === 401) ok('old password no longer works'); else bad('old password still works!');
    }
    {
        let r = await fetch(`${base}/api/settings/template/sample`, { headers: auth(token) });
        const sample = Buffer.from(await r.arrayBuffer());
        if (r.ok && isDocx(sample)) ok('download sample template (' + sample.length + ' bytes)'); else bad('sample download invalid');

        let fd = new FormData();
        fd.append('file', new Blob([sample], { type: DOCX_MIME }), 'mytemplate.docx');
        r = await fetch(`${base}/api/settings/template`, { method: 'POST', headers: auth(token), body: fd });
        if (r.ok) ok('valid custom template accepted'); else bad('valid template rejected: ' + JSON.stringify(await r.json()));

        let j = await (await fetch(`${base}/api/settings`, { headers: auth(token) })).json();
        if (j.hasCustomTemplate) ok('settings shows custom template active'); else bad('custom template not active');

        r = await fetch(`${base}/api/cnss/${idCn}/acts.docx`, { method: 'POST', headers: auth(token) });
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && isDocx(buf)) ok('acts.docx renders using the custom template (' + buf.length + ' bytes)'); else bad('acts.docx with custom template failed');

        let fd2 = new FormData();
        fd2.append('file', new Blob([Buffer.from('not a docx at all')], { type: 'text/plain' }), 'bad.txt');
        r = await fetch(`${base}/api/settings/template`, { method: 'POST', headers: auth(token), body: fd2 });
        if (r.status >= 400) ok('non-docx upload rejected (' + r.status + ')'); else bad('non-docx upload accepted!');

        r = await fetch(`${base}/api/settings/template`, { method: 'DELETE', headers: auth(token) });
        if (r.ok) ok('reset to default template'); else bad('reset failed');
        j = await (await fetch(`${base}/api/settings`, { headers: auth(token) })).json();
        if (!j.hasCustomTemplate) ok('settings shows default after reset'); else bad('still custom after reset');
    }

    server.close();
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('SMOKE ERROR:', e); process.exit(1); });
