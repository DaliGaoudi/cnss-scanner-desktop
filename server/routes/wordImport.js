const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const authenticate = require('../middleware/auth');
const { getConfig, updateConfig, templatePath, listTemplatePath, importDir } = require('../config');
const license = require('../license');
const { build } = require('../services/templateImport');
const { renderActs, SAMPLE_ACT } = require('../services/actRender');
const { renderMonthlyList } = require('../services/listRender');
const { openDocx } = require('../services/openDoc');

/*
 * "Import your own Word file" — the office gives one of its own documents and the
 * app prints in that look (and, when it can map them, that wording). Three steps:
 *   POST /analyze   upload → build the templates → kept PENDING, report returned
 *   POST /preview   open a sample act / monthly bill from the pending result in Word
 *   POST /apply     the user approved: the pending templates become the active ones
 * DELETE / goes back to the standard look. Nothing is active until /apply.
 * Services: services/templateImport.js (building), docxModel.js (Word internals).
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const pendingDir = () => path.join(importDir(), 'pending');
const pendingFile = (f) => path.join(pendingDir(), f);
const activeReport = () => path.join(importDir(), 'active.json');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

// What the Settings card and the first-run prompt need.
router.get('/status', authenticate, (req, res) => {
    res.json({
        active: readJson(activeReport()),
        pending: readJson(pendingFile('report.json')),
        hasCustomAct: fs.existsSync(templatePath()),
        offered: !!getConfig().wordImportOffered,
    });
});

// The first-run prompt was answered (imported or skipped): don't ask again.
router.post('/offered', authenticate, (req, res) => {
    updateConfig({ wordImportOffered: true });
    res.json({ ok: true });
});

// multer hands over the file name as latin1; browsers send UTF-8 — so an Arabic
// name («محضر.docx») arrives garbled unless decoded back.
const fileNameOf = (file) => Buffer.from(file.originalname || '', 'latin1').toString('utf8');

router.post('/analyze', authenticate, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'لم يتم استلام أي ملف.' });
    req.file.originalname = fileNameOf(req.file);
    const name = req.file.originalname.toLowerCase();
    if (name.endsWith('.doc') && !name.endsWith('.docx')) {
        return res.status(400).json({ error: 'هذا ملف Word قديم (.doc). افتحه في Word واحفظه بصيغة .docx ثم أعد المحاولة.' });
    }
    if (req.file.mimetype !== DOCX_MIME && !name.endsWith('.docx')) {
        return res.status(400).json({ error: 'النوع غير مدعوم: أرسل ملف Word بصيغة .docx.' });
    }
    try {
        const { act, list, report } = await build(req.file.buffer, { mapWithAI: (blocks) => license.templateMap(blocks) });
        fs.rmSync(pendingDir(), { recursive: true, force: true });
        fs.mkdirSync(pendingDir(), { recursive: true });
        fs.writeFileSync(pendingFile('act.docx'), act);
        fs.writeFileSync(pendingFile('list.docx'), list);
        fs.writeFileSync(pendingFile('source.docx'), req.file.buffer);
        const full = { ...report, sourceName: req.file.originalname, analyzedAt: new Date().toISOString() };
        fs.writeFileSync(pendingFile('report.json'), JSON.stringify(full, null, 2));
        res.json({ ok: true, report: full });
    } catch (err) {
        console.error('word-import analyze error:', err);
        res.status(422).json({ error: err.message || 'تعذّر تحليل الملف.' });
    }
});

// A sample act / monthly bill rendered from the pending templates, opened in Word.
const SAMPLE_LIST_ROWS = () => {
    const d = new Date();
    const ymd = (day) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const fees = { fee_original: '30000', fee_counterparts: '10000', fee_legal_copy: '10000', fee_office_copy: '10000', fee_movement: '14000', fee_copies: '500', fee_registration: '30000', fee_stamp: '200', fee_post: '6250', vat_rate: '19' };
    return [
        { id_cn_oe: 1, nbrreg: '7101', codeng: '00', numcnss: '512340', numcarte: '4621400101', nom_cl2: 'مثال: شركة ما ش.م.م', cl2_adresse: 'العنوان هنا', date_tabligh: ymd(3), ...fees },
        { id_cn_oe: 2, nbrreg: '7102', codeng: '01', numcnss: '603781', numcarte: '4621400117', nom_cl2: 'مثال: مؤسسة أخرى', cl2_adresse: 'العنوان هنا', date_tabligh: ymd(9), ...fees },
    ];
};
router.post('/preview', authenticate, async (req, res) => {
    const which = (req.body || {}).doc === 'list' ? 'list' : 'act';
    if (!fs.existsSync(pendingFile(`${which}.docx`))) return res.status(404).json({ error: 'لا يوجد ملف قيد المراجعة.' });
    try {
        const tpl = fs.readFileSync(pendingFile(`${which}.docx`));
        const d = new Date();
        const buf = which === 'act'
            ? renderActs([SAMPLE_ACT], undefined, tpl)
            : renderMonthlyList(SAMPLE_LIST_ROWS(), { year: d.getFullYear(), month: d.getMonth() + 1 }, tpl).buffer;
        res.json({ ok: true, ...(await openDocx(buf, which === 'act' ? 'معاينة_المحضر' : 'معاينة_القائمة')) });
    } catch (err) {
        res.status(500).json({ error: 'تعذّر إنشاء المعاينة: ' + err.message });
    }
});

router.post('/apply', authenticate, (req, res) => {
    if (!fs.existsSync(pendingFile('act.docx'))) return res.status(404).json({ error: 'لا يوجد ملف قيد المراجعة.' });
    fs.copyFileSync(pendingFile('act.docx'), templatePath());
    fs.copyFileSync(pendingFile('list.docx'), listTemplatePath());
    fs.copyFileSync(pendingFile('report.json'), activeReport());
    fs.copyFileSync(pendingFile('source.docx'), path.join(importDir(), 'source.docx'));
    fs.rmSync(pendingDir(), { recursive: true, force: true });
    updateConfig({ wordImportOffered: true });
    res.json({ ok: true, active: readJson(activeReport()) });
});

// Drop a pending result without applying it.
router.delete('/pending', authenticate, (req, res) => {
    fs.rmSync(pendingDir(), { recursive: true, force: true });
    res.json({ ok: true });
});

// Back to the standard look: the bundled act and monthly bill.
router.delete('/', authenticate, (req, res) => {
    for (const p of [templatePath(), listTemplatePath(), activeReport()]) if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ ok: true });
});

module.exports = router;
