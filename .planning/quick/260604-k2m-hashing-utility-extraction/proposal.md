# Quick Task 260604-k2m: Extract hashing + Prisma error utilities

## Problem

**9 files** repeat `await import('bcryptjs')` as a dynamic import and call `bcrypt.hash(value, 10)`:
- `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`
- `src/app/api/servers/route.ts`, `src/app/api/servers/[id]/route.ts`, `src/app/api/servers/[id]/config/route.ts`
- `src/app/api/panels/route.ts`, `src/app/api/panels/[id]/route.ts`
- `src/app/api/sync/apply/route.ts`, `src/app/api/sync/receive/route.ts`

Dynamic import was likely used to avoid bcrypt's native module load cost at startup, but it also prevents tree-shaking and adds latency on first call. The real issue is **duplication**: every route does the same 2-line dance instead of calling a shared helper.

**6 files** repeat the Prisma unique-constraint error check:
```ts
if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
```

This 4-line guard appears identically in users, servers (×2), panels (×2), and configs routes.

Note: `260602-f6n` (API error standardization) proposes an `apiHandler` wrapper that would subsume the P2002 check. This proposal is complementary — it extracts the **hashing utility** which `f6n` does not cover, and adds the P2002 helper as an immediate standalone utility that can later be folded into `apiHandler`.

## Scope

### 1. Create `src/lib/password.ts` — hashing utility
- **files**: Create `src/lib/password.ts`
- **action**:
  - Export `hashValue(plaintext: string): Promise<string>` — wraps bcrypt.hash with salt rounds 10.
  - Export `verifyValue(plaintext: string, hash: string): Promise<boolean>` — wraps bcrypt.compare.
  - Import `bcryptjs` statically (it's already in package.json; native modules are optional).
- **verify**: Unit test: `hashValue('x')` produces a valid bcrypt hash; `verifyValue('x', hash)` returns true.
- **done**: `src/lib/password.ts` exported and tested.

### 2. Create `src/lib/prisma-errors.ts` — Prisma error helpers
- **files**: Create `src/lib/prisma-errors.ts`
- **action**:
  - Export `isPrismaUniqueViolation(err: unknown): boolean` — checks for P2002.
  - Export `isPrismaNotFound(err: unknown): boolean` — checks for P2025.
  - Type-safe using `Prisma.PrismaClientKnownRequestError` type guard.
- **verify**: Unit test with mock error objects.
- **done**: `isPrismaUniqueViolation` and `isPrismaNotFound` exported.

### 3. Migrate routes to use shared utilities
- **files**: All 9 routes with dynamic bcrypt import, 6 routes with P2002 check
- **action**:
  - Replace `await import('bcryptjs'); const hash = await bcrypt.hash(...)` with `import { hashValue } from '@/lib/password'; ... hashValue(...)`.
  - Replace inline P2002 checks with `isPrismaUniqueViolation(err)`.
- **verify**: TypeScript compiles; dev server starts; login + user creation + server creation still work.
- **done**: Zero dynamic `import('bcryptjs')` calls; zero inline P2002 checks.

## Acceptance Criteria
- [ ] `src/lib/password.ts` with `hashValue` / `verifyValue`
- [ ] `src/lib/prisma-errors.ts` with `isPrismaUniqueViolation` / `isPrismaNotFound`
- [ ] Zero `await import('bcryptjs')` in API routes
- [ ] Zero inline P2002 string comparisons in API routes
- [ ] Unit tests for both utility modules pass

## Risk
- Low — pure refactoring; no behavioral changes. Only risk is missing a call site, mitigated by grep verification.

## Estimated Effort
1 focused session
