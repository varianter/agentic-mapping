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

- What it is: browser-based capture sheets and an interviewer guide for Variant's "agentic mapping" interviews. Interviewers fill in a 3×3 grid per dimension (Individual, Team, Organization), sheets autosave locally and can be downloaded as PDF.
- Primary users: Variant interviewers running mapping sessions.
- Language of what users see: English.
- Live at https://varianter.github.io/agentic-mapping/ (GitHub Pages, from `main`).

## Stack

- Language and runtime: plain HTML, CSS and vanilla JavaScript ES modules in the browser. No framework, no bundler, no TypeScript in the app.
- Main parts:
  - `index.html` + `app.js`: capture sheet app (tabs, sidebar list, autosave, delete, PDF via print).
  - `db.js`: small promise wrapper around IndexedDB (one `sheets` store).
  - `guide.html`: static interviewer guide.
  - `styles.css`: Variant tokens, layout and `@media print` styles for both pages.
  - `server.ts`: Hono static file server on Bun, local use only.
- Package manager or build tool: Bun (`bun.lock`). Do not use npm, yarn or pnpm.

## Commands

| Task         | Command                                                              |
| ------------ | -------------------------------------------------------------------- |
| Install      | `bun install`                                                        |
| Run locally  | `bun start` (or `bun dev` to restart on `server.ts` changes), open http://localhost:4321. `PORT` overrides the port. |
| Syntax check | `node --check app.js && node --check db.js`                          |
| Test         | None yet. There is no test runner or test files.                     |
| Lint         | None yet. CI runs `bun run --if-present lint`, which is a no-op.     |
| Format       | None configured. Match surrounding style by hand.                    |
| Typecheck    | None.                                                                |
| Build        | None. Files are served as-is.                                        |

Verify changes by running the syntax check and exercising the change in a browser via `bun start`: create a sheet, type, reload (autosave), switch tabs, delete, and check print preview when touching layout. If you add a `test` or `lint` script to `package.json`, CI picks it up automatically; record it here.

## Layout

```
index.html        capture sheet page (markup + <template id="matrix-template">)
app.js            all UI logic for index.html
db.js             IndexedDB wrapper: allSheets, getSheet, putSheet, deleteSheet
guide.html        interviewer guide (static, no JS)
styles.css        shared styles, tokens, print layout
img/              Variant logos (SVG)
server.ts         local Hono static server (not deployed)
.github/workflows pages.yml (deploy), ci.yml (install/lint/test), kanbot-merged.yml
```

## Code conventions

- Naming: camelCase functions and variables, UPPER_SNAKE for constant tables (`DIMENSIONS`, `GRID_FIELDS`), kebab-case element ids and CSS classes.
- JS style: 2-space indent, single quotes, semicolons, `const` arrow helpers, modern browser APIs (`toSorted`, `crypto.randomUUID`, `<dialog>`). Short section comments like `// ---------- Name ----------`.
- DOM: build UI with `document.createElement` and `<template>` clones, not `innerHTML` with user data. Delegated clicks use `data-action="…"`.
- State in CSS: use data attributes and ARIA (`data-variant`, `data-state`, `data-sidebar`, `aria-selected`) rather than toggling classes.
- Styling: use the `:root` tokens in `styles.css` (`--yellow`, `--ink`, `--paper`, `--danger`…). Britti Sans comes from the Varde CDN. Keep the print layout working (A4 landscape).
- Data: sheets are `{ id, fields, createdAt, updatedAt }` in IndexedDB database `agentic-mapping`, store `sheets`. Grid field names are `<dim>_<question>_<level>`, e.g. `team_why_next`. Changing these orphans existing users' data; bump the DB version and migrate if a schema change is needed.
- Error handling: catch storage failures and show them in the toolbar status via `setStatus(message, 'error')`. Wrap `localStorage` access in `try/catch`.
- Accessibility: keep roles, `aria-*` attributes, keyboard support on tabs and visible labels (`.visually-hidden` text) intact.
- Tests: none yet (see Commands).
- Commits: Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`) with a scope.
- Do not: add a framework, bundler or build step; add runtime npm dependencies to the browser code; make `server.ts` required for the app to work (production is static Pages).

## Decisions

- 2026-11-04: Static site on GitHub Pages with no build step, because the tool must stay trivial to host and change.
- 2026-11-04: Sheets are stored only in the browser (IndexedDB), no backend, because interview notes should stay on the interviewer's machine.

## Gotchas

- New top-level files the site needs must be added to the `cp` line in `.github/workflows/pages.yml`, or they 404 in production.
- IndexedDB is per origin: changing the local port or host shows an empty sheet list.
- The deployed site lives under `/agentic-mapping/`, so use relative URLs (`styles.css`, `img/…`), never root-absolute ones.
- `.claude/agents/`, `.claude/settings.json` and `.codex/agents/` are generated by `kanbot sync`; edit `.kanbot/agents/` instead.
