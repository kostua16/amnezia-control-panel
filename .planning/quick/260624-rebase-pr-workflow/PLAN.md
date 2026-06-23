---
status: complete
---

# Add `/rebase` Branch-Refresh Workflow

Add a maintainer-triggered `rebase-pr.yml` that rebases one open same-repo PR onto its current base branch. Clean rebases validate and push with `--force-with-lease`; `run-zai` (opus) resolves conflicts only when Git enters a conflict state. A branch-refresh tool, never a merge tool. Source: `.planning/ideas/rebase-wf-plan.md`.

## Tasks

- Add `rebase-pr` mode to `evaluate-trigger-policy.cjs` (exact-body `/rebase`, maintainer-only, PR-only, dispatch).
- Add `evaluate-rebase-eligibility.cjs` (narrower than merge — only `do-not-merge` blocks a rebase; head-SHA stale guard).
- Add `upsert-rebase-comment.cjs` sticky summary (started / conflict-working / complete / validation-failed / push-rejected / skipped / failed).
- Add `<!-- rebase-pr-summary -->` to `collect-review-feedback.cjs` noise markers.
- Add `rebase-pr.yml` mirroring `fix-review.yml` (trust model, concurrency "ignored" branch, `validate-pr-gate`); push with `--force-with-lease`, disable auto-merge, wake pr-flow.
- Tests: trigger-policy (7), eligibility (10), comment (21), concurrency guard, e2e scenario §6e.
