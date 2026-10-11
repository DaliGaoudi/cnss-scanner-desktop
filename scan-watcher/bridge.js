#!/usr/bin/env node
/**
 * Scan Bridge
 * -----------
 * A tiny local web server that lets the (cloud-hosted) web app drive the
 * scanner attached to THIS PC. The browser can't talk to a USB/WIA scanner
 * directly, so it asks this bridge instead:
 *
 *     browser ──POST http://127.0.0.1:17171/scan──▶ bridge
 *                                                     │ runs scan.ps1 (WIA)
 *                                                     ▼
 *     browser ◀──────── image bytes ───────────────── bridge
 *     browser ──uploads the image to the open record via the normal API──▶
 *
 * The user clicks "مسح ضوئي مباشر" in the record, the scanner scans, and the
 * page is attached — no file picking, no scanner button press.
 *
 * Run:  node bridge.js     (or double-click start-bridge.cmd)
 * Keep it always on: register start-bridge.cmd as a Windows startup task / service.
 *
 * Optional config.json (same folder) keys:
 *   BRIDGE_PORT   default 17171
 *   SCANNER_NAME  substring to prefer a specific scanner (optional)
 *   SCAN_DPI      default 200
 *   SCAN_FORMAT   jpeg | png | tiff | bmp   (default jpeg)
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

let cfg = {};
const CONFIG_PATH = path.join(__dirname, 'config.json');
if (fs.existsSync(CONFIG_PATH)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch (e) { console.warn('Ignoring invalid config.json:', e.message); }
}

const PORT    = cfg.BRIDGE_PORT || 17171;
const SCANNER = cfg.SCANNER_NAME || '';
const DPI     = cfg.SCAN_DPI || 150;   // 150 scans faster & smaller than 200; the app re-compresses anyway
const FORMAT  = (cfg.SCAN_FORMAT || 'jpeg').toLowerCase();
const SCRIPT  = path.join(__dirname, 'scan.ps1');

const MIME = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', tiff: 'image/tiff', bmp: 'image/bmp' };

function setCors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // Chrome Private Network Access: a public (https) page calling a loopback
    // address triggers a preflight that must be acknowledged here.
    if (req.headers['access-control-request-private-network']) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
}

function runScan({ dialog = false, dpi = DPI, gray = false } = {}) {
    return new Promise((resolve, reject) => {
        const out = path.join(os.tmpdir(), `scan-${Date.now()}.${FORMAT}`);
        const args = [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
            '-Out', out, '-Format', FORMAT, '-Dpi', String(dpi),
        ];
        if (SCANNER) args.push('-Device', SCANNER);
        if (gray) args.push('-Gray');
        if (dialog) args.push('-Dialog');

        execFile('powershell.exe', args, { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
            const msg = (stderr || '').trim();
            if (err && !fs.existsSync(out)) return reject(new Error(msg || err.message));
            if (!fs.existsSync(out)) return reject(new Error(msg || 'Scan failed (no output file).'));
            try {
                const buf = fs.readFileSync(out);
                fs.unlink(out, () => {});
                resolve(buf);
            } catch (e) { reject(e); }
        });
    });
}

const server = http.createServer(async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const route = req.url.split('?')[0];

    if (route === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, service: 'scan-bridge', version: 1 }));
    }

    if (route === '/scan' && (req.method === 'POST' || req.method === 'GET')) {
        const q = new URL(req.url, 'http://localhost').searchParams;
        const dialog = q.get('dialog') === '1';
        const dpi = parseInt(q.get('dpi'), 10) || DPI;
        const gray = q.get('gray') === '1';
        console.log(`${new Date().toISOString()}  scan requested (dpi=${dpi}${gray ? ', gray' : ''}${dialog ? ', dialog' : ''})…`);
        try {
            const buf = await runScan({ dialog, dpi, gray });
            console.log(`  ✓ scanned ${buf.length} bytes`);
            res.writeHead(200, { 'Content-Type': MIME[FORMAT] || 'application/octet-stream' });
            return res.end(buf);
        } catch (e) {
            console.error('  ✗ scan failed:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: e.message }));
        }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// Record our PID so uninstall-autostart.cmd can stop the hidden instance.
const PID_FILE = path.join(__dirname, 'bridge.pid');

server.listen(PORT, '127.0.0.1', () => {
    try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e) { /* non-fatal */ }
    console.log(`Scan bridge listening on http://127.0.0.1:${PORT}`);
    console.log('  POST /scan  → trigger the scanner, returns the image');
    console.log('  GET  /ping  → health check');
    if (SCANNER) console.log(`  Preferred scanner: "${SCANNER}"`);
});

function shutdown() {
    try { fs.unlinkSync(PID_FILE); } catch (e) { /* already gone */ }
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
