---
status: complete
quick_id: 260613-1cb
date: 2026-06-12
---

# Quick Task 260613-1cb: Loosen audit-safe auto-approval criteria

## Summary

Relaxed the audit-safe PR policy to allow up to 10 files and 400 changed lines while keeping sensitive paths manual-only.

## Changes

- Updated `.github/workflows/policy.json` with the new audit-safe size limits and broader safe `src` path allow list.
- Updated `.github/workflows/documentation.md` to document the new thresholds and exclusions.
- Added and refreshed audit-safe policy tests for relaxed limits, sensitive path denials, unavailable file data, and unknown line counts.

## Verification

- `node --test .github/workflows/scripts/__tests__/evaluate-pr-policy.test.cjs`
- `node --import tsx --test src/lib/__tests__/audit-safe-policy.test.ts`
- `npm test`
- `npm run lint`
- `npx tsc --noEmit`
- `npx prettier --check .github/workflows/policy.json .github/workflows/documentation.md .github/workflows/scripts/__tests__/evaluate-pr-policy.test.cjs src/lib/__tests__/audit-safe-policy.test.ts .planning/quick/260613-1cb-loosen-audit-safe-auto-approval-criteria/260613-1cb-PLAN.md`
- `actionlint -config-file .github/actionlint.yaml`
- `git diff --check`
