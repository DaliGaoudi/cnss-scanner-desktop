/*
 * "Import your own Word file": turn one of the office's own documents into the
 * templates the app prints with, so its acts keep the office's familiar look and
 * wording.
 *
 * Three ways in, tried in this order:
 *   1. MAIL-MERGE file — the office's act with Word merge fields («إسم_المطلوب»…).
 *      Field names map to our tags directly; no AI, nothing to guess.
 *   2. FILLED act — a real محضر with a real employer's data. An AI (through the
 *      licence server) says WHERE each data value is, quoting it exactly; every
 *      quote is checked word for word in the document before it becomes a tag.
 *   3. LOOK ONLY — when the wording can't be mapped reliably: the office's
 *      letterhead, Arabic font and margins applied to our standard act.
 * The monthly bill (قائمة مصاريف) always gets the letterhead and font (look only).
 *
 * Nothing here saves anything: build() returns buffers + a report the user
 * reviews (and previews in Word) before routes/wordImport.js activates them.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const m = require('./docxModel');

const ASSETS = path.join(__dirname, '..', 'assets');
const BUNDLED_ACT = path.join(ASSETS, 'template_cnss.docx');
const BUNDLED_LIST = path.join(ASSETS, 'template_list.docx');

// The act's own page break: actRender turns each into a per-act section break.
const PAGE_BREAK_P = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// ───────────────────────────── Fields ─────────────────────────────
const FIELDS = {
    nom_matloub: { label: 'اسم المطلوب', required: true, names: ['اسم المطلوب', 'المطلوب', 'اسم المؤجر', 'المؤجر', 'اسم الشركة'] },
    adresse: { label: 'العنوان', names: ['العنوان', 'عنوان المطلوب', 'عنوان المؤجر'] },
    num_affiliation: { label: 'عدد الإنخراط بالصندوق', names: ['عدد الانخراط بالصندوق', 'عدد الانخراط', 'رقم الانخراط'] },
    code_inscription: { label: 'رمز الإنخراط', names: ['رمز الانخراط', 'الرمز'] },
    num_dossier: { label: 'عدد التضمين', names: ['عدد الملف', 'عدد التضمين', 'رقم الملف'] },
    date_carte: { label: 'تاريخ بطاقة الجبر', names: ['تاريخ بطاقة الجبر', 'تاريخ البطاقة'] },
    year_words: { label: 'السنة (بالأحرف)', names: ['السنة'] },
    num_carte: { label: 'عدد البطاقة', required: true, card: true, names: ['عدد بطاقة الجبر', 'عدد البطاقة', 'رقم البطاقة'] },
    trimestre: { label: 'الثلاثية', card: true, names: ['الثلاثية'] },
    montant: { label: 'أصل الدين', card: true, names: ['المبلغ', 'اصل الدين', 'مبلغ الدين'] },
    date_penalite: { label: 'تاريخ احتساب الخطايا', card: true, names: ['تاريخ احتساب الخطايا'] },
    fee_original: { label: 'أصل المحضر', fee: true, names: [] },
    fee_counterparts: { label: 'النظائر', fee: true, names: [] },
    fee_legal_copy: { label: 'النسخة القانونية', fee: true, names: [] },
    fee_office_copy: { label: 'النسخة المكتبية', fee: true, names: [] },
    fee_movement: { label: 'التوجه', fee: true, names: [] },
    fee_copies: { label: 'نسخ الأوراق', fee: true, names: [] },
    fee_travel: { label: 'التنقل', fee: true, names: [] },
    fee_registration: { label: 'التسجيل', fee: true, names: [] },
    fee_stamp: { label: 'الترسيم', fee: true, names: [] },
    fee_post: { label: 'البريد', fee: true, names: [] },
    fee_aqm: { label: 'أ ق م', fee: true, names: [] },
    fee_total: { label: 'المجموع', fee: true, names: [] },
};
const CARD_TAGS = Object.keys(FIELDS).filter((k) => FIELDS[k].card);

// Arabic merge-field names vary in spelling: compare a normalised form.
const normName = (s) => String(s || '').replace(/[_\-]+/g, ' ').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const NAME_TO_TAG = new Map();
for (const [tag, f] of Object.entries(FIELDS)) f.names.forEach((n) => NAME_TO_TAG.set(normName(n), tag));
const tagForMergeName = (name) => NAME_TO_TAG.get(normName(name)) || null;

// ───────────────────────────── Parts ─────────────────────────────
const relsPathOf = (part) => part.replace(/^word\//, 'word/_rels/') + '.rels';

// The document's default header/footer part names (from the last sectPr).
function sectionParts(zip) {
    const doc = zip.file('word/document.xml').asText();
    const rels = zip.file('word/_rels/document.xml.rels') ? zip.file('word/_rels/document.xml.rels').asText() : '';
    const sect = doc.slice(doc.lastIndexOf('<w:sectPr'));
    const target = (kind) => {
        const ref = new RegExp(`<w:${kind}Reference\\b[^>]*w:type="default"[^>]*r:id="([^"]+)"`).exec(sect)
            || new RegExp(`<w:${kind}Reference\\b[^>]*r:id="([^"]+)"[^>]*w:type="default"`).exec(sect);
        if (!ref) return null;
        const rel = new RegExp(`<Relationship\\b[^>]*Id="${ref[1]}"[^>]*Target="([^"]+)"`).exec(rels)
            || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${ref[1]}"`).exec(rels);
        return rel ? 'word/' + rel[1].replace(/^\/?word\//, '') : null;
    };
    return { header: target('header'), footer: target('footer') };
}

// Blocks of the document + its default header/footer, with ids unique across parts.
function readBlocks(zip) {
    const parts = sectionParts(zip);
    const list = [['word/document.xml', 'body'], [parts.header, 'header'], [parts.footer, 'footer']]
        .filter(([p]) => p && zip.file(p));
    const all = [];
    for (const [part, where] of list) {
        m.blocksOf(zip.file(part).asText(), all.length).forEach((b) => all.push({ ...b, part, where }));
    }
    return all;
}

// The blocks as the AI sees them: one numbered line each, with where it sits.
function blocksForAI(blocks) {
    return blocks.filter((b) => b.text.trim()).map((b) => ({
        id: b.id,
        where: b.where === 'body' ? (b.table ? `جدول ${b.table.t + 1} صف ${b.table.r + 1} خانة ${b.table.c + 1}` : 'متن')
            : (b.where === 'header' ? 'ترويسة' : 'تذييل') + (b.table ? ` (جدول صف ${b.table.r + 1} خانة ${b.table.c + 1})` : ''),
        text: b.text.slice(0, 600),
    }));
}

// ───────────────────────────── Literal matching ─────────────────────────────
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Where `literal` sits in `text` (exact, else whitespace-insensitive), avoiding taken ranges.
function findLiteral(text, literal, taken) {
    const lit = String(literal || '').trim();
    if (!lit) return null;
    const free = (a, b) => !taken.some((t) => a < t.b && t.a < b);
    let i = -1;
    while ((i = text.indexOf(lit, i + 1)) !== -1) if (free(i, i + lit.length)) return { a: i, b: i + lit.length };
    const re = new RegExp(lit.split(/\s+/).map(escapeRe).join('\\s+'), 'g');
    let mm;
    while ((mm = re.exec(text)) !== null) if (free(mm.index, mm.index + mm[0].length)) return { a: mm.index, b: mm.index + mm[0].length };
    return null;
}

// ───────────────────────────── Building blocks ─────────────────────────────

// Wrap the table row holding the card tags in {#cards}…{/cards}: docxtemplater
// repeats a row whose loop opens in its first cell and closes in its last one.
// `dropFollowingRows` removes the other card rows of a filled act (same shape).
function loopCardRow(xml, dropFollowingRows) {
    const tagAt = CARD_TAGS.map((t) => xml.indexOf(`{${t}}`)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (tagAt === undefined) return { xml, ok: false, dropped: 0 };
    const rowStart = Math.max(xml.lastIndexOf('<w:tr ', tagAt), xml.lastIndexOf('<w:tr>', tagAt));
    let rowEnd = xml.indexOf('</w:tr>', tagAt);
    if (rowStart < 0 || rowEnd < 0) return { xml, ok: false, dropped: 0 };
    rowEnd += '</w:tr>'.length;
    let row = xml.slice(rowStart, rowEnd);
    const rowBlocks = m.blocksOf(row);
    if (!rowBlocks.length) return { xml, ok: false, dropped: 0 };
    // Text edits change lengths: do the end first, then the start.
    const last = rowBlocks[rowBlocks.length - 1];
    row = row.slice(0, last.start) + m.appendText(last.xml, '{/cards}') + row.slice(last.end);
    const first = m.blocksOf(row)[0];
    row = row.slice(0, first.start) + m.prependText(first.xml, '{#cards}') + row.slice(first.end);

    let after = xml.slice(rowEnd);
    let dropped = 0;
    if (dropFollowingRows) {
        const cells = (xml.slice(rowStart, rowEnd).match(/<w:tc\b/g) || []).length;
        for (;;) {
            const next = /^\s*(<w:tr\b[\s\S]*?<\/w:tr>)/.exec(after);
            if (!next || (next[1].match(/<w:tc\b/g) || []).length !== cells) break;
            after = after.slice(next[0].length);
            dropped += 1;
        }
    }
    return { xml: xml.slice(0, rowStart) + row + after, ok: true, dropped };
}

// The whole body becomes one act, repeated once per محضر: {#acts} … page break {/acts}.
function wrapActsLoop(xml) {
    const bodyOpen = /<w:body>/.exec(xml);
    const sectAt = xml.lastIndexOf('<w:sectPr');
    if (!bodyOpen || sectAt < 0) throw new Error('document body not found');
    const start = bodyOpen.index + bodyOpen[0].length;
    return xml.slice(0, start) + '<w:p><w:r><w:t>{#acts}</w:t></w:r></w:p>' + xml.slice(start, sectAt)
        + PAGE_BREAK_P + '<w:p><w:r><w:t>{/acts}</w:t></w:r></w:p>' + xml.slice(sectAt);
}

// ───────────────────────────── Mode 1: mail merge ─────────────────────────────
function fromMergeFields(zip) {
    const found = new Map();      // tag → merge name
    const unknown = new Set();
    const parts = new Set(readBlocks(zip).map((b) => b.part));
    for (const part of parts) {
        const xml = zip.file(part).asText();
        if (!m.hasMergeFields(xml)) continue;
        const edits = m.blocksOf(xml).map((b) => {
            const r = m.convertMergeFields(b.xml, (name) => {
                const tag = tagForMergeName(name);
                if (!tag) { unknown.add(name); return ''; }
                if (!found.has(tag)) found.set(tag, name);
                return `{${tag}}`;
            });
            return r.names.length ? { start: b.start, end: b.end, xml: r.xml } : null;
        }).filter(Boolean);
        zip.file(part, m.splice(xml, edits));
    }
    const report = {
        found: [...found].map(([tag, name]) => ({ tag, label: FIELDS[tag].label, source: `حقل الدمج «${name}»` })),
        warnings: [...unknown].map((n) => `حقل دمج غير معروف «${n}» — حُذف من النموذج.`),
    };
    return report;
}

// ───────────────────────────── Mode 2: filled act ─────────────────────────────
/*
 * `mapping` = { fields: { tag: [{ block, text }] } } from the AI. Every quote must
 * be found, word for word, in the block it names; anything else is dropped and
 * reported. Card values must sit in one table row (the row becomes the loop).
 */
