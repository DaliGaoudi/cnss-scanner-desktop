/*
 * Build server/assets/template_list.docx — the monthly "قائمة مصاريف محاضر تبليغ
 * بطاقات جبر" template — by cloning the (de-branded) act template and replacing
 * its body with a landscape billing table.
 *
 * Cloning template_cnss.docx reuses Word-proven scaffolding: styles.xml, fonts,
 * the {office_*} letterhead (header1.xml) and the section's header/footer refs.
 * We keep <w:sectPr> (switched to landscape) and rewrite everything before it.
 *
 * The bilingual (Arabic + French) letterhead — with RIB and CNSS — is lifted
 * verbatim from the bailiff's own list document (list_letterhead.source.docx)
 * and de-branded: the owner-specific runs become {office_*} merge tags so each
 * customer's onboarding details fill it.
 *
 * docxtemplater tags (default { } delimiters):
 *   letterhead (header1) → {office_name} {office_name_fr} {office_city} {office_address}
 *                          {office_phone} {office_fax} {office_tax_id} {office_rib} {office_cnss}
 *   title block       → {office_city} {list_date} {list_month}
 *   table row loop     → {#rows} {rang} {nbrreg} {codeng} {numcnss} {numcarte}
 *                        {nom} {adresse} {date_tabligh} {ajr} {vat} {exp} {total} {/rows}
 *   totals row         → {t_ajr} {t_vat} {t_exp} {t_total}
 *   closing line       → {amount_words}
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const SRC = path.join(__dirname, '..', 'server', 'assets', 'template_cnss.docx');
const LETTERHEAD_SRC = path.join(__dirname, '..', 'server', 'assets', 'list_letterhead.source.docx');
const OUT = path.join(__dirname, '..', 'server', 'assets', 'template_list.docx');

// 12 logical columns (RTL display via <w:bidiVisual/>). Widths in twips (dxa),
// sized for landscape A4 usable width (~15250 twips).
const COL_W = [520, 720, 760, 1180, 1300, 2500, 3090, 1100, 1090, 900, 1090, 1000];
const HEAD = ['العدد الرتبي', 'عدد الملف', 'رمز الإنخراط', 'عدد الإنخراط بالصندوق', 'عدد بطاقة الجبر',
    'اسم المطلوب', 'العنوان', 'تاريخ التبليغ', 'مجموع الأجور', 'أ ق م', 'مجموع المصاريف', 'أجرة المحضر'];
const ROW = ['{#rows}{rang}', '{nbrreg}', '{codeng}', '{numcnss}', '{numcarte}', '{nom}', '{adresse}',
    '{date_tabligh}', '{ajr}', '{vat}', '{exp}', '{total}{/rows}'];

const esc = (s) => String(s).replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One RTL paragraph (used in cells and standalone).
function para(text, { bold = false, size = 16, align = 'center' } = {}) {
    const b = bold ? '<w:b/><w:bCs/>' : '';
    const rpr = `<w:rPr><w:rFonts w:hint="cs"/>${b}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rtl/></w:rPr>`;
    const ppr = `<w:pPr><w:bidi/><w:jc w:val="${align}"/>${rpr}</w:pPr>`;
    return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function cell(text, { w, span, bold = false, size = 16, fill } = {}) {
    const tcPr = `<w:tcPr>${w ? `<w:tcW w:w="${w}" w:type="dxa"/>` : ''}` +
        `${span ? `<w:gridSpan w:val="${span}"/>` : ''}` +
        `${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}` +
        `<w:vAlign w:val="center"/></w:tcPr>`;
    return `<w:tc>${tcPr}${para(text, { bold, size })}</w:tc>`;
}

function row(cells) { return `<w:tr><w:trPr><w:jc w:val="center"/></w:trPr>${cells.join('')}</w:tr>`; }

function buildTable() {
    const grid = `<w:tblGrid>${COL_W.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    const border = '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>';
    const tblPr = `<w:tblPr><w:tblStyle w:val="Grilledutableau"/><w:bidiVisual/>` +
        `<w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/>` +
        `<w:tblLayout w:type="fixed"/><w:tblBorders>${border}</w:tblBorders>` +
        `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;

    const headRow = row(HEAD.map((t, i) => cell(t, { w: COL_W[i], bold: true, size: 16, fill: 'D9E2F3' })));
    const bodyRow = row(ROW.map((t, i) => cell(t, { w: COL_W[i], size: 15 })));

    // Totals: first 8 columns merged, then the 4 money totals.
    const mergedW = COL_W.slice(0, 8).reduce((a, b) => a + b, 0);
    const totalRow = row([
        cell('المجموع العام :', { w: mergedW, span: 8, bold: true, size: 16, fill: 'EDEDED' }),
        cell('{t_ajr}', { w: COL_W[8], bold: true, size: 16, fill: 'EDEDED' }),
        cell('{t_vat}', { w: COL_W[9], bold: true, size: 16, fill: 'EDEDED' }),
        cell('{t_exp}', { w: COL_W[10], bold: true, size: 16, fill: 'EDEDED' }),
        cell('{t_total}', { w: COL_W[11], bold: true, size: 16, fill: 'EDEDED' }),
    ]);

    return `<w:tbl>${tblPr}${grid}${headRow}${bodyRow}${totalRow}</w:tbl>`;
}

function buildBody() {
    return [
        para('{office_city} في {list_date}', { align: 'left', size: 20 }),
        para('قائمة مصاريف محاضر تبليغ بطاقات جبر', { bold: true, size: 30 }),
        para('{list_month}', { bold: true, size: 26 }),
        para('', { size: 12 }),
        buildTable(),
        para('', { size: 12 }),
        para('أوقفت هذه القائمة على مبلغ جملي قدره : {amount_words}.', { align: 'right', bold: true, size: 20 }),
        para('', { size: 16 }),
        para('العدل المنفذ', { align: 'left', bold: true, size: 22 }),
    ].join('');
}

// ── De-brand the bilingual letterhead lifted from the bailiff's own list doc.
// Each targeted paragraph (by index in header1.xml) has its first run text set
// to the new value and the remaining runs emptied — keeping the run formatting.
const HEADER_EDITS = {
    1: '{office_name}',                                          // مراد القعودي → name (Arabic)
    2: 'العدل المنفذ بـ{office_city}',                            // … بسوسة → city
    3: '{office_address}',                                        // address
    4: 'الهاتف : {office_phone} – الفاكس : {office_fax}',         // phone / fax
    7: '{office_name_fr}',                                        // Mourad GAOUDI → name (Latin)
    9: 'MF {office_tax_id}',                                      // matricule fiscal
    10: 'RIB : {office_rib}',                                     // RIB
    11: 'CNSS : {office_cnss}',                                   // CNSS
};

function debrandHeader(headerXml) {
    let pi = -1;
    return headerXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pXml) => {
        pi += 1;
        const text = HEADER_EDITS[pi];
        if (text === undefined) return pXml;
        let first = true;
        return pXml.replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, (m, open, _c, close) => {
            if (!first) return open + close; // empty the trailing runs
            first = false;
            const o = open.includes('xml:space') ? open : open.replace('<w:t', '<w:t xml:space="preserve"');
            return o + esc(text) + close;
        });
    });
}

// ── run ──
if (!fs.existsSync(SRC)) { console.error('Missing source template:', SRC); process.exit(1); }
if (!fs.existsSync(LETTERHEAD_SRC)) { console.error('Missing letterhead source:', LETTERHEAD_SRC); process.exit(1); }
const zip = new PizZip(fs.readFileSync(SRC));
const doc = zip.files['word/document.xml'].asText();

// Pull the bilingual letterhead (header1 + its rels + logo image) from the
// source list doc, de-brand it, and graft it onto the cloned package. header1's
// section reference (rId7 in document.xml.rels) is preserved by keeping the name.
const lh = new PizZip(fs.readFileSync(LETTERHEAD_SRC));
zip.file('word/header1.xml', debrandHeader(lh.files['word/header1.xml'].asText()));
zip.file('word/_rels/header1.xml.rels', lh.files['word/_rels/header1.xml.rels'].asText());
zip.file('word/media/image1.jpeg', lh.files['word/media/image1.jpeg'].asUint8Array());

const bodyTag = '<w:body>';
const prefix = doc.slice(0, doc.indexOf(bodyTag) + bodyTag.length);

let sectPr = (doc.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
// Portrait → landscape (swap page dimensions, mark orientation).
sectPr = sectPr.replace(/<w:pgSz[^/]*\/>/, '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');

const newDoc = prefix + buildBody() + sectPr + '</w:body></w:document>';
zip.file('word/document.xml', newDoc);

fs.writeFileSync(OUT, zip.generate({ type: 'nodebuffer' }));
console.log('Wrote', OUT, '(' + fs.statSync(OUT).size + ' bytes)');
