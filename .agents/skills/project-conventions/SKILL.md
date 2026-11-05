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

- What it is: browser-based capture sheets and an interviewer guide for Variant's "agentic mapping" interviews. Interviewers fill in a 3×3 grid per dimension (Individual, Team, Organization), anonymous models autosave to browser IndexedDB, authenticated interviews autosave to the server store (Upstash Redis, or a local JSON file in dev), and both can be downloaded as PDF or JSON.
- Primary users: Variant interviewers running mapping sessions.
- Language of what users see: English.
- The app requires a Bun host, a secret `ADMIN_KEY` and Upstash Redis KV variables or a local JSON file (see README); `/` is anonymous/local until explicit sign-in.

## Stack

- Language and runtime: Bun/TypeScript on the server; plain HTML, CSS and vanilla JavaScript ES modules in the browser. No framework, no bundler, no TypeScript in the browser.
- Main parts:
  - `index.html` + `client/boot.js`: entrypoint selects the server-verified local/server adapter before initializing `client/app.js`, or isolated `client/participant.js` at `/participant`; `client/form.js` shares grids/tabs/plain-text form values.
  - `client/db.js`: same-origin authenticated storage API adapter; `client/local-db.js` stores anonymous models in `agentic-mapping-local`.
  - `guide.html`: static interviewer guide.
  - `styles.css`: Variant tokens, layout and `@media print` styles for both pages.
  - `server.ts` + `server/app.ts`: Hono API on Bun, a key-value `Store` (`server/store.ts`: Upstash adapter, Map/JSON-file adapter with `failWrites` for tests), HTTP Basic admin-key auth and an exact public-file allowlist.
- Package manager or build tool: Bun (`bun.lock`). Do not use npm, yarn or pnpm.

## Commands

| Task         | Command                                                              |
| ------------ | -------------------------------------------------------------------- |
| Install      | `bun install`                                                        |
| Run locally  | Follow README to set `ADMIN_KEY` (32+ chars) in a private `.env` (no KV variables: data goes to `LOCAL_STORE_FILE`, default `./data/store.json`), then `bun start` (or `bun dev`); open http://localhost:4321. `PORT` overrides the port. |
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
client/boot.js    selects local/server adapter or isolated participant entrypoint
client/app.js     interviewer UI logic for index.html
client/participant.js isolated bearer access, explicit saves and draft recovery
client/form.js    shared dimensions, tabs and form values
client/db.js      authenticated API adapter: allSheets, getSheet, createSheet, putSheet, deleteSheet
client/local-db.js anonymous IndexedDB adapter with transactional revisions
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
- Data: one JSON value per sheet at `sheet:<id>`: `{ id, fields, createdAt, updatedAt, revision, linkHash? }` (no owner; `linkHash` is never returned by the API). Keys are `sheet:*` and `link:<hash>`. Preserve grid field names (`team_why_next`, etc.). Updates/deletes check the revision before writing (read-check-write, not atomic); never upsert deleted sheets. Local IndexedDB `agentic-mapping-local`/`sheets` uses the same fields and revision checks inside readwrite transactions; acknowledge only transaction completion, retry failed opens and never update-upsert.
- Participant access: `/api/participant` accepts a bearer header and returns only approved string fields plus revision. `link:<hash>` keys hold `{ sheetId }` and expire after seven days; issue/revoke need the admin key. Keep participant code independent of interviewer storage; no automatic participant saves/retries or persistent browser credentials.
- Error handling: catch storage failures and show them in the toolbar status via `setStatus(message, 'error')`. Wrap `localStorage` access in `try/catch`.
- Accessibility: keep roles, `aria-*` attributes, keyboard support on tabs and visible labels (`.visually-hidden` text) intact.
- Tests: use Bun tests for API/persistence and Playwright for browser saves/recovery; keep fixtures synthetic and use `memoryStore()` per test; never pass KV variables to tests.
- Commits: Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`) with a scope.
- Do not: add a framework, frontend bundler/build step or browser runtime npm dependencies; serve arbitrary repository files or credentials; fall back silently from server mode to browser-only saves. The server marks `/` with the verified mode; `/sign-in` challenges and redirects to `/`. Local mode never calls interview APIs. Keep drafts printable on storage failure.

## Decisions

- 2026-11-04: PR #10 human review requested implementation beyond the documentation spike. Use the existing Bun/Hono runtime (storage later moved to Upstash Redis in #16); #15 replaced named accounts with one `ADMIN_KEY` (Basic password, username ignored; Bearer stays for participant links); Pages exporter later removed in #18.
- 2026-11-04: Issue #6 accepted link-only possession and the default 27 grid fields plus `good`, `surprised`, `missing`, `advice`; the admin issues/replaces/revokes seven-day links. `tests/participant.test.ts` and `tests/participant-browser.mjs` cover the restricted API and fresh-browser handoff; the existing check/browser commands include the new modules and checks.
- 2026-11-04: Issue #12 restores full anonymous editing at `/` with profile/origin-local IndexedDB, preserving authenticated server CRUD and participant isolation. `tests/local-browser.mjs` runs in `bun run test:browser`; browser auth setup visits `/sign-in` first.

## Gotchas

- New app assets must be added to the exact allowlist in `server/app.ts`.
- Server data lives in Upstash (`KV_REST_API_URL`/`KV_REST_API_TOKEN`); without them it goes to a local JSON file, which is not durable on Vercel. Tests construct `memoryStore()` directly; never put real KV variables in test code paths.
- `ADMIN_KEY` is required at startup (32+ chars); never log it or add it to the public allowlist.
- Never log or commit `KV_REST_API_TOKEN`.
- Set `APP_ORIGIN` to the public HTTPS origin behind a reverse proxy; write requests require a matching Origin and JSON. Basic authentication must use HTTPS remotely.
- The entrypoint binds to `127.0.0.1` by default (`BIND_ADDRESS` overrides it); keep the backend private behind the HTTPS proxy. Set security headers after downstream responses, and give Bun file responses an explicit MIME type before Hono wraps them.
- The participant fragment stays in the address bar for reloads, never HTTP URLs or browser storage; do not capture it in screenshots/logs/analytics.
- `.claude/agents/`, `.claude/settings.json` and `.codex/agents/` are generated by `kanbot sync`; edit `.kanbot/agents/` instead.
