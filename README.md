# Agentic mapping: capture sheets

Capture sheets and an interviewer guide for 15-minute interviews about what people had to learn to work with agents. Server-rendered HTML (Hono + `hono/jsx` on Bun), one stylesheet and a few custom elements that enhance plain forms. No build step.

Three modes, one name each:

| Mode | Route | Who | Storage | Can do |
| --- | --- | --- | --- | --- |
| **My map** (`self`) | `/` | Anyone without the admin cookie | Server (respondent answer fields only), found again through an HttpOnly browser cookie | Fill in your own answers (a plain form; autosaved with JS), clear, download JSON (`/me.json`) or PDF |
| **Interviewer** | `/interviews` after `/sign-in` | Holder of the admin cookie | Upstash Redis, or local JSON file | Create, fill, delete interviews (`/interviews/:id`); PDF/JSON (`/interviews/:id.json`); upload JSON; copy each interview's connect URL; read and edit self-submitted maps at `/submissions/:id`; sign out |
| **Participant** | `/connect#<credential>` (old `/participant#…` links redirect) | Holder of a private link | Server, respondent answer fields only | Connect this browser to the interview, then edit it as My map at `/` until the interview is deleted |

`/guide` is the interviewer guide.

`/connect` is the one page that needs JavaScript: it posts the fragment credential in a form body, so it never travels in a URL. Opening a link in a browser that already has its own map asks (a server-rendered form) whether to merge both, keep the interview's answers or replace them with your own; the own map is then deleted.

Without `ADMIN_KEY` the app is self-only: `/sign-in`, `/connect`, `/interviews` and `/submissions` return 404. My map is still saved in the store (local JSON file, or Upstash).

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
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis. Required on Vercel. |
| `LOCAL_STORE_FILE` | Used when KV is unset. Default `./data/store.json`. Dev only. |
| `PORT` | Default `4321`. |
| `BIND_ADDRESS` | Default `127.0.0.1`. |
| `APP_ORIGIN` | Public HTTPS origin, no trailing slash. Required behind a proxy; write requests must match it. |

Never commit secrets or copy production KV variables into a local `.env`.

## Develop

```bash
bun test                              # server tests (form posts through app.request)
bun run check                         # syntax-check browser scripts
```

Tests use in-memory stores and never contact Upstash. There are no browser (Playwright) tests. No lint, typecheck or formatter is configured.

Files in `public/` are served at content-hashed `/assets/…` URLs; nothing else in the repository is served.

```
server.ts           Bun entrypoint
api/index.ts        Vercel entry
server/app.tsx      Middleware order and route mounts
server/config.ts    Env config checks
server/store.ts     Upstash and memory/JSON-file stores
server/me/          My map at / (form; autosave via public/elements)
server/interviews/  Interview list, editor, new, upload, connect URL
server/submissions/ Self-submitted maps
server/connect/     /connect: private link → browser cookie, merge choice
server/signIn/      /sign-in, /sign-out
server/guide/       /guide
server/shell/       Layout, Sheet form, Sidebar, Toolbar, shared sheet editor routes
server/domain/      Fields, sheets, respondents, links, import, zod schemas
server/framework/   formAction, hashed assets, auth, cookies
public/             styles.css, img/, connect.js, elements/*.js
tests/              Bun tests
```

## Deploy (Vercel)

1. Import the repo with no build command and no output directory (`vercel.json` sets `"framework": null`).
2. Add **Upstash for Redis** from Storage → Marketplace. Apply `KV_REST_API_URL` and `KV_REST_API_TOKEN` to Production and Preview.
3. Set `ADMIN_KEY` (Production and Preview) and `APP_ORIGIN` (production HTTPS origin). Leave `ADMIN_KEY` unset for a self-only deploy.
4. After deploy, check that `/server/app.tsx` and `/package.json` return 404.

**Preview deployments share production data.** Only share preview URLs and the admin key with people allowed to see production.

Other Bun hosts work too: keep Bun on loopback behind an HTTPS proxy, set `APP_ORIGIN`, disable proxy caching and rate-limit `/sign-in`, `POST /` and `POST /connect`. Anyone can create a self-submitted map, so rate limiting matters.

## Docs

- [Storage and access decision](docs/storage-decision.md)
- [Participant access](docs/participant-access.md)
