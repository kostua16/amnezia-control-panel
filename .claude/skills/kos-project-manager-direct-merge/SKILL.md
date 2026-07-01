---
name: kos-project-manager-direct-merge
description: Direct merge safety rules for project-manager fallback merge paths, including stalled ready PRs and manual-only PRs.
user-invocable: true
when_to_use: "When project-manager reviews or executes a direct merge fallback."
category: workflows
keywords: [project-manager, direct-merge, manual-only, finalizer, maintainer-rejection]
metadata:
  author: project-manager
  license: repo
  version: "1.0"
---

# Project Manager Direct Merge

Direct merge is the fallback path when PR-flow/finalizer stalls or cannot handle a manual-only PR.

## Merge allowed

Merge only when:

- Current head required checks passed.
- Current head review signals passed, or maintainer approval exists for manual-only fallback.
- Project-manager read-only PR review returns exact `decision: "merge"`.
- No maintainer rejection exists.

Manual-only PRs also require either maintainer approval or 8 hours since `ready_since`.

## Maintainer rejection

Any of these block direct merge:

- Current-head maintainer `CHANGES_REQUESTED`.
- `do-not-merge`.
- `needs-review` added or renewed after `ready_since`.
- Maintainer comment containing exact text `project-manager: hold`.

## Failure behavior

- Invalid review JSON means hold.
- Merge command failure creates/reuses a workflow issue and `/fix`es it.
- Do not use `--auto`; direct merge uses squash merge.
