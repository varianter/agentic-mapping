# Participant completion links

## Implementation map

The storage prerequisite is present in this checkout: `server/app.ts` owns authentication, SQLite, revisions and the public-file allowlist; `server.ts` configures the host. No replacement storage or identity system is needed.

1. Extend `server/app.ts` with an additive link table, owner-only issue/revoke routes and a separate participant API. Check hashed credentials, seven-day expiry and field/revision restrictions on every operation. Prove denial, persistence and atomic saves in `tests/participant.test.ts`.
2. Reuse the capture-sheet grids and tabs through `client/form.js`. Keep interviewer behavior in `client/app.js`; boot `client/participant.js` only at `/participant`, including without a credential. Add owner link controls and participant save/recovery controls to `index.html` and `styles.css`.
3. Extend `tests/browser.mjs` with a fresh-browser handoff, failures, conflicts, revocation and inert answers. Audit headers, logs and public assets;. Document HTTPS, private runtime configuration and secret provisioning in `README.md`.

This remains one feature: backend authorization, isolated participant UI and security/deployment verification, committed separately. No new runtime dependencies or hosting platform are needed. Commands remain `bun test`, `bun run check` and `bun run test:browser`; no lint or typecheck is configured.

## Access contract

- Anyone holding the link can edit the 27 dimension/grid fields and `good`, `surprised`, `missing`, `advice`. Identity, context, discipline and follow-up contacts remain private.
- Since 2026-11-05 each interview has one stable link (connect URL), derived as an HMAC of `ADMIN_KEY` and the interview ID and always shown to the signed-in interviewer. It lasts until the interview is deleted or `ADMIN_KEY` is rotated; there is no separate revoke. Older random links are replaced the first time the interview is opened.
- Deliver the random credential only in a URL fragment; participant API requests use an Authorization header. Store only its SHA-256 hash in SQLite. Do not persist it in browser storage or send it in HTTP URLs.
- Since 2026-11-05 opening a link connects the browser: `POST /api/participant/connect` sets an HttpOnly `am_respondent` cookie whose hash is stored at `respondent:<hash>` as `{ sheetId, linkHash }`. The browser then edits the interview as My map at `/` through `/api/me`, with autosave and a matching revision. Deleting the interview (or replacing an older link) disconnects those browsers.
- If the browser already has its own map with answers, the respondent chooses: merge (an empty side takes the other; differing answers keep both, the interview's first), keep the interview's answers, or replace them with their own. The own map is then deleted.
- Saves need a matching revision. Conflicts keep the draft and need a reload.
- A production operator must provision HTTPS, private account configuration, durable storage and backups. A host deployment and a real-user seven-day completion-window trial remain operational handoff steps.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Owner-only connect URL and copy | `tests/participant.test.ts`: owner isolation and hash-only persistence; `tests/participant-browser.mjs`: copy control and clipboard handoff. |
| Fresh-browser edits reach interviewer and survive reload | API restart/persistence test and browser handoff without the admin cookie. |
| Deny other sheets, lists, creation, deletion and private fields | API operation matrix and unchanged stored-sheet assertions; browser asserts exactly 31 fields and no interviewer imports/storage requests. |
| Missing/invalid/expired/replaced credentials fail closed | API read/write checks, including deletion during body reading; browser fresh visits and open-form read/save denial. |
| Failed saves/conflicts retain drafts without overwriting/retry | API disk-error and bidirectional/concurrent revision checks; browser offline recovery, conflict download/reload and typing during an in-flight save. |
| Transport, headers, projection and secret boundaries | API HTTPS/header/projection/log checks; browser referrer, inert-text and storage checks; local tracked/history scan and synthetic screenshot review. |

Production TLS/proxy configuration and actual deployment credentials are outside the test environment. Provision them directly on the host/in GitHub Secrets as documented in the README; no real interviews or deployment credentials are used by these checks.
