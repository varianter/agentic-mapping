# Storage and access decision

Documentation spike, 2026-11-04. This is a proposed design for later implementation; the app still saves only in the browser. Production storage, interviewer authentication and participant links are outside this change.

## Current constraints

- [`server.ts`](../server.ts) runs Hono on Bun locally and serves `./` for every path. A database, backup or secret placed under that root could become downloadable. Production must serve only an explicit public directory.
- [`client/db.js`](../client/db.js) stores `{ id, fields, createdAt, updatedAt }` in IndexedDB database `agentic-mapping`, version 1, store `sheets`. There is no server, owner or revision.
- [`client/app.js`](../client/app.js) lists every local sheet, saves the whole form after a 400 ms debounce, and opens the latest sheet for an unknown hash. Those behaviors must change before sharing storage or links; a UUID is an identifier, not permission.
- [`index.html`](../index.html) includes names, interviewer, client/team context, reflections and all three grids. Nothing currently distinguishes participant-visible notes from private interviewer notes.
- [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) copies only `index.html`, `guide.html`, `client`, `styles.css` and `img` into `_site`. It deploys static files; it cannot execute a storage API.
- IndexedDB follows the [same-origin policy](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). A new hostname, protocol or port cannot read the old browser database; neither a redirect nor the same URL path transfers it.

## Hosting comparison

Official sources checked on 2026-11-04; prices are USD and may change. Setup and operational judgments below are proposals for this app, not platform guarantees.

| Concern | Bun/Hono + built-in SQLite | Workers static assets + D1 |
| --- | --- | --- |
| Setup | Reuse Hono and `server.ts`; add API routes, SQL migrations and a file-backed `bun:sqlite` database. Provision an always-on host, durable disk, HTTPS and process supervision. [Hono on Bun](https://hono.dev/docs/getting-started/bun), [Bun SQLite](https://bun.sh/docs/runtime/sqlite). | Create a Cloudflare account and Worker, configure an assets directory and D1 binding, apply migrations, then deploy with Wrangler. Keep vanilla browser modules; no frontend bundler required. [Static assets](https://developers.cloudflare.com/workers/static-assets/), [D1 setup](https://developers.cloudflare.com/d1/get-started/). |
| Services | One app process and local database file, plus hosting/TLS and off-host backup storage. Interviewer identity still needs a provider. Fewer application services, but the team operates the host. | One deployment serves assets and API; D1 is a separate managed database resource in the same account. Interviewer identity still needs a provider. More platform resources, less host administration. |
| Persistence | A named SQLite file survives process restarts only if its disk survives deployments. Use a durable volume outside the checkout and public directory; never an ephemeral container filesystem. Start with one instance; WAL permits concurrent readers and a single writer. [Bun SQLite](https://bun.sh/docs/runtime/sqlite). | Data lives in the bound D1 database independently of Worker assets/code. Local development data is separate from remote data; bind staging and production to different databases. [D1 setup](https://developers.cloudflare.com/d1/get-started/). |
| Backups | Team schedules consistent snapshots with SQLite's backup tooling, encrypts off-host copies, monitors success and rehearses restoration. Copying only a live `.sqlite` file is not the backup design, especially with WAL sidecars. [SQLite backup API](https://sqlite.org/backup.html), [Bun WAL](https://bun.sh/docs/runtime/sqlite#wal-mode). | Time Travel is automatic; retention is 7 days on Free, 30 on Paid. For longer retention/account-loss recovery, schedule encrypted exports outside the account; exports block other database requests. Rehearse restoration. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [limits](https://developers.cloudflare.com/d1/platform/limits/), [export](https://developers.cloudflare.com/d1/best-practices/import-export-data/). |
| Maintenance | Owner patches OS/Bun/dependencies, renews TLS, monitors disk/process/backup failures, applies migrations and handles recovery. Disk failure or host replacement requires restoring data, not just redeploying code. | Cloudflare manages hosts and database infrastructure. Team still owns dependencies, migrations, identity, authorization, quota/billing monitoring, exports and restore drills. D1 requires its binding API; `bun:sqlite` cannot be used in a Worker. |

### Cost assumptions

Planning workload: 20 interviews/day, 600 debounced saves/interview, fewer than 10,000 indexed row reads/day and less than 100 MB including indexes. This means 12,000 save requests/day before retries and identity traffic; measure actual database rows written, including index maintenance. The current full-list refresh after every save must become a local list update to avoid repeated scans.

| Option | Budget basis and limits |
| --- | --- |
| Bun/Hono + SQLite | No separate database service bill. Monthly total is host + durable disk + encrypted off-host backups + domain/identity costs + operator time. No host has been selected, so there is no verified monthly quote; an existing maintained host may reduce incremental cash cost. |
| Workers + D1 Free | Under these assumptions, potentially $0 for compute/database, excluding domain, identity and external backups. Workers includes 100,000 dynamic requests/day and 10 ms CPU/request; static asset requests are free. D1 includes 5 million rows read/day, 100,000 written/day and 5 GB/account; each Free database is capped at 500 MB. Account usage is shared, and scans, indexes, retries or abuse can exhaust allowances. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). |
| Workers + D1 Paid | Workers starts at $5/account/month with 10 million dynamic requests and 30 million CPU ms/month; excess costs $0.30/million requests and $0.02/million CPU ms. D1 includes 25 billion reads, 50 million writes/month and 5 GB; excess is $0.001/million reads, $1/million writes and $0.75/GB-month. Domain, identity and external backups remain separate. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). |

