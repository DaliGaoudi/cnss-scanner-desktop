const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { computeFees, formatMillimes } = require('./cnssFees');
const { amountInWords } = require('./numberToArabicWords');
const { officeMergeData, listTemplatePath } = require('../config');

/*
 * Monthly "قائمة مصاريف محاضر تبليغ بطاقات جبر" — one row per بطاقة جبر whose act
 * was delivered (تاريخ التبليغ) in the chosen month, with the per-act الأجور / أ ق م
 * (VAT) / مصاريف / total columns, a totals row and the grand total in Arabic words.
 */
const LIST_TEMPLATE = path.join(__dirname, '..', 'assets', 'template_list.docx');

// Tunisian month names (index 1..12), as used on the bailiff's list.
const MONTHS = ['', 'جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// Accepts "YYYY-MM-DD" (date input) or "DD/MM/YYYY" (manual). Returns {y,m,d} | null.
const parseYMD = (s) => {
    s = String(s || '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return { y: +m[3], m: +m[2], d: +m[1] };
    return null;
};
const fmtDMY = (s) => {
    const p = parseYMD(s);
    return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}` : String(s || '');
};
const fmt = (mm) => (mm > 0 ? formatMillimes(mm) : '0,000');

// Build the docxtemplater payload from joined card+company rows for one month.
const buildListData = (joinedRows, { year, month }) => {
    const y = parseInt(year, 10), mo = parseInt(month, 10);
    const inMonth = joinedRows
        .map((r) => ({ r, p: parseYMD(r.date_tabligh) }))
        .filter((x) => x.p && x.p.y === y && x.p.m === mo)
        .sort((a, b) => (a.p.d - b.p.d) || ((a.r.id_cn_oe || 0) - (b.r.id_cn_oe || 0)));

    const totals = { ajr: 0, vat: 0, exp: 0, total: 0 };
    const rows = inMonth.map(({ r }, i) => {
        const f = computeFees(r);
        totals.ajr += f.ajr; totals.vat += f.vat; totals.exp += f.exp; totals.total += f.total;
        return {
            rang: i + 1,
            nbrreg: r.nbrreg || '', codeng: r.codeng || '', numcnss: r.numcnss || '', numcarte: r.numcarte || '',
            nom: r.nom_cl2 || '',
            adresse: [r.cl2_adresse, r.cl2_adresse2].filter(Boolean).join(' '),
            date_tabligh: fmtDMY(r.date_tabligh),
            ajr: fmt(f.ajr), vat: fmt(f.vat), exp: fmt(f.exp), total: fmt(f.total),
        };
    });

    const now = new Date();
    return {
        ...officeMergeData(),
        list_date: `${String(now.getDate()).padStart(2, '0')} ${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`,
        list_month: `${MONTHS[mo] || ''} ${y}`,
        rows,
        t_ajr: fmt(totals.ajr), t_vat: fmt(totals.vat), t_exp: fmt(totals.exp), t_total: fmt(totals.total),
        amount_words: amountInWords(totals.total),
        count: rows.length,
    };
};

// The office's own list (from the Word import) wins over the bundled one;
// `templateBuffer` renders one that isn't active yet (the import preview).
const activeListTemplate = () => (fs.existsSync(listTemplatePath()) ? listTemplatePath() : LIST_TEMPLATE);

const renderMonthlyList = (joinedRows, opts, templateBuffer) => {
    const data = buildListData(joinedRows, opts);
    const zip = new PizZip(templateBuffer || fs.readFileSync(activeListTemplate()));
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render(data);
    return { buffer: doc.getZip().generate({ type: 'nodebuffer' }), count: data.count };
};

/*
 * Every delivered card grouped by its تاريخ التبليغ month, newest month first —
 * the on-screen facturation page (client/src/pages/FacturationCNSS.jsx). Same rows
 * and amounts as the Word list for each month. Mirrors the webapp's function.
 */
const buildMonthlyGroups = (joinedRows) => {
    const groups = new Map(); // "y-m" → group
    for (const r of joinedRows) {
        const p = parseYMD(r.date_tabligh);
        if (!p) continue;
        const key = `${p.y}-${p.m}`;
        if (!groups.has(key)) {
            groups.set(key, { year: p.y, month: p.m, label: `${MONTHS[p.m] || ''} ${p.y}`,
                items: [], totals: { ajr: 0, vat: 0, exp: 0, total: 0 } });
        }
        const g = groups.get(key);
        const f = computeFees(r);
        g.totals.ajr += f.ajr; g.totals.vat += f.vat; g.totals.exp += f.exp; g.totals.total += f.total;
        g.items.push({ p, r, f });
    }

    let grand = 0;
    const months = [...groups.values()]
        .sort((a, b) => (b.year - a.year) || (b.month - a.month))
        .map((g) => {
            g.items.sort((a, b) => (a.p.d - b.p.d) || ((a.r.id_cn_oe || 0) - (b.r.id_cn_oe || 0)));
            grand += g.totals.total;
            const rows = g.items.map(({ r, f }, i) => ({
                rang: i + 1, id_cn: r.id_cn, id_cn_oe: r.id_cn_oe,
                nbrreg: r.nbrreg || '', codeng: r.codeng || '', numcnss: r.numcnss || '', numcarte: r.numcarte || '',
                nom: r.nom_cl2 || '', date_tabligh: fmtDMY(r.date_tabligh),
                ajr: fmt(f.ajr), vat: fmt(f.vat), exp: fmt(f.exp), total: fmt(f.total),
            }));
            return { year: g.year, month: g.month, label: g.label, count: rows.length, rows,
                t_ajr: fmt(g.totals.ajr), t_vat: fmt(g.totals.vat), t_exp: fmt(g.totals.exp), t_total: fmt(g.totals.total) };
        });

    return { months, grandTotal: fmt(grand) };
};

module.exports = { renderMonthlyList, buildListData, buildMonthlyGroups, parseYMD, MONTHS };
