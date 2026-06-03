---
status: complete
date: 2026-06-03
---

# Summary

Implemented SHA-named `main` build metrics artifacts and PR baseline lookup for build performance comparison.

## Verification

- `rtk npm test`
- `rtk npm run lint`
- `rtk proxy npx prettier --check .github/workflows/ci.yml .github/workflows/perf-check.yml .github/workflows/scripts/build-metrics.cjs src/lib/__tests__/build-metrics.test.ts .planning/quick/260603-84i-implement-sha-named-main-build-metrics-a/PLAN.md`
- `rtk npm run format:check`
- `rtk actionlint .github/workflows/ci.yml .github/workflows/perf-check.yml`
- `rtk git diff --check`
