const { app, BrowserWindow, shell, dialog, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;

let serverInstance = null;
let bridgeProc = null;
let mainWindow = null;

// ─────────────────────────── Express (in-process) ───────────────────────────
async function startEmbeddedServer() {
    // Point config.js / db.js at the per-user writable data dir BEFORE requiring
    // the server (so config.json + cnss.db land there, not in the install dir).
    process.env.CNSS_USERDATA = app.getPath('userData');

    const { startServer } = require(path.join(__dirname, '..', 'server', 'index.js'));
    const clientDist = isDev ? null : path.join(__dirname, '..', 'client', 'dist');
    const port = isDev ? 3001 : 0; // dev: fixed port for the Vite proxy; prod: ephemeral
    serverInstance = await startServer({ port, clientDist });
    return serverInstance.address().port;
}

// ─────────────────────────── Scan bridge (child) ────────────────────────────
function startScanBridge() {
    // In a packaged app the scan-watcher folder is copied to resources/ (kept
    // out of the asar so PowerShell can run scan.ps1). In dev it sits in the repo.
    const bridgePath = isDev
        ? path.join(__dirname, '..', 'scan-watcher', 'bridge.js')
        : path.join(process.resourcesPath, 'scan-watcher', 'bridge.js');

    try {
        // Run bridge.js with Electron's bundled Node (no separate node needed).
        bridgeProc = spawn(process.execPath, [bridgePath], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: 'ignore',
            windowsHide: true,
        });
        bridgeProc.on('error', (e) => console.error('scan-bridge failed to start:', e.message));
        bridgeProc.on('exit', (code) => { if (code) console.error('scan-bridge exited with code', code); });
    } catch (e) {
        console.error('scan-bridge spawn error:', e.message);
    }
}

// ─────────────────────────────── Window ─────────────────────────────────────
function createWindow(url) {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        show: false,
        title: 'CNSS Scanner',
        icon: path.join(__dirname, '..', 'build', 'icon.ico'),
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(url);
    mainWindow.once('ready-to-show', () => mainWindow.show());

    // Open external links in the system browser, never inside the app window.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// ─────────────────────────── Auto-update (GitHub) ───────────────────────────
function setupAutoUpdate() {
    const updateStatus = require(path.join(__dirname, '..', 'server', 'updateStatus'));
    updateStatus.set({ current: app.getVersion() });
    if (isDev) return; // only meaningful in the packaged app

    let autoUpdater;
    try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }
    autoUpdater.autoDownload = true;

    // The React UI polls /api/update/status to show progress + the restart prompt.
    updateStatus.onInstall(() => { try { autoUpdater.quitAndInstall(); } catch (e) { /* ignore */ } });
    updateStatus.onCheck(() => autoUpdater.checkForUpdates().catch(() => {}));

    autoUpdater.on('checking-for-update', () => updateStatus.set({ state: 'checking' }));
    autoUpdater.on('update-available', (i) => updateStatus.set({ state: 'downloading', version: i.version, percent: 0 }));
    autoUpdater.on('update-not-available', () => updateStatus.set({ state: 'idle' }));
    autoUpdater.on('download-progress', (p) => {
        updateStatus.set({ state: 'downloading', percent: Math.round(p.percent) });
        if (mainWindow) mainWindow.setProgressBar(p.percent / 100);
    });
    autoUpdater.on('update-downloaded', (i) => {
        updateStatus.set({ state: 'downloaded', version: i.version, percent: 100 });
        if (mainWindow) mainWindow.setProgressBar(-1);
        // Native OS toast so it's noticed even if the app isn't focused (long-open PCs).
        try {
            if (Notification.isSupported()) {
                const n = new Notification({ title: 'تحديث جديد جاهز', body: 'أعد تشغيل «ماسح بطاقات الجبر» لتطبيق التحديث.' });
                n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
                n.show();
            }
        } catch (e) { /* notifications optional */ }
    });
    autoUpdater.on('error', () => updateStatus.set({ state: 'idle' }));

    // Check on launch, then keep checking every few hours so always-open PCs still
    // get updates without ever closing the app.
    const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
    const check = () => {
        const s = updateStatus.get().state;
        if (s === 'downloading' || s === 'downloaded') return; // already handling one
        autoUpdater.checkForUpdates().catch((e) => console.error('update check failed:', e && e.message));
    };
    check();
    setInterval(check, CHECK_INTERVAL_MS);
}

// ─────────────────────────────── Lifecycle ──────────────────────────────────
async function boot() {
    try {
        const port = await startEmbeddedServer();
        startScanBridge();
        const url = isDev ? 'http://localhost:5173' : `http://127.0.0.1:${port}`;
        createWindow(url);
        setupAutoUpdate();
    } catch (e) {
        console.error('Fatal boot error:', e);
        app.quit();
    }
}

function cleanup() {
    if (bridgeProc) { try { bridgeProc.kill(); } catch (e) { /* already gone */ } bridgeProc = null; }
    if (serverInstance) { try { serverInstance.close(); } catch (e) { /* ignore */ } serverInstance = null; }
}

app.whenReady().then(boot);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on('window-all-closed', () => {
    cleanup();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanup);
process.on('exit', cleanup);
