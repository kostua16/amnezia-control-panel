---
phase: 999
plan: 999-048
title: "PR Orchestrator Visibility And Required Aggregate Status"
subsystem: "GitHub Workflows"
tags: ["github-actions", "pr-flow", "commit-status", "e2e-tests"]
dependency_graph:
  requires: []
  provides: ["commit-status-visibility", "e2e-documentation"]
  affects: ["pr-flow.yml", "orchestrate-pr-flow.cjs"]
tech_stack:
  added: []
  patterns: ["commit-status-publishing", "sticky-comments", "e2e-scenario-catalog"]
key_files:
  created: []
  modified:
    - ".github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs"
    - "docs/workflow-e2e-scenarios.md"
decisions: []
metrics:
  duration: "15 minutes"
  completed_date: "2026-06-26"
---

# Phase 999 Plan 999-048: PR Orchestrator Visibility And Required Aggregate Status Summary

## Overview

Implemented focused tests for the `buildFlowVisibility` function and added comprehensive E2E scenario documentation for the PR Flow commit-status visibility system. The implementation adds test coverage for the visibility layer that publishes aggregate and worker statuses to PR commits and maintains a sticky PR comment showing orchestration state.

## Changes Made

### 1. Focused Tests for buildFlowVisibility

**File:** `.github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs`

Added 7 new test cases covering:

- **Draft PR state:** All workers show pending when PR is draft
- **Checks failed:** Aggregate shows failure, workers pending when required checks fail  
- **Review passed:** Workers show success when `ai-review-passed` + `security-review-passed` labels present
- **Dispatch failed:** Aggregate and relevant worker show error state when `gh workflow run` fails
- **Closed/merged PR:** Aggregate shows success, all workers show N/A
- **Manual-only decision:** Aggregate shows success, finalizer shows N/A for `needs-review` policy
- **Ordered statuses:** Verifies `orderedStatuses` array includes aggregate + all 6 workers

All tests pass (23 tests total in orchestrate-pr-flow.test.cjs).

### 2. E2E Scenario Documentation

**File:** `docs/workflow-e2e-scenarios.md`

Added §5b section documenting the commit-status visibility system with:

- **Mermaid flowchart:** Shows orchestrate-pr-flow → buildFlowVisibility → publishFlowStatuses + upsertFlowComment → PR head status UI + sticky comment
- **12 comprehensive scenarios:**
  - V1: Initial orchestration on draft PR
  - V2: Worker completion wake (status refresh)
  - V3: Worker dispatch failures (error state)
  - V4: Required checks failed (failure state)
  - V5: Review passed (success workers, pending aggregate)
  - V6: Draft → ready transition
  - V7: Closed/merged PR (terminal success)
  - V8: Manual-only policy (success aggregate)
  - V9: Visibility publish failures (error surface)
  - V10: Dependency review required
  - V11: Multiple workers running concurrently
  - V12: External Kilo review pending

## Test Results

- **Workflow tests:** 371 tests pass (including 7 new buildFlowVisibility tests)
- **Full test suite:** All tests pass (typecheck, test-only, lint, format:check)
- **No regressions:** All existing tests continue to pass

## Deviations from Plan

None - the implementation exactly followed the plan scope (steps 5-6 of the source artifact):

- Added only tests and documentation (no changes to orchestrator logic)
- Did not modify `orchestrate-pr-flow.cjs` (already complete)
- Did not modify `pr-flow.json` or `pr-flow.yml` (already complete)
- Focused on test coverage and E2E documentation for the visibility system

## Technical Notes

### buildFlowVisibility Function

The function (`orchestrate-pr-flow.cjs:455-937`) computes:
- **Aggregate status:** `pr-flow/ready` context with state/description/targetUrl
- **Worker statuses:** 6 worker contexts (codeReview, securityReview, dependencyReview, kiloReview, prImprove, finalizer)
- **Ordered array:** All 7 statuses in publish order

Key states tested:
- `pending` → waiting for prerequisite
- `running` → worker actively executing  
- `success` → worker completed successfully
- `failure` → worker failed with error
- `error` → dispatch or visibility system error
- `N/A` → worker skipped (not required for this PR)

### E2E Scenario Structure

Follows existing catalog format:
- **Decision basis:** References `buildFlowVisibility`, `publishFlowStatuses`, `upsertFlowComment`, `pr-flow.json`
- **Mermaid diagram:** Shows data flow from orchestrate → visibility → PR UI
- **Scenario table:** 12 rows covering major visibility states and transitions
- **Type marking:** All scenarios marked `char` (characterization tests of existing behavior)

## Verification

✓ All buildFlowVisibility tests pass
✓ Full workflow test suite passes (371 tests)
✓ Full project test suite passes
✓ Prettier formatting applied to documentation
✓ No modifications to orchestrator artifacts (per constraints)
✓ SUMMARY.md created

## Files Modified

1. `.github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs`
   - Added `buildFlowVisibility` to imports
   - Added 7 test functions (175 new lines)

2. `docs/workflow-e2e-scenarios.md`
   - Added §5b section with Mermaid diagram and 12 scenarios
   - Formatted with Prettier

## Commits

1. `75899c4` - "test(999-048): add focused tests for buildFlowVisibility"
2. `03f37ee` - "docs(999-048): add §5b commit-status visibility e2e scenarios"
