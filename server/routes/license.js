const express = require('express');
const router = express.Router();
const license = require('../license');
const { setPassword } = require('../config');

/*
 * Local (127.0.0.1) license endpoints the client uses to gate the app BEFORE the
 * office password. No JWT auth here — this runs only inside the Electron app and
 * is the layer that decides whether the app is usable on this machine at all.
 */

// Current activation status (drives the activation screen).
router.get('/status', (req, res) => {
    res.json(license.getStatus());
});

// Ask the server again ("I've paid — check now"): an extended or converted trial
// gets a fresh token and unlocks without re-typing the key.
router.post('/refresh', async (req, res) => {
    await license.revalidate();
    const status = license.getStatus();
    // A freshly unlocked device should open on current records.
    if (status.activated) { try { await require('../sync').pull(); } catch (e) { /* best-effort */ } }
    res.json(status);
});

// Leave the licence from the password screen (no office password needed — the
// licence key itself is the confirmation). See license.leave().
router.post('/leave', async (req, res) => {
    try {
        res.json(await license.leave((req.body || {}).licenseKey));
    } catch (err) {
        res.status(400).json({ error: err.message || 'تعذّر الخروج من الترخيص.' });
    }
});

// ── Forgotten office password (from the password screen, no login) ──
// The provider approves in /admin; until then complete() is refused by the server.
const MIN_PASSWORD = 4; // same floor as onboarding
const NO_SERVER = 'تعذّر الاتصال بخادم الترخيص. تأكّد من اتصال الإنترنت.';
const relay = (fn) => async (req, res) => {
    try {
        const r = await fn();
        res.status(r.ok ? 200 : r.status).json(r.body);
    } catch (err) {
        res.status(503).json({ error: NO_SERVER });
    }
};
router.post('/password-reset/request', relay(() => license.passwordResetRequest()));
router.get('/password-reset/status', relay(() => license.passwordResetStatus()));

router.post('/password-reset/complete', async (req, res) => {
    const password = String((req.body || {}).password || '');
    if (password.length < MIN_PASSWORD) {
        return res.status(400).json({ error: `كلمة المرور قصيرة جداً (${MIN_PASSWORD} أحرف على الأقل).` });
    }
    try {
        // Spend the approval first: if the server refuses, the password stays as it was.
        const r = await license.passwordResetConsume();
        if (!r.ok) return res.status(r.status).json(r.body);
        setPassword(password);
        res.json({ ok: true });
    } catch (err) {
        res.status(503).json({ error: NO_SERVER });
    }
});

// Activate a license key on this machine.
router.post('/activate', async (req, res) => {
    try {
        const { licenseKey } = req.body || {};
        if (!licenseKey || !String(licenseKey).trim()) {
            return res.status(400).json({ error: 'أدخل مفتاح الترخيص.' });
        }
        const status = await license.activate(licenseKey);
        res.json(status);
    } catch (err) {
        res.status(400).json({ error: err.message || 'فشل التفعيل.' });
    }
});

module.exports = router;
