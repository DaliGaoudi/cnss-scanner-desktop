const { activationContext, serverUrl } = require('../license');

/*
 * CNSS extraction — now a thin proxy. The actual AI call (and the OpenRouter
 * key) live on the license server; here we just forward the file bytes with the
 * machine's activation token, so an unlicensed copy can't extract anything.
 *
 * Same signature as before, so routes/cnss.js and routes/ai.js are unchanged.
 *
 * @param {Buffer} buffer   file bytes
 * @param {string} mimetype e.g. 'image/jpeg' or 'application/pdf'
 * @returns {Promise<object>} the extracted fields (nom_cl2, numcnss, numcarte, …)
 */
async function extractCnssFromFile(buffer, mimetype) {
    const { token, fingerprint } = activationContext(); // throws if not activated

    const res = await fetch(`${serverUrl()}/api/ai/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token,
            fingerprint,
            fileBase64: buffer.toString('base64'),
            mime: mimetype,
        }),
    });

    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) {
        // 401/403 → license problem; surface a clear Arabic message.
        throw new Error(d.error || 'تعذّر الاستخراج عبر خادم الترخيص.');
    }
    return d.data;
}

module.exports = { extractCnssFromFile };
