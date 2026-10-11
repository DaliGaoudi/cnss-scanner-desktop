const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { templatePath, officeMergeData } = require('../config');
const { yearInArabicWords } = require('./numberToArabicWords');

/*
 * Shared "محضر إعلام بطاقة جبر" rendering. Used by the CNSS routes (real acts)
 * and by the Settings/onboarding preview (a sample act). The letterhead merge
 * fields (office_*) come from the customer's office profile; per-act fields fill
 * the {#acts} body loop.
 */
const BUNDLED_TEMPLATE = path.join(__dirname, '..', 'assets', 'template_cnss.docx');

// Customer-uploaded template wins over the bundled default.
const activeTemplatePath = () => {
    const custom = templatePath();
    return fs.existsSync(custom) ? custom : BUNDLED_TEMPLATE;
};

// Fee math lives in services/cnssFees.js and the act record (one محضر, one or more
// cards) in services/cnssActes.js; this file only knows docx.

// The acts loop ends with this paragraph so each محضر starts on a fresh page. The
// render converts each one into a section break (see perActFooters).
const PAGE_BREAK_P = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// A valid but empty footer, used to park word/footer1.xml while docxtemplater runs
// so it never sees (and blanks out) the {fee_*} tags we fill per act ourselves.
const EMPTY_FOOTER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
    + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:p><w:pPr><w:pStyle w:val="Pieddepage"/></w:pPr></w:p></w:ftr>';

const FOOTER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

const xmlEscape = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Fill one act's amounts into a copy of the tagged fee-table footer. Any tag the
// act doesn't carry resolves to '' — same contract as docxtemplater's nullGetter.
const fillFooter = (footerXml, act) =>
    footerXml.replace(/\{([a-z_]+)\}/g, (_, key) => xmlEscape(act[key]));

/*
 * Give every محضر its own section, so every محضر gets its own footer.
 *
 * A footer is the only thing Word pins to the bottom of the page, but footers
 * belong to a SECTION — one shared footer would print the first act's fees under
 * every act. So: turn each inter-act page break into a section break, and hand
 * each section a generated footer part holding that act's amounts.
 *
 * Returns false (leaving the document untouched) if the template doesn't have the
 * shape we expect — e.g. a customer-uploaded template.
 */
function perActFooters(zip, acts, footerTpl) {
    const docPart = zip.file('word/document.xml');
    const relsPart = zip.file('word/_rels/document.xml.rels');
    const ctPart = zip.file('[Content_Types].xml');
    if (!docPart || !relsPart || !ctPart || !footerTpl) return false;

    let xml = docPart.asText();
    let rels = relsPart.asText();
    let ct = ctPart.asText();

    // The body-level sectPr is the LAST one; it defines the final section.
    const sectStart = xml.lastIndexOf('<w:sectPr');
    const sectEnd = xml.indexOf('</w:sectPr>', sectStart);
    if (sectStart === -1 || sectEnd === -1) return false;
    const bodySect = xml.slice(sectStart, sectEnd + '</w:sectPr>'.length);

    // Highest existing rIdN, so generated ids can't collide.
    let nextRel = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1]));
    // Same for footerN.xml.
    let nextFooter = Math.max(0, ...Object.keys(zip.files)
        .map((f) => /^word\/footer(\d+)\.xml$/.exec(f)).filter(Boolean).map((m) => +m[1]));

    // One footer part per act, each carrying that act's amounts.
    const footerRelIds = acts.map((act) => {
        const relId = `rId${++nextRel}`;
        const name = `footer${++nextFooter}.xml`;
        zip.file(`word/${name}`, fillFooter(footerTpl, act));
        rels = rels.replace('</Relationships>',
            `<Relationship Id="${relId}" Type="${FOOTER_REL}" Target="${name}"/></Relationships>`);
        ct = ct.replace('</Types>',
            `<Override PartName="/word/${name}" ContentType="${FOOTER_CT}"/></Types>`);
        return relId;
    });

    // A section's own sectPr, cloned from the body one with its footer swapped.
    // CT_SectPr order: header/footerReference first, then type, then pgSz/pgMar…
    const sectionFor = (relId) => bodySect
        .replace(/<w:footerReference\b[^>]*\/>/g, '')
        .replace(/(<w:headerReference\b[^>]*\/>)/, `$1<w:footerReference w:type="default" r:id="${relId}"/>`)
        .replace(/(<w:footerReference\b[^>]*\/>)/, '$1<w:type w:val="nextPage"/>');

    // Each inter-act page break becomes a section break carrying that act's footer.
    // The final act needs no break — the body-level sectPr closes it.
    let i = -1;
    xml = xml.split(PAGE_BREAK_P).reduce((acc, chunk, idx, parts) => {
        if (idx === parts.length - 1) return acc + chunk;
        i += 1;
        const brk = i < footerRelIds.length - 1
            ? `<w:p><w:pPr>${sectionFor(footerRelIds[i])}</w:pPr></w:p>`
            : ''; // trailing break after the last act — drop it entirely
        return acc + chunk + brk;
    }, '');

    // The last section is the body-level sectPr; point it at the last act's footer.
    xml = xml.slice(0, xml.lastIndexOf('<w:sectPr'))
        + sectionFor(footerRelIds[footerRelIds.length - 1]).replace('<w:type w:val="nextPage"/>', '')
        + xml.slice(xml.indexOf('</w:sectPr>', xml.lastIndexOf('<w:sectPr')) + '</w:sectPr>'.length);

    zip.file('word/document.xml', xml);
    zip.file('word/_rels/document.xml.rels', rels);
    zip.file('[Content_Types].xml', ct);
    return true;
}

