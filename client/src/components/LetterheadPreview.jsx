// A faithful-enough in-app representation of how the act's letterhead + opening
// will look with the customer's details. (Word headers don't render in
// lightweight HTML converters, so we mirror the layout ourselves.) For a pixel-
// exact look the user opens the real .docx.
const ph = (v, placeholder) => (v && v.trim() ? v : placeholder);

export default function LetterheadPreview({ profile = {} }) {
  const muted = { color: '#9aa', fontStyle: 'italic' };
  const val = (v, p) => (v && v.trim() ? <span>{v}</span> : <span style={muted}>{p}</span>);

  return (
    <div dir="rtl" style={{
      background: '#fff', color: '#111', borderRadius: 8, padding: '1.6rem 1.8rem',
      fontFamily: '"Times New Roman", serif', lineHeight: 1.9, maxHeight: '46vh', overflowY: 'auto',
      boxShadow: 'inset 0 0 0 1px #e3e3e3',
    }}>
      {/* Letterhead */}
      <div style={{ textAlign: 'center', borderBottom: '2px solid #222', paddingBottom: '0.8rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.95rem' }}>الأستاذ</div>
        <div style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0.15rem 0' }}>{val(profile.officeName, 'اسم العدل المنفذ')}</div>
        <div style={{ fontSize: '0.95rem' }}>العدل المنفذ</div>
        <div style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>{val(profile.officeAddress, 'العنوان')}</div>
        <div style={{ fontSize: '0.85rem' }}>
          الهاتف : {val(profile.officePhone, '—')} &nbsp;–&nbsp; الفاكس : {val(profile.officeFax, '—')}
        </div>
        <div style={{ fontSize: '0.85rem' }}>المعرف الجبائي : {val(profile.taxId, '—')}</div>
      </div>

      {/* Act opening */}
      <h3 style={{ textAlign: 'center', margin: '0.5rem 0 1rem' }}>محضر إعلام بطاقة جبر</h3>
      <p style={{ margin: '0 0 0.8rem' }}>
        نحن الأستاذ <b>{ph(profile.officeName, '………')}</b> العدل المنفذ بالدائرة القضائية لمحكمة الإستئناف،
        عنواني <b>{ph(profile.officeAddress, '………')}</b> والممضي أسفله، توجهنا إلى <b>مثال: شركة ما ش.م.م</b>…
      </p>

      {/* Sample card table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'center' }}>
        <thead>
          <tr>{['عدد البطاقة', 'الثلاثية', 'أصل الدين', 'الخطية', 'تاريخ احتساب الخطايا'].map((h) => (
            <th key={h} style={{ border: '1px solid #888', padding: '0.3rem' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          <tr>{['4621400216', '04/2021', '2959.306', '1.5 %', '16/01/2022'].map((c, i) => (
            <td key={i} style={{ border: '1px solid #888', padding: '0.3rem' }}>{c}</td>
          ))}</tr>
        </tbody>
      </table>
      <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>العدل المنفذ</div>
    </div>
  );
}
