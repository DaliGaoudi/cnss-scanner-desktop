#!/usr/bin/env node
/*
 * Self-heal the electron-builder "winCodeSign" cache before packaging.
 *
 * electron-builder downloads a winCodeSign helper whose archive contains macOS
 * symlinks (darwin/.../libcrypto.dylib …). Extracting those on Windows needs the
 * symlink-create privilege, so on a stock account the build fails with:
 *   "Cannot create symbolic link : A required privilege is not held by the client"
 *
 * Those macOS files are useless for a Windows build. This script pre-populates
 * the cache with everything EXCEPT the darwin tree, so electron-builder finds a
 * ready cache and never tries to extract the symlinks. No Developer Mode / admin
 * needed. It's a no-op (fast) once the cache is in place.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const VERSION = 'winCodeSign-2.6.0';
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${VERSION}/${VERSION}.7z`;

const cacheRoot = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'electron-builder', 'Cache', 'winCodeSign'
);
const finalDir = path.join(cacheRoot, VERSION);
const sevenZip = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

function log(m) { console.log('[prepare-wincodesign]', m); }

// Already good? (rcedit present means the Windows tools are extracted.)
if (fs.existsSync(path.join(finalDir, 'rcedit-x64.exe'))) {
    log('cache already prepared — nothing to do.');
    process.exit(0);
}

if (process.platform !== 'win32') {
    log('not Windows — skipping.');
    process.exit(0);
}
if (!fs.existsSync(sevenZip)) {
    log('7za not found (run npm install first) — letting electron-builder handle it.');
    process.exit(0);
}

fs.mkdirSync(cacheRoot, { recursive: true });
const archive = path.join(cacheRoot, `${VERSION}.7z`);

function download(url, dest, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close(); fs.rmSync(dest, { force: true });
                if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
                return resolve(download(res.headers.location, dest, redirectsLeft - 1));
            }
            if (res.statusCode !== 200) { file.close(); return reject(new Error('HTTP ' + res.statusCode)); }
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (e) => { fs.rmSync(dest, { force: true }); reject(e); });
    });
}

(async () => {
    try {
        if (!fs.existsSync(archive)) {
            log('downloading ' + VERSION + '.7z …');
            await download(URL, archive);
        }
        log('extracting Windows tools (excluding macOS symlinks) …');
        fs.rmSync(finalDir, { recursive: true, force: true });
        // -xr!darwin drops the only part that contains symlinks.
        execFileSync(sevenZip, ['x', archive, '-o' + finalDir, '-xr!darwin', '-y'], { stdio: 'ignore' });
        if (fs.existsSync(path.join(finalDir, 'rcedit-x64.exe'))) {
            log('cache prepared OK.');
        } else {
            log('extraction finished but rcedit missing — letting electron-builder retry.');
        }
    } catch (e) {
        // Never block the build; electron-builder will fall back to its own download.
        log('could not pre-seed cache (' + e.message + ') — continuing; enable Developer Mode if the build then fails.');
    }
})();
