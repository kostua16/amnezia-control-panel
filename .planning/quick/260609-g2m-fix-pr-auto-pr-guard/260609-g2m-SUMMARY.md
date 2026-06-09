---
status: complete
---

# Guard PR Auto-Fix Against Automation Child PRs

Confirmed the repeated child-PR pattern in the PR auto-fix lane from open PRs `#259` and `#268`.

## Root Cause

- `fix-pr.yml` only skipped branches already named `claude-auto-fix-ci-*`.
- It did not inspect the failing source PR metadata before calling `_auto-fix-ci`.
- As a result, CI failures on automation-authored PRs such as `#258` and `#266` could open new child PRs (`#259`, `#268`) against already-generated branches.

## Completed

- Added `fix-pr` mode to `.github/workflows/scripts/evaluate-trigger-policy.cjs` to classify PR auto-fix runs using source PR labels and automation branch prefixes from `policy.json`.
- Updated `.github/workflows/fix-pr.yml` to fetch source PR metadata, evaluate the shared guard, and skip `_auto-fix-ci` when the failing source PR is already automation-authored.
- Added regression coverage in `src/lib/__tests__/trigger-policy.test.ts` and documented the new stop condition in `.github/workflows/documentation.md`.

## Verification

- `rtk test node --test src/lib/__tests__/trigger-policy.test.ts src/lib/__tests__/workflow-triggers.test.ts`
- `rtk actionlint .github/workflows/fix-pr.yml`
- `rtk npm run lint`
- `env npm_config_cache=/private/tmp/npm-cache rtk proxy npx prettier --check .github/workflows/fix-pr.yml .github/workflows/scripts/evaluate-trigger-policy.cjs src/lib/__tests__/trigger-policy.test.ts .github/workflows/documentation.md .planning/quick/260609-g2m-fix-pr-auto-pr-guard/260609-g2m-PLAN.md`
- `rtk git diff --check`
