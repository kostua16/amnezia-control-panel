---
phase: 999
plan: 999-003
status: complete
started: "2026-06-13T00:00:00Z"
updated: "2026-06-13T00:00:00Z"
---

# Summary: API route testing foundation

## What was done

Implemented the testing-foundation artifact for the 5 most critical API routes:
a reusable request/response test helper, 22 new passing test cases across the
routes, and a documented testing pattern in `docs/code-standards.md`. No
production code was changed — only test files, the helper, and docs.

## Adaptation to the actual codebase

The source artifact assumed Vitest (`vi.mock`) and nested `__tests__/` dirs.
The real stack is **Node's built-in test runner** (`node:test` +
`node:assert/strict`) via `tsx`, with the `npm test` globbing the two flat
directories `src/lib/__tests__/*.test.ts` and `src/app/api/__tests__/*.test.ts`.
The implementation follows the real conventions rather than the artifact's
assumptions:

- `vi.mock` is unavailable without the `--experimental-test-module-mock` flag
  (not on the `npm test` script). Prisma is stubbed instead by **direct
  assignment on the shared `prisma` singleton** (`prisma.user.findMany = …`),
  restored in `afterEach`. `mock.method` does not work — the delegate sits
  behind a Prisma proxy and is not an own data-property.
- `writeAuditLog` / `seedAdmin` are neutralized by stubbing `prisma.$executeRaw`
  / `$executeRawUnsafe` on the same singleton.
- Pure helpers (`@/lib/hmac`, `@/lib/chain-templates`) run for real — e.g. the
  `/api/sync/receive` valid-signature test computes a real HMAC via
  `signPayload`, exercising the actual verification path.

## Files created

- `src/lib/__tests__/helpers/test-server.ts` — reusable `getRequest`,
  `postRequest`/`putRequest`/`patchRequest`/`deleteRequest`, and `readJson`
  (returns `{ status, body }`), consolidating the inline helpers previously
  duplicated in `users.test.ts`.
- `src/app/api/__tests__/auth-login.test.ts` — 4 cases: missing fields (422),
  unknown user (401), wrong password (401), valid credentials → session cookie
  (200).
- `src/app/api/__tests__/sync-receive.test.ts` — 5 cases: missing auth headers
  (401), no matching panel (401), bad HMAC signature (401), malformed payload
  (400), valid signed payload persisted (200).
- `src/app/api/__tests__/chain-config.test.ts` — 6 cases: missing templateId
  (422), unknown templateId (404), duplicate panel mapping (422), linear
  topology generation, mesh topology generation, panelUrl fallback parsing.
- `src/app/api/__tests__/routing-geo.test.ts` — 4 cases: list rules (200), no
  target field (422), unknown action (422), create country-BLOCK rule (201).
- `src/app/api/__tests__/users-db.test.ts` — 3 cases: paginated list with
  assigned services, search-term propagation, duplicate username → 409 (Prisma
  P2002 mapping).
- `docs/code-standards.md` — documents the test runner, route-handler test
  pattern, mocking boundaries, and conventions.

## Scope notes

- The `/api/users` POST happy path (VPN service creation) is intentionally not
  covered end-to-end: it shells out via `vpn-services` (`execFile`), which
  cannot be mocked without the experimental module-mock flag. Validation,
  list, and duplicate-error mapping are covered. Documented in
  `code-standards.md` as a known boundary.
- `/api/routing/geo` reorder and `[id]` sub-routes are out of scope for this
  foundation; the GET/POST pattern established here extends directly to them.

## Verification

- `npm test`: **482/482 pass** (was 370/383 on a fresh checkout — the 13
  prior failures were the route tests that import Prisma; they pass once
  `npx prisma generate` runs, which `setup-environment/action.yml:271` does in
  CI).
- The 22 new test cases all pass.
- ESLint: clean (exit 0) on all changed files.
- Prettier: all changed files conform.
- No production code modified (`git status` shows only new test/helper/doc
  files plus this plan).

## Deviations

None — implementation stayed within the source artifact's intent (test helper +
critical-route coverage + documented pattern). The test framework and mock
strategy were adapted to the actual codebase conventions rather than the
artifact's Vitest assumptions; this is faithful execution of the artifact's
goal, not scope creep.

## Self-Check: PASSED

- Test helper exists and is imported in all 5 new route test files.
- 5 critical route handlers covered with 22 test cases (>15 target).
- All tests pass via `npm test`.
- Testing pattern documented in `docs/code-standards.md`.
- No production code changes — only test files and docs.
