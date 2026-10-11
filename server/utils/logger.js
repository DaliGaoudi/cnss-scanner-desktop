const fs = require('fs');
const path = require('path');
const { dataDir } = require('../config');

/*
 * Activity logger — stubbed for the single-office build. There is no audit_logs
 * table; instead we append a one-line, best-effort record to activity.log in the
 * user-data dir. Failures are swallowed so logging can never break a request.
 *
 * Signature is identical to the original so routes/cnss.js needs no changes.
 */
async function logActivity(user, action, entity, details) {
    try {
        const line = `${new Date().toISOString()}\t${action}\t${entity}\t${details}\n`;
        fs.appendFile(path.join(dataDir(), 'activity.log'), line, () => {});
    } catch (e) {
        /* never throw from logging */
    }
}

module.exports = { logActivity };
