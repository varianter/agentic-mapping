# Agentic mapping: capture sheets

Capture sheets and an interviewer guide for 15-minute interviews about what people had to learn to work with agents. Plain HTML, CSS and browser JavaScript served by Bun/Hono; no frontend build step.

There are three ways in:

- `/` without signing in: edit models stored in this browser's IndexedDB.
- `/` signed in with the admin key: edit registered interviews stored in Upstash Redis, or a local JSON file in development.
- `/participant#<credential>`: an interviewee finishes their answers through a private link.

`/preview` is a public sandbox that never touches the server.

## Run

```bash
bun install
openssl rand -hex 32   # put ADMIN_KEY=<key> in a private .env file
bun start
```

Open http://localhost:4321. To work on registered interviews, choose **Sign in for registered interviews** and enter the admin key as the password (any username). There is one admin key and no per-user ownership. Startup fails if `ADMIN_KEY` is missing or shorter than 32 characters; there is no default.

Browser Basic authentication stays cached until the browser session closes, so use separate profiles on shared devices.

Data from the earlier SQLite version is not migrated.

### Environment

- `ADMIN_KEY`: secret of at least 32 characters that gates all interview management.
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`: Upstash Redis REST credentials. When both are set, sheets are stored there.
- `LOCAL_STORE_FILE`: JSON file used when no KV variables are set. Defaults to `./data/store.json`. For local development only.
- `PORT`: defaults to `4321`.
- `BIND_ADDRESS`: defaults to `127.0.0.1`. Use a private interface only when the HTTPS proxy runs on another host.
- `APP_ORIGIN`: public origin without a trailing slash, for example `https://mapping.example.com`. Set it behind a reverse proxy so write requests can be checked against the browser's Origin header.

## Secrets

Keep `ADMIN_KEY`, the KV token and any private keys on the server, outside the checkout. Never commit them, put them in browser code, or show them in logs or screenshots. Git ignores `.env*`, `data/`, `secrets/` and common key files, but other filenames still need care. If a real secret is committed, rotate it right away: deleting the file does not remove it from Git history. Test passwords are synthetic.

## Browser models

Without signing in, models are saved in this browser's IndexedDB (**Saved in this browser**) and the interview API is never called. Other profiles, devices and origins cannot see them, and clearing browser data deletes them, so download PDF or JSON backups.

If storage fails, use **Retry storage**. The draft stays editable and **Download PDF** and **Download JSON** still work. A stale tab cannot overwrite newer values or recreate a deleted model.

After you sign in, the app offers to save filled-in browser models to your account. Each one that saves becomes a sheet and is removed from the browser. A model that conflicts with a different version already on the server is skipped and stays in the browser.

## Registered interviews

**Saved to server** means the save is committed. Unsaved server drafts stay in memory only, and closing the tab triggers a leave-page warning. On a network failure, use **Retry storage** or **Download JSON** in the sidebar before closing.

If another device has changed the sheet, automatic saving stops. Download the draft, choose **Reload saved**, and merge the downloaded notes by hand. An unknown sheet URL shows an unavailable state, never another interview.

**Download PDF** opens the browser's A4 landscape print dialog with the current values. Choose **Save as PDF**.

## Private links for interviewees

Open a sheet, choose **Create / replace private link**, then **Copy private link**, and send it privately to the interviewee. The raw link is shown only once, so copy it before closing the dialog. Anyone holding the link, including someone it was forwarded to, can edit the approved answers without signing in.

A link expires seven days after creation. **Revoke private link** ends access sooner, and creating a new link replaces the old one immediately. Only the admin can manage links.

Interviewees can edit the 27 grid answers (`ind`, `team`, `org` × `learn`, `why`, `found` × `start`, `good`, `next`) plus `good`, `surprised`, `missing` and `advice`. Name, date, interviewer, discipline, client/context, follow-up contacts and other fields stay private: participant responses contain only the approved string fields and the revision, and participant saves patch those answers without blanking anything else.

At `/participant`, the interviewee chooses **Save answers** and waits for **Saved to server** before closing. Saved answers survive reload and show up when the interviewer reopens the sheet. Nothing retries or merges automatically:

- After a failure, the input stays in the form. Choose **Save answers** again, or **Download draft** for a private JSON copy.
- Typing during a save means another **Save answers** is needed.
- If newer answers exist, download the draft, choose **Reload saved**, and reconcile by hand. Stale answers never replace newer ones.

A missing, invalid, expired, revoked or replaced link shows **Link unavailable** and never falls back to an interview. An open tab loses access on its next read or save, though revoking cannot recall answers already seen or copied. Unsaved input can still be downloaded. Participant mode never loads the interviewer list or browser database, even in a signed-in interviewer's browser.

### How the credential is handled

