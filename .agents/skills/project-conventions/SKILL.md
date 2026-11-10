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

- What it is: browser-based capture sheets and an interviewer guide for Variant's "agentic mapping" interviews. A 3×3 grid per dimension (Individual, Team, Organization). Sheets live in **groups** (one workspace per company, slug URL `/<group>`) or in no group. Three modes: `self` (anonymous; `/` asks for a group id, then **My map** at `/<group>`, or `/map` without a group, with respondent fields only: a server-rendered form saved on the server and found again through an HttpOnly `am_respondent` browser cookie, one map per group; without `ADMIN_KEY`, `/` goes to `/map`), `interviewer` (admin cookie; starts at `/groups`; interviews at `[/<group>]/interviews/:id` autosave to Upstash Redis, or a local JSON file in dev; self-submitted maps at `[/<group>]/submissions/:id`) and `participant` (a private link `/connect#<credential>` connects the browser to its interview, then it is edited as My map in the interview's group). PDF (print) and JSON downloads in self and interviewer modes.
- Primary users: Variant interviewers running mapping sessions.
- Language of what users see: English.
- The app needs a Bun host and a store: Upstash Redis KV variables, or a local JSON file (see README). `ADMIN_KEY` is optional: without it the app is self-only (My map at `/map`, no groups). `/` is the group id box until sign-in at `/sign-in`, then it redirects to `/groups`.

## Stack

