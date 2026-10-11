#!/usr/bin/env node
/*
 * Build server/assets/template_cnss.docx from the pristine original
 * (template_cnss.original.docx). Two transforms, both reproducible:
 *
 *  1. De-brand the letterhead (header + body): the original owner's name /
 *     address / phone / fax / tax-id → {office_*} merge fields.
 *  2. Move the fee table from the page FOOTER into the act BODY (inside the
 *     {#acts} loop, so each محضر gets its OWN fees) and turn its 12 value cells
 *     into {fee_*} merge fields.
 *
 *   node scripts/build-template.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ASSETS = path.join(__dirname, '..', 'server', 'assets');
const ORIGINAL = path.join(ASSETS, 'template_cnss.original.docx');
const OUT = path.join(ASSETS, 'template_cnss.docx');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const WT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

// The original author highlighted the variable runs in yellow as a "fill this in"
// marker. Those runs are merge fields now, so the highlight is just noise that
// prints on every act — drop every highlight, whatever its colour.
const stripHighlights = (xml) =>
    xml.replace(/<w:highlight\b[^>]*\/>/g, '').replace(/<w:highlight\b[^>]*>[\s\S]*?<\/w:highlight>/g, '');

// Rewrite the inner text of specific <w:t> runs by their order index in the part.
function applyRunEdits(xml, edits) {
    let i = -1;
    return xml.replace(WT, (full) => {
        i += 1;
        if (!(i in edits)) return full;
        const open = full.slice(0, full.indexOf('>') + 1);
        return open + esc(edits[i]) + '</w:t>';
    });
}

// ── 1. Letterhead de-brand (indices from the original run map) ──
const HEADER_EDITS = {
    5: '{office_name}', 6: '', 7: '', 8: '',
    17: '{office_address}', 18: '', 19: '', 20: '', 21: '', 22: '',
    23: 'الهاتف : {office_phone} ', 25: ' الفاكس : {office_fax}', 27: '{office_tax_id}',
};
const BODY_EDITS = {
    42: 'نحن الأستاذ {office_name} العدل المنفذ',
    47: 'عنواني {office_address}', 48: '', 49: '', 50: '', 51: '', 52: '', 53: ' والممضي أسفله',
};

// ── 2. Fee table: value-row cell (column) index → merge field ──
const FEE_TAGS = [
    '{fee_total}',        // 0  المجموع (auto-summed)
    '{fee_post}',         // 1  البريد
    '{fee_stamp}',        // 2  الترسيم
    '{fee_registration}', // 3  التسجيل
    '{fee_travel}',       // 4  التنقل
    '{fee_aqm}',          // 5  أ ق م
    '{fee_copies}',       // 6  نسخ الأوراق
    '{fee_movement}',     // 7  التوجه
    '{fee_office_copy}',  // 8  النسخة المكتبية
    '{fee_legal_copy}',   // 9  النسخة القانونية
    '{fee_counterparts}', // 10 النظائر
    '{fee_original}',     // 11 أصل المحضر
];

function fillCell(cellInner, tag) {
    if (WT.test(cellInner)) {
        WT.lastIndex = 0;
        return cellInner.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/, `$1${tag}$2`);
    }
    WT.lastIndex = 0;
    // Empty cell → inject a centered RTL run before the paragraph close.
    const run = `<w:r><w:rPr><w:rFonts w:hint="cs"/><w:rtl/></w:rPr><w:t>${tag}</w:t></w:r>`;
    return cellInner.replace('</w:p>', run + '</w:p>');
}

// NOTE: do not try to pin this table with tblpPr (a floating table) from the body.
// Verified in Word: any anchor variant (margin or page, with or without text-wrap
// distance) makes a single act render as three pages with the table stranded on
// the last one. The footer is the only reliable way to reach the page bottom.

function tagFeeTable(tblXml) {
    const rows = tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g); // [headerRow, valueRow]
    const valueRow = rows[1];
    let ci = -1;
    const newValueRow = valueRow.replace(/<w:tc>([\s\S]*?)<\/w:tc>/g, (full, inner) => {
        ci += 1;
        return '<w:tc>' + fillCell(inner, FEE_TAGS[ci] || '') + '</w:tc>';
    });
    return tblXml.replace(valueRow, newValueRow);
}

// ───────────────────────────── run it ─────────────────────────────
if (!fs.existsSync(ORIGINAL)) { console.error('Missing', ORIGINAL); process.exit(1); }
const zip = new PizZip(fs.readFileSync(ORIGINAL));

// Letterhead
zip.file('word/header1.xml', stripHighlights(applyRunEdits(zip.file('word/header1.xml').asText(), HEADER_EDITS)));
let doc = stripHighlights(applyRunEdits(zip.file('word/document.xml').asText(), BODY_EDITS));

// Tag the fee table IN PLACE, in the footer. A page footer is the only thing Word
// pins to the bottom of every page; as body content the table just follows the
// act's text and sits mid-page (and a floating table wrecks pagination outright).
// The footer being per-SECTION rather than per-act is handled at render time —
// services/actRender.js gives each محضر its own section and its own copy of this
// footer, filled with that act's amounts.
let footer = stripHighlights(zip.file('word/footer1.xml').asText());
const tbl = footer.slice(footer.indexOf('<w:tbl>'), footer.indexOf('</w:tbl>') + '</w:tbl>'.length);
if (!tbl) { console.error('No fee table found in word/footer1.xml'); process.exit(1); }
footer = footer.replace(tbl, tagFeeTable(tbl));
zip.file('word/footer1.xml', footer);

// The body keeps its {#acts} loop and the page break that separates acts; the
// render turns each of those breaks into a section break.
zip.file('word/document.xml', doc);

fs.writeFileSync(OUT, zip.generate({ type: 'nodebuffer' }));
console.log('Built', path.basename(OUT), '(letterhead de-branded + per-act fee table)');

// Office location + year as merge tags (no hardcoded Sousse / 2026), then one
// محضر can list several cards: repeat the card row per card ({#cards} loop).
const run = (script) => require('child_process').execFileSync(process.execPath, [path.join(__dirname, script), OUT], { stdio: 'inherit' });
run('parameterize-template.js');
run('add-card-rows-loop.js');
if (fs.existsSync(OUT + '.bak')) fs.unlinkSync(OUT + '.bak'); // the original is template_cnss.original.docx
