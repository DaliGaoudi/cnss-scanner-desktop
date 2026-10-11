const express = require('express');
const router = express.Router();
const updateStatus = require('../updateStatus');

// Local update status for the in-app indicator (no auth — it's just app state).
router.get('/status', (req, res) => res.json(updateStatus.get()));

// Trigger a fresh check (manual "check for updates").
router.post('/check', (req, res) => {
    updateStatus.set({ state: 'checking' });
    res.json({ ok: updateStatus.triggerCheck() });
});

// Restart + install the downloaded update.
router.post('/install', (req, res) => res.json({ ok: updateStatus.triggerInstall() }));

module.exports = router;
