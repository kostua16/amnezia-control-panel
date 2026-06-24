# Plan 999-041: Fix PR orchestrator stalled review fan-out

## Status: COMPLETE

## Self-Check: PASSED

## What was built

Fixed the PR Orchestrator check gate so a completed CI `workflow_run` can fan out
to code review and finalizer workflows even when `gh pr checks` cannot see the PR
check contexts.

Two fallback paths were wired into the existing check evidence pipeline:

1. **Non-workflow_run events** (issue_comment, pull_request_target, workflow_dispatch):
   Enabled the existing `allowRunListFallback` parameter when calling
   `collectCheckEvidence` from the orchestrator. When `gh pr checks` fails or
   returns all required checks as missing, the pipeline now falls back to
   `collectChecksFromWorkflowRuns`, which searches for completed workflow runs
   matching the PR head SHA and reads their job conclusions.

2. **workflow_run events** with partial coverage: When the triggering workflow_run's
   jobs don't cover all required check groups (e.g., CI completed but PR Policy
   not yet), the pipeline chains to `collectChecksFromWorkflowRuns` as a second
   attempt before returning `flow/checks-unavailable`.

## Files changed

- `.github/workflows/scripts/orchestrate-pr-flow.cjs` — enabled `allowRunListFallback: true`
  in the orchestrator's call to `collectCheckEvidence`
- `.github/workflows/scripts/required-check-evidence.cjs` — chained broader fallback in
  the workflow_run-specific path when required checks are missing
- `.github/workflows/scripts/__tests__/required-check-evidence.test.cjs` — new test file
  with 23 tests covering fallback paths, unavailable states, and helper functions

## Key files created

- `.github/workflows/scripts/__tests__/required-check-evidence.test.cjs`

## Items verified not in scope

- Explicit `checks: read` and `statuses: write` permissions already existed in the
  workflow YAML
- `flow/checks-unavailable` diagnostic label already defined in `pr-flow.json`
- Check source diagnostics (`checkSource`, `checkSourceReason`) already included in
  orchestrator JSON output summary

## Proposals deferred

None — all proposals in the source artifact were addressed.