function fromFilledAct(zip, blocks, mapping) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const found = [];
    const warnings = [];
    const perBlock = new Map();   // block id → [{ a, b, tag }]
    for (const [tag, hits] of Object.entries((mapping && mapping.fields) || {})) {
        if (!FIELDS[tag]) continue;
        for (const hit of [].concat(hits || [])) {
            const b = byId.get(Number(hit && hit.block));
            if (!b) { warnings.push(`${FIELDS[tag].label}: موضع غير موجود في الملف — تُجوهل.`); continue; }
            const taken = perBlock.get(b.id) || [];
            const r = findLiteral(b.text, hit.text, taken);
            if (!r) { warnings.push(`${FIELDS[tag].label}: النص «${String(hit.text).slice(0, 40)}» غير موجود حرفياً — تُجوهل.`); continue; }
            if (FIELDS[tag].card && !b.table) { warnings.push(`${FIELDS[tag].label}: ليس في جدول البطاقات — تُجوهل.`); continue; }
            taken.push({ ...r, tag });
            perBlock.set(b.id, taken);
            if (!found.some((f) => f.tag === tag)) found.push({ tag, label: FIELDS[tag].label, source: `«${b.text.slice(r.a, r.b)}»` });
        }
    }
    // Card fields must share one table row.
    const cardRows = new Set();
    for (const [id, ranges] of perBlock) {
        if (ranges.some((r) => FIELDS[r.tag].card)) { const b = byId.get(id); cardRows.add(`${b.part}|${b.table.t}|${b.table.r}`); }
    }
    if (cardRows.size > 1) warnings.push('قيم البطاقة موزّعة على أكثر من صف — اعتُمد صف البطاقة الأول فقط.');

    // Rewrite each block, its ranges right to left so offsets hold.
    const editsByPart = new Map();
    for (const [id, ranges] of perBlock) {
        const b = byId.get(id);
        let x = b.xml;
        for (const r of [...ranges].sort((p, q) => q.a - p.a)) x = m.replaceRange(x, r.a, r.b, `{${r.tag}}`);
        if (!editsByPart.has(b.part)) editsByPart.set(b.part, []);
        editsByPart.get(b.part).push({ start: b.start, end: b.end, xml: x });
    }
    for (const [part, edits] of editsByPart) zip.file(part, m.splice(zip.file(part).asText(), edits));
    return { found, warnings };
}

