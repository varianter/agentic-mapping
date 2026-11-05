# Agentic mapping: capture sheets

Capture sheets and an interviewer guide in plain HTML, CSS and browser JavaScript. At `/`, anonymous visitors edit complete models saved in IndexedDB in their browser; the admin edits registered interviews saved to Upstash Redis (or a local JSON file in development) through Bun/Hono using the admin key. No frontend build step.

## Run

```bash
bun install
# Generate a secret admin key (at least 32 characters) and put ADMIN_KEY=<key> in a private .env file, then:
openssl rand -hex 32
bun start
```

Open http://localhost:4321 to edit a model without signing in. Choose **Sign in for registered interviews** and enter the admin key as the password (any username); sign-in returns to `/`. There is one admin key and no per-user ownership; no default key is provided, and startup fails if `ADMIN_KEY` is missing or shorter than 32 characters. Data from the earlier SQLite version is not migrated: download old sheets as JSON first and import them. Browser Basic authentication stays cached until the browser session is closed; use separate profiles on shared devices.

- `ADMIN_KEY`: secret of at least 32 characters that gates all interview management. Keep it server-side.
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`: Upstash Redis REST credentials. When both are set, sheets are stored there. Keep the token secret.
- `LOCAL_STORE_FILE`: JSON file used when no KV variables are set, defaults to `./data/store.json`. Notes survive restarts; use it for local development only.
- `PORT`: defaults to `4321`.
- `BIND_ADDRESS`: defaults to `127.0.0.1`; keep the Bun listener private behind the HTTPS proxy. Use a private interface only when the proxy runs separately.
- `APP_ORIGIN`: public origin, for example `https://mapping.example.com` (no trailing slash); set it behind a reverse proxy so write requests can be checked against the browser’s Origin header.

Keep the production admin key, tokens and private keys outside the checkout; never commit them or put them in browser code. Git ignores `.env*`, `data/`, `secrets/`, and common key files as a safeguard; arbitrary filenames still require care. Test passwords are synthetic and are never deployment credentials. If a real secret is ever committed, revoke/rotate it immediately; deleting the file does not remove it from Git history.

## Anonymous browser models

Without signing in, models are saved in this browser's IndexedDB (**Saved in this browser**) and no interview API is called. Other profiles, devices and origins cannot see them. Clearing browser data removes them, so download PDF/JSON backups.

If storage fails, use **Retry storage**. The draft stays editable, and **Download PDF** and **Download JSON** still work. A stale tab cannot overwrite newer values or recreate a deleted model.

## Existing notes and recovery

There is no browser-note migration: the earlier IndexedDB storage was never used. Signed-in notes live on the server; anonymous models stay in this browser's IndexedDB. If a sheet is unavailable, use **Download JSON** to keep your draft and create a new sheet.

**Saved to server** means a committed save. On a network failure, use **Retry storage** or **Download JSON** in the sidebar before closing the tab. Unsaved server drafts stay in memory and trigger a leave-page warning; they are not stored in IndexedDB. If another device has changed the sheet, automatic saving stops: download the draft, choose **Reload saved**, and manually merge the downloaded notes. Unknown sheet URLs show an unavailable state rather than another interview.

**Download PDF** opens the browser’s A4 landscape print dialog with the current form values. Choose **Save as PDF**.

## Finish an interview through a private link

Open a sheet and choose **Create / replace private link**, then **Copy private link**. Send it privately to the interviewee. Anyone holding or receiving a forwarded link can edit its approved answers without signing in. The link expires seven days after creation; **Revoke private link** ends access sooner, and creating another link immediately replaces the old one. Only the admin can manage access. The raw link is shown only during creation; copy it before closing the dialog.

Interviewees can edit all 27 grid answers (`ind`, `team`, `org` × `learn`, `why`, `found` × `start`, `good`, `next`) and `good`, `surprised`, `missing`, `advice`. Name, date, interviewer, discipline, client/context, follow-up contacts and other stored fields remain private. Participant responses contain only approved string fields and the revision. Participant saves patch these answers without blanking private fields.

At `/participant`, choose **Save answers** to save, then wait for **Saved to server** before closing. Saved answers survive reload and appear when the interviewer reopens the sheet. After a failure, the input stays in the form; explicitly choose **Save answers** to retry or **Download draft** for a private JSON recovery copy. Typing during an in-flight save requires a second explicit save. If newer answers exist, download the draft, choose **Reload saved**, and manually reconcile; stale answers never replace newer ones. No automatic retries or merging occur.

**Preview.** `/preview` is public: anyone can fill in a sheet for themselves without signing in. Answers autosave only to this browser's localStorage (`agentic-mapping-preview`) and are never sent to the server; **Clear preview** empties them. It loads no interviewer code and cannot be saved to a server sheet or downloaded. Page requests that fail sign-in show a "Try a preview" link.

