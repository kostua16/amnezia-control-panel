---
status: complete
quick_id: 260609-q9l
date: 2026-06-09
---

# Quick Task 260609-q9l Summary

Gated `PR Orchestrator` label-only triggers to PR-flow-relevant labels.

## Completed

- Confirmed from live GitHub data that PR `#264` created four `pull_request_target` orchestrator runs for the same SHA because the PR was opened with three labels (`javascript`, `auto-fix`, `needs-review`) and `pr-flow.yml` woke on every `labeled` event.
- Added a `pr-flow-pull-request-target` mode to `.github/workflows/scripts/evaluate-trigger-policy.cjs` that always allows normal PR lifecycle events and allows label churn only when the changed label affects PR-flow policy or worker state.
- Updated `.github/workflows/pr-flow.yml` to evaluate that gate immediately after checkout and skip the expensive setup/orchestration path for irrelevant label events.
- Added regression tests for the new trigger-policy mode plus a workflow invariant that protects the new gate.

## Verification

- `rtk npm install`
- `rtk npx prisma generate`
- `rtk npm test`
- `rtk npm run lint`
- `rtk proxy npx prettier --check .github/workflows/pr-flow.yml .github/workflows/scripts/evaluate-trigger-policy.cjs src/lib/__tests__/trigger-policy.test.ts src/lib/__tests__/pr-flow-watchdog.test.ts .planning/quick/260609-q9l-pr-flow-label-trigger-gate/260609-q9l-PLAN.md`
- `rtk actionlint .github/workflows/pr-flow.yml`
- `rtk git diff --check`
