# Code Standards

Conventions for the Amnezia Control Panel codebase. Sections are added as
patterns stabilize.

## Testing

### Test runner

Tests use **Node's built-in test runner** (`node:test` + `node:assert/strict`),
executed through `tsx` for TypeScript transpilation — **not** Vitest/Jest. The
`npm test` script globs two flat directories:

```json
"test": "node --import tsx --test src/lib/__tests__/*.test.ts src/app/api/__tests__/*.test.ts"
```

**Implications:**

- Place library tests in `src/lib/__tests__/` and API route tests in
  `src/app/api/__tests__/` (flat — the glob does **not** recurse into nested
  `__tests__/` directories next to each `route.ts`).
- `vi.mock` is unavailable. See [Mocking](#mocking) for the supported
  strategies.
- The generated Prisma client (`src/generated/prisma/client`) is gitignored.
  Generate it before running tests: `npx prisma generate`.

### Route handler tests

Next.js App Router handlers are plain async functions (`GET`, `POST`, …) that
take a `NextRequest` and return a `Response`. Tests call them directly instead
of booting the server.

Use the shared helper `src/lib/__tests__/helpers/test-server.ts` to build
requests and parse responses:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../auth/login/route';
import { postRequest, readJson } from '@/lib/__tests__/helpers/test-server';

describe('POST /api/auth/login', () => {
  it('rejects missing fields with 422', async () => {
    const { status, body } = await readJson(
      await POST(postRequest('/api/auth/login', { username: '' })),
    );
    assert.strictEqual(status, 422);
  });
});
```

- `getRequest(path, query?)` — build a GET `NextRequest` with query params.
- `postRequest` / `putRequest` / `patchRequest` / `deleteRequest` — JSON-body
  requests, optionally with extra headers.
- `readJson(res)` — awaits `res.json()` and returns `{ status, body }` in one
  call, collapsing the repeated `const res = …; const body = await res.json()`
  boilerplate.

### Mocking

There is no module-level mock API. Use these boundaries instead:

1. **Prisma model methods — direct assignment on the singleton.** The shared
   `prisma` client is an object instance; replace a delegate method and restore
   it after the test:

   ```ts
   import { prisma } from '@/lib/prisma';

   const original = prisma.user.findMany;
   beforeEach(() => {
     prisma.user.findMany = async () => [fakeUser()];
   });
   afterEach(() => {
     prisma.user.findMany = original;
   });
   ```

   > `mock.method(prisma.user, 'findMany', …)` does **not** work — the delegate
   > sits behind a Prisma proxy and is not an own data-property. Plain
   > assignment does.

2. **`writeAuditLog` / raw SQL — stub `$executeRaw*`.** Anything that persists
   via `prisma.$executeRawUnsafe` or `prisma.$executeRaw` (e.g. `writeAuditLog`,
   `seedAdmin`) can be neutralized by assigning no-ops to those two properties
   on the same singleton.

3. **Pure helpers run for real.** Modules with no DB/shell side effects
   (`@/lib/hmac`, `@/lib/chain-templates`) are exercised directly — e.g. compute
   a valid HMAC with `signPayload` to test the real verification path of
   `/api/sync/receive`.

4. **Designed seams.** Some modules expose test hooks, e.g.
   `transport-resolver.ts` exposes `__setDeps` / `__resetDeps` to inject a fake
   `TailscaleDeps`. Prefer these over ad-hoc stubs when present.

### Conventions

- **No production code changes in test PRs.** Add only test files, the helper,
  and docs. If a route cannot be tested without refactoring it, open a separate
  proposal (e.g. adding a `__setDeps` seam) rather than editing the handler.
- **Always restore stubs in `afterEach`** so state never leaks between tests.
- **Prefer validation + error-mapping paths**, then add mocked-DB happy paths.
  Routes whose happy path requires shell execution (e.g. `vpn-services`) are
  tested up to the boundary where they enter the un-mockable module; document
  the gap rather than mocking the shell.
- **Split by concern**, not by route size: keep validation tests (no DB) and
  DB-path tests (mocked) in separate files when one set would otherwise disturb
  the other — see `users.test.ts` vs `users-db.test.ts`.

## Workflow change protocol

Any change to `.github/workflows/**`, `.github/actions/**`, `.github/workflows/scripts/**`, `policy.json`, or `.github/pr-flow.json` MUST:

1. **Keep the e2e suite green** — run BOTH:
   - `npm run test-only` (src suite, incl. `src/lib/__tests__/workflow-triggers.test.ts` trigger/concurrency guardrails), AND
   - `cd .github/workflows && node --test scripts/__tests__/*.test.cjs` (e2e + script-decision tests; this is the `ci.yml:61` step).

   `npm run test-only` alone gives a **false-green** on workflow logic — both are required.
2. **Update `docs/workflow-e2e-scenarios.md`** when behavior intentionally changes; add a characterization case for any new flow.
3. **Spec tests for in-progress fixes stay `test.todo`/`test.skip`** (visible, CI-green) — never silently delete a spec test; activate it (`test()`) and implement the fix in the same PR.

The catalog (`docs/workflow-e2e-scenarios.md`) is the source of truth for what the flows do; the tests are the machine-checked enforcement. Rationale and trade-offs: `docs/adr/0001-e2e-characterization-suite-as-workflow-gate.md`.
