/*
 * "Import your own Word file" (services/templateImport.js, routes/wordImport.js).
 *
 * Fixtures:
 *   mail-merge — test/fixtures/mailmerge-act.docx, a real office's act with Word
 *                merge fields;
 *   filled     — a real-looking filled-in act with TWO card rows, made by rendering
 *                the original office template with data;
 *   typed      — the filled act with its letterhead moved from Word's header into
 *                the top of the page, another font and other margins.
 * The AI is an oracle that quotes the right values — plus deliberately wrong
 * answers, which must be dropped, never trusted.
 *
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\word-import.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

process.env.CNSS_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-wordimp-'));
const ti = require('../server/services/templateImport');
const m = require('../server/services/docxModel');
const { renderActs } = require('../server/services/actRender');
const { buildActRecord } = require('../server/services/cnssActes');
const config = require('../server/config');

const ASSETS = path.join(__dirname, '..', 'server', 'assets');
const textOf = (buf, re = /^word\/(document|header\d*|footer\d*)\.xml$/) => {
    const z = new PizZip(buf);
    return Object.keys(z.files).filter((f) => re.test(f)).map((f) => m.blocksOf(z.file(f).asText()).map((b) => b.text).join('\n')).join('\n');
};

// ── fixtures ──
const OLD = {
    nom: 'SARL VIEUX CLIENT', adresse: 'نهج القديم عدد 9 سوسة', aff: '418256', code: '01', dossier: '6620', date: '20/05/2026',
    cards: [
        { num: '4621400133', tri: '03/2024', mnt: '845.000', pen: '16/10/2024' },
        { num: '4621400134', tri: '04/2024', mnt: '912.360', pen: '16/01/2025' },
    ],
};
function filledAct() {
    // The office's original template (tags + its own letterhead and fixed fee footer).
    const zip = new PizZip(fs.readFileSync(path.join(ASSETS, 'template_cnss.original.docx')));
    const xml = zip.file('word/document.xml').asText();
    // One row per card, as a real two-card act has.
    zip.file('word/document.xml', xml.replace('{num_carte}', '{#cards}{num_carte}').replace('{date_penalite}', '{date_penalite}{/cards}'));
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render({ acts: [{
        num_dossier: OLD.dossier, code_inscription: OLD.code, num_affiliation: OLD.aff, nom_matloub: OLD.nom, adresse: OLD.adresse,
        date_carte: OLD.date, cards: OLD.cards.map((c) => ({ num_carte: c.num, trimestre: c.tri, montant: c.mnt, date_penalite: c.pen })),
    }] });
    // Drop the template's trailing page break: a real act is one page.
    const out = doc.getZip();
    out.file('word/document.xml', out.file('word/document.xml').asText().replace(ti.PAGE_BREAK_P, ''));
    return out.generate({ type: 'nodebuffer' });
}
function typedLetterhead(buf) {
    const zip = new PizZip(buf);
    const parts = ['word/header1.xml'];
    const hx = zip.file(parts[0]).asText();
    const inner = hx.slice(hx.indexOf('>', hx.indexOf('<w:hdr')) + 1, hx.lastIndexOf('</w:hdr>'));
    let doc = zip.file('word/document.xml').asText();
    const bodyAt = doc.indexOf('<w:body>') + '<w:body>'.length;
    doc = doc.slice(0, bodyAt) + inner + doc.slice(bodyAt);
    doc = doc.replace(/<w:headerReference\b[^>]*\/>/g, '').replace(/Andalus/g, 'Traditional Arabic')
        .replace(/<w:pgMar\b[^>]*\/>/, '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>');
    zip.file('word/document.xml', doc);
    zip.file(parts[0], hx.replace(inner, '<w:p/>'));
    return zip.generate({ type: 'nodebuffer' });
}

// The AI stand-in: quotes every value correctly, plus two answers that must be dropped.
function oracle(blocks) {
    const at = (value, inTable) => {
        const b = blocks.find((x) => x.text.includes(value) && (!inTable || x.where.startsWith('جدول')));
        return b ? [{ block: b.id, text: value }] : [];
    };
    const c = OLD.cards[0];
    return {
        fields: {
            nom_matloub: [...at(OLD.nom), { block: blocks[0].id, text: 'نص لم يرد في الملف' }],   // ← invented
            adresse: at(OLD.adresse), num_affiliation: at(OLD.aff), code_inscription: at(OLD.code),
            num_dossier: at(OLD.dossier), date_carte: at(OLD.date),
            num_carte: at(c.num, true), trimestre: at(c.tri, true), montant: at(c.mnt, true), date_penalite: at(c.pen, true),
            fee_original: [{ block: 99999, text: '30 000' }],                                          // ← no such block
            fee_stamp: at('200'),                                  // one fee cell of the footer grid: not enough to keep it
        },
    };
}

const NEW = [{ numcarte: '4699900001', semestre: '01/2025', dette: '1234.567', datesins: '16/04/2025', datecarte: '02/06/2026', nbrreg: '7777', fee_original: '30000', vat_rate: '19' },
    { numcarte: '4699900002', semestre: '02/2025', dette: '765.432', datesins: '16/07/2025', datecarte: '02/06/2026', nbrreg: '7777', fee_original: '30000', vat_rate: '19' }];
const NEW_CO = { nom_cl2: 'SARL NOUVEAU CLIENT', cl2_adresse: 'شارع جديد 1 تونس', numcnss: '999111', codeng: '05' };
const renderReal = (tpl) => textOf(renderActs([buildActRecord(NEW_CO, NEW)], {}, tpl));

let passed = 0;
const steps = [];
const test = (name, fn) => steps.push([name, fn]);

test('mail-merge file: every field mapped without AI, year + fee table made live', async () => {
    let calledAI = false;
    const r = await ti.build(fs.readFileSync(path.join(__dirname, 'fixtures', 'mailmerge-act.docx')), { mapWithAI: () => { calledAI = true; } });
    assert.strictEqual(r.report.mode, 'mergefield');
    assert.strictEqual(calledAI, false);
    const tags = r.report.found.map((f) => f.tag);
    for (const t of ['nom_matloub', 'adresse', 'num_affiliation', 'code_inscription', 'num_dossier', 'date_carte', 'num_carte', 'trimestre', 'montant', 'date_penalite', 'year_words']) assert.ok(tags.includes(t), t);
    assert.ok(r.report.feeTable);
    const t = renderReal(r.act);
    for (const s of ['SARL NOUVEAU CLIENT', 'شارع جديد 1 تونس', '999111', '7777', '4699900001', '4699900002', '1234.567', 'مراد القعــودي', '60,000']) assert.ok(t.includes(s), 'missing ' + s);
    assert.ok(!/«[^»]+»/.test(t), 'no merge placeholder left');
});
test('filled act: oracle quotes become tags, the 2nd card row is removed, invented answers are dropped', async () => {
    const src = filledAct();
    assert.ok(textOf(src).includes(OLD.cards[1].num), 'fixture has two card rows');
    const r = await ti.build(src, { mapWithAI: async (blocks) => oracle(blocks) });
    assert.strictEqual(r.report.mode, 'filled', JSON.stringify(r.report));
    assert.strictEqual(r.report.removedRows, 1);
    assert.ok(r.report.warnings.some((w) => w.includes('غير موجود حرفياً')), 'invented quote reported');
    assert.ok(r.report.warnings.some((w) => w.includes('موضع غير موجود')), 'bad block reported');
    assert.ok(r.report.feeTable, 'a partly mapped fee grid is replaced by the full live one');
    const t = renderReal(r.act);
    assert.ok(t.includes('60,000'), 'fees come from the cards (2 × 30,000)');
    for (const s of ['SARL NOUVEAU CLIENT', '4699900001', '4699900002', '765.432', '999111']) assert.ok(t.includes(s), 'missing ' + s);
    for (const s of [OLD.nom, OLD.cards[0].num, OLD.cards[1].num, OLD.adresse]) assert.ok(!t.includes(s), 'old data still printed: ' + s);
});
test('filled act without the AI (offline): falls back to the standard wording in the office look', async () => {
    const r = await ti.build(filledAct(), { mapWithAI: async () => { throw new Error('offline'); } });
    assert.strictEqual(r.report.mode, 'look');
    assert.ok(r.report.wordingFallback);
    const t = renderReal(r.act);
    assert.ok(t.includes('SARL NOUVEAU CLIENT') && t.includes('مراد القعــودي'), 'standard act with the office letterhead');
});
test('letterhead typed at the top of the page is found and moved into the header; font + margins carried', async () => {
    const src = typedLetterhead(filledAct());
    const r = await ti.build(src, { mapWithAI: async () => ({ fields: {} }) });
    assert.strictEqual(r.report.look.letterhead, 'أعلى الصفحة');
    assert.strictEqual(r.report.look.font, 'Traditional Arabic');
    assert.strictEqual(r.report.mode, 'look');
    const z = new PizZip(r.act);
    assert.ok(m.blocksOf(z.file('word/header1.xml').asText()).map((b) => b.text).join(' ').includes('مراد القعــودي'));
    assert.ok(z.file('word/document.xml').asText().includes('Traditional Arabic'));
    assert.ok(z.file('word/document.xml').asText().includes('w:left="1134"'));
    assert.ok(renderReal(r.act).includes('4699900002'));
});
test('the monthly bill takes the office letterhead and font', async () => {
    const r = await ti.build(typedLetterhead(filledAct()), { mapWithAI: async () => ({ fields: {} }) });
    const z = new PizZip(r.list);
    const header = Object.keys(z.files).filter((f) => /^word\/header\d*\.xml$/.test(f)).map((f) => z.file(f).asText()).join('');
    assert.ok(header.includes('مراد القعــودي') || m.blocksOf(header).some((b) => b.text.includes('القعــودي')));
    const { renderMonthlyList } = require('../server/services/listRender');
    const out = renderMonthlyList([{ id_cn_oe: 1, nom_cl2: 'X', numcarte: '1', date_tabligh: '2026-09-05', fee_original: '30000' }], { year: 2026, month: 9 }, r.list);
    assert.strictEqual(out.count, 1);
});
test('not a Word file → a clear Arabic error', async () => {
    await assert.rejects(ti.build(Buffer.from('hello')), /ليس ملف Word/);
});
test('quote matching ignores spacing differences but never invents', () => {
    assert.deepStrictEqual(ti.findLiteral('توجهنا إلى  SARL   X الكائن', 'SARL X', []), { a: 12, b: 20 });
    assert.strictEqual(ti.findLiteral('توجهنا إلى SARL X', 'SARL Y', []), null);
});

// ── routes: analyze → preview → apply → acts use it → back to standard ──
test('routes: nothing is active until «اعتماد», then acts and the bill use it; reset restores the standard', async () => {
    const { startServer } = require('../server/index.js');
    const server = await startServer({ port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'cnss2026' }) })).json()).token;
        const auth = { Authorization: `Bearer ${token}` };
        const fd = new FormData();
        fd.append('file', new Blob([fs.readFileSync(path.join(__dirname, 'fixtures', 'mailmerge-act.docx'))]), 'محضر.docx');
        const a = await (await fetch(`${base}/api/word-import/analyze`, { method: 'POST', headers: auth, body: fd })).json();
        assert.strictEqual(a.report.mode, 'mergefield');
        assert.strictEqual(fs.existsSync(config.templatePath()), false, 'not active before approval');
        const p = await (await fetch(`${base}/api/word-import/preview`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: 'act' }) })).json();
        assert.ok(p.ok && fs.existsSync(p.path), 'preview written');
        assert.ok((await (await fetch(`${base}/api/word-import/apply`, { method: 'POST', headers: auth })).json()).ok);
        assert.ok(fs.existsSync(config.templatePath()) && fs.existsSync(config.listTemplatePath()));
        const st = await (await fetch(`${base}/api/word-import/status`, { headers: auth })).json();
        assert.strictEqual(st.active.mode, 'mergefield');
        assert.ok(textOf(renderActs([buildActRecord(NEW_CO, NEW)])).includes('SARL NOUVEAU CLIENT'), 'acts render with the imported template');
        await fetch(`${base}/api/word-import`, { method: 'DELETE', headers: auth });
        assert.strictEqual(fs.existsSync(config.templatePath()), false);
        assert.strictEqual(fs.existsSync(config.listTemplatePath()), false);
    } finally { server.close(); }
});

(async () => {
    for (const [name, fn] of steps) {
        try { await fn(); passed++; console.log(`  ✓ ${name}`); }
        catch (e) { console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); process.exit(1); }
    }
    console.log(`\n${passed} passed.`);
    process.exit(0);
})();
