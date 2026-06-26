# Plan 999-050: Wake PR Orchestrator From Dispatched Workers

## Status: COMPLETE

## What Changed

### Problem
PR #216 reached a stale `pr-flow/ready=pending` state after Code Review completed. The PR Orchestrator dispatched `code-review.yml` but no later orchestrator run observed the completed worker and advanced the flow.

### Root Cause
`antigravity-code-review.yml` — the only dispatched worker in `pr-flow.json` missing the wake-up contract — had no `wake-orchestrator` job, no `orchestrated` input, and no `actions: write` permission. Workers complete but the orchestrator was never re-woke to evaluate the next step.

### Changes Made

1. **`antigravity-code-review.yml`** — Added `actions: write` permission, `orchestrated` and `base_ref` workflow_dispatch inputs, and `wake-orchestrator` job that dispatches `pr-flow.yml` with `dry_run=false` (matching the pattern in `code-review.yml`, `dependency-review.yml`, `pr-improve.yml`, `pr-finalizer.yml`).

2. **`worker-wake-invariant.test.cjs`** — New invariant test file (2 tests) verifying:
   - All dispatched workers (from `pr-flow.json`) have `actions: write`, `orchestrated` input, and `wake-orchestrator` job.
   - All `wake-orchestrator` jobs dispatch `pr-flow.yml` with `dry_run=false` and gate on `orchestrated == 'true'`.

3. **`docs/workflow-e2e-scenarios.md` §5c** — New section documenting the dispatch-chain rule: every dispatched worker must wake `pr-flow.yml` after completing, with contract requirements, Mermaid diagram, and worker status table.

## Verification

- All 383 workflow e2e tests pass (including 2 new invariant tests).
- All 648 project tests pass (0 failures).
- ESLint: 0 errors. Prettier: all files formatted.
- `workflow_run` remains as a backup path (not removed).

## Self-Check: PASSED

- [x] All tasks executed
- [x] Each task committed individually
- [x] Implementation scoped to source artifact intent
- [x] No unrelated refactors
- [x] Tests added for new behavior
- [x] Documentation updated