// «من سنة ستة وعشرين وألفين» typed as text → {year_words}, so the act prints the
// year it is drawn up in (recent years only: an old year is more likely a date
// the office meant).
function tagYearWords(zip) {
    const { yearInArabicWords } = require('./numberToArabicWords');
    const now = new Date().getFullYear();
    const words = [now, now - 1, now - 2, now + 1].map(yearInArabicWords);
    const xml = zip.file('word/document.xml').asText();
    if (xml.includes('{year_words}')) return true;
    for (const b of m.blocksOf(xml)) {
        for (const w of words) {
            const r = findLiteral(b.text, w, []);
            if (r) { zip.file('word/document.xml', m.splice(xml, [{ start: b.start, end: b.end, xml: m.replaceRange(b.xml, r.a, r.b, '{year_words}') }])); return true; }
        }
    }
    return false;
}

// A footer fee table (the usual «أصل المحضر / النظائر …» grid) that isn't fully
// live — fixed amounts, or only the cells that happened to hold an amount mapped —
// would print stale or missing fees: swap it for our tagged one, which the app
// fills per act for every fee. Returns true when swapped.
const FEE_LABELS = ['أصل المحضر', 'النظائر', 'النسخة القانونية', 'النسخة المكتبية', 'التوجه', 'نسخ الأوراق',
    'التسجيل', 'الترسيم', 'البريد', 'التنقل'];
