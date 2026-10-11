// API base. The Electron app serves the API and the client from the SAME origin,
// so a relative '/api' works in production. In dev, vite.config.js proxies '/api'
// to the local Express server (port 3001).
export const API_BASE = '/api';

export default API_BASE;
