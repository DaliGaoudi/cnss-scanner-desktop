/*
 * parameterize-template.js — replace the office LOCATION and the year hardcoded in
 * server/assets/template_cnss.docx with merge tags.
 *
 * Ported from modern_app/server/scripts/parameterize_cnss_template.js. The desktop
 * template was already de-branded (scripts/debrand-template.js: name, address,
 * phone, tax id) but still printed Sousse — the judicial circuit, the CNSS
 * regional bureau, the regional director, «العدل المنفذ بسوسة» in the letterhead —
 * and the year 2026 in words. Every office outside Sousse, and every act from 2027
 * on, would have printed the wrong thing on a legal document. The values now come
 * from the office profile (server/config.js) and the render date.
 *
 * Word splits a sentence across several <w:r> runs for revision tracking, so a
 * plain string replace on document.xml misses most of these passages. This script
 * therefore locates the target paragraph, concatenates its <w:t> text, matches the
 * passage there, and rewrites only the MINIMAL SPAN OF RUNS covering that match —
 * leaving the rest of the paragraph byte-identical. That matters: these paragraphs
 * also carry LTR/noProof runs (the CNSS registration code, the {date_carte} tag)
 * that must keep their own formatting. If the runs inside a span don't all share
 * the same <w:rPr>, the script refuses rather than flatten them.
 *
 *   node scripts/parameterize-template.js [--dry-run] [path/to/template.docx]
 *
 * Each rule must match exactly one paragraph or the script writes nothing.
 * Idempotent: re-running on a patched template reports "already parameterized".
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TEMPLATE = process.argv.slice(2).find((a) => !a.startsWith('--'))
    || path.join(__dirname, '..', 'server', 'assets', 'template_cnss.docx');
const BACKUP = TEMPLATE + '.bak';
const DRY_RUN = process.argv.includes('--dry-run');

/*
 * paragraph: identifies the single paragraph to touch (tested against its plain text)
 * target:    the exact passage within that text to replace
 * replace:   what it becomes
 * done:      recognises an already-parameterized paragraph, for idempotency
 */
const BODY_RULES = [
    {
        // "…العدل المنفذ بالدائرة القضائية لمحكمة الإستئناف بسوسة" — the circuit
        // runs to the end of its paragraph («عنواني» starts the next one).
        label: 'judicial circuit',
        paragraph: /لمحكمة الإستئناف بسوسة/,
        target: /لمحكمة الإستئناف بسوسة\s*$/,
        replace: '{office_jurisdiction}',
        done: /\{office_jurisdiction\}/,
    },
    {
        label: 'CNSS regional bureau',
        paragraph: /بواسطة مكتبه الجهوي/,
        target: /بواسطة مكتبه الجهوي[^.]*\./,
        replace: 'بواسطة مكتبه الجهوي {cnss_bureau}.',
        done: /\{cnss_bureau\}/,
    },
    {
        label: 'regional social-affairs director',
        paragraph: /المدير الجهوي للشؤون الإجتماعية/,
        target: /المدير الجهوي للشؤون الإجتماعية\s+\S+/,
        replace: 'المدير الجهوي للشؤون الإجتماعية {cnss_region}',
        done: /\{cnss_region\}/,
    },
    {
        // Hardcoded "…من سنة ستة وعشرين وألفين…" — 2026. Acts printed in any later
        // year would carry the wrong year in the body of a legal document.
        label: 'year in words',
        paragraph: /من سنة .*على الساعة/,
        target: /من سنة .*?على الساعة/,
        replace: 'من سنة {year_words} على الساعة',
        done: /\{year_words\}/,
    },
];

/*
 * The printed letterhead, in word/header1.xml — the office name, address, phone and
 * tax id at the top of every page. Its text is fragmented by decorative tatweel
 * stretching ("الأســـتــــاذ"), so every rule here matches on a regex over the
 * paragraph's text rather than on a literal.
 *
 * The tatweel decoration on the generic words (الأستاذ / العدل المنفذ) is left
 * untouched; only the office-specific values become tags. One consequence worth
 * knowing: the current office's own name loses its internal stretching, since the
 * name now comes from settings as plain text.
 */
const HEADER_RULES = [
    {
        label: 'letterhead: city',
        paragraph: /العـ*دل المنـ*فـ*ذ/,
        // Plain 'ب' prefix, no tatweel connector — 'بـ' would print a visible dash
        // between the preposition and the city name.
        target: /\s*بسوسة\s*$/,
        replace: ' ب{office_city}',
        done: /\{office_city\}/,
    },
];

// Which rules apply to which part of the .docx.
const PARTS = [
    { path: 'word/document.xml', label: 'act body', rules: BODY_RULES },
    { path: 'word/header1.xml', label: 'letterhead', rules: HEADER_RULES },
];

const xmlEscape = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Split the body into paragraphs without a catastrophic regex: <w:p …> … </w:p>.
const splitParagraphs = (xml) => {
    const out = [];
    const open = /<w:p(?:\s[^>]*)?>/g;
    let m;
    while ((m = open.exec(xml)) !== null) {
        const start = m.index;
        const end = xml.indexOf('</w:p>', start);
        if (end === -1) continue;
        out.push({ start, end: end + '</w:p>'.length, xml: xml.slice(start, end + '</w:p>'.length) });
        open.lastIndex = end;
    }
    return out;
};

