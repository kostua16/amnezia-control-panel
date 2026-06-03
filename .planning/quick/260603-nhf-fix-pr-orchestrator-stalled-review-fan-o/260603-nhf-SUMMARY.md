---
status: complete
completed: 2026-06-03
quick_id: 260603-nhf
---

# Summary

Fixed the PR Orchestrator check gate that kept PR #200 stuck at
`flow/checks-pending` after CI completed.

## Changes

- Added explicit `checks: read` and `statuses: read` permissions to
  `pr-flow.yml`.
- Added `flow/checks-unavailable` as a diagnostic state and documented it.
- Added check collection diagnostics to the orchestrator JSON output.
- Added a completed CI `workflow_run` job fallback when `gh pr checks` reports
  all required checks missing or cannot read PR check contexts.
- Added unit coverage for PR-open pending checks, workflow-run job fallback,
  failed fallback jobs, unavailable checks, and finalizer dispatch after review
  labels.

## Verification

- `rtk npx prisma generate`
- `rtk npm test`
- `rtk npm run lint`
- `rtk npm run format:check`
- `rtk npx tsc --noEmit`
- `rtk npx prettier --check .github/pr-flow.json .github/workflows/pr-flow.yml .github/workflows/documentation.md .github/workflows/scripts/orchestrate-pr-flow.cjs src/lib/__tests__/orchestrate-pr-flow.test.ts`
- `rtk actionlint .github/workflows/pr-flow.yml`
