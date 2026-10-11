import { useState } from 'react';
import { Building2, KeyRound, Eye, FileText, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import API_BASE from '../config';
import LetterheadPreview from '../components/LetterheadPreview';

const API = `${API_BASE}/onboarding`;
const EMPTY = { officeName: '', officeNameFr: '', officeCity: '', officeAddress: '', officePhone: '', officeFax: '', taxId: '', officeRib: '', officeCnss: '',
  officeJurisdiction: '', cnssBureau: '', cnssRegion: '' };

const FIELDS = [
  { k: 'officeName', label: 'اسم العدل المنفذ (الإسم الكامل)', ph: 'مثال: العدل صلاح بن علي' },
  { k: 'officeNameFr', label: 'الاسم باللاتينية (للترويسة الفرنسية)', ph: 'Maître Salah Ben Ali' },
  { k: 'officeCity', label: 'المدينة («العدل المنفذ ب…» في الترويسة)', ph: 'مثال: سوسة' },
  // Printed in the body of every محضر — see server/config.js SOUSSE_DEFAULTS.
  { k: 'officeJurisdiction', label: 'الدائرة القضائية («بالدائرة القضائية …»)', ph: 'مثال: لمحكمة الإستئناف بسوسة' },
  { k: 'cnssBureau', label: 'المكتب الجهوي للصندوق («بواسطة مكتبه الجهوي …»)', ph: 'مثال: بسوسة الكائن بشارع الجمهورية بسوسة' },
  { k: 'cnssRegion', label: 'جهة المدير الجهوي للشؤون الإجتماعية', ph: 'مثال: بسوسة' },
  { k: 'officeAddress', label: 'العنوان', ph: 'الشارع، المدينة' },
  { k: 'officePhone', label: 'الهاتف' },
  { k: 'officeFax', label: 'الفاكس' },
  { k: 'taxId', label: 'المعرف الجبائي' },
  { k: 'officeRib', label: 'الحساب البنكي (RIB)', ph: '05500000022300094016' },
  { k: 'officeCnss', label: 'معرّف CNSS', ph: '4543508503 & 550867 - 04' },
];

const label = { display: 'block', marginBottom: '0.35rem', color: 'var(--text-muted)', fontSize: '0.8rem' };
const input = { width: '100%', padding: '0.55rem' };

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState('details'); // details | preview
  const [form, setForm] = useState(EMPTY);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const passwordValid = () => {
    if (!password) return true; // optional
    if (password.length < 4) { alert('كلمة المرور قصيرة جداً (4 أحرف على الأقل).'); return false; }
    if (password !== confirm) { alert('كلمتا المرور غير متطابقتين.'); return false; }
    return true;
  };

  const complete = async (openTemplate) => {
    if (!passwordValid()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, password: password || undefined }),
      });
      if (!res.ok) { alert('تعذّر الحفظ. حاول مرة أخرى.'); setBusy(false); return; }
      if (openTemplate) localStorage.setItem('openSettingsTemplate', '1');
      onComplete();
    } catch (e) { alert('خطأ في الاتصال'); setBusy(false); }
  };

  const openInWord = async () => {
    try {
      const res = await fetch(`${API}/open-preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { alert(d.error || 'تعذّر فتح المعاينة في Word'); return; }
      if (!d.opened && d.path) alert('تم إنشاء الملف:\n' + d.path);
    } catch (e) { alert('خطأ في الاتصال'); }
  };

  return (
    /*
     * #root is `height: 100vh; overflow: hidden` — inside the app the scrolling is
     * done by .main-content. This screen renders outside that layout, so it needs
     * its own scroll container or the form is clipped at the fold (same fix as the
     * webapp's onboarding).
     */
    <div style={{ flex: 1, height: '100vh', overflowY: 'auto', overflowX: 'hidden' }}>
    <div className="animate-fade" dir="rtl" style={{ maxWidth: 820, margin: '2rem auto', padding: '0 1rem 3rem' }}>
      {step === 'details' && (
        <div className="glass" style={{ padding: '2rem' }}>
          <h2 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: 0 }}>
            <Building2 size={24} /> بيانات المكتب
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0 }}>
            تظهر هذه البيانات في ترويسة المحاضر التي يولّدها البرنامج. يمكنك تركها فارغة وإكمالها لاحقاً من الإعدادات.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {FIELDS.map((f) => (
              <div key={f.k} style={f.k === 'officeName' || f.k === 'officeAddress' ? { gridColumn: 'span 2' } : null}>
                <label style={label}>{f.label}</label>
                <input style={input} value={form[f.k]} placeholder={f.ph || ''} onChange={(e) => set(f.k, e.target.value)} />
              </div>
            ))}
          </div>

          <h3 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
            <KeyRound size={18} /> كلمة مرور التطبيق <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>(اختياري)</span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div><label style={label}>كلمة المرور</label>
              <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="اتركها فارغة للإبقاء على الافتراضية" /></div>
            <div><label style={label}>تأكيد كلمة المرور</label>
              <input style={input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.75rem', gap: '1rem' }}>
            <button className="btn" style={{ background: 'var(--surface-2)' }} disabled={busy} onClick={() => complete(false)}>تخطّي الآن</button>
            <button className="btn" disabled={busy} onClick={() => { if (passwordValid()) setStep('preview'); }}>
              معاينة النموذج <ArrowLeft size={18} />
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="glass" style={{ padding: '2rem' }}>
          <h2 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: 0 }}>
            <Eye size={24} /> معاينة المحضر
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0 }}>
            هكذا ستظهر ترويستك في المحاضر. للمعاينة الدقيقة افتح ملف Word. يمكنك تعديل النموذج الآن أو لاحقاً من الإعدادات.
          </p>

          <LetterheadPreview profile={form} />

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="btn" style={{ background: 'var(--surface-2)' }} disabled={busy} onClick={() => setStep('details')}>
                <ArrowRight size={18} /> رجوع
              </button>
              <button className="btn" style={{ background: 'var(--surface-2)' }} disabled={busy} onClick={openInWord}>
                <FileText size={18} /> فتح في Word
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="btn" style={{ background: 'var(--card-bg)', border: '1px solid var(--primary)', color: 'var(--primary)' }} disabled={busy} onClick={() => complete(true)}>
                تعديل النموذج الآن
              </button>
              <button className="btn" disabled={busy} onClick={() => complete(false)}>
                <Check size={18} /> إنهاء والدخول
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
