import * as pdfjsLib from 'pdfjs-dist';
// Bundle the worker via Vite's ?worker import so it works offline in the packaged
// app (no CDN, no MIME-type guessing on the embedded static server).
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

/*
 * Rasterize every page of a PDF to a JPEG blob. Used to split a multi-page
 * upload (one بطاقة جبر per page) so each page can be sent to the scan/extract
 * endpoint as an image — the same path scanned cards already take.
 */
export async function pdfToJpegBlobs(file, { maxEdge = 2000, quality = 0.72 } = {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const blobs = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      // Render large enough for OCR, but cap the long edge (keeps the upload small).
      const scale = Math.max(0.2, Math.min(3, maxEdge / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('تعذّر تحويل الصفحة إلى صورة'))), 'image/jpeg', quality));
      blobs.push(blob);
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy(); // PDFDocumentProxy has no destroy() in v6 — the task does
  }
  return blobs;
}
