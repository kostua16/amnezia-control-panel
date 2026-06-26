# Plan 999-047 Summary: PR #191 workflow improvement quick tasks

## Status: Complete

## What Was Built

Audited the 6 quick-task proposals from the PR #191 source artifact against the live codebase. Found that 4 of 6 were already implemented in a prior pass. Implemented the 2 remaining actionable items and added comprehensive test coverage.

## Changes

### 1. Run-name contract documentation (Proposal 4)

Added a JSDoc block to `matchesWorkerTitle()` in `orchestrate-pr-flow.cjs` documenting the two-token contract (`PR #N` + head SHA) that worker run-names must satisfy. References downstream consumers (`summarizeWorkerRuns`, `getWorkerSummary`) so maintainers know to keep the contract in sync.

**File:** `.github/workflows/scripts/orchestrate-pr-flow.cjs:384`

### 2. resolvePrNumber test coverage (Proposal 5)

Added 11 unit tests covering all `resolvePrNumber` code paths:

- Explicit `pr_number` override
- `issue_comment` with `pull_request`
- `pull_request_target` and `pull_request` events
- `workflow_run` from `pull_requests` payload
- `workflow_run` from `display_title` regex
- `workflow_run` from `name` when `display_title` is null (tests the `??` fallback)
- `inputs.pr_number` for non-workflow_run events
- Null/missing returns
- Non-numeric explicit rejection

**File:** `.github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs`

## Proposals Already Implemented (no changes needed)

### Proposal 1: Handle dispatchWorker failures gracefully

Already implemented at `orchestrate-pr-flow.cjs:1872-1887`. The main loop wraps `dispatchWorker` in a try/catch, calls `decisionWithDispatchError()` to set the matching `flow/*-failed` label, and logs the error via `formatCommandError`. The `dispatchOutcome` object is threaded into `buildFlowVisibility` and `renderFlowComment` so the PR comment reflects the failure.

### Proposal 2: Add orchestrator decision as a PR status check or comment

Already implemented at `orchestrate-pr-flow.cjs:1920-1929`. The orchestrator calls `upsertFlowComment()` which uses the shared `sticky-comment.cjs` helper to create/update a sticky PR comment with the full decision context: worker statuses, next steps, controls, and dispatch outcome. The `renderFlowComment()` function produces a markdown table of all worker states.

### Proposal 3: Extract ensureLabels into a one-time setup or conditional path

Already gated behind `--ensure-labels` CLI flag / `ENSURE_LABELS` env var (`orchestrate-pr-flow.cjs:1748-1749`). The flag is opt-in, so `ensureLabels()` only runs when explicitly requested — not on every orchestration invocation.

### Proposal 6: Either use or remove the orchestrated input on worker workflows

The `orchestrated` boolean input is actively used by all four worker workflows. In `code-review.yml`, `dependency-review.yml`, and `pr-improve.yml`, it gates the `allowed-bots` filter (allowing automation bots when orchestrated). In all four workers, it gates the `always()` cleanup step that resets labels and dispatches next workers. Not dead code — no change needed.

## Self-Check: PASSED

- [x] All tasks executed
- [x] Each task committed individually
- [x] Tests pass (648/648 project, 374/374 workflow e2e, 26/26 orchestrator)
- [x] Lint clean
- [x] Prettier clean
- [x] No modifications to shared orchestrator artifacts

## Proposals deferred

- **Proposal pr191.1 (Centralize trust policy in the orchestrator):** Phase-scope architectural change, not a quick-task. Requires restructuring event routing, policy evaluation surface, and manual-only path enforcement.
- **Proposal pr191.2 (Add retry logic and rate-limit awareness):** Phase-scope improvement. Requires configurable retry with exponential backoff, API pagination refactor, and a re-trigger mechanism.
- **Proposal pr191.3 (Wire orchestrator decision into finalizer gating):** Phase-scope improvement. Requires structured input passing, label-based trust validation, and commit status emission.
- **Proposal pr191.4 (Integrate orchestrator with GSD planning PR lifecycle):** Phase-scope improvement. Requires planning artifact feedback loop, head-SHA dedup, and ROADMAP auto-linking.
