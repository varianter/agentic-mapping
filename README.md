# Agentic mapping: capture sheets

Capture sheets and an interviewer guide in plain HTML, CSS and browser JavaScript. At `/`, anonymous visitors edit complete models saved in IndexedDB in their browser; signed-in interviewers edit private registered interviews saved to SQLite through Bun/Hono. No frontend build step.

## Run

```bash
bun install
# Generate a password hash; the password is prompted without echoing.
read -rs -p 'Interviewer password: ' MAPPING_PASSWORD
export MAPPING_PASSWORD
mkdir -p data && chmod 700 data
bun -e 'await Bun.write("data/interviewers.json", JSON.stringify({interviewer: await Bun.password.hash(process.env.MAPPING_PASSWORD)}))'
unset MAPPING_PASSWORD
# Put INTERVIEWER_USERS_FILE=./data/interviewers.json in a private .env file, then:
bun start
```

Open http://localhost:4321 to edit a model without signing in. Choose **Sign in for registered interviews** and enter the configured username/password; sign-in returns to `/`. Keep usernames stable: they identify sheet owners. No default account is provided; startup fails without valid configuration. Browser Basic authentication stays cached until the browser session is closed; use separate profiles on shared devices.

- `INTERVIEWER_USERS_FILE`: path to a private JSON object of usernames and Argon2id password hashes. Keep it server-side; use a JSON file because Bun expands dollar signs in `.env` values, including password hashes.
- `DATABASE_PATH`: SQLite file, defaults to `./data/sheets.sqlite`; production must use an absolute path on a durable disk outside the checkout.
- `PORT`: defaults to `4321`.
- `BIND_ADDRESS`: defaults to `127.0.0.1`; keep the Bun listener private behind the HTTPS proxy. Use a private interface only when the proxy runs separately.
- `APP_ORIGIN`: public origin, for example `https://mapping.example.com` (no trailing slash); set it behind a reverse proxy so write requests can be checked against the browser’s Origin header.

Keep production account files, passwords, tokens and private keys outside the checkout; never commit them or put them in browser code. Git ignores `.env*`, `data/`, `secrets/`, `interviewers.json` and common key files as a safeguard; arbitrary filenames still require care. Test passwords are synthetic and are never deployment credentials. If a real secret is ever committed, revoke/rotate it immediately; deleting the file does not remove it from Git history.

## Anonymous browser models

Without signing in, models are saved in this browser's IndexedDB (**Saved in this browser**) and no interview API is called. Other profiles, devices and origins cannot see them. Clearing browser data removes them, so download PDF/JSON backups.

If storage fails, use **Retry storage**. The draft stays editable, and **Download PDF** and **Download JSON** still work. A stale tab cannot overwrite newer values or recreate a deleted model.

## Existing notes and recovery

Export each browser’s existing IndexedDB notes from the **old origin**, then sign in and select **Import JSON** in server mode. The GitHub Pages workflow now publishes only the [legacy exporter](legacy.html); it leaves browser data untouched and never uploads it. The same exporter is available on the server for notes previously saved on that origin. Repeat on each browser/device that holds notes.

Imports preserve IDs, fields and timestamps and assign ownership to the signed-in interviewer. Identical retries are safe; conflicting IDs stop import without overwriting anything. A partial import reports its count; keep the export, resolve collisions and retry. Verify the imported notes before removing any originals or private JSON files.

**Saved to server** means a committed save. On a network failure, use **Retry storage** or **Download JSON** in the sidebar before closing the tab. Unsaved server drafts stay in memory and trigger a leave-page warning; they are not stored in IndexedDB. If another device has changed the sheet, automatic saving stops: download the draft, choose **Reload saved**, and manually merge the downloaded notes. Unknown sheet URLs show an unavailable state rather than another interview.

**Download PDF** opens the browser’s A4 landscape print dialog with the current form values. Choose **Save as PDF**.

## Finish an interview through a private link

Open a sheet and choose **Create / replace private link**, then **Copy private link**. Send it privately to the interviewee. Anyone holding or receiving a forwarded link can edit its approved answers without signing in. The link expires seven days after creation; **Revoke private link** ends access sooner, and creating another link immediately replaces the old one. Only the sheet's owner can manage access. The raw link is shown only during creation; copy it before closing the dialog.

Interviewees can edit all 27 grid answers (`ind`, `team`, `org` × `learn`, `why`, `found` × `start`, `good`, `next`) and `good`, `surprised`, `missing`, `advice`. Name, date, interviewer, discipline, client/context, follow-up contacts and other stored fields remain private. Participant responses contain only approved string fields and the revision. Participant saves patch these answers without blanking private fields.

At `/participant`, choose **Save answers** to save, then wait for **Saved to server** before closing. Saved answers survive reload and appear when the interviewer reopens the sheet. After a failure, the input stays in the form; explicitly choose **Save answers** to retry or **Download draft** for a private JSON recovery copy. Typing during an in-flight save requires a second explicit save. If newer answers exist, download the draft, choose **Reload saved**, and manually reconcile; stale answers never replace newer ones. No automatic retries or merging occur.

**Preview.** `/preview` is public: anyone can fill in a sheet for themselves without signing in. Answers autosave only to this browser's localStorage (`agentic-mapping-preview`) and are never sent to the server; **Clear preview** empties them. It loads no interviewer code and cannot be saved to a server sheet or downloaded. Page requests that fail sign-in show a "Try a preview" link.

Missing, invalid, expired, revoked or replaced links show **Link unavailable**, with no interview fallback. An already-open tab loses server access on its next read/save; revocation cannot recall answers already seen or copied. Unsaved input can still be downloaded after denial. Participant mode never loads the interviewer list or browser database, even in a signed-in interviewer's browser.

