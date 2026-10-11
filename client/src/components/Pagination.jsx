import { ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft } from 'lucide-react';

/**
 * Reusable server-side pagination bar.
 * Props: page, totalPages, total, limit, onPageChange, onLimitChange
 */
export default function Pagination({ page, totalPages, total, limit, onPageChange, onLimitChange }) {
  if (totalPages <= 0) return null;

  const PAGE_SIZES = [25, 50, 100, 200];

  // Build visible page range (max 7 buttons)
  const getPages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set([1, totalPages, page]);
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pages.add(i);
    return [...pages].sort((a, b) => a - b);
  };

  const pages = getPages();

  const btnBase = {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    color: 'var(--text-main)',
    borderRadius: '6px',
    padding: '0.35rem 0.65rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    minWidth: 36,
    transition: 'all 0.15s',
  };

  const btnActive = {
    ...btnBase,
    background: 'var(--primary)',
    color: '#fff',
    border: '1px solid var(--primary)',
    fontWeight: 700,
  };

  const btnDisabled = { ...btnBase, opacity: 0.35, cursor: 'not-allowed' };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '0.75rem',
      padding: '0.75rem 1rem',
      borderTop: '1px solid var(--card-border)',
      direction: 'rtl',
    }}>
      {/* Right: total count + page size chooser (flipped in RTL) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        <span>
          إجمالي: <strong style={{ color: 'var(--text-main)' }}>{total.toLocaleString()}</strong> سجل
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          عرض:
          <select
            value={limit}
            onChange={e => { onLimitChange(Number(e.target.value)); onPageChange(1); }}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              color: 'var(--text-main)',
              borderRadius: '6px',
              padding: '0.25rem 0.5rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* Left: page buttons (flipped in RTL) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        {/* First */}
        <button
          style={page === 1 ? btnDisabled : btnBase}
          disabled={page === 1}
          onClick={() => onPageChange(1)}
          title="الصفحة الأولى"
        ><ChevronsRight size={15} /></button>

        {/* Prev */}
        <button
          style={page === 1 ? btnDisabled : btnBase}
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          title="السابق"
        ><ChevronRight size={15} /></button>

        {/* Page numbers */}
        {pages.map((p, idx) => {
          const prev = pages[idx - 1];
          const showEllipsis = prev && p - prev > 1;
          return (
            <span key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {showEllipsis && <span style={{ color: 'var(--text-muted)', padding: '0 0.2rem' }}>…</span>}
              <button
                style={p === page ? btnActive : btnBase}
                onClick={() => onPageChange(p)}
              >{p}</button>
            </span>
          );
        })}

        {/* Next */}
        <button
          style={page === totalPages ? btnDisabled : btnBase}
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          title="التالي"
        ><ChevronLeft size={15} /></button>

        {/* Last */}
        <button
          style={page === totalPages ? btnDisabled : btnBase}
          disabled={page === totalPages}
          onClick={() => onPageChange(totalPages)}
          title="الصفحة الأخيرة"
        ><ChevronsLeft size={15} /></button>
      </div>
    </div>
  );
}
