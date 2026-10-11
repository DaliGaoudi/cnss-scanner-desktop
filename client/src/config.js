// API base. The Electron app serves the API and the client from the SAME origin,
// so a relative '/api' works in production. In dev, vite.config.js proxies '/api'
// to the local Express server (port 3001).
export const API_BASE = '/api';

// Moved to the cloud: the local API answers 423 to every call (see
// server/index.js). Every page calls fetch() directly, so instead of touching
// each call site we watch the responses once: a 423 from one of our /api calls
// tells the app shell to re-read the licence, which then shows the cloud screen.
export const MOVED_EVENT = 'cnss:moved-to-cloud';

// The calls the shell itself makes to learn the licence state. They must NEVER
// signal: the gate reload (/onboarding/status) is itself answered 423 while
// moved, so signalling on it would loop forever. The server only exempts
// /license/status and /license/refresh from its 423 (that is how the cloud screen
// asks about an undo); every other /license/* call is never signalled here either,
// because the shell makes those itself and handles their answers.
const NO_SIGNAL = [`${API_BASE}/onboarding/status`, `${API_BASE}/license/`];

// Pure decision: should this response make the shell re-read the gate?
// Only a 423 on one of our /api calls, other than the shell's own licence calls.
export function shouldSignalMoved(url, status) {
  if (status !== 423) return false;
  const path = String(url || '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0];
  if (!path.startsWith(`${API_BASE}/`)) return false;
  return !NO_SIGNAL.some((p) => path === p || (p.endsWith('/') && path.startsWith(p)));
}

if (typeof window !== 'undefined' && !window.__cnssMovedWatch) {
  window.__cnssMovedWatch = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    const target = args[0];
    const url = typeof target === 'string' ? target : (target && target.url) || String(target);
    if (shouldSignalMoved(url, res.status)) window.dispatchEvent(new Event(MOVED_EVENT));
    return res;
  };
}

export default API_BASE;