The credential travels in the private link's URL fragment (the part after `#`), which stays in the address bar for reloads. Browser history, bookmarks and clipboard can therefore retain the intentionally delivered link: share it privately and close the tab after use. It is never sent in an HTTP URL, stored in localStorage/IndexedDB, included in draft downloads or written to the database as plaintext. Authentication uses a bearer header; SQLite stores only a SHA-256 hash of a random 256-bit credential. Share only placeholders such as `https://mapping.example.com/participant#<credential>` in documentation or issue comments.

## Deploy and back up

### GitHub Pages and the storage host

The working app moves to the Bun host's HTTPS address; GitHub Pages keeps only the old-browser export page. Pages does not store shared sheets or forward saves to the Bun host. Export existing notes on Pages, then open the Bun app and use **Import JSON** to upload them to your account.

At the Bun address, the browser sends authenticated `POST` (create/import), `PUT` (autosave) and `DELETE` requests to that same host's `/api/sheets` endpoints. The running Bun process checks ownership and revisions and writes to the SQLite file at `DATABASE_PATH` before acknowledging success. Another device reads those saved sheets from the same API using the same interviewer account; it sees updates when loading or reloading a sheet, without live synchronization.

The [Pages workflow](.github/workflows/pages.yml) updates only the static exporter after a push to `main` or a manual workflow run. It does not deploy the Bun app or update its database. The operator must deploy code updates to the Bun host separately and restart the service with the same durable `DATABASE_PATH`; sheet edits reach storage through the API without a commit, workflow run or redeployment. This PR does not provision a host or configure automatic Bun deployments.

### Bun deployment and backups

Run one Bun instance behind an HTTPS reverse proxy with process supervision, a durable SQLite volume, a private environment file and named interviewer accounts. Preserve the public Host header and set `APP_ORIGIN`. Bind/firewall the Bun port so remote access goes through HTTPS; Basic authentication must never cross a public HTTP connection. Rate-limit authentication attempts at the proxy. Back up before upgrades; there is no automatic host provisioning in this repository.

Set `APP_ORIGIN` to the public **HTTPS** origin; external HTTP configuration is rejected. The Bun listener binds to loopback by default. The proxy must terminate HTTPS and keep the backend inaccessible publicly; do not rely on forwarded headers as proof of TLS. Responses, including errors and app assets, send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; HTTPS configuration also sends HSTS. Disable caching at the proxy/CDN. Do not log Authorization headers, request/response bodies or full private links, and do not enable analytics, session replay or error capture of page URLs/form values on participant pages. The app logs fixed error messages only. Rate-limit invalid participant credentials at the proxy as well as interviewer sign-in.

No new deployment secret is required for participant links. Keep `INTERVIEWER_USERS_FILE` and `DATABASE_PATH` private and outside the checkout/public artifacts. If deployment automation needs credentials, an authorized operator must enter values directly in GitHub repository/environment **Secrets** (for example names `MAPPING_DEPLOY_KEY` and `MAPPING_INTERVIEWER_USERS_JSON`); documentation and workflow configuration may contain names only. Supply values only to the server runtime/private account file, never Pages, browser assets, committed `.env` files, logs or screenshots. This change does not provision Secrets or add a deployment workflow.

The additive `participant_links` table is created on startup without changing existing sheets. Take a backup before upgrading. Before restoring any database backup, stop access and invalidate restored participant links (`DELETE FROM participant_links` on the private database) before reopening the host, because a backup can resurrect revoked credentials. Test the HTTPS host with two separate browser profiles and confirm whether seven days is a suitable completion window in a handoff trial.

GitHub Pages cannot run this API and now serves only migration/export. Deploy this checkout on the selected Bun host, run `bun install --frozen-lockfile --production`, configure the environment above and start `bun start`. The server serves only allowlisted public files, never source, credentials, databases or backups. Restart/redeploy with the same `DATABASE_PATH` to retain notes. Do not run independent replicas or place the database on an ephemeral disk.

```bash
# Take a consistent online snapshot (destination must not already exist).
DATABASE_PATH=/srv/mapping/sheets.sqlite bun run backup /private/backups/mapping-2026-11-04.sqlite
```

Schedule snapshots, encrypt and copy them off-host, and monitor failures. To restore, stop the service, preserve its database and `-wal`/`-shm` sidecars together, then restore a snapshot to a fresh database path and set `DATABASE_PATH` before restarting. Rehearse against an isolated path/account before production. The test suite verifies snapshot restore and ownership isolation. Host, TLS, account provisioning, backup schedule, retention and recovery targets remain deployment responsibilities.

## Checks and files

```bash
bun test
bun run check
bunx playwright install chromium       # once; Linux CI also uses --with-deps
bun run test:browser
```

API tests cover persistence, permissions, conflicts, imports, participant links and backup/restore. Browser tests cover local and server editing, storage failures, conflicts, PDF, private-link handoff and migration; all notes and credentials used in checks are synthetic. No lint or typecheck is configured.

- `server.ts`, `server/app.ts`: authenticated API, SQLite and public-file allowlist.
- `client/app.js`, `client/db.js`, `client/local-db.js`: shared editor and server/browser storage adapters.
- `client/boot.js`, `client/participant.js`, `client/form.js`: isolated participant entrypoint and shared grids/tabs.
- `client/legacy.js`, `legacy.html`: browser-data export and JSON recovery.
- `scripts/backup.ts`: consistent SQLite snapshot.
- `styles.css`, `index.html`, `guide.html`: capture sheets and guide; Britti Sans comes from `varde.variant.dev`.

The [storage and access decision](docs/storage-decision.md) retains the hosting comparison and access contract. The [participant implementation map](docs/participant-access.md) records the approved defaults and verification evidence.
