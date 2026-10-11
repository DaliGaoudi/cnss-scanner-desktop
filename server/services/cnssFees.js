/*
 * Per-act fee statement (أتعاب) math, shared by the act render (routes/cnss.js)
 * and the monthly billing list (services/listRender.js) so the numbers always
 * agree. Amounts are whole MILLIMES (1 dinar = 1000 millimes).
 *
 *   الأجور (fees/wages)  → VAT-bearing base.
 *   مصاريف (expenses)    → no VAT.
 *   fee_aqm (أ ق م)      → the VAT itself = vat_rate% × الأجور subtotal (DERIVED).
 */
const AJR_KEYS = ['fee_copies', 'fee_movement', 'fee_office_copy', 'fee_legal_copy', 'fee_counterparts', 'fee_original'];
const EXP_KEYS = ['fee_travel', 'fee_registration', 'fee_stamp', 'fee_post'];
const DEFAULT_VAT_RATE = 19;

const groupThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const toMillimes = (v) => {
    const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? 0 : n;
};

// vat_rate is a percentage; blank/invalid falls back to the 19% default.
const vatRateOf = (card) => {
    const raw = String(card.vat_rate == null ? '' : card.vat_rate).replace(',', '.').trim();
    if (raw === '') return DEFAULT_VAT_RATE;
    const n = parseFloat(raw);
    return isNaN(n) ? DEFAULT_VAT_RATE : n;
};

// millimes (integer) → "D DDD,MMM" (comma = millime decimal). '' for empty/zero.
const formatMillimes = (millimes) => {
    if (!millimes || millimes <= 0) return '';
    return groupThousands(Math.floor(millimes / 1000)) + ',' + String(millimes % 1000).padStart(3, '0');
};

// Core billing math for one card, in whole millimes.
//   ajr = الأجور subtotal (VAT base)   vat = أ ق م = round(ajr × rate%)
//   exp = مصاريف subtotal              total = ajr + vat + exp
const computeFees = (card) => {
    const ajr = AJR_KEYS.reduce((s, k) => s + toMillimes(card[k]), 0);
    const exp = EXP_KEYS.reduce((s, k) => s + toMillimes(card[k]), 0);
    const rate = vatRateOf(card);
    const vat = Math.round(ajr * rate / 100);
    return { ajr, exp, vat, rate, total: ajr + vat + exp };
};

module.exports = { AJR_KEYS, EXP_KEYS, DEFAULT_VAT_RATE, toMillimes, vatRateOf, formatMillimes, computeFees };
