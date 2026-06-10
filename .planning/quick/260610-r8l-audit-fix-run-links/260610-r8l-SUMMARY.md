---
status: complete
---

# Audit Fix PR Source Run Links

Confirmed during the 2026-06-10 auto-PR audit that current audit PRs such as `#274` and `#267` still render only bare run IDs, even though the shared rich-body builder already supports linked source-run evidence.

## Root Cause

- `.github/workflows/scripts/classify-audit-fix.cjs` built its own audit evidence block with `Run ID: <id>`.
- The classifier never passed `sourceRunUrl` into `.github/workflows/scripts/build-automation-pr-body.cjs`, so audit PR bodies missed the richer link output already used by other automation lanes.

## Completed

- Added a small `buildSourceRunUrl` helper in the audit classifier.
- Switched the trigger/evidence text to prefer linked source-run output while keeping a local/no-repo fallback.
- Extended the classifier tests to assert the run link is present in generated audit PR bodies.

## Verification

- `rtk node --test src/lib/__tests__/audit-safe-policy.test.ts src/lib/__tests__/build-automation-pr-body.test.ts`
- `rtk npm run lint -- --quiet .github/workflows/scripts/classify-audit-fix.cjs src/lib/__tests__/audit-safe-policy.test.ts`
- `rtk npx prettier --check .github/workflows/scripts/classify-audit-fix.cjs src/lib/__tests__/audit-safe-policy.test.ts .planning/quick/260610-r8l-audit-fix-run-links/260610-r8l-PLAN.md .planning/quick/260610-r8l-audit-fix-run-links/260610-r8l-SUMMARY.md`
- `rtk git diff --check`