Free quota exhaustion is a save failure, not a reason to claim success locally. Benchmark the authenticated save path against CPU limits, enable usage alerts and revisit the budget before rollout. A free tier does not remove the need for an operational owner.

## Proposed access model

The following is a backend contract for slices 2 and 3, conditional on owner decisions below. Default to one authenticated interviewer owner per sheet, with no sharing between interviewers. Derive `ownerId` from a verified identity/session, never from the form's editable `interviewer` field or a client-supplied owner ID. Each list, read, update, delete, export and link-management query must enforce ownership. Parameterize SQL and validate fields and request sizes server-side.

Participant access is a separate, narrow API. A server-generated, high-entropy bearer token grants access to exactly one sheet and explicit read/write field allowlists; store only its hash, sheet binding, expiry and revocation state. Check them on every read and write, including requests from previously opened tabs. Reject extra/private fields rather than silently accepting them. Until the owner chooses the allowlists, participant access stays disabled.

| Operation | Anonymous visitor (no valid link) | Authenticated interviewer | Valid participant-link holder |
| --- | --- | --- | --- |
| Load app shell / guide | Allow public static assets; no interview data. | Allow. | Allow. |
| Create / import sheet | Deny, require sign-in. | Allow; server assigns authenticated owner. | Deny. |
| List sheets | Deny. | Only owned sheets and their summaries. | Deny; no sidebar data or other-sheet counts. |
| Read / print / export sheet | Deny. | Allow owned sheet only. | Only linked sheet's approved visible fields; print/export must use the same projection. |
| Update sheet | Deny. | Allow owned sheet with matching revision. | Only linked sheet's approved editable fields with matching revision. |
| Delete / change ownership | Deny. | Allow delete of owned sheet; ownership transfer disabled pending policy. | Deny. |
| Issue / revoke / rotate participant link | Deny. | Allow on owned sheet only. | Deny; cannot extend expiry or issue another link. |
| Read database, backups or deployment credentials | Deny. | Deny through the app, even for own sheets. | Deny. |

### Rejection and exposure scenarios

