const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const authenticate = require('../middleware/auth');
const { getConfig, setPassword, updateConfig, templatePath, officeProfile, OFFICE_FIELDS, DEFAULT_PASSWORD } = require('../config');
const license = require('../license');
const templateSync = require('../templateSync');
const { sampleActBuffer } = require('../services/actRender');
const { openDocx } = require('../services/openDoc');

const BUNDLED_TEMPLATE = path.join(__dirname, '..', 'assets', 'template_cnss.docx');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// One sample act record covering every tag the act template can use, so we can
// dry-render an uploaded template and reject malformed ones before it's saved.
const SAMPLE_ACTS = [{
    num_dossier: '123', code_inscription: '00', num_affiliation: '612555',
    nom_matloub: 'SARL EXEMPLE', adresse: 'Tunis', date_carte: '21-05-2026',
    num_carte: '4621400216', trimestre: '04/2021', montant: '2959.306',
    date_penalite: '16/01/2022',
}];

// Try to render a .docx buffer as an act template. Returns null on success or a
// human-readable (Arabic) error describing what's wrong with the template.
function validateTemplate(buffer) {
    try {
        const zip = new PizZip(buffer);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        doc.render({ acts: SAMPLE_ACTS });
        return null;
    } catch (e) {
        // docxtemplater aggregates tag errors in e.properties.errors
        const parts = (e.properties && e.properties.errors || [])
            .map(err => (err.properties && err.properties.explanation) || err.message)
            .filter(Boolean);
        const detail = parts.length ? parts.join(' • ') : e.message;
        return 'النموذج غير صالح: تأكّد من سلامة الحقول ({nom_matloub}, {num_carte}, {#acts}…{/acts} …). ' + detail;
    }
}

const sendDocx = (res, buf, filename) => {
    res.setHeader('Content-Type', DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
};

// ── Public: office name for the login screen (no auth, name only) ──
router.get('/public', (req, res) => {
    const cfg = getConfig();
    // While nobody has chosen a password, the login screen shows the default: a
    // demo/trial key or a re-activated office skips onboarding (where one would
    // be set) and would otherwise face a password it was never told. Disclosing a
    // password that was never changed protects nothing it was protecting.
    const defaultPassword = bcrypt.compareSync(DEFAULT_PASSWORD, cfg.passwordHash || '') ? DEFAULT_PASSWORD : null;
    res.json({ officeName: cfg.officeName || '', defaultPassword });
});

// ── Current settings (no secrets) ──
router.get('/', authenticate, (req, res) => {
    res.json({
        ...officeProfile(),
        hasCustomTemplate: fs.existsSync(templatePath()),
    });
});

// ── Change the shared password (must know the current one) ──
router.put('/password', authenticate, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 4) {
        return res.status(400).json({ error: 'كلمة المرور الجديدة قصيرة جداً (4 أحرف على الأقل).' });
    }
    if (!currentPassword || !bcrypt.compareSync(String(currentPassword), getConfig().passwordHash)) {
        return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
    }
    setPassword(newPassword);
    res.json({ success: true });
});

// ── Office profile: bailiff name (branding) + letterhead details ──
router.put('/office', authenticate, (req, res) => {
    const b = req.body || {};
    const patch = {};
    OFFICE_FIELDS.forEach((k) => { if (b[k] !== undefined) patch[k] = String(b[k]).slice(0, 400); });
    updateConfig(patch);
    license.pushProfile(officeProfile()).catch(() => {}); // mirror to the license server
    res.json({ success: true, ...officeProfile() });
});

// ── Preview the act with the current office profile (open natively in Word) ──
router.post('/template/open-sample', authenticate, async (req, res) => {
    try {
        const r = await openDocx(sampleActBuffer(), 'preview');
        res.json({ ok: true, ...r });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Template: download the bundled sample (correctly-tagged starting point) ──
router.get('/template/sample', authenticate, (req, res) => {
    sendDocx(res, fs.readFileSync(BUNDLED_TEMPLATE), 'template_cnss_sample.docx');
});

// ── Template: download the currently active one (custom or bundled) ──
router.get('/template', authenticate, (req, res) => {
    const p = fs.existsSync(templatePath()) ? templatePath() : BUNDLED_TEMPLATE;
    sendDocx(res, fs.readFileSync(p), 'template_cnss.docx');
});

// ── Template: upload a custom one (validated before saving) ──
router.post('/template', authenticate, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'لم يتم استلام أي ملف.' });
    const name = (req.file.originalname || '').toLowerCase();
    if (req.file.mimetype !== DOCX_MIME && !name.endsWith('.docx')) {
        return res.status(400).json({ error: 'النوع غير مدعوم: أرسل ملف Word بصيغة .docx.' });
    }
    const err = validateTemplate(req.file.buffer);
    if (err) return res.status(422).json({ error: err });
    try {
        fs.writeFileSync(templatePath(), req.file.buffer);
        templateSync.pushKind('act').catch(() => {}); // best-effort: keeps the licence server's copy in step
        res.json({ success: true, hasCustomTemplate: true });
    } catch (e) {
        res.status(500).json({ error: 'تعذّر حفظ النموذج: ' + e.message });
    }
});

// ── Template: revert to the bundled default ──
router.delete('/template', authenticate, (req, res) => {
    try {
        if (fs.existsSync(templatePath())) fs.unlinkSync(templatePath());
        templateSync.pushKind('act').catch(() => {}); // the file is gone → the server drops its copy too
        res.json({ success: true, hasCustomTemplate: false });
    } catch (e) {
        res.status(500).json({ error: 'تعذّر الحذف: ' + e.message });
    }
});

module.exports = router;
