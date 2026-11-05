---

name: project-conventions
description: This project's stack, exact commands (install, run, test, lint, typecheck, build), code conventions and recorded decisions. Read first before planning, implementing, reviewing or fixing anything in this repository, and whenever you need to know how to run tests or the project.
---

# Project conventions

## Instructions for agents

- Read this skill before doing anything else in the repository.
- Use the commands below exactly. Do not guess alternatives when one is listed.
- If something here is wrong or missing and you learned the right answer (a command, a convention, a gotcha), propose an addition: edit this file in the same branch as a separate commit (`docs(conventions): …`) and mention it under "Notes for reviewer" in the PR. Only add durable facts about commands, stack and conventions. Lessons from human corrections go in `project-memory`. Planners and reviewers, who do not edit files, mention the proposed addition in their summary instead.

## Product

- What it is: browser-based capture sheets and an interviewer guide for Variant's "agentic mapping" interviews. A 3×3 grid per dimension (Individual, Team, Organization). Three modes: `self` (anonymous, one **My map** with respondent fields only, saved on the server through `/api/me` and an HttpOnly `am_respondent` browser cookie; IndexedDB only without `ADMIN_KEY`), `interviewer` (admin cookie; interviews autosave to Upstash Redis, or a local JSON file in dev; self-submitted maps at `/submissions`) and `participant` (a private link connects the browser to its interview, then it is edited as My map at `/`). PDF and JSON downloads in self and interviewer modes.
- Primary users: Variant interviewers running mapping sessions.
- Language of what users see: English.
- The app needs a Bun host. `ADMIN_KEY` is optional: without it the app is self-only and needs no store; with it, it needs Upstash Redis KV variables or a local JSON file (see README). `/` is self mode until sign-in at `/sign-in`.

## Stack

- Language and runtime: Bun/TypeScript on the server; plain HTML, CSS and vanilla JavaScript ES modules in the browser. No framework, no bundler, no TypeScript in the browser.
- Main parts:
  - `index.html` + `client/boot.js`: starts the server-marked mode (`data-mode`): `client/self.js`, `client/app.js` (interviewer) or isolated `client/participant.js`; `client/form.js` shares grids/tabs/plain-text form values; `client/fields.js` holds `RESPONDENT_FIELDS`, also imported by the server.
  - `client/db.js`: same-origin interview API adapter; `client/me-db.js`: My map on the server (`/api/me`); `client/self-db.js` stores My map in IndexedDB `agentic-mapping-self` in self-only mode.
  - `guide.html`: static interviewer guide.
  - `styles.css`: Variant tokens, layout and `@media print` styles for both pages.
  - `server.ts` + `server/app.ts`: Hono API on Bun, a key-value `Store` (`server/store.ts`: Upstash adapter, Map/JSON-file adapter with `failWrites` for tests), cookie sign-in (`/sign-in` sets HttpOnly `am_admin` = HMAC of `ADMIN_KEY`) and an exact public-file allowlist.
- Package manager or build tool: Bun (`bun.lock`). Do not use npm, yarn or pnpm.

## Commands

| Task         | Command                                                              |
| ------------ | -------------------------------------------------------------------- |
| Install      | `bun install`                                                        |
| Run locally  | `bun start` (or `bun dev`) for self-only. For interviewer mode, follow README to set `ADMIN_KEY` (32+ chars) in a private `.env` (no KV variables: data goes to `LOCAL_STORE_FILE`, default `./data/store.json`), then sign in at http://localhost:4321/sign-in. `PORT` overrides the port. |
| Syntax check | `bun run check` (checks all browser modules). |
| Test         | `bun test` (API/storage); `bun run test:browser` (Playwright). Install Chromium once with `bunx playwright install chromium`; set `CHROMIUM_PATH` to use a system Chromium. CI also installs Linux dependencies. |
| Lint         | None configured.                                                    |
| Format       | None configured. Match surrounding style by hand.                    |
| Typecheck    | None.                                                                |
| Build        | None. Files are served as-is.                                        |

