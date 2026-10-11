import { useState } from 'react';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { toLatinDigits } from '../utils/cnssValidate';
import {
  AJR_FIELDS, EXP_FIELDS, DEFAULT_VAT_RATE, toMillimes, ajrTotalMillimes, expTotalMillimes,
  vatMillimes, grandTotalMillimes, formatDinar,
} from '../utils/cnssCardForm';

/*
 * Add / edit one بطاقة جبر: its fields, each with the validation message the
 * register page puts in `errors`, and the collapsible الأجور fee statement.
 */
export default function CnssCardModal({ editing, acte, acteCount, form, setField, errors, onSubmit, onClose }) {
  const [showFees, setShowFees] = useState(false);
  return (
    <div className="modal-overlay no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass card animate-scale" style={{ width: 620, maxWidth: '100%', padding: '2rem', maxHeight: '95vh', overflowY: 'auto', borderRadius: '16px' }} dir="rtl">
        <h3 style={{ color: 'var(--primary)', marginBottom: '1.5rem', textAlign: 'center' }}>
          {editing ? 'تعديل بطاقة جبر' : 'إضافة بطاقة جبر'}
        </h3>
        {acte && acteCount > 1 && (
          <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', borderRadius: '8px', fontSize: '0.85rem',
            border: '1px solid var(--primary)', background: 'var(--surface-2)' }}>
            هذه البطاقة ضمن المحضر {acte.numero} (عدد بطاقاته: {acteCount}) —
            تغيير عدد التضمين أو تاريخ التبليغ يُطبَّق على كل بطاقات المحضر.
          </div>
        )}
        <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem' }}>
          {[
            { k: 'numcarte', l: 'عدد بطاقة الجبر' },
            { k: 'datecarte', l: 'تاريخ بطاقة الجبر', ph: '21/05/2026' },
            { k: 'semestre', l: 'الثلاثية', ph: '04/2021' },
            { k: 'dette', l: 'أصل الدين (د.ت)', ph: '2959.306' },
            { k: 'pourcentage', l: 'نسبة الخطية في الشهر (%)' },
            { k: 'datesins', l: 'تاريخ احتساب الخطايا (تلقائي)' },
            { k: 'nbrreg', l: 'عدد التضمين (بدفتر التنفيذ)' },
          ].map(f => (
            <div key={f.k}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', opacity: 0.8 }}>{f.l}</label>
              <input type="text" value={form[f.k] || ''} placeholder={f.ph || ''}
                onChange={(e) => setField(f.k, e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px',
                  ...(errors[f.k] ? { outline: '2px solid #ef4444', outlineOffset: '-1px' } : null) }} />
              {errors[f.k] && (
                <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.3rem' }}>{errors[f.k]}</div>
              )}
            </div>
          ))}

          {/* Errors on fields this form doesn't show (تاريخ التبليغ, VAT rate) — fixed in the table. */}
          {Object.entries(errors).filter(([k]) => !['numcarte', 'datecarte', 'semestre', 'dette', 'pourcentage', 'datesins', 'nbrreg'].includes(k)).map(([k, msg]) => (
            <div key={k} style={{ gridColumn: 'span 2', color: '#ef4444', fontSize: '0.8rem' }}>{msg}</div>
          ))}

          {/* ── الأجور — the act's fee statement (collapsed by default) ── */}
          <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--card-border)', paddingTop: '0.9rem', marginTop: '0.25rem' }}>
            <button type="button" onClick={() => setShowFees((v) => !v)}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--primary)', fontWeight: 600 }}>
                {showFees ? <ChevronDown size={18} /> : <ChevronLeft size={18} />} الأجور
              </span>
              <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                المجموع <strong style={{ color: 'var(--primary)' }} dir="ltr">{formatDinar(grandTotalMillimes(form))}</strong> د.ت
              </span>
            </button>

            {showFees && (() => {
              const ajr = ajrTotalMillimes(form);
              const vat = vatMillimes(form);
              const exp = expTotalMillimes(form);
              const sectionHeader = (label) => (
                <div style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary)', background: 'var(--surface-2)', borderBottom: '1px solid var(--card-border)' }}>{label}</div>
              );
              const feeRow = (f) => {
                const mm = toMillimes(form[f.k]);
                return (
                  <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.3rem 0.85rem', borderBottom: '1px solid var(--card-border)' }}>
                    <label style={{ flex: 1, fontSize: '0.85rem' }}>{f.l}</label>
                    <input type="text" inputMode="numeric" value={form[f.k] || ''} placeholder="0"
                      onChange={(e) => setField(f.k, toLatinDigits(e.target.value).replace(/[^\d]/g, ''))}
                      style={{ width: 110, padding: '0.35rem 0.5rem', borderRadius: '6px', textAlign: 'center' }} />
                    <span style={{ width: 92, textAlign: 'left', fontSize: '0.8rem', color: 'var(--text-muted)' }} dir="ltr">{mm ? formatDinar(mm) : '—'}</span>
                  </div>
                );
              };
              const subtotalRow = (label, mm) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.85rem', borderBottom: '1px solid var(--card-border)', fontSize: '0.82rem', fontWeight: 600 }}>
                  <span style={{ opacity: 0.85 }}>{label}</span>
                  <span dir="ltr">{formatDinar(mm)} د.ت</span>
                </div>
              );
              return (
              <div style={{ marginTop: '0.85rem', border: '1px solid var(--card-border)', borderRadius: '10px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', padding: '0.35rem 0.85rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--card-border)' }}>
                  <span style={{ flex: 1 }}>البيان</span><span style={{ width: 110, textAlign: 'center' }}>المبلغ (مليم)</span><span style={{ width: 92, textAlign: 'left' }}>د.ت</span>
                </div>

                {/* ── الأجور (VAT base) ── */}
                {sectionHeader('الأجور')}
                {AJR_FIELDS.map(feeRow)}
                {subtotalRow('مجموع الأجور', ajr)}

                {/* ── أ ق م (VAT) — rate editable, amount derived ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.3rem 0.85rem', borderBottom: '1px solid var(--card-border)' }}>
                  <label style={{ flex: 1, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    أ ق م
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                      (<input type="text" inputMode="decimal" value={form.vat_rate ?? ''} placeholder={DEFAULT_VAT_RATE}
                        onChange={(e) => setField('vat_rate', toLatinDigits(e.target.value).replace(/[^\d.,]/g, ''))}
                        style={{ width: 44, padding: '0.15rem 0.3rem', borderRadius: '6px', textAlign: 'center', fontSize: '0.8rem' }} />%)
                    </span>
                  </label>
                  <span style={{ width: 110, textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{vat ? vat : '—'}</span>
                  <span style={{ width: 92, textAlign: 'left', fontSize: '0.8rem', color: 'var(--text-muted)' }} dir="ltr">{vat ? formatDinar(vat) : '—'}</span>
                </div>

                {/* ── مصاريف (no VAT) ── */}
                {sectionHeader('مصاريف')}
                {EXP_FIELDS.map(feeRow)}
                {subtotalRow('مجموع المصاريف', exp)}

                {/* ── grand total ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.55rem 0.85rem', background: 'var(--surface-2)', fontWeight: 700 }}>
                  <span>المجموع العام</span>
                  <span style={{ color: 'var(--primary)' }} dir="ltr">{formatDinar(ajr + vat + exp)} د.ت</span>
                </div>
              </div>
              );
            })()}
          </div>

          <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <button type="submit" className="btn" style={{ flex: 1 }}>{editing ? 'حفظ التعديلات' : 'إضافة البطاقة'}</button>
            <button type="button" className="btn" style={{ flex: 1, background: 'var(--surface-2)' }} onClick={onClose}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
