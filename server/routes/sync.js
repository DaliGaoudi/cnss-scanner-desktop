const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const sync = require('../sync');

/*
 * Manual "sync now" — pull the latest shared records, then push local changes.
 * Authenticated (office password) like the other data routes. Sync also runs
 * automatically on launch (pull) and after every record change (push).
 */
router.post('/now', authenticate, async (req, res) => {
    try {
        await sync.syncNow();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message || 'sync failed' });
    }
});

/*
 * Shrink-guard status + resolutions. When the server refuses an auto-push (422)
 * because the local records look wiped, auto-sync pauses and Settings shows a
 * warning with two ways out.
 */
router.get('/status', authenticate, (req, res) => {
    res.json({ shrinkGuard: sync.guardState() });
});

// Take the server's copy (discard local), then resume normal sync.
router.post('/resolve/pull', authenticate, async (req, res) => {
    try {
        const r = await sync.resolvePullServer();
        if (!r.ok) return res.status(502).json({ error: 'تعذّر تنزيل نسخة الخادوم. تحقّق من الاتصال.' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message || 'resolve failed' });
    }
});

// Overwrite the server with the local copy (force push past the guard).
router.post('/resolve/force', authenticate, async (req, res) => {
    try {
        const r = await sync.resolveForceOverwrite();
        if (!r.ok) return res.status(502).json({ error: 'تعذّر استبدال نسخة الخادوم. تحقّق من الاتصال.' });
        res.json({ ok: true, pulled: !!r.pulled });
    } catch (err) {
        res.status(500).json({ error: err.message || 'resolve failed' });
    }
});

module.exports = router;
