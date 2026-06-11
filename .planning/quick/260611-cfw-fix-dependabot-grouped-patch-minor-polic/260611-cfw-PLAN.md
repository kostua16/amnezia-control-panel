---
status: complete
---

# Dependabot Grouped Patch/Minor Policy Inference

Fix the shared PR policy classifier so grouped Dependabot npm updates use the `updated-dependencies` metadata in the PR body to infer whether every member update is patch/minor, instead of falling back to `unknown` because the grouped PR title has no single `from x to y` version pair.

## Tasks

- Confirm from the live open PR set that grouped Dependabot PRs `#297` and `#298` are marked `deps-review-passed` but still end in `flow/manual-only` with the reason `dependabot update type could not be proven as patch/minor`.
- Update `.github/workflows/scripts/evaluate-pr-policy.cjs` to summarize Dependabot `update-type: version-update:semver-*` body metadata before falling back to title parsing.
- Extend `src/lib/__tests__/audit-safe-policy.test.ts` with a grouped Dependabot regression case and verify the touched JS/TS files with tests, ESLint, and Prettier.
