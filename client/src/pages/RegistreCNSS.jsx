import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plus, Edit, Printer, Trash2, UploadCloud, ScanLine, FileText, CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Pagination from '../components/Pagination';
import AutocompleteInput from '../components/AutocompleteInput';
import { CNSS_STATUS_MAP, CNSS_AWAITING_PRINT } from '../utils/formatters';
import { scanCardFromBridge, createRecordFromCard, fileToPageBlobs, processPages, summarizeRun, SCANNER_OFFLINE_MSG } from '../utils/cnssScan';

import API_BASE from '../config';

const API = `${API_BASE}/cnss`;

// CNSS amounts (dette) are decimal dinars stored as strings ("2959.306"), NOT
// the integer millimes the general registers use — so format directly.
const fmtDinar = (v) => {
  const n = parseFloat(v);
  if (isNaN(n)) return '0,000';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: true }).format(n);
};

export default function RegistreCNSS() {
  const navigate = useNavigate();

  const [data, setData]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [page, setPage]             = useState(1);
  const [limit, setLimit]           = useState(25);
  const [total, setTotal]           = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters]       = useState({ nom_cl2: '', numcnss: '', ref: '' });
  const [activeFilters, setActiveFilters] = useState({});

  const [processing, setProcessing] = useState(null); // message while extracting/creating
  const fileInputRef = useRef(null);

  // Monthly billing list (قائمة CNSS) — pick a month, generate the Word doc.
  const now = new Date();
  const [showListModal, setShowListModal] = useState(false);
  const [listMonth, setListMonth] = useState(now.getMonth() + 1);
  const [listYear, setListYear] = useState(now.getFullYear());
  const TUNISIAN_MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  const fetchRecords = useCallback(async (pg = page, lim = limit, flt = activeFilters) => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({ page: pg, limit: lim, ...flt, _t: Date.now() }).toString();
    try {
      const res  = await fetch(`${API}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setData(json.data || []);
      setTotal(json.total || 0);
      setTotalPages(json.totalPages || 1);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [page, limit, activeFilters]);

  useEffect(() => { fetchRecords(page, limit, activeFilters); }, [page, limit, activeFilters]);

  const handleSearch = (e) => { e.preventDefault(); setPage(1); setActiveFilters({ ...filters }); };
  const handlePageChange  = (pg)  => setPage(pg);
  const handleLimitChange = (lim) => { setLimit(lim); setPage(1); };

  const handleStatusChange = async (id, newStatus) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API}/${id}/status`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setData(prev => prev.map(item => item.id_cn === id ? { ...item, status: newStatus } : item));
      } else {
        const err = await res.json();
        alert('حدث خطأ: ' + (err.error || 'فشل التحديث'));
      }
    } catch (e) {
      console.error(e);
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الملف وكل بطاقات الجبر المرتبطة به؟')) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setData(prev => prev.filter(item => item.id_cn !== id));
        fetchRecords();
      } else {
        const err = await res.json();
        alert('حدث خطأ: ' + (err.error || 'فشل الحذف'));
      }
    } catch (e) {
      console.error(e);
      alert('خطأ في الاتصال بالخادم');
    }
  };

  // Send a card image/PDF to the server, which extracts it and auto-creates the
  // record, then jump to the new record for review + act generation. A duplicate
  // the user cancelled files nothing, but still opens the record already holding it.
  const submitCardFile = async (fileOrBlob, filename) => {
    setProcessing('جاري قراءة البطاقة وإنشاء الملف…');
    try {
      const { id_cn } = await createRecordFromCard(fileOrBlob, filename);
      navigate(`/cnss/${id_cn}`);
    } catch (e) {
      console.error(e);
      alert('تعذّر إنشاء الملف: ' + e.message);
    } finally {
      setProcessing(null);
    }
  };

  // Upload a file: a multi-page PDF is split into one image per page (one بطاقة
  // per page); a single image is one card. Each page goes through /scan.
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const blobs = await fileToPageBlobs(file, setProcessing);
      const r = await processPages(blobs, setProcessing);
      setProcessing(null);
      const msg = summarizeRun(r, blobs.length);
      if (!msg) {
        navigate(`/cnss/${r.firstId}`); // single card → open the record directly
      } else {
        alert(msg);
        // One record touched (created or already holding a skipped duplicate) → open it.
        if (r.companyIds.length <= 1 && r.firstId) navigate(`/cnss/${r.firstId}`);
        else if (r.created > 0) fetchRecords();
      }
    } catch (err) {
      setProcessing(null);
      alert('خطأ في معالجة الملف: ' + (err.message || err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleScan = async () => {
    setProcessing('جاري المسح الضوئي…');
    try {
      await submitCardFile(await scanCardFromBridge(), 'scan.jpg');
    } catch (err) {
      console.error('Scan error:', err);
      const offline = err instanceof TypeError; // bridge unreachable
      setProcessing(null);
      alert(offline ? SCANNER_OFFLINE_MSG : ('خطأ في المسح الضوئي: ' + err.message));
    }
  };

  // Generate the «محاضر إعلام بطاقة جبر» for a company straight from the table —
  // every محضر in one Word file (one per page); a card not yet in a محضر gets its own.
  const generateActs = async (item) => {
    if (!Number(item.card_count)) { alert('لا توجد بطاقات جبر لهذا المطلوب لتوليد محضرها.'); return; }
    setProcessing('جاري توليد المحضر…');
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API}/${item.id_cn}/acts/open`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { alert('فشل توليد المحضر: ' + (d.error || res.status)); return; }
      if (!d.opened && d.path) alert('تم إنشاء الملف:\n' + d.path);
    } catch (e) {
      console.error(e);
      alert('خطأ في الاتصال بالخادم');
    } finally {
      setProcessing(null);
    }
  };

  // Generate the monthly «قائمة مصاريف محاضر تبليغ بطاقات جبر» for the chosen
  // month and open it natively in Word.
  const generateMonthlyList = async () => {
    setShowListModal(false);
    setProcessing('جاري توليد القائمة الشهرية…');
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API}/list/open`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: listYear, month: listMonth }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { alert('تعذّر توليد القائمة: ' + (d.error || res.status)); return; }
      if (!d.opened && d.path) alert('تم إنشاء الملف:\n' + d.path);
    } catch (e) {
      console.error(e);
      alert('خطأ في الاتصال بالخادم');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="animate-fade">
      {/* ── Processing overlay (extraction + auto-create) ── */}
      {processing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass" style={{ padding: '2rem 3rem', textAlign: 'center', direction: 'rtl' }}>
            <div style={{ width: 36, height: 36, margin: '0 auto 1rem', border: '3px solid var(--card-border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'cnss-spin 0.8s linear infinite' }} />
            <div style={{ fontSize: '1rem', color: 'var(--primary)' }}>{processing}</div>
          </div>
          <style dangerouslySetInnerHTML={{ __html: '@keyframes cnss-spin { to { transform: rotate(360deg); } }' }} />
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="topbar" style={{ marginBottom: '1rem' }}>
        <h2 style={{ color: 'var(--primary)' }}>ملفات الضمان الاجتماعي (CNSS)</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,application/pdf" onChange={handleUpload} />
          <button className="btn" disabled={!!processing} style={{ background: 'var(--primary)' }} onClick={handleScan}>
            <ScanLine size={18} /> مسح بطاقة جبر
          </button>
          <button className="btn" disabled={!!processing} title="ملف PDF متعدد الصفحات (بطاقة جبر في كل صفحة) أو صورة واحدة"
            onClick={() => fileInputRef.current && fileInputRef.current.click()}>
            <UploadCloud size={18} /> رفع بطاقات جبر
          </button>
          <button className="btn" style={{ background: 'var(--surface-2)' }} onClick={() => navigate('/cnss/new')}>
            <Plus size={18} /> إضافة يدوية
          </button>
          <button className="btn" disabled={!!processing} style={{ background: 'var(--surface-2)' }} onClick={() => setShowListModal(true)}>
            <CalendarDays size={18} /> القائمة الشهرية
          </button>
          <button className="btn" style={{ background: 'var(--surface-2)' }} onClick={() => window.print()}><Printer size={18} /> طباعة</button>
        </div>
      </div>

      {/* ── Monthly list month/year picker ── */}
      {showListModal && (
        <div className="modal-overlay no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowListModal(false)}>
          <div className="glass card animate-scale" style={{ width: 420, maxWidth: '100%', padding: '2rem', borderRadius: '16px' }} dir="rtl" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--primary)', marginTop: 0, marginBottom: '0.5rem', textAlign: 'center' }}>قائمة مصاريف محاضر تبليغ بطاقات جبر</h3>
            <p style={{ fontSize: '0.85rem', opacity: 0.7, textAlign: 'center', marginTop: 0 }}>تُجمع المحاضر حسب تاريخ التبليغ في الشهر المختار.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', opacity: 0.8 }}>الشهر</label>
                <select value={listMonth} onChange={(e) => setListMonth(parseInt(e.target.value, 10))} style={{ width: '100%', padding: '0.6rem' }}>
                  {TUNISIAN_MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', opacity: 0.8 }}>السنة</label>
                <input type="number" value={listYear} min="2000" max="2100"
                  onChange={(e) => setListYear(parseInt(e.target.value, 10) || now.getFullYear())}
                  style={{ width: '100%', padding: '0.6rem' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button className="btn" style={{ flex: 1 }} onClick={generateMonthlyList}><FileText size={18} /> توليد (Word)</button>
              <button className="btn" style={{ flex: 1, background: 'var(--surface-2)' }} onClick={() => setShowListModal(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <form onSubmit={handleSearch} className="search-wrapper glass" style={{ padding: '1rem', flexWrap: 'wrap', direction: 'rtl', marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <AutocompleteInput placeholder="اسم المطلوب" value={filters.nom_cl2} onChange={e => setFilters({ ...filters, nom_cl2: e.target.value })} />
        </div>
        <input type="text" placeholder="عدد الإنخراط بالصندوق" value={filters.numcnss} onChange={e => setFilters({ ...filters, numcnss: e.target.value })} />
        <input type="text" placeholder="العدد الترتيبي" value={filters.ref} onChange={e => setFilters({ ...filters, ref: e.target.value })} />
        <button type="submit" className="btn"><Search size={18} /> بحث</button>
        <button type="button" className="btn" style={{ background: 'var(--surface-2)' }}
          onClick={() => { setFilters({ nom_cl2: '', numcnss: '', ref: '' }); setActiveFilters({}); setPage(1); }}>
          مسح
        </button>
      </form>

      {/* ── Table ── */}
      <div className="glass table-container print-area" style={{ direction: 'rtl' }}>
        {loading ? (
          <p style={{ padding: '2rem', textAlign: 'center', opacity: 0.6 }}>جاري التحميل…</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>العدد الترتيبي</th>
                  <th>اسم المطلوب</th>
                  <th className="hide-on-mobile">عدد الإنخراط</th>
                  <th className="hide-on-mobile">عدد البطاقات</th>
                  <th className="hide-on-mobile">إجمالي الدين (د.ت)</th>
                  <th className="hide-on-mobile">الحالة</th>
                  <th className="no-print">عمل</th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', opacity: 0.5 }}>لا توجد نتائج</td></tr>
                ) : data.map(item => (
                  <tr key={item.id_cn} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cnss/${item.id_cn}`)}>
                    <td>{item.ref}</td>
                    <td>{item.nom_cl2}</td>
                    <td className="hide-on-mobile">{item.numcnss}{item.codeng ? ` (${item.codeng})` : ''}</td>
                    <td className="hide-on-mobile">{item.card_count}</td>
                    <td className="hide-on-mobile" style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtDinar(item.total_dette)}</td>
                    <td className="hide-on-mobile" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const s = CNSS_STATUS_MAP[item.status] || CNSS_STATUS_MAP.cancelled;
                        return (
                          <div className={`badge badge-${s.color}`} style={{ padding: 0, overflow: 'hidden' }}>
                            <select
                                value={item.status || CNSS_AWAITING_PRINT}
                                onChange={(e) => handleStatusChange(item.id_cn, e.target.value)}
                                style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 'inherit', cursor: 'pointer', outline: 'none', padding: '0.4rem 0.8rem', width: '100%', fontFamily: 'inherit', appearance: 'none', textAlign: 'center' }}
                            >
                                {Object.entries(CNSS_STATUS_MAP).map(([key, info]) => (
                                    <option key={key} value={key} style={{ color: '#000' }}>{info.label}</option>
                                ))}
                            </select>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="no-print" style={{ display: 'flex', gap: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => generateActs(item)}
                        title={Number(item.card_count) ? 'توليد المحضر (Word)' : 'لا توجد بطاقات جبر'}
                        disabled={!Number(item.card_count) || !!processing}
                        style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: Number(item.card_count) ? 'pointer' : 'not-allowed', opacity: Number(item.card_count) ? 1 : 0.35 }}>
                        <FileText size={18} />
                      </button>
                      <button onClick={() => navigate(`/cnss/${item.id_cn}`)}
                        title="تعديل"
                        style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                        <Edit size={18} />
                      </button>
                      <button onClick={() => handleDelete(item.id_cn)}
                        title="حذف"
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination
              page={page} totalPages={totalPages} total={total} limit={limit}
              onPageChange={handlePageChange} onLimitChange={handleLimitChange}
            />
          </>
        )}
      </div>
    </div>
  );
}
