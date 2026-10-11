const Database = require('better-sqlite3');
const { dbPath } = require('./config');
const { ensureSchema } = require('./schema');

/*
 * Database abstraction over better-sqlite3.
 *
 * Keeps the SAME signatures the routes already use (Postgres-style db.all /
 * db.get / db.run with `?` placeholders) so routes/cnss.js needs no changes.
 * SQLite uses `?` natively, so — unlike the old Postgres db.js — we do NOT
 * rewrite `?` into `$n`.
 *
 * better-sqlite3 is synchronous; the routes `await` these calls, and awaiting a
 * plain value is harmless, so async/await in the routes keeps working.
 */
let conn = null;
function getConn() {
    if (!conn) {
        conn = new Database(dbPath());
        conn.pragma('journal_mode = WAL');
        ensureSchema(conn);
    }
    return conn;
}

// better-sqlite3 rejects `undefined` and booleans as bound values.
const norm = (params = []) =>
    (Array.isArray(params) ? params : [params]).map(v =>
        v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : v));

const db = {
    all: (sql, params = []) => getConn().prepare(sql).all(...norm(params)),

    get: (sql, params = []) => getConn().prepare(sql).get(...norm(params)),

    run: (sql, params = []) => {
        const stmt = getConn().prepare(sql);
        // A statement that returns rows (e.g. INSERT ... RETURNING) must use
        // all()/get(); calling run() on it throws. Guard for that case.
        if (stmt.reader) {
            const rows = stmt.all(...norm(params));
            return { lastID: rows[0] ? (rows[0].id_cn ?? rows[0].id_cn_oe ?? null) : null, changes: rows.length };
        }
        const info = stmt.run(...norm(params));
        return {
            lastID: info.lastInsertRowid != null ? Number(info.lastInsertRowid) : null,
            changes: info.changes,
        };
    },
};

// Flush the WAL into cnss.db and close, so the file can be moved (leaving a
// licence backs it up). The next call reopens — and re-creates — the database.
function close() {
    if (!conn) return;
    try { conn.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* closing anyway */ }
    conn.close();
    conn = null;
}

module.exports = db;
module.exports.getConn = getConn;
module.exports.close = close;
