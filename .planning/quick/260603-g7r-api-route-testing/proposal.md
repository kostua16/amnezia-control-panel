# Quick Task 260603-g7r: API route testing foundation

## Problem

70+ API route handlers across 45+ `route.ts` files have **zero test coverage**. The 11 existing test files only cover lib utilities (chain-router, config-applier, transport-resolver, etc.). This means the most critical business logic — user CRUD, panel sync, config push, authentication — is completely untested.

Concrete risks from zero route coverage:

- **User creation** (`POST /api/users`) creates a DB record then attempts VPN service creation. If VPN fails, the DB record persists with incomplete state. No test verifies the rollback-or-warn behavior.
- **Panel sync** (`POST /api/sync/receive`) accepts external payloads with HMAC verification. No test validates the HMAC rejection path, malformed body handling, or replay protection.
- **Auth flow** (`POST /api/auth/login`) hashes passwords and issues JWTs. No test verifies wrong-password rejection, expired token handling, or concurrent session behavior.
- **Config push** (`POST /api/panels/push/chain-config`) is a 409-line handler generating WireGuard peers and Xray routing rules. No test validates the output for any topology.

## Scope

### 1. Create API route test helper

- **files**: Create `src/lib/__tests__/helpers/test-server.ts`
- **action**:
  - Wrap Next.js `GET`/`POST`/`PUT`/`DELETE` route handlers with mock `NextRequest` construction
  - Provide `jsonResponse()` helper to parse `NextResponse` back to typed data
  - Handle query string construction for GET routes
  - ~60-80 lines
- **verify**: Import and use in a sample test
- **done**: Reusable test helper exported

### 2. Test the 5 most critical routes

- **files**: Create test files alongside route handlers (or in `__tests__`)
  - `src/app/api/auth/login/__tests__/route.test.ts` — valid credentials, wrong password, missing fields
  - `src/app/api/users/__tests__/route.test.ts` — list with pagination, create with validation, duplicate username
  - `src/app/api/panels/push/__tests__/chain-config.test.ts` — linear/split/mesh topology generation, missing panel mapping
  - `src/app/api/sync/__tests__/receive.test.ts` — valid HMAC, invalid HMAC, malformed body
  - `src/app/api/routing/geo/__tests__/route.test.ts` — CRUD operations, reorder
- **action**:
  - Use the test helper from step 1
  - Use in-memory SQLite via Prisma's better-sqlite3 adapter for DB-dependent tests
  - Mock shell commands (`execFile`) via `vi.mock` for VPN/service routes
  - Target 3-5 test cases per route (happy path + 2-3 error paths)
- **verify**: `npm test` passes all new tests
- **done**: 15-25 test cases covering the 5 most critical routes

### 3. Document testing patterns

- **files**: Add section to `docs/code-standards.md`
- **action**:
  - Document the test helper usage pattern
  - Show example test for a route handler
  - List conventions: mock boundaries, test data setup, assertion patterns
- **verify**: A developer can follow the pattern to test a new route
- **done**: Testing pattern documented

## Acceptance Criteria

- [ ] Test helper module exists and is imported in at least 2 test files
- [ ] 5 critical route handlers have test coverage (15+ test cases total)
- [ ] All tests pass via `npm test`
- [ ] Testing pattern documented in code-standards.md
- [ ] No production code changes — only test files and docs

## Risk

- Low — tests are additive; no production code changes
- Main challenge is setting up Prisma with in-memory SQLite for DB-dependent tests (adapter already available in the project)

## Estimated Effort

2-3 focused sessions

## Relationship to Existing Proposals

- Complements `f6n` (API error standardization) — tests would validate the standardized error responses
- Independent of `b2n` (HTTP/shell abstraction) — route tests mock at the handler level, not the fetch/exec level
