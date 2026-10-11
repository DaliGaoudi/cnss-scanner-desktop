import { useState, useEffect, useCallback } from 'react';
import { KeyRound, ShieldCheck, Hourglass, RefreshCw, Phone } from 'lucide-react';
import API_BASE from '../config';

// Shown before the password login whenever this PC has no usable licence: on the
// first run, after a revocation, and when a trial has run out. `license` is the
// server's getStatus() (reason, licenseKey, providerContact).
export default function Activation({ onActivated, license = {} }) {
  const trialOver = license.reason === 'trial_expired';
  const [licenseKey, setLicenseKey] = useState(license.licenseKey || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKey.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.activated) onActivated(data);
      else setError(data.error || 'تعذّر التفعيل.');
    } catch (err) {
      setError('تعذّر الاتصال بخادم التفعيل. تأكّد من اتصال الإنترنت.');
    }
    setBusy(false);
  };

  // "I've paid": ask the server again. A converted or extended trial unlocks
  // with the same key; nothing to re-type.
  const checkAgain = useCallback(async (silent) => {
    if (!silent) setError('');
    setChecking(true);
    try {
      const res = await fetch(`${API_BASE}/license/refresh`, { method: 'POST' });
      const data = await res.json();
      if (data.activated) onActivated(data);
      else if (!silent) setError('ما زال الاشتراك غير مُفعّل. بعد الخلاص، يُفعّله المزوّد ثم اضغط «تحقّق من جديد».');
    } catch (err) {
      if (!silent) setError('تعذّر الاتصال بالخادم. تأكّد من اتصال الإنترنت.');
    }
    setChecking(false);
  }, [onActivated]);

  // The launch-time re-validation may still be in flight when this screen first
  // shows, so check once on our own before asking the customer to do anything.
  useEffect(() => { if (trialOver) checkAgain(true); }, [trialOver, checkAgain]);

  if (trialOver) {
    return (
      <div className="login-container animate-fade">
        <div className="glass login-card" dir="rtl" style={{ textAlign: 'center' }}>
          <h1 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
            <Hourglass size={26} /> انتهت الفترة التجريبية
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.8, marginTop: 0 }}>
            شكراً لتجربتك البرنامج. <b style={{ color: 'var(--text-main)' }}>كل بياناتك محفوظة</b> وستجدها كما تركتها
            بمجرّد تفعيل الاشتراك.
          </p>
          {license.providerContact && (
            <div className="glass" style={{ padding: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '1.05rem' }}>
              <Phone size={18} /> للاشتراك: <b dir="ltr">{license.providerContact}</b>
            </div>
          )}
          {error && (
            <div style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '0.5rem', borderRadius: '5px', fontSize: '0.9rem' }}>
              {error}
            </div>
          )}
          <button className="btn" onClick={() => checkAgain(false)} disabled={checking}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <RefreshCw size={16} /> {checking ? 'جارٍ التحقّق…' : 'تمّ الخلاص — تحقّق من جديد'}
          </button>
          {license.licenseKey && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              المفتاح: <span dir="ltr" style={{ fontFamily: 'monospace' }}>{license.licenseKey}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-container animate-fade">
      <div className="glass login-card" dir="rtl">
        <h1 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
          <ShieldCheck size={26} /> تفعيل التطبيق
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.7, marginTop: 0 }}>
          أدخل مفتاح الترخيص الخاص بمكتبك. يُربط البرنامج بهذا الجهاز مرة واحدة.
        </p>
        {error && (
          <div style={{ color: '#ef4444', textAlign: 'center', background: 'rgba(239,68,68,0.1)', padding: '0.5rem', borderRadius: '5px' }}>
            {error}
          </div>
        )}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><KeyRound size={15} /> مفتاح الترخيص</label>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              placeholder="CNSS-XXXX-XXXX-XXXX"
              style={{ textAlign: 'center', letterSpacing: '1px', fontFamily: 'monospace' }}
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn" disabled={busy} style={{ marginTop: '0.5rem' }}>
            {busy ? 'جاري التفعيل…' : 'تفعيل'}
          </button>
        </form>
      </div>
    </div>
  );
}
