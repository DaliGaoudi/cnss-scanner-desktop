/*
 * Validation + normalisation of a بطاقة جبر's fields — the client copy of
 * server/services/cnssValidate.js, which documents the rules and has the final
 * say. Kept identical apart from the module syntax; server/test_cnss_validate.js
 * fails if the two drift apart.
 */

const MIN_YEAR = 1990;

// Arabic-Indic (U+0660…) and Extended Arabic-Indic (U+06F0…) digits → 0-9; their
// low nibble is the digit. Bidi marks pasted from Word/PDF are dropped.
const toLatinDigits = (v) => String(v == null ? '' : v)
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) & 0xF))
    .replace(/[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = ({ y, m, d }) => `${y}-${pad2(m)}-${pad2(d)}`;
const dmy = ({ y, m, d }) => `${pad2(d)}/${pad2(m)}/${y}`;

// Today in Tunisia, as YYYY-MM-DD — the server runs in UTC.
const todayTunis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());

const NUMERALS_ONLY = 'اكتب التاريخ بالأرقام فقط (مثال: 21/05/2026)';

/*
 * Parse a date typed as DD/MM/YYYY or YYYY-MM-DD (any of / - . as separator).
 * → { empty: true } | { date: {y,m,d} } | { error }
 */
const parseDate = (raw, maxYear) => {
    const s = toLatinDigits(raw);
    if (!s) return { empty: true };
    if (/[^\d/\-.\s]/.test(s)) return { error: NUMERALS_ONLY };

    let y, m, d, yearText;
    let k = /^(\d+)\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})$/.exec(s);
    if (k && k[1].length > 2) { [yearText, m, d] = [k[1], +k[2], +k[3]]; }
    else {
        k = /^(\d{1,2})\s*[/\-.\s]\s*(\d{1,2})\s*[/\-.\s]\s*(\d+)$/.exec(s);
        if (!k) return { error: NUMERALS_ONLY };
        [d, m, yearText] = [+k[1], +k[2], k[3]];
    }
    if (yearText.length !== 4) return { error: `السنة يجب أن تكون بأربعة أرقام (${yearText})` };
    y = +yearText;
    if (y < MIN_YEAR || y > maxYear) return { error: `سنة غير صالحة: ${y} (بين ${MIN_YEAR} و ${maxYear})` };
    if (m < 1 || m > 12) return { error: `شهر غير صالح: ${m}` };
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d < 1 || d > days) return { error: `هذا اليوم غير موجود: ${pad2(d)}/${pad2(m)}/${y}` };
    return { date: { y, m, d } };
};

// "4/2021", "04-2021", "٠٤/٢٠٢١" → "04/2021".
const parseQuarter = (raw, today) => {
    const s = toLatinDigits(raw);
    if (!s) return { empty: true };
    const k = /^(\d{1,2})\s*[/\-.\s]\s*(\d+)$/.exec(s);
    if (!k) return { error: 'تُكتب بالأرقام: رقم الثلاثية/السنة (مثال: 04/2021)' };
    const q = +k[1];
    if (k[2].length !== 4) return { error: `السنة يجب أن تكون بأربعة أرقام (${k[2]})` };
    const y = +k[2];
    if (q < 1 || q > 4) return { error: `رقم الثلاثية بين 1 و 4 (أُدخل ${q})` };
    if (y < MIN_YEAR || y > today.y) return { error: `سنة غير صالحة: ${y} (بين ${MIN_YEAR} و ${today.y})` };
    // A quarter that has not started yet cannot be owed.
    if (y === today.y && (q - 1) * 3 + 1 > today.m) return { error: `الثلاثية ${q}/${y} لم تبدأ بعد` };
    return { value: `${pad2(q)}/${y}` };
};

// "2 959,306", "2959.306", "٢٩٥٩٫٣٠٦" → "2959.306". `decimals` caps the fraction.
// `money` pads the millimes: an act prints "1000.500", never "1000.5".
const parseNumber = (raw, { decimals, max, label, example, money }) => {
    const s = toLatinDigits(raw).replace(/[\s\u00A0\u202F]/g, '').replace('٫', '.');
    if (!s) return { empty: true };
    const k = /^(\d+)(?:[.,](\d+))?$/.exec(s);
    if (!k) return { error: `${label} يُكتب بالأرقام فقط (مثال: ${example})` };
    if (k[2] && k[2].length > decimals) {
        return { error: decimals === 0 ? `${label} عدد صحيح` : `${label}: ${decimals} أرقام بعد الفاصل على الأكثر` };
    }
    const int = k[1].replace(/^0+(?=\d)/, '');
    const value = money ? `${int}.${(k[2] || '').padEnd(decimals, '0')}` : (k[2] ? `${int}.${k[2]}` : int);
    if (max !== undefined && parseFloat(value) > max) return { error: `${label}: الحد الأقصى ${max}` };
    return { value };
};

