const express = require('express');
const router = express.Router();
const multer = require('multer');
const authenticate = require('../middleware/auth');
const { extractCnssFromFile } = require('../services/cnssExtract');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/*
 * Prefill-only extraction used by the record detail page's "مسح ذكي لحالة
 * التصفية" button. Unlike /cnss/scan it does NOT create a record — it just
 * returns the extracted fields so the form can be pre-filled for review.
 */
router.post('/extract-cnss', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Aucun fichier reçu.' });
        const data = await extractCnssFromFile(req.file.buffer, req.file.mimetype);
        res.json({ success: true, data });
    } catch (err) {
        console.error('ai/extract-cnss error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
