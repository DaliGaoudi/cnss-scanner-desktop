/*
 * The client's rule for "a 423 means the office moved, re-read the gate".
 * Regression: the gate reload (/api/onboarding/status) is itself answered 423
 * while moved, so signalling on it looped forever on every launch.
 *
 *   set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe test\signal-moved.js
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
    // client/src/config.js is an ES module (client/package.json "type": "module")
    const { shouldSignalMoved, MOVED_EVENT } = await import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'config.js')).href);
    assert.strictEqual(MOVED_EVENT, 'cnss:moved-to-cloud');
    const yes = [['/api/cnss', 423], ['/api/cnss/12?x=1', 423], ['/api/auth/login', 423], ['/api/settings/public', 423],
        ['http://127.0.0.1:3001/api/cnss', 423], ['/api/word-import/pending', 423]];
    const no = [
        ['/api/onboarding/status', 423], ['/api/onboarding/status?t=1', 423], ['http://127.0.0.1:3001/api/onboarding/status', 423],
        ['/api/license/status', 423], ['/api/license/refresh', 423], ['/api/license/activate', 423],
        ['/api/cnss', 200], ['/api/cnss', 401], ['/api/cnss', 500],            // only 423
        ['/assets/index.js', 423], ['/static/x', 423],                                     // not our API
        [undefined, 423], ['', 423],
    ];
    for (const [u, st] of yes) assert.strictEqual(shouldSignalMoved(u, st), true, `should signal: ${u} ${st}`);
    for (const [u, st] of no) assert.strictEqual(shouldSignalMoved(u, st), false, `must not signal: ${u} ${st}`);
    console.log(`  ✓ shouldSignalMoved: ${yes.length} signal, ${no.length} do not\n\n1 passed.`);
})().catch((e) => { console.error('  ✗', e.stack || e.message); process.exit(1); });
