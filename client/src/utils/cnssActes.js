/*
 * Grouping بطاقات جبر into one محضر — the client side of
 * server/services/cnssActes.js, which has the authoritative rules:
 *
 *   - a card belongs to at most one محضر (grouping it again MOVES it, after a warning)
 *   - the cards of one محضر share عدد التضمين and تاريخ التبليغ (refused otherwise)
 *   - differing تاريخ بطاقة الجبر only warns
 *
 * The mismatch check is repeated here so the page can explain a refusal before
 * the user even clicks; the server still decides.
 */

// تاريخ التبليغ arrives as YYYY-MM-DD (date picker) or DD/MM/YYYY (desktop import).
const normDate = (s) => {
  s = String(s || '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
};
const normText = (s) => String(s ?? '').trim();

// Fields that belong to the محضر rather than the card.
export const SHARED_FIELDS = [
  { key: 'nbrreg', label: 'عدد التضمين', norm: normText },
  { key: 'date_tabligh', label: 'تاريخ التبليغ', norm: normDate },
];
export const SHARED_KEYS = SHARED_FIELDS.map((f) => f.key);

const blank = (v) => v || 'فارغ';

// "بطاقة واحدة" / "بطاقتان" / "3 بطاقات" / "11 بطاقة".
export const cardsWord = (n) => {
  if (n === 1) return 'بطاقة واحدة';
  if (n === 2) return 'بطاقتان';
  return n >= 3 && n <= 10 ? `${n} بطاقات` : `${n} بطاقة`;
};

/** Shared fields on which the selected cards disagree: [{ label, values }]. */
export function selectionMismatches(cards) {
  return SHARED_FIELDS.map((f) => {
    const seen = new Map();
    cards.forEach((c) => { const k = f.norm(c[f.key]); if (!seen.has(k)) seen.set(k, normText(c[f.key])); });
    return { label: f.label, values: [...seen.values()] };
  }).filter((m) => m.values.length > 1);
}

export const mismatchText = (mismatches) =>
  mismatches.map((m) => `${m.label} مختلف (${m.values.map(blank).join('، ')})`).join(' — ');

/** The confirm() text for a 409 from POST /cnss/:id/actes. */
export function conflictMessage({ conflicts = [], dateCarteValues = [] }) {
  const lines = [];
  if (conflicts.length) {
    lines.push('تنبيه: بعض البطاقات المحددة تابعة لمحضر سابق، والبطاقة لا يمكن أن تكون في محضرين:');
    conflicts.forEach((c) => {
      const what = c.moving.length === 1 ? `البطاقة ${c.moving[0]}` : `البطاقات ${c.moving.join('، ')}`;
      const after = c.remaining > 0
        ? `يبقى في المحضر ${c.numero}: ${cardsWord(c.remaining)} — يجب إعادة طباعته.`
        : `سيُلغى المحضر ${c.numero} لأنه لن تبقى فيه أي بطاقة.`;
      lines.push(`• المحضر ${c.numero}${c.date_ajout ? ` (${c.date_ajout})` : ''}: ${what}. ${after}`);
    });
  }
  if (dateCarteValues.length > 1) {
    lines.push(`تواريخ بطاقات الجبر مختلفة (${dateCarteValues.join('، ')}) — ستُذكر كلها في المحضر.`);
  }
  lines.push('', conflicts.length ? 'نقل هذه البطاقات إلى محضر جديد؟' : 'متابعة توليد المحضر؟');
  return lines.join('\n');
}
