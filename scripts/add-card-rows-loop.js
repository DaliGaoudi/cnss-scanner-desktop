/*
 * add-card-rows-loop.js — let one محضر list several بطاقات جبر.
 *
 * The act's card table (عدد البطاقة / الثلاثية / أصل الدين / … / تاريخ احتساب
 * الخطايا) had a single data row bound to one card. A محضر can now cover several
 * cards of the same مطلوب, so that row is wrapped in a {#cards}…{/cards} loop:
 * docxtemplater repeats a table row whose loop opens in its first cell and closes
 * in its last one, giving one row per card.
 *
 * Only the two tag texts change — no run or formatting is touched. Ported from
 * modern_app/server/scripts/add_card_rows_loop_to_template.js.
 *
 *   node scripts/add-card-rows-loop.js [--dry-run] [path/to/template.docx]
 *
 * Idempotent: re-running on a patched template reports "already looped".
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const DRY_RUN = process.argv.includes('--dry-run');
const TEMPLATE = process.argv.slice(2).find((a) => !a.startsWith('--'))
    || path.join(__dirname, '..', 'server', 'assets', 'template_cnss.docx');

// First and last cell of the card row.
const OPEN = '{num_carte}';
const CLOSE = '{date_penalite}';

function main() {
    const zip = new PizZip(fs.readFileSync(TEMPLATE));
    const xml = zip.file('word/document.xml').asText();

    if (xml.includes('{#cards}')) {
        console.log('Template already looped over {#cards} — nothing to do.');
        return;
    }

    const count = (s) => xml.split(s).length - 1;
    if (count(OPEN) !== 1 || count(CLOSE) !== 1) {
        throw new Error(`expected exactly one ${OPEN} and one ${CLOSE}, found ${count(OPEN)} / ${count(CLOSE)}`);
    }

    // Both must sit in the same table row, or docxtemplater would loop paragraphs instead.
    const openAt = xml.indexOf(OPEN);
    const rowStart = Math.max(xml.lastIndexOf('<w:tr ', openAt), xml.lastIndexOf('<w:tr>', openAt));
    const rowEnd = xml.indexOf('</w:tr>', openAt);
    const closeAt = xml.indexOf(CLOSE);
    if (rowStart === -1 || closeAt < rowStart || closeAt > rowEnd) {
        throw new Error(`${OPEN} and ${CLOSE} are not in the same table row`);
    }

    const out = xml
        .replace(OPEN, `{#cards}${OPEN}`)
        .replace(CLOSE, `${CLOSE}{/cards}`);

    if (DRY_RUN) { console.log('Dry run — the card row would be wrapped in {#cards}…{/cards}.'); return; }

    zip.file('word/document.xml', out);
    fs.writeFileSync(TEMPLATE, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
    console.log(`✓ Card row now repeats per card: ${TEMPLATE}`);
}

try { main(); } catch (e) { console.error('✗', e.message); process.exit(1); }
