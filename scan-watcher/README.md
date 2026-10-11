# Scan Bridge / Watcher

Two ways to get scanned paper into the web app without picking files by hand.
Pick **one** (the Bridge is the recommended one):

| | Scan Bridge (`bridge.ps1`) ⭐ | Scan Watcher (`watcher.js`) |
|---|---|---|
| Trigger | Press **«مسح صفحة»** in the web app | Press the **Scan** button on the device |
| Scanner control | The app drives the scanner (Windows WIA) | Scanner saves to a folder, watcher uploads it |
| Runtime | **Built-in PowerShell — no install** | Needs Node.js installed |
| Auth | None — talks only to your browser | Needs a long-lived login token |
| Best for | A USB/flatbed scanner on the same PC as the browser | A network scanner shared by many PCs |

---

## Scan Bridge (recommended)

The browser can't talk to a scanner directly, so this tiny local server does it.
When you click **«مسح ضوئي مباشر»** on a record, the browser calls the bridge, the
bridge runs the scanner via Windows Image Acquisition (WIA), and hands the image
back to the browser, which uploads it to that record.

```
browser ──POST http://127.0.0.1:17171/scan──▶ bridge ──(WIA)──▶ scanner
browser ◀─────────── image ──────────────────  bridge
browser ──uploads image to the open record (normal API)──▶ web app
```

### Setup (one time, on each PC with a scanner) — recommended

You don't need to copy this folder between PCs. In the web app, open
**الإعدادات** (Settings) → **«تنزيل أداة المسح الضوئي»** to download
`scan-bridge-setup.zip`, then **Extract All**. (Regenerate that zip with
`make-zip.ps1` after changing any script here, and commit it — Vercel can't build
it.)

1. Make sure the scanner's Windows driver is installed (it must appear under
   *Settings → Bluetooth & devices → Printers & scanners*). **No Node.js or admin
   rights needed** — the bridge runs on the PowerShell already built into Windows.
2. **Double-click `install-autostart.cmd` once.** This makes the bridge start
   *hidden in the background* every time you log in — nothing to open by hand.
   (Run `uninstall-autostart.cmd` to undo it.)
3. In the web app, open any record → **المستندات** tab → **«مسح صفحة»** for each
   page, then **«حفظ PDF»**. The pages are combined and attached as one PDF.

> **Why a local helper at all?** A web page can't talk to a USB/WIA scanner or
> launch a program on your PC — browsers sandbox that for security. The bridge is
> a tiny local server the page asks to do the scan. Auto-start just keeps it
> always running so clicking the button is all you ever do.

### Run it manually instead (no auto-start)

- Hidden (no window): double-click `bridge-hidden.vbs`.
- With a visible log window: double-click `start-bridge.cmd`.

### Settings (optional `config.json`)

Copy `config.example.json` → `config.json` and set any of:
- `BRIDGE_PORT` — default `17171` (if you change it, set `localStorage.scanBridgeUrl`
  to `http://127.0.0.1:<port>` in the browser).
- `SCANNER_NAME` — a substring of the scanner's name, to prefer a specific device.
- `SCAN_DPI` — default `150`. The app can override per request via `/scan?dpi=`.
- `SCAN_FORMAT` — `jpeg` (default), `png`, `tiff`, or `bmp`.

The app requests `POST /scan` per page; `?dpi=<n>` and `?gray=1` override the
defaults for that scan.

### Testing without a scanner (mock mode)

To exercise the whole flow on a PC that has no scanner, make the bridge return a
generated test page instead of driving WIA:

- **Bridge side:** set `"SCAN_MOCK": true` in `config.json`, or request `/scan?mock=1`.
- **Web app side:** in the browser console run `localStorage.scanMock = '1'` — the
  scan button then appends `?mock=1`. Set it back with `localStorage.removeItem('scanMock')`.

This lets you verify scan → compress → multi-page → PDF → upload end-to-end. Run
the app locally with the server on `:3001` and `npm run dev` (the client proxies
`/api`), point the scan button at the local bridge, and scan a few mock pages.

### Notes & troubleshooting

- **"تعذّر الوصول إلى الماسح الضوئي"** → the bridge isn't running, or the browser
  blocked the loopback call. Start `start-bridge.cmd`; in Chrome/Edge loopback
  calls from an https site are allowed (Private Network Access is handled).
- **"No scanner found"** → the device is off or its driver isn't installed. Test
  with the built-in **Windows Fax and Scan** app first.
- Each `/scan` returns **one flatbed page**. The web app handles multi-page itself:
  click **«مسح صفحة»** per page, then **«حفظ PDF»** to compress and combine them
  into one PDF named after the record number (e.g. `9050.pdf`).
- Compression and PDF assembly happen in the browser, so the bridge stays
  dependency-free. The PDF is posted through the normal `/api/attachments`
  endpoint (works with Vercel Blob or the database fallback).

---

## Scan Watcher (scan-to-folder mode)

> Advanced/optional. This mode is **Node-based** and is **not** included in the
> downloaded `scan-bridge-setup.zip`; grab `watcher.js` from the project repo if
> you need it.

Makes scanning automatic the other way around: configure the scanner software to
**Scan to folder**, and the watcher uploads each new file to whatever record the
user currently has open.

```
Scanner ──(scan to folder)──▶ watched folder ──watcher.js──▶ POST /api/attachments/ingest
```

The web app records which record each user has open (it calls
`/api/attachments/scan-target` when a record is opened); the server decides which
record an uploaded scan belongs to.

### Setup

1. **Install Node.js 18+**.
2. Configure the scanner software to *Scan to folder*, e.g. `C:\Users\Public\Scans`.
3. Copy `config.example.json` → `config.json` and set `API_BASE`, `WATCH_FOLDER`,
   and `TOKEN` (a JWT for the office user — log in and copy `localStorage.token`,
   or issue a long-expiry token).
4. Run `node watcher.js` (register as a startup task / service to keep it on).

### Notes

- If no record is open when a scan arrives, the server returns `409` and the file
  is skipped — open a record and scan again.
- Set `MOVE_PROCESSED_TO` to move uploaded files out of the watch folder.
