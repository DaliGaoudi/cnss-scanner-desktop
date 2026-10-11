/*
 * Grouping بطاقات جبر into محاضر.
 *
 * A «محضر إعلام بطاقة جبر» can notify several cards of the same مطلوب at once —
 * the act's card table gets one row per card. The office picks which cards go
 * together, under three rules:
 *
 *   1. A card belongs to at most one محضر. Enforced structurally: the link is a
 *      single column, cnss_oeuvre.id_acte. Putting a card that is already in a
 *      محضر into a new one MOVES it (after the user confirms the warning).
 *   2. The cards of one محضر share عدد التضمين and تاريخ التبليغ — both are printed
 *      or recorded once per محضر. A selection that disagrees is refused, and
 *      editing either field on a grouped card applies it to the whole محضر.
 *   3. تاريخ بطاقة الجبر is printed once too, but may legitimately differ: the user
 *      is warned and the distinct dates are joined.
 *
 *   cnss_acte    = one row per محضر: numero is its per-مطلوب sequence («محضر 2»).
 *
 * Ported from the webapp (modern_app/server/services/cnssActes.js): the pure rules
 * are identical; only the persistence is SQLite (the table is in schema.js).
 */
const db = require('../db');
const { AJR_KEYS, EXP_KEYS, toMillimes, formatMillimes, computeFees } = require('./cnssFees');

// ───────────────────────────── Pure rules ─────────────────────────────

// تاريخ التبليغ is stored as YYYY-MM-DD by the date picker but DD/MM/YYYY by older
// rows; compare the day, not the spelling.
const normDate = (s) => {
    s = String(s || '').trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
};
const normText = (s) => String(s == null ? '' : s).trim();

const distinct = (cards, key, norm) => {
    const seen = new Map();
    cards.forEach((c) => { const k = norm(c[key]); if (!seen.has(k)) seen.set(k, normText(c[key])); });
    return [...seen.values()];
};

// The fields every card of a محضر must agree on. Blank counts as a value: a
// card with no تاريخ التبليغ cannot share a محضر with one that has been served.
const SHARED_FIELDS = [
    { key: 'nbrreg', label: 'عدد التضمين', norm: normText },
    { key: 'date_tabligh', label: 'تاريخ التبليغ', norm: normDate },
];

/*
 * Check a selection of cards (all of one مطلوب) before it becomes a محضر.
 *
 *   cards       the selected card rows
 *   acteCards   every card of the مطلوب that is already in a محضر, so a conflict
 *               can say what the old محضر keeps
 *   actesById   cnss_acte rows by id_acte
 *
 * Returns { mismatches, conflicts, dateCarteValues, reprintActeId }:
 *   mismatches      — rule 2 violations; these block generation outright
 *   conflicts       — rule 1: cards that would leave an existing محضر
 *   dateCarteValues — rule 3: >1 entry means the user must be warned
 *   reprintActeId   — the selection is exactly one existing محضر: reprint it, no
 *                     new محضر and nothing to warn about
 */
const checkGrouping = (cards, acteCards, actesById) => {
    const mismatches = SHARED_FIELDS
        .map((f) => ({ field: f.key, label: f.label, values: distinct(cards, f.key, f.norm) }))
        .filter((m) => m.values.length > 1);

    const dateCarteValues = distinct(cards, 'datecarte', normText).filter(Boolean);

    // A card pointing at a محضر that no longer exists is simply free.
    const grouped = cards.filter((c) => c.id_acte != null && actesById[c.id_acte]);
    const acteIds = [...new Set(grouped.map((c) => c.id_acte))];

    if (acteIds.length === 1 && grouped.length === cards.length) {
        const members = acteCards.filter((c) => c.id_acte === acteIds[0]);
        if (members.length === cards.length) {
            return { mismatches: [], conflicts: [], dateCarteValues: [], reprintActeId: acteIds[0] };
        }
    }

    const conflicts = acteIds.map((idActe) => {
        const acte = actesById[idActe];
        const members = acteCards.filter((c) => c.id_acte === idActe);
        const moving = grouped.filter((c) => c.id_acte === idActe);
        return {
            id_acte: idActe,
            numero: acte.numero,
            date_ajout: acte.date_ajout,
            moving: moving.map((c) => c.numcarte || `#${c.id_cn_oe}`),
            remaining: members.length - moving.length,
        };
    });

    return { mismatches, conflicts, dateCarteValues, reprintActeId: null };
};

