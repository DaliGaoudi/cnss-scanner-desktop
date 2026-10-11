/*
 * Schema for the local SQLite database. Columns are derived from the writable
 * column lists (CNSS_COLS / OEUVRE_COLS) and the server-managed columns in
 * routes/cnss.js. Almost everything is TEXT (the legacy Postgres tables stored
 * these loosely); only the surrogate ids and ref are numeric.
 */
function ensureSchema(conn) {
    conn.exec(`
        CREATE TABLE IF NOT EXISTS cnss (
            id_cn                INTEGER PRIMARY KEY,
            ref                  INTEGER,
            numcnss              TEXT,
            nom_cl2              TEXT,
            cl2_profession       TEXT,
            cin                  TEXT,
            matricule_fiscal     TEXT,
            codeng               TEXT,
            cl2_adresse          TEXT,
            cl2_adresse2         TEXT,
            cl2_avocat           TEXT,
            cl2_tel              TEXT,
            cl2_adressepersonnel TEXT,
            title                TEXT,
            tribunal             TEXT,
            nombre               TEXT,
            date_s               TEXT,
            montant              TEXT,
            status               TEXT,
            notes                TEXT,
            id_user              INTEGER,
            id_so                TEXT,
            date_ajout           TEXT
        );

        CREATE TABLE IF NOT EXISTS cnss_oeuvre (
            id_cn_oe    INTEGER PRIMARY KEY,
            id_cn       INTEGER,
            numcarte    TEXT,
            datecarte   TEXT,
            -- تاريخ تبليغ محضر الإعلام: when the act was delivered/notified. Drives
            -- which month a card appears in on the monthly CNSS billing list.
            date_tabligh TEXT,
            semestre    TEXT,
            dette       TEXT,
            pourcentage TEXT,
            datesins    TEXT,
            nbrreg      TEXT,
            -- Per-act fee breakdown (أتعاب) → the act's footer/fee table.
            fee_post         TEXT,
            fee_stamp        TEXT,
            fee_registration TEXT,
            fee_travel       TEXT,
            fee_aqm          TEXT,
            fee_copies       TEXT,
            fee_movement     TEXT,
            fee_office_copy  TEXT,
            fee_legal_copy   TEXT,
            fee_counterparts TEXT,
            fee_original     TEXT,
            -- VAT (الأداء على القيمة المضافة) rate %, applied to the الأجور subtotal
            -- to derive fee_aqm. Per-card, editable in the fee ledger. Default 19.
            vat_rate         TEXT,
            id_user     INTEGER,
            id_so       TEXT,
            date_ajout  TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_oeuvre_id_cn ON cnss_oeuvre(id_cn);
        CREATE INDEX IF NOT EXISTS idx_cnss_numcnss ON cnss(numcnss);

        -- One row per محضر إعلام بطاقة جبر. A محضر lists one or more cards of one
        -- مطلوب (cnss_oeuvre.id_acte); numero is its per-مطلوب sequence. Rules in
        -- services/cnssActes.js.
        CREATE TABLE IF NOT EXISTS cnss_acte (
            id_acte    INTEGER PRIMARY KEY,
            id_cn      INTEGER,
            id_so      TEXT,
            id_user    INTEGER,
            numero     INTEGER,
            date_ajout TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_acte_id_cn ON cnss_acte(id_cn);
    `);

    // Migrate older databases: add the missing cnss columns.
    //   notes          ملاحظات (internal, never printed)
    //   tabligh_method طريقة التبليغ — فصل 8 / فصل 10 / مباشر, the literal label
    //   resultat       المآل النهائي — free text (same column name as the webapp)
    const cnssCols = new Set(conn.prepare('PRAGMA table_info(cnss)').all().map((c) => c.name));
    for (const col of ['notes', 'tabligh_method', 'resultat']) {
        if (!cnssCols.has(col)) conn.exec(`ALTER TABLE cnss ADD COLUMN ${col} TEXT`);
    }

    // Migrate older databases: add any missing fee columns to cnss_oeuvre.
    const existing = new Set(conn.prepare('PRAGMA table_info(cnss_oeuvre)').all().map((c) => c.name));
    const FEE_COLS = ['fee_post', 'fee_stamp', 'fee_registration', 'fee_travel', 'fee_aqm',
        'fee_copies', 'fee_movement', 'fee_office_copy', 'fee_legal_copy', 'fee_counterparts', 'fee_original',
        'vat_rate', 'date_tabligh'];
    for (const col of FEE_COLS) {
        if (!existing.has(col)) conn.exec(`ALTER TABLE cnss_oeuvre ADD COLUMN ${col} TEXT`);
    }
    // The محضر a card belongs to (cnss_acte.id_acte), NULL while it is in none.
    if (!existing.has('id_acte')) conn.exec('ALTER TABLE cnss_oeuvre ADD COLUMN id_acte INTEGER');
    conn.exec('CREATE INDEX IF NOT EXISTS idx_oeuvre_id_acte ON cnss_oeuvre(id_acte)');
}

module.exports = { ensureSchema };
