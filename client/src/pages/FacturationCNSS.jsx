import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, FileText, CalendarDays, ArrowLeft } from 'lucide-react';
import API_BASE from '../config';

const API = `${API_BASE}/cnss`;

/*
 * CNSS facturation — every بطاقة جبر whose act was delivered (تاريخ التبليغ),
 * grouped by month. Each month is its own section with a totals row and a
 * «طباعة فاتورة الشهر» button that opens the Word bill the office sends to CNSS
 * natively in Word (POST /cnss/list/open — no Mark-of-the-Web block). Data comes
 * from GET /cnss/facturation/months. Ported from the webapp.
 */
export default function FacturationCNSS() {
  const navigate = useNavigate();
  const [months, setMonths]       = useState([]);
  const [grandTotal, setGrand]    = useState('0,000');
  const [loading, setLoading]     = useState(true);
  const [opening, setOpening]     = useState(null); // "year-month" being generated

  const fetchMonths = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API}/facturation/months`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setMonths(json.months || []);
      setGrand(json.grandTotal || '0,000');
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchMonths(); }, [fetchMonths]);

  // Open one month's Word bill in Word.
  const printMonth = async (m) => {
    const key = `${m.year}-${m.month}`;
    setOpening(key);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API}/list/open`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: m.year, month: m.month }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { alert('تعذّر توليد الفاتورة: ' + (d.error || res.status)); return; }
      if (!d.opened && d.path) alert('تم إنشاء الملف:\n' + d.path);
    } catch (e) { console.error(e); alert('خطأ في الاتصال بالخادم'); }
    finally { setOpening(null); }
  };

  const COLS = [
    { key: 'rang', label: '#' },
    { key: 'nbrreg', label: 'عدد التضمين' },
    { key: 'numcarte', label: 'عدد البطاقة' },
    { key: 'nom', label: 'اسم المطلوب' },
    { key: 'numcnss', label: 'عدد الإنخراط' },
    { key: 'date_tabligh', label: 'تاريخ التبليغ' },
    { key: 'ajr', label: 'مجموع الأجور', amount: true },
    { key: 'vat', label: 'أ ق م', amount: true },
    { key: 'exp', label: 'مجموع المصاريف', amount: true },
    { key: 'total', label: 'أجرة المحضر', amount: true, total: true },
  ];

  return (
    <div className="animate-fade" dir="rtl">
      {/* ── Toolbar ── */}
      <div className="topbar no-print" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-main)' }} onClick={() => navigate('/cnss')}>
            <ArrowLeft size={18} /> رجوع
          </button>
          <Receipt size={22} style={{ color: 'var(--primary)' }} />
          <h2 style={{ color: 'var(--primary)', margin: 0 }}>فوترة الضمان الاجتماعي</h2>
        </div>
        <div className="summary-item" style={{ textAlign: 'left' }}>
          <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>المجموع الجملي لكل الأشهر</span>
          <strong style={{ fontSize: '1.2rem', color: 'var(--primary)' }} dir="ltr">{grandTotal} د.ت</strong>
        </div>
      </div>

      {loading ? (
        <p style={{ padding: '3rem', textAlign: 'center', opacity: 0.6 }}>جاري التحميل…</p>
      ) : months.length === 0 ? (
        <div className="glass" style={{ padding: '3rem', textAlign: 'center', opacity: 0.7 }}>
          لا توجد محاضر مُبلَّغة بعد. أدخِل «تاريخ التبليغ» في بطاقات الجبر لتظهر هنا مجمَّعة حسب الشهر.
        </div>
      ) : months.map((m) => {
        const key = `${m.year}-${m.month}`;
        return (
          <div key={key} className="glass table-container" style={{ marginBottom: '1.5rem' }}>
            {/* ── Month header ── */}
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--card-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <CalendarDays size={20} style={{ color: 'var(--primary)' }} />
                <h3 style={{ margin: 0, color: 'var(--primary)' }}>{m.label}</h3>
                <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>({m.count} محضر)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <span style={{ fontWeight: 700 }}>المجموع: <span dir="ltr" style={{ color: 'var(--primary)' }}>{m.t_total} د.ت</span></span>
                <button className="btn no-print" onClick={() => printMonth(m)} disabled={opening === key}>
                  <FileText size={18} /> {opening === key ? 'جاري التوليد…' : 'طباعة فاتورة الشهر'}
                </button>
              </div>
            </div>

            {/* ── Month table ── */}
            <table>
              <thead>
                <tr>{COLS.map((c) => <th key={c.key} style={c.amount ? { textAlign: 'left' } : null}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {m.rows.map((row) => (
                  <tr key={row.id_cn_oe} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cnss/${row.id_cn}`)}>
                    {COLS.map((c) => (
                      <td key={c.key} style={c.amount ? { textAlign: 'left', fontWeight: c.total ? 700 : 400, color: c.total ? 'var(--primary)' : 'inherit' } : null} dir={c.amount ? 'ltr' : undefined}>
                        {row[c.key] === '' || row[c.key] == null ? '—' : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
                {/* ── Totals row ── */}
                <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  <td colSpan={6} style={{ textAlign: 'left' }}>المجموع العام</td>
                  <td style={{ textAlign: 'left' }} dir="ltr">{m.t_ajr}</td>
                  <td style={{ textAlign: 'left' }} dir="ltr">{m.t_vat}</td>
                  <td style={{ textAlign: 'left' }} dir="ltr">{m.t_exp}</td>
                  <td style={{ textAlign: 'left', color: 'var(--primary)' }} dir="ltr">{m.t_total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      <style dangerouslySetInnerHTML={{ __html: `
        .summary-item { display: flex; flex-direction: column; gap: 2px; }
      `}} />
    </div>
  );
}
