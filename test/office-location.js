/*
 * The office location (city, judicial circuit, CNSS bureau, regional director)
 * and the year used to be hardcoded in template_cnss.docx as Sousse / 2026. They
 * are settings now. Checks: an install that was already set up keeps printing
 * exactly the old wording, a fresh one starts empty, and whatever is saved is
 * what the act prints.
 *
 *   node test/office-location.js      (no database, no network)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PizZip = require('pizzip');

const freshDataDir = (config) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnss-loc-'));
    if (config) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    process.env.CNSS_USERDATA = dir;
    // config.js caches the file it read; give each case a clean module graph.
    Object.keys(require.cache).filter((k) => k.includes(`${path.sep}server${path.sep}`)).forEach((k) => delete require.cache[k]);
    return { config: require('../server/config'), render: require('../server/services/actRender') };
};
const textOf = (buf) => {
    const z = new PizZip(buf);
    return ['word/document.xml', 'word/header1.xml'].map((p) => z.file(p).asText().replace(/<[^>]+>/g, '')).join('\n');
};

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

test('an install that was already set up keeps the Sousse wording it printed before', () => {
    const { config, render } = freshDataDir({ onboardingDone: true, officeName: 'الأستاذ س' });
    const p = config.officeProfile();
    assert.strictEqual(p.officeJurisdiction, 'لمحكمة الإستئناف بسوسة');
    assert.strictEqual(p.cnssBureau, 'بسوسة الكائن بشارع الجمهورية بسوسة');
    assert.strictEqual(p.cnssRegion, 'بسوسة');
    assert.strictEqual(p.officeCity, 'سوسة');
    const t = textOf(render.sampleActBuffer());
    for (const s of ['بالدائرة القضائية لمحكمة الإستئناف بسوسة', 'مكتبه الجهوي بسوسة الكائن بشارع الجمهورية بسوسة.',
        'للشؤون الإجتماعية بسوسة', 'بسوسة']) assert.ok(t.includes(s), 'missing: ' + s);
});
test('a set-up install keeps a city it had already entered', () => {
    const { config } = freshDataDir({ onboardingDone: true, officeCity: 'المنستير' });
    assert.strictEqual(config.officeProfile().officeCity, 'المنستير');
});
test('a fresh install starts with the location empty (filled in onboarding)', () => {
    const { config } = freshDataDir(null);
    const p = config.officeProfile();
    assert.deepStrictEqual([p.officeJurisdiction, p.cnssBureau, p.cnssRegion, p.officeCity], ['', '', '', '']);
});
test('the act prints the saved location — no Sousse left anywhere', () => {
    const { config, render } = freshDataDir({ onboardingDone: true });
    config.updateConfig({
        officeCity: 'صفاقس', officeJurisdiction: 'لمحكمة الإستئناف بصفاقس',
        cnssBureau: 'بصفاقس الكائن بطريق تونس', cnssRegion: 'بصفاقس',
    });
    const t = textOf(render.sampleActBuffer());
    assert.ok(t.includes('العدل المنفذ بصفاقس') || t.includes('بصفاقس'), 'letterhead city');
    assert.ok(t.includes('بالدائرة القضائية لمحكمة الإستئناف بصفاقس'));
    assert.ok(t.includes('مكتبه الجهوي بصفاقس الكائن بطريق تونس.'));
    assert.ok(t.includes('للشؤون الإجتماعية بصفاقس'));
    assert.ok(!t.includes('سوسة'), 'Sousse still printed');
});
test('the year is the current one, in words, not a hardcoded 2026', () => {
    const { render } = freshDataDir({ onboardingDone: true });
    const { yearInArabicWords } = require('../server/services/numberToArabicWords');
    const t = textOf(render.sampleActBuffer());
    assert.ok(t.includes('من سنة ' + yearInArabicWords(new Date().getFullYear())));
    assert.strictEqual(yearInArabicWords(2027), 'سبعة وعشرين وألفين');
});
test('no merge tag is left unfilled', () => {
    const { render } = freshDataDir({ onboardingDone: true });
    assert.deepStrictEqual(textOf(render.sampleActBuffer()).match(/\{[#/]?[a-z_]+\}/g), null);
});

console.log(`\n${passed} passed.`);
