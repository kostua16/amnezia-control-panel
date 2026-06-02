# Quick Task 260602-f6n: API route error handling standardization + test foundation

## Problem

**Duplicated error handling:** All 40+ API routes repeat the same pattern:
```ts
try {
  // ... logic ...
} catch (err) {
  console.error('[api/...] Error:', err);
  return NextResponse.json({ success: false, error: 'Failed to ...' }, { status: 500 });
}
```
No structured error types, no request IDs, no consistent error categorization. The `api-response.ts` helper exists (`success()`, `error()`) but only ~50% of routes use it.

**No route-level tests:** Only 6 test files exist in the entire repo (all in `src/lib/__tests__/`). Zero API route tests, zero component tests, zero E2E tests. Authentication, user creation, config push — the most critical paths — have no automated verification.

**Raw SQL injection surface:** `stats/traffic/route.ts:86` uses `$queryRawUnsafe` with string-interpolated `truncExpr`. While values come from a fixed switch statement (not user input), the pattern is fragile — any future refactor that passes user-controlled input into the SQL template would create an injection vulnerability.

## Scope

### 1. Create API error handler wrapper
- **files**: Create `src/lib/api-handler.ts`
- **action**:
  - Create `apiHandler(fn: (req: NextRequest, ctx: RouteContext) => Promise<Response>)` wrapper that:
    - Catches all errors and returns standardized JSON
    - Maps `Prisma.PrismaClientKnownRequestError` codes (P2002 → 409, P2025 → 404) to HTTP status
    - Maps `ZodError` to 422 with field-level messages
    - Logs with request path for traceability
  - ~40-50 lines
- **verify**: Unit test with mock errors for each error type → correct status and JSON shape
- **done**: `apiHandler` exported and usable

### 2. Migrate 5 priority routes to apiHandler
- **files**: `src/app/api/users/route.ts`, `src/app/api/servers/route.ts`, `src/app/api/panels/route.ts`, `src/app/api/sync/route.ts`, `src/app/api/health/route.ts`
- **action**:
  - Wrap GET/POST handlers with `apiHandler`
  - Remove manual try/catch blocks
  - Use `api-response.ts` helpers consistently
- **verify**: Dev server starts; manual test of user CRUD returns same JSON shape
- **done**: 5 routes migrated, try/catch removed

### 3. Add API route test foundation
- **files**: Create `src/app/api/__tests__/health.test.ts`, `src/app/api/__tests__/users.test.ts`
- **action**:
  - Set up test infrastructure: in-memory SQLite via Prisma test helper, mock NextRequest
  - Write 3-5 tests per route: success path, validation error, auth required, edge case
  - Health route: verify 200 response shape
  - Users route: verify GET with pagination, POST with validation, POST duplicate username → 409
- **verify**: `npx vitest run src/app/api/__tests__/` passes
- **done**: 8-10 route-level tests covering 2 critical paths

### 4. Replace $queryRawUnsafe with $queryRaw
- **files**: `src/app/api/stats/traffic/route.ts`
- **action**:
  - Replace `$queryRawUnsafe` with tagged template `$queryRaw` using Prisma.sql for parameterized queries
  - Keep the trunc expression as a computed column (safe since it comes from a fixed switch)
  - Bind WHERE parameters through Prisma tagged template, not string interpolation
- **verify**: Traffic stats API returns same results; no raw SQL in source
- **done**: Zero `$queryRawUnsafe` calls in codebase

## Acceptance Criteria
- [ ] `apiHandler` wrapper handles Prisma errors, Zod errors, and unknown errors
- [ ] 5 priority routes migrated (no manual try/catch)
- [ ] 8-10 route-level tests pass
- [ ] Zero `$queryRawUnsafe` in codebase
