/*
 * A small, careful model of a .docx for the "import your own Word file" feature
 * (services/templateImport.js). It reads a part (document, header, footer) into
 * BLOCKS — the innermost paragraphs, each with its plain text and, inside tables,
 * its row/cell — and edits them by rewriting only the runs a change touches.
 *
 * Word is messy in exactly the ways this has to survive:
 *   - a sentence is split over many <w:r> runs (revision ids, spelling marks);
 *   - letterheads sit in text boxes, i.e. paragraphs nested inside paragraphs;
 *   - mail-merge fields are either <w:fldSimple> or a begin/instr/separate/end
 *     sequence of runs.
 * Edits are collected and spliced back to front, so earlier offsets stay valid.
 */

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeXml = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ── Structure scan ──
// Walk the open/close tags we care about with a stack, so nesting (text boxes,
// tables inside tables) is handled. Yields innermost paragraphs only.
const TAG_RE = /<(\/?)w:(p|tbl|tr|tc|txbxContent)\b[^>]*?(\/?)>/g;

/**
 * @returns [{ id, start, end, xml, text, table: { t, r, c } | null, inTextbox }]
 *   start/end are offsets of the whole <w:p>…</w:p> in `xml`.
 */
function blocksOf(xml, idOffset = 0) {
    const out = [];
    const stack = [];            // { tag, start, hasChildP }
    let tableCount = -1;
    const tableStack = [];       // { t, r, c }
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(xml)) !== null) {
        const [whole, closing, tag, selfClosing] = m;
        if (selfClosing) continue;                         // <w:p/> etc.: empty, nothing to edit
        if (!closing) {
            if (tag === 'tbl') { tableCount += 1; tableStack.push({ t: tableCount, r: -1, c: -1 }); }
            if (tag === 'tr' && tableStack.length) { const t = tableStack[tableStack.length - 1]; t.r += 1; t.c = -1; }
            if (tag === 'tc' && tableStack.length) tableStack[tableStack.length - 1].c += 1;
            if (tag === 'p') stack.forEach((s) => { if (s.tag === 'p') s.hasChildP = true; });
            stack.push({ tag, start: m.index, hasChildP: false });
            continue;
        }
        // closing tag: pop to the matching open
        let open = null;
        while (stack.length) { const s = stack.pop(); if (s.tag === tag) { open = s; break; } }
        if (tag === 'tbl') tableStack.pop();
        if (tag !== 'p' || !open || open.hasChildP) continue;
        const end = m.index + whole.length;
        const pXml = xml.slice(open.start, end);
        const inTable = tableStack.length ? { ...tableStack[tableStack.length - 1] } : null;
        out.push({
            id: idOffset + out.length, start: open.start, end, xml: pXml, text: textOf(pXml),
            table: inTable, inTextbox: stack.some((s) => s.tag === 'txbxContent'),
        });
    }
    return out;
}

// ── Runs ──
const RUN_RE = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;

// Text-bearing runs of one paragraph: offsets in the paragraph XML, rPr, text, and
// where that text sits in the paragraph's plain text.
function runsOf(pXml) {
    const runs = [];
    let cursor = 0;
    let m;
    RUN_RE.lastIndex = 0;
    while ((m = RUN_RE.exec(pXml)) !== null) {
        const inner = m[1];
        const texts = [...inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => unescapeXml(t[1]));
        if (!texts.length) continue;
        const text = texts.join('');
        const rPr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner) || [''])[0];
        runs.push({ start: m.index, end: m.index + m[0].length, rPr, text, textStart: cursor, textEnd: cursor + text.length });
        cursor += text.length;
    }
    return runs;
}
const textOf = (pXml) => runsOf(pXml).map((r) => r.text).join('');

