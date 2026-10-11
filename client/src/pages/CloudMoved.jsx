import { useEffect } from 'react';
import { Cloud, ExternalLink, Phone } from 'lucide-react';
import API_BASE from '../config';

// Shown instead of the whole app once the provider has moved this office to the
// web app. The desktop keeps a copy of the data, but nothing here can be edited:
// the local API answers 423 (see server/index.js). `license` is the server's
// getStatus() with reason 'moved_to_cloud' (movedToCloud.url, providerContact).
export default function CloudMoved({ license = {}, onUnlocked }) {
  // Only ever open an https link (the server also refuses to store anything else).
  const rawUrl = license.movedToCloud && license.movedToCloud.url;
  const url = /^https:\/\//i.test(rawUrl || '') ? rawUrl : '';

  // The provider may have undone the move: ask once on our own so the app
  // unlocks without a restart. Silent, no control on screen.
  useEffect(() => {
    if (!onUnlocked) return;
    fetch(`${API_BASE}/license/refresh`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { if (d && d.activated) onUnlocked(d); })
      .catch(() => { /* offline: stay on the cloud screen */ });
  }, [onUnlocked]);

  return (
    <div className="login-container animate-fade">
      <div className="glass login-card" dir="rtl" style={{ textAlign: 'center' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
          <Cloud size={26} /> مكتبكم يعمل الآن على السحابة
        </h1>
        {url && (
          <button className="btn" onClick={() => window.open(url, '_blank')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <ExternalLink size={16} /> فتح التطبيق على السحابة
          </button>
        )}
        {license.providerContact && (
          <div className="glass" style={{ padding: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '1.05rem' }}>
            <Phone size={18} /> <b dir="ltr">{license.providerContact}</b>
          </div>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, margin: 0 }}>
          نسخة من بياناتكم محفوظة على هذا الجهاز.
        </p>
      </div>
    </div>
  );
}
