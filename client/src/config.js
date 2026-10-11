// API base. The Electron app serves the API and the client from the SAME origin,
// so a relative '/api' works in production. In dev, vite.config.js proxies '/api'
// to the local Express server (port 3001).
export const API_BASE = '/api';

// Moved to the cloud: the local API answers 423 to every call (see
// server/index.js). Every page calls fetch() directly, so instead of touching
// each call site we watch the responses once: a 423 from our API tells the app
// shell to re-read the licence, which then shows the cloud screen.
export const MOVED_EVENT = 'cnss:moved-to-cloud';
if (typeof window !== 'undefined' && !window.__cnssMovedWatch) {
  window.__cnssMovedWatch = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    if (res.status === 423) window.dispatchEvent(new Event(MOVED_EVENT));
    return res;
  };
}

export default API_BASE;
