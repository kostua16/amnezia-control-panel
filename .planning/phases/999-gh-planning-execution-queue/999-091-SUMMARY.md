# Plan 999-091 Summary

## Status: Complete

## What Was Built

Two architectural fixes from Arch Review Pass 13:

### Proposal #36 — Whitelist Entries Persisted to Database (Critical)
- Added `WhitelistEntry` model to `prisma/schema.prisma` (id, type, value, description, serverId nullable, isActive, createdAt, updatedAt)
- Generated migration `20260710193256_add_whitelist_entry_table`
- Added `@@index([type, isActive])` and `@@index([serverId])` for common filter patterns
- Rewrote `GET /api/routing/whitelist` to use `prisma.whitelistEntry.findMany` with serverId filtering
- Rewrote `POST /api/routing/whitelist` to use `prisma.whitelistEntry.create` with type validation preserved
- Rewrote `GET|PUT|DELETE /api/routing/whitelist/[id]` from stub-only (501) to real Prisma CRUD (findUnique, update, delete)

**Before:** In-memory array lost on every restart. PUT/DELETE returned 501.
**After:** Whitelist survives restarts. Full CRUD via Prisma.

### Proposal #37 — TOCTOU Race Fixed in Sync/Receive (High)
- Wrapped `storePreviousConfig` + upsert + audit log write inside `prisma.$transaction()`
- Removed dependency on `storePreviousConfig` import (logic inlined into transaction)
- Updated sync-receive test to stub `$transaction` callback correctly
- Transaction ensures atomic read-previous + write-new so concurrent pushes serialize correctly

**Before:** Two concurrent pushes could read the same "previous" config, silently losing the first push from the rollback chain.
**After:** Transaction serializes concurrent pushes; rollback chain stays intact.

## Key Files Changed
- `prisma/schema.prisma` — WhitelistEntry model
- `prisma/migrations/20260710193256_add_whitelist_entry_table/migration.sql` — DDL
- `src/app/api/routing/whitelist/route.ts` — GET/POST via Prisma
- `src/app/api/routing/whitelist/[id]/route.ts` — GET/PUT/DELETE via Prisma
- `src/app/api/sync/receive/route.ts` — transactional config store
- `src/app/api/__tests__/sync-receive.test.ts` — $transaction stub fix

## Self-Check: PASSED
- [x] tsc --noEmit: 0 errors
- [x] npm run test-only: 840/840 pass
- [x] ESLint: 0 errors, 0 warnings
- [x] Prettier: all files formatted
- [x] Workflow e2e: 751/751 pass