- Language and runtime: Bun/TypeScript on the server, with Hono and server-side `hono/jsx` templates (`.tsx` run by Bun, no build). In the browser: server-rendered HTML, one CSS file and small vanilla JavaScript custom elements. No frontend framework, no bundler, no TypeScript in the browser. Server dependencies: `hono`, `zod`, `@upstash/redis`.
- Architecture: a traditional server–client app. Every page is a real URL rendered on the server, and every flow works as a plain form post (post/redirect/get) without JS. JS only enhances: custom elements in `public/elements/` upgrade server markup in place. The one exception is `/connect`, which must read the URL fragment.
- Main parts:
  - `server/app.tsx`: middleware order and route mounts only. Group routes (`/:group/interviews`, `/:group/submissions`, then `/:group` from `me`) are mounted last, so a group id never hides a page; `RESERVED` in `domain/groups.ts` lists ids a group can't take: add new root paths there. HTTPS check and `no-store` → `secureHeaders` (strict CSP, `Referrer-Policy: same-origin`) → context variables (`store`, `adminKey`, `admin`, `origin`, `secure`) → `jsxRenderer` → body limit → `csrf()` → features → `notFound`/`onError` pages (503 for store failures).
  - `server/<feature>/<feature>.routes.tsx`: one Hono router per feature, plus its views. Features: `me` (start page `/` with a GET group-id form; My map at `/map` and `/:group`, each with `/clear` and `/me.json`), `groups` (`/groups` list/create, `POST /groups/:slug` rename), `interviews` (`/interviews`, `/interviews/:id`, `.json`, `/delete`, `/import`), `submissions` (`/submissions/:id`), `connect` (`/connect`, `/participant` redirect), `signIn` (`/sign-in`, `/sign-out`), `guide` (`/guide`), `survey` (`/:group/survey`, `/:group/survey/:step`, `/:group/survey/done`; anonymous, the group's open wave), `waves` (admin: `/:group/waves`, `/:group/waves/:id` results, `.csv`, `/close`, `/reopen`), `insights` (admin: `[/:group]/insights` and `.md`, a group's qualitative answers without names; see `docs/insights.md`).
  - `server/domain/`: the rules, independent of HTTP: `fields.ts` (field tables, defined once), `sheets.ts` (get/list/create/save/delete with revision checks), `respondents.ts` (browser bindings, merge), `links.ts` (stable participant links), `groups.ts` (slugs, reserved ids, create/rename, path helpers), `import.ts`, `schemas.ts` (zod form schemas built from the field tables), `credentials.ts`, `survey.ts` (the versioned questionnaire, defined once), `waves.ts` (waves and anonymous responses), `surveyResults.ts` (tallies, n<5 suppression, CSV), `insights.ts` (a group's answers per person and wave, pseudonymous, and its Markdown).
  - `server/framework/`: `group.ts` (`resolveGroup`: the URL's group into `c.get('group')`, 404 if unknown), `formAction.tsx` (GET renders; POST validates, then 303 or a 409/422 re-render keeping what was typed; JSON for `Accept: application/json`), `assets.ts` (content-hashed `/assets/*` manifest, served `immutable`), `auth.ts`, `respondentCookie.ts`, `env.ts`.
  - `server/shell/`: shared views: `Layout`, `Sheet` (the sheet form for `respondent` or `interviewer`; respondents never get interviewer fields in the HTML), `Sidebar`, `Toolbar`, `EditorPage`, and `sheetEditor.tsx` (the interviewer's list/editor/download/delete routes for one source).
  - `public/`: `styles.css` (cascade layers), `img/`, `connect.js`, `elements/` (`autosave-form`, `sheet-tabs`, `tool-list`, `print-button`, `copy-button`, `sidebar-toggle`; light DOM, never import each other).
  - `server/store.ts`: key-value `Store` (Upstash adapter, Map/JSON-file adapter with `failWrites` for tests). `server/config.ts`: env checks.
- Package manager or build tool: Bun (`bun.lock`). Do not use npm, yarn or pnpm.

## Commands

| Task         | Command                                                              |
| ------------ | -------------------------------------------------------------------- |
| Install      | `bun install`                                                        |
| Run locally  | `bun start` (or `bun dev`) for self-only. For interviewer mode, follow README to set `ADMIN_KEY` (32+ chars) in a private `.env` (no KV variables: data goes to `LOCAL_STORE_FILE`, default `./data/store.json`), then sign in at http://localhost:4321/sign-in. `PORT` overrides the port. |
| Syntax check | `bun run check` (checks `public/*.js` and `public/elements/*.js`). |
| Test         | `bun test` (server: form posts through `app.request`). No browser tests. |
| Lint         | None configured.                                                    |
| Format       | None configured. Match surrounding style by hand.                    |
| Typecheck    | None configured (`tsconfig.json` sets `hono/jsx` for Bun and editors). |
| Build        | None. Bun runs the TSX; `public/` is served with hashes computed at startup. |

Run the server suite and syntax checks before finishing. `.github/workflows/checks.yml` runs both. Browser testing (Playwright or similar) is not used in this repo: don't add browser tests, browser-test dependencies or screenshot evidence; cover behaviour with `bun test`.

## Layout

```
server.ts              configured Bun entrypoint (picks the store from env)
api/index.ts           Vercel entry
server/app.tsx         middleware order and mounts
server/<feature>/      me, interviews, submissions, connect, signIn, guide, survey, waves, insights: routes + views
server/domain/         fields, sheets, respondents, links, import, schemas, credentials, survey, waves, surveyResults, insights
server/framework/      formAction, assets, auth, respondentCookie, env, respond
server/shell/          Layout, Sheet, Sidebar, Toolbar, EditorPage, sheetEditor
server/store.ts        Store interface, Upstash and memory/JSON-file adapters
public/                styles.css, img/, connect.js, elements/*.js
tests/                 Bun tests
.github/workflows      checks.yml (tests), kanbot-merged.yml
```

## Code conventions

- Naming: camelCase functions and variables, PascalCase components, UPPER_SNAKE for constant tables (`DIMENSIONS`, `GRID_FIELDS`), kebab-case element ids, CSS classes and custom element names. Route files are `<feature>.routes.tsx`, views `<name>.view.tsx`.
- Module boundaries: features import only `domain/`, `framework/`, `shell/` and themselves, never another feature or the store adapters (type imports of `Store` are fine). `domain/` imports only itself; `framework/` only `domain/`; `shell/` only `domain/` and `framework/`. `tests/architecture.test.ts` enforces this.
- Routes: features mounted at `/` guard each route (`.get(path, requireAdminEnabled, handler)`), because `.use()` on a router mounted at `/` would cover every path. Prefix-mounted features (`/interviews`, `/submissions`) use `.use(requireAdmin)`.
- Forms: every write is a `<form method="post">` handled by `formAction` with a zod schema from `domain/schemas.ts` (strict: unknown fields are refused). Success is a 303 to a GET; failures re-render with the typed values (409 conflict, 422 invalid). Scripts post the same form-encoded body with `Accept: application/json`.
- JS style: 2-space indent, single quotes, semicolons, `const` arrow helpers, modern APIs (`toSorted`, `crypto.randomUUID`, `<dialog>`, Invoker Commands, `popover`). Browser code is one custom element per file in `public/elements/`, light DOM, with `data-ready` set once upgraded; script-only controls stay hidden until then.
- HTML: semantic elements, real links for navigation (`aria-current="page"`), native dialogs opened with `commandfor`/`command` on `type="button"` (no GET-form fallback: browsers still submit such a button inside a form). No inline scripts or styles; the CSP forbids them.
- State in CSS: data attributes and ARIA (`data-variant`, `data-state`, `data-ready`, `aria-selected`), `:has()` and `:popover-open` rather than toggled classes.
- Styling: one `public/styles.css` in `@layer reset, tokens, base, layout, components, print`, with native nesting, container queries for the sheet, logical properties and `@view-transition { navigation: auto; }`. Use the `:root` tokens (`--yellow`, `--ink`, `--paper`, `--danger`…). Britti Sans comes from the Varde CDN. Keep the print layout working (A4 landscape, all three grids).
- Data: one JSON value per sheet at `sheet:<id>`: `{ id, source, group?, fields, createdAt, updatedAt, revision, linkHash? }` (no owner; `source` is `self` or `interview`, missing means `interview`; `group` is a group slug, missing means no group; `linkHash` never leaves the server). Keys are `sheet:*`, `group:<slug>` = `{ slug, name, createdAt }` (slug fixed, name renamable), `link:<hash>` and `respondent:<hash>[:<slug>]` = `{ sheetId, linkHash? }` (a browser cookie's binding in no group or one group; stale when the sheet is gone, in another group, or its link changed). Respondents get tool suggestions from their own group only; interviewers from all. Preserve grid field names (`team_why_next`, etc.). Uploads (`POST [/<group>]/interviews/import`, multipart) accept a store dump or Download JSON file; each sheet goes through `createSheet` into the group uploaded from (optional `source`, fresh revision, existing IDs never overwritten). Saves and deletes check the revision before writing (read-check-write, not atomic); never upsert deleted sheets.
- Survey: `wave:<slug>:<id>` = `{ id, group, name, version, status, createdAt, closedAt? }` (one open per group, never deleted), `response:<waveId>:<id>` = `{ id, waveId, version, answers, createdAt, updatedAt, submittedAt?, revision }` (no names, no token) and `survey-respondent:<hash>:<waveId>` = `{ responseId }`. Questions live in `SURVEY_V1`; a wave is pinned to its version, so change wording in a new version, never in place. Only submitted responses count; results hide any slice under 5 answers. See `docs/survey-mode.md`.
- Participant access: `POST /connect` takes the credential in a form body (never a URL or header) and binds the browser's `am_respondent` cookie to the interview, asking for `merge`/`interview`/`mine` first if the browser has its own map with answers. Each interview has one stable link, `HMAC(ADMIN_KEY, 'agentic-mapping-participant-v1:' + id)` (`server/domain/links.ts`), shown as a read-only connect URL on the interview page, which stores `link:<hash>` = `{ sheetId }` plus `linkHash` on the sheet. No revoke: deleting the interview or rotating `ADMIN_KEY` turns it off (older random links are replaced on first show). The link credential itself is never stored in the browser; only the separate HttpOnly respondent cookie persists.
- Error handling: store failures render a 503 page (or JSON for scripts) and are logged without request details. `<autosave-form>` shows failures in the toolbar status (`#save-status`, `data-state="error"`) and keeps the draft on the page.
- Accessibility: keep roles, `aria-*` attributes, keyboard support on tabs and visible labels (`.visually-hidden` text) intact.
- Tests: Bun tests drive the app with `app.request()` form posts (`tests/helpers.ts`: `setup`, a `browser()` cookie jar, `sheetForm()` to read a rendered form). No browser tests: client-side behaviour in `public/elements/` is checked by hand. Keep fixtures synthetic and use `memoryStore()` per test; never pass KV variables to tests.
- Commits: Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`) with a scope.
- Do not: add a frontend framework, a bundler/build step or browser runtime npm dependencies (server-side `hono/jsx` is fine); add inline scripts or styles; serve repository files outside `public/`, or credentials; fall back silently to browser-only saves; send interviewer-only fields to respondent pages. Keep drafts printable on storage failure.

## Decisions

- 2026-11-04: PR #10 human review requested implementation beyond the documentation spike. Use the existing Bun/Hono runtime (storage later moved to Upstash Redis in #16); #15 replaced named accounts with one `ADMIN_KEY`; Pages exporter later removed in #18.
- 2026-11-04: Issue #6 accepted link-only possession and the default 27 grid fields plus `good`, `surprised`, `missing`, `advice`.
- 2026-11-05: Anonymous maps are saved on the server for the admin (`/submissions`), found again through an HttpOnly cookie rather than a fingerprint; links connect a browser to its interview, with a merge/keep/replace choice for an existing own map.
- 2026-11-05: Three modes (self, interviewer, participant). Cookie sign-in replaces Basic auth; `ADMIN_KEY` optional (self-only without it); one My map; links last until the interview is deleted.
- 2026-11-05: Architecture rework: server-rendered `hono/jsx` pages in feature folders (modelled on varianter/tid's `apps/web`), forms first with custom-element enhancement, zod + `formAction`, Hono `csrf()` + strict CSP with `Referrer-Policy: same-origin`, hashed immutable assets. IndexedDB self-only storage removed: My map is always stored on the server. The JSON API (`/api/sheets`, `/api/me`, `/api/participant*`) is gone; `/participant` links redirect to `/connect`.
- 2026-11-06: Browser testing (Playwright) removed; the repo is tested with `bun test` and `bun run check` only.

## Gotchas

- New files under `public/` are served automatically at their hashed URL; reference them only through `asset('path')`. Keep `includeFiles` in `vercel.json` covering `tsconfig.json`, `server/` and `public/` (`tests/vercel.test.ts` checks it): Vercel's function runs the bundled `.tsx` source with Bun, which needs `tsconfig.json` for `jsxImportSource: hono/jsx`, or every request fails with `Cannot find module 'react/jsx-dev-runtime'`.
- Server data lives in Upstash (`KV_REST_API_URL`/`KV_REST_API_TOKEN`); without them it goes to a local JSON file, which is not durable on Vercel (so KV is required there, also without `ADMIN_KEY`). Tests construct `memoryStore()` directly; never put real KV variables in test code paths.
- `ADMIN_KEY` is optional but must be 32+ chars when set; never log it, put it in a cookie or serve it.
- `Referrer-Policy: same-origin` lets same-origin posts carry a real `Origin`, which `csrf()` checks (against `APP_ORIGIN` and preview origins when set); `Sec-Fetch-Site: same-origin` is also accepted.
- Never log or commit `KV_REST_API_TOKEN`.
- Set `APP_ORIGIN` to the public HTTPS origin behind a reverse proxy; posts require a matching Origin, and connect URLs use it. The admin cookie is `Secure` except on plain-http localhost.
- The entrypoint binds to `127.0.0.1` by default (`BIND_ADDRESS` overrides it); keep the backend private behind the HTTPS proxy. Give Bun file responses an explicit MIME type before Hono wraps them.
- A `requestSubmit()` called from a `submit` listener is ignored while that event is still dispatching; defer it a task (see `autosave-form`).
- The participant fragment stays in the address bar, never in HTTP URLs, headers or browser storage; do not capture it in screenshots/logs/analytics.
- `.claude/agents/`, `.claude/settings.json` and `.codex/agents/` are generated by `kanbot sync`; edit `.kanbot/agents/` instead.