const unescape = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Text-bearing runs of a paragraph, each with its span in the paragraph XML and the
// offset of its text within the paragraph's concatenated plain text.
const textRunsOf = (pXml) => {
    const runs = [];
    const re = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
    let m;
    let cursor = 0;
    while ((m = re.exec(pXml)) !== null) {
        const inner = m[1];
        const tMatch = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/.exec(inner);
        if (!tMatch) continue;                       // <w:tab/>, <w:br/> etc. — skip
        const text = unescape(tMatch[1]);
        const rPrMatch = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner);
        runs.push({
            start: m.index,
            end: m.index + m[0].length,
            rPr: rPrMatch ? rPrMatch[0] : '',
            text,
            textStart: cursor,
            textEnd: cursor + text.length,
        });
        cursor += text.length;
    }
    return runs;
};

const textOf = (pXml) => textRunsOf(pXml).map((r) => r.text).join('');

// Two runs are "the same format" if their rPr matches once Word's cs-hint — which it
// sprinkles inconsistently across split runs — is normalised away.
const normRPr = (rPr) => rPr.replace(/\sw:hint="[^"]*"/g, '');

/*
 * Replace `target` within a paragraph by rewriting only the runs it touches.
 * Returns { xml, before, after } or throws with the reason it cannot be done.
 */
const replaceInRunSpan = (pXml, target, replacement) => {
    const runs = textRunsOf(pXml);
    const full = runs.map((r) => r.text).join('');

    const m = target.exec(full);
    if (!m) throw new Error('passage not found in paragraph text');
    const [a, b] = [m.index, m.index + m[0].length];

    const covering = runs.filter((r) => r.textEnd > a && r.textStart < b);
    if (!covering.length) throw new Error('no runs cover the passage');

    const distinct = new Set(covering.map((r) => normRPr(r.rPr)));
    if (distinct.size > 1) {
        throw new Error(`passage spans ${distinct.size} different run formats — refusing to flatten`);
    }

    const first = covering[0];
    const last = covering[covering.length - 1];
    // Keep whatever of the edge runs sits outside the matched passage.
    const prefix = first.text.slice(0, a - first.textStart);
    const suffix = last.text.slice(b - last.textStart);

    const newRun = `<w:r>${first.rPr}<w:t xml:space="preserve">`
        + xmlEscape(prefix + replacement + suffix)
        + '</w:t></w:r>';

    return {
        xml: pXml.slice(0, first.start) + newRun + pXml.slice(last.end),
        before: m[0],
        after: replacement,
    };
};

function main() {
    if (!fs.existsSync(TEMPLATE)) { console.error(`✗ ${TEMPLATE} not found`); process.exit(1); }

    const zip = new PizZip(fs.readFileSync(TEMPLATE));

    const applied = [];
    const alreadyDone = [];
    const problems = [];
    const rewritten = [];    // { path, xml } to write back once every part succeeded

    for (const { path: partPath, label: partLabel, rules } of PARTS) {
        const part = zip.file(partPath);
        if (!part) { problems.push(`${partLabel}: ${partPath} missing from template`); continue; }

        const xml = part.asText();
        const paragraphs = splitParagraphs(xml);
        const edits = [];    // { start, end, xml } to splice in

        for (const rule of rules) {
            const hits = paragraphs.filter((p) => rule.paragraph.test(textOf(p.xml)));

            if (!hits.length) {
                const tagged = paragraphs.some((p) => rule.done.test(textOf(p.xml)));
                if (tagged) alreadyDone.push(rule.label);
                else problems.push(`${rule.label}: no matching paragraph`);
                continue;
            }
            if (hits.length > 1) {
                problems.push(`${rule.label}: matched ${hits.length} paragraphs — too ambiguous to patch`);
                continue;
            }

            const p = hits[0];
            if (rule.done.test(textOf(p.xml))) { alreadyDone.push(rule.label); continue; }

            try {
                const { xml: newParagraph, before, after } = replaceInRunSpan(p.xml, rule.target, rule.replace);
                edits.push({ start: p.start, end: p.end, xml: newParagraph });
                applied.push({ label: rule.label, before: before.trim(), after: after.trim() });
            } catch (e) {
                problems.push(`${rule.label}: ${e.message}`);
            }
        }

        if (edits.length) {
            // Splice back to front so earlier offsets stay valid.
            let out = xml;
            for (const e of edits.sort((a, b) => b.start - a.start)) {
                out = out.slice(0, e.start) + e.xml + out.slice(e.end);
            }
            rewritten.push({ path: partPath, xml: out });
        }
    }

    if (problems.length) {
        console.error('✗ Refusing to write — the template does not have the expected shape:');
        problems.forEach((p) => console.error(`    - ${p}`));
        process.exit(1);
    }

    if (!applied.length) {
        console.log('✓ Template already parameterized — nothing to do.');
        console.log(`  tags present: ${alreadyDone.join(', ')}`);
        return;
    }

    console.log('Substitutions:');
    for (const a of applied) {
        console.log(`  ✓ ${a.label}`);
        console.log(`      before: ${a.before.slice(0, 110)}`);
        console.log(`      after : ${a.after.slice(0, 110)}`);
    }
    alreadyDone.forEach((a) => console.log(`  · ${a} (already tagged)`));

    if (DRY_RUN) { console.log('\nDRY RUN — template not written.'); return; }

    if (!fs.existsSync(BACKUP)) {
        fs.copyFileSync(TEMPLATE, BACKUP);
        console.log(`\n  backup → ${path.basename(BACKUP)}`);
    }

    for (const { path: partPath, xml } of rewritten) zip.file(partPath, xml);
    fs.writeFileSync(TEMPLATE, zip.generate({ type: 'nodebuffer' }));
    console.log(`✓ Wrote ${path.basename(TEMPLATE)} (${rewritten.map((r) => r.path).join(', ')})`);
}

main();
