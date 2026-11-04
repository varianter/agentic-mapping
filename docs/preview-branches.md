# Preview branches: feasibility report

## Verdict

One combined static site containing production and preview subdirectories is a
practical design for **trusted changes reviewed with disposable browser data**.
Local path compatibility is verified below; hosted Pages behavior still needs
the human-run checks at the end. This report does not enable deployments.

Do not use same-origin previews for untrusted code or real interview notes.
Separate database names could avoid accidental collisions, but cannot protect
production storage from preview JavaScript. Isolation requires a separate origin
outside this proposed subdirectory design.

## Existing deployment: repository evidence

- [pages.yml](../.github/workflows/pages.yml) runs on pushes to `main` and manual dispatch; the dispatch definition does not restrict the selected ref.
- It checks out the selected ref, copies `index.html guide.html app.js db.js styles.css img` into `_site/`, adds `.nojekyll`, then uses `configure-pages@v5`, `upload-pages-artifact@v3` and `deploy-pages@v4`.
- It requests `contents: read`, `pages: write`, `id-token: write`, targets the `github-pages` environment and exposes the deployment's `page_url`.
- The `pages` concurrency group has `cancel-in-progress: true`; there is no preview trigger, preview inventory or combined-site assembly.
- This is **Actions artifact publishing**, not publishing a `gh-pages` branch. No branch-writing step exists in the workflow; repository settings and any remote branch existence were not inspected.
- [README](../README.md) records production at `https://varianter.github.io/agentic-mapping/`. This address and the Pages source/environment settings were not checked against the hosted service.
- [index.html](../index.html) and [guide.html](../guide.html) use relative CSS, script, logo and navigation URLs; [app.js](../app.js) imports `./db.js` and uses fragment-only sheet links. The font in [styles.css](../styles.css) uses the absolute Varde CDN URL.
- [server.ts](../server.ts) serves its current working directory with Hono on Bun. It is a local tool, excluded from the deployed static-file list.

Treat each publication as a complete site replacement. A preview-only artifact
would omit production and other previews; separate branch deployments cannot be
assumed to merge directories into the existing site.

## Proposed lifecycle (design, not implemented)

Use a single trusted publisher, with its workflow and tools taken from `main`.
Start with maintainer dispatch on `main` and scheduled reconciliation; automatic
event triggers are a later implementation decision. Maintain an explicit,
maintainer-controlled allowlist of same-repository PRs and resolve each PR's
current branch/head SHA. A branch without a PR needs a PR before previewing.

| Concern | Proposed behavior |
| --- | --- |
| Create | After maintainer approval, assemble an allowlisted PR's static files at `previews/pr-<number>/`; use numeric IDs, never raw branch names as filesystem paths. |
| Update | Resolve the current head SHA on every reconciliation and replace that preview directory; show its SHA and publication time in an inventory. |
| Remove | Omit a preview when the PR closes/merges, the branch disappears or approval is withdrawn; rebuild the inventory too. A scheduled reconciliation catches missed events. |
| Discover URLs | Generate `previews/index.html` with links, PR numbers and exact SHAs. Use the publisher's actual Pages base URL plus `previews/pr-<number>/`; expose the index through the deployment summary. PR comments are optional future automation. |
| Preserve production | Collect the latest `main` static files at the artifact root on every run, then add all approved previews. Keep the normal production entry points at `/agentic-mapping/`. |
| Retain other previews | Rebuild every currently approved preview from pinned source SHAs into each artifact; do not depend on downloading the previous deployment or expiring CI artifacts. |
| Concurrent publishing | Replace the existing main-only publisher with this sole combined publisher; all triggers share one deployment concurrency group with active-run cancellation disabled. Resolve current desired state after acquiring that slot. |
| Stale runs/failures | Recheck source SHAs and approval before deploy; discard/reassemble stale candidates. Fail before deployment if any required copy is missing. Reconcile again after changes during publication; hosted failure/atomicity behavior remains unverified. |

The resulting artifact would be:

