# Deferred items — 260815-n6m (AFX-E02 execution)

Pre-existing Windows-host test failures unrelated to this change. All pass on
the Linux CI runners; they fail on a `core.autocrlf=true` Windows worktree or
on Windows itself. Do not fix as part of AFX-E02.

## Workflow e2e suite (`node --test scripts/__tests__/*.test.cjs`)

After CRLF normalization of tracked YAMLs (zero git diff), 7 of 1265 tests
still fail locally:

| Test | File | Cause |
|---|---|---|
| tracked unsafe Prisma source fails the guard | check-prisma-safe-sql.test.cjs | path-separator mismatches (`src\lib\...` vs `src/lib/...`) in git ls-files output on Windows |
| filesystem fallback catches unsafe Prisma source outside a git repo | check-prisma-safe-sql.test.cjs | same path-separator class |
| CLI failure prints a plain path diagnostic | check-prisma-safe-sql.test.cjs | same path-separator class |
| formatDate produces YYYY-MM-DD HH:00 UTC | detect-schedule-drift.test.cjs | host timezone/locale assumptions |
| upsertComment replaces an existing sticky comment by default | sticky-comment.test.cjs | test stubs `gh` as a POSIX shell script on PATH; Windows `cmd` cannot execute the shebang stub |
| upsertComment tolerates a failed DELETE after successful POST | sticky-comment.test.cjs | same `gh` stub class |
| upsertComment keeps the legacy patch path when replaceExisting is false | sticky-comment.test.cjs | same `gh` stub class |

## Repo suite (`npm run test-only`)

| Test | File | Cause |
|---|---|---|
| dedupes concurrent refreshes after a cache miss | src/lib/__tests__/resource-monitor.test.ts | mocks Linux `df`; Windows branch queries PowerShell for drive C: while the checkout is on F: |
| getSystemResources | src/lib/__tests__/resource-monitor.test.ts | same platform mismatch |

## Lint

`npm run lint`: 0 errors, 4 pre-existing warnings (react-hooks/set-state-in-effect
x3, no-unused-vars x1) in src files untouched by this change.

## Environment notes

- This worktree had no `node_modules`; installed via `npm ci` and generated the
  Prisma client (`npm run prisma:generate`) before running the suites.
- `core.autocrlf=true` makes `prettier --check` flag every checked-out file
  (`.prettierrc` enforces `endOfLine: lf`). Content-level prettier compliance
  was verified by comparing LF-normalized stdin against `prettier` output; all
  changed files are clean.
