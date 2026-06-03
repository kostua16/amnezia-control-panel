---
status: complete
completed: 2026-06-03
quick_id: 260603-x6b
---

# Summary

Fixed PR-flow aggregate status behavior for manual-review PRs such as PR #209.

## Evidence

- PR #209 head `b42326aa97438af4d30a3675d226c0c2e2d8be78` had green required checks.
- PR Orchestrator run `26905276751` set `pr-flow/ready=failure` only because `needs-review` appeared in `blocking_labels_present`.
- Worker diagnostic contexts were left pending even though no worker would be dispatched while the label blocked orchestration.

## Changes

- Treat `needs-review` as a manual-review marker instead of a hard required-status blocker.
- Complete manual-only/manual-review PRs as `flow/manual-only` after CI is green.
- Publish `pr-flow/ready=success` for manual-only completion while keeping hard blockers as failures.
- Mark worker diagnostic contexts as N/A for manual-only PRs.
- Document the distinction between manual-review markers and hard blockers.
- Added regression tests for PR #209-style manual audit PRs.

## Verification

- `rtk node --check .github/workflows/scripts/orchestrate-pr-flow.cjs`
- `rtk node --import tsx --test src/lib/__tests__/orchestrate-pr-flow.test.ts`
- `rtk npm test`
- `rtk npm run lint`
- `rtk npm run format:check`
- `rtk npx tsc --noEmit`
- `rtk proxy npx prettier --check .github/workflows/scripts/orchestrate-pr-flow.cjs src/lib/__tests__/orchestrate-pr-flow.test.ts .github/workflows/documentation.md .planning/quick/260603-x6b-fix-pr-flow-ready-status-stuck-on-needs-/260603-x6b-PLAN.md`
- `rtk actionlint .github/workflows/pr-flow.yml .github/workflows/pr-finalizer.yml`
