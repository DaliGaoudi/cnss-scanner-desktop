// Render the app icon (SVG → PNG via Chromium) and pack a multi-size Windows
// .ico. Run with real Electron (GUI):  npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// On-theme: a document/card being scanned (بطاقة جبر) — a teal scan beam over a
// white card with RTL text lines, on a deep-blue rounded square.
const SVG = `
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e6fd9"/><stop offset="1" stop-color="#0e4a9e"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2dd4bf" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#2dd4bf"/>
      <stop offset="1" stop-color="#2dd4bf" stop-opacity="0"/>
    </linearGradient>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#06245a" flood-opacity="0.45"/>
    </filter>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="256" height="256" rx="56" fill="url(#bg)"/>

  <!-- document card -->
  <g filter="url(#ds)">
    <rect x="70" y="44" width="116" height="168" rx="12" fill="#ffffff"/>
    <path d="M70 56 a12 12 0 0 1 12 -12 h92 a12 12 0 0 1 12 12 v18 h-116 z" fill="#0e4a9e"/>
  </g>
  <!-- RTL text lines -->
  <g fill="#cbd5e1">
    <rect x="92" y="92"  width="72" height="9" rx="4.5"/>
    <rect x="104" y="110" width="60" height="9" rx="4.5"/>
    <rect x="116" y="146" width="48" height="9" rx="4.5"/>
    <rect x="92" y="164" width="72" height="9" rx="4.5"/>
    <rect x="110" y="182" width="54" height="9" rx="4.5"/>
  </g>

  <!-- scan beam -->
  <g filter="url(#glow)">
    <rect x="52" y="124" width="152" height="6" rx="3" fill="url(#beam)"/>
    <circle cx="56" cy="127" r="6" fill="#2dd4bf"/>
    <circle cx="200" cy="127" r="6" fill="#2dd4bf"/>
  </g>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:256px;height:256px;background:transparent;overflow:hidden}</style>
</head><body>${SVG}</body></html>`;

function buildIco(pngs) {
    const count = pngs.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
    const entries = Buffer.alloc(16 * count);
    let offset = 6 + 16 * count;
    const datas = [];
    pngs.forEach((p, i) => {
        const e = entries.subarray(i * 16, i * 16 + 16);
        e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
        e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
        e.writeUInt16LE(1, 4);   // planes
        e.writeUInt16LE(32, 6);  // bpp
        e.writeUInt32LE(p.buf.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += p.buf.length;
        datas.push(p.buf);
    });
    return Buffer.concat([header, entries, ...datas]);
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true,
        webPreferences: { paintWhenInitiallyHidden: true, offscreen: false } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 600));
    const base = await win.webContents.capturePage();
    const dir = path.join(__dirname, '..', 'build');
    fs.mkdirSync(dir, { recursive: true });
    const png256 = base.resize({ width: 256, height: 256, quality: 'best' });
    fs.writeFileSync(path.join(dir, 'icon.png'), png256.toPNG());
    const pngs = [256, 128, 64, 48, 32, 16].map((s) => ({ size: s, buf: base.resize({ width: s, height: s, quality: 'best' }).toPNG() }));
    fs.writeFileSync(path.join(dir, 'icon.ico'), buildIco(pngs));
    console.log('wrote build/icon.png + build/icon.ico');
    win.destroy();
    app.quit();
}).catch((e) => { console.error(e); app.quit(); });
