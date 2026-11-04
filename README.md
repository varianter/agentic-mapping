# Agentic mapping: capture sheets

Plain HTML, CSS and one small JS module. No build step. Live at https://varianter.github.io/agentic-mapping/ (GitHub Pages, deployed from `main`). Locally it can be served by a tiny Hono server on Bun, or any static file server.

- `index.html`: capture sheets. Create, fill in, list (side menu), delete, download as PDF.
- `guide.html`: the interviewer guide.
- Sheets are saved automatically to IndexedDB in your browser as you type.

## Run

```bash
bun install
bun start        # or: bun dev (restarts on server changes)
```

Set `PORT` to override the default port 4321.

Then open http://localhost:4321.

Data is stored per origin, so always use the same address and port. If you switch ports, your saved sheets won't show up.

## PDF

**Download PDF** opens the browser's print dialog with an A4 landscape layout. Choose **Save as PDF**. The file name defaults to the interviewee's name and the date.

## Files

- `server.ts`: Hono static file server (Bun)
- `app.js`: UI, autosave, sidebar, PDF
- `db.js`: IndexedDB wrapper
- `styles.css`: Variant tokens and layout, including print styles
- Britti Sans is loaded from the Varde CDN (`varde.variant.dev`)

## Deploy

Pushing to `main` publishes the static files to GitHub Pages via `.github/workflows/pages.yml`. Nothing is built; Bun is only for local serving.