const DATE_FIELDS = {
    datecarte: { label: 'تاريخ البطاقة', store: dmy, notFuture: true },
    datesins: { label: 'تاريخ احتساب الخطايا', store: dmy, notFuture: false },
    date_tabligh: { label: 'تاريخ التبليغ', store: ymd, notFuture: true },
};
const NUMBER_FIELDS = {
    dette: { label: 'أصل الدين', decimals: 3, example: '2959.306', money: true },
    pourcentage: { label: 'نسبة الخطية', decimals: 3, max: 100, example: '1.5' },
    vat_rate: { label: 'نسبة أ ق م', decimals: 3, max: 100, example: '19' },
};
const DIGIT_FIELDS = ['numcarte', 'nbrreg', 'fee_post', 'fee_stamp', 'fee_registration', 'fee_travel', 'fee_aqm',
    'fee_copies', 'fee_movement', 'fee_office_copy', 'fee_legal_copy', 'fee_counterparts', 'fee_original'];

const parseYmdString = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return { y, m, d };
};

/*
 * Validate the card fields present in `input` (a partial update is fine).
 * `existing` is the stored row, so a cross-field rule can see the field the
 * request did not touch.
 *
 * → { values, errors }: `values` holds the normalised form of every field that
 *   was given (invalid ones keep their raw text); `errors` maps field → Arabic
 *   message and is empty when everything is valid.
 */
const validateCard = (input, existing = {}, today = todayTunis()) => {
    const now = parseYmdString(today);
    const values = {};
    const errors = {};
    const parsed = {};
    const has = (k) => input[k] !== undefined && input[k] !== null;

    for (const [k, f] of Object.entries(DATE_FIELDS)) {
        if (!has(k)) continue;
        const r = parseDate(input[k], f.notFuture ? now.y : now.y + 1);
        if (r.empty) { values[k] = ''; continue; }
        if (r.error) { errors[k] = `${f.label}: ${r.error}`; values[k] = String(input[k]); continue; }
        if (f.notFuture && ymd(r.date) > today) {
            errors[k] = `${f.label}: لا يمكن أن يكون في المستقبل (${dmy(r.date)})`;
            values[k] = String(input[k]);
            continue;
        }
        parsed[k] = r.date;
        values[k] = f.store(r.date);
    }

    if (has('semestre')) {
        const r = parseQuarter(input.semestre, now);
        if (r.error) { errors.semestre = `الثلاثية: ${r.error}`; values.semestre = String(input.semestre); }
        else values.semestre = r.empty ? '' : r.value;
    }

    for (const [k, f] of Object.entries(NUMBER_FIELDS)) {
        if (!has(k)) continue;
        const r = parseNumber(input[k], f);
        if (r.error) { errors[k] = r.error; values[k] = String(input[k]); }
        else values[k] = r.empty ? '' : r.value;
    }

    for (const k of DIGIT_FIELDS) if (has(k)) values[k] = toLatinDigits(input[k]);

    // تاريخ التبليغ cannot precede the card it notifies. Whichever side the request
    // didn't send comes from the stored row.
    const sideOf = (k) => {
        if (parsed[k]) return parsed[k];
        if (has(k) || !existing[k]) return null;
        const r = parseDate(existing[k], 9999);
        return r.date || null;
    };
    const issued = sideOf('datecarte');
    const served = sideOf('date_tabligh');
    if (issued && served && ymd(served) < ymd(issued) && !errors.date_tabligh && !errors.datecarte) {
        errors[has('date_tabligh') ? 'date_tabligh' : 'datecarte'] =
            `تاريخ التبليغ (${dmy(served)}) لا يمكن أن يسبق تاريخ البطاقة (${dmy(issued)})`;
    }

    return { values, errors };
};

const VALIDATED_FIELDS = [...Object.keys(DATE_FIELDS), 'semestre', ...Object.keys(NUMBER_FIELDS), ...DIGIT_FIELDS];

// One line per invalid field, for alerts and 422 bodies.
const errorText = (errors) => Object.values(errors).join('\n');

// The validated fields of a stored card row (NULL columns left out).
const storedFields = (row) => Object.fromEntries(
    VALIDATED_FIELDS.filter((k) => row[k] !== undefined && row[k] !== null).map((k) => [k, row[k]]));

// Errors of a stored card, checked as a whole (cross-field rules included).
const cardErrors = (row) => validateCard(storedFields(row)).errors;

/*
 * Rows written before validation existed, or a scan the user has not corrected
 * yet, may hold values a legal act must not print. Returns one Arabic message
 * naming each such card, or null when every card is printable.
 */
const unprintableMessage = (cards) => {
    const bad = cards.map((c) => ({ c, errors: cardErrors(c) })).filter((x) => Object.keys(x.errors).length);
    if (!bad.length) return null;
    return 'صحّح بيانات هذه البطاقات قبل توليد المحضر:\n' + bad.map(({ c, errors }) =>
        `• البطاقة ${c.numcarte || `#${c.id_cn_oe}`}: ${Object.values(errors).join('، ')}`).join('\n');
};

// A stored card with its values in canonical form, for printing.
const canonicalCard = (row) => ({ ...row, ...validateCard(storedFields(row)).values });

export {
    MIN_YEAR, toLatinDigits, validateCard, errorText, VALIDATED_FIELDS, todayTunis,
    cardErrors, unprintableMessage, canonicalCard,
};