function adoptFeeFooter(zip) {
    const footer = sectionParts(zip).footer;
    if (!footer || !zip.file(footer)) return false;
    const fx = zip.file(footer).asText();
    const text = m.blocksOf(fx).map((b) => b.text).join(' ');
    const labels = FEE_LABELS.filter((l) => text.includes(l)).length;
    const live = new Set(text.match(/\{fee_(?!total|aqm|ajr_total|exp_total)[a-z_]+\}/g) || []).size;
    if (labels < 3 || live >= labels) return false;
    const bundled = new PizZip(fs.readFileSync(BUNDLED_ACT));
    const ours = sectionParts(bundled).footer;
    zip.file(footer, bundled.file(ours).asText());
    zip.file(relsPathOf(footer), relsOf(bundled, relsPathOf(ours))
        || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    return true;
}

// Numbers/dates left in the body or footer that look like case data: they would
// print on every act. Shown to the user, who decides.
function leftoverData(zip) {
    const footer = sectionParts(zip).footer;
    const parts = ['word/document.xml', footer].filter((p) => p && zip.file(p));
    const text = parts.map((p) => m.blocksOf(zip.file(p).asText()).map((b) => b.text).join('\n')).join('\n')
        .replace(/\{[#/]?[a-z_]+\}/g, ' ');
    const hits = text.match(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b|\b\d+[.,]\d{3}\b|\b\d{5,}\b/g) || [];
    return [...new Set(hits)].slice(0, 12);
}

// ───────────────────────────── Look (letterhead, font, margins) ─────────────────────────────
const MEDIA_TYPES = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', emf: 'image/x-emf', wmf: 'image/x-wmf', tif: 'image/tiff', tiff: 'image/tiff' };

// The font + size most of the body text is set in (by characters, complex script = Arabic).
function dominantFont(zip) {
    const xml = zip.file('word/document.xml').asText();
    const fonts = {};
    const sizes = {};
    for (const r of xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
        const t = [...r[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join('');
        if (!t.trim()) continue;
        const f = (/<w:rFonts\b[^>]*w:cs="([^"]+)"/.exec(r[1]) || [])[1];
        const s = (/<w:szCs w:val="(\d+)"/.exec(r[1]) || /<w:sz w:val="(\d+)"/.exec(r[1]) || [])[1];
        if (f) fonts[f] = (fonts[f] || 0) + t.length;
        if (s) sizes[s] = (sizes[s] || 0) + t.length;
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
    let font = top(fonts) && top(fonts)[0];
    if (!font && zip.file('word/styles.xml')) {
        font = (/<w:docDefaults>[\s\S]*?w:cs="([^"]+)"/.exec(zip.file('word/styles.xml').asText()) || [])[1];
    }
    return { font: font || null, size: top(sizes) ? top(sizes)[0] : null };
}

const pgMarOf = (zip) => {
    const xml = zip.file('word/document.xml').asText();
    return (xml.slice(xml.lastIndexOf('<w:sectPr')).match(/<w:pgMar\b[^>]*\/>/) || [])[0] || null;
};

// Top-level body elements (paragraphs and tables), for a letterhead typed in the page.
function topLevelElements(xml) {
    const body = /<w:body>/.exec(xml);
    const out = [];
    let i = body.index + body[0].length;
    const end = xml.lastIndexOf('<w:sectPr');
    while (i < end) {
        const open = /<w:(p|tbl|sdt)\b[^>]*?(\/?)>/g;
        open.lastIndex = i;
        const mm = open.exec(xml);
        if (!mm || mm.index >= end) break;
        if (mm[2]) { out.push({ start: mm.index, end: mm.index + mm[0].length }); i = mm.index + mm[0].length; continue; }
        // find the matching close, counting nesting of the same tag
        const re = new RegExp(`<(/?)w:${mm[1]}\\b[^>]*?(/?)>`, 'g');
        re.lastIndex = mm.index;
        let depth = 0;
        let close = -1;
        let t;
        while ((t = re.exec(xml)) !== null) {
            if (t[2]) continue;
            depth += t[1] ? -1 : 1;
            if (depth === 0) { close = t.index + t[0].length; break; }
        }
        if (close < 0) break;
        out.push({ start: mm.index, end: close });
        i = close;
    }
    return out;
}

/*
 * Where the office's letterhead is: Word's header area if it has anything in it,
 * else the top of the page down to the act title («محضر»). null when neither.
 */
function findLetterhead(zip) {
    const parts = sectionParts(zip);
    if (parts.header && zip.file(parts.header)) {
        const hx = zip.file(parts.header).asText();
        if (m.blocksOf(hx).some((b) => b.text.trim()) || /<w:drawing|<w:pict|<v:imagedata/.test(hx)) {
            return { kind: 'header', part: parts.header };
        }
    }
    const xml = zip.file('word/document.xml').asText();
    const title = m.blocksOf(xml).find((b) => /محضر/.test(b.text));
    if (!title) return null;
    const els = topLevelElements(xml).filter((e) => e.end <= title.start);
    if (!els.length || els.length > 15) return null;
    return { kind: 'body', xml: xml.slice(els[0].start, els[els.length - 1].end), range: { start: els[0].start, end: els[els.length - 1].end } };
}

const relsOf = (zip, relsPath) => (zip.file(relsPath) ? zip.file(relsPath).asText() : '');
const relEntries = (relsXml) => [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)].map((x) => ({
    xml: x[0], id: (/Id="([^"]+)"/.exec(x[0]) || [])[1], target: (/Target="([^"]+)"/.exec(x[0]) || [])[1],
    type: (/Type="([^"]+)"/.exec(x[0]) || [])[1], external: /TargetMode="External"/.test(x[0]),
}));

// Copy the relationships `ids` (images etc.) from a source part's rels into a new
// rels file for the target, renaming media so nothing collides.
function copyRels(src, srcRelsPath, ids, dst) {
    const out = [];
    for (const r of relEntries(relsOf(src, srcRelsPath)).filter((e) => ids.has(e.id))) {
        if (r.external || !/\/image$/.test(r.type)) { out.push(r.xml); continue; }
        const srcPath = 'word/' + r.target.replace(/^\/?word\//, '');
        const file = src.file(srcPath);
        if (!file) continue;
        const ext = (path.extname(srcPath).slice(1) || 'png').toLowerCase();
        const name = `media/imported_${Date.now().toString(36)}_${out.length}.${ext}`;
        dst.file('word/' + name, file.asUint8Array());
        ensureContentType(dst, ext);
        out.push(r.xml.replace(/Target="[^"]+"/, `Target="${name}"`));
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + out.join('') + '</Relationships>';
}
function ensureContentType(zip, ext) {
    const ct = zip.file('[Content_Types].xml').asText();
    if (new RegExp(`Extension="${ext}"`, 'i').test(ct)) return;
    zip.file('[Content_Types].xml', ct.replace('</Types>', `<Default Extension="${ext}" ContentType="${MEDIA_TYPES[ext] || 'application/octet-stream'}"/></Types>`));
}
const relIdsIn = (xml) => new Set([...xml.matchAll(/r:(?:embed|id|link|pict)="([^"]+)"/g)].map((x) => x[1]));

// Replace the target's default header with the source's letterhead.
function applyLetterhead(dst, src, letterhead) {
    const dstHeader = sectionParts(dst).header;
    if (!dstHeader) return false;
    let headerXml;
    let relsXml;
    if (letterhead.kind === 'header') {
        headerXml = src.file(letterhead.part).asText();
        relsXml = copyRels(src, relsPathOf(letterhead.part), relIdsIn(headerXml), dst);
    } else {
        const docXml = src.file('word/document.xml').asText();
        const root = (/<w:document\b([^>]*)>/.exec(docXml) || [, ''])[1];
        let inner = letterhead.xml;
        if (!/<\/w:p>\s*$/.test(inner)) inner += '<w:p/>';          // a header must end with a paragraph
        headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:hdr${root}>${inner}</w:hdr>`;
        relsXml = copyRels(src, 'word/_rels/document.xml.rels', relIdsIn(inner), dst);
    }
    dst.file(dstHeader, headerXml);
    dst.file(relsPathOf(dstHeader), relsXml);
    return true;
}

// Swap the target's dominant Arabic font (and optionally size) for the source's.
function applyFont(dst, look, { size }) {
    const from = dominantFont(dst);
    const parts = Object.keys(dst.files).filter((f) => /^word\/(document|footer\d*|header\d*|styles)\.xml$/.test(f));
    for (const p of parts) {
        let x = dst.file(p).asText();
        if (look.font && from.font && look.font !== from.font) {
            x = x.replace(new RegExp(`(w:(?:cs|ascii|hAnsi|eastAsia)=")${escapeRe(from.font)}"`, 'g'), `$1${m.xmlEscape(look.font)}"`);
        }
        if (size && p === 'word/document.xml' && look.size && from.size && look.size !== from.size) {
            x = x.replace(new RegExp(`(<w:(?:szCs|sz) w:val=")${from.size}"`, 'g'), `$1${look.size}"`);
        }
        dst.file(p, x);
    }
}
function applyMargins(dst, pgMar) {
    if (!pgMar) return;
    const x = dst.file('word/document.xml').asText();
    const at = x.lastIndexOf('<w:sectPr');
    dst.file('word/document.xml', x.slice(0, at) + x.slice(at).replace(/<w:pgMar\b[^>]*\/>/, pgMar));
}

// A bundled template dressed in the source's look.
function withLook(bundledPath, src, look, opts) {
    const dst = new PizZip(fs.readFileSync(bundledPath));
    if (look.letterhead) applyLetterhead(dst, src, look.letterhead);
    applyFont(dst, look, { size: opts.size });
    if (opts.margins) applyMargins(dst, look.pgMar);
    return dst.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function readLook(src) {
    const f = dominantFont(src);
    return { letterhead: findLetterhead(src), font: f.font, size: f.size, pgMar: pgMarOf(src) };
}

// ───────────────────────────── Verification ─────────────────────────────
// Two acts of two cards each, with values found nowhere in a real document, so
// their presence in the output proves each tag merged where it should.
const SAMPLE_CARD = (n) => ({ num_carte: `90000000${n}1`, trimestre: `0${n}/2025`, montant: `${n}11.111`, date_penalite: `16/0${n}/2025` });
const SAMPLE_ACTS = [1, 2].map((a) => ({
    nom_matloub: `شركة النموذج ${a}`, adresse: `عنوان تجريبي ${a}`, num_affiliation: `77777${a}`, code_inscription: `0${a}`,
    num_dossier: `555${a}`, date_carte: `0${a}/02/2026`, year_words: 'سنة النموذج',
    cards: [SAMPLE_CARD(a), SAMPLE_CARD(a + 2)], ...SAMPLE_CARD(a),
    fee_original: '30,000', fee_total: '80,200',
}));
const sampleValue = (tag) => (tag in SAMPLE_ACTS[0] ? String(SAMPLE_ACTS[0][tag]) : null);

// null when the act template renders the sample correctly, else why not (Arabic).
function verifyAct(buffer, tags) {
    let out;
    try { out = require('./actRender').renderActs(SAMPLE_ACTS, undefined, buffer); }
    catch (e) {
        const why = ((e.properties && e.properties.errors) || []).map((x) => (x.properties && x.properties.explanation) || x.message).join(' • ') || e.message;
        return 'تعذّر إنشاء محضر تجريبي من الملف: ' + why;
    }
    const z = new PizZip(out);
    const text = Object.keys(z.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f))
        .map((f) => m.blocksOf(z.file(f).asText()).map((b) => b.text).join('\n')).join('\n');
    if (/\{[#/]?[a-z_]+\}/.test(text)) return 'بقيت حقول غير مدمجة في المحضر التجريبي.';
    const lost = tags.filter((t) => !FIELDS[t].fee && sampleValue(t) && !text.includes(sampleValue(t)));
    if (lost.length) return 'لم تظهر هذه البيانات في المحضر التجريبي: ' + lost.map((t) => FIELDS[t].label).join('، ');
    if (!text.includes(SAMPLE_CARD(3).num_carte)) return 'جدول البطاقات لا يتكرّر لكل بطاقة.';
    return null;
}

// ───────────────────────────── Build ─────────────────────────────
/**
 * @param {Buffer} buffer       the office's .docx
 * @param {{ mapWithAI?: (blocks) => Promise<{fields}> }} opts  (filled acts only)
 * @returns {{ act: Buffer, list: Buffer, report }}
 */
async function build(buffer, { mapWithAI } = {}) {
    let src;
    try { src = new PizZip(buffer); } catch (e) { throw new Error('الملف ليس ملف Word صالحاً (.docx).'); }
    if (!src.file('word/document.xml')) throw new Error('الملف ليس ملف Word صالحاً (.docx).');

    const look = readLook(src);
    const report = {
        mode: null, found: [], missing: [], warnings: [], leftovers: [], removedRows: 0,
        look: {
            letterhead: look.letterhead ? (look.letterhead.kind === 'header' ? 'ترويسة Word' : 'أعلى الصفحة') : null,
            font: look.font, size: look.size ? Number(look.size) / 2 : null,
        },
    };
    if (!look.letterhead) report.warnings.push('لم نجد ترويسة في الملف — تبقى الترويسة العادية للبرنامج.');

    // The monthly bill always takes the letterhead + font only (its tables need our layout).
    const list = withLook(BUNDLED_LIST, src, look, { size: false, margins: false });

    // Wording: mail merge first, else a filled act through the AI.
    const work = new PizZip(buffer);
    const docXml = work.file('word/document.xml').asText();
    if (/\{[#/]?[a-z_]+\}/.test(m.blocksOf(docXml).map((b) => b.text).join(' '))) {
        report.warnings.push('الملف يحتوي على حقول بصيغة {…} — استعمل «رفع نموذج» في الإعدادات بدل الاستيراد.');
    }
    let wording = null;
    if (m.hasMergeFields(docXml)) {
        report.mode = 'mergefield';
        wording = fromMergeFields(work);
    } else if (mapWithAI) {
        report.mode = 'filled';
        const blocks = readBlocks(work);
        let mapping;
        try { mapping = await mapWithAI(blocksForAI(blocks)); }
        catch (e) { report.warnings.push('تعذّر تحليل نص الملف: ' + e.message); }
        if (mapping) wording = fromFilledAct(work, blocks, mapping);
    }
    if (wording) {
        report.found = wording.found;
        report.warnings.push(...wording.warnings);
    }

    // Usable as the act only with the employer and the card row in place.
    const has = (t) => report.found.some((f) => f.tag === t);
    let act = null;
    if (wording && has('nom_matloub') && has('num_carte')) {
        let xml = work.file('word/document.xml').asText();
        const loop = loopCardRow(xml, report.mode === 'filled');
        if (loop.ok) {
            report.removedRows = loop.dropped;
            work.file('word/document.xml', wrapActsLoop(loop.xml));
            if (!has('year_words') && tagYearWords(work)) report.found.push({ tag: 'year_words', label: FIELDS.year_words.label, source: 'السنة المكتوبة بالأحرف' });
            if (adoptFeeFooter(work)) {
                report.feeTable = 'عُوّض جدول الأجور في أسفل الصفحة بجدول يُملأ تلقائياً لكل محضر بكل الأجور والمصاريف.';
                report.found = report.found.filter((f) => !FIELDS[f.tag].fee);
            }
            report.leftovers = leftoverData(work);
            act = work.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
            const problem = verifyAct(act, report.found.map((f) => f.tag));
            if (problem) { report.warnings.push(problem); act = null; }
        }
    }
    report.missing = Object.entries(FIELDS)
        .filter(([t, f]) => !f.fee && !has(t))
        .map(([tag, f]) => ({ tag, label: f.label, required: !!f.required }));

    if (!act) {
        report.wordingFallback = report.mode
            ? 'لم نتمكّن من تحديد اسم المطلوب وجدول البطاقات في نص ملفكم بدقّة، فاعتمدنا نص المحضر العادي بترويستكم وخطّكم.'
            : 'اعتمدنا نص المحضر العادي بترويستكم وخطّكم.';
        report.mode = 'look';
        act = withLook(BUNDLED_ACT, src, look, { size: true, margins: true });
    }
    return { act, list, report };
}

module.exports = {
    build, FIELDS, tagForMergeName, findLiteral, loopCardRow, wrapActsLoop, readBlocks, blocksForAI,
    findLetterhead, dominantFont, verifyAct, SAMPLE_ACTS, PAGE_BREAK_P,
};
