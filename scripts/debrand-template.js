#!/usr/bin/env node
/*
 * One-time transform: replace the (hardcoded) bailiff letterhead in
 * server/assets/template_cnss.docx with docxtemplater merge fields, so the act
 * is filled from each customer's own office details instead of the original
 * owner's. Edits specific <w:t> runs BY INDEX (computed from the run map) so the
 * surrounding styling/layout and the existing {#acts}/{field} tags are untouched.
 *
 *   node scripts/debrand-template.js
 *
 * Replaced with merge fields: {office_name} {office_address} {office_phone}
 * {office_fax} {office_tax_id}. The generic title (الأستاذ) and role
 * (العدل المنفذ) stay.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TPL = path.join(__dirname, '..', 'server', 'assets', 'template_cnss.docx');
const BACKUP = path.join(__dirname, '..', 'server', 'assets', 'template_cnss.original.docx');

const RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Rewrite the inner text of specific w:t runs (by their order index in the part).
function applyRunEdits(xml, edits) {
    let i = -1;
    return xml.replace(RE, (full) => {
        i += 1;
        if (!(i in edits)) return full;
        const open = full.slice(0, full.indexOf('>') + 1); // keep tag + xml:space attr
        return open + esc(edits[i]) + '</w:t>';
    });
}

const HEADER_EDITS = {
    5: '{office_name}', 6: '', 7: '', 8: '',                                  // مراد القعودي
    17: '{office_address}', 18: '', 19: '', 20: '', 21: '', 22: '',           // عمارة قلولو … سوسة
    23: 'الهاتف : {office_phone} ',                                           // keep label, swap number
    25: ' الفاكس : {office_fax}',
    27: '{office_tax_id}',                                                    // keep "المعرف الجبائي :" label (run 26)
};
const BODY_EDITS = {
    42: 'نحن الأستاذ {office_name} العدل المنفذ',
    47: 'عنواني {office_address}', 48: '', 49: '', 50: '', 51: '', 52: '',    // address spread
    53: ' والممضي أسفله',                                                     // drop "بسوسة", keep "والممضي أسفله"
};

const zip = new PizZip(fs.readFileSync(TPL));
if (!fs.existsSync(BACKUP)) { fs.writeFileSync(BACKUP, fs.readFileSync(TPL)); console.log('backed up original →', path.basename(BACKUP)); }

zip.file('word/header1.xml', applyRunEdits(zip.file('word/header1.xml').asText(), HEADER_EDITS));
zip.file('word/document.xml', applyRunEdits(zip.file('word/document.xml').asText(), BODY_EDITS));

fs.writeFileSync(TPL, zip.generate({ type: 'nodebuffer' }));
console.log('de-branded template written →', path.basename(TPL));
