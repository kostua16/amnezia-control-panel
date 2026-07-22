---
plan: 999-109
phase: 999
status: complete
---

# Summary: Plan 999-109 — PR #750 workflow improvement quick wins

## What was built

Two tactical quick wins from the PR #750 intake artifact:

1. **Removed redundant git fetch in maintenance detect_changes** — `maintenance.yml` ran `git fetch origin main --depth=1 || true` but the checkout step already uses `fetch-depth: 0` (full clone). The extra fetch was dead work and the `|| true` silently swallowed network errors.

2. **Added `claude-maintenance-` branch prefix to policy.json** — `PR_PRODUCER_REGISTRY` tracks `maintenance.yml` as a PR producer, but `policy.json` had no entry for `claude-maintenance-` branches. Project-manager classified these via the generic `claude-` fallback. Added to `trustedAutomationBranchPrefixes` for proper classification.

## Files changed

- `.github/workflows/maintenance.yml` — removed line 105 (`git fetch origin main --depth=1 || true`)
- `.github/workflows/policy.json` — added `"claude-maintenance-"` to `trustedAutomationBranchPrefixes`

## Verification

- e2e tests: 1030/1030 pass
- TypeScript: no errors
- ESLint: 0 errors (4 pre-existing warnings unrelated to changes)
- Prettier: all formatted
- JSON validation: policy.json parses correctly

## Self-Check: PASSED

## Proposals deferred

- **Proposal pr750.1 (Formalize maintenance PR lifecycle in evaluate-trigger-policy):** governance-level change adding a dedicated trigger-policy entry for `claude-maintenance-` branches in `evaluate-trigger-policy.cjs`. Larger scope than quick wins — enables maintainer-triggered re-runs, explicit cooldown enforcement at policy layer, and proper branch-prefix classification for manual-only vs auto-merge decisions. Deferred as a separate phase candidate.

- **Proposal pr750.2 (Add e2e scenario coverage for maintenance PR creation path):** P16 and P17 exist in `workflow-e2e-scenarios.md` but no automated test in `__tests__/`. Parity with fix-ci and fix-issue PR paths needed. Deferred as a separate phase candidate requiring test authoring.
