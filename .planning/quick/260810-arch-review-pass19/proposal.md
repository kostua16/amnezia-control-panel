# Architectural Review Pass 19 (2026-08-10)

Source: `/gsd:explore` nineteenth-pass review (non-duplicative vs proposals #1-#51 and open PRs).

Deduped vs open PRs: #1078 (auto-PR audit), #1076 (allowed-tools trim), #1075 (transient failure re-runs), #877 (audit-area rotation) — all workflow/automation, zero source overlap.

## Proposals

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 52 | **`panel-sync-client.ts` reimplements `pushToPanel()` retry/enrichment** | Medium (DRY) | `src/lib/panel-sync-client.ts`, `src/lib/panel-push.ts` | Proposed |
| 53 | **`seed.ts` non-atomic guard causes 500 on concurrent first-requests** | Low-Medium (Reliability) | `src/lib/seed.ts:3-14,30-31` | Proposed |
| 54 | **`parseBody()` utility is dead code — zero route adoption despite existence** | Medium (Security/Ops) | `src/lib/parse-body.ts`, 30 `src/app/api/**/*.ts` route files | Proposed |

## Proposal #52: `panel-sync-client.ts` reimplements `pushToPanel()` retry/enrichment

**Files:**
- `src/lib/panel-push.ts:61-133` (`pushToPanel`)
- `src/lib/panel-sync-client.ts:17,26,173-268` (`pushConfigToPanel`)

**Problem:** `panel-push.ts` exports `pushToPanel()` — a shared primitive for signed panel-to-panel HTTP pushes with HMAC signing, retry with exponential backoff, timeout enforcement, and error enrichment. This was extracted as part of proposal #11's fix to `config-applier.ts`.

However, `panel-sync-client.ts` was never refactored to use it. The sync client maintains its own parallel implementation:
- Own `RETRY_DELAYS = [1000, 2000, 4000]` (line 17) — identical values to `panel-push.ts:40`
- Own `sleep()` helper (line 26) — identical to `panel-push.ts:43`
- Own retry loop (lines 222-268) — same structure: attempt loop, `sleep(RETRY_DELAYS[attempt])`, error enrichment via `enrichError`
- Own `signPayload` + header assembly (lines 200-220) — same as `panel-push.ts:73-74`

This is the same class of duplication that #11 identified in `config-applier.ts`, but in a different module that was never refactored.

**Fix:** Refactor `pushConfigToPanel()` in `panel-sync-client.ts` to delegate to `pushToPanel()` from `panel-push.ts`. Extract any sync-client-specific payload shaping (config wrapping, panel metadata) before calling `pushToPanel()`. Remove the duplicated `RETRY_DELAYS`, `sleep`, retry loop, and direct `enrichError` call.

**Benefit:** Single canonical push implementation; retry/error behavior changes only need one edit point; reduced code surface for push-related bugs.

---

## Proposal #53: `seed.ts` non-atomic guard causes 500 on concurrent first-requests

**File:** `src/lib/seed.ts:3-14,30-31`

**Problem:** The seed function uses a module-level `seeded` boolean as a concurrency guard (line 4). The check-then-write sequence is not atomic:

1. Request A checks `seeded === false`, queries `findUnique` → `existing = null`
2. Request B checks `seeded === false` (A hasn't set it yet), queries `findUnique` → `existing = null`
3. Request A calls `prisma.admin.create()` → succeeds
4. Request B calls `prisma.admin.create()` → P2002 unique violation on `username`
5. Catch block at line 42 re-throws the error → **500 Internal Server Error**

The race window is small but real: browser tab restore on startup can fire the login page + API health check simultaneously, both triggering `seedAdmin()` before the first call completes.

**Fix:** Catch `P2002` (Prisma unique violation) specifically in the `create()` call and treat it as "already seeded" — return silently instead of re-throwing. The DB unique constraint on `Admin.username` is the authoritative guard; the module-level boolean is an optimization, not a correctness mechanism.

```typescript
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    seeded = true;
    return; // Already seeded by a concurrent request — idempotent
  }
  console.error('[seed] Failed to seed admin user:', error);
  throw error;
}
```

**Benefit:** Eliminates a startup 500 race condition; makes seed truly idempotent even under concurrency; single-admin panel avoids confusing error on first login after fresh deploy.

---

## Proposal #54: `parseBody()` utility is dead code — zero route adoption

**Files:**
- `src/lib/parse-body.ts` (utility, unused)
- `src/lib/__tests__/parse-body.test.ts` (tests pass, but no consumer)
- 30 route files under `src/app/api/**/*.ts` using raw `request.json()`

**Problem:** Proposal #48 identified that 30+ POST/PUT routes call `await request.json()` with no size constraint. The fix was partially implemented: `parse-body.ts` was created with `readBody()` (size-limited stream reader), `parseBody()` (size-limit + Zod validation), and `BodySizeLimitError`. The `apiHandler()` wrapper in `api-handler.ts` was updated to map `BodySizeLimitError` → 413.

However, **zero route files import `parseBody`**. Grep shows the utility is only referenced in its own test file. All 30 POST/PUT routes still use raw `request.json()`, meaning:
- No request body size limits are enforced despite the infrastructure being ready
- Oversized payloads can still OOM the server
- The `BodySizeLimitError` → 413 mapping in `apiHandler` is unreachable dead code

This is a half-completed implementation: the plumbing exists but was never wired in.

**Fix:** Adopt `parseBody()` in all 30 routes. Two-tier approach:
1. **Quick win:** Routes that already use Zod schemas: replace `const body = await request.json(); schema.parse(body)` with `const body = await parseBody(request, schema)`. This gets size limiting + validation in one call.
2. **Routes without schemas:** At minimum, replace `await request.json()` with `const raw = await readBody(request)` for size limiting, then `JSON.parse(raw)`.

Priority routes (unauthenticated or high-traffic): `auth/login`, `sync/receive`, `panels/push`.

**Benefit:** Actually enforces the body size limits that proposal #48 identified and the infrastructure was built for; prevents OOM from oversized payloads; completes the half-done security fix.