Run the API suite, syntax checks and browser checks before finishing. `.github/workflows/checks.yml` runs all three. Browser checks use synthetic notes and an in-memory store and can refresh the committed screenshot with `UPDATE_EVIDENCE=1 bun run test:browser`. No lint or typecheck is configured.

## Layout

```
index.html        capture sheet page (markup + <template id="matrix-template">)
client/boot.js    starts the server-marked mode: self, interviewer or participant
client/self.js    My map: server-saved (me-db.js), or browser-only without ADMIN_KEY (self-db.js)
client/me-db.js   My map API adapter: loadMap, saveMap, clearMap over /api/me
client/self-db.js My map's single IndexedDB record (self-only mode)
client/app.js     interviewer editor
client/participant.js connects the browser to its interview via the link, with the merge choice
client/fields.js  RESPONDENT_FIELDS, shared with the server
client/form.js    shared dimensions, tabs and form values
client/db.js      interview API adapter: allSheets, getSheet, createSheet, putSheet, deleteSheet
client/import.js  Upload JSON parser: store dumps (`sheet:*` keys), Download JSON arrays or one sheet
guide.html        interviewer guide (static, no JS)
styles.css        shared styles, tokens, print layout
img/              Variant logos (SVG)
server.ts         configured Bun entrypoint (picks the store from env)
server/app.ts     Store-backed API, auth and public-file allowlist
server/store.ts   Store interface, Upstash and memory/JSON-file adapters
tests/            Bun API tests and Playwright browser checks
.github/workflows checks.yml (tests), kanbot-merged.yml
```

## Code conventions

