# Participant completion links

## Implementation map

The storage prerequisite is present in this checkout: `server/app.ts` owns authentication, SQLite, revisions and the public-file allowlist; `server.ts` configures the host. No replacement storage or identity system is needed.

1. Extend `server/app.ts` with an additive link table, owner-only issue/revoke routes and a separate participant API. Check hashed credentials, seven-day expiry and field/revision restrictions on every operation. Prove denial, persistence and atomic saves in `tests/participant.test.ts`.
2. Reuse the capture-sheet grids and tabs through `client/form.js`. Keep interviewer behavior in `client/app.js`; boot `client/participant.js` only at `/participant`, including without a credential. Add owner link controls and participant save/recovery controls to `index.html` and `styles.css`.
3. Extend `tests/browser.mjs` with a fresh-browser handoff, failures, conflicts, revocation and inert answers. Audit headers, logs and public assets; keep Pages limited to the legacy exporter. Document HTTPS, private runtime configuration and secret provisioning in `README.md`.

This remains one feature: backend authorization, isolated participant UI and security/deployment verification, committed separately. No new runtime dependencies or hosting platform are needed. Commands remain `bun test`, `bun run check` and `bun run test:browser`; no lint or typecheck is configured.

## Access contract

- Anyone holding the link can edit the 27 dimension/grid fields and `good`, `surprised`, `missing`, `advice`. Identity, context, discipline and follow-up contacts remain private.
- The owner can issue a replacement or revoke access; replacement invalidates the old credential immediately. Links expire seven days after issuance.
- Deliver the random credential only in a URL fragment; participant API requests use an Authorization header. Store only its SHA-256 hash in SQLite. Do not persist it in browser storage or send it in HTTP URLs.
- Participant saves require an explicit action and a matching revision. Failures retain the draft; conflicts require an explicit reload and manual reconciliation. No automatic retry or merge.
- A production operator must provision HTTPS, private account configuration, durable storage and backups. A host deployment and a real-user seven-day completion-window trial remain operational handoff steps.
