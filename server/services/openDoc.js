const fs = require('fs');
const os = require('os');
const path = require('path');

/*
 * Open a generated .docx in the user's default app (Word) the RIGHT way for a
 * desktop app: write it to a real local file and let the OS open it.
 *
 * Why not a browser download? In the packaged Electron app the client runs on
 * http://127.0.0.1, so a blob/`<a download>` save tags the file with the Windows
 * "Mark of the Web" (Internet zone). Word then refuses it ("Word experienced an
 * error trying to open the file" / Protected View block). A file WE write with
 * fs has no such mark, so Word opens it normally.
 *
 * The embedded server runs inside Electron's main process, so it can use
 * `electron.shell`. Outside Electron (dev/tests) shell is null and we just keep
 * the file on disk.
 */
let shell = null;
try { const e = require('electron'); shell = e && e.shell ? e.shell : null; } catch (_) { /* not in Electron */ }

const sanitize = (s) => String(s || 'document').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'document';

async function openDocx(buffer, nameHint) {
    const file = path.join(os.tmpdir(), `cnss_${sanitize(nameHint)}_${Date.now()}.docx`);
    fs.writeFileSync(file, buffer);
    if (shell && shell.openPath) {
        const err = await shell.openPath(file); // '' on success, message on failure
        if (err) throw new Error(err);
        return { opened: true, path: file };
    }
    return { opened: false, path: file };
}

module.exports = { openDocx, canOpen: () => !!(shell && shell.openPath) };