- Naming: camelCase functions and variables, UPPER_SNAKE for constant tables (`DIMENSIONS`, `GRID_FIELDS`), kebab-case element ids and CSS classes.
- JS style: 2-space indent, single quotes, semicolons, `const` arrow helpers, modern browser APIs (`toSorted`, `crypto.randomUUID`, `<dialog>`). Short section comments like `// ---------- Name ----------`.
- DOM: build UI with `document.createElement` and `<template>` clones, not `innerHTML` with user data. Delegated clicks use `data-action="…"`.
- State in CSS: use data attributes and ARIA (`data-variant`, `data-state`, `data-sidebar`, `aria-selected`) rather than toggling classes.
- Styling: use the `:root` tokens in `styles.css` (`--yellow`, `--ink`, `--paper`, `--danger`…). Britti Sans comes from the Varde CDN. Keep the print layout working (A4 landscape).
- Data: one JSON value per sheet at `sheet:<id>`: `{ id, source, fields, createdAt, updatedAt, revision, linkHash? }` (no owner; `source` is `self` or `interview`, missing means `interview`; `linkHash` is never returned by the API). Keys are `sheet:*`, `link:<hash>` and `respondent:<hash>` = `{ sheetId, linkHash? }` (a browser cookie's binding; stale when the sheet is gone or its link changed). Preserve grid field names (`team_why_next`, etc.). Interviewers can upload a store dump or Download JSON file; each sheet goes through `POST /api/sheets` (optional `source`, fresh revision, existing IDs never overwritten). Updates/deletes check the revision before writing (read-check-write, not atomic); never upsert deleted sheets. In self-only mode My map is one record (`me`) in IndexedDB `agentic-mapping-self`/`map` holding only respondent fields; acknowledge only transaction completion.
- Participant access: `/api/participant` accepts a bearer header and returns only approved string fields plus revision; `POST /api/participant/connect` binds the browser's `am_respondent` cookie to the interview (asking for `merge`/`interview`/`mine` first if the browser has its own map with answers). `link:<hash>` keys hold `{ sheetId }` and last until replaced or revoked (older links keep a seven-day TTL); issue/revoke need the admin cookie. Keep participant code independent of interviewer storage. The link credential itself is never stored in the browser; only the separate HttpOnly respondent cookie persists.
- Error handling: catch storage failures and show them in the toolbar status via `setStatus(message, 'error')`. Wrap `localStorage` access in `try/catch`.
- Accessibility: keep roles, `aria-*` attributes, keyboard support on tabs and visible labels (`.visually-hidden` text) intact.
- Tests: use Bun tests for API/persistence and Playwright for browser saves/recovery; keep fixtures synthetic and use `memoryStore()` per test; never pass KV variables to tests.
- Commits: Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`) with a scope.
- Do not: add a framework, frontend bundler/build step or browser runtime npm dependencies; serve arbitrary repository files or credentials; fall back silently from server mode to browser-only saves. The server marks `/` with the verified mode; `POST /sign-in` sets the cookie and redirects to `/`. Self mode calls only `/api/me`, and nothing at all without `ADMIN_KEY`. Keep drafts printable on storage failure.

## Decisions

- 2026-11-04: PR #10 human review requested implementation beyond the documentation spike. Use the existing Bun/Hono runtime (storage later moved to Upstash Redis in #16); #15 replaced named accounts with one `ADMIN_KEY` (Basic password, username ignored; Bearer stays for participant links); Pages exporter later removed in #18.
- 2026-11-04: Issue #6 accepted link-only possession and the default 27 grid fields plus `good`, `surprised`, `missing`, `advice`; the admin issues/replaces/revokes seven-day links. `tests/participant.test.ts` and `tests/participant-browser.mjs` cover the restricted API and fresh-browser handoff; the existing check/browser commands include the new modules and checks.
- 2026-11-04: Issue #12 restores full anonymous editing at `/` with profile/origin-local IndexedDB, preserving authenticated server CRUD and participant isolation.
- 2026-11-05: Anonymous maps are saved on the server for the admin (`/submissions`), found again through an HttpOnly cookie rather than a fingerprint; links connect a browser to its interview, with a merge/keep/replace choice for an existing own map. Browser-only IndexedDB remains only without `ADMIN_KEY`; old IndexedDB maps are ignored. `tests/respondent.test.ts` covers the API.
- 2026-11-05: Three modes (self, interviewer, participant). Cookie sign-in replaces Basic auth; `ADMIN_KEY` optional (self-only without it); one My map replaces the anonymous model list and `/preview`; save-local upload removed; links last until revoked. `tests/self-browser.mjs` covers self mode; browser tests sign in through the form.

## Gotchas

- New app assets must be added to the exact allowlist in `server/app.ts` and to `includeFiles` in `vercel.json` (`tests/vercel.test.ts` checks the latter).
- Server data lives in Upstash (`KV_REST_API_URL`/`KV_REST_API_TOKEN`); without them it goes to a local JSON file, which is not durable on Vercel. Tests construct `memoryStore()` directly; never put real KV variables in test code paths.
- `ADMIN_KEY` is optional but must be 32+ chars when set; never log it, put it in a cookie or add it to the public allowlist.
- The app sends `Referrer-Policy: no-referrer`, so browsers post forms with `Origin: null`; `/sign-in` and `/sign-out` also accept `Sec-Fetch-Site: same-origin`.
- Never log or commit `KV_REST_API_TOKEN`.
- Set `APP_ORIGIN` to the public HTTPS origin behind a reverse proxy; write requests require a matching Origin and JSON. The admin cookie is `Secure` except on plain-http localhost.
- The entrypoint binds to `127.0.0.1` by default (`BIND_ADDRESS` overrides it); keep the backend private behind the HTTPS proxy. Set security headers after downstream responses, and give Bun file responses an explicit MIME type before Hono wraps them.
- The participant fragment stays in the address bar for reloads, never HTTP URLs or browser storage; do not capture it in screenshots/logs/analytics.
- `.claude/agents/`, `.claude/settings.json` and `.codex/agents/` are generated by `kanbot sync`; edit `.kanbot/agents/` instead.