const runXml = (rPr, text) => `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;

/*
 * Replace the plain-text range [a, b) of a paragraph with `replacement`, rewriting
 * only the runs that range touches. The new run takes the FIRST touched run's
 * formatting — right for a data value (an employer name is one format), and the
 * reason this is never used on the fixed wording around it.
 */
function replaceRange(pXml, a, b, replacement) {
    const runs = runsOf(pXml);
    // An insertion (a === b) goes into the run that contains that position.
    const covering = a === b
        ? [runs.find((r) => r.textStart <= a && a <= r.textEnd)].filter(Boolean)
        : runs.filter((r) => r.textEnd > a && r.textStart < b);
    if (!covering.length) throw new Error('range not covered by any run');
    const first = covering[0];
    const last = covering[covering.length - 1];
    const prefix = first.text.slice(0, a - first.textStart);
    const suffix = last.text.slice(b - last.textStart);
    return pXml.slice(0, first.start) + runXml(first.rPr, prefix + replacement + suffix) + pXml.slice(last.end);
}

// Insert text at the very start / end of a paragraph's text (for loop markers).
function prependText(pXml, text) {
    const runs = runsOf(pXml);
    if (runs.length) return replaceRange(pXml, 0, 0, text);
    // No text yet: put a run just before </w:p>.
    return pXml.replace(/<\/w:p>$/, `${runXml('', text)}</w:p>`);
}
function appendText(pXml, text) {
    const runs = runsOf(pXml);
    if (!runs.length) return pXml.replace(/<\/w:p>$/, `${runXml('', text)}</w:p>`);
    const last = runs[runs.length - 1];
    return replaceRange(pXml, last.textEnd, last.textEnd, text);
}

// ── Mail-merge fields ──
const mergeName = (instr) => {
    const m = /MERGEFIELD\s+("([^"]+)"|(\S+))/i.exec(unescapeXml(instr));
    return m ? (m[2] || m[3]).trim() : null;
};

/*
 * Every MERGEFIELD in a paragraph → `toTag(name)` (a "{tag}" string, or '' to drop
 * it). Handles <w:fldSimple> and begin/instrText/separate/end run sequences that
 * open and close within the paragraph. Returns { xml, names: [...] }.
 */
function convertMergeFields(pXml, toTag) {
    const names = [];
    // 1) <w:fldSimple w:instr="MERGEFIELD …">…</w:fldSimple>
    let xml = pXml.replace(/<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*>([\s\S]*?)<\/w:fldSimple>/g, (whole, instr, inner) => {
        const name = mergeName(instr);
        if (!name) return whole;
        names.push(name);
        const rPr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner) || [''])[0];
        const tag = toTag(name);
        return tag ? runXml(rPr, tag) : '';
    });
    // 2) complex fields: walk all runs (text or not) in order.
    const allRuns = [...xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, inner: m[1] }));
    const edits = [];
    let field = null;
    for (const r of allRuns) {
        const fc = (/<w:fldChar\b[^>]*w:fldCharType="(\w+)"/.exec(r.inner) || [])[1];
        if (fc === 'begin') { field = { start: r.start, instr: '', rPr: (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r.inner) || [''])[0], resultRPr: null, depth: 0, separated: false }; continue; }
        if (!field) continue;
        if (fc === 'separate') { field.separated = true; continue; }
        if (fc === 'end') {
            const name = mergeName(field.instr);
            if (name) {
                names.push(name);
                const tag = toTag(name);
                edits.push({ start: field.start, end: r.end, xml: tag ? runXml(field.resultRPr || field.rPr, tag) : '' });
            }
            field = null;
            continue;
        }
        const instr = /<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/.exec(r.inner);
        if (instr && !field.separated) field.instr += instr[1];
        else if (field.separated && field.resultRPr === null && /<w:t\b/.test(r.inner)) {
            field.resultRPr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r.inner) || [''])[0];
        }
    }
    for (const e of edits.reverse()) xml = xml.slice(0, e.start) + e.xml + xml.slice(e.end);
    return { xml, names };
}

const hasMergeFields = (xml) => /MERGEFIELD/i.test(xml);

// ── Splicing ──
// Apply [{ start, end, xml }] edits to a part, back to front.
function splice(xml, edits) {
    let out = xml;
    for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.xml + out.slice(e.end);
    return out;
}

module.exports = {
    blocksOf, runsOf, textOf, replaceRange, prependText, appendText,
    convertMergeFields, hasMergeFields, mergeName, splice, xmlEscape, unescapeXml,
};
