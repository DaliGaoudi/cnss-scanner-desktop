/*
 * Grouping بطاقات جبر into one محضر, on the desktop: the pure rules
 * (services/cnssActes.js, same cases as the webapp's test_cnss_actes.js), the
 * render of a several-card محضر against the real template, and the HTTP routes
 * end to end on a throwaway SQLite database.
 *
 * Run under Electron's Node (better-sqlite3's prebuilt matches its ABI):
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\cnss-actes.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PizZip = require('pizzip');

// Fresh, isolated data dir: clean DB + freshly seeded config (password "cnss2026").
process.env.CNSS_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-actes-'));

const { checkGrouping, buildActRecord } = require('../server/services/cnssActes');
const { renderActs } = require('../server/services/actRender');
const { startServer } = require('../server/index.js');

const card = (id, over = {}) => ({
    id_cn_oe: id, numcarte: `C${id}`, semestre: '01/2026', dette: '100.000', datesins: '16/04/2026',
    datecarte: '01/03/2026', nbrreg: '12/2026', date_tabligh: '', id_acte: null, ...over,
});
const docText = (buf) => new PizZip(buf).file('word/document.xml').asText().replace(/<[^>]+>/g, '');

let passed = 0;
const steps = [];
const test = (name, fn) => steps.push([name, fn]);

// ── pure rules ──
test('free cards that agree → a new محضر, nothing to warn about', () => {
    const r = checkGrouping([card(1), card(2)], [], {});
    assert.deepStrictEqual(r, { mismatches: [], conflicts: [], dateCarteValues: ['01/03/2026'], reprintActeId: null });
});
test('different عدد التضمين is a blocking mismatch', () => {
    const r = checkGrouping([card(1), card(2, { nbrreg: '13/2026' })], [], {});
    assert.strictEqual(r.mismatches[0].field, 'nbrreg');
    assert.deepStrictEqual(r.mismatches[0].values, ['12/2026', '13/2026']);
});
test('a blank عدد التضمين does not match a filled one', () => {
    assert.strictEqual(checkGrouping([card(1), card(2, { nbrreg: '' })], [], {}).mismatches[0].field, 'nbrreg');
});
test('different تاريخ التبليغ blocks; two spellings of the same day do not', () => {
    const differ = checkGrouping([card(1, { date_tabligh: '2026-05-01' }), card(2, { date_tabligh: '2026-05-02' })], [], {});
    assert.strictEqual(differ.mismatches[0].field, 'date_tabligh');
    const same = checkGrouping([card(1, { date_tabligh: '2026-05-01' }), card(2, { date_tabligh: '01/05/2026' })], [], {});
    assert.strictEqual(same.mismatches.length, 0);
});
test('different تاريخ بطاقة الجبر only warns', () => {
    const r = checkGrouping([card(1), card(2, { datecarte: '02/03/2026' })], [], {});
    assert.strictEqual(r.mismatches.length, 0);
    assert.deepStrictEqual(r.dateCarteValues, ['01/03/2026', '02/03/2026']);
});
test('exactly the cards of one existing محضر → reprint it', () => {
    const a = card(1, { id_acte: 7 }), b = card(2, { id_acte: 7 });
    assert.strictEqual(checkGrouping([a, b], [a, b], { 7: { id_acte: 7, numero: 1 } }).reprintActeId, 7);
});
test('part of an existing محضر → conflict saying what moves and what stays', () => {
    const a = card(1, { id_acte: 7 }), b = card(2, { id_acte: 7 }), c = card(3);
    const r = checkGrouping([a, c], [a, b], { 7: { id_acte: 7, numero: 1, date_ajout: 'x' } });
    assert.deepStrictEqual(r.conflicts, [{ id_acte: 7, numero: 1, date_ajout: 'x', moving: ['C1'], remaining: 1 }]);
});
test('a card pointing at a vanished محضر counts as free', () => {
    const r = checkGrouping([card(1, { id_acte: 99 })], [card(1, { id_acte: 99 })], {});
    assert.strictEqual(r.conflicts.length, 0);
    assert.strictEqual(r.reprintActeId, null);
});
test('buildActRecord: one row per card, fees summed, shared fields printed once', () => {
    const rec = buildActRecord({ nom_cl2: 'شركة' }, [
        card(1, { fee_original: '30000', fee_post: '200', vat_rate: '19' }),
        card(2, { fee_original: '10000', fee_post: '300', vat_rate: '19', datecarte: '02/03/2026' }),
    ]);
    assert.deepStrictEqual(rec.cards.map((r) => r.num_carte), ['C1', 'C2']);
    assert.strictEqual(rec.num_dossier, '12/2026');
    assert.strictEqual(rec.date_carte, '01/03/2026 و 02/03/2026');
    assert.strictEqual(rec.fee_original, '40,000');
    assert.strictEqual(rec.fee_aqm, '7,600');              // 19% of 40 000 millimes
    assert.strictEqual(rec.fee_total, '48,100');
});

// ── render against the bundled desktop template ──
test('the bundled template loops the card row over {#cards}', () => {
    const xml = new PizZip(fs.readFileSync(path.join(__dirname, '..', 'server', 'assets', 'template_cnss.docx')))
        .file('word/document.xml').asText();
    assert.ok(xml.includes('{#cards}') && xml.includes('{/cards}'));
});
test('a two-card محضر renders both rows in one act, no tags left', () => {
    const text = docText(renderActs([buildActRecord({ nom_cl2: 'شركة' }, [card(1), card(2)])]));
    assert.ok(text.includes('C1') && text.includes('C2'), 'both card numbers present');
    assert.deepStrictEqual(text.match(/\{[#/]?[a-z_]+\}/g), null, 'no unmerged tags');
});
test('two محاضر in one document keep all three cards', () => {
    const text = docText(renderActs([buildActRecord({}, [card(1), card(2)]), buildActRecord({}, [card(3)])]));
    assert.ok(['C1', 'C2', 'C3'].every((n) => text.includes(n)));
});

// ── HTTP routes on SQLite ──
let base, token, idCn;
const call = async (method, p, body) => {
    const r = await fetch(base + p, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const addCard = (over) => call('POST', `/api/cnss/${idCn}/cards`, {
    numcarte: '', datecarte: '01/03/2026', semestre: '01/2026', dette: '100', datesins: '16/04/2026', nbrreg: '7/2026', ...over,
});

test('new ملف defaults to «في انتظار الطباعة» and keeps طريقة التبليغ / المآل النهائي', async () => {
    const r = await call('POST', '/api/cnss', { nom_cl2: 'SARL TEST', numcnss: '111', tabligh_method: 'فصل 8', resultat: 'خلاص جزئي' });
    idCn = r.body.id_cn;
    const g = await call('GET', `/api/cnss/${idCn}`);
    assert.strictEqual(g.body.status, 'awaiting_print');
    assert.strictEqual(g.body.tabligh_method, 'فصل 8');
    assert.strictEqual(g.body.resultat, 'خلاص جزئي');
    assert.deepStrictEqual(g.body.actes, []);
});
test('a typed card is normalised (Arabic digits, padding) and a bad one refused with 422', async () => {
    const ok = await addCard({ numcarte: '٤٦٢١', dette: '٢٩٥٩٫٣' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.numcarte, '4621');
    assert.strictEqual(ok.body.dette, '2959.300');
    const bad = await addCard({ numcarte: '9', datecarte: '31/02/2026' });
    assert.strictEqual(bad.status, 422);
    assert.ok(bad.body.fields.datecarte);
});
test('two agreeing cards become one محضر 1 with both rows', async () => {
    await addCard({ numcarte: '4622' });
    const cards = (await call('GET', `/api/cnss/${idCn}`)).body.cards;
    const r = await call('POST', `/api/cnss/${idCn}/actes`, { card_ids: cards.map((c) => c.id_cn_oe) });
    assert.strictEqual(r.status, 200);
    const text = docText(r.body);
    assert.ok(text.includes('4621') && text.includes('4622'));
    const after = (await call('GET', `/api/cnss/${idCn}`)).body;
    assert.strictEqual(after.actes.length, 1);
    assert.strictEqual(after.actes[0].numero, 1);
    assert.ok(after.cards.every((c) => c.id_acte === after.actes[0].id_acte));
});
test('editing عدد التضمين on one card of the محضر updates the whole محضر', async () => {
    const cards = (await call('GET', `/api/cnss/${idCn}`)).body.cards;
    const r = await call('PUT', `/api/cnss/cards/${cards[0].id_cn_oe}`, { nbrreg: '8/2026' });
    assert.strictEqual(r.body.propagated, 1);
    const after = (await call('GET', `/api/cnss/${idCn}`)).body.cards;
    assert.ok(after.every((c) => c.nbrreg === '8/2026'));
});
test('تاريخ التبليغ before a sibling card\'s date is refused', async () => {
    const cards = (await call('GET', `/api/cnss/${idCn}`)).body.cards;
    const r = await call('PUT', `/api/cnss/cards/${cards[0].id_cn_oe}`, { date_tabligh: '2026-02-01' });
    assert.strictEqual(r.status, 422);
});
test('a card with a different عدد التضمين cannot join', async () => {
    const c = await addCard({ numcarte: '4623', nbrreg: '9/2026' });
    const cards = (await call('GET', `/api/cnss/${idCn}`)).body.cards;
    const r = await call('POST', `/api/cnss/${idCn}/actes`, { card_ids: [cards[0].id_cn_oe, c.body.id_cn_oe] });
    assert.strictEqual(r.status, 422);
    assert.ok(r.body.mismatches.length);
});
test('moving a card out of a محضر asks first (409), then moves it with force', async () => {
    const cards = (await call('GET', `/api/cnss/${idCn}`)).body.cards;
    const free = cards.find((c) => c.numcarte === '4623');
    await call('PUT', `/api/cnss/cards/${free.id_cn_oe}`, { nbrreg: '8/2026' });
    const ask = await call('POST', `/api/cnss/${idCn}/actes`, { card_ids: [cards[0].id_cn_oe, free.id_cn_oe] });
    assert.strictEqual(ask.status, 409);
    assert.strictEqual(ask.body.conflicts[0].remaining, 1);
    const go = await call('POST', `/api/cnss/${idCn}/actes`, { card_ids: [cards[0].id_cn_oe, free.id_cn_oe], force: true });
    assert.strictEqual(go.status, 200);
    assert.strictEqual((await call('GET', `/api/cnss/${idCn}`)).body.actes.length, 2);
});
test('dissolving a محضر frees its cards; deleting a lone card removes its محضر', async () => {
    let g = (await call('GET', `/api/cnss/${idCn}`)).body;
    const acte2 = g.actes.find((a) => a.numero === 2);
    assert.strictEqual((await call('DELETE', `/api/cnss/actes/${acte2.id_acte}`)).status, 200);
    g = (await call('GET', `/api/cnss/${idCn}`)).body;
    assert.strictEqual(g.actes.length, 1);
    const lone = g.cards.find((c) => c.id_acte === g.actes[0].id_acte);
    await call('DELETE', `/api/cnss/cards/${lone.id_cn_oe}`);
    assert.strictEqual((await call('GET', `/api/cnss/${idCn}`)).body.actes.length, 0);
});
test('printing every محضر turns each free card into its own محضر', async () => {
    const r = await call('POST', `/api/cnss/${idCn}/acts.docx`);
    assert.strictEqual(r.status, 200);
    const g = (await call('GET', `/api/cnss/${idCn}`)).body;
    assert.strictEqual(g.actes.length, g.cards.length);
});
test('an AI-read card that fails validation blocks printing until fixed', async () => {
    // Simulate an unreadable scan kept as read (force skips validation, like /scan).
    await addCard({ numcarte: '4699', datecarte: '31/02/2026', force: 1 });
    const r = await call('POST', `/api/cnss/${idCn}/acts.docx`);
    assert.strictEqual(r.status, 422);
    assert.ok(r.body.error.includes('4699'));
});

test('facturation page: delivered cards grouped by month, same totals as the Word bill', async () => {
    const { buildListData } = require('../server/services/listRender');
    const c = await addCard({ numcarte: '4800', nbrreg: '20/2026', date_tabligh: '2026-09-15', fee_original: '30000', fee_post: '6250', vat_rate: '19' });
    assert.strictEqual(c.status, 200, JSON.stringify(c.body));
    const r = await call('GET', '/api/cnss/facturation/months');
    assert.strictEqual(r.status, 200);
    const sept = r.body.months.find((m) => m.year === 2026 && m.month === 9);
    assert.ok(sept, 'September 2026 listed');
    assert.ok(sept.rows.some((row) => row.numcarte === '4800' && row.date_tabligh === '15/09/2026'));
    assert.strictEqual(sept.t_total, '41,950');   // 30 000 + 19 % VAT 5 700 + post 6 250
    // The Word bill for that month computes the very same total.
    const rows = (await call('GET', `/api/cnss/${idCn}`)).body.cards.map((card) => ({ ...card, nom_cl2: 'SARL TEST' }));
    assert.strictEqual(buildListData(rows, { year: 2026, month: 9 }).t_total, sept.t_total);
    assert.ok(!r.body.months.some((m) => m.rows.some((row) => row.numcarte === '4621' && !row.date_tabligh)), 'undelivered cards stay off');
});

(async () => {
    const server = await startServer({ port: 0 });
    base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'cnss2026' }),
    });
    token = (await login.json()).token;

    for (const [name, fn] of steps) {
        try { await fn(); passed++; console.log(`  ✓ ${name}`); }
        catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); server.close(); process.exit(1); }
    }
    server.close();
    console.log(`\n${passed} passed.`);
    process.exit(0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
