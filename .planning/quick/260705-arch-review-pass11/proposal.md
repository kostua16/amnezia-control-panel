# Architectural Review Pass 11 (2026-07-05)

Source: `/gsd:explore` eleventh-pass review (non-duplicative vs proposals #1-#30 and open PRs).

## Dedup vs Open PRs

Excluded topics already covered:
- VPN service adapter polymorphism (#460)
- Typed API client (#459)
- User VPN consistency / compensating actions (#444)
- STUB public keys in chain-router (#442)
- Schema hygiene / enum promotion (#439)
- Batch server lookups in panel-sync push (#499)
- Tailscale status dedup (#505)
- Auth probe workflow (#625)
- ESLint bump (#561)
- Multiple prior architectural review passes (#497, #498, #626, etc.)

## Proposals

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 31 | **Quota monitor N+1 → batch queries** | High (Perf) | `src/lib/quota-monitor.ts` | Proposed |
| 32 | **Missing `Alert.type` index** | Medium (Perf) | `prisma/schema.prisma` | Proposed |
| 33 | **Graceful shutdown gaps: prisma disconnect + WebSocket close** | Medium (Reliability) | `instrumentation.ts` (extend) | Proposed |

---

### Proposal #31: Quota monitor N+1 → batch queries

**Problem:** `checkUserQuotas()` iterates all quota-having users sequentially. Per user it calls:
- `getUserUsagePercent()` → `prisma.trafficLog.aggregate()` (1 query)
- `checkQuotaThreshold()` up to 3× → `prisma.alert.findFirst()` (up to 3 queries)

With 50 users × (1 aggregate + 3 alert lookups) = **~200 DB queries per 5-minute tick**. SQLite handles this, but it's unnecessary load and will degrade as alert table grows.

**Fix:** Rewrite `checkUserQuotas()` to use 2 batch queries:
1. **Single grouped traffic aggregate:** `prisma.trafficLog.groupBy({ by: ['userId'], _sum: { bytesIn, bytesOut }, where: { timestamp: { gte: monthStart } } })` — replaces N individual aggregate calls.
2. **Single batch alert duplicate check:** `prisma.alert.findMany({ where: { type: { startsWith: 'quota_' }, createdAt: { gte: oneHourAgo } } })` — load all recent quota alerts into a `Set<string>`, then check membership in memory instead of N `findFirst` calls.

**Files:** `src/lib/quota-monitor.ts`
**Benefit:** 200 queries → 2 queries per tick. O(N) → O(1) DB round-trips.

---

### Proposal #32: Missing `Alert.type` index

**Problem:** `checkQuotaThreshold()` queries `prisma.alert.findFirst({ where: { type: alertType, createdAt: { gte: ... } } })` but the `Alert` model has no index on `type`. Existing indexes cover `isRead`, `severity`, and `createdAt` only. As alerts accumulate (proposal #25 adds retention cleanup but recent alerts still accumulate within the retention window), each duplicate-check becomes a full table scan.

Additionally, the broadcaster's `broadcastAlert` → `createAlert` path and any future alert queries by type benefit from this index.

**Fix:** Add `@@index([type])` to the `Alert` model in `prisma/schema.prisma`. Run `npx prisma migrate dev --name add-alert-type-index`.

**Files:** `prisma/schema.prisma`
**Benefit:** Alert duplicate-check and type-based queries use index scan instead of full table scan. Critical for quota monitor performance at scale.

---

### Proposal #33: Graceful shutdown gaps — prisma disconnect + WebSocket close

**Problem:** The repo-root `instrumentation.ts` **already** registers `SIGTERM`/`SIGINT` handlers (via `registerGracefulShutdown()`) and on shutdown already calls `cleanupPanelHealth()` (which internally calls `stopPanelHealthChecks()`), `stopBroadcaster()`, `cleanupConnections()` (server-connection), and `cleanupGeoIP()` (geoip-manager). The original "no handler exists" premise was wrong — verified against `instrumentation.ts:55-60`.

The remaining gaps in that existing handler:
- `prisma.$disconnect()` is never awaited — SQLite WAL checkpoint may not complete before SIGKILL in containerized deployments (Docker/K8s send SIGTERM, wait a grace period, then SIGKILL).
- The WebSocket server (`globalThis.__socketIO`, see `src/lib/websocket.ts`) is never explicitly closed.

**Fix:** Extend the existing `registerGracefulShutdown` cleanup callback in `instrumentation.ts` (repo root — there is no `src/instrumentation.ts`) to additionally:
1. Close the WebSocket server (`globalThis.__socketIO?.close()`).
2. Await `prisma.$disconnect()` (with a bounded timeout, e.g. 3s) — using the Prisma client already imported elsewhere; import `@/lib/prisma` lazily inside the callback.

No new handler or new file needed — this is an additive change to the existing handler.

**Files:** `instrumentation.ts` (extend existing cleanup callback)
**Benefit:** Ensures the SQLite WAL checkpoint completes and the WebSocket server closes cleanly before process exit, preventing potential last-write loss in containerized deployments.
