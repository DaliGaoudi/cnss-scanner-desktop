/*
 * The بطاقة جبر form: its empty state and the per-act fee statement math, shared
 * by the register page and the card modal.
 */

// Per-act fee statement, split into two billing sections. Amounts are whole
// millimes (1 د.ت = 1000 مليم). VAT (أ ق م) is applied to the الأجور section only.
//   الأجور  → VAT-bearing base.
//   مصاريف  → no VAT.
export const AJR_FIELDS = [
  { k: 'fee_original', l: 'أصل المحضر' },
  { k: 'fee_counterparts', l: 'النظائر' },
  { k: 'fee_legal_copy', l: 'النسخة القانونية' },
  { k: 'fee_office_copy', l: 'النسخة المكتبية' },
  { k: 'fee_movement', l: 'التوجه' },
  { k: 'fee_copies', l: 'نسخ الأوراق' },
];
export const EXP_FIELDS = [
  { k: 'fee_travel', l: 'التنقل' },
  { k: 'fee_registration', l: 'التسجيل' },
  { k: 'fee_stamp', l: 'الترسيم' },
  { k: 'fee_post', l: 'البريد' },
];
// All manual-input fee columns (the VAT line fee_aqm is derived, not typed).
const FEE_KEYS = [...AJR_FIELDS, ...EXP_FIELDS].map((f) => f.k);
export const DEFAULT_VAT_RATE = '19';
export const toMillimes = (v) => parseInt(String(v || '').replace(/[^\d]/g, ''), 10) || 0;
const sumKeys = (form, fields) => fields.reduce((s, f) => s + toMillimes(form[f.k]), 0);
// vat_rate is a percentage; blank/invalid → 19% default.
export const vatRateOf = (form) => {
  const raw = String(form.vat_rate ?? '').replace(',', '.').trim();
  if (raw === '') return parseFloat(DEFAULT_VAT_RATE);
  const n = parseFloat(raw);
  return isNaN(n) ? parseFloat(DEFAULT_VAT_RATE) : n;
};
export const ajrTotalMillimes = (form) => sumKeys(form, AJR_FIELDS);
export const expTotalMillimes = (form) => sumKeys(form, EXP_FIELDS);
export const vatMillimes = (form) => Math.round(ajrTotalMillimes(form) * vatRateOf(form) / 100);
export const grandTotalMillimes = (form) => ajrTotalMillimes(form) + vatMillimes(form) + expTotalMillimes(form);
// millimes → "D DDD,MMM" (Tunisian dinars; comma = millime decimal).
export const formatDinar = (millimes) =>
  String(Math.floor(millimes / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + String(millimes % 1000).padStart(3, '0');

export const EMPTY_CARD = { numcarte: '', datecarte: '', date_tabligh: '', semestre: '', dette: '', pourcentage: '1.5', datesins: '', nbrreg: '',
  vat_rate: DEFAULT_VAT_RATE,
  ...Object.fromEntries(FEE_KEYS.map((k) => [k, ''])) };
