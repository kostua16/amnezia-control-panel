# Plan 999-018 Summary: Architectural Review — Third-Pass Non-Duplicative Findings

## Status: COMPLETE

## Proposals Implemented

### Proposal 1: Migrate audit-log.ts from Raw SQL to Prisma Model
- Removed `ensureAuditLogTable()` and all raw SQL DDL (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- Removed `$executeRaw` insert; replaced with `prisma.auditLog.create()`
- Eliminated dual-source-of-truth between `schema.prisma` and runtime code
- Same function signature preserved — all callers unaffected

### Proposal 2: Extract Repeated bcrypt Hashing to Shared Utility
- Created `src/lib/crypto.ts` with `hashSecret()` and `verifySecret()`
- Replaced 10 bcrypt usage sites across route files:
  - Static import replacements: `servers/route.ts`, `panels/route.ts`, `users/route.ts`, `auth/login/route.ts`
  - Dynamic import replacements: `panels/[id]/route.ts`, `users/[id]/route.ts`, `servers/[id]/route.ts`, `servers/[id]/config/route.ts`, `sync/receive/route.ts`, `sync/apply/route.ts`
- `bcryptjs` now imported once in `crypto.ts`; salt rounds remain at 10
- Test files and `seed.ts` left as-is (test fixture usage, out of scope)

### Proposal 3: Replace Synchronous execFileSync in Service Monitor
- Replaced `execFileSync` with promisified `execFileAsync` in `service-monitor.ts`
- `checkServiceStatus()` now async, returns `Promise<ServiceHealth>`
- `checkAllServices()` now async, uses `Promise.all` for parallel service checks
- `restartService()` now async, returns `Promise<boolean>`
- `ServiceMonitor.check()` already had `await` on callbacks — now properly awaits async status/restart calls

## Verification
- TypeScript: no errors
- ESLint: 0 errors (3 pre-existing warnings unrelated)
- Prettier: all files formatted correctly
- Tests: all passing (exit 0)

## Key Files
- `src/lib/audit-log.ts` — rewritten
- `src/lib/crypto.ts` — new
- `src/lib/service-monitor.ts` — rewritten
- 10 route files — bcrypt import replaced

## Deviations
None. All three proposals implemented as specified.

## Self-Check: PASSED
