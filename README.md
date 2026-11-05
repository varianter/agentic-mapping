# Agentic mapping: capture sheets

Capture sheets and an interviewer guide for 15-minute interviews about what people had to learn to work with agents. Plain HTML, CSS and browser JavaScript served by Bun/Hono. No build step.

| Route | Access | Storage |
| --- | --- | --- |
| `/` | Open | Browser IndexedDB |
| `/` after **Sign in** | Admin key (Basic auth, any username) | Upstash Redis, or local JSON file |
| `/participant#<credential>` | Private link, expires after 7 days | Server, approved answer fields only |
| `/preview` | Open | Browser localStorage, never sent to the server |
| `/guide.html` | Open | Static interviewer guide |

## Run

```bash
bun install
echo "ADMIN_KEY=$(openssl rand -hex 32)" > .env
bun start        # or: bun dev
```

Open http://localhost:4321. Without KV variables, data is written to `./data/store.json`.

## Environment

| Variable | Description |
| --- | --- |
| `ADMIN_KEY` | Required, 32+ characters. Gates all interview management. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis. Required on Vercel. |
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
server/app.ts      Hono API, auth, public-file allowlist
server/config.ts   Env config checks
server/store.ts    Upstash and memory/JSON-file stores
api/index.ts       Vercel entry
client/boot.js     Picks browser/server mode or participant page
client/app.js      Interviewer editor
client/db.js       Server storage adapter
client/local-db.js Browser IndexedDB adapter
client/save-local.js  Moves browser models to the server after sign-in
client/participant.js Participant page
client/preview.js  Preview page
client/form.js     Shared grids and tabs
index.html, guide.html, styles.css
tests/             Bun and Playwright tests
```

## Deploy (Vercel)

1. Import the repo with no build command and no output directory (`vercel.json` sets `"framework": null`).
2. Add **Upstash for Redis** from Storage → Marketplace. Apply `KV_REST_API_URL` and `KV_REST_API_TOKEN` to Production and Preview.
3. Set `ADMIN_KEY` (Production and Preview) and `APP_ORIGIN` (production HTTPS origin).
4. After deploy, check that `/server/app.ts` and `/package.json` return 404.

**Preview deployments share production data.** Only share preview URLs and the admin key with people allowed to see production.

Other Bun hosts work too: keep Bun on loopback behind an HTTPS proxy, set `APP_ORIGIN`, disable proxy caching and rate-limit sign-in and participant requests.

## Docs

- [Storage and access decision](docs/storage-decision.md)
- [Participant access](docs/participant-access.md)
