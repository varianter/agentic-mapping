# Agentic mapping: capture sheets

Capture sheets and an interviewer guide in plain HTML, CSS and browser JavaScript. Sheets autosave to SQLite through Bun/Hono and are available on other devices using the same interviewer account. No frontend build step.

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

Open http://localhost:4321 and enter the configured username/password in the browser’s sign-in prompt. Add other usernames/hashes to the JSON object for separate accounts; each can access only their own sheets. Keep usernames stable: they identify sheet owners. No default account is provided; startup fails without valid configuration. Browser Basic authentication stays cached until the browser session is closed; use separate profiles on shared devices.

- `INTERVIEWER_USERS_FILE`: path to a private JSON object of usernames and Argon2id password hashes. Keep it server-side; use a JSON file because Bun expands dollar signs in `.env` values, including password hashes.
- `DATABASE_PATH`: SQLite file, defaults to `./data/sheets.sqlite`; production must use an absolute path on a durable disk outside the checkout.
- `PORT`: defaults to `4321`.
- `APP_ORIGIN`: public origin, for example `https://mapping.example.com` (no trailing slash); set it behind a reverse proxy so write requests can be checked against the browser’s Origin header.

Keep production account files, passwords, tokens and private keys outside the checkout; never commit them or put them in browser code. Git ignores `.env*`, `data/`, `secrets/`, `interviewers.json` and common key files as a safeguard; arbitrary filenames still require care. Test passwords are synthetic and are never deployment credentials. If a real secret is ever committed, revoke/rotate it immediately; deleting the file does not remove it from Git history.

## Existing notes and recovery

Export each browser’s existing IndexedDB notes from the **old origin**, then select **Import JSON** on the server. The GitHub Pages workflow now publishes only the [legacy exporter](legacy.html); it leaves browser data untouched and never uploads it. The same exporter is available on the server for notes previously saved on that origin. Repeat on each browser/device that holds notes.

Imports preserve IDs, fields and timestamps and assign ownership to the signed-in interviewer. Identical retries are safe; conflicting IDs stop import without overwriting anything. A partial import reports its count; keep the export, resolve collisions and retry. Verify the imported notes before removing any originals or private JSON files.

**Saved to server** means a committed save. On a network failure, use **Retry save** or **Download JSON** in the sidebar before closing the tab. Unsaved drafts stay in memory and trigger a leave-page warning; they are not stored in IndexedDB. If another device has changed the sheet, automatic saving stops: download the draft, choose **Reload saved**, and manually merge the downloaded notes. Unknown sheet URLs show an unavailable state rather than another interview.

**Download PDF** opens the browser’s A4 landscape print dialog. Choose **Save as PDF**.

## Deploy and back up

### GitHub Pages and the storage host

The working app moves to the Bun host's HTTPS address; GitHub Pages keeps only the old-browser export page. Pages does not store shared sheets or forward saves to the Bun host. Export existing notes on Pages, then open the Bun app and use **Import JSON** to upload them to your account.

At the Bun address, the browser sends authenticated `POST` (create/import), `PUT` (autosave) and `DELETE` requests to that same host's `/api/sheets` endpoints. The running Bun process checks ownership and revisions and writes to the SQLite file at `DATABASE_PATH` before acknowledging success. Another device reads those saved sheets from the same API using the same interviewer account; it sees updates when loading or reloading a sheet, without live synchronization.

The [Pages workflow](.github/workflows/pages.yml) updates only the static exporter after a push to `main` or a manual workflow run. It does not deploy the Bun app or update its database. The operator must deploy code updates to the Bun host separately and restart the service with the same durable `DATABASE_PATH`; sheet edits reach storage through the API without a commit, workflow run or redeployment. This PR does not provision a host or configure automatic Bun deployments.

### Bun deployment and backups

Run one Bun instance behind an HTTPS reverse proxy with process supervision, a durable SQLite volume, a private environment file and named interviewer accounts. Preserve the public Host header and set `APP_ORIGIN`. Bind/firewall the Bun port so remote access goes through HTTPS; Basic authentication must never cross a public HTTP connection. Rate-limit authentication attempts at the proxy. Back up before upgrades; there is no automatic host provisioning in this repository.

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

API tests cover persistence, permissions, conflicts, imports, exposure and backup/restore. Browser tests cover autosave, two-device access, failures, migration, deletion and print layout. No lint or typecheck is configured.

- `server.ts`, `server/app.ts`: authenticated API, SQLite and public-file allowlist.
- `client/app.js`, `client/db.js`: UI and server storage adapter.
- `client/legacy.js`, `legacy.html`: browser-data export and JSON recovery.
- `scripts/backup.ts`: consistent SQLite snapshot.
- `styles.css`, `index.html`, `guide.html`: capture sheets and guide; Britti Sans comes from `varde.variant.dev`.

The [storage and access decision](docs/storage-decision.md) retains the hosting comparison and future participant-access contract. The implemented backend uses the existing Bun runtime and SQLite; participant links remain disabled until field visibility and link-only access are agreed.
