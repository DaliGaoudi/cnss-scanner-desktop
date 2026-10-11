import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The built client is served by Express from the same origin as the API, so the
// default base '/' is correct. In dev, proxy '/api' to the embedded Express
// server (started by Electron on port 3001).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
