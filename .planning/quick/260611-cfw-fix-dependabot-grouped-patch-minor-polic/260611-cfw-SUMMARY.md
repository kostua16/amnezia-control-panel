---
status: complete
---

# Dependabot Grouped Patch/Minor Policy Inference

Confirmed during the 2026-06-11 auto-PR audit that the only live automation backlog is seven Dependabot PRs (`#296`-`#302`) and that the grouped npm PRs `#297` and `#298` are not duplicates of the single-package majors `#299`-`#302`. Their changed package sets do not overlap, but both grouped PRs already carry `deps-review-passed` while the shared policy still leaves them `flow/manual-only` because the grouped title does not contain a single semver `from x to y` pair.

## Root Cause

- `.github/workflows/scripts/evaluate-pr-policy.cjs` inferred Dependabot update type only from the PR title.
- Grouped Dependabot PRs encode the real member update types in the body’s `updated-dependencies` block, so patch/minor-only groups were misclassified as `unknown`.
- That misclassification forced unnecessary manual-only handling even though `.github/workflows/documentation.md` already documents grouped patch/minor Dependabot PRs as auto-merge eligible after `deps-review-passed`.

## Completed

- Added shared helpers to extract and summarize Dependabot `update-type: version-update:semver-*` entries from the PR body.
- Kept the existing title-based semver parsing as a fallback for non-grouped PRs.
- Added a regression test that models today’s grouped development-dependencies PR shape and proves it now remains supported.

## Verification

- `tsx --test src/lib/__tests__/audit-safe-policy.test.ts`
- `prettier --check .github/workflows/scripts/evaluate-pr-policy.cjs src/lib/__tests__/audit-safe-policy.test.ts`
- `eslint .github/workflows/scripts/evaluate-pr-policy.cjs src/lib/__tests__/audit-safe-policy.test.ts`
