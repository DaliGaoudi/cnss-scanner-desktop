import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { LogOut, Sun, Moon, ScanLine, Settings as SettingsIcon, Hourglass, KeyRound, Phone, Receipt, Sparkles } from 'lucide-react';
import WordImport from './components/WordImport';
import './index.css';

import API_BASE, { MOVED_EVENT } from './config';
import RegistreCNSS from './pages/RegistreCNSS';
import RegistreCNSSDetail from './pages/RegistreCNSSDetail';
import Settings from './pages/Settings';
import FacturationCNSS from './pages/FacturationCNSS';
import Activation from './pages/Activation';
import CloudMoved from './pages/CloudMoved';
import Onboarding from './pages/Onboarding';
import UpdateBanner from './components/UpdateBanner';

const GATE_RECHECK_MS = 5 * 60 * 1000;
const linkButton = { background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', fontFamily: 'inherit', padding: 0 };

// ── Auth (single shared password) ──
const AuthContext = createContext();
const useAuth = () => useContext(AuthContext);

const ThemeContext = createContext();
const useTheme = () => useContext(ThemeContext);

// Leave this PC's licence from the password screen: re-type the key to confirm.
// The server side backs the office's records up and starts the app empty.
function LeaveLicence({ onClose, onLeft }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/license/leave`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { setError(d.error || 'تعذّر الخروج من الترخيص.'); setBusy(false); return; }
      alert('تم الخروج من الترخيص.\n'
        + (d.synced ? 'بيانات المكتب محفوظة على الخادم وتعود عند إعادة التفعيل بنفس المفتاح.\n'
          : 'تعذّرت المزامنة الأخيرة: بيانات هذا الجهاز محفوظة في نسخة احتياطية محلية:\n' + d.backupDir + '\n')
        + (d.seatFreed ? '' : 'لم يُحرَّر مقعد هذا الجهاز على الخادم (لا اتصال) — يمكن للمزوّد تحريره.\n'));
      onLeft();
    } catch (err) {
      setError('تعذّر الاتصال بالخادم المحلي.');
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <form onSubmit={submit} className="glass login-card" dir="rtl" style={{ maxWidth: 440, maxHeight: "92vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <KeyRound size={22} /> الخروج من هذا الترخيص
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, marginTop: 0 }}>
          يُفصل هذا الجهاز عن مفتاح الترخيص الحالي ويعود البرنامج إلى شاشة التفعيل لإدخال مفتاح آخر.
          تُزامَن بيانات المكتب مع الخادم أولاً ثم تُنقل إلى نسخة احتياطية على هذا الجهاز، وتعود كاملة عند
          إعادة التفعيل بنفس المفتاح. تعود كلمة المرور إلى الكلمة الافتراضية.
        </p>
        <label>للتأكيد، أدخل مفتاح الترخيص المفعّل على هذا الجهاز</label>
        <input type="text" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="CNSS-XXXX-XXXX-XXXX"
          style={{ textAlign: 'center', letterSpacing: '1px', fontFamily: 'monospace' }} autoFocus required />
        {error && (
          <div style={{ color: '#ef4444', textAlign: 'center', background: 'rgba(239,68,68,0.1)', padding: '0.5rem', borderRadius: '5px', marginTop: '0.75rem' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button type="submit" className="btn" disabled={busy || !key.trim()} style={{ flex: 1, background: '#ef4444' }}>
            {busy ? 'جارٍ الخروج…' : 'الخروج من الترخيص'}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy} style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text-main)' }}>
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}

// Forgotten office password: ask the provider; once they approve in their admin
// page this PC may set a new password, once. Checks the server while waiting.
const RESET_POLL_MS = 10000;
function ForgotPassword({ onClose }) {
  const [state, setState] = useState('checking'); // checking | none | pending | approved | done
  const [contact, setContact] = useState('');
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (d) => { if (d.providerContact) setContact(d.providerContact); if (d.state) setState(d.state); };
  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/license/password-reset/status`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) { apply(d); setError(''); } else setError(d.error || 'تعذّر التحقّق.');
    } catch (e) { setError('تعذّر الاتصال.'); }
  }, []);
  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    if (state !== 'pending') return undefined;
    const t = setInterval(check, RESET_POLL_MS);
    return () => clearInterval(t);
  }, [state, check]);

  const request = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/license/password-reset/request`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) apply(d); else setError(d.error || 'تعذّر إرسال الطلب.');
    } catch (e) { setError('تعذّر الاتصال.'); }
    setBusy(false);
  };

  const complete = async (e) => {
    e.preventDefault();
    if (pw !== pw2) { setError('كلمتا المرور غير متطابقتين.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/license/password-reset/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) setState('done');
      else { setError(d.error || 'تعذّر الحفظ.'); if (res.status === 409) setState('none'); }
    } catch (err) { setError('تعذّر الاتصال.'); }
    setBusy(false);
  };

  const text = { color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8, marginTop: 0 };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass login-card" dir="rtl" style={{ maxWidth: 440, maxHeight: "92vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <KeyRound size={22} /> نسيت كلمة المرور
        </h2>
        {state === 'checking' && <p style={text}>جارٍ التحقّق…</p>}
        {state === 'none' && (<>
          <p style={text}>
            لإعادة تعيين كلمة المرور، أرسل طلباً إلى المزوّد ثم اتصل به ليتأكّد من هويتك ويوافق عليه.
            بعد الموافقة يظهر هنا نموذج لكتابة كلمة مرور جديدة. لا تُحذف أي بيانات.
          </p>
          <button className="btn" onClick={request} disabled={busy} style={{ width: '100%' }}>
            {busy ? 'جارٍ الإرسال…' : 'إرسال طلب إعادة التعيين'}
          </button>
        </>)}
        {state === 'pending' && (<>
          <p style={text}>
            تمّ إرسال الطلب. اتصل بالمزوّد ليوافق عليه — تتحدّث هذه الشاشة تلقائياً بعد الموافقة.
          </p>
          {contact && (
            <div className="glass" style={{ padding: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '1.05rem', marginBottom: '1rem' }}>
              <Phone size={18} /> <b dir="ltr">{contact}</b>
            </div>
          )}
          <button className="btn" onClick={check} style={{ width: '100%' }}>تحقّق الآن</button>
        </>)}
        {state === 'approved' && (
          <form onSubmit={complete} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={text}>وافق المزوّد على طلبك. اكتب كلمة المرور الجديدة (تُستعمل هذه الموافقة مرة واحدة).</p>
            <div><label>كلمة المرور الجديدة</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></div>
            <div><label>تأكيد كلمة المرور</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div>
            <button type="submit" className="btn" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button>
          </form>
        )}
        {state === 'done' && <p style={{ ...text, color: 'var(--text-main)' }}>✓ تم تغيير كلمة المرور. يمكنك الدخول بها الآن.</p>}
        {error && (
          <div style={{ color: '#ef4444', textAlign: 'center', background: 'rgba(239,68,68,0.1)', padding: '0.5rem', borderRadius: '5px', marginTop: '0.75rem' }}>
            {error}
          </div>
        )}
        <button type="button" className="btn" onClick={onClose} style={{ width: '100%', marginTop: '0.75rem', background: 'var(--surface-2)', color: 'var(--text-main)' }}>
          {state === 'done' ? 'العودة إلى الدخول' : 'إغلاق'}
        </button>
      </div>
    </div>
  );
}

function Login({ onLeft }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [officeName, setOfficeName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState(null);   // shown only while unchanged
  const { login } = useAuth();

  useEffect(() => {
    fetch(`${API_BASE}/settings/public`)
      .then((r) => r.json()).then((j) => { setOfficeName(j.officeName || ''); setDefaultPassword(j.defaultPassword || null); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) login(data.user, data.token);
      else setError(data.error || 'كلمة المرور غير صحيحة');
    } catch (err) {
      setError('تعذّر الاتصال بالخادم');
    }
  };

  return (
    <div className="login-container animate-fade">
      <div className="glass login-card" dir="rtl">
        <h1 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', textAlign: 'center' }}>
          <ScanLine size={26} /> {officeName || 'ماسح بطاقات الجبر'}
        </h1>
        {error && (
          <div style={{ color: '#ef4444', textAlign: 'center', background: 'rgba(239,68,68,0.1)', padding: '0.5rem', borderRadius: '5px' }}>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label>كلمة المرور</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </div>
          {defaultPassword && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7 }}>
              كلمة المرور الافتراضية: <b dir="ltr" style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{defaultPassword}</b>
              <br />غيّرها بعد الدخول من «الإعدادات».
            </div>
          )}
          <button type="submit" className="btn" style={{ marginTop: '1rem' }}>دخول</button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', gap: '1rem' }}>
          <button type="button" onClick={() => setForgot(true)} style={linkButton}>نسيت كلمة المرور؟</button>
          <button type="button" onClick={() => setLeaving(true)} style={linkButton}
            title="فصل هذا الجهاز عن مفتاح الترخيص الحالي لإدخال مفتاح آخر">
            الخروج من هذا الترخيص
          </button>
        </div>
      </div>
      {forgot && <ForgotPassword onClose={() => setForgot(false)} />}
      {leaving && <LeaveLicence onClose={() => setLeaving(false)} onLeft={onLeft} />}
    </div>
  );
}

function TopBar() {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [officeName, setOfficeName] = useState('');

  const loadOffice = () => {
    fetch(`${API_BASE}/settings`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => r.json()).then((j) => setOfficeName(j.officeName || ''))
      .catch(() => {});
  };
  useEffect(() => {
    loadOffice();
    window.addEventListener('cnss-settings-changed', loadOffice);
    return () => window.removeEventListener('cnss-settings-changed', loadOffice);
  }, []);

  return (
    <div className="topbar" style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--card-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--primary)', cursor: 'pointer' }} onClick={() => navigate('/cnss')}>
        <ScanLine size={22} />
        <h1 style={{ margin: 0, fontSize: '1.15rem' }}>{officeName || 'ماسح بطاقات الجبر — CNSS'}</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button className="btn" onClick={() => navigate('/facturation')} title="فوترة الضمان الاجتماعي — المحاضر المُبلَّغة حسب الشهر"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-main)' }}>
          <Receipt size={18} /> الفوترة
        </button>
        <button className="btn-icon" onClick={() => navigate('/settings')} title="الإعدادات">
          <SettingsIcon size={18} />
        </button>
        <button className="btn-icon" onClick={toggleTheme} title="تبديل المظهر">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="btn" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }} onClick={logout}>
          <LogOut size={18} /> خروج
        </button>
      </div>
    </div>
  );
}

// Arabic counted nouns: 1 → singular, 2 → dual, 3–10 → plural, 11+ → singular accusative.
const countAr = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const DAYS = ['يوم واحد', 'يومان', 'أيام', 'يوماً'];
const HOURS = ['ساعة واحدة', 'ساعتان', 'ساعات', 'ساعة'];

// "Trial: 2 days 5 hours left" — so the customer is never surprised by the lock.
function trialTimeLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!(ms > 0)) return 'تنتهي الآن';
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24), rh = h % 24;
  if (d === 0) return h > 0 ? countAr(h, HOURS) : 'أقل من ساعة';
  return rh ? `${countAr(d, DAYS)} و${countAr(rh, HOURS)}` : countAr(d, DAYS);
}

function TrialBanner({ license }) {
  if (!license || license.kind !== 'trial' || !license.expiresAt) return null;
  return (
    <div dir="rtl" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap',
      padding: '0.5rem 1rem', fontSize: '0.9rem',
      background: 'rgba(167,139,250,0.12)', borderBottom: '1px solid rgba(167,139,250,0.35)',
    }}>
      <Hourglass size={16} />
      <span>نسخة تجريبية — يتبقى <b>{trialTimeLeft(license.expiresAt)}</b>.</span>
      {license.providerContact && <span>للاشتراك: <b dir="ltr">{license.providerContact}</b></span>}
    </div>
  );
}

// Once, after the first login: offer to import the office's own Word file so its
// acts keep their usual look. «لاحقاً» (or importing) means we don't ask again.
function WordImportPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/word-import/status`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s && !s.offered && !s.active && !s.hasCustomAct) setShow(true); })
      .catch(() => {});
  }, []);
  if (!show) return null;
  const close = () => {
    fetch(`${API_BASE}/word-import/offered`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }).catch(() => {});
    setShow(false);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass" dir="rtl" style={{ width: 640, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '1.75rem', borderRadius: '16px' }}>
        <h2 style={{ marginTop: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Sparkles size={22} /> محاضركم بشكلها المعتاد
        </h2>
        <WordImport onDone={() => setShow(false)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>يمكنكم القيام بذلك لاحقاً من «الإعدادات».</span>
          <button className="btn" style={{ background: 'var(--surface-2)', color: 'var(--text-main)' }} onClick={close}>لاحقاً</button>
        </div>
      </div>
    </div>
  );
}

function AppShell({ license }) {
  const navigate = useNavigate();
  // If the user chose "تعديل النموذج الآن" during onboarding, land on Settings.
  useEffect(() => {
    if (localStorage.getItem('openSettingsTemplate')) {
      localStorage.removeItem('openSettingsTemplate');
      navigate('/settings');
    }
  }, [navigate]);

  return (
    <div className="layout-container animate-fade">
      <div className="main-content" style={{ marginInline: 'auto', maxWidth: 1280, width: '100%' }}>
        <TrialBanner license={license} />
        <WordImportPrompt />
        <TopBar />
        <div style={{ padding: '1.5rem' }}>
          <Routes>
            <Route path="/cnss" element={<RegistreCNSS />} />
            <Route path="/cnss/new" element={<RegistreCNSSDetail />} />
            <Route path="/cnss/:id" element={<RegistreCNSSDetail />} />
            <Route path="/facturation" element={<FacturationCNSS />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/cnss" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user')) || null);
  const [, setToken] = useState(() => localStorage.getItem('token') || null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [gate, setGate] = useState(undefined); // undefined = loading; {activated, onboardingDone}

  const loadGate = useCallback(() => {
    fetch(`${API_BASE}/onboarding/status`)
      // Moved to the cloud: the local API answers 423 here too, but the licence
      // status stays open and says where the office went.
      .then((r) => (r.status === 423
        ? fetch(`${API_BASE}/license/status`).then((l) => l.json()).then((license) => ({ activated: false, onboardingDone: true, license }))
        : r.json()))
      .then(setGate)
      // Only the very first load falls back to "not activated"; a failed
      // periodic re-check keeps whatever we last knew.
      .catch(() => setGate((prev) => prev || { activated: false, onboardingDone: false }));
  }, []);
  useEffect(() => { loadGate(); }, [loadGate]);

  // Any API call answered 423 (the office moved while a window was open): re-read the gate now.
  useEffect(() => {
    window.addEventListener(MOVED_EVENT, loadGate);
    return () => window.removeEventListener(MOVED_EVENT, loadGate);
  }, [loadGate]);

  // Re-read the licence every few minutes: a trial that runs out while the app
  // is open locks on time, and the banner's countdown stays current. Cheap —
  // the check is a local, offline token verification.
  useEffect(() => {
    const t = setInterval(loadGate, GATE_RECHECK_MS);
    return () => clearInterval(t);
  }, [loadGate]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((p) => (p === 'dark' ? 'light' : 'dark'));

  const login = (userData, userToken) => {
    setUser(userData);
    setToken(userToken);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', userToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <ThemeContext.Provider value={{ theme, toggleTheme }}>
        <BrowserRouter>
          {gate === undefined ? (
            <div className="login-container">
              <div className="glass login-card" dir="rtl" style={{ textAlign: 'center', opacity: 0.7 }}>جاري التحميل…</div>
            </div>
          ) : gate.license && gate.license.reason === 'moved_to_cloud' ? (
            <CloudMoved license={gate.license} onUnlocked={loadGate} />
          ) : !gate.activated ? (
            <Activation onActivated={loadGate} license={gate.license} />
          ) : !gate.onboardingDone ? (
            <Onboarding onComplete={loadGate} />
          ) : !user ? (
            <Routes>
              <Route path="*" element={<Login onLeft={() => { logout(); loadGate(); }} />} />
            </Routes>
          ) : (
            <AppShell license={gate.license} />
          )}
          <UpdateBanner />
        </BrowserRouter>
      </ThemeContext.Provider>
    </AuthContext.Provider>
  );
}
