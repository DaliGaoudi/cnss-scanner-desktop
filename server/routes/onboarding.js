const express = require('express');
const router = express.Router();
const { getConfig, updateConfig, setPassword, officeProfile, mergeFromProfile, OFFICE_FIELDS } = require('../config');
const license = require('../license');
const { sampleActBuffer } = require('../services/actRender');
const { openDocx } = require('../services/openDoc');

/*
 * First-run onboarding (runs after activation, before the password login):
 * the customer enters their office details + optionally sets the app password,
 * previews the act, then continues. Local (127.0.0.1) and gated by activation.
 */
function requireActivated(req, res, next) {
    if (!license.getStatus().activated) return res.status(403).json({ error: 'التطبيق غير مُفعّل.' });
    next();
}

// Does the onboarding screen still need to show?
router.get('/status', (req, res) => {
    // `license` carries the trial countdown / "trial over" reason for the client gate.
    const lic = license.getStatus();
    res.json({
        activated: lic.activated,
        onboardingDone: !!getConfig().onboardingDone,
        profile: officeProfile(),
        license: lic,
    });
});

// Save the office details (+ optional password), mark onboarding done, and
// report the details to the license server.
router.post('/complete', requireActivated, async (req, res) => {
    try {
        const b = req.body || {};
        const patch = { onboardingDone: true };
        OFFICE_FIELDS.forEach((k) => { if (b[k] !== undefined) patch[k] = String(b[k]).slice(0, 400); });
        updateConfig(patch);
        if (b.password && String(b.password).length >= 4) setPassword(b.password);
        license.pushProfile(officeProfile()).catch(() => {});
        res.json({ ok: true, profile: officeProfile() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generate a sample act with the SUBMITTED (possibly un-saved) details and open
// it natively in Word (writes a local temp file → no "Mark of the Web" block).
router.post('/open-preview', requireActivated, async (req, res) => {
    try {
        const buf = sampleActBuffer(mergeFromProfile(req.body || {}));
        const r = await openDocx(buf, 'preview');
        res.json({ ok: true, ...r });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