```text
_site/
  index.html, guide.html, app.js, db.js, styles.css, img/, .nojekyll
  previews/
    index.html                     # generated inventory
    pr-4/                         # same static-file list
    pr-5/                         # same static-file list
```

There is no separate preview hosting service or deployment branch in this design.
Reassembly costs increase with the number of previews; keep the approved set
small. Publish only after complete assembly, so cleanup cannot remove production
from an otherwise valid artifact. Confirm hosted replacement and failure behavior
before relying on that property.

### Trust and permissions

- Give only the trusted publisher `contents: read`, `pages: write` and `id-token: write`, subject to the `github-pages` environment's deployment rules. Do not grant publication credentials to candidate branch workflows.
- Fetch candidate source as data at pinned SHAs; copy only the existing static-file allowlist. Reject symlinks, path traversal and entries outside that list. Do not run candidate scripts, install hooks, workflow code or server code in the privileged publisher.
- Same-repository branches still need explicit approval: their browser JavaScript can read, change or delete all production sheets stored on the shared origin. Any revised SHA needs renewed trust review before publication.
- Exclude fork PRs and other untrusted code from this same-origin design. Withholding workflow secrets does not protect browser data after hostile static JavaScript is published.
- Never use a privileged `pull_request_target` job to check out and execute candidate code. If event automation is added later, its trusted entry point must only pass validated identifiers to the publisher.
- Pending runs may be coalesced or arrive out of order; the publisher must reconcile current state rather than apply event deltas. Validate the actual Pages/concurrency behavior in hosted checks.

## Reproduce locally

Run from the repository root in one shell. Use a spare port and a **new disposable
browser profile** with no real notes. Keep the same hostname and port for every
copy; switching either would hide the shared-storage behavior. A fresh Playwright
browser context also works. Use localhost so the browser has a secure context
for `crypto.randomUUID()`.

```sh
bun install
preview_repo="$PWD"
preview_stage="$(mktemp -d "${TMPDIR:-/tmp}/agentic-previews.XXXXXX")"
for preview_copy in agentic-mapping agentic-mapping/previews/pr-4 agentic-mapping/previews/pr-5; do
  mkdir -p "$preview_stage/$preview_copy"
  cp -R index.html guide.html app.js db.js styles.css img "$preview_stage/$preview_copy/"
done
touch "$preview_stage/agentic-mapping/.nojekyll"
(cd "$preview_stage" && PORT=14321 bun "$preview_repo/server.ts")
```

This uses the workflow's exact static-file list and the existing server, whose
dependencies resolve from the repository while its static root is the temporary
directory. These are three identical source copies, not different branch builds;
this checks the path/storage design only. Nothing is staged in the worktree.

| Copy | Local URL |
| --- | --- |
| Production | `http://localhost:14321/agentic-mapping/` |
| Preview 4 | `http://localhost:14321/agentic-mapping/previews/pr-4/` |
| Preview 5 | `http://localhost:14321/agentic-mapping/previews/pr-5/` |

### Paths and behavior

For each URL, with DevTools Network and Console open:

1. Wait for the sheet list to finish loading. Click **New sheet**, wait for the blank form, then enter a synthetic name (`DISPOSABLE preview 0`, `1`, `2`) and an Individual note. Wait for `Saved <time>` before reloading; the same name and note should return.
2. Switch to **Team** and **Organization**; each tab should display its matching panel. Open a sheet through its sidebar link; only the URL fragment should change.
3. Follow **Interviewer guide**, then **Capture sheets**. Both navigation URLs must stay under the current copy's directory; directly reload both `index.html` and `guide.html` there.
4. Confirm `index.html`, `guide.html`, `app.js`, `db.js`, `styles.css`, `img/variant-logo-light.svg` and `img/variant-logo-dark.svg` return HTTP 200 under that copy. The guide has no script of its own. Both capture-sheet logos and the guide logo should render, with the yellow buttons and styled layout present.
5. Check for browser exceptions and failed requests. The external Britti Sans font is a separate CDN dependency; record its result separately from nested-path compatibility.

