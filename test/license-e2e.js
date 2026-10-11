/*
 * Phase 3 + onboarding/details end-to-end: desktop app ↔ live license server.
 * Run under Electron's Node (better-sqlite3 ABI):
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\license-e2e.js <imagePath>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const PizZip = require('pizzip');

const LICENSE_SERVER = 'https://cnss-license-server.vercel.app';
const ADMIN_PW = process.env.ADMIN_PASSWORD;
if (!ADMIN_PW) { console.error('Set ADMIN_PASSWORD env var to the license-server admin password.'); process.exit(1); }
const IMG = process.argv[2];

process.env.CNSS_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-lic-e2e-'));
const { startServer } = require(path.join(__dirname, '..', 'server', 'index.js'));

let fail = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { console.error('  ✗', m); fail++; };
const isDocx = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b.includes(Buffer.from('word/document.xml'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILE = { officeName: 'العدل التجريبي', officeAddress: 'نهج تجريبي، تونس', officePhone: '71000000', officeFax: '71000001', taxId: '1234567Z/A/M/000' };

(async () => {
    console.log('data dir:', process.env.CNSS_USERDATA);

    // mint a throwaway license (admin)
    const login = await fetch(`${LICENSE_SERVER}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PW }) });
    const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    const admin = (p, b) => fetch(`${LICENSE_SERVER}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined });
    const KEY = (await (await admin('/api/admin/licenses', { customerName: 'E2E ' + Date.now() })).json()).license.license_key;
    console.log('minted license:', KEY);

    const server = await startServer({ port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    const J = (p, opts) => fetch(`${base}${p}`, opts).then((r) => r.json());
    const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    // gate: not activated, not onboarded
    {
        const g = await J('/api/onboarding/status');
        (!g.activated && !g.onboardingDone) ? ok('gate: not activated, not onboarded') : bad('gate wrong: ' + JSON.stringify(g));
    }
    // activate
    {
        const r = await post('/api/license/activate', { licenseKey: KEY });
        (await r.json()).activated ? ok('activated this machine') : bad('activate failed');
    }
    // gate now: activated, onboarding still needed
    {
        const g = await J('/api/onboarding/status');
        (g.activated && !g.onboardingDone) ? ok('gate: activated, onboarding pending') : bad('gate wrong after activate: ' + JSON.stringify(g));
    }
    // preview with un-saved details → renders a valid docx (open-preview writes it to disk)
    {
        const r = await post('/api/onboarding/open-preview', PROFILE);
        const d = await r.json();
        if (r.ok && d.ok && d.path && fs.existsSync(d.path)) {
            const hdr = new PizZip(fs.readFileSync(d.path)).file('word/header1.xml').asText().replace(/<[^>]+>/g, '');
            (hdr.includes('العدل التجريبي') && hdr.includes('71000000')) ? ok('preview shows un-saved details in the letterhead') : bad('preview content wrong');
            fs.unlinkSync(d.path);
        } else bad('open-preview failed: ' + JSON.stringify(d));
    }
    // complete onboarding: save details + set password
    {
        const r = await post('/api/onboarding/complete', { ...PROFILE, password: 'newpass1' });
        (await r.json()).ok ? ok('onboarding complete (details + password saved)') : bad('complete failed');
    }
    // gate: onboarded, profile persisted
    {
        const g = await J('/api/onboarding/status');
        (g.onboardingDone && g.profile.officeName === PROFILE.officeName && g.profile.taxId === PROFILE.taxId) ? ok('gate: onboarded, profile persisted') : bad('profile not persisted: ' + JSON.stringify(g.profile));
    }
    // details mirrored to the license server (admin) — pushProfile is async, give it a moment
    {
        await sleep(2500);
        const list = (await (await fetch(`${LICENSE_SERVER}/api/admin/licenses`, { headers: { Cookie: cookie } })).json()).licenses;
        const mine = list.find((l) => l.license_key === KEY);
        (mine && mine.details && mine.details.officeName === PROFILE.officeName && mine.details.taxId === PROFILE.taxId) ? ok('office details mirrored to the Vercel admin record') : bad('details not on server: ' + JSON.stringify(mine && mine.details));
    }
    // login with the NEW password set during onboarding
    let token;
    {
        const r = await post('/api/auth/login', { password: 'newpass1' });
        if (r.ok) { token = (await r.json()).token; ok('login with the password set during onboarding'); } else bad('new password login failed');
        const r2 = await post('/api/auth/login', { password: 'cnss2026' });
        (r2.status === 401) ? ok('default password no longer works') : bad('default password still works!');
    }
    // licensed scan → record
    let idCn;
    if (IMG && fs.existsSync(IMG)) {
        const fd = new FormData();
        fd.append('file', new Blob([fs.readFileSync(IMG)], { type: 'image/jpeg' }), 'card.jpg');
        const r = await fetch(`${base}/api/cnss/scan`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
        const d = await r.json();
        if (r.ok && d.success) { idCn = d.id_cn; ok('licensed scan → record created'); } else bad('scan failed: ' + JSON.stringify(d));
    }
    // generated act uses the CUSTOMER letterhead, not the original owner's
    if (idCn) {
        const r = await fetch(`${base}/api/cnss/${idCn}/acts.docx`, { headers: { Authorization: `Bearer ${token}` } });
        const buf = Buffer.from(await r.arrayBuffer());
        const zip = new PizZip(buf);
        const hdr = zip.file('word/header1.xml').asText().replace(/<[^>]+>/g, '');
        const body = zip.file('word/document.xml').asText().replace(/<[^>]+>/g, '');
        if (!isDocx(buf)) bad('acts.docx invalid');
        else {
            hdr.includes('العدل التجريبي') ? ok('act letterhead shows the customer name') : bad('letterhead missing customer name');
            (hdr + body).includes('مراد القع') ? bad("original owner's name STILL in the act!") : ok("original owner's name absent from the act");
            (hdr.includes('71000000') && hdr.includes('1234567Z')) ? ok('act letterhead has customer phone + tax id') : bad('letterhead missing phone/tax');
        }
    }

    // native "open in Word" act endpoint: render a valid de-branded .docx to disk
    // (shell is null under electron-as-node, so it writes the file and returns its path)
    if (idCn) {
        const r = await post(`/api/cnss/${idCn}/acts/open`, {}, { Authorization: `Bearer ${token}` });
        const d = await r.json();
        if (r.ok && d.ok && d.path && fs.existsSync(d.path)) {
            const z = new PizZip(fs.readFileSync(d.path));
            const hdr = z.file('word/header1.xml').asText().replace(/<[^>]+>/g, '');
            (hdr.includes('العدل التجريبي') && !hdr.includes('مراد القع')) ? ok('acts/open → valid de-branded .docx on disk (opens cleanly in Word, no MOTW)') : bad('open docx content wrong');
            fs.unlinkSync(d.path);
        } else bad('acts/open failed: ' + JSON.stringify(d));
    }

    // record sync: push a local record up, then simulate a fresh device (wipe
    // local rows + reset the synced version) and pull it back down.
    {
        const sync = require(path.join(__dirname, '..', 'server', 'sync'));
        const db = require(path.join(__dirname, '..', 'server', 'db'));
        db.run(`INSERT INTO cnss (id_cn, ref, nom_cl2, numcnss, id_so, date_ajout) VALUES (?,?,?,?,?,?)`,
            [9991, 9991, 'شركة المزامنة', 'SYNC123', '1', new Date().toLocaleString('fr-FR')]);
        await sync.push();

        db.getConn().exec('DELETE FROM cnss_oeuvre; DELETE FROM cnss;');
        fs.writeFileSync(path.join(process.env.CNSS_USERDATA, 'sync.json'), JSON.stringify({ version: 0 }));
        const goneAfterWipe = !db.get(`SELECT id_cn FROM cnss WHERE numcnss = ?`, ['SYNC123']);

        await sync.pull();
        const back = db.get(`SELECT nom_cl2 FROM cnss WHERE numcnss = ?`, ['SYNC123']);
        (goneAfterWipe && back && back.nom_cl2 === 'شركة المزامنة')
            ? ok('record sync: push → wipe → pull restored the record on a fresh device')
            : bad('record sync round-trip failed: ' + JSON.stringify(back));
    }

    // cleanup
    await admin(`/api/admin/licenses/${encodeURIComponent(KEY)}/reset`);
    await admin(`/api/admin/licenses/${encodeURIComponent(KEY)}/status`, { status: 'revoked' });
    console.log('cleaned up test license');

    server.close();
    console.log(fail === 0 ? '\nONBOARDING + DETAILS E2E PASS' : `\n${fail} FAILURE(S)`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
