---
status: complete
completed: 2026-06-03
quick_id: 260603-u1d
---

# Summary

Implemented PR Orchestrator visibility and aggregate required status support.

## Changes

- Added PR-flow status config for `pr-flow/ready` plus worker diagnostic contexts.
- Updated `pr-flow.yml` to write commit statuses and wake on PR Finalizer completion.
- Extended `orchestrate-pr-flow.cjs` to publish PR-head commit statuses, upsert a sticky orchestration comment, surface dispatch failures, and preserve JSON summaries before failing.
- Added conditional explicit bot allowlists for orchestrator-dispatched Claude/ZAI worker runs.
- Documented workflow_dispatch visibility limitations, the run-name contract, required `pr-flow/ready`, and the allowed-bots rule.
- Added focused tests for status mapping, sticky comments, dispatch failure behavior, workflow wakeups, and bot allowlists.

## Verification

- `rtk npx prisma generate`
- `rtk node --check .github/workflows/scripts/orchestrate-pr-flow.cjs`
- `rtk npm test`
- `rtk npm run lint`
- `rtk npm run format:check`
- `rtk npx tsc --noEmit`
- `rtk proxy npx prettier --check .github/pr-flow.json .github/workflows/pr-flow.yml .github/workflows/code-review.yml .github/workflows/dependency-review.yml .github/workflows/pr-improve.yml .github/workflows/documentation.md .github/workflows/scripts/orchestrate-pr-flow.cjs src/lib/__tests__/orchestrate-pr-flow.test.ts src/lib/__tests__/pr-flow-watchdog.test.ts .planning/quick/260603-u1d-implement-pr-orchestrator-visibility-and/260603-u1d-PLAN.md`
- `rtk actionlint .github/workflows/pr-flow.yml .github/workflows/code-review.yml .github/workflows/dependency-review.yml .github/workflows/pr-improve.yml`
