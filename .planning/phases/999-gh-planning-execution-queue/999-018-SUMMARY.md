# Plan 999-018 Summary: Architectural Review — Third-Pass Non-Duplicative Findings

## Status: COMPLETE

## Proposals Implemented

### Proposal 1: Migrate audit-log.ts from Raw SQL to Prisma Model
- Removed `ensureAuditLogTable()` and all raw SQL DDL (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- Removed `$executeRaw` insert; replaced with `prisma.auditLog.create()`
- Eliminated dual-source-of-truth between `schema.prisma` and runtime code
- Same function signature preserved — all callers unaffected

### Proposal 2: Extract Repeated bcrypt Hashing to Shared Utility
- Intent: route all bcrypt usage through a single shared wrapper instead of
  importing `bcryptjs` in each route file.
- Original execution created `src/lib/crypto.ts` (`hashSecret`/`verifySecret`).
- Reconciled with `main`, which independently landed an equivalent wrapper
  (`src/lib/password.ts`, `hashValue`/`verifyValue`). To avoid a duplicate
  bcrypt wrapper, this branch adopts `password.ts` across all route files and
  `crypto.ts` was removed. Salt rounds remain at 10; behavior is unchanged.
- Route files now import `hashValue`/`verifyValue` from `@/lib/password`:
  `servers/route.ts`, `panels/route.ts`, `users/route.ts`, `auth/login/route.ts`,
  `panels/[id]/route.ts`, `users/[id]/route.ts`, `servers/[id]/route.ts`,
  `servers/[id]/config/route.ts`, `sync/receive/route.ts`, `sync/apply/route.ts`.

### Proposal 3: Replace Synchronous execFileSync in Service Monitor
- Replaced `execFileSync` with promisified `execFileAsync` in `service-monitor.ts`
- `checkServiceStatus()` now async, returns `Promise<ServiceHealth>`
- `checkAllServices()` now async, uses `Promise.all` for parallel service checks
- `restartService()` now async, returns `Promise<boolean>`
- The HTTP service-status endpoint (`services/[service]/status/route.ts`) was
  routed through the shared async `checkServiceStatus` so it no longer blocks the
  event loop and the systemd-name map has a single source of truth.

## Verification
- TypeScript: no errors
- ESLint: 0 errors
- Prettier: all files formatted correctly
- Tests: all passing (exit 0)

## Key Files
- `src/lib/audit-log.ts` — rewritten (raw SQL → Prisma model)
- `src/lib/password.ts` — pre-existing on main; this branch routes its bcrypt
  call sites through `hashValue`/`verifyValue`
- `src/lib/service-monitor.ts` — rewritten (sync → async)
- `src/app/api/services/[service]/status/route.ts` — routed through async check
- 10 route files — bcrypt import consolidated via `password.ts`

## Deviations
Proposal 2 was reconciled with `main`: rather than shipping a second bcrypt
wrapper (`crypto.ts`), the branch adopts `main`'s `password.ts` and removes
`crypto.ts`. Net effect matches the proposal's goal (one shared bcrypt utility)
without duplicating `main`'s work.

## Self-Check: PASSED
