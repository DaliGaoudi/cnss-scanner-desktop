import { useState, useEffect, useRef, useCallback } from 'react';
import { UploadCloud, Eye, Check, X, RotateCcw, AlertTriangle, FileText } from 'lucide-react';
import API_BASE from '../config';

const API = `${API_BASE}/word-import`;
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

/*
 * "Import your own Word file": the office gives one of its documents, the app
 * builds its act + monthly-bill templates in that look (and wording when it can),
 * the user reviews what was found, previews it in Word, and approves. Used in
 * Settings and in the one-time prompt after the first login (App.jsx).
 * Server: routes/wordImport.js.
 */
const MODE_TEXT = {
  mergefield: 'ملف دمج مراسلات: حُدّدت الحقول من أسمائها مباشرة — نصّ محضركم محفوظ كما هو.',
  filled: 'محضر معبّأ: حُدّدت مواضع البيانات في نصّكم، وتُعوَّض في كل محضر ببيانات المطلوب والبطاقات.',
  look: 'تُعتمد ترويستكم وخطّكم مع نصّ المحضر العادي للبرنامج.',
};

const MODE_SHORT = { mergefield: 'نصّكم وترويستكم', filled: 'نصّكم وترويستكم', look: 'ترويستكم وخطّكم' };

export default function WordImport({ onDone, compact }) {
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);     // pending result under review
  const [busy, setBusy] = useState(null);          // label of what's running
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const s = await (await fetch(`${API}/status`, { headers: auth() })).json();
      setStatus(s);
      if (s.pending) setReport(s.pending);
    } catch (e) { /* offline local server: nothing to show */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const analyze = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setError(''); setReport(null); setBusy('جارٍ تحليل الملف… قد يستغرق ذلك دقيقة.');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/analyze`, { method: 'POST', headers: auth(), body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || 'تعذّر تحليل الملف.');
      else setReport(d.report);
    } catch (err) { setError('تعذّر الاتصال.'); }
    setBusy(null);
  };

  const preview = async (doc) => {
    setBusy('جارٍ فتح المعاينة في Word…'); setError('');
    try {
      const res = await fetch(`${API}/preview`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ doc }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) setError(d.error || 'تعذّرت المعاينة.');
      else if (!d.opened && d.path) alert('تم إنشاء الملف:\n' + d.path);
    } catch (err) { setError('تعذّر الاتصال.'); }
    setBusy(null);
  };

  const apply = async () => {
    setBusy('جارٍ الاعتماد…');
    try {
      const res = await fetch(`${API}/apply`, { method: 'POST', headers: auth() });
      if (res.ok) { setReport(null); await load(); if (onDone) onDone(true); }
      else setError((await res.json().catch(() => ({}))).error || 'تعذّر الاعتماد.');
    } catch (err) { setError('تعذّر الاتصال.'); }
    setBusy(null);
  };

  const discard = async () => {
    await fetch(`${API}/pending`, { method: 'DELETE', headers: auth() }).catch(() => {});
    setReport(null);
  };

  const reset = async () => {
    if (!window.confirm('العودة إلى الشكل العادي للمحضر والقائمة الشهرية؟ يبقى ملفكم ويمكن استيراده من جديد.')) return;
    await fetch(API, { method: 'DELETE', headers: auth() }).catch(() => {});
    load();
  };

  const muted = { color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, margin: 0 };
  const chip = (ok) => ({ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', marginInlineStart: '0.4rem',
    background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: ok ? '#22c55e' : '#ef4444' });

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {!report && (
        <p style={muted}>
          اختاروا أحد ملفات Word الخاصة بمكتبكم — محضر إعلام بطاقة جبر سابق، أو نموذج دمج المراسلات الذي تستعملونه —
          ليطبع البرنامج المحاضر والقائمة الشهرية بنفس الترويسة والخط{compact ? '' : ' وبنفس صياغتكم كلما أمكن'}. تراجعون النتيجة وتعاينونها في Word قبل اعتمادها.
        </p>
      )}

      {status && status.active && !report && (
        <div className="glass" style={{ padding: '0.8rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem' }}>
            <Check size={16} style={{ verticalAlign: 'middle', color: '#22c55e' }} /> المعتمد حالياً: نموذج مستورد من
            <b> <bdi>{status.active.sourceName}</bdi></b> — {MODE_SHORT[status.active.mode] || ''}
          </span>
          <button className="btn" style={{ background: '#ef444420', color: '#ef4444' }} onClick={reset}>
            <RotateCcw size={16} /> العودة إلى الشكل العادي
          </button>
        </div>
      )}

      {!report && (
        <div>
          <input type="file" ref={fileRef} accept=".docx,.doc" style={{ display: 'none' }} onChange={analyze} />
          <button className="btn" disabled={!!busy} onClick={() => fileRef.current && fileRef.current.click()}>
            <UploadCloud size={18} /> {status && status.active ? 'استيراد ملف آخر' : 'اختيار ملف Word'}
          </button>
        </div>
      )}

      {busy && <div style={{ color: 'var(--primary)', fontSize: '0.9rem' }}>{busy}</div>}
      {error && <div style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '0.6rem', borderRadius: '6px', whiteSpace: 'pre-line' }}>{error}</div>}

      {report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div className="glass" style={{ padding: '0.9rem 1rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}><FileText size={16} style={{ verticalAlign: "middle" }} /> <bdi>{report.sourceName}</bdi></div>
            <p style={muted}>{MODE_TEXT[report.mode]}</p>
            {report.wordingFallback && <p style={{ ...muted, color: '#f59e0b' }}>{report.wordingFallback}</p>}
            <p style={muted}>
              الترويسة: <b>{report.look.letterhead || 'لم نجدها'}</b>
              {report.look.font && <> — الخط: <b dir="ltr">{report.look.font}</b>{report.look.size ? ` (${report.look.size})` : ''}</>}
            </p>
            {report.feeTable && <p style={muted}>{report.feeTable}</p>}
          </div>

          {report.mode !== 'look' && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>البيانات التي تُملأ في كل محضر</div>
              <table style={{ width: '100%', fontSize: '0.85rem' }}>
                <tbody>
                  {report.found.map((f) => (
                    <tr key={f.tag}><td style={{ padding: '0.3rem 0.5rem' }}>{f.label}<span style={chip(true)}>✓</span></td>
                      <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-muted)' }}>{f.source}</td></tr>
                  ))}
                  {report.missing.map((f) => (
                    <tr key={f.tag}><td style={{ padding: '0.3rem 0.5rem' }}>{f.label}<span style={chip(false)}>غير موجود</span></td>
                      <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-muted)' }}>{f.required ? 'ضروري' : 'لن يظهر في المحضر'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(report.warnings.length > 0 || report.leftovers.length > 0 || report.removedRows > 0) && (
            <div style={{ border: '1px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.08)', borderRadius: '8px', padding: '0.7rem 0.9rem', fontSize: '0.85rem', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, color: '#f59e0b' }}><AlertTriangle size={16} style={{ verticalAlign: 'middle' }} /> للمراجعة</div>
              {report.removedRows > 0 && <div>حُذفت {report.removedRows} صف(وف) بطاقات إضافية — يتكرّر صف البطاقة تلقائياً لكل بطاقة.</div>}
              {report.leftovers.length > 0 && (
                <div>هذه القيم بقيت كما هي وستُطبع في كل محضر: <b dir="ltr">{report.leftovers.join(' ، ')}</b> — تأكّدوا في المعاينة أنها ثابتة فعلاً.</div>
              )}
              {report.warnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button className="btn" style={{ background: 'var(--surface-2)', color: 'var(--text-main)' }} disabled={!!busy} onClick={() => preview('act')}>
              <Eye size={18} /> معاينة المحضر في Word
            </button>
            <button className="btn" style={{ background: 'var(--surface-2)', color: 'var(--text-main)' }} disabled={!!busy} onClick={() => preview('list')}>
              <Eye size={18} /> معاينة القائمة الشهرية
            </button>
            <button className="btn" disabled={!!busy} onClick={apply}><Check size={18} /> اعتماد</button>
            <button className="btn" style={{ background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-main)' }} disabled={!!busy} onClick={discard}>
              <X size={18} /> إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
