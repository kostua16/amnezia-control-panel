---
status: complete
---

# Prettier Auto-Fix Recursive Glob

Verified from CI runs `27143158158` and `27143576366` that the shared formatter auto-fix only corrected `src/lib/format.ts` while leaving deeper `src/lib/__tests__/resource-alerts.test.ts` unformatted.

## Root Cause

- `.github/actions/prettier-auto-fix/action.yml` passed `src/**/*.{ts,tsx,css}` to Bash unquoted.
- Bash expanded the pattern shallowly before invoking Prettier, so recursive matches under `src/lib/__tests__/` were skipped.

## Completed

- Quoted the shared `prettier-glob` input so Prettier performs the recursive glob expansion itself.
- Preserved the existing detection and commit flow; only the formatter invocation changed.

## Verification

- `bash -lc 'printf "%s\n" src/**/*.{ts,tsx,css} | rg "resource-alerts\.test\.ts|format\.ts"'`
- `rtk proxy npx prettier --check .github/actions/prettier-auto-fix/action.yml`
- `rtk actionlint .github/workflows/_auto-fix-ci.yml .github/workflows/fix-pr.yml .github/workflows/fix-branch.yml`
- `rtk git diff --check`
