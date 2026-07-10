# Architectural Review Pass 13 (2026-07-10)

Source: `/gsd:explore` thirteenth-pass review (non-duplicative vs proposals #1-#35 and open PRs #442, #444, #459, #460, #655, #660, #661, #662).

## Proposals

### #36: Whitelist entries stored in-memory — data lost on restart (Critical)

**File:** `src/app/api/routing/whitelist/route.ts:14-24`

**Problem:** Whitelist CRUD uses a module-level `Array<>` with auto-increment ID. The code contains a literal TODO comment: `// In-memory store for whitelist entries (replace with DB model in production)`. Every server restart discards all whitelist entries. Phase 9.3 (Whitelist Management) shipped this as production code — admin-configured whitelist silently vanishes on deploy or crash.

**Change:** Add `WhitelistEntry` model to `prisma/schema.prisma` (id, type, value, description, serverId nullable, isActive, timestamps), generate migration, replace the in-memory array in `src/app/api/routing/whitelist/route.ts` and `src/app/api/routing/whitelist/[id]/route.ts` with Prisma CRUD queries. Add `@@index([type, isActive])` and `@@index([serverId])` for common filter patterns. Add seed data migration for any existing deployments (none expected since data is ephemeral).

**Benefit:** Whitelist survives restarts; admin trust restored; Prisma-level validation and indexing instead of manual array management.

---

### #37: TOCTOU race in sync/receive config versioning (High)

**File:** `src/app/api/sync/receive/route.ts:184-208`

**Problem:** The receive endpoint performs `storePreviousConfig(candidate.id)` (reads current config to save as rollback) and then `prisma.cachedPanelConfig.update(...)` (writes new config) as two separate operations. Under concurrent push requests targeting the same panel, two pushes can both read the same "previous" config, causing the second push to silently discard the first push's config from the rollback chain. This is a classic time-of-check-to-time-of-use race.

**Change:** Wrap steps 7 (storePreviousConfig) and 8 (upsert new config) in `prisma.$transaction()`. Move the audit log write inside the same transaction. The transaction ensures atomic read-previous + write-new so concurrent pushes serialize correctly and the rollback chain stays complete.

**Benefit:** Config rollback chain stays intact under concurrent pushes; no silent data loss in multi-admin scenarios.

---

## Excluded Topics

Already covered by open PRs or prior proposals:
- Reorder batch transaction isolation (withdrawn — `src/app/api/routing/geo/reorder/route.ts` and `src/app/api/routing/rules/reorder/route.ts` already wrap updates in `prisma.$transaction()`)
- User creation DB↔VPN consistency (#4, PR #444)
- Typed API client / useMutation hooks (#23, PR #459)
- VPN service adapter polymorphism (#5, PR #460)
- Chain router stub keys (#10, PR #442)
- Workflow improvements (PRs #655, #660, #661, #662)
- All proposals #1-#35 indexed in ROADMAP.md