// Render one Word document containing `acts` (1 → single act, N → one per page).
// `officeData` (office_* merge fields) defaults to the saved profile; callers can
// pass un-saved values for a live preview. `templateBuffer` renders a template
// that isn't active yet (the Word-import preview); default is the active one.
const renderActs = (acts, officeData, templateBuffer) => {
    const zip = new PizZip(templateBuffer || fs.readFileSync(activeTemplatePath()));

    // Park the tagged fee-table footer so docxtemplater doesn't blank its {fee_*}
    // tags; each act gets its own filled copy afterwards.
    const footerPart = zip.file('word/footer1.xml');
    const footerTpl = footerPart ? footerPart.asText() : null;
    if (footerTpl) zip.file('word/footer1.xml', EMPTY_FOOTER);

    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    // «من سنة {year_words}» — the year the act is drawn up, spelled out. Root scope:
    // docxtemplater resolves a tag inside {#acts} from the enclosing scope too.
    doc.render({ acts, ...(officeData || officeMergeData()), year_words: yearInArabicWords(new Date().getFullYear()) });

    const out = doc.getZip();
    if (!perActFooters(out, acts, footerTpl)) {
        // Unrecognised template: fall back to just dropping the trailing break.
        const xml = out.file('word/document.xml').asText();
        const last = xml.lastIndexOf(PAGE_BREAK_P);
        if (last !== -1) out.file('word/document.xml', xml.slice(0, last) + xml.slice(last + PAGE_BREAK_P.length));
        if (footerTpl) out.file('word/footer1.xml', footerTpl.replace(/\{[a-z_]+\}/g, ''));
    }
    return out.generate({ type: 'nodebuffer' });
};

// A sample act (placeholder card) for previewing the customer's letterhead.
// `cards` feeds the template's {#cards} row loop; the flat num_carte/… copies
// serve a customer template that has no loop.
const SAMPLE_CARD = { num_carte: '4621400216', trimestre: '04/2021', montant: '2959.306', date_penalite: '16/01/2022' };
const SAMPLE_ACT = {
    num_dossier: '٠٠', code_inscription: '00', num_affiliation: '612555',
    nom_matloub: 'مثال: شركة ما ش.م.م', adresse: 'العنوان هنا',
    date_carte: '21/05/2026', cards: [SAMPLE_CARD], ...SAMPLE_CARD,
    // example fee breakdown, already in display format (D DDD,MMM)
    fee_stamp: '0,200', fee_registration: '30,000', fee_office_copy: '10,000',
    fee_legal_copy: '10,000', fee_original: '30,000', fee_total: '80,200',
};
const sampleActBuffer = (officeData) => renderActs([SAMPLE_ACT], officeData);

module.exports = { activeTemplatePath, renderActs, sampleActBuffer, SAMPLE_ACT };
