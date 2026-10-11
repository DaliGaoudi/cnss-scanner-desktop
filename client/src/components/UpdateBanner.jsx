import { useState, useEffect } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import API_BASE from '../config';

// Discreet bottom pill: shows download progress and, when ready, a restart button.
// Polls the local /api/update/status the Electron main process keeps updated.
export default function UpdateBanner() {
  const [st, setSt] = useState({ state: 'idle' });

  useEffect(() => {
    let alive = true;
    const tick = () => fetch(`${API_BASE}/update/status`)
      .then((r) => r.json()).then((s) => { if (alive) setSt(s); }).catch(() => {});
    tick();
    const id = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (st.state !== 'downloading' && st.state !== 'downloaded') return null;

  const restart = () => fetch(`${API_BASE}/update/install`, { method: 'POST' }).catch(() => {});

  return (
    <div style={{ position: 'fixed', bottom: 18, insetInline: 0, display: 'flex', justifyContent: 'center', zIndex: 4000, pointerEvents: 'none' }}>
      <div className="glass" dir="rtl" style={{
        pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '0.9rem',
        padding: '0.6rem 1.2rem', borderRadius: 999, border: '1px solid var(--primary)',
      }}>
        {st.state === 'downloading' ? (
          <>
            <Download size={17} style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: '0.9rem' }}>يتم تنزيل التحديث… <strong>{st.percent || 0}%</strong></span>
          </>
        ) : (
          <>
            <span style={{ fontSize: '0.9rem' }}>تحديث جديد جاهز{st.version ? ` (${st.version})` : ''}</span>
            <button className="btn" style={{ padding: '0.35rem 0.9rem' }} onClick={restart}>
              <RefreshCw size={16} /> إعادة التشغيل الآن
            </button>
          </>
        )}
      </div>
    </div>
  );
}
