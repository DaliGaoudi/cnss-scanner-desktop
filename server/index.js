const express = require('express');
const cors = require('cors');
const path = require('path');

/*
 * Carved single-office Express app. Serves the CNSS API and (in production) the
 * built React client from the same origin, so the client's API_BASE = '/api'
 * works unchanged.
 */
function createApp({ clientDist } = {}) {
    const app = express();

    app.use(cors());
    app.use(express.json({ limit: '15mb' }));

    app.get('/api/health', (req, res) => res.json({ status: 'ok', database: 'sqlite' }));

    // Never cache API responses.
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        next();
    });

    // Moved to the cloud: the local API is shut except what the lock screen needs
    // (licence status/refresh, health). No edit can succeed, even from an open window.
    const OPEN_WHEN_MOVED = new Set(['/health', '/license/status', '/license/refresh']);
    app.use('/api', (req, res, next) => {
        const moved = require('./license').isMoved();
        if (!moved || OPEN_WHEN_MOVED.has(req.path)) return next();
        res.status(423).json({ code: 'moved_to_cloud', cloudUrl: moved.url });
    });

    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/license', require('./routes/license'));
    app.use('/api/onboarding', require('./routes/onboarding'));
    app.use('/api/cnss', require('./routes/cnss'));
    app.use('/api/sync', require('./routes/sync'));
    app.use('/api/ai', require('./routes/ai'));
    app.use('/api/settings', require('./routes/settings'));
    app.use('/api/word-import', require('./routes/wordImport'));
    app.use('/api/update', require('./routes/update'));

    // Serve the built client + SPA fallback for client-side routes. Resolve to an
    // absolute path so res.sendFile is happy regardless of how clientDist is passed.
    if (clientDist) {
        const dist = path.resolve(clientDist);
        app.use(express.static(dist));
        app.use((req, res, next) => {
            if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
            res.sendFile(path.join(dist, 'index.html'));
        });
    }

    return app;
}

// Start the server on 127.0.0.1. Pass port 0 to get a free ephemeral port.
function startServer({ port = 0, clientDist } = {}) {
    return new Promise((resolve, reject) => {
        const app = createApp({ clientDist });
        const server = app.listen(port, '127.0.0.1', () => {
            // Re-validate the license in the background (honours revocation/transfer).
            try { require('./license').revalidate().catch(() => {}); } catch (e) { /* ignore */ }
            // Pull the latest shared records so this device opens up to date.
            try { require('./sync').pull().catch(() => {}); } catch (e) { /* ignore */ }
            resolve(server);
        });
        server.on('error', reject);
    });
}

module.exports = { createApp, startServer };

// Allow running the API standalone (dev/testing): `node server/index.js`
if (require.main === module) {
    startServer({ port: process.env.PORT || 3001 }).then(s => {
        console.log(`CNSS server listening on http://127.0.0.1:${s.address().port}`);
    });
}
