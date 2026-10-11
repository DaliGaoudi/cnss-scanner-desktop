/*
 * Spell a Tunisian-dinar amount in Arabic words, for the monthly CNSS list's
 * closing line: «أوقفت هذه القائمة على مبلغ جملي قدره : … دينارا و … مليما».
 *
 * The bailiff's convention (per the sample list): the DINAR part is written in
 * words, the MILLIME part is left as digits ("… دينارا و 320 مليما"). The speller
 * is pragmatic — readable, correct for the magnitudes a monthly list reaches —
 * and the result is editable in Word afterwards.
 */

const ONES = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
    'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = { 2: 'عشرون', 3: 'ثلاثون', 4: 'أربعون', 5: 'خمسون', 6: 'ستون', 7: 'سبعون', 8: 'ثمانون', 9: 'تسعون' };
const HUNDREDS = { 1: 'مائة', 2: 'مائتان', 3: 'ثلاثمائة', 4: 'أربعمائة', 5: 'خمسمائة', 6: 'ستمائة', 7: 'سبعمائة', 8: 'ثمانمائة', 9: 'تسعمائة' };

const join = (parts) => parts.filter(Boolean).join(' و');

function below100(n) {
    if (n < 20) return ONES[n];
    const t = Math.floor(n / 10), o = n % 10;
    return o ? `${ONES[o]} و${TENS[t]}` : TENS[t];
}

function below1000(n) {
    const h = Math.floor(n / 100), r = n % 100;
    return join([h ? HUNDREDS[h] : '', r ? below100(r) : '']);
}

// Scaled group word, e.g. thousands → ألف/ألفان/آلاف/ألفاً.
function group(count, [one, two, few, many]) {
    if (count === 1) return one;
    if (count === 2) return two;
    if (count >= 3 && count <= 10) return `${below1000(count)} ${few}`;
    return `${below1000(count)} ${many}`;
}

// Spell a non-negative integer in Arabic words (handles up to billions).
function integerToArabicWords(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n === 0) return ONES[0];
    const milliard = Math.floor(n / 1e9);
    const million = Math.floor((n % 1e9) / 1e6);
    const thousand = Math.floor((n % 1e6) / 1000);
    const unit = n % 1000;
    return join([
        milliard ? group(milliard, ['مليار', 'ملياران', 'مليارات', 'مليار']) : '',
        million ? group(million, ['مليون', 'مليونان', 'ملايين', 'مليون']) : '',
        thousand ? group(thousand, ['ألف', 'ألفان', 'آلاف', 'ألفاً']) : '',
        unit ? below1000(unit) : '',
    ]);
}

// Whole millimes → the dinar+millime phrase. 1 دينار = 1000 مليم.
function amountInWords(millimes) {
    const mm = Math.max(0, Math.floor(Number(millimes) || 0));
    const dinars = Math.floor(mm / 1000);
    const rem = mm % 1000;
    const dinarPart = `${integerToArabicWords(dinars)} ديناراً`;
    return rem > 0 ? `${dinarPart} و ${rem} مليماً` : dinarPart;
}

/*
 * Spell a year the way the acts do: «… من سنة ستة وعشرين وألفين …» for 2026.
 *
 * Note this is the OBLIQUE form (عشرين, ثلاثين …), not the nominative one TENS
 * above carries (عشرون), because the phrase follows «من سنة».
 */
const TENS_OBLIQUE = { 2: 'عشرين', 3: 'ثلاثين', 4: 'أربعين', 5: 'خمسين', 6: 'ستين', 7: 'سبعين', 8: 'ثمانين', 9: 'تسعين' };

function yearInArabicWords(year) {
    const y = Math.floor(Number(year) || 0);
    // Only the 2000s are spelled this way; anything else falls back to digits so a
    // wrong-looking year is obvious on the page rather than silently mis-worded.
    if (y < 2000 || y > 2099) return String(y);

    const rest = y % 100;
    if (rest === 0) return 'ألفين';

    const belowHundredOblique = (n) => {
        if (n < 20) return ONES[n];
        const t = Math.floor(n / 10), o = n % 10;
        return o ? `${ONES[o]} و${TENS_OBLIQUE[t]}` : TENS_OBLIQUE[t];
    };

    return `${belowHundredOblique(rest)} وألفين`;
}

module.exports = { integerToArabicWords, amountInWords, yearInArabicWords };
