import API_BASE from '../config';

const API = `${API_BASE}/cnss`;

// The local Scan Bridge on the office PC drives the scanner (see scan-watcher/).
export const BRIDGE_URL = localStorage.getItem('scanBridgeUrl') || 'http://127.0.0.1:17171';

// Scanned pages are large near-lossless JPEGs; downscale before the 10MB upload.
const SCAN_MAX_EDGE = 2000, SCAN_JPEG_QUALITY = 0.72;
export function compressImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, SCAN_MAX_EDGE / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('فشل ضغط الصورة')), 'image/jpeg', SCAN_JPEG_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذّرت معالجة الصورة')); };
    img.src = url;
  });
}

// Drive the local scanner bridge and return a compressed JPEG blob of the page.
// A network failure (bridge not running) surfaces as a TypeError from fetch —
// callers use that to tell "scanner offline" from "scan failed".
export async function scanCardFromBridge() {
  const scanUrl = `${BRIDGE_URL}/scan` + (localStorage.getItem('scanMock') === '1' ? '?mock=1' : '');
  const scanRes = await fetch(scanUrl, { method: 'POST' });
  if (!scanRes.ok) { const info = await scanRes.json().catch(() => ({})); throw new Error(info.error || 'تعذّر المسح الضوئي'); }
  return compressImage(await scanRes.blob());
}

// Shown when the bridge can't be reached at all. The desktop app starts the bridge
// itself, so the usual cause is the scanner: unplugged, off, or no Windows driver.
export const SCANNER_OFFLINE_MSG =
  'تعذّر الوصول إلى الماسح الضوئي.\nتأكّد من توصيل الجهاز وتشغيله، ومن تثبيت برنامج تشغيله (Driver) على ويندوز — يجب أن يعمل في تطبيق «الفاكس والمسح الضوئي في Windows». ثم أعد تشغيل البرنامج.';

// A file the user picked → one image blob per بطاقة. A multi-page PDF is split
// into one image per page (one بطاقة per page); an image is a single card.
export async function fileToPageBlobs(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return [await compressImage(file)];
  if (onProgress) onProgress('جاري تقسيم الملف إلى صفحات…');
  const { pdfToJpegBlobs } = await import('./pdf'); // load pdf.js on demand
  const blobs = await pdfToJpegBlobs(file);
  if (!blobs.length) throw new Error('لا توجد صفحات في الملف.');
  return blobs;
}

// ── Duplicate بطاقة جبر (same عدد البطاقة already filed under the same مطلوب) ──
// The server refuses to file a second row and answers 409 with the card it found;
// the user decides whether to keep the new one anyway or cancel.
export function duplicateMessage(info, pageLabel) {
  const e = info.existing || {};
  const c = info.company || {};
  return (pageLabel ? `${pageLabel}: ` : '') + 'هذه البطاقة مُسجّلة من قبل في هذا الملف:\n\n'
    + `عدد البطاقة: ${e.numcarte || '—'}\n`
    + `الثلاثية: ${e.semestre || '—'}\n`
    + `أصل الدين: ${e.dette || '—'} د.ت\n`
    + (c.nom_cl2 ? `المطلوب: ${c.nom_cl2}\n` : '')
    + '\nاضغط «موافق» لإضافتها مرة أخرى، أو «إلغاء» لتجاهلها.';
}

const askKeepDuplicate = (info, pageLabel) => window.confirm(duplicateMessage(info, pageLabel));

// POST a card row onto a company. `force: 1` bypasses the duplicate guard.
export async function addCard(id_cn, card) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API}/${id_cn}/cards`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.status);
  return json;
}

// POST one بطاقة image/PDF to /cnss/scan, which extracts it and auto-creates the
// record. Returns { id_cn, skipped } — `skipped` is true when the page turned out
// to be a duplicate the user chose not to keep, in which case id_cn still points
// at the record that already holds it. Throws on failure.
export async function createRecordFromCard(fileOrBlob, filename, confirmDuplicate = askKeepDuplicate, pageLabel) {
  const token = localStorage.getItem('token');
  const fd = new FormData();
  fd.append('file', fileOrBlob, filename || 'card.jpg');
  const res = await fetch(`${API}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.success) return { id_cn: json.id_cn, skipped: false };
  if (res.status === 409 && json.duplicate) {
    // Re-file the card the server already extracted — no second AI extraction.
    if (!confirmDuplicate(json, pageLabel)) return { id_cn: json.id_cn, skipped: true };
    await addCard(json.id_cn, { ...json.card, force: 1 });
    return { id_cn: json.id_cn, skipped: false };
  }
  throw new Error(json.error || res.status);
}

// Submit page-images one by one to /scan (each = one بطاقة جبر). Sequential so
// the find-or-create-by-numcnss grouping can't race into duplicate مطلوبين — and
// so each duplicate page can be shown to the user before the next one is read.
export async function processPages(blobs, onProgress) {
  let created = 0, skipped = 0;
  const companyIds = new Set();
  let firstId = null;
  const errors = [];
  for (let i = 0; i < blobs.length; i++) {
    if (onProgress) {
      onProgress(blobs.length > 1 ? `جاري قراءة الصفحة ${i + 1} من ${blobs.length}…` : 'جاري قراءة البطاقة وإنشاء الملف…');
    }
    try {
      const pageLabel = blobs.length > 1 ? `الصفحة ${i + 1}` : '';
      const r = await createRecordFromCard(blobs[i], `page-${i + 1}.jpg`, askKeepDuplicate, pageLabel);
      if (r.skipped) skipped++;
      else { created++; companyIds.add(r.id_cn); }
      if (firstId == null) firstId = r.id_cn;   // a skipped page still points at its record
    } catch (e) {
      errors.push(`الصفحة ${i + 1}: ${e.message}`);
    }
  }
  return { created, skipped, companyIds: [...companyIds], firstId, errors };
}

// Human-readable outcome for a multi-page run, or null when a single card was
// created cleanly (the caller just navigates in that case).
export function summarizeRun(r, pageCount) {
  if (r.created === 0 && !r.skipped) return 'تعذّر إنشاء أي بطاقة.\n' + r.errors.join('\n');
  if (r.created === 0) {
    // Everything the run read was a duplicate the user declined to keep.
    let msg = pageCount === 1 && r.skipped === 1
      ? 'لم تُضَف البطاقة — هي مُسجّلة من قبل.'
      : `تم تجاهل ${r.skipped} بطاقة مكرّرة، ولم تُضَف أي بطاقة جديدة.`;
    if (r.errors.length) msg += `\n\nصفحات تعذّر استخراجها:\n` + r.errors.join('\n');
    return msg;
  }
  if (pageCount === 1 && r.companyIds.length === 1) return null;
  let msg = `تمت إضافة ${r.created} بطاقة من ${pageCount} صفحة`
    + (r.companyIds.length > 1 ? ` موزّعة على ${r.companyIds.length} مطلوبين.` : '.');
  if (r.skipped) msg += `\nتم تجاهل ${r.skipped} بطاقة مكرّرة.`;
  if (r.errors.length) msg += `\n\nصفحات تعذّر استخراجها:\n` + r.errors.join('\n');
  return msg;
}
