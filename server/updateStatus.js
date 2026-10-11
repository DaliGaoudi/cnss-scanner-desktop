/*
 * Shared auto-update status. main.js (Electron) writes to it from electron-updater
 * events; the embedded server exposes it at /api/update so the React UI can show
 * a download indicator and an "up to date / restart" state without IPC/preload.
 * Same process, so it's a single shared instance.
 */
let status = { state: 'idle', percent: 0, version: null, current: null };
let installFn = null;
let checkFn = null;

module.exports = {
    get: () => status,
    set: (patch) => { status = { ...status, ...patch }; },
    onInstall: (fn) => { installFn = fn; },
    onCheck: (fn) => { checkFn = fn; },
    triggerInstall: () => { if (installFn) { installFn(); return true; } return false; },
    triggerCheck: () => { if (checkFn) { checkFn(); return true; } return false; },
};
