/*
 * Run: node test/cnss-validate.js  (no database, no network)
 *
 * بطاقة جبر field validation (services/cnssValidate.js), and that the client copy
 * (client/src/utils/cnssValidate.js) gives the same answer for every case.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const server = require('../server/services/cnssValidate');

const TODAY = '2026-10-09';
const check = (input, existing) => server.validateCard(input, existing, TODAY);

// [name, input, existing, expected values (subset) or null, fields expected in error]
const CASES = [
    ['DD/MM/YYYY kept', { datecarte: '21/05/2026' }, {}, { datecarte: '21/05/2026' }, []],
    ['dashes and single digits normalised', { datecarte: '1-5-2026' }, {}, { datecarte: '01/05/2026' }, []],
    ['ISO typed into datecarte → DD/MM/YYYY', { datecarte: '2026-05-21' }, {}, { datecarte: '21/05/2026' }, []],
    ['Arabic-Indic digits converted', { datecarte: '٢١/٠٥/٢٠٢٦' }, {}, { datecarte: '21/05/2026' }, []],
    ['Extended Arabic-Indic digits converted', { datecarte: '۲۱/۰۵/۲۰۲۶' }, {}, { datecarte: '21/05/2026' }, []],
    ['bidi marks pasted from Word ignored', { datecarte: '‏21/05/2026‏' }, {}, { datecarte: '21/05/2026' }, []],
    ['date in words refused', { datecarte: 'الحادي والعشرون من ماي' }, {}, null, ['datecarte']],
    ['month name refused', { datecarte: '21 mai 2026' }, {}, null, ['datecarte']],
    ['two-digit year refused', { datecarte: '21/05/26' }, {}, null, ['datecarte']],
    ['five-digit year refused', { date_tabligh: '20266-05-21' }, {}, null, ['date_tabligh']],
    ['year before 1990 refused', { datecarte: '21/05/1989' }, {}, null, ['datecarte']],
    ['month 13 refused', { datecarte: '21/13/2026' }, {}, null, ['datecarte']],
    ['31 February refused', { datecarte: '31/02/2026' }, {}, null, ['datecarte']],
    ['29 February of a leap year accepted', { datecarte: '29/02/2024' }, {}, { datecarte: '29/02/2024' }, []],
    ['29 February of a common year refused', { datecarte: '29/02/2025' }, {}, null, ['datecarte']],
    ['future تاريخ البطاقة refused', { datecarte: '10/10/2026' }, {}, null, ['datecarte']],
    ['today accepted', { datecarte: '09/10/2026' }, {}, { datecarte: '09/10/2026' }, []],
    ['future تاريخ التبليغ refused', { date_tabligh: '2026-12-01' }, {}, null, ['date_tabligh']],
    ['تاريخ التبليغ stored as YYYY-MM-DD', { date_tabligh: '05/10/2026' }, {}, { date_tabligh: '2026-10-05' }, []],
    ['penalty date may be next year', { datesins: '16/01/2027' }, {}, { datesins: '16/01/2027' }, []],
    ['penalty date two years ahead refused', { datesins: '16/01/2028' }, {}, null, ['datesins']],
    ['blank date allowed', { date_tabligh: '' }, {}, { date_tabligh: '' }, []],
    ['تبليغ before the card refused', { datecarte: '05/03/2026', date_tabligh: '2026-03-01' }, {}, null, ['date_tabligh']],
    ['تبليغ before the stored card refused', { date_tabligh: '2026-03-01' }, { datecarte: '05/03/2026' }, null, ['date_tabligh']],
    ['card moved after its stored تبليغ refused', { datecarte: '05/03/2026' }, { date_tabligh: '2026-03-01' }, null, ['datecarte']],
    ['clearing تبليغ always allowed', { date_tabligh: '' }, { datecarte: '05/03/2026' }, { date_tabligh: '' }, []],
    ['quarter normalised', { semestre: '4/2021' }, {}, { semestre: '04/2021' }, []],
    ['quarter in Arabic digits', { semestre: '٠٤/٢٠٢١' }, {}, { semestre: '04/2021' }, []],
    ['quarter 5 refused', { semestre: '05/2021' }, {}, null, ['semestre']],
    ['quarter with 2-digit year refused', { semestre: '04/21' }, {}, null, ['semestre']],
    ['quarter of next year refused', { semestre: '01/2027' }, {}, null, ['semestre']],
    ['current quarter accepted', { semestre: '04/2026' }, {}, { semestre: '04/2026' }, []],
    ['quarter in words refused', { semestre: 'الثلاثية الرابعة' }, {}, null, ['semestre']],
    ['amount with space + comma', { dette: '2 959,306' }, {}, { dette: '2959.306' }, []],
    ['amount in Arabic digits + Arabic decimal sign', { dette: '٢٩٥٩٫٣٠٦' }, {}, { dette: '2959.306' }, []],
    ['amount padded to millimes', { dette: '1000,5' }, {}, { dette: '1000.500' }, []],
    ['whole-dinar amount padded', { dette: '10' }, {}, { dette: '10.000' }, []],
    ['amount with 4 decimals refused', { dette: '12.3456' }, {}, null, ['dette']],
    ['amount in words refused', { dette: 'ألفا دينار' }, {}, null, ['dette']],
    ['amount with thousands comma and dot refused', { dette: '2,959.306' }, {}, null, ['dette']],
    ['percentage over 100 refused', { pourcentage: '150' }, {}, null, ['pourcentage']],
    ['VAT rate normalised', { vat_rate: '19,0' }, {}, { vat_rate: '19.0' }, []],
    ['card number digits made Latin', { numcarte: '٢٠٢٦٠٠١' }, {}, { numcarte: '2026001' }, []],
    ['fee digits made Latin', { fee_original: '٣٠٠٠٠' }, {}, { fee_original: '30000' }, []],
    ['absent fields untouched', {}, { datecarte: 'garbage' }, {}, []],
];

(async () => {
    const client = await import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'utils', 'cnssValidate.js')).href);
    let passed = 0;
    for (const [name, input, existing, expected, errorFields] of CASES) {
        const got = check(input, existing);
        try {
            assert.deepStrictEqual(Object.keys(got.errors).sort(), [...errorFields].sort(), 'error fields');
            if (expected) for (const [k, v] of Object.entries(expected)) assert.strictEqual(got.values[k], v, k);
            assert.deepStrictEqual(client.validateCard(input, existing, TODAY), got, 'client copy disagrees');
        } catch (e) {
            console.error(`  ✗ ${name}\n    ${e.message}\n    got ${JSON.stringify(got)}`);
            process.exit(1);
        }
        passed++;
        console.log(`  ✓ ${name}${errorFields.length ? `  → ${Object.values(got.errors)[0]}` : ''}`);
    }
    // A later quarter of the current year: on 1 Feb, Q2 has not started.
    const early = server.validateCard({ semestre: '02/2026' }, {}, '2026-02-01');
    assert.match(early.errors.semestre, /لم تبدأ بعد/);
    assert.deepStrictEqual(client.validateCard({ semestre: '02/2026' }, {}, '2026-02-01'), early);
    passed++;
    console.log('  ✓ quarter not started yet refused');

    console.log(`\n${passed} passed (server and client agree on all).`);
})();
