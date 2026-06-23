# Summary — Plan 999-036: Architectural Review Pass 5

## Status
Complete

## Source
- Artifact: `.planning/quick/260622-arch-review-pass5/260622-PLAN.md`
- SHA-256: `df6945ee7308ac4b30bbf052e152222579e14a62b478d1bfa5615bc38b0801ac`

## Proposals Implemented

### #13: Missing server-side service lifecycle (Critical — Runtime) ✓

`instrumentation.ts` already called `startBroadcaster()` but never called `geoIPManager.init()`. The GeoIP country trie was never built at startup, so all geo-routing lookups returned `null`.

**Fix:** Added `geoIPManager.init()` call in `instrumentation.ts:register()` with `.catch()` error handler. GeoIP now loads `geoip.dat` and builds the country trie on server startup. `ServiceMonitor` was assessed — it only exports `checkServiceStatus()` (no auto-monitor loop to start), so no wiring needed.

**Files:** `instrumentation.ts`

### #15: Panel sync API key lookup is O(n) bcrypt (Medium — Performance) ✓

`POST /api/sync/receive` loaded all active `RemotePanel` records and iterated with `bcrypt.compare()` per panel — O(n × 100ms).

**Fix:** Added `apiKeyFastHash` column (SHA-256 of plaintext key, unique + indexed) to `RemotePanel`. Sync receive now does O(1) `findFirst` by fast hash, then a single bcrypt verify on the match. Panel create and update routes compute and store the fast hash alongside the bcrypt hash.

**Files:** `prisma/schema.prisma`, `prisma/migrations/20260623034048_add_panel_fast_hash/migration.sql`, `src/lib/password.ts`, `src/app/api/sync/receive/route.ts`, `src/app/api/panels/route.ts`, `src/app/api/panels/[id]/route.ts`, `src/app/api/__tests__/sync-receive.test.ts`

## Proposals Deferred

- **Proposal 14 (server-connection.ts is a non-functional stub):** Implementing real SSH execution via `ssh2` library, designing a `RemoteExecutor` interface, and wiring it through `vpn-services.ts` is a full feature (not a fix). It adds a new dependency and touches the multi-server management story end-to-end. Too large for a single-plan review-fix scope. Should be a dedicated phase.

## Self-Check

- [x] TypeScript: no errors
- [x] ESLint: 0 errors (4 pre-existing warnings)
- [x] Prettier: all files formatted
- [x] Tests: 638 pass, 0 fail
- [x] Prisma migration: created and applied
- [x] Commit: atomic, conventional message
