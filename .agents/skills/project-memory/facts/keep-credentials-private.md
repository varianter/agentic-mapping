Keep real passwords, account hashes, tokens and private keys outside the checkout and public assets; use only synthetic test credentials. Check tracked files and local Git history for accidental secrets without printing their values; if any leak, revoke/rotate them, since adding ignore rules or deleting files does not erase history.

**Why:** [PR #10 secret review](https://github.com/varianter/agentic-mapping/pull/10) (`IC_kwDOVimoJc8AAAABi5PIdA`) explicitly requires that no keys or secrets are exposed in the repository.
