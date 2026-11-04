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

## Hosted validation still required

No GitHub access or live deployment was performed for this report. Local serving
cannot establish Pages settings, permissions, artifact replacement, caching,
environment approvals or deployment concurrency semantics.
