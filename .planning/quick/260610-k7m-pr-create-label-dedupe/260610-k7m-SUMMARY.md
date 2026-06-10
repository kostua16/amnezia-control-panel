---
status: complete
quick_id: 260610-k7m
date: 2026-06-10
---

# Quick Task 260610-k7m Summary

Moved automation PR label application out of `gh pr create` and into a single post-create edit step.

## Completed

- Confirmed from run `27242499395` plus issue events on PR `#275` that the shared automation PR create path emitted duplicate `auto-fix` and `needs-review` label events, which spawned four cancelled `PR Orchestrator` runs before the surviving run started.
- Updated `.github/actions/upsert-pull-request/action.yml` so existing PR updates use `gh pr edit --add-label`, while new PRs are created first and then labeled once afterward.
- Preserved the helper's tolerant behavior: if post-create label application fails, the PR still exists and the action emits a warning instead of failing the whole workflow.
- Added `src/lib/__tests__/upsert-pull-request-action.test.ts` to pin the create-before-label and `--add-label` contracts.

## Verification

- `rtk node --import tsx --test src/lib/__tests__/upsert-pull-request-action.test.ts`
- `rtk npx --cache /private/tmp/npmcache eslint src/lib/__tests__/upsert-pull-request-action.test.ts`
- `rtk npx --cache /private/tmp/npmcache prettier --check .github/actions/upsert-pull-request/action.yml src/lib/__tests__/upsert-pull-request-action.test.ts .planning/quick/260610-k7m-pr-create-label-dedupe/260610-k7m-PLAN.md`
- `rtk git diff --check`

## Notes

- The first `npm test` attempt exposed missing local dependencies in this worktree; I installed them with `rtk npm install --cache /private/tmp/npmcache` before rerunning the targeted checks.