Missing, invalid, expired, revoked or replaced links show **Link unavailable**, with no interview fallback. An already-open tab loses server access on its next read/save; revocation cannot recall answers already seen or copied. Unsaved input can still be downloaded after denial. Participant mode never loads the interviewer list or browser database, even in a signed-in interviewer's browser.

The credential travels in the private link's URL fragment (the part after `#`), which stays in the address bar for reloads. Browser history, bookmarks and clipboard can therefore retain the intentionally delivered link: share it privately and close the tab after use. It is never sent in an HTTP URL, stored in localStorage/IndexedDB, included in draft downloads or written to storage as plaintext. Authentication uses a bearer header; storage keeps only a SHA-256 hash of a random 256-bit credential. Share only placeholders such as `https://mapping.example.com/participant#<credential>` in documentation or issue comments.

## Storage and deploy

### Add Upstash Redis in Vercel

1. In the Vercel project, open **Storage** → **Marketplace** and add **Upstash for Redis** (the successor to Vercel KV). Connect it to the project.
2. Vercel sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` for the project. Also set `ADMIN_KEY` and `APP_ORIGIN`.
3. The token grants full read/write access to every sheet. Keep it in Vercel environment variables only: never commit it, put it in browser code, logs or screenshots, and rotate it in the Upstash console if it leaks.

Each sheet is one JSON value at `sheet:<id>`; each private link is `link:<hash>` and expires with the link. Every save overwrites the whole sheet after a revision check. The check is not atomic, so two people saving the same sheet at the same instant could overwrite each other; stale tabs still get a 409. Backups are whatever Upstash provides; download JSON for your own copies.

### Deploy on Vercel

The app runs as one Vercel Function on the Bun runtime (`api/index.ts`, `vercel.json`) that exports the Hono app. `vercel.json` bundles only the allowlisted public files; every other path returns 404 and server data and the API need the admin key (401 otherwise). Participant pages/assets, `/` (local-only mode) and `/preview` open without a key; none of them shows server data.

1. Import the GitHub repo in Vercel (no build command, no output directory).
2. Add Upstash Redis as above and make sure `KV_REST_API_URL` and `KV_REST_API_TOKEN` apply to **both Production and Preview**.
3. Set `ADMIN_KEY` for Production and Preview (same value). Set `APP_ORIGIN` to the production HTTPS origin.
4. Startup fails with a `Config error` if `ADMIN_KEY` or, on Vercel, the KV variables are missing.

Each PR gets a preview URL. Previews additionally accept writes from their own `https://$VERCEL_URL` and `https://$VERCEL_BRANCH_URL` origins.

After the first deploy, check that `/server/app.ts` and `/package.json` return 404 on the deployment.

**Warning: previews use production data.** They share production's storage, so saves, deletes and private links made on a preview change real interviews. PR code runs against that data; only share preview URLs and the admin key with people already allowed to see production.

### Local development

Without KV variables, `bun start` writes to `LOCAL_STORE_FILE` (default `./data/store.json`, git-ignored) and keeps notes across restarts. Do not copy production KV variables into a local `.env`. Tests and browser checks use in-memory or temporary stores only and never contact Upstash, even when KV variables are set in the shell.

### Running elsewhere

Any Bun host works with the KV variables or the JSON file. Set `APP_ORIGIN` to the public **HTTPS** origin (external HTTP is rejected) and keep the Bun listener on loopback behind an HTTPS proxy; do not rely on forwarded headers as proof of TLS. Responses send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; HTTPS configuration also sends HSTS. Disable caching at the proxy/CDN. Do not log Authorization headers, bodies or full private links, and do not enable analytics, session replay or error capture of page URLs/form values on participant pages. The app logs fixed error messages only. Rate-limit interviewer sign-in and invalid participant credentials at the proxy. Never commit `ADMIN_KEY` or the KV token; supply them only to the server runtime. The server serves only allowlisted public files.

## Checks and files

```bash
bun test
bun run check
bunx playwright install chromium       # once; Linux CI also uses --with-deps
bun run test:browser
```

API tests cover persistence, permissions, conflicts, imports and participant links. Browser tests cover local and server editing, storage failures, conflicts, PDF, private-link handoff and migration; all notes and credentials used in checks are synthetic. No lint or typecheck is configured.

- `server.ts`, `server/app.ts`, `server/store.ts`: authenticated API, key-value store (Upstash or local JSON) and public-file allowlist.
- `client/app.js`, `client/db.js`, `client/local-db.js`: shared editor and server/browser storage adapters.
- `client/boot.js`, `client/participant.js`, `client/form.js`: isolated participant entrypoint and shared grids/tabs.
- `client/legacy.js`, `legacy.html`: browser-data export and JSON recovery.
- `styles.css`, `index.html`, `guide.html`: capture sheets and guide; Britti Sans comes from `varde.variant.dev`.

The [storage and access decision](docs/storage-decision.md) retains the hosting comparison and access contract. The [participant implementation map](docs/participant-access.md) records the approved defaults and verification evidence.
