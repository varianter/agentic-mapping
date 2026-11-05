# Agentic mapping: capture sheets

Capture sheets and an interviewer guide for 15-minute interviews about what people had to learn to work with agents. Plain HTML, CSS and browser JavaScript served by Bun/Hono. No build step.

Three modes, one name each:

| Mode | Route | Who | Storage | Can do |
| --- | --- | --- | --- | --- |
| **My map** (`self`) | `/` | Anyone without the admin cookie | Server (respondent answer fields only), found again through an HttpOnly browser cookie. Without `ADMIN_KEY`: browser IndexedDB, never sent to the server | Fill in your own answers (autosaved), clear, download JSON or PDF |
| **Interviewer** | `/` after `/sign-in` | Holder of the admin cookie | Upstash Redis, or local JSON file | Create, fill, delete interviews; PDF/JSON; create, replace or revoke private links; read and edit self-submitted maps at `/submissions`; sign out |
| **Participant** | `/participant#<credential>` | Holder of a private link | Server, respondent answer fields only | Connect this browser to the interview, then edit it as My map at `/` until the link is replaced or revoked |

`/guide.html` is the static interviewer guide.

Opening a link in a browser that already has its own map asks whether to merge both, keep the interview's answers or replace them with your own; the own map is then deleted.

Without `ADMIN_KEY` the app is self-only: `/sign-in`, `/participant`, `/submissions` and `/api/*` return 404 and no store is needed.

## Run

```bash
bun install
bun start        # self-only: My map
echo "ADMIN_KEY=$(openssl rand -hex 32)" > .env
bun start        # or: bun dev; adds interviewer sign-in
```

Open http://localhost:4321, and http://localhost:4321/sign-in to sign in with the admin key. Without KV variables, interviews are written to `./data/store.json`.

## Environment

| Variable | Description |
| --- | --- |
| `ADMIN_KEY` | Optional, 32+ characters. Enables interviewer sign-in. The admin cookie holds an HMAC of the key, so rotating it signs everyone out. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis. Required on Vercel when `ADMIN_KEY` is set. |
| `LOCAL_STORE_FILE` | Used when KV is unset. Default `./data/store.json`. Dev only. |
| `PORT` | Default `4321`. |
| `BIND_ADDRESS` | Default `127.0.0.1`. |
| `APP_ORIGIN` | Public HTTPS origin, no trailing slash. Required behind a proxy; write requests must match it. |

Never commit secrets or copy production KV variables into a local `.env`.

## Develop

```bash
bun test                              # API and storage tests
bun run check                         # syntax-check client modules
bunx playwright install chromium      # once
bun run test:browser                  # Playwright browser checks
```

Tests use in-memory stores and never contact Upstash. No lint, typecheck or formatter is configured.

New public files must be added to the allowlist in `server/app.ts`.

```
server.ts          Bun entrypoint
server/app.ts      Hono API, cookie sign-in, public-file allowlist
server/config.ts   Env config checks
server/store.ts    Upstash and memory/JSON-file stores
api/index.ts       Vercel entry
client/boot.js     Starts the mode the server marked: self, interviewer or participant
client/self.js     My map
client/me-db.js    My map on the server (/api/me)
client/self-db.js  My map's IndexedDB record (self-only)
client/app.js      Interviewer editor
client/db.js       Interview API adapter
client/participant.js Connects a browser to its interview through a private link
client/fields.js   Respondent fields, shared with the server
client/form.js     Shared grids and tabs
index.html, guide.html, styles.css
tests/             Bun and Playwright tests
```

## Deploy (Vercel)

1. Import the repo with no build command and no output directory (`vercel.json` sets `"framework": null`).
2. Add **Upstash for Redis** from Storage → Marketplace. Apply `KV_REST_API_URL` and `KV_REST_API_TOKEN` to Production and Preview.
3. Set `ADMIN_KEY` (Production and Preview) and `APP_ORIGIN` (production HTTPS origin). Leave `ADMIN_KEY` unset for a self-only deploy; then step 2 is optional.
4. After deploy, check that `/server/app.ts` and `/package.json` return 404.

**Preview deployments share production data.** Only share preview URLs and the admin key with people allowed to see production.

Other Bun hosts work too: keep Bun on loopback behind an HTTPS proxy, set `APP_ORIGIN`, disable proxy caching and rate-limit `/sign-in`, `/api/me` and participant requests. Anyone can create a self-submitted map, so rate limiting matters.

## Docs

- [Storage and access decision](docs/storage-decision.md)
- [Participant access](docs/participant-access.md)