Use trailing slashes for directory URLs. Redirects without a trailing slash and
hosted 404 behavior remain hosted checks.

### Disposable-browser storage check

Do this within the **same disposable browser profile**, after the path check:

1. In production, select `DISPOSABLE preview 0` and copy its `#<sheet-id>` fragment. All three copies should now list the three synthetic sheets after reload.
2. Open preview 4 with that fragment. It should display the production-created sheet. Rename it `DISPOSABLE edited in pr-4`, wait for `Saved <time>`, then reload production and preview 5 with the same fragment; both should show the edit. Existing tabs do not live-sync, so reload before comparing.
3. In preview 5's DevTools Console, run the read-only code below. It directly addresses production's database name from a preview path; it should print the synthetic records regardless of the preview's own preferred database name.
4. Close the production sidebar with its toggle. Reload preview 4 at desktop width (over 900px); its sidebar should also be closed.
5. Delete `DISPOSABLE edited in pr-4` in preview 5, confirm **Delete sheet**, then reload production. The sheet should be gone there too.

```js
const request = indexedDB.open('agentic-mapping', 1);
request.onsuccess = () => {
  const database = request.result;
  const transaction = database.transaction('sheets', 'readonly');
  const records = transaction.objectStore('sheets').getAll();
  transaction.oncomplete = () => {
    console.table(records.result.map(({ id, fields }) => ({ id, name: fields.name })));
    database.close();
  };
};
```

[db.js](../db.js) always opens IndexedDB `agentic-mapping`, version 1, store
`sheets`; [app.js](../app.js) autosaves there after a 400ms debounce and stores
the sidebar preference under localStorage key `sidebar`. The browser origin is
scheme + host + port, not URL path. All three copies therefore share both stores.

Renaming a preview database could prevent accidental edits by cooperative code,
but it creates no permission boundary: preview JavaScript can explicitly open
`agentic-mapping` and read/write/delete its records, just as the read-only probe
does. Any other application under the same Pages origin also shares this origin
boundary. A separate path, repository path or database name does not isolate
untrusted code.

Afterward, stop the server with Ctrl-C, close and discard the disposable browser
profile, then remove only the generated temporary directory in that same shell:

```sh
rm -r -- "$preview_stage"
```

### Recorded local results

Checked on 2026-11-04 against source commit `a1bed72`, using Bun 1.3.12 and
headless Chromium 151.0.7922.34 through Playwright in a fresh, nonpersistent
1440×1000 browser context. The staging commands above were executed unchanged.

| Check | Production | Preview 4 | Preview 5 |
| --- | --- | --- | --- |
| Directory, `index.html`, `guide.html` | Loaded | Loaded | Loaded |
| Guide and back links | Stayed in copy | Stayed in copy | Stayed in copy |
| App and DB modules | HTTP 200, executed | HTTP 200, executed | HTTP 200, executed |
| CSS and both SVG logos | HTTP 200, rendered | HTTP 200, rendered | HTTP 200, rendered |
| Create, autosave, reload, Team tab | Passed | Passed | Passed |
| Visible sheet count after each creation | 1 | 2 | 3 |

All seven required resource URLs per copy returned HTTP 200 (21 checks), with no
page exceptions, failed requests or HTTP errors. The yellow CSS token resolved
to `#FFD42F`, logo images had nonzero natural widths, and the Varde font returned
HTTP 200 and loaded. Preview 4 read/edited production's synthetic sheet; production
and preview 5 saw that edit after reload. Preview 5 directly read the named
database and deleted that sheet; it disappeared from production after reload.
Closing production's sidebar was reflected in preview 4 after reload. The browser
context was discarded after the check; no real interview data was used.

These results establish local path compatibility and shared storage only, not
hosted deployment correctness or browser coverage beyond this Chromium version.

## Hosted validation still required

No GitHub access or live deployment was performed for this report. Local serving
cannot establish Pages settings, permissions, artifact replacement, caching,
environment approvals or deployment concurrency semantics.
