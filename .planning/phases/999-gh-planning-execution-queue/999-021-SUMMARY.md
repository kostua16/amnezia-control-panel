---
plan: 999-021
phase: 999
status: complete
commit: c2c81b3
---

# Summary: Extract hashing + Prisma error utilities

## What was built

Extracted two shared utility modules from duplicated inline patterns across API routes:

1. **`src/lib/password.ts`** — `hashValue()` and `verifyValue()` wrapping bcryptjs with salt rounds 10. Replaces 6 dynamic `await import('bcryptjs')` calls that each duplicated the same 2-line pattern.

2. **`src/lib/prisma-errors.ts`** — `isPrismaUniqueViolation()` (P2002) and `isPrismaNotFound()` (P2025) type-safe guards using `Prisma.PrismaClientKnownRequestError`. Replaces 3 inline 4-line error-checking guards.

## Key files created

- `src/lib/password.ts`
- `src/lib/prisma-errors.ts`
- `src/lib/__tests__/password.test.ts`
- `src/lib/__tests__/prisma-errors.test.ts`

## Key files modified

- `src/app/api/users/[id]/route.ts`
- `src/app/api/servers/[id]/route.ts`
- `src/app/api/servers/[id]/config/route.ts`
- `src/app/api/panels/[id]/route.ts`
- `src/app/api/sync/apply/route.ts`
- `src/app/api/sync/receive/route.ts`

## Acceptance criteria

- [x] `src/lib/password.ts` with `hashValue` / `verifyValue`
- [x] `src/lib/prisma-errors.ts` with `isPrismaUniqueViolation` / `isPrismaNotFound`
- [x] Zero `await import('bcryptjs')` in API routes
- [x] Zero inline P2002 string comparisons in API routes
- [x] Unit tests for both utility modules pass (10 tests)

## Self-Check: PASSED

- TypeScript compiles: 0 errors
- Tests: 604/604 pass
- Lint: 0 errors (3 pre-existing warnings unrelated to this change)
- Prettier: all files clean
