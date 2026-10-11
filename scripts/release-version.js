/*
 * Pick the version to publish — collision-proof. Asks GitHub for the highest
 * published release and:
 *   - if package.json is already AHEAD of it, keep package.json (honours a manual bump);
 *   - otherwise bump the published max by one patch.
 * Then writes package.json. Run as the first step of `npm run release` so a
 * release can never clash with an existing tag, no matter the local version.
 *
 * Public repo → unauthenticated API works; uses GH_TOKEN if present (higher rate
 * limit). On network failure it falls back to bumping the local patch.
 */
const fs = require('fs');
const path = require('path');

const PKG = path.join(__dirname, '..', 'package.json');

const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
    return m ? [+m[1], +m[2], +m[3]] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const fmt = (a) => a.join('.');
const bumpPatch = (a) => [a[0], a[1], a[2] + 1];

async function highestPublished(owner, repo) {
    const headers = { 'User-Agent': 'cnss-release', Accept: 'application/vnd.github+json' };
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const tags = (await res.json()).map((r) => parse(r.tag_name)).filter(Boolean);
    if (!tags.length) return null;
    return tags.sort(cmp)[tags.length - 1];
}

(async () => {
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
    const local = parse(pkg.version) || [1, 0, 0];
    const pub = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};

    let next;
    try {
        const top = await highestPublished(pub.owner, pub.repo);
        // Ahead of everything published → publish as-is; else next patch after published max.
        next = top && cmp(local, top) <= 0 ? bumpPatch(top) : local;
    } catch (e) {
        console.warn(`[release-version] could not reach GitHub (${e.message}); bumping local patch.`);
        next = bumpPatch(local);
    }

    if (fmt(next) !== pkg.version) {
        pkg.version = fmt(next);
        fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
        console.log(`[release-version] version → ${pkg.version}`);
    } else {
        console.log(`[release-version] version stays ${pkg.version}`);
    }
})();
