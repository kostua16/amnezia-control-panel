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
| 33 | **No graceful shutdown handler** | Medium (Reliability) | `src/instrumentation.ts` (extend) | Proposed |

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

### Proposal #33: No graceful shutdown handler

**Problem:** No `process.on('SIGTERM')` or `process.on('SIGINT')` handler exists. When the container/process receives a termination signal:
- `real-time-broadcaster` intervals keep firing (no `stopBroadcaster()`)
- `panel-health-checker` intervals keep firing (no `stopPanelHealthChecks()`)
- `geoip-manager` has no cleanup hook
- SQLite connection is not explicitly closed — WAL checkpoint may not complete before SIGKILL

In containerized deployments (Docker/K8s), the orchestrator sends SIGTERM, waits a grace period (typically 10s), then SIGKILL. Without cleanup, SQLite may leave the WAL file in an inconsistent state, losing the last few writes.

**Fix:** Add a shutdown handler in `instrumentation.ts` (or a dedicated `src/lib/graceful-shutdown.ts`) that:
1. Calls `stopBroadcaster()` and `stopPanelHealthChecks()`
2. Closes the WebSocket server (`globalThis.__socketIO?.close()`)
3. Awaits `prisma.$disconnect()` with a bounded timeout (3s)
4. Registers via `process.on('SIGTERM', shutdown)` and `process.on('SIGINT', shutdown)`

**Files:** `src/instrumentation.ts` (or `src/lib/graceful-shutdown.ts` new), `server.mjs`
**Benefit:** Clean shutdown prevents WAL corruption, stops all intervals/connections, and ensures SQLite checkpoint completes before process exit.
