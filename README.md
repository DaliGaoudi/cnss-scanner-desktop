# CNSS Scanner — Desktop

Standalone Windows desktop app that does ONE thing: **scan (or upload) a CNSS
«بطاقة جبر / état de liquidation», AI-extract its fields, auto-create the record,
and generate the Word (.docx) act.**

It bundles three things in one process tree:

1. a carved **Express server** (Node) on a local port,
2. the built **React client** (served by Express, opened in an Electron window),
3. the **scan-watcher bridge** (auto-started as a child process — drives the
   physical scanner on `127.0.0.1:17171`).

Local **SQLite** database (better-sqlite3) — data stays on the office PC, offline
except for the AI extraction call. **Single shared password**, no users table.

## Licensing (machine-locked, per customer)

Each install is locked to one machine by the **license server**
(`../cnss-license-server`, live at https://cnss-license-server.vercel.app):

- On first run the app shows an **activation screen**; the customer enters their
  `CNSS-XXXX-XXXX-XXXX` key. The app binds to this PC (`MachineGuid` fingerprint,
  seat = 1) and stores a signed token in `%APPDATA%/CNSS Scanner/license.json`.
- The token is verified **offline** on every launch with the embedded public key
  (`server/license.js`), and re-validated online ~yearly so a leaked key can be
  revoked.
- **AI extraction no longer uses an embedded key** — the app forwards the scan to
  the server's `/api/ai/extract` proxy with its license token. An unlicensed copy
  can't scan at all. (`pdf-parse`/`openai` were removed from the app.)

The customer can change password / office name / act template in-app (Settings);
the License card there shows their activation status.

## Per-act fees (أتعاب)

Each بطاقة جبر card carries its own fee breakdown (أصل المحضر، النظائر، النسخة
القانونية/المكتبية، التوجه، نسخ الأوراق، أ ق م، التنقل، التسجيل، الترسيم، البريد).
They're entered in the card dialog; **المجموع is auto-summed**. The fee table was
moved out of the page footer into the act body (`scripts/build-template.js`), so
every generated محضر shows its own fees. Editable any time.

## Auto-update (GitHub Releases)

The app uses `electron-updater`: on launch it checks GitHub Releases, downloads a
newer version in the background, and offers to restart-and-install. **One-time
setup before the first auto-updating build:**

1. Create a GitHub repo named `cnss-scanner-desktop` (private is fine).
2. In `package.json` → `build.publish`, replace `REPLACE_GITHUB_OWNER` with your
   GitHub username/org.
3. Create a GitHub **personal access token** with `repo` scope; set it as
   `GH_TOKEN` in your shell.

Then each release:

```bash
# bump "version" in package.json (e.g. 1.0.1), then:
set GH_TOKEN=...        # your token
npm run release         # builds + publishes the installer + latest.yml to GitHub Releases
```

Installed apps (running the previous version) pick it up automatically on next
launch. Note: the **first** auto-updating version must be installed manually —
auto-update only kicks in for versions released *after* it.

## Onboarding & per-customer letterhead

Right after activation (before the password login) the app runs a one-time
**onboarding**: the customer enters their office details — **اسم العدل المنفذ،
العنوان، الهاتف، الفاكس، المعرف الجبائي** (all optional, editable later in
Settings) — and can set the app password, then **previews** the act (in-app mock
+ "فتح في Word"). The bundled `template_cnss.docx` was **de-branded**
(`scripts/debrand-template.js`): the original owner's letterhead is replaced with
`{office_name} {office_address} {office_phone} {office_fax} {office_tax_id}` merge
fields filled from those details. The details are also mirrored to the customer's
row in the license-server `/admin` panel.

---

## Develop

```bash
npm install          # installs Electron + server deps, rebuilds better-sqlite3 for Electron
npm run dev          # vite dev server (5173) + Electron window; Express runs in-process on 3001
```

## Build the Windows installer

```bash
npm run dist         # builds the client, then packages an NSIS .exe into dist/
```

The installer lands in `dist/CNSS Scanner Setup <version>.exe`. Double-click to
install; a desktop + Start-menu shortcut is created.

> **App icon:** drop a `build/icon.ico` (≥256×256) and add
> `"icon": "build/icon.ico"` under `build.win` in `package.json` to brand the
> window + installer. Without it, the default Electron icon is used.

> **Windows build notes (handled automatically):** electron-builder's
> `winCodeSign` helper ships macOS symlinks that a stock Windows account can't
> extract (*"Cannot create symbolic link: A required privilege is not held"*).
> `npm run dist` runs `scripts/prepare-wincodesign.js` first, which pre-seeds that
> cache **without** the macOS files — so the build works with no Developer Mode and
> no admin. (No native compiler is needed either — `better-sqlite3` is fetched as a
> prebuilt binary for Electron.) If you ever still hit the symlink error, enabling
> **Settings → For developers → Developer Mode** once is the manual fallback.

## Verify (no GUI / scanner needed)

Run under Electron's Node so the `better-sqlite3` prebuilt matches the ABI:

```bash
set ELECTRON_RUN_AS_NODE=1

# Offline: login, create company + card, debt sum, .docx, and the Settings page
node_modules\electron\dist\electron.exe test\smoke.js

# Licensed scan path (mints a throwaway license on the live server, activates
# this machine, scans, generates the .docx, then revokes the test license):
node_modules\electron\dist\electron.exe test\license-e2e.js "path\to\carte_jabr.jpg"
```

## Configuration (single, rotatable values)

On first run the app writes `config.json` into the per-user data dir
(`%APPDATA%/CNSS Scanner/`), seeded from the embedded defaults:

| Key                | Meaning                                   | Rotate by …                                  |
| ------------------ | ----------------------------------------- | -------------------------------------------- |
| `openrouterApiKey` | embedded OpenRouter key for AI extraction | editing the value in `config.json`           |
| `passwordHash`     | bcrypt hash of the shared password        | `npm run set-password -- <newPassword>`      |
| `jwtSecret`        | local token secret                        | editing `config.json`                        |

Default password: **`cnss2026`** (change it after install).

The SQLite database lives next to it at `%APPDATA%/CNSS Scanner/cnss.db`, so
reinstalling or updating the app never touches the data.

## Customer customization (in-app Settings ⚙️)

Each customer self-serves these from the **Settings** page (gear icon, top bar) —
no rebuild, no config-file editing, effective immediately:

- **Office name** — shown on the login screen and the top bar (app branding only;
  it is *not* injected into the generated document — that identity comes from the
  template they upload).
- **Password** — change the shared password (requires the current one).
- **Act template** — download the correctly-tagged sample, edit its letterhead /
  layout while keeping the merge tags (`{nom_matloub}`, `{num_carte}`,
  `{#acts}…{/acts}`, …), then upload it. Uploads are validated (a malformed
  template is rejected with a reason) and stored at
  `%APPDATA%/CNSS Scanner/template_cnss.docx`. "Reset to default" reverts to the
  bundled template.

## How the office uses it

1. Open the app, enter the shared password.
2. Click **«مسح بطاقة جبر»** (drives the scanner) or **«رفع بطاقة جبر»** (upload a
   photo/PDF).
3. The AI extracts the fields and the record is auto-created — you land on the
   record for review.
4. Click **توليد المحضر** to download the `.docx` act.

## Project layout

```
electron/main.js   Express (in-process) + scan-bridge (child) + BrowserWindow
server/            carved API: auth (single password), cnss routes, ai extract,
                   better-sqlite3 db, docx template
client/            Vite React UI (login → /cnss list → /cnss/:id detail → /cnss/new)
scan-watcher/      local scanner bridge (auto-started), copied to resources/ on build
```
