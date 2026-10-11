import { useState } from 'react';
import { validateCard } from '../utils/cnssValidate';

const cellStyle = { padding: '0.3rem 0.4rem', borderRadius: '6px', fontSize: '0.85rem' };
const invalidStyle = { outline: '2px solid #ef4444', outlineOffset: '-1px' };

// Normalize a stored date (YYYY-MM-DD or DD/MM/YYYY) to YYYY-MM-DD for <input type="date">.
const toISODate = (s) => {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

/*
 * A text cell edited in place, used for عدد التضمين in the بطاقات الجبر table.
 *
 * Unlike the تاريخ التبليغ cell beside it, this cannot just save onChange: a date
 * picker fires once when a date is chosen, whereas typing would fire — and PUT —
 * once per keystroke. So it commits on blur or Enter, and only when the text
 * actually changed; Escape abandons the edit.
 */
export function InlineCardText({ value, onCommit, title, placeholder }) {
  const committed = value === null || value === undefined ? '' : String(value);

  /*
   * Uncontrolled on purpose: the typed text only matters at commit time, so the
   * browser owns it and no React state mirrors the prop. `key` makes the input
   * remount when the stored value changes from elsewhere (the card modal, a
   * reload), which re-seeds defaultValue — the one thing an uncontrolled input
   * would otherwise miss. By then the field has been blurred, so no focus is lost.
   */
  return (
    <input type="text" key={committed} defaultValue={committed} title={title} placeholder={placeholder}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        if (next !== committed.trim()) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        // Restore first, so the blur below compares equal and commits nothing.
        else if (e.key === 'Escape') { e.currentTarget.value = committed; e.currentTarget.blur(); }
      }}
      style={{ width: '100%', minWidth: '5.5rem', padding: '0.3rem 0.4rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }} />
  );
}

/*
 * تاريخ التبليغ edited in place.
 *
 * Chrome's date input fires onChange for every partial year while it is typed
 * (0002 → 0020 → 0202 → 2026), so the cell keeps what is typed locally and saves
 * only once the date passes validation against its card (no future date, not
 * before تاريخ البطاقة, a real year). Leaving the cell while it is still invalid
 * explains why and restores the saved date. Clearing the date is always allowed.
 */
export function InlineCardDate({ card, max, onCommit }) {
  const saved = toISODate(card.date_tabligh);
  const [draft, setDraft] = useState(null);   // null = showing the saved value
  const value = draft ?? saved;
  const error = draft === null ? null : validateCard({ date_tabligh: draft }, card).errors.date_tabligh;

  const change = (next) => {
    const err = validateCard({ date_tabligh: next }, card).errors.date_tabligh;
    if (err) { setDraft(next); return; }
    setDraft(null);
    if (next !== saved) onCommit(next);
  };

  return (
    <input type="date" value={value} min="1990-01-01" max={max}
      onChange={(e) => change(e.target.value)}
      onBlur={() => { if (error) { alert(error); setDraft(null); } }}
      title={error || 'تاريخ تبليغ المحضر — يُستعمل في القائمة الشهرية'}
      style={{ ...cellStyle, ...(error ? invalidStyle : null) }} />
  );
}

/* A read-only cell that turns red, with the reason on hover, when its stored value fails validation. */
export function CheckedCell({ error, children, style }) {
  return (
    <td title={error || undefined}
      style={{ ...style, ...(error ? { color: '#ef4444', fontWeight: 700, textDecoration: 'underline wavy #ef4444', whiteSpace: 'nowrap' } : null) }}>
      {children}{error ? ' ⚠' : ''}
    </td>
  );
}