- A visitor guesses a sheet UUID: require interviewer authentication or a valid participant capability; do not return notes, names or summaries. An authenticated non-owner gets the same `404` as a nonexistent sheet, including for update/delete/export/link routes.
- A participant changes the sheet ID in a request: resolve the sheet from the token binding; reject mismatched IDs with a generic `404`. Never fall back to another interview, even if it is accessible to the current interviewer.
- A missing, malformed, expired, revoked or rotated token gets a generic unavailable-link response, no interview fields and no fallback. Rate-limit invalid attempts. A revoked open tab cannot read or save again; clear displayed data on rejection, though already copied notes cannot be recalled.
- A valid link is forwarded or leaked: anyone holding it has the same access until expiry/revocation. Link-only access cannot prove the interviewee's identity. Require explicit owner acceptance; otherwise plan participant authentication before slice 3.
- Keep raw tokens out of query strings, server logs, analytics, error reports and persistent browser storage. Proposed handoff: token in the URL fragment, exchange over HTTPS for a short-lived HttpOnly, Secure, SameSite session scoped to participant routes, then remove the fragment with history replacement. Still check the backing link's status on every request; an exchanged session must not bypass revocation. Use `Referrer-Policy: no-referrer` and no third-party scripts on the participant page.
- Hide create/list/delete controls in participant mode, but enforce every permission on the server. Use CSRF protection and Origin checks for cookie-authenticated mutations; CORS and hidden buttons are not authorization. Return interview responses with `Cache-Control: no-store`; do not share-cache them or log request bodies.
- Requests for `.sqlite`, `-wal`, `-shm`, SQL exports, `.env` or repository configuration must return no files. Package only public assets, keep Bun database/backups outside that directory, and keep D1 access in Worker bindings. Deployment/identity secrets belong in host secret storage, never browser modules or `_site`. If credentials leak, rotate them and invalidate affected sessions/links; removing a public file alone is insufficient.

## Preservation, saves and rollout

### Preserve existing browser data

1. Before moving origins, release an export path on the old Pages origin that reads the existing IndexedDB schema and downloads versioned JSON containing every sheet, field and timestamp. Keep legacy unprefixed grid fields; `fillForm` currently maps them to Individual. PDF is useful for reference but cannot restore structured data.
2. Keep the old origin available as a local-data recovery/export page through an agreed migration window. Each browser profile/device containing notes needs its own export. Do not clear IndexedDB or redirect users away before they can export; a new host cannot retrieve it. Do not silently upload existing interview notes.
3. After sign-in on the new host, preview and explicitly confirm import into the authenticated owner's account. Validate version, field types and size; preserve original IDs/timestamps where safe, add server owner/revision metadata, and remap colliding IDs without overwriting an existing sheet. Track an owner-scoped import key so retrying an acknowledged or timed-out import cannot duplicate it.
4. Compare imported counts and representative full sheets, including legacy grids, then export/download a recovery copy. Keep the original IndexedDB/export until the owner confirms migration and retention requirements. If JSON export fails, show the error, leave local data intact and offer PDF as an emergency copy; do not claim migration succeeded.

### Save and overlap contract

- Store server-managed integer `revision` and timestamps alongside the existing field shape. Updates and deletes use an atomic owner/capability-scoped revision check, incrementing the revision on success. Participant writes patch only allowed fields; sending a whole form must not blank hidden notes.
- Serialize saves per sheet in the client and capture the sheet ID, payload and base revision per request. Keep newer edits dirty while an older request completes; only acknowledge the submitted snapshot, never mark subsequent typing saved. Navigation must not apply an old response to a different sheet.
- A stale revision returns `409 Conflict` without overwriting data. Stop automatic retries, retain the unsaved draft and offer comparison with the latest permitted fields; the user explicitly merges/reapplies against the new revision. Apply this to two tabs, two devices and interviewer/participant overlap. Do not use client clocks or silent last-write-wins.
- Network loss, timeout, quota, disk-full or server errors leave a visible unsaved state and a retry/export option. Preserve a recoverable local draft where permitted, distinguish “saved on this device” from “saved to server,” and never show server success before commit acknowledgment. If local draft persistence also fails, keep the in-memory draft and offer immediate download. Local participant drafts contain only permitted fields and are cleared on sign-out/revocation when detected; retention on shared devices needs owner policy.
- On an ambiguous timeout, refetch and compare the submitted snapshot/revision before retrying; use idempotency keys for creates/imports. On `401`, retain the draft and require reauthentication; on `403`/unavailable link, stop retries and require renewed access. A delete must not be undone by a delayed save; updates never upsert missing sheets.
- `pagehide`/visibility events cannot guarantee a completed network save. Show pending changes, attempt ordinary saves early, warn before navigating with unsaved work and retain recovery options; background sync is not a prerequisite for slice 2.

### Deployment transition and recovery

