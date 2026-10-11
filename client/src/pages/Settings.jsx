import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Check, KeyRound, Building2, FileText, UploadCloud, Download, RotateCcw, ShieldCheck, Eye, RefreshCw, Sparkles } from 'lucide-react';
import API_BASE from '../config';
import LetterheadPreview from '../components/LetterheadPreview';
import WordImport from '../components/WordImport';

const OFFICE_FIELDS = [
  { k: 'officeName', label: 'اسم العدل المنفذ', span: true },
  { k: 'officeNameFr', label: 'الاسم باللاتينية (للترويسة الفرنسية)' },
  { k: 'officeCity', label: 'المدينة («العدل المنفذ ب…» في الترويسة)' },
  { k: 'officeAddress', label: 'العنوان', span: true },
  { k: 'officePhone', label: 'الهاتف' },
  { k: 'officeFax', label: 'الفاكس' },
  { k: 'taxId', label: 'المعرف الجبائي' },
  { k: 'officeRib', label: 'الحساب البنكي (RIB)' },
  { k: 'officeCnss', label: 'معرّف CNSS' },
  // Printed in the body of every محضر.
  { k: 'officeJurisdiction', label: 'الدائرة القضائية («بالدائرة القضائية …»)', ph: 'لمحكمة الإستئناف بسوسة', span: true },
  { k: 'cnssBureau', label: 'المكتب الجهوي للصندوق («بواسطة مكتبه الجهوي …»)', ph: 'بسوسة الكائن بشارع الجمهورية بسوسة', span: true },
  { k: 'cnssRegion', label: 'جهة المدير الجهوي للشؤون الإجتماعية', ph: 'بسوسة' },
];
const EMPTY_PROFILE = { officeName: '', officeNameFr: '', officeCity: '', officeAddress: '', officePhone: '', officeFax: '', taxId: '', officeRib: '', officeCnss: '',
  officeJurisdiction: '', cnssBureau: '', cnssRegion: '' };

const API = `${API_BASE}/settings`;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

// Download a token-protected endpoint as a file.
async function downloadAuth(url, filename) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) { alert('فشل التنزيل'); return; }
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = blobUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(blobUrl);
}