// Values printed once per محضر, joined when the cards differ (rule 3).
const joinDistinct = (cards, key, sep) => distinct(cards, key, normText).filter(Boolean).join(sep);

/*
 * Map a company + the cards of one محضر onto the template's tags.
 *
 * `cards` loops over the act's card-table rows; the fee table holds the SUM of the
 * cards' own fee statements (each card keeps its fees, which is also how the
 * monthly CNSS list bills them). The act-level num_carte/trimestre/… duplicates
 * keep a template without the {#cards} row loop — e.g. a customer-uploaded one —
 * rendering something sensible.
 */
const buildActRecord = (company, cardOrCards) => {
    const cards = Array.isArray(cardOrCards) ? cardOrCards : [cardOrCards];

    const fees = {};
    [...AJR_KEYS, ...EXP_KEYS].forEach((k) => {
        fees[k] = formatMillimes(cards.reduce((s, c) => s + toMillimes(c[k]), 0));
    });
    const sums = cards.map(computeFees).reduce(
        (a, f) => ({ ajr: a.ajr + f.ajr, exp: a.exp + f.exp, vat: a.vat + f.vat, total: a.total + f.total }),
        { ajr: 0, exp: 0, vat: 0, total: 0 });
    const rates = [...new Set(cards.map((c) => computeFees(c).rate))];
    fees.fee_aqm = formatMillimes(sums.vat);         // أ ق م = Σ per-card VAT
    fees.vat_rate = rates.join(' / ');
    fees.fee_ajr_total = formatMillimes(sums.ajr);
    fees.fee_exp_total = formatMillimes(sums.exp);
    fees.fee_total = formatMillimes(sums.total);

    const rows = cards.map((c) => ({
        num_carte: c.numcarte || '',
        trimestre: c.semestre || '',
        montant: c.dette || '',
        date_penalite: c.datesins || '',
    }));
    const col = (k) => rows.map((r) => r[k]).filter(Boolean).join(' - ');

    return {
        num_dossier: joinDistinct(cards, 'nbrreg', ' - '),
        code_inscription: company.codeng || '',
        num_affiliation: company.numcnss || '',
        nom_matloub: company.nom_cl2 || '',
        adresse: [company.cl2_adresse, company.cl2_adresse2].filter(Boolean).join(' '),
        date_carte: joinDistinct(cards, 'datecarte', ' و '),
        cards: rows,
        num_carte: col('num_carte'),
        trimestre: col('trimestre'),
        montant: col('montant'),
        date_penalite: col('date_penalite'),
        ...fees,
    };
};

// ───────────────────────────── Persistence ─────────────────────────────

const loadActes = async (id_cn, id_so) => {
    const rows = await db.all(
        `SELECT * FROM cnss_acte WHERE id_cn = ? AND id_so = ? ORDER BY numero ASC, id_acte ASC`, [id_cn, id_so]);
    return Object.fromEntries(rows.map((r) => [r.id_acte, r]));
};

const createActe = async (id_cn, user) => {
    const n = await db.get(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cnss_acte WHERE id_cn = ? AND id_so = ?`,
        [id_cn, user.id_so]);
    return db.get(
        `INSERT INTO cnss_acte (id_cn, id_so, id_user, numero, date_ajout) VALUES (?, ?, ?, ?, ?) RETURNING *`,
        [id_cn, user.id_so, user.id, n.n, new Date().toLocaleString('fr-FR')]);
};

const assignCards = (id_acte, cardIds, id_so) => {
    if (!cardIds.length) return { changes: 0 };
    return db.run(
        `UPDATE cnss_oeuvre SET id_acte = ? WHERE id_cn_oe IN (${cardIds.map(() => '?').join(',')}) AND id_so = ?`,
        [id_acte, ...cardIds, id_so]);
};

// A محضر whose last card moved away or was deleted no longer exists.
const pruneEmptyActes = (id_cn, id_so) => db.run(
    `DELETE FROM cnss_acte WHERE id_cn = ? AND id_so = ?
       AND NOT EXISTS (SELECT 1 FROM cnss_oeuvre o
                       WHERE o.id_acte = cnss_acte.id_acte AND o.id_so = cnss_acte.id_so)`,
    [id_cn, id_so]);

module.exports = {
    checkGrouping, buildActRecord, normDate, SHARED_FIELDS,
    loadActes, createActe, assignCards, pruneEmptyActes,
};