- Prefer serving public assets and `/api/*` from one HTTPS origin for either option. Replace the Pages publishing job with the selected host deployment; keep an explicitly maintained old-origin exporter during migration. Retaining Pages plus a separate API is possible but adds credential/CORS configuration and is not the recommended first slice.
- Bun: replace root static serving with an allowlisted public directory, configure an absolute durable database path, supervision, TLS, migrations and backup jobs. Workers: add a Worker entrypoint, Wrangler assets/D1 configuration and separate staging/production bindings; route `/api/*` through the Worker before asset handling, with API errors never rewritten to `index.html`. Only public assets go in the upload directory. [Routing documentation](https://developers.cloudflare.com/workers/static-assets/).
- Keep relative asset links working when moving from `/agentic-mapping/` to the new origin. Update local scripts, deployment credentials and README only in the selected implementation slice; do not introduce a frontend build requirement.
- Before enabling remote writes, test persistence after restart/redeploy and restore a backup into isolated staging. Proposed baseline: daily encrypted external backups, 30-day retention, at most 24 hours of data loss and restoration within one working day; the owner must accept or revise these targets and retention rules.
- Use additive migrations and a backup before schema changes. On a bad release, disable writes, preserve the database/drafts and roll back to compatible code or restore in staging first. Do not revert to independent browser-only writes as a silent fallback. A database restore may resurrect revoked links: invalidate participant sessions/links before reopening access.

## Conditional recommendation and implementation slices

**Prefer Workers static assets + D1 if the owner accepts Cloudflare hosting, its costs/data handling and an interviewer identity provider.** With small-scale usage and minimal ongoing maintenance as the priority, managed persistence and recovery outweigh the extra platform resource. Choose Bun/Hono + SQLite instead if an existing durable host has a named operator who accepts patching, backups and restore duties, or hosting requirements rule out Cloudflare. This is a design recommendation, not a hosting approval; neither option grants application-level interview permissions automatically.

| Slice | Affected files and deliverable | Evidence required before release |
| --- | --- | --- |
| 1: this spike | `docs/storage-decision.md`, `README.md`: comparison, access contract and migration design. | Review official sources, repository references and the owner decisions below. No runtime change. |
| 2: persistent storage + interviewer ownership | `server.ts` for Bun, or new `worker.ts` + `wrangler.jsonc` for Workers; new server-only storage/auth modules and `migrations/`; `client/db.js` becomes the API adapter while retaining explicit legacy export/import support; `client/app.js` gains authenticated lists, explicit missing-sheet states, revisions and recovery; `index.html` gains sign-in/import/save states and updated local-storage wording; `.github/workflows/pages.yml`, `package.json`, `bun.lock`, `README.md` gain the chosen deployment/tooling. Keep the old-origin export path available. Participant endpoints remain disabled. | Owner A cannot list/read/write/delete/export/manage links on B's sheet; forged owner IDs fail. Browser data export/import survives retries and collisions; offline/failed saves and two-device conflicts preserve notes. Redeploy and restore preserve server data; public-file probes reveal no database/secrets. |
| 3: participant completion links | Selected backend entrypoint/auth/storage modules and new link migration; `client/app.js` and `index.html` gain a restricted participant view; `client/db.js` gains the scoped API; deployment headers and `README.md` document expiry, rotation, revocation and handoff. | Participant sees/edits only approved fields on the linked sheet; no list or cross-sheet access. Invalid/revoked/expired links and guessed IDs reveal no interviews. Test revocation after session exchange, open-tab writes, overlap conflicts and restricted PDF output. |

### Human decisions before planning the implementation

- **Hosting and operations:** confirm that setup/maintenance outweigh large-scale needs; choose Cloudflare or a named Bun host/operator, account/billing owner, data-location requirements, budget, retention and recovery targets.
- **Interviewer identity and ownership:** choose an identity provider and invited-user policy; confirm one owner per sheet or specify team access, transfer and departing-interviewer rules. An editable interviewer name cannot establish ownership.
- **Visible/editable fields:** approve explicit participant read and write allowlists across identity, client context, reflections and all grids; decide whether private interviewer notes need separate fields. Default participant access to disabled until agreed.
- **Link-only access:** explicitly accept that any holder can use a link, or require participant login; choose expiry, issuer/revoker rights and local-draft policy for shared devices. Review this before planning slice 3.
- **Existing notes:** approve uploading local interview data, the old-origin export window and how long local exports and backups may retain it. Preserve the current local-only behavior until slice 2 is approved and released.