The credential sits in the URL fragment (after `#`), so it stays in the address bar for reloads but is never sent in an HTTP URL. Browser history, bookmarks and the clipboard can still keep the link, so share it privately and close the tab afterwards. It is never stored in localStorage or IndexedDB, never included in draft downloads, and never stored in plaintext: requests send it as a bearer header and storage keeps only a SHA-256 hash of the random 256-bit credential. Use placeholders such as `https://mapping.example.com/participant#<credential>` in docs and issue comments.

## Preview

`/preview` is public, so anyone can fill in a sheet for themselves without signing in. Answers autosave to this browser's localStorage (`agentic-mapping-preview`) and are never sent to the server; **Clear preview** empties them. The page loads no interviewer code, and preview answers cannot be saved to a server sheet or downloaded. Requests that fail sign-in show a "Try a preview" link.

## Storage and deploy

### Add Upstash Redis in Vercel

1. In the Vercel project, open **Storage** → **Marketplace**, add **Upstash for Redis** (the successor to Vercel KV) and connect it to the project.
2. Vercel sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Also set `ADMIN_KEY` and `APP_ORIGIN`.
3. The token grants read/write access to every sheet. Keep it in Vercel environment variables only, and rotate it in the Upstash console if it leaks.

Each sheet is one JSON value at `sheet:<id>`. Each private link is `link:<hash>` and expires with the link. A save overwrites the whole sheet after a revision check. The check is not atomic, so two saves to the same sheet at the same instant can overwrite each other; a stale tab still gets a 409. Backups are whatever Upstash provides, so download JSON for your own copies.

### Deploy on Vercel

The app runs as one Vercel Function on the Bun runtime (`api/index.ts`, `vercel.json`) that exports the Hono app. `vercel.json` bundles only the allowlisted public files and every other path returns 404. Server data and the API return 401 without the admin key. Participant pages and assets, `/` in browser-only mode and `/preview` open without a key, and none of them shows server data.

1. Import the GitHub repo in Vercel with no build command and no output directory.
   `vercel.json` sets `"framework": null` on purpose. The Hono preset expects a root file that imports hono, and `server.ts` (the local Bun entry) does not, so the build would fail.
2. Add Upstash Redis as above and make sure `KV_REST_API_URL` and `KV_REST_API_TOKEN` apply to **both Production and Preview**.
3. Set `ADMIN_KEY` for Production and Preview (same value). Set `APP_ORIGIN` to the production HTTPS origin.
4. Startup fails with a `Config error` if `ADMIN_KEY` or, on Vercel, the KV variables are missing.

Each PR gets a preview URL. Previews also accept writes from their own `https://$VERCEL_URL` and `https://$VERCEL_BRANCH_URL` origins.

After the first deploy, check that `/server/app.ts` and `/package.json` return 404.

**Warning: previews use production data.** They share production's storage, so saves, deletes and private links made on a preview change real interviews, and PR code runs against that data. Share preview URLs and the admin key only with people already allowed to see production.

### Local development

Without KV variables, `bun start` writes to `LOCAL_STORE_FILE` (default `./data/store.json`, git-ignored), so notes survive restarts. Do not copy production KV variables into a local `.env`. Tests and browser checks use in-memory or temporary stores and never contact Upstash, even when KV variables are set in the shell.

### Running elsewhere

Any Bun host works with the KV variables or the JSON file.

- Set `APP_ORIGIN` to the public **HTTPS** origin; external HTTP is rejected.
- Keep the Bun listener on loopback behind an HTTPS proxy. Do not trust forwarded headers as proof of TLS.
- Responses send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, plus HSTS when configured for HTTPS. Disable caching at the proxy or CDN too.
- The app logs fixed error messages only. Do not log Authorization headers, request bodies or full private links, and do not run analytics, session replay or error capture that records page URLs or form values on participant pages.
- Rate-limit interviewer sign-in and invalid participant credentials at the proxy.

## Checks and files

```bash
bun test
bun run check                          # syntax-checks the client modules
bunx playwright install chromium       # once; Linux CI also uses --with-deps
bun run test:browser
```

API tests cover persistence, permissions, conflicts and participant links. Browser tests cover browser and server editing, saving browser models to an account, storage failures, conflicts, PDF, preview and private-link handoff. All notes and credentials in the checks are synthetic. No lint or typecheck is configured.

- `server.ts`, `server/app.ts`, `server/config.ts`, `server/store.ts`: authenticated API, config checks, key-value store (Upstash or local JSON) and public-file allowlist.
- `api/index.ts`: Vercel entry.
- `client/app.js`, `client/db.js`, `client/local-db.js`: shared editor and server/browser storage adapters.
- `client/save-local.js`: saves browser models to the signed-in account.
- `client/boot.js`, `client/participant.js`, `client/preview.js`, `client/form.js`: entrypoints, the isolated participant and preview pages, and shared grids/tabs.
- `styles.css`, `index.html`, `guide.html`: capture sheets and guide. Britti Sans comes from `varde.variant.dev`.

The [storage and access decision](docs/storage-decision.md) keeps the hosting comparison and access contract. The [participant implementation map](docs/participant-access.md) records the approved defaults and verification evidence.