// Ask the app to render + open a doc natively in Word (POST endpoint returns JSON).
async function openInWord(url) {
  try {
    const res = await fetch(url, { method: 'POST', headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) { alert(d.error || 'تعذّر الفتح في Word'); return; }
    if (!d.opened && d.path) alert('تم إنشاء الملف:\n' + d.path);
  } catch (e) { alert('خطأ في الاتصال'); }
}

function Card({ icon, title, children }) {
  return (
    <div className="glass" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--primary)', marginBottom: '1.25rem' }}>
        {icon}<h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

const label = { display: 'block', marginBottom: '0.4rem', color: 'var(--text-muted)', fontSize: '0.8rem' };
const input = { width: '100%', padding: '0.6rem' };

export default function Settings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [showPreview, setShowPreview] = useState(false);
  const [hasCustomTemplate, setHasCustomTemplate] = useState(false);
  const [license, setLicense] = useState(null);

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  const [savedOffice, setSavedOffice] = useState(false);
  const [savedPw, setSavedPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upd, setUpd] = useState({ state: 'idle' });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncGuard, setSyncGuard] = useState(null);
  const [guardBusy, setGuardBusy] = useState(false);
  const fileRef = useRef(null);

  // Poll update status so the "check for updates" result is reflected live.
  useEffect(() => {
    let alive = true;
    const tick = () => fetch(`${API_BASE}/update/status`).then((r) => r.json()).then((s) => { if (alive) setUpd(s); }).catch(() => {});
    tick();
    const id = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const checkUpdates = () => fetch(`${API_BASE}/update/check`, { method: 'POST' }).catch(() => {});
  const restartUpdate = () => fetch(`${API_BASE}/update/install`, { method: 'POST' }).catch(() => {});
  const updText = { idle: 'أنت على آخر إصدار', checking: 'جارٍ التحقق…', downloading: `يتم التنزيل… ${upd.percent || 0}%`, downloaded: 'تحديث جاهز للتثبيت' }[upd.state] || '';

  const syncNow = async () => {
    setSyncBusy(true); setSyncMsg('');
    try {
      const res = await fetch(`${API_BASE}/sync/now`, { method: 'POST', headers: authHeaders() });
      setSyncMsg(res.ok ? 'تمت مزامنة السجلات.' : 'تعذّرت المزامنة. تحقّق من الاتصال بالإنترنت.');
    } catch (e) { setSyncMsg('خطأ في الاتصال.'); }
    setSyncBusy(false);
    setTimeout(() => setSyncMsg(''), 3500);
  };

  // Poll the shrink-guard status: auto-push can pause in the background (after a
  // record edit) while the user is sitting on this page, so reflect it live.
  useEffect(() => {
    let alive = true;
    const tick = () => fetch(`${API_BASE}/sync/status`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (alive && s) setSyncGuard(s.shrinkGuard || null); })
      .catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Resolution A: discard local records, take the server copy, resume sync.
  const resolvePull = async () => {
    setGuardBusy(true); setSyncMsg('');
    try {
      const res = await fetch(`${API_BASE}/sync/resolve/pull`, { method: 'POST', headers: authHeaders() });
      if (res.ok) { setSyncGuard(null); setSyncMsg('تم تنزيل نسخة الخادوم واستئناف المزامنة.'); }
      else setSyncMsg((await res.json().catch(() => ({}))).error || 'تعذّر تنزيل نسخة الخادوم.');
    } catch (e) { setSyncMsg('خطأ في الاتصال.'); }
    setGuardBusy(false);
    setTimeout(() => setSyncMsg(''), 4000);
  };

  // Resolution B: keep local records, overwrite the (larger) server copy.
  const resolveForce = async () => {
    if (!window.confirm('تحذير: سيؤدي هذا إلى استبدال بيانات الخادوم وبقية أجهزتك بنسختك المحلية الأصغر. لا يمكن التراجع. هل أنت متأكد؟')) return;
    setGuardBusy(true); setSyncMsg('');
    try {
      const res = await fetch(`${API_BASE}/sync/resolve/force`, { method: 'POST', headers: authHeaders() });
      if (res.ok) { setSyncGuard(null); setSyncMsg('تم استبدال نسخة الخادوم بنسختك.'); }
      else setSyncMsg((await res.json().catch(() => ({}))).error || 'تعذّر الاستبدال.');
    } catch (e) { setSyncMsg('خطأ في الاتصال.'); }
    setGuardBusy(false);
    setTimeout(() => setSyncMsg(''), 4000);
  };

  const load = async () => {
    try {
      const res = await fetch(API, { headers: authHeaders() });
      const j = await res.json();
      setProfile({ ...EMPTY_PROFILE, ...Object.fromEntries(OFFICE_FIELDS.map((f) => [f.k, j[f.k] || ''])) });
      setHasCustomTemplate(!!j.hasCustomTemplate);
    } catch (e) { console.error(e); }
    try {
      const lr = await fetch(`${API_BASE}/license/status`);
      setLicense(await lr.json());
    } catch (e) { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const saveOffice = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${API}/office`, {
        method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (res.ok) { setSavedOffice(true); setTimeout(() => setSavedOffice(false), 2000); window.dispatchEvent(new Event('cnss-settings-changed')); }
      else alert((await res.json()).error || 'فشل الحفظ');
    } catch (e) { alert('خطأ في الاتصال'); }
    setBusy(false);
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (newPw !== confirmPw) { alert('كلمتا المرور غير متطابقتين.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API}/password`, {
        method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      const j = await res.json();
      if (res.ok) { setSavedPw(true); setCurPw(''); setNewPw(''); setConfirmPw(''); setTimeout(() => setSavedPw(false), 2500); }
      else alert(j.error || 'فشل تغيير كلمة المرور');
    } catch (e) { alert('خطأ في الاتصال'); }
    setBusy(false);
  };

  const uploadTemplate = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/template`, { method: 'POST', headers: authHeaders(), body: fd });
      const j = await res.json();
      if (res.ok) { setHasCustomTemplate(true); alert('تم حفظ النموذج المخصّص بنجاح.'); }
      else alert(j.error || 'فشل رفع النموذج');
    } catch (e) { alert('خطأ في الاتصال'); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const resetTemplate = async () => {
    if (!window.confirm('العودة إلى النموذج الافتراضي وحذف النموذج المخصّص؟')) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/template`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) setHasCustomTemplate(false);
      else alert('فشل الحذف');
    } catch (e) { alert('خطأ في الاتصال'); }
    setBusy(false);
  };

  return (
    <div className="animate-fade" dir="rtl" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="topbar" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-main)' }} onClick={() => navigate('/cnss')}>
            <ArrowLeft size={18} /> رجوع
          </button>
          <h2 style={{ color: 'var(--primary)', margin: 0 }}>الإعدادات</h2>
        </div>
      </div>

      {/* License */}
      <Card icon={<ShieldCheck size={20} />} title="الترخيص">
        {license && license.activated ? (
          <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.92rem' }}>
            <div>الحالة: <strong style={{ color: 'var(--primary)' }}>مُفعّل</strong></div>
            {license.customerName && <div>المرخّص له: <strong>{license.customerName}</strong></div>}
            {license.licenseKey && <div>المفتاح: <code style={{ direction: 'ltr', display: 'inline-block' }}>{license.licenseKey}</code></div>}
            <div className="muted" style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              هذا البرنامج مرتبط بهذا الجهاز. لنقله إلى جهاز آخر تواصل مع المزوّد.
            </div>
          </div>
        ) : (
          <div className="muted" style={{ color: 'var(--text-muted)' }}>جارٍ التحقق من حالة الترخيص…</div>
        )}
      </Card>

      {/* Updates */}
      <Card icon={<RefreshCw size={20} />} title="التحديثات">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.92rem' }}>
            <div>الإصدار الحالي: <strong dir="ltr">{upd.current || '—'}</strong></div>
            <div className="muted" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{updText}</div>
          </div>
          {upd.state === 'downloaded' ? (
            <button className="btn" onClick={restartUpdate}><RefreshCw size={18} /> إعادة التشغيل للتحديث</button>
          ) : (
            <button className="btn" style={{ background: 'var(--surface-2)' }} disabled={upd.state === 'checking' || upd.state === 'downloading'} onClick={checkUpdates}>
              <RefreshCw size={18} /> التحقق من التحديثات
            </button>
          )}
        </div>
      </Card>

      {/* Record sync */}
      <Card icon={<RefreshCw size={20} />} title="مزامنة السجلات">
        {syncGuard ? (
          <div style={{ border: '1px solid #f59e0b55', background: '#f59e0b12', borderRadius: 12, padding: '1rem' }}>
            <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: '0.5rem' }}>⚠︎ تم إيقاف المزامنة تلقائياً</div>
            <div className="muted" style={{ color: 'var(--text-muted)', fontSize: '0.86rem', lineHeight: 1.9, marginBottom: '0.9rem' }}>
              نسختك المحلية تحتوي على سجلات أقل بكثير من النسخة الموجودة على الخادوم
              (<strong dir="ltr">{syncGuard.newCount}</strong> مقابل <strong dir="ltr">{syncGuard.currentCount}</strong>).
              قد يعني هذا أنّ بيانات هذا الجهاز فُقدت. اختر أحد الحلّين قبل استئناف المزامنة:
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button className="btn" disabled={guardBusy} onClick={resolvePull}>
                <Download size={18} /> تنزيل نسخة الخادوم (مُوصى به)
              </button>
              <button className="btn" style={{ background: '#ef444420', color: '#ef4444' }} disabled={guardBusy} onClick={resolveForce}>
                <UploadCloud size={18} /> استبدال الخادوم بنسختي
              </button>
            </div>
            {syncMsg && <div style={{ color: 'var(--primary)', marginTop: '0.6rem', fontSize: '0.85rem' }}>{syncMsg}</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div className="muted" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.7, maxWidth: 470 }}>
              تتزامن السجلات تلقائياً مع بقية أجهزة مكتبك عند فتح البرنامج وبعد كل تعديل. اضغط للمزامنة الآن.
              {syncMsg && <div style={{ color: 'var(--primary)', marginTop: '0.4rem' }}>{syncMsg}</div>}
            </div>
            <button className="btn" disabled={syncBusy} onClick={syncNow}>
              <RefreshCw size={18} /> {syncBusy ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
            </button>
          </div>
        )}
      </Card>

      {/* Office details */}
      <Card icon={<Building2 size={20} />} title="بيانات المكتب">
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 0 }}>
          تظهر هذه البيانات في ترويسة المحاضر. اسم العدل المنفذ يظهر أيضاً في شاشة الدخول والشريط العلوي.
        </p>
        <form onSubmit={saveOffice}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {OFFICE_FIELDS.map((f) => (
              <div key={f.k} style={f.span ? { gridColumn: 'span 2' } : null}>
                <label style={label}>{f.label}</label>
                <input style={input} value={profile[f.k]} placeholder={f.ph ? `مثال: ${f.ph}` : undefined}
                  onChange={(e) => setProfile((p) => ({ ...p, [f.k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button type="button" className="btn" style={{ background: 'var(--surface-2)' }} onClick={() => setShowPreview((v) => !v)}>
                <Eye size={18} /> {showPreview ? 'إخفاء المعاينة' : 'معاينة الترويسة'}
              </button>
              <button type="button" className="btn" style={{ background: 'var(--surface-2)' }}
                onClick={() => openInWord(`${API}/template/open-sample`)}>
                <FileText size={18} /> فتح في Word
              </button>
            </div>
            <button type="submit" className="btn" disabled={busy}>
              {savedOffice ? <Check size={18} /> : <Save size={18} />} {savedOffice ? 'تم الحفظ!' : 'حفظ'}
            </button>
          </div>
        </form>
        {showPreview && <div style={{ marginTop: '1.25rem' }}><LetterheadPreview profile={profile} /></div>}
      </Card>

      {/* Password */}
      <Card icon={<KeyRound size={20} />} title="كلمة المرور">
        <form onSubmit={savePassword} style={{ display: 'grid', gap: '1rem' }}>
          <div><label style={label}>كلمة المرور الحالية</label>
            <input style={input} type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div><label style={label}>كلمة المرور الجديدة</label>
              <input style={input} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required /></div>
            <div><label style={label}>تأكيد كلمة المرور</label>
              <input style={input} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn" disabled={busy}>
              {savedPw ? <Check size={18} /> : <Save size={18} />} {savedPw ? 'تم التغيير!' : 'تغيير كلمة المرور'}
            </button>
          </div>
        </form>
      </Card>

      {/* Import the office's own Word file (look + wording) */}
      <Card icon={<Sparkles size={20} />} title="ملف Word الخاص بمكتبكم">
        <WordImport onDone={load} />
      </Card>

      {/* Template (advanced: a hand-tagged template) */}
      <Card icon={<FileText size={20} />} title="نموذج المحضر (Word) — متقدّم">
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0, lineHeight: 1.7 }}>
          النموذج الحالي: <strong style={{ color: hasCustomTemplate ? 'var(--primary)' : 'var(--text-main)' }}>
            {hasCustomTemplate ? 'نموذج مخصّص' : 'النموذج الافتراضي'}</strong>.
          نزّل النموذج كنقطة بداية، عدّل ترويسته وتصميمه مع الإبقاء على الحقول بين الأقواس
          (مثل <code>{'{nom_matloub}'}</code>، <code>{'{num_carte}'}</code>، وحلقة <code>{'{#acts}…{/acts}'}</code>)، ثم ارفعه.
        </p>
        <input type="file" ref={fileRef} style={{ display: 'none' }} accept=".docx" onChange={uploadTemplate} />
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <button className="btn" style={{ background: 'var(--surface-2)' }} disabled={busy}
            onClick={() => downloadAuth(`${API}/template/sample`, 'template_cnss_sample.docx')}>
            <Download size={18} /> تنزيل النموذج الأصلي
          </button>
          <button className="btn" style={{ background: 'var(--surface-2)' }} disabled={busy}
            onClick={() => downloadAuth(`${API}/template`, 'template_cnss.docx')}>
            <Download size={18} /> تنزيل النموذج الحالي
          </button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
            <UploadCloud size={18} /> رفع نموذج مخصّص
          </button>
          {hasCustomTemplate && (
            <button className="btn" style={{ background: '#ef444420', color: '#ef4444' }} disabled={busy} onClick={resetTemplate}>
              <RotateCcw size={18} /> العودة للافتراضي
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
